# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter data om enterprise-applikasjoner fra Microsoft Graph.

.DESCRIPTION
    Retrieves all enterprise applications (service principals) and app
    registrations from Entra ID. Collects credential expiry information
    (client secrets and certificates), status, publisher info, and
    permission grants. Flags applications with expired or soon-expiring
    credentials.

    Graph API endpoints:
      GET /servicePrincipals
      GET /applications
    Required scopes:
      Application.Read.All
      Directory.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes enterprise-apps.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of apps collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-EnterpriseAppData.ps1 -Config $config -OutputPath ".\data\enterprise-apps.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Applications

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$appCount = 0

# Summary statistics
$summary = @{
    totalApps = 0
    microsoftApps = 0
    thirdPartyApps = 0
    enabledApps = 0
    disabledApps = 0
    appsWithSecrets = 0
    appsWithCertificates = 0
    appsWithNoCredentials = 0
    expiredCredentials = 0
    criticalIn7Days = 0
    warningIn30Days = 0
    attentionIn90Days = 0
    healthyCredentials = 0
    appsWithOwners = 0
    orphanedApps = 0
    appsByType = @{}
}

try {
    Write-Host "    Collecting enterprise applications..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Retrieve app registrations with pagination (contains credential info)
    # -----------------------------------------------------------------------
    $appRegistrations = @()
    $appResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/applications?`$select=id,appId,displayName,passwordCredentials,keyCredentials,createdDateTime,signInAudience,publisherDomain,verifiedPublisher,notes,tags&`$top=500" `
            -OutputType PSObject
    } -OperationName "App registration retrieval"

    if ($appResponse.value) {
        $appRegistrations = @($appResponse.value)
    }

    # Handle pagination
    while ($appResponse.'@odata.nextLink') {
        $appResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $appResponse.'@odata.nextLink' -OutputType PSObject
        } -OperationName "App registration pagination"
        if ($appResponse.value) {
            $appRegistrations += $appResponse.value
        }
    }

    Write-Host "      Retrieved $($appRegistrations.Count) app registrations" -ForegroundColor Gray

    # Build lookup by AppId for credential cross-reference
    $appRegLookup = @{}
    foreach ($app in $appRegistrations) {
        $appId = Get-GraphPropertyValue -Object $app -PropertyNames @("appId", "AppId")
        if ($appId) {
            $appRegLookup[$appId] = $app
        }
    }

    # -----------------------------------------------------------------------
    # 2. Retrieve service principals with pagination and owners
    # -----------------------------------------------------------------------
    $servicePrincipals = @()
    $spResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$select=id,appId,displayName,accountEnabled,appOwnerOrganizationId,createdDateTime,publisherName,servicePrincipalType,tags,replyUrls,loginUrl,appRoleAssignmentRequired,notes,verifiedPublisher&`$expand=owners(`$select=id,displayName,userPrincipalName,mail)&`$top=500" `
            -OutputType PSObject
    } -OperationName "Service principal retrieval"

    if ($spResponse.value) {
        $servicePrincipals = @($spResponse.value)
    }

    # Handle pagination
    while ($spResponse.'@odata.nextLink') {
        $spResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $spResponse.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Service principal pagination"
        if ($spResponse.value) {
            $servicePrincipals += $spResponse.value
        }
    }

    Write-Host "      Retrieved $($servicePrincipals.Count) service principals" -ForegroundColor Gray

    # Share app registrations and service principals with downstream collectors
    # (Get-ServicePrincipalSecrets, Get-OAuthConsentGrants) to avoid duplicate API calls
    if ($SharedData -is [hashtable]) {
        $SharedData['AppRegistrations'] = $appRegistrations
        $SharedData['ServicePrincipals'] = $servicePrincipals
    }

    # -----------------------------------------------------------------------
    # 3. Process each service principal
    # -----------------------------------------------------------------------
    $processedApps = @()
    $insights = @()

    foreach ($sp in $servicePrincipals) {
        try {
            # Handle both PascalCase and camelCase property names
            $spId = if ($sp.Id) { $sp.Id } else { $sp.id }
            $spAppId = Get-GraphPropertyValue -Object $sp -PropertyNames @("appId", "AppId")
            $spDisplayName = Get-GraphPropertyValue -Object $sp -PropertyNames @("displayName", "DisplayName")
            $spAccountEnabled = if ($null -ne $sp.AccountEnabled) { $sp.AccountEnabled } else { $sp.accountEnabled }
            $spAppOwnerOrgId = if ($sp.AppOwnerOrganizationId) { $sp.AppOwnerOrganizationId } else { $sp.appOwnerOrganizationId }
            $spPublisherName = if ($sp.PublisherName) { $sp.PublisherName } else { $sp.publisherName }
            $spServicePrincipalType = if ($sp.ServicePrincipalType) { $sp.ServicePrincipalType } else { $sp.servicePrincipalType }
            $spCreatedDateTime = if ($sp.CreatedDateTime) { $sp.CreatedDateTime } else { $sp.createdDateTime }
            $spTags = if ($sp.Tags) { $sp.Tags } else { $sp.tags }
            $spReplyUrls = if ($sp.ReplyUrls) { $sp.ReplyUrls } else { $sp.replyUrls }
            $spLoginUrl = if ($sp.LoginUrl) { $sp.LoginUrl } else { $sp.loginUrl }
            $spNotes = if ($sp.Notes) { $sp.Notes } else { $sp.notes }
            $spAppRoleRequired = if ($null -ne $sp.AppRoleAssignmentRequired) { $sp.AppRoleAssignmentRequired } else { $sp.appRoleAssignmentRequired }
            $spOwners = if ($sp.owners) { $sp.owners } else { @() }
            $spVerifiedPublisher = if ($sp.VerifiedPublisher) { $sp.VerifiedPublisher } else { $sp.verifiedPublisher }

            # Determine if first-party (Microsoft) or third-party
            $isMicrosoft = $false
            if ($spAppOwnerOrgId -eq "f8cdef31-a31e-4b4a-93e4-5f571e91255a" -or
                $spPublisherName -match "^Microsoft") {
                $isMicrosoft = $true
            }

            $publisher = if ($isMicrosoft) { "Microsoft" }
                         elseif ($spPublisherName) { $spPublisherName }
                         else { "Unknown" }

            # Extract verified publisher info
            $verifiedPublisherName = $null
            $verifiedPublisherAddedDateTime = $null
            if ($spVerifiedPublisher) {
                $verifiedPublisherName = $spVerifiedPublisher.displayName
                $verifiedPublisherAddedDateTime = $spVerifiedPublisher.addedDateTime
            }

            # Process owners
            $ownersList = @()
            if ($spOwners -and $spOwners.Count -gt 0) {
                foreach ($owner in $spOwners) {
                    $ownersList += @{
                        id = $owner.id
                        displayName = $owner.displayName
                        userPrincipalName = $owner.userPrincipalName
                        mail = $owner.mail
                    }
                }
            }

            # Get credential info from app registration
            $secrets = @()
            $certificates = @()
            $nearestExpiryDays = $null

            if ($appRegLookup.ContainsKey($spAppId)) {
                $appReg = $appRegLookup[$spAppId]

                # Process password credentials (client secrets)
                $passwordCreds = if ($appReg.PasswordCredentials) { $appReg.PasswordCredentials } else { $appReg.passwordCredentials }
                if ($passwordCreds) {
                    foreach ($secret in $passwordCreds) {
                        $endDt = if ($secret.EndDateTime) { $secret.EndDateTime } else { $secret.endDateTime }
                        $startDt = if ($secret.StartDateTime) { $secret.StartDateTime } else { $secret.startDateTime }
                        $daysUntil = Get-DaysUntilDate -DateValue $endDt
                        $secrets += @{
                            displayName = Get-GraphPropertyValue -Object $secret -PropertyNames @("displayName", "DisplayName")
                            hint = if ($secret.Hint) { $secret.Hint } else { $secret.hint }
                            keyId = if ($secret.KeyId) { $secret.KeyId } else { $secret.keyId }
                            startDateTime = if ($startDt) { ([DateTime]$startDt).ToString("o") } else { $null }
                            endDateTime = if ($endDt) { ([DateTime]$endDt).ToString("o") } else { $null }
                            daysUntilExpiry = $daysUntil
                        }
                        if ($null -ne $daysUntil) {
                            if ($null -eq $nearestExpiryDays -or $daysUntil -lt $nearestExpiryDays) {
                                $nearestExpiryDays = $daysUntil
                            }
                        }
                    }
                }

                # Process key credentials (certificates)
                $keyCreds = if ($appReg.KeyCredentials) { $appReg.KeyCredentials } else { $appReg.keyCredentials }
                if ($keyCreds) {
                    foreach ($cert in $keyCreds) {
                        $endDt = if ($cert.EndDateTime) { $cert.EndDateTime } else { $cert.endDateTime }
                        $startDt = if ($cert.StartDateTime) { $cert.StartDateTime } else { $cert.startDateTime }
                        $daysUntil = Get-DaysUntilDate -DateValue $endDt
                        $certificates += @{
                            displayName = Get-GraphPropertyValue -Object $cert -PropertyNames @("displayName", "DisplayName")
                            type = if ($cert.Type) { $cert.Type } else { $cert.type }
                            usage = if ($cert.Usage) { $cert.Usage } else { $cert.usage }
                            keyId = if ($cert.KeyId) { $cert.KeyId } else { $cert.keyId }
                            customKeyIdentifier = if ($cert.CustomKeyIdentifier) { $cert.CustomKeyIdentifier } else { $cert.customKeyIdentifier }
                            startDateTime = if ($startDt) { ([DateTime]$startDt).ToString("o") } else { $null }
                            endDateTime = if ($endDt) { ([DateTime]$endDt).ToString("o") } else { $null }
                            daysUntilExpiry = $daysUntil
                        }
                        if ($null -ne $daysUntil) {
                            if ($null -eq $nearestExpiryDays -or $daysUntil -lt $nearestExpiryDays) {
                                $nearestExpiryDays = $daysUntil
                            }
                        }
                    }
                }
            }

            # Determine credential status
            $credentialStatus = Get-CredentialStatus -DaysUntilExpiry $nearestExpiryDays
            $hasCredentials = ($secrets.Count -gt 0 -or $certificates.Count -gt 0)

            # Map service principal type
            $appType = switch ($spServicePrincipalType) {
                "Application"       { "application" }
                "ManagedIdentity"   { "managed-identity" }
                "Legacy"            { "legacy" }
                "SocialIdp"         { "social-idp" }
                default             { "other" }
            }

            # Update summary statistics
            $summary.totalApps++
            if ($isMicrosoft) { $summary.microsoftApps++ } else { $summary.thirdPartyApps++ }
            if ($spAccountEnabled) { $summary.enabledApps++ } else { $summary.disabledApps++ }
            if ($secrets.Count -gt 0) { $summary.appsWithSecrets++ }
            if ($certificates.Count -gt 0) { $summary.appsWithCertificates++ }
            if (-not $hasCredentials) { $summary.appsWithNoCredentials++ }
            if ($ownersList.Count -gt 0) { $summary.appsWithOwners++ } else { $summary.orphanedApps++ }

            # Update credential status counts (for third-party apps only)
            if (-not $isMicrosoft) {
                switch ($credentialStatus) {
                    "expired"   { $summary.expiredCredentials++ }
                    "critical"  { $summary.criticalIn7Days++ }
                    "warning"   { $summary.warningIn30Days++ }
                    "attention" { $summary.attentionIn90Days++ }
                    "healthy"   { $summary.healthyCredentials++ }
                }
            }

            # Update app type counts
            if (-not $summary.appsByType[$appType]) { $summary.appsByType[$appType] = 0 }
            $summary.appsByType[$appType]++

            # Build output object
            $processedApp = [PSCustomObject]@{
                id                      = $spId
                appId                   = $spAppId
                displayName             = $spDisplayName
                accountEnabled          = [bool]$spAccountEnabled
                publisher               = $publisher
                isMicrosoft             = $isMicrosoft
                appType                 = $appType
                createdDateTime         = if ($spCreatedDateTime) { ([DateTime]$spCreatedDateTime).ToString("o") } else { $null }
                hasCredentials          = $hasCredentials
                secretCount             = $secrets.Count
                certificateCount        = $certificates.Count
                nearestExpiryDays       = $nearestExpiryDays
                credentialStatus        = $credentialStatus
                secrets                 = $secrets
                certificates            = $certificates
                # New properties
                owners                  = $ownersList
                ownerCount              = $ownersList.Count
                tags                    = @($spTags)
                replyUrls               = @($spReplyUrls)
                loginUrl                = $spLoginUrl
                notes                   = $spNotes
                appRoleAssignmentRequired = [bool]$spAppRoleRequired
                verifiedPublisher       = $verifiedPublisherName
                verifiedPublisherDate   = if ($verifiedPublisherAddedDateTime) { ([DateTime]$verifiedPublisherAddedDateTime).ToString("o") } else { $null }
            }

            $processedApps += $processedApp
            $appCount++

            # Progress indicator
            if ($appCount % 100 -eq 0) {
                Write-Host "      Processed $appCount apps..." -ForegroundColor Gray
            }
        }
        catch {
            $errName = Get-GraphPropertyValue -Object $sp -PropertyNames @("displayName", "DisplayName")
            if (-not $errName) { $errName = "unknown" }
            $errors += "Error processing ${errName}: $($_.Exception.Message)"
        }
    }

    # -----------------------------------------------------------------------
    # 4. Generate insights
    # -----------------------------------------------------------------------
    # Expired credentials insight
    if ($summary.expiredCredentials -gt 0) {
        $insights += @{
            id = "expired-credentials"
            title = "Expired Credentials"
            severity = "critical"
            count = $summary.expiredCredentials
            description = "$($summary.expiredCredentials) third-party apps have expired credentials that need immediate attention."
            recommendedAction = "Rotate the expired client secrets or certificates to restore app functionality."
        }
    }

    # Critical credentials (7 days) insight
    if ($summary.criticalIn7Days -gt 0) {
        $insights += @{
            id = "critical-credentials"
            title = "Credentials Expiring in 7 Days"
            severity = "critical"
            count = $summary.criticalIn7Days
            description = "$($summary.criticalIn7Days) third-party apps have credentials expiring within 7 days."
            recommendedAction = "Immediately rotate these credentials to prevent service disruption."
        }
    }

    # Warning credentials (30 days) insight
    if ($summary.warningIn30Days -gt 0) {
        $insights += @{
            id = "warning-credentials"
            title = "Credentials Expiring in 30 Days"
            severity = "warning"
            count = $summary.warningIn30Days
            description = "$($summary.warningIn30Days) third-party apps have credentials expiring within 30 days."
            recommendedAction = "Plan credential rotation for these applications soon."
        }
    }

    # Orphaned apps (no owners) insight
    $orphanedThirdParty = ($processedApps | Where-Object { -not $_.isMicrosoft -and $_.ownerCount -eq 0 }).Count
    if ($orphanedThirdParty -gt 0) {
        $insights += @{
            id = "orphaned-apps"
            title = "Apps Without Owners"
            severity = "warning"
            count = $orphanedThirdParty
            description = "$orphanedThirdParty third-party apps have no assigned owners."
            recommendedAction = "Assign owners to these applications for proper governance and accountability."
        }
    }

    # Disabled apps insight
    $disabledThirdParty = ($processedApps | Where-Object { -not $_.isMicrosoft -and -not $_.accountEnabled }).Count
    if ($disabledThirdParty -gt 0) {
        $insights += @{
            id = "disabled-apps"
            title = "Disabled Applications"
            severity = "info"
            count = $disabledThirdParty
            description = "$disabledThirdParty third-party apps are currently disabled."
            recommendedAction = "Review disabled apps and remove those no longer needed."
        }
    }

    # Sort: expired/critical first, then by nearest expiry
    $processedApps = $processedApps | Sort-Object -Property @{Expression = {
        switch ($_.credentialStatus) {
            "expired"         { 0 }
            "critical"        { 1 }
            "warning"         { 2 }
            "attention"       { 3 }
            "healthy"         { 4 }
            "no-credentials"  { 5 }
            default           { 6 }
        }
    }}, @{Expression = "nearestExpiryDays"; Ascending = $true}

    # Build output with summary and insights
    $output = [PSCustomObject]@{
        apps = $processedApps
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
    }

    # Save data using shared utility
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $appCount enterprise apps" -ForegroundColor Green
    if ($summary.expiredCredentials -gt 0 -or $summary.criticalIn7Days -gt 0) {
        Write-Host "    [!] $($summary.expiredCredentials) expired, $($summary.criticalIn7Days) critical credentials need attention" -ForegroundColor Yellow
    }

    return New-CollectorResult -Success $true -Count $appCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Authorization") {
        Write-Host "    [!] Enterprise app collection requires Application.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty structure to prevent dashboard errors
    $emptyOutput = [PSCustomObject]@{
        apps = @()
        summary = @{
            totalApps = 0
            microsoftApps = 0
            thirdPartyApps = 0
            enabledApps = 0
            disabledApps = 0
            appsWithSecrets = 0
            appsWithCertificates = 0
            appsWithNoCredentials = 0
            expiredCredentials = 0
            criticalIn7Days = 0
            warningIn30Days = 0
            attentionIn90Days = 0
            healthyCredentials = 0
            appsWithOwners = 0
            orphanedApps = 0
            appsByType = @{}
        }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
