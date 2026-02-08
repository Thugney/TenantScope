# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects OAuth permission grants and app consent data from Microsoft Graph.

.DESCRIPTION
    Retrieves all OAuth2 permission grants showing which users have consented
    to which applications and what permissions they've granted. This is CRITICAL
    for security - OAuth phishing is a primary attack vector.

    Identifies:
    - High-risk permissions (Mail.ReadWrite, Directory.ReadWrite.All, etc.)
    - Unverified publisher apps with consent
    - Admin consent vs user consent
    - Excessive permission grants

    Graph API endpoints:
    - GET /oauth2PermissionGrants (delegated permissions)
    - Cross-references with /servicePrincipals for app details

    Required scopes:
    - Directory.Read.All
    - DelegatedPermissionGrant.ReadWrite.All (or .Read.All)

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes oauth-consent-grants.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-OAuthConsentGrants.ps1 -Config $config -OutputPath ".\data\oauth-consent-grants.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.SignIns

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# HIGH-RISK PERMISSIONS DEFINITION
# ============================================================================

$HighRiskScopes = @(
    # Mail access
    "Mail.Read", "Mail.ReadWrite", "Mail.Send", "Mail.ReadBasic",
    # Directory manipulation
    "Directory.ReadWrite.All", "Directory.AccessAsUser.All",
    # User manipulation
    "User.ReadWrite.All", "User.ManageIdentities.All",
    # Files access
    "Files.ReadWrite.All", "Sites.ReadWrite.All",
    # Calendar access
    "Calendars.ReadWrite", "Calendars.Read.Shared",
    # Contacts
    "Contacts.ReadWrite",
    # Group manipulation
    "Group.ReadWrite.All", "GroupMember.ReadWrite.All",
    # Application permissions
    "Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All",
    # Role management
    "RoleManagement.ReadWrite.Directory",
    # Full access
    "full_access_as_app", "offline_access"
)

$MediumRiskScopes = @(
    "Mail.Read.Shared", "Calendars.Read", "Contacts.Read",
    "User.Read.All", "Group.Read.All", "Directory.Read.All",
    "Files.Read.All", "Sites.Read.All", "Notes.ReadWrite.All"
)

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$grantCount = 0

