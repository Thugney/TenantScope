# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects risky sign-in and risk detection data from Entra ID Identity Protection.

.DESCRIPTION
    Retrieves risky users and risk detection events from Microsoft Entra ID
    Identity Protection. Categorizes risks by level and state. Requires
    Entra ID P2 license for full functionality.

    Graph API endpoints:
    - GET /identityProtection/riskyUsers
    - GET /identityProtection/riskDetections

    Required scopes: IdentityRiskyUser.Read.All, IdentityRiskEvent.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes risky-signins.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of risk events collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-SignInData.ps1 -Config $config -OutputPath ".\data\risky-signins.json"
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
# HELPER FUNCTIONS
# ============================================================================

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling.
    #>
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [int]$MaxRetries = 3,

        [Parameter()]
        [int]$DefaultBackoffSeconds = 30
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $DefaultBackoffSeconds * $attempt
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
$riskCount = 0

try {
    Write-Host "    Collecting risk detection data..." -ForegroundColor Gray

    # Calculate date filter based on config
    $daysBack = $Config.collection.signInLogDays
    if ($null -eq $daysBack -or $daysBack -le 0) {
        $daysBack = 30
    }
    $filterDate = (Get-Date).AddDays(-$daysBack).ToString("yyyy-MM-ddTHH:mm:ssZ")

    Write-Host "      Filtering to last $daysBack days (since $filterDate)" -ForegroundColor Gray

    # Try to get risk detections
    $riskDetections = @()

    try {
        # Get risk detections within the configured time window
        $riskDetections = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgRiskDetection -Filter "detectedDateTime ge $filterDate" -All
        }
        Write-Host "      Retrieved $($riskDetections.Count) risk detections" -ForegroundColor Gray
    }
    catch {
        if ($_.Exception.Message -match "license|subscription|P2|Premium") {
            Write-Host "      ⚠ Risk detections require Entra ID P2 license" -ForegroundColor Yellow
            $errors += "Risk detections require Entra ID P2 license"
        }
        else {
            Write-Host "      ⚠ Could not retrieve risk detections: $($_.Exception.Message)" -ForegroundColor Yellow
            $errors += "Risk detections error: $($_.Exception.Message)"
        }
    }

    # Also try to get risky users for additional context
    $riskyUsers = @{}
    try {
        $riskyUserList = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgRiskyUser -All
        }
        foreach ($ru in $riskyUserList) {
            $riskyUsers[$ru.Id] = $ru
        }
        Write-Host "      Retrieved $($riskyUserList.Count) risky users" -ForegroundColor Gray
    }
    catch {
        Write-Host "      ⚠ Could not retrieve risky users: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # Process risk detections
    $processedRisks = @()

    foreach ($detection in $riskDetections) {
        # Extract location information
        $location = @{
            city            = $null
            countryOrRegion = $null
        }

        if ($detection.Location) {
            $location.city = $detection.Location.City
            $location.countryOrRegion = $detection.Location.CountryOrRegion
        }

        # Build output object matching our schema
        $riskRecord = [PSCustomObject]@{
            id                  = $detection.Id
            userId              = $detection.UserId
            userPrincipalName   = $detection.UserPrincipalName
            riskLevel           = $detection.RiskLevel
            riskState           = $detection.RiskState
            riskDetail          = $detection.RiskDetail
            detectedDateTime    = if ($detection.DetectedDateTime) { $detection.DetectedDateTime.ToString("o") } else { $null }
            location            = $location
            ipAddress           = $detection.IpAddress
            appDisplayName      = $detection.AdditionalProperties.appDisplayName
        }

        # Try to get app name from activity if not in AdditionalProperties
        if ([string]::IsNullOrEmpty($riskRecord.appDisplayName) -and $detection.Activity) {
            $riskRecord.appDisplayName = $detection.Activity
        }

        $processedRisks += $riskRecord
        $riskCount++
    }

    # Sort by detected date descending (most recent first)
    $processedRisks = $processedRisks | Sort-Object -Property detectedDateTime -Descending

    # Write results to JSON file
    $processedRisks | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    # Determine success - partial success if we have errors but some data
    $success = $true
    if ($errors.Count -gt 0 -and $riskCount -eq 0) {
        $success = $false
    }

    Write-Host "    ✓ Collected $riskCount risk detections" -ForegroundColor Green

    return @{
        Success = $success
        Count   = $riskCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing issue
    if ($errorMessage -match "license|subscription|P2|Premium|not available|feature") {
        Write-Host "    ⚠ Identity Protection requires Entra ID P2 license" -ForegroundColor Yellow
    }

    Write-Host "    ✗ Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
