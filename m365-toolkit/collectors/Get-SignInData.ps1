# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
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

    # Reuse risk detections and risky users from SharedData (populated by Get-IdentityRiskData)
    # to avoid duplicate API calls. Falls back to fetching directly if SharedData not available.
    $riskDetections = @()
    $riskyUsers = @{}

    if ($SharedData -and $SharedData.ContainsKey('RiskDetections') -and $SharedData.ContainsKey('RiskyUsers')) {
        # Reuse data already fetched by Get-IdentityRiskData
        $riskDetections = @($SharedData['RiskDetections'])
        Write-Host "      Reusing $($riskDetections.Count) risk detections from shared data (no extra API call)" -ForegroundColor Gray

        $riskyUsersList = @($SharedData['RiskyUsers'])
        foreach ($ru in $riskyUsersList) {
            $ruId = if ($ru.Id) { $ru.Id } elseif ($ru.id) { $ru.id } else { $null }
            if ($ruId) { $riskyUsers[$ruId] = $ru }
        }
        Write-Host "      Reusing $($riskyUsersList.Count) risky users from shared data (no extra API call)" -ForegroundColor Gray
    }
    else {
        # Fallback: fetch from API if shared data not available
        try {
            $riskDetections = Invoke-GraphWithRetry -ScriptBlock {
                Get-MgRiskDetection -Filter "detectedDateTime ge $filterDate" -All
            } -OperationName "Risk detection retrieval"
            Write-Host "      Retrieved $($riskDetections.Count) risk detections" -ForegroundColor Gray
        }
        catch {
            if ($_.Exception.Message -match "license|subscription|P2|Premium") {
                Write-Host "      [!] Risk detections require Entra ID P2 license" -ForegroundColor Yellow
                $errors += "Risk detections require Entra ID P2 license"
            }
            else {
                Write-Host "      [!] Could not retrieve risk detections: $($_.Exception.Message)" -ForegroundColor Yellow
                $errors += "Risk detections error: $($_.Exception.Message)"
            }
        }

        # Pause before next API call to avoid throttling
        Start-Sleep -Seconds 10

        try {
            $riskyUserList = Invoke-GraphWithRetry -ScriptBlock {
                Get-MgRiskyUser -All
            } -OperationName "Risky user retrieval"
            foreach ($ru in $riskyUserList) {
                $riskyUsers[$ru.Id] = $ru
            }
            Write-Host "      Retrieved $($riskyUserList.Count) risky users" -ForegroundColor Gray
        }
        catch {
            Write-Host "      [!] Could not retrieve risky users: $($_.Exception.Message)" -ForegroundColor Yellow
        }
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

    # Save data using shared utility
    Save-CollectorData -Data $processedRisks -OutputPath $OutputPath | Out-Null

    # Determine success - partial success if we have errors but some data
    $success = $true
    if ($errors.Count -gt 0 -and $riskCount -eq 0) {
        $success = $false
    }

    Write-Host "    [OK] Collected $riskCount risk detections" -ForegroundColor Green

    return New-CollectorResult -Success $success -Count $riskCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing issue
    if ($errorMessage -match "license|subscription|P2|Premium|not available|feature") {
        Write-Host "    [!] Identity Protection requires Entra ID P2 license" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
