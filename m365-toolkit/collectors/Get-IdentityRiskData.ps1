# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Identity Protection risk data from Microsoft Graph.

.DESCRIPTION
    Retrieves risky users, risk detections, and risk history for security analysis.
    This is CRITICAL for detecting compromised accounts and active threats.

    Collects:
    - Risky users with risk level and state
    - Risk detections (what triggered the risk)
    - User risk history
    - Risk aggregation by type and location

    Graph API endpoints:
    - GET /identityProtection/riskyUsers
    - GET /identityProtection/riskDetections
    - GET /identityProtection/riskyUsers/{id}/history

    Required scopes:
    - IdentityRiskEvent.Read.All
    - IdentityRiskyUser.Read.All

    Note: Requires Entra ID P2 license for full functionality.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes identity-risk-data.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-IdentityRiskData.ps1 -Config $config -OutputPath ".\data\identity-risk-data.json"
#>

#Requires -Version 7.0

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
# RISK TYPE CLASSIFICATIONS
# ============================================================================

$CriticalRiskTypes = @(
    "leakedCredentials",
    "malwareInfectedIPAddress",
    "mcasImpossibleTravel",
    "newCountry",
    "passwordSpray",
    "riskyIPAddress",
    "suspiciousInboxForwardingRules",
    "tokenIssuerAnomaly"
)

$HighRiskTypes = @(
    "anonymizedIPAddress",
    "unfamiliarFeatures",
    "maliciousIPAddress",
    "suspiciousBrowser",
    "impossibleTravel",
    "suspiciousIPAddress"
)

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$riskyUserCount = 0

# Get risk detection lookback days from config or default to 30
$riskDays = if ($Config.collection.riskDetectionDays) {
    $Config.collection.riskDetectionDays
} else { 30 }

