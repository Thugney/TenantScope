# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects application sign-in data from Entra ID audit logs.

.DESCRIPTION
    Retrieves sign-in logs from the /auditLogs/signIns endpoint to track which
    applications users authenticate to, enabling application usage analytics.
    Requires Entra ID P1 license and AuditLog.Read.All permission.

    Graph API endpoint: GET /auditLogs/signIns
    Required scopes: AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes app-signins.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of sign-in records collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-AppSignInData.ps1 -Config $config -OutputPath ".\data\app-signins.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Reports

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Invoke-GraphWithRetry {
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
$signInCount = 0

try {
    Write-Host "    Collecting application sign-in data..." -ForegroundColor Gray

    # Collect sign-ins from the last 30 days (configurable)
    $daysBack = 30
    if ($Config.thresholds -and $Config.thresholds.signInDaysBack) {
        $daysBack = $Config.thresholds.signInDaysBack
    }
    $startDate = (Get-Date).AddDays(-$daysBack).ToString("yyyy-MM-ddTHH:mm:ssZ")

    # Retrieve sign-in logs with pagination
    $signIns = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgAuditLogSignIn -All -Filter "createdDateTime ge $startDate" `
            -Property "appDisplayName,resourceDisplayName,userPrincipalName,createdDateTime,isInteractive,status,location"
    }

    Write-Host "      Retrieved $($signIns.Count) sign-in records" -ForegroundColor Gray

    # Transform to output schema
    $processedSignIns = @()

    foreach ($signIn in $signIns) {
        $statusCode = 0
        $statusReason = "Success"
        if ($signIn.Status) {
            $statusCode = $signIn.Status.ErrorCode
            if ($signIn.Status.FailureReason) {
                $statusReason = $signIn.Status.FailureReason
            }
        }

        $city = $null
        $country = $null
        if ($signIn.Location) {
            $city = $signIn.Location.City
            $country = $signIn.Location.CountryOrRegion
        }

        $processedSignIn = [PSCustomObject]@{
            appDisplayName       = $signIn.AppDisplayName
            resourceDisplayName  = $signIn.ResourceDisplayName
            userPrincipalName    = $signIn.UserPrincipalName
            createdDateTime      = if ($signIn.CreatedDateTime) { $signIn.CreatedDateTime.ToString("o") } else { $null }
            isInteractive        = [bool]$signIn.IsInteractive
            statusCode           = $statusCode
            statusReason         = $statusReason
            city                 = $city
            country              = $country
        }

        $processedSignIns += $processedSignIn
        $signInCount++

        if ($signInCount % 500 -eq 0) {
            Write-Host "      Processed $signInCount sign-ins..." -ForegroundColor Gray
        }
    }

    # Write results
    $processedSignIns | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    Collected $signInCount sign-in records" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $signInCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    Failed: $errorMessage" -ForegroundColor Red

    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
