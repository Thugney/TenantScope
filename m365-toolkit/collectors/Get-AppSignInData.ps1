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
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# LOCAL HELPER FUNCTIONS
# ============================================================================

function Invoke-SignInGraphRequest {
    <#
    .SYNOPSIS
        Executes a sign-in log Graph API call with retry and skip token handling.
        This is a local variant that handles pagination token expiry gracefully.
    #>
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

    # Reuse sign-in logs from SharedData (populated by Get-SignInLogs) to avoid
    # a duplicate API call. Falls back to fetching directly if SharedData not available.
    $processedSignIns = @()

    if ($SharedData -and $SharedData.ContainsKey('SignInLogs') -and $SharedData['SignInLogs'].Count -gt 0) {
        Write-Host "      Reusing $($SharedData['SignInLogs'].Count) sign-in logs from shared data (no extra API call)" -ForegroundColor Gray

        foreach ($signIn in $SharedData['SignInLogs']) {
            $statusCode = 0
            $statusReason = "Success"
            if ($signIn.errorCode) {
                $statusCode = $signIn.errorCode
                if ($signIn.failureReason) {
                    $statusReason = $signIn.failureReason
                }
                elseif ($statusCode -ne 0) {
                    $statusReason = "Error $statusCode"
                }
            }

            $processedSignIn = [PSCustomObject]@{
                appDisplayName       = $signIn.appDisplayName
                resourceDisplayName  = $null
                userPrincipalName    = $signIn.userPrincipalName
                createdDateTime      = $signIn.createdDateTime
                isInteractive        = [bool]$signIn.isInteractive
                statusCode           = $statusCode
                statusReason         = $statusReason
                city                 = $signIn.city
                country              = $signIn.country
            }

            $processedSignIns += $processedSignIn
            $signInCount++
        }
    }
    else {
        # Fallback: fetch from API if shared data not available
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

        $pageCount = 0
        $maxPages = 20  # Limit to avoid very long runs (500 * 20 = 10,000 records max)

        do {
            $pageCount++
            $response = Invoke-SignInGraphRequest -Uri $uri

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
                    elseif ($statusCode -ne 0) {
                        $statusReason = "Error $statusCode"
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
    }

    # Save data using shared utility
    Save-CollectorData -Data $processedSignIns -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $signInCount sign-in records" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $signInCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