try {
    Write-Host "    Collecting Identity Protection risk data..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Get risky users
    # -----------------------------------------------------------------------
    $riskyUsers = @()
    try {
        Write-Host "      Fetching risky users..." -ForegroundColor Gray

        $riskyUsersResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/identityProtection/riskyUsers?`$top=500" `
                -OutputType PSObject
        } -OperationName "Risky users retrieval"

        if ($riskyUsersResponse.value) {
            $riskyUsers = @($riskyUsersResponse.value)
        }

        # Handle pagination
        while ($riskyUsersResponse.'@odata.nextLink') {
            $riskyUsersResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $riskyUsersResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Risky users pagination"
            if ($riskyUsersResponse.value) {
                $riskyUsers += $riskyUsersResponse.value
            }
        }

        Write-Host "      Retrieved $($riskyUsers.Count) risky users" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Could not retrieve risky users: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Risky users: $($_.Exception.Message)"
    }

    # -----------------------------------------------------------------------
    # 2. Get risk detections (last 30 days by default)
    # -----------------------------------------------------------------------
    $riskDetections = @()
    try {
        Write-Host "      Fetching risk detections..." -ForegroundColor Gray

        $cutoffDate = (Get-Date).AddDays(-$riskDays).ToString("yyyy-MM-ddTHH:mm:ssZ")

        $detectionsResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/identityProtection/riskDetections?`$filter=detectedDateTime ge $cutoffDate&`$top=500&`$orderby=detectedDateTime desc" `
                -OutputType PSObject
        } -OperationName "Risk detections retrieval"

        if ($detectionsResponse.value) {
            $riskDetections = @($detectionsResponse.value)
        }

        # Handle pagination (limit to 2000 detections for performance)
        $pageCount = 1
        while ($detectionsResponse.'@odata.nextLink' -and $pageCount -lt 4) {
            $detectionsResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $detectionsResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Risk detections pagination"
            if ($detectionsResponse.value) {
                $riskDetections += $detectionsResponse.value
            }
            $pageCount++
        }

        Write-Host "      Retrieved $($riskDetections.Count) risk detections" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Could not retrieve risk detections: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Risk detections: $($_.Exception.Message)"
    }

    # Share risky users and risk detections with downstream collectors (Get-SignInData)
    # so they don't need to re-fetch from the API
    if ($SharedData -is [hashtable]) {
        $SharedData['RiskyUsers'] = $riskyUsers
        $SharedData['RiskDetections'] = $riskDetections
    }

    # -----------------------------------------------------------------------
    # 3. Process risky users
    # -----------------------------------------------------------------------
    $processedUsers = @()
    $summary = @{
        totalRiskyUsers = 0
        highRiskUsers = 0
        mediumRiskUsers = 0
        lowRiskUsers = 0
        atRiskUsers = 0
        confirmedCompromised = 0
        dismissedUsers = 0
        remediatedUsers = 0
        totalDetections = 0
        detectionsByType = @{}
        detectionsByLocation = @{}
        recentDetections24h = 0
        recentDetections7d = 0
    }

    foreach ($user in $riskyUsers) {
        $userId = $user.id
        $userPrincipalName = $user.userPrincipalName
        $userDisplayName = $user.userDisplayName
        $riskLevel = $user.riskLevel
        $riskState = $user.riskState
        $riskDetail = $user.riskDetail
        $riskLastUpdatedDateTime = $user.riskLastUpdatedDateTime
        $isDeleted = $user.isDeleted
        $isProcessing = $user.isProcessing

        # Count by risk level
        switch ($riskLevel) {
            "high" { $summary.highRiskUsers++ }
            "medium" { $summary.mediumRiskUsers++ }
            "low" { $summary.lowRiskUsers++ }
        }

        # Count by risk state
        switch ($riskState) {
            "atRisk" { $summary.atRiskUsers++ }
            "confirmedCompromised" { $summary.confirmedCompromised++ }
            "dismissed" { $summary.dismissedUsers++ }
            "remediated" { $summary.remediatedUsers++ }
        }

        # Get user's risk detections
        $userDetections = @($riskDetections | Where-Object { $_.userId -eq $userId })
        $userDetectionTypes = @($userDetections | ForEach-Object { $_.riskEventType } | Sort-Object -Unique)

        # Determine if critical risk types present
        $hasCriticalRisk = $false
        $hasHighRisk = $false
        foreach ($det in $userDetectionTypes) {
            if ($CriticalRiskTypes -contains $det) { $hasCriticalRisk = $true }
            if ($HighRiskTypes -contains $det) { $hasHighRisk = $true }
        }

        # Build flags
        $flags = @()
        if ($riskLevel -eq "high") { $flags += "high-risk" }
        if ($riskState -eq "atRisk") { $flags += "at-risk" }
        if ($riskState -eq "confirmedCompromised") { $flags += "compromised" }
        if ($hasCriticalRisk) { $flags += "critical-detection" }
        if ($isProcessing) { $flags += "processing" }
        if ($userDetections.Count -gt 5) { $flags += "multiple-detections" }

        $processedUser = [PSCustomObject]@{
            id                       = $userId
            userId                   = $userId  # Also expose as userId for dashboard compatibility
            userPrincipalName        = $userPrincipalName
            userDisplayName          = $userDisplayName
            riskLevel                = $riskLevel
            riskState                = $riskState
            riskDetail               = $riskDetail
            riskLastUpdatedDateTime  = $riskLastUpdatedDateTime
            isDeleted                = [bool]$isDeleted
            isProcessing             = [bool]$isProcessing
            detectionCount           = $userDetections.Count
            detectionTypes           = $userDetectionTypes
            hasCriticalRisk          = $hasCriticalRisk
            hasHighRisk              = $hasHighRisk
            flags                    = $flags
        }

        $processedUsers += $processedUser
        $riskyUserCount++
        $summary.totalRiskyUsers++
    }

    # -----------------------------------------------------------------------
    # 4. Process risk detections for analytics
    # -----------------------------------------------------------------------
    $processedDetections = @()
    $now = Get-Date

    foreach ($detection in $riskDetections) {
        $riskEventType = $detection.riskEventType
        $riskLevel = $detection.riskLevel
        $detectedDateTime = $detection.detectedDateTime
        $location = $detection.location

        # Track detection types
        if (-not $summary.detectionsByType.ContainsKey($riskEventType)) {
            $summary.detectionsByType[$riskEventType] = 0
        }
        $summary.detectionsByType[$riskEventType]++

        # Track locations (country level)
        $country = if ($location -and $location.countryOrRegion) { $location.countryOrRegion } else { "Unknown" }
        if (-not $summary.detectionsByLocation.ContainsKey($country)) {
            $summary.detectionsByLocation[$country] = 0
        }
        $summary.detectionsByLocation[$country]++

        # Recent detection counts
        if ($detectedDateTime) {
            $detectionDate = [DateTime]$detectedDateTime
            $daysSince = ($now - $detectionDate).TotalDays
            if ($daysSince -le 1) { $summary.recentDetections24h++ }
            if ($daysSince -le 7) { $summary.recentDetections7d++ }
        }

        # Determine severity
        $severity = "low"
        if ($CriticalRiskTypes -contains $riskEventType) {
            $severity = "critical"
        }
        elseif ($HighRiskTypes -contains $riskEventType -or $riskLevel -eq "high") {
            $severity = "high"
        }
        elseif ($riskLevel -eq "medium") {
            $severity = "medium"
        }

        $processedDetection = [PSCustomObject]@{
            id                    = $detection.id
            userId                = $detection.userId
            userPrincipalName     = $detection.userPrincipalName
            userDisplayName       = $detection.userDisplayName
            riskEventType         = $riskEventType
            riskLevel             = $riskLevel
            riskState             = $detection.riskState
            riskDetail            = $detection.riskDetail
            severity              = $severity
            detectedDateTime      = $detectedDateTime
            lastUpdatedDateTime   = $detection.lastUpdatedDateTime
            ipAddress             = $detection.ipAddress
            location              = @{
                city             = $location.city
                state            = $location.state
                countryOrRegion  = $country
            }
            source                = $detection.source
            detectionTimingType   = $detection.detectionTimingType
            activity              = $detection.activity
            tokenIssuerType       = $detection.tokenIssuerType
            additionalInfo        = $detection.additionalInfo
        }

        $processedDetections += $processedDetection
        $summary.totalDetections++
    }

    # Convert detection type counts to sorted array
    $summary.detectionsByType = $summary.detectionsByType.GetEnumerator() |
        Sort-Object Value -Descending |
        ForEach-Object { @{ type = $_.Key; count = $_.Value } }

    # Convert location counts to sorted array (top 10)
    $summary.detectionsByLocation = $summary.detectionsByLocation.GetEnumerator() |
        Sort-Object Value -Descending |
        Select-Object -First 10 |
        ForEach-Object { @{ country = $_.Key; count = $_.Value } }

    # Sort users by risk level
    $processedUsers = $processedUsers | Sort-Object -Property @{
        Expression = {
            switch ($_.riskLevel) {
                "high"   { 0 }
                "medium" { 1 }
                "low"    { 2 }
                default  { 3 }
            }
        }
    }, @{ Expression = "detectionCount"; Descending = $true }

    # Sort detections by date (most recent first)
    $processedDetections = $processedDetections | Sort-Object -Property detectedDateTime -Descending

    # -----------------------------------------------------------------------
    # 5. Build insights
    # -----------------------------------------------------------------------
    $insights = @()

    if ($summary.highRiskUsers -gt 0) {
        $insights += @{
            id = "high-risk-users"
            title = "High-Risk Users Detected"
            severity = "critical"
            count = $summary.highRiskUsers
            description = "$($summary.highRiskUsers) users are flagged as high risk by Identity Protection."
            recommendedAction = "Immediately investigate high-risk users. Consider requiring password reset and MFA re-registration."
        }
    }

    if ($summary.confirmedCompromised -gt 0) {
        $insights += @{
            id = "confirmed-compromised"
            title = "Confirmed Compromised Accounts"
            severity = "critical"
            count = $summary.confirmedCompromised
            description = "$($summary.confirmedCompromised) accounts are confirmed compromised and need immediate attention."
            recommendedAction = "Reset passwords, revoke sessions, and investigate activity for confirmed compromised accounts."
        }
    }

    if ($summary.recentDetections24h -gt 10) {
        $insights += @{
            id = "recent-detections-spike"
            title = "High Detection Activity (24h)"
            severity = "warning"
            count = $summary.recentDetections24h
            description = "$($summary.recentDetections24h) risk detections in the last 24 hours indicates elevated threat activity."
            recommendedAction = "Monitor for active attacks. Consider enabling stricter Conditional Access policies temporarily."
        }
    }

    $leakedCredCount = ($processedDetections | Where-Object { $_.riskEventType -eq "leakedCredentials" }).Count
    if ($leakedCredCount -gt 0) {
        $insights += @{
            id = "leaked-credentials"
            title = "Leaked Credentials Detected"
            severity = "critical"
            count = $leakedCredCount
            description = "$leakedCredCount detections involve leaked credentials found on the dark web or breach databases."
            recommendedAction = "Force password reset for affected users immediately."
        }
    }

    $passwordSprayCount = ($processedDetections | Where-Object { $_.riskEventType -eq "passwordSpray" }).Count
    if ($passwordSprayCount -gt 0) {
        $insights += @{
            id = "password-spray-attack"
            title = "Password Spray Attack Detected"
            severity = "critical"
            count = $passwordSprayCount
            description = "$passwordSprayCount password spray detections indicate an active brute-force attack."
            recommendedAction = "Review affected accounts, block suspicious IPs, and ensure MFA is enabled."
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        riskyUsers = $processedUsers
        riskDetections = $processedDetections
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
        apiNote = "Risk data requires Entra ID P2 license. Detection history limited to $riskDays days."
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $riskyUserCount risky users, $($summary.totalDetections) detections" -ForegroundColor Green
    if ($summary.highRiskUsers -gt 0) {
        Write-Host "    [!] $($summary.highRiskUsers) high-risk users need immediate attention" -ForegroundColor Yellow
    }

    return New-CollectorResult -Success $true -Count $riskyUserCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Premium|P2") {
        Write-Host "    [!] Identity Protection requires Entra ID P2 and IdentityRiskEvent.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        riskyUsers = @()
        riskDetections = @()
        summary = @{
            totalRiskyUsers = 0
            highRiskUsers = 0
            totalDetections = 0
        }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
