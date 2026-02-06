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

    Uses manual pagination to avoid skip token expiration issues on large tenants.

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
#Requires -Modules Microsoft.Graph.Authentication

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
        [string]$Uri,

        [Parameter()]
        [int]$MaxRetries = 5,

        [Parameter()]
        [int]$BaseBackoffSeconds = 30
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputType PSObject
        }
        catch {
            $errorMsg = $_.Exception.Message

            # Handle throttling
            if ($errorMsg -match "429|throttl|TooManyRequests") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $BaseBackoffSeconds * $attempt
                Write-Host "      Throttled. Waiting ${wait}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
                continue
            }

            # Handle skip token errors - just stop pagination, return what we have
            if ($errorMsg -match "Skip token is null|skiptoken") {
                Write-Host "      Pagination token expired - returning collected data" -ForegroundColor Yellow
                return $null
            }

            throw
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

    # Collect sign-ins from the last N days (configurable)
    $daysBack = 30
    if ($Config.collection -and $Config.collection.signInLogDays) {
        $daysBack = $Config.collection.signInLogDays
    }
    $startDate = (Get-Date).AddDays(-$daysBack).ToString("yyyy-MM-ddTHH:mm:ssZ")

    # Build initial URI with filter and select for efficiency
    $baseUri = "https://graph.microsoft.com/v1.0/auditLogs/signIns"
    $filter = "createdDateTime ge $startDate"
    $select = "appDisplayName,resourceDisplayName,userPrincipalName,createdDateTime,isInteractive,status,location"
    $uri = "$baseUri`?`$filter=$filter&`$select=$select&`$top=500"

    $processedSignIns = @()
    $pageCount = 0
    $maxPages = 20  # Limit to avoid very long runs (500 * 20 = 10,000 records max)

    do {
        $pageCount++
        $response = Invoke-GraphWithRetry -Uri $uri

        # If pagination failed, stop but keep what we have
        if ($null -eq $response) {
            Write-Host "      Stopping pagination early - collected $signInCount records" -ForegroundColor Yellow
            break
        }

        $signIns = $response.value
        if (-not $signIns -or $signIns.Count -eq 0) {
            break
        }

        foreach ($signIn in $signIns) {
            $statusCode = 0
            $statusReason = "Success"
            if ($signIn.status) {
                $statusCode = $signIn.status.errorCode
                if ($signIn.status.failureReason) {
                    $statusReason = $signIn.status.failureReason
                }
            }

            $city = $null
            $country = $null
            if ($signIn.location) {
                $city = $signIn.location.city
                $country = $signIn.location.countryOrRegion
            }

            $processedSignIn = [PSCustomObject]@{
                appDisplayName       = $signIn.appDisplayName
                resourceDisplayName  = $signIn.resourceDisplayName
                userPrincipalName    = $signIn.userPrincipalName
                createdDateTime      = $signIn.createdDateTime
                isInteractive        = [bool]$signIn.isInteractive
                statusCode           = $statusCode
                statusReason         = $statusReason
                city                 = $city
                country              = $country
            }

            $processedSignIns += $processedSignIn
            $signInCount++
        }

        Write-Host "      Page $pageCount`: $signInCount sign-ins collected..." -ForegroundColor Gray

        # Get next page
        $uri = $response.'@odata.nextLink'

        # Safety limit
        if ($pageCount -ge $maxPages) {
            Write-Host "      Reached page limit ($maxPages) - stopping collection" -ForegroundColor Yellow
            break
        }

    } while ($uri)

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
