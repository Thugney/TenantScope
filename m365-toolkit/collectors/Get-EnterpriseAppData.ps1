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
# HELPER FUNCTIONS
# ============================================================================

function Get-DaysUntilDate {
    <#
    .SYNOPSIS
        Calculates days from now until a given date. Returns negative for past dates.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $DateValue
    )

    if ($null -eq $DateValue) {
        return $null
    }

    try {
        $date = if ($DateValue -is [DateTime]) { $DateValue } else { [DateTime]::Parse($DateValue) }
        $days = ($date - (Get-Date)).Days
        return $days
    }
    catch {
        return $null
    }
}

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

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling.
    #>
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [int]$MaxRetries = 5,

        [Parameter()]
        [int]$BaseBackoffSeconds = 60
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests|Too many retries") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $BaseBackoffSeconds * [Math]::Pow(2, $attempt - 1)
                Write-Host "      Throttled. Waiting ${wait}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
            }
            else { throw }
        }
    }
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
    }

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
    }

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

    # Write results to JSON file
    $processedApps | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    Done - Collected $appCount enterprise apps" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $appCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Authorization") {
        Write-Host "    Warning: Enterprise app collection requires Application.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
