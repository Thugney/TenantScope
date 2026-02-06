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
    [string]$OutputPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# LOCAL HELPER FUNCTIONS
# ============================================================================

function Get-CredentialStatus {
    <#
    .SYNOPSIS
        Returns credential status based on the nearest expiry across all credentials.
    .OUTPUTS
        String: expired, critical, warning, healthy, no-credentials, or unknown.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $DaysUntilExpiry
    )

    if ($null -eq $DaysUntilExpiry) {
        return "no-credentials"
    }

    if ($DaysUntilExpiry -lt 0)  { return "expired" }
    if ($DaysUntilExpiry -le 30) { return "critical" }
    if ($DaysUntilExpiry -le 90) { return "warning" }
    return "healthy"
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$appCount = 0

try {
    Write-Host "    Collecting enterprise applications..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Retrieve app registrations (contains credential info)
    # -----------------------------------------------------------------------
    $appRegistrations = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgApplication -All -Property Id, AppId, DisplayName, PasswordCredentials, KeyCredentials, CreatedDateTime, SignInAudience
    } -OperationName "App registration retrieval"

    Write-Host "      Retrieved $($appRegistrations.Count) app registrations" -ForegroundColor Gray

    # Build lookup by AppId for credential cross-reference
    $appRegLookup = @{}
    foreach ($app in $appRegistrations) {
        $appRegLookup[$app.AppId] = $app
    }

    # -----------------------------------------------------------------------
    # 2. Retrieve service principals (enterprise apps)
    # -----------------------------------------------------------------------
    $servicePrincipals = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgServicePrincipal -All -Property Id, AppId, DisplayName, AccountEnabled, AppOwnerOrganizationId, CreatedDateTime, PublisherName, ServicePrincipalType, Tags, ReplyUrls, LoginUrl
    } -OperationName "Service principal retrieval"

    Write-Host "      Retrieved $($servicePrincipals.Count) service principals" -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 3. Process each service principal
    # -----------------------------------------------------------------------
    $processedApps = @()

    foreach ($sp in $servicePrincipals) {
        # Determine if first-party (Microsoft) or third-party
        # Microsoft's tenant ID for first-party apps
        $isMicrosoft = $false
        if ($sp.AppOwnerOrganizationId -eq "f8cdef31-a31e-4b4a-93e4-5f571e91255a" -or
            $sp.PublisherName -match "^Microsoft") {
            $isMicrosoft = $true
        }

        $publisher = if ($isMicrosoft) { "Microsoft" }
                     elseif ($sp.PublisherName) { $sp.PublisherName }
                     else { "Unknown" }

        # Get credential info from app registration
        $secrets = @()
        $certificates = @()
        $nearestExpiryDays = $null

        if ($appRegLookup.ContainsKey($sp.AppId)) {
            $appReg = $appRegLookup[$sp.AppId]

            # Process password credentials (client secrets)
            foreach ($secret in $appReg.PasswordCredentials) {
                $daysUntil = Get-DaysUntilDate -DateValue $secret.EndDateTime
                $secrets += @{
                    displayName = $secret.DisplayName
                    endDateTime = if ($secret.EndDateTime) { $secret.EndDateTime.ToString("o") } else { $null }
                    daysUntilExpiry = $daysUntil
                }
                if ($null -ne $daysUntil) {
                    if ($null -eq $nearestExpiryDays -or $daysUntil -lt $nearestExpiryDays) {
                        $nearestExpiryDays = $daysUntil
                    }
                }
            }

            # Process key credentials (certificates)
            foreach ($cert in $appReg.KeyCredentials) {
                $daysUntil = Get-DaysUntilDate -DateValue $cert.EndDateTime
                $certificates += @{
                    displayName = $cert.DisplayName
                    endDateTime = if ($cert.EndDateTime) { $cert.EndDateTime.ToString("o") } else { $null }
                    daysUntilExpiry = $daysUntil
                    type = $cert.Type
                }
                if ($null -ne $daysUntil) {
                    if ($null -eq $nearestExpiryDays -or $daysUntil -lt $nearestExpiryDays) {
                        $nearestExpiryDays = $daysUntil
                    }
                }
            }
        }

        # Determine credential status
        $credentialStatus = Get-CredentialStatus -DaysUntilExpiry $nearestExpiryDays
        $hasCredentials = ($secrets.Count -gt 0 -or $certificates.Count -gt 0)

        # Map service principal type
        $appType = switch ($sp.ServicePrincipalType) {
            "Application"       { "application" }
            "ManagedIdentity"   { "managed-identity" }
            "Legacy"            { "legacy" }
            "SocialIdp"         { "social-idp" }
            default             { "other" }
        }

        # Build output object
        $processedApp = [PSCustomObject]@{
            id                  = $sp.Id
            appId               = $sp.AppId
            displayName         = $sp.DisplayName
            accountEnabled      = [bool]$sp.AccountEnabled
            publisher           = $publisher
            isMicrosoft         = $isMicrosoft
            appType             = $appType
            createdDateTime     = if ($sp.CreatedDateTime) { $sp.CreatedDateTime.ToString("o") } else { $null }
            hasCredentials      = $hasCredentials
            secretCount         = $secrets.Count
            certificateCount    = $certificates.Count
            nearestExpiryDays   = $nearestExpiryDays
            credentialStatus    = $credentialStatus
            secrets             = $secrets
            certificates        = $certificates
        }

        $processedApps += $processedApp
        $appCount++

        # Progress indicator
        if ($appCount % 100 -eq 0) {
            Write-Host "      Processed $appCount apps..." -ForegroundColor Gray
        }
    }

    # Sort: expired/critical first, then by nearest expiry
    $processedApps = $processedApps | Sort-Object -Property @{Expression = {
        switch ($_.credentialStatus) {
            "expired"         { 0 }
            "critical"        { 1 }
            "warning"         { 2 }
            "healthy"         { 3 }
            "no-credentials"  { 4 }
            default           { 5 }
        }
    }}, @{Expression = "nearestExpiryDays"; Ascending = $true}

    # Save data using shared utility
    Save-CollectorData -Data $processedApps -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $appCount enterprise apps" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $appCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Authorization") {
        Write-Host "    [!] Enterprise app collection requires Application.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