try {
    Write-Host "    Collecting OAuth consent grants..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Get all OAuth2 permission grants
    # -----------------------------------------------------------------------
    $grants = @()
    $grantResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?`$top=500" `
            -OutputType PSObject
    } -OperationName "OAuth grants retrieval"

    if ($grantResponse.value) {
        $grants = @($grantResponse.value)
    }

    # Handle pagination
    while ($grantResponse.'@odata.nextLink') {
        $grantResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $grantResponse.'@odata.nextLink' -OutputType PSObject
        } -OperationName "OAuth grants pagination"
        if ($grantResponse.value) {
            $grants += $grantResponse.value
        }
    }

    Write-Host "      Retrieved $($grants.Count) OAuth permission grants" -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 2. Build service principal lookup (reuse from enterprise apps if exists)
    # -----------------------------------------------------------------------
    Write-Host "      Building service principal lookup..." -ForegroundColor Gray

    $spLookup = @{}
    $spResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$select=id,appId,displayName,publisherName,appOwnerOrganizationId,verifiedPublisher,accountEnabled&`$top=999" `
            -OutputType PSObject
    } -OperationName "Service principal lookup"

    if ($spResponse.value) {
        foreach ($sp in $spResponse.value) {
            $spLookup[$sp.id] = $sp
        }
    }

    # Handle pagination
    while ($spResponse.'@odata.nextLink') {
        $spResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $spResponse.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Service principal pagination"
        if ($spResponse.value) {
            foreach ($sp in $spResponse.value) {
                $spLookup[$sp.id] = $sp
            }
        }
    }

    Write-Host "      Loaded $($spLookup.Count) service principals for lookup" -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 3. Process each grant
    # -----------------------------------------------------------------------
    $processedGrants = @()
    $summary = @{
        totalGrants = 0
        adminConsentGrants = 0
        userConsentGrants = 0
        highRiskGrants = 0
        mediumRiskGrants = 0
        lowRiskGrants = 0
        unverifiedPublisherGrants = 0
        thirdPartyGrants = 0
        microsoftGrants = 0
        uniqueApps = @{}
        uniqueUsers = @{}
        riskyScopeBreakdown = @{}
    }

    foreach ($grant in $grants) {
        $clientId = $grant.clientId
        $principalId = $grant.principalId
        $consentType = $grant.consentType
        $scope = $grant.scope

        # Get app details from lookup
        $appInfo = $spLookup[$clientId]
        $appDisplayName = if ($appInfo) { $appInfo.displayName } else { "Unknown App" }
        $appPublisher = if ($appInfo -and $appInfo.publisherName) { $appInfo.publisherName } else { "Unknown" }
        $appOwnerOrgId = if ($appInfo) { $appInfo.appOwnerOrganizationId } else { $null }

        # Determine if Microsoft app
        $isMicrosoft = $false
        if ($appOwnerOrgId -eq "f8cdef31-a31e-4b4a-93e4-5f571e91255a" -or
            $appPublisher -match "^Microsoft") {
            $isMicrosoft = $true
        }

        # Check verified publisher
        $isVerifiedPublisher = $false
        $verifiedPublisherName = $null
        if ($appInfo -and $appInfo.verifiedPublisher -and $appInfo.verifiedPublisher.displayName) {
            $isVerifiedPublisher = $true
            $verifiedPublisherName = $appInfo.verifiedPublisher.displayName
        }

        # Parse scopes
        $scopes = @()
        if ($scope) {
            $scopes = $scope.Trim().Split(" ") | Where-Object { $_ -ne "" }
        }

        # Analyze risk level
        $highRiskScopes = @()
        $mediumRiskScopes = @()
        foreach ($s in $scopes) {
            if ($HighRiskScopes -contains $s) {
                $highRiskScopes += $s
                # Track risky scope breakdown
                if (-not $summary.riskyScopeBreakdown.ContainsKey($s)) {
                    $summary.riskyScopeBreakdown[$s] = 0
                }
                $summary.riskyScopeBreakdown[$s]++
            }
            elseif ($MediumRiskScopes -contains $s) {
                $mediumRiskScopes += $s
            }
        }

        $riskLevel = "low"
        if ($highRiskScopes.Count -gt 0) {
            $riskLevel = "high"
            $summary.highRiskGrants++
        }
        elseif ($mediumRiskScopes.Count -gt 0) {
            $riskLevel = "medium"
            $summary.mediumRiskGrants++
        }
        else {
            $summary.lowRiskGrants++
        }

        # Consent type
        $isAdminConsent = ($consentType -eq "AllPrincipals")
        if ($isAdminConsent) {
            $summary.adminConsentGrants++
        }
        else {
            $summary.userConsentGrants++
        }

        # Track stats
        if ($isMicrosoft) { $summary.microsoftGrants++ } else { $summary.thirdPartyGrants++ }
        if (-not $isVerifiedPublisher -and -not $isMicrosoft) { $summary.unverifiedPublisherGrants++ }
        $summary.uniqueApps[$clientId] = $true
        if ($principalId) { $summary.uniqueUsers[$principalId] = $true }

        # Build flags
        $flags = @()
        if ($riskLevel -eq "high") { $flags += "high-risk" }
        if (-not $isVerifiedPublisher -and -not $isMicrosoft) { $flags += "unverified-publisher" }
        if ($isAdminConsent) { $flags += "admin-consent" }
        if ($highRiskScopes -contains "Mail.ReadWrite" -or $highRiskScopes -contains "Mail.Send") {
            $flags += "mail-access"
        }
        if ($highRiskScopes -contains "Directory.ReadWrite.All") {
            $flags += "directory-write"
        }

        $processedGrant = [PSCustomObject]@{
            id                     = $grant.id
            clientId               = $clientId
            appDisplayName         = $appDisplayName
            appPublisher           = $appPublisher
            isMicrosoft            = $isMicrosoft
            isVerifiedPublisher    = $isVerifiedPublisher
            verifiedPublisherName  = $verifiedPublisherName
            principalId            = $principalId
            consentType            = $consentType
            isAdminConsent         = $isAdminConsent
            scope                  = $scope
            scopes                 = $scopes
            scopeCount             = $scopes.Count
            highRiskScopes         = $highRiskScopes
            mediumRiskScopes       = $mediumRiskScopes
            riskLevel              = $riskLevel
            expiryTime             = $grant.expiryTime
            startTime              = $grant.startTime
            flags                  = $flags
        }

        $processedGrants += $processedGrant
        $grantCount++
        $summary.totalGrants++
    }

    # Finalize summary
    $summary.uniqueAppCount = $summary.uniqueApps.Count
    $summary.uniqueUserCount = $summary.uniqueUsers.Count
    $summary.Remove('uniqueApps')
    $summary.Remove('uniqueUsers')

    # Convert risky scope breakdown to sorted array
    $summary.riskyScopeBreakdown = $summary.riskyScopeBreakdown.GetEnumerator() |
        Sort-Object Value -Descending |
        ForEach-Object { @{ scope = $_.Key; count = $_.Value } }

    # Sort by risk level (high first)
    $processedGrants = $processedGrants | Sort-Object -Property @{
        Expression = {
            switch ($_.riskLevel) {
                "high"   { 0 }
                "medium" { 1 }
                "low"    { 2 }
                default  { 3 }
            }
        }
    }, @{ Expression = "scopeCount"; Descending = $true }

    # Build insights
    $insights = @()

    if ($summary.highRiskGrants -gt 0) {
        $insights += @{
            id = "high-risk-grants"
            title = "High-Risk Permission Grants"
            severity = "critical"
            count = $summary.highRiskGrants
            description = "$($summary.highRiskGrants) OAuth grants include high-risk permissions like Mail.ReadWrite or Directory.ReadWrite.All."
            recommendedAction = "Review and revoke unnecessary high-risk permissions. These allow apps to read/write sensitive data."
        }
    }

    if ($summary.unverifiedPublisherGrants -gt 0) {
        $insights += @{
            id = "unverified-publishers"
            title = "Unverified Publisher Apps"
            severity = "warning"
            count = $summary.unverifiedPublisherGrants
            description = "$($summary.unverifiedPublisherGrants) third-party apps with consent are from unverified publishers."
            recommendedAction = "Review apps from unverified publishers. Consider revoking consent if not business-critical."
        }
    }

    $thirdPartyHighRisk = ($processedGrants | Where-Object { -not $_.isMicrosoft -and $_.riskLevel -eq "high" }).Count
    if ($thirdPartyHighRisk -gt 0) {
        $insights += @{
            id = "third-party-high-risk"
            title = "Third-Party Apps with High-Risk Access"
            severity = "critical"
            count = $thirdPartyHighRisk
            description = "$thirdPartyHighRisk non-Microsoft apps have high-risk permission grants."
            recommendedAction = "Prioritize review of third-party apps with high-risk permissions."
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        grants = $processedGrants
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $grantCount OAuth permission grants" -ForegroundColor Green
    if ($summary.highRiskGrants -gt 0) {
        Write-Host "    [!] $($summary.highRiskGrants) high-risk grants need review" -ForegroundColor Yellow
    }

    return New-CollectorResult -Success $true -Count $grantCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Authorization") {
        Write-Host "    [!] OAuth consent collection requires Directory.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        grants = @()
        summary = @{
            totalGrants = 0
            highRiskGrants = 0
            unverifiedPublisherGrants = 0
        }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
