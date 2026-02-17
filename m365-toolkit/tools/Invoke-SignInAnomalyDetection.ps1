# ============================================================================
# TenantScope - Sign-In Anomaly Detection
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Detects sign-in anomalies from collected Microsoft 365 sign-in log data.

.DESCRIPTION
    Analyzes sign-in logs to identify suspicious authentication patterns:

    1. Impossible Travel - Two successive sign-ins from locations that would
       require faster-than-possible travel speed (Haversine distance / time gap)
    2. Brute Force - Excessive failed sign-in attempts from same IP within a
       one-hour sliding window
    3. Legacy Auth Usage - Sign-ins using legacy authentication protocols that
       bypass MFA (Exchange ActiveSync, IMAP4, POP3, SMTP, etc.)
    4. Unusual Hours - Sign-ins between 01:00-05:00 for users who do not
       normally authenticate during those hours
    5. New Country - First-time sign-in from a country not previously seen
       for that user
    6. Token Replay - Multiple sign-ins sharing the same correlationId but
       originating from different IP addresses

    Reads sign-in data from pre-collected JSON files (signin-logs.json and
    risky-signins.json) rather than calling Graph API directly.

    Generates JSON results and an HTML report with dark theme.

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ../data/signin-anomalies/.

.PARAMETER ImpossibleTravelSpeedKmh
    Maximum plausible travel speed in km/h. Sign-ins requiring faster travel
    are flagged as impossible travel. Default: 900 (roughly commercial aviation).

.PARAMETER BruteForceThreshold
    Number of failed sign-in attempts from the same IP within one hour before
    flagging as brute force. Default: 10.

.PARAMETER AnalysisWindowHours
    Number of hours of sign-in data to analyze. Default: 168 (7 days).

.EXAMPLE
    .\tools\Invoke-SignInAnomalyDetection.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-SignInAnomalyDetection.ps1 -Config $config -ImpossibleTravelSpeedKmh 500 -BruteForceThreshold 5

.EXAMPLE
    .\tools\Invoke-SignInAnomalyDetection.ps1 -OutputPath "C:\Reports\anomalies" -AnalysisWindowHours 72

.NOTES
    Version: 1.0.0
    Read-only detection and reporting tool.
    Requires pre-collected signin-logs.json in the dashboard/data directory.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [int]$ImpossibleTravelSpeedKmh = 900,

    [Parameter()]
    [int]$BruteForceThreshold = 10,

    [Parameter()]
    [int]$AnalysisWindowHours = 168
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\signin-anomalies"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

$dashboardDataPath = Join-Path $PSScriptRoot "..\dashboard\data"
$fallbackDataPath = Join-Path $PSScriptRoot "..\data"

# Severity mapping
$SeverityMap = @{
    "impossible-travel" = "critical"
    "brute-force"       = "high"
    "token-replay"      = "critical"
    "legacy-auth"       = "high"
    "new-country"       = "medium"
    "unusual-hours"     = "low"
}

# Severity ranking for comparison
$SeverityRank = @{
    "critical" = 4
    "high"     = 3
    "medium"   = 2
    "low"      = 1
}

# Legacy authentication client apps
$LegacyAuthClients = @(
    "Exchange ActiveSync",
    "IMAP4",
    "POP3",
    "SMTP",
    "Other clients",
    "Authenticated SMTP"
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-HaversineDistance {
    <#
    .SYNOPSIS
        Calculates the great-circle distance between two points on Earth
        using the Haversine formula.

    .PARAMETER Lat1
        Latitude of the first point in degrees.

    .PARAMETER Lon1
        Longitude of the first point in degrees.

    .PARAMETER Lat2
        Latitude of the second point in degrees.

    .PARAMETER Lon2
        Longitude of the second point in degrees.

    .OUTPUTS
        Distance in kilometers.

    .EXAMPLE
        Get-HaversineDistance -Lat1 40.7128 -Lon1 -74.0060 -Lat2 51.5074 -Lon2 -0.1278
        # Returns ~5570 km (New York to London)
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [double]$Lat1,

        [Parameter(Mandatory)]
        [double]$Lon1,

        [Parameter(Mandatory)]
        [double]$Lat2,

        [Parameter(Mandatory)]
        [double]$Lon2
    )

    $earthRadiusKm = 6371.0

    $dLat = ([Math]::PI / 180.0) * ($Lat2 - $Lat1)
    $dLon = ([Math]::PI / 180.0) * ($Lon2 - $Lon1)

    $lat1Rad = ([Math]::PI / 180.0) * $Lat1
    $lat2Rad = ([Math]::PI / 180.0) * $Lat2

    $a = [Math]::Sin($dLat / 2) * [Math]::Sin($dLat / 2) +
         [Math]::Cos($lat1Rad) * [Math]::Cos($lat2Rad) *
         [Math]::Sin($dLon / 2) * [Math]::Sin($dLon / 2)

    $c = 2 * [Math]::Atan2([Math]::Sqrt($a), [Math]::Sqrt(1 - $a))

    return $earthRadiusKm * $c
}

function Find-DataFile {
    <#
    .SYNOPSIS
        Locates a data file from dashboard/data with fallback to data directory.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$FileName
    )

    $primaryPath = Join-Path $dashboardDataPath $FileName
    if (Test-Path $primaryPath) {
        return $primaryPath
    }

    $fallbackPath = Join-Path $fallbackDataPath $FileName
    if (Test-Path $fallbackPath) {
        return $fallbackPath
    }

    return $null
}

function New-AnomalyRecord {
    <#
    .SYNOPSIS
        Creates a standardized anomaly record.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Type,

        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter(Mandatory)]
        [string]$UserPrincipalName,

        [Parameter(Mandatory)]
        [string]$Timestamp,

        [Parameter(Mandatory)]
        [hashtable]$Details,

        [Parameter(Mandatory)]
        [string]$Description
    )

    return [PSCustomObject]@{
        type              = $Type
        severity          = $SeverityMap[$Type]
        userId            = $UserId
        userPrincipalName = $UserPrincipalName
        timestamp         = $Timestamp
        details           = $Details
        description       = $Description
    }
}

function Get-HighestSeverity {
    <#
    .SYNOPSIS
        Returns the highest severity from a list of severity strings.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$Severities
    )

    $highest = "low"
    $highestRank = 0

    foreach ($sev in $Severities) {
        $rank = $SeverityRank[$sev]
        if ($rank -and $rank -gt $highestRank) {
            $highestRank = $rank
            $highest = $sev
        }
    }

    return $highest
}

function Test-UnusualHour {
    <#
    .SYNOPSIS
        Checks if a given hour falls within the unusual window (01:00-05:00).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [int]$Hour
    )

    return ($Hour -ge 1 -and $Hour -lt 5)
}

# ============================================================================
# MAIN ANOMALY DETECTION
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Sign-In Anomaly Detection" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Analysis window:           $AnalysisWindowHours hours" -ForegroundColor Gray
Write-Host "  Impossible travel speed:   $ImpossibleTravelSpeedKmh km/h" -ForegroundColor Gray
Write-Host "  Brute force threshold:     $BruteForceThreshold attempts/hour" -ForegroundColor Gray
Write-Host ""

$now = Get-Date
$windowStart = $now.AddHours(-$AnalysisWindowHours)
$anomalies = @()

# -----------------------------------------------------------------------
# 1. Load sign-in data
# -----------------------------------------------------------------------
Write-Host "  Loading sign-in data..." -ForegroundColor Gray

$signInLogs = @()
$riskySignIns = @()

$signInFile = Find-DataFile -FileName "signin-logs.json"
if ($signInFile) {
    try {
        $rawData = Get-Content $signInFile -Raw | ConvertFrom-Json
        if ($rawData -is [System.Array]) {
            $signInLogs = @($rawData)
        }
        elseif ($rawData.value) {
            $signInLogs = @($rawData.value)
        }
        else {
            $signInLogs = @($rawData)
        }
        Write-Host "  Loaded $($signInLogs.Count) sign-in records from $signInFile" -ForegroundColor Gray
    }
    catch {
        Write-Host "  FAILED to load sign-in logs: $($_.Exception.Message)" -ForegroundColor Red
    }
}
else {
    Write-Host "  Sign-in logs file not found (signin-logs.json)" -ForegroundColor Yellow
    Write-Host "  Checked: $dashboardDataPath and $fallbackDataPath" -ForegroundColor Yellow
}

$riskySignInFile = Find-DataFile -FileName "risky-signins.json"
if ($riskySignInFile) {
    try {
        $rawRisky = Get-Content $riskySignInFile -Raw | ConvertFrom-Json
        if ($rawRisky -is [System.Array]) {
            $riskySignIns = @($rawRisky)
        }
        elseif ($rawRisky.value) {
            $riskySignIns = @($rawRisky.value)
        }
        else {
            $riskySignIns = @($rawRisky)
        }
        Write-Host "  Loaded $($riskySignIns.Count) risky sign-in records from $riskySignInFile" -ForegroundColor Gray
    }
    catch {
        Write-Host "  WARNING: Could not load risky sign-ins: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
else {
    Write-Host "  Risky sign-ins file not found (risky-signins.json) - skipping" -ForegroundColor Yellow
}

if ($signInLogs.Count -eq 0) {
    Write-Host ""
    Write-Host "  No sign-in data available for analysis. Exiting." -ForegroundColor Red
    Write-Host ""
    return
}

# Filter to analysis window
$filteredLogs = @($signInLogs | Where-Object {
    try {
        $ts = [DateTime]::Parse($_.createdDateTime)
        $ts -ge $windowStart
    }
    catch {
        $false
    }
})

Write-Host "  Sign-ins within analysis window: $($filteredLogs.Count)" -ForegroundColor Gray
Write-Host ""

$signInsAnalyzed = $filteredLogs.Count

# -----------------------------------------------------------------------
# 2a. Impossible Travel Detection
# -----------------------------------------------------------------------
Write-Host "  Detecting impossible travel..." -ForegroundColor Gray

$userSignIns = @{}
foreach ($log in $filteredLogs) {
    $userId = $log.userId
    if (-not $userId) { continue }

    $lat = $null
    $lon = $null
    $city = $null
    $country = $null

    if ($log.location) {
        if ($log.location.geoCoordinates) {
            $lat = $log.location.geoCoordinates.latitude
            $lon = $log.location.geoCoordinates.longitude
        }
        $city = $log.location.city
        $country = $log.location.countryOrRegion
    }

    # Only include sign-ins with geo data for impossible travel
    if ($null -ne $lat -and $null -ne $lon -and $lat -ne 0 -and $lon -ne 0) {
        if (-not $userSignIns.ContainsKey($userId)) {
            $userSignIns[$userId] = @()
        }

        $userSignIns[$userId] += @{
            timestamp         = [DateTime]::Parse($log.createdDateTime)
            latitude          = [double]$lat
            longitude         = [double]$lon
            city              = $city
            country           = $country
            ipAddress         = $log.ipAddress
            userPrincipalName = $log.userPrincipalName
        }
    }
}

$impossibleTravelCount = 0
foreach ($userId in $userSignIns.Keys) {
    $sorted = $userSignIns[$userId] | Sort-Object { $_.timestamp }

    for ($i = 1; $i -lt $sorted.Count; $i++) {
        $prev = $sorted[$i - 1]
        $curr = $sorted[$i]

        # Skip if same location (same city and country)
        if ($prev.city -eq $curr.city -and $prev.country -eq $curr.country) {
            continue
        }

        $distance = Get-HaversineDistance `
            -Lat1 $prev.latitude -Lon1 $prev.longitude `
            -Lat2 $curr.latitude -Lon2 $curr.longitude

        # Skip trivially close locations (< 50 km)
        if ($distance -lt 50) { continue }

        $timeGapHours = ($curr.timestamp - $prev.timestamp).TotalHours

        # Avoid division by zero for near-simultaneous sign-ins
        if ($timeGapHours -lt 0.01) {
            $requiredSpeed = [double]::MaxValue
        }
        else {
            $requiredSpeed = $distance / $timeGapHours
        }

        if ($requiredSpeed -gt $ImpossibleTravelSpeedKmh) {
            $anomalies += New-AnomalyRecord `
                -Type "impossible-travel" `
                -UserId $userId `
                -UserPrincipalName $curr.userPrincipalName `
                -Timestamp $curr.timestamp.ToString("o") `
                -Details @{
                    fromLocation    = "$($prev.city), $($prev.country)"
                    toLocation      = "$($curr.city), $($curr.country)"
                    fromIp          = $prev.ipAddress
                    toIp            = $curr.ipAddress
                    distanceKm      = [Math]::Round($distance, 1)
                    timeGapMinutes  = [Math]::Round($timeGapHours * 60, 1)
                    requiredSpeedKmh = [Math]::Round($requiredSpeed, 0)
                    fromTimestamp   = $prev.timestamp.ToString("o")
                    toTimestamp     = $curr.timestamp.ToString("o")
                } `
                -Description "Sign-in from $($curr.city), $($curr.country) occurred $([Math]::Round($timeGapHours * 60, 0)) minutes after sign-in from $($prev.city), $($prev.country) ($([Math]::Round($distance, 0)) km apart, requiring $([Math]::Round($requiredSpeed, 0)) km/h travel speed)"

            $impossibleTravelCount++
        }
    }
}

Write-Host "    Found $impossibleTravelCount impossible travel anomalies" -ForegroundColor $(if ($impossibleTravelCount -gt 0) { "Red" } else { "Gray" })

# -----------------------------------------------------------------------
# 2b. Brute Force Detection
# -----------------------------------------------------------------------
Write-Host "  Detecting brute force attacks..." -ForegroundColor Gray

$bruteForceCount = 0

# Group sign-ins by user + IP
$userIpGroups = @{}
foreach ($log in $filteredLogs) {
    $userId = $log.userId
    $ip = $log.ipAddress
    if (-not $userId -or -not $ip) { continue }

    # Only consider failed sign-ins
    $errorCode = 0
    if ($log.status -and $log.status.errorCode) {
        $errorCode = [int]$log.status.errorCode
    }
    if ($errorCode -eq 0) { continue }

    $key = "$userId|$ip"
    if (-not $userIpGroups.ContainsKey($key)) {
        $userIpGroups[$key] = @()
    }

    $userIpGroups[$key] += @{
        timestamp         = [DateTime]::Parse($log.createdDateTime)
        errorCode         = $errorCode
        userPrincipalName = $log.userPrincipalName
        userId            = $userId
        ipAddress         = $ip
        failureReason     = if ($log.status.failureReason) { $log.status.failureReason } else { "Unknown" }
    }
}

foreach ($key in $userIpGroups.Keys) {
    $attempts = $userIpGroups[$key] | Sort-Object { $_.timestamp }

    if ($attempts.Count -lt $BruteForceThreshold) { continue }

    # Sliding window: check if any 1-hour window has >= threshold failures
    for ($i = 0; $i -lt $attempts.Count; $i++) {
        $windowEnd = $attempts[$i].timestamp.AddHours(1)
        $windowAttempts = @($attempts | Where-Object { $_.timestamp -ge $attempts[$i].timestamp -and $_.timestamp -le $windowEnd })

        if ($windowAttempts.Count -ge $BruteForceThreshold) {
            $first = $windowAttempts[0]
            $last = $windowAttempts[-1]

            $anomalies += New-AnomalyRecord `
                -Type "brute-force" `
                -UserId $first.userId `
                -UserPrincipalName $first.userPrincipalName `
                -Timestamp $first.timestamp.ToString("o") `
                -Details @{
                    sourceIp         = $first.ipAddress
                    failedAttempts   = $windowAttempts.Count
                    windowStartTime  = $first.timestamp.ToString("o")
                    windowEndTime    = $last.timestamp.ToString("o")
                    windowMinutes    = [Math]::Round(($last.timestamp - $first.timestamp).TotalMinutes, 1)
                    topErrorCodes    = @($windowAttempts | Group-Object { $_.errorCode } | Sort-Object Count -Descending | Select-Object -First 3 | ForEach-Object {
                        @{ errorCode = $_.Name; count = $_.Count }
                    })
                    failureReason    = $first.failureReason
                } `
                -Description "$($windowAttempts.Count) failed sign-in attempts from IP $($first.ipAddress) for $($first.userPrincipalName) within $([Math]::Round(($last.timestamp - $first.timestamp).TotalMinutes, 0)) minutes"

            $bruteForceCount++
            # Skip past this window to avoid duplicate detections for same burst
            break
        }
    }
}

Write-Host "    Found $bruteForceCount brute force anomalies" -ForegroundColor $(if ($bruteForceCount -gt 0) { "Yellow" } else { "Gray" })

# -----------------------------------------------------------------------
# 2c. Legacy Auth Usage Detection
# -----------------------------------------------------------------------
Write-Host "  Detecting legacy authentication usage..." -ForegroundColor Gray

$legacyAuthCount = 0

foreach ($log in $filteredLogs) {
    $clientApp = $log.clientAppUsed
    if (-not $clientApp) { continue }

    if ($LegacyAuthClients -contains $clientApp) {
        $anomalies += New-AnomalyRecord `
            -Type "legacy-auth" `
            -UserId $log.userId `
            -UserPrincipalName $log.userPrincipalName `
            -Timestamp $log.createdDateTime `
            -Details @{
                clientAppUsed = $clientApp
                ipAddress     = $log.ipAddress
                appDisplayName = if ($log.appDisplayName) { $log.appDisplayName } else { "Unknown" }
                resourceDisplayName = if ($log.resourceDisplayName) { $log.resourceDisplayName } else { "Unknown" }
                status        = if ($log.status -and $log.status.errorCode -eq 0) { "Success" } else { "Failed" }
                userAgent     = if ($log.userAgent) { $log.userAgent } else { "N/A" }
            } `
            -Description "Legacy authentication ($clientApp) used by $($log.userPrincipalName) from IP $($log.ipAddress) - bypasses MFA controls"

        $legacyAuthCount++
    }
}

Write-Host "    Found $legacyAuthCount legacy auth anomalies" -ForegroundColor $(if ($legacyAuthCount -gt 0) { "Yellow" } else { "Gray" })

# -----------------------------------------------------------------------
# 2d. Unusual Hours Detection
# -----------------------------------------------------------------------
Write-Host "  Detecting unusual hour sign-ins..." -ForegroundColor Gray

$unusualHoursCount = 0

# Build per-user baseline: determine each user's normal hours from majority of sign-ins
$userHourDistribution = @{}
foreach ($log in $filteredLogs) {
    $userId = $log.userId
    if (-not $userId) { continue }

    try {
        $ts = [DateTime]::Parse($log.createdDateTime)
        $hour = $ts.Hour

        if (-not $userHourDistribution.ContainsKey($userId)) {
            $userHourDistribution[$userId] = @{}
        }

        if (-not $userHourDistribution[$userId].ContainsKey($hour)) {
            $userHourDistribution[$userId][$hour] = 0
        }
        $userHourDistribution[$userId][$hour]++
    }
    catch {
        # Skip unparseable timestamps
    }
}

# Identify users who normally sign in during unusual hours (>30% of their sign-ins)
$usersNormallyActiveAtNight = @{}
foreach ($userId in $userHourDistribution.Keys) {
    $hourDist = $userHourDistribution[$userId]
    $totalSignIns = ($hourDist.Values | Measure-Object -Sum).Sum
    $unusualHourSignIns = 0

    foreach ($hour in $hourDist.Keys) {
        if (Test-UnusualHour -Hour ([int]$hour)) {
            $unusualHourSignIns += $hourDist[$hour]
        }
    }

    if ($totalSignIns -gt 0 -and ($unusualHourSignIns / $totalSignIns) -gt 0.3) {
        $usersNormallyActiveAtNight[$userId] = $true
    }
}

# Flag unusual hour sign-ins for users who DON'T normally sign in at those hours
foreach ($log in $filteredLogs) {
    $userId = $log.userId
    if (-not $userId) { continue }

    # Skip users who normally sign in during unusual hours
    if ($usersNormallyActiveAtNight.ContainsKey($userId)) { continue }

    try {
        $ts = [DateTime]::Parse($log.createdDateTime)
        $hour = $ts.Hour

        if (Test-UnusualHour -Hour $hour) {
            $anomalies += New-AnomalyRecord `
                -Type "unusual-hours" `
                -UserId $userId `
                -UserPrincipalName $log.userPrincipalName `
                -Timestamp $log.createdDateTime `
                -Details @{
                    signInHourUtc = $hour
                    signInTime    = $ts.ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
                    ipAddress     = $log.ipAddress
                    appDisplayName = if ($log.appDisplayName) { $log.appDisplayName } else { "Unknown" }
                    location      = if ($log.location -and $log.location.city) {
                        "$($log.location.city), $($log.location.countryOrRegion)"
                    } else { "Unknown" }
                    userTotalSignIns = ($userHourDistribution[$userId].Values | Measure-Object -Sum).Sum
                    userNightSignInPct = if (($userHourDistribution[$userId].Values | Measure-Object -Sum).Sum -gt 0) {
                        $nightTotal = 0
                        foreach ($h in $userHourDistribution[$userId].Keys) {
                            if (Test-UnusualHour -Hour ([int]$h)) { $nightTotal += $userHourDistribution[$userId][$h] }
                        }
                        [Math]::Round(($nightTotal / ($userHourDistribution[$userId].Values | Measure-Object -Sum).Sum) * 100, 1)
                    } else { 0 }
                } `
                -Description "Sign-in at $($ts.ToString("HH:mm")) UTC by $($log.userPrincipalName) - unusual for this user (01:00-05:00 window)"

            $unusualHoursCount++
        }
    }
    catch {
        # Skip unparseable timestamps
    }
}

Write-Host "    Found $unusualHoursCount unusual hours anomalies" -ForegroundColor $(if ($unusualHoursCount -gt 0) { "Gray" } else { "Gray" })

# -----------------------------------------------------------------------
# 2e. New Country Detection
# -----------------------------------------------------------------------
Write-Host "  Detecting new country sign-ins..." -ForegroundColor Gray

$newCountryCount = 0

# Build per-user country history from ALL sign-in logs (not just the filtered window)
$userCountryHistory = @{}
foreach ($log in $signInLogs) {
    $userId = $log.userId
    if (-not $userId) { continue }

    $country = $null
    if ($log.location -and $log.location.countryOrRegion) {
        $country = $log.location.countryOrRegion
    }
    if (-not $country) { continue }

    if (-not $userCountryHistory.ContainsKey($userId)) {
        $userCountryHistory[$userId] = @{}
    }

    if (-not $userCountryHistory[$userId].ContainsKey($country)) {
        $userCountryHistory[$userId][$country] = @{
            firstSeen = $log.createdDateTime
            count     = 0
        }
    }
    $userCountryHistory[$userId][$country].count++

    # Track earliest sign-in for this country
    try {
        $existingFirst = [DateTime]::Parse($userCountryHistory[$userId][$country].firstSeen)
        $currentTs = [DateTime]::Parse($log.createdDateTime)
        if ($currentTs -lt $existingFirst) {
            $userCountryHistory[$userId][$country].firstSeen = $log.createdDateTime
        }
    }
    catch {
        # Keep existing
    }
}

# Now check filtered window for sign-ins from countries first seen within the window
foreach ($log in $filteredLogs) {
    $userId = $log.userId
    if (-not $userId) { continue }

    $country = $null
    if ($log.location -and $log.location.countryOrRegion) {
        $country = $log.location.countryOrRegion
    }
    if (-not $country) { continue }

    if (-not $userCountryHistory.ContainsKey($userId)) { continue }
    if (-not $userCountryHistory[$userId].ContainsKey($country)) { continue }

    $countryData = $userCountryHistory[$userId][$country]

    # A country is "new" if it was first seen within the analysis window and the user
    # has sign-ins from other countries (i.e., we have baseline data)
    try {
        $firstSeen = [DateTime]::Parse($countryData.firstSeen)
        $logTimestamp = [DateTime]::Parse($log.createdDateTime)

        # Only flag if this is the first sign-in from this country AND it's within the window
        if ($firstSeen -ge $windowStart -and $countryData.count -le 2 -and $userCountryHistory[$userId].Count -gt 1) {
            # Only flag once per user/country combination (use the first occurrence)
            if ($logTimestamp -eq $firstSeen) {
                $knownCountries = @($userCountryHistory[$userId].Keys | Where-Object { $_ -ne $country })

                $anomalies += New-AnomalyRecord `
                    -Type "new-country" `
                    -UserId $userId `
                    -UserPrincipalName $log.userPrincipalName `
                    -Timestamp $log.createdDateTime `
                    -Details @{
                        newCountry       = $country
                        city             = if ($log.location.city) { $log.location.city } else { "Unknown" }
                        ipAddress        = $log.ipAddress
                        knownCountries   = $knownCountries
                        appDisplayName   = if ($log.appDisplayName) { $log.appDisplayName } else { "Unknown" }
                    } `
                    -Description "First-time sign-in from $country for $($log.userPrincipalName) (previously seen from: $($knownCountries -join ', '))"

                $newCountryCount++
            }
        }
    }
    catch {
        # Skip unparseable timestamps
    }
}

Write-Host "    Found $newCountryCount new country anomalies" -ForegroundColor $(if ($newCountryCount -gt 0) { "Yellow" } else { "Gray" })

# -----------------------------------------------------------------------
# 2f. Token Replay Detection
# -----------------------------------------------------------------------
Write-Host "  Detecting token replay attacks..." -ForegroundColor Gray

$tokenReplayCount = 0

# Group sign-ins by correlationId
$correlationGroups = @{}
foreach ($log in $filteredLogs) {
    $corrId = $log.correlationId
    if (-not $corrId) { continue }

    if (-not $correlationGroups.ContainsKey($corrId)) {
        $correlationGroups[$corrId] = @()
    }

    $correlationGroups[$corrId] += $log
}

foreach ($corrId in $correlationGroups.Keys) {
    $group = $correlationGroups[$corrId]

    # Get unique IPs for this correlation ID
    $uniqueIps = @($group | Where-Object { $_.ipAddress } | ForEach-Object { $_.ipAddress } | Sort-Object -Unique)

    if ($uniqueIps.Count -gt 1) {
        $firstLog = $group | Sort-Object { $_.createdDateTime } | Select-Object -First 1

        $anomalies += New-AnomalyRecord `
            -Type "token-replay" `
            -UserId $firstLog.userId `
            -UserPrincipalName $firstLog.userPrincipalName `
            -Timestamp $firstLog.createdDateTime `
            -Details @{
                correlationId    = $corrId
                sourceIps        = $uniqueIps
                signInCount      = $group.Count
                uniqueIpCount    = $uniqueIps.Count
                appDisplayName   = if ($firstLog.appDisplayName) { $firstLog.appDisplayName } else { "Unknown" }
                resourceDisplayName = if ($firstLog.resourceDisplayName) { $firstLog.resourceDisplayName } else { "Unknown" }
            } `
            -Description "Token replay detected: correlationId $corrId used from $($uniqueIps.Count) different IPs ($($uniqueIps -join ', ')) for $($firstLog.userPrincipalName)"

        $tokenReplayCount++
    }
}

Write-Host "    Found $tokenReplayCount token replay anomalies" -ForegroundColor $(if ($tokenReplayCount -gt 0) { "Red" } else { "Gray" })

# -----------------------------------------------------------------------
# 3. Build summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Building results..." -ForegroundColor Gray

# Count by severity
$bySeverity = @{
    "critical" = 0
    "high"     = 0
    "medium"   = 0
    "low"      = 0
}
foreach ($a in $anomalies) {
    if ($bySeverity.ContainsKey($a.severity)) {
        $bySeverity[$a.severity]++
    }
}

# Count by type
$byType = @{
    "impossible-travel" = $impossibleTravelCount
    "brute-force"       = $bruteForceCount
    "legacy-auth"       = $legacyAuthCount
    "unusual-hours"     = $unusualHoursCount
    "new-country"       = $newCountryCount
    "token-replay"      = $tokenReplayCount
}

# Build affected users list
$affectedUserMap = @{}
foreach ($a in $anomalies) {
    $uid = $a.userId
    if (-not $uid) { continue }

    if (-not $affectedUserMap.ContainsKey($uid)) {
        $affectedUserMap[$uid] = @{
            userId          = $uid
            upn             = $a.userPrincipalName
            anomalyCount    = 0
            severities      = @()
        }
    }
    $affectedUserMap[$uid].anomalyCount++
    $affectedUserMap[$uid].severities += $a.severity
}

$affectedUsers = @($affectedUserMap.Values | ForEach-Object {
    [PSCustomObject]@{
        userId          = $_.userId
        upn             = $_.upn
        anomalyCount    = $_.anomalyCount
        highestSeverity = Get-HighestSeverity -Severities $_.severities
    }
} | Sort-Object @{e={$SeverityRank[$_.highestSeverity]}; Descending=$true}, anomalyCount -Descending)

# -----------------------------------------------------------------------
# 4. Build output report object
# -----------------------------------------------------------------------
$report = [PSCustomObject]@{
    analysisDate    = $now.ToString("o")
    windowHours     = $AnalysisWindowHours
    signInsAnalyzed = $signInsAnalyzed
    summary         = [PSCustomObject]@{
        totalAnomalies = $anomalies.Count
        bySeverity     = $bySeverity
        byType         = $byType
    }
    anomalies       = $anomalies
    affectedUsers   = $affectedUsers
}

# -----------------------------------------------------------------------
# 5. Write JSON output
# -----------------------------------------------------------------------
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$jsonFile = Join-Path $OutputPath "signin-anomaly-results.json"
$report | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonFile -Encoding UTF8

# Also write to dashboard data directory
if (Test-Path $dashboardDataPath) {
    $dashboardJsonFile = Join-Path $dashboardDataPath "signin-anomaly-results.json"
    $report | ConvertTo-Json -Depth 10 | Set-Content -Path $dashboardJsonFile -Encoding UTF8
    Write-Host "  Dashboard data: $dashboardJsonFile" -ForegroundColor Green
}

# -----------------------------------------------------------------------
# 6. Generate HTML report
# -----------------------------------------------------------------------

# Build anomaly table rows
$anomalyRowsHtml = ""
$sortedAnomalies = $anomalies | Sort-Object @{e={$SeverityRank[$_.severity]}; Descending=$true}, timestamp

foreach ($a in $sortedAnomalies) {
    $severityBadge = switch ($a.severity) {
        "critical" { "<span class='badge badge-critical'>CRITICAL</span>" }
        "high"     { "<span class='badge badge-high'>HIGH</span>" }
        "medium"   { "<span class='badge badge-medium'>MEDIUM</span>" }
        "low"      { "<span class='badge badge-low'>LOW</span>" }
    }

    $typeBadge = "<span class='type-badge'>$($a.type)</span>"

    $detailsHtml = ""
    if ($a.details -is [hashtable]) {
        foreach ($key in $a.details.Keys) {
            $val = $a.details[$key]
            if ($val -is [System.Array]) {
                $val = $val -join ", "
            }
            $detailsHtml += "<div class='detail-item'><span class='detail-key'>$([System.Web.HttpUtility]::HtmlEncode($key)):</span> $([System.Web.HttpUtility]::HtmlEncode("$val"))</div>"
        }
    }

    $anomalyRowsHtml += @"
    <tr>
        <td>$severityBadge</td>
        <td>$typeBadge</td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($a.userPrincipalName))</td>
        <td class="timestamp-cell">$([System.Web.HttpUtility]::HtmlEncode($a.timestamp))</td>
        <td class="desc-cell">$([System.Web.HttpUtility]::HtmlEncode($a.description))</td>
    </tr>
"@
}

# Build affected users table rows
$affectedUsersHtml = ""
foreach ($u in $affectedUsers | Select-Object -First 25) {
    $userSeverityBadge = switch ($u.highestSeverity) {
        "critical" { "<span class='badge badge-critical'>CRITICAL</span>" }
        "high"     { "<span class='badge badge-high'>HIGH</span>" }
        "medium"   { "<span class='badge badge-medium'>MEDIUM</span>" }
        "low"      { "<span class='badge badge-low'>LOW</span>" }
    }

    $affectedUsersHtml += @"
    <tr>
        <td>$([System.Web.HttpUtility]::HtmlEncode($u.upn))</td>
        <td>$($u.anomalyCount)</td>
        <td>$userSeverityBadge</td>
    </tr>
"@
}

$htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - Sign-In Anomaly Detection Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 30px; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; border: 1px solid #30363d; }
        .header h1 { font-size: 24px; margin-bottom: 8px; }
        .header p { opacity: 0.7; font-size: 14px; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 30px; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; text-align: center; }
        .card h3 { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .card .value { font-size: 32px; font-weight: 700; }
        .card .value.critical { color: #f85149; }
        .card .value.high { color: #f0883e; }
        .card .value.medium { color: #d29922; }
        .card .value.low { color: #58a6ff; }
        .card .value.neutral { color: #e1e4e8; }
        .section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 24px; margin-bottom: 20px; }
        .section h2 { font-size: 18px; margin-bottom: 16px; color: #e1e4e8; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 12px; background: #0d1117; border-bottom: 2px solid #30363d; font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #21262d; font-size: 13px; color: #c9d1d9; vertical-align: top; }
        tr:hover { background: #1c2128; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: white; }
        .badge-critical { background: #f85149; }
        .badge-high { background: #f0883e; }
        .badge-medium { background: #d29922; }
        .badge-low { background: #388bfd; }
        .type-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #30363d; color: #c9d1d9; }
        .desc-cell { max-width: 400px; font-size: 12px; color: #8b949e; }
        .timestamp-cell { white-space: nowrap; font-size: 12px; font-family: monospace; color: #8b949e; }
        .detail-item { font-size: 11px; color: #8b949e; margin: 2px 0; }
        .detail-key { color: #58a6ff; font-weight: 600; }
        .type-breakdown { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .type-card { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 14px; display: flex; justify-content: space-between; align-items: center; }
        .type-card .type-name { font-size: 13px; color: #c9d1d9; }
        .type-card .type-count { font-size: 20px; font-weight: 700; color: #e1e4e8; }
        .empty-state { color: #484f58; font-style: italic; padding: 40px; text-align: center; }
        a { color: #58a6ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Sign-In Anomaly Detection Report</h1>
        <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") UTC | Analysis window: $AnalysisWindowHours hours | Sign-ins analyzed: $signInsAnalyzed</p>
    </div>

    <div class="summary-grid">
        <div class="card"><h3>Total Anomalies</h3><div class="value neutral">$($anomalies.Count)</div></div>
        <div class="card"><h3>Critical</h3><div class="value critical">$($bySeverity["critical"])</div></div>
        <div class="card"><h3>High</h3><div class="value high">$($bySeverity["high"])</div></div>
        <div class="card"><h3>Medium</h3><div class="value medium">$($bySeverity["medium"])</div></div>
        <div class="card"><h3>Low</h3><div class="value low">$($bySeverity["low"])</div></div>
        <div class="card"><h3>Affected Users</h3><div class="value neutral">$($affectedUsers.Count)</div></div>
    </div>

    <div class="section">
        <h2>Detection Breakdown</h2>
        <div class="type-breakdown">
            <div class="type-card"><span class="type-name">Impossible Travel</span><span class="type-count" style="color:#f85149">$impossibleTravelCount</span></div>
            <div class="type-card"><span class="type-name">Brute Force</span><span class="type-count" style="color:#f0883e">$bruteForceCount</span></div>
            <div class="type-card"><span class="type-name">Token Replay</span><span class="type-count" style="color:#f85149">$tokenReplayCount</span></div>
            <div class="type-card"><span class="type-name">Legacy Auth</span><span class="type-count" style="color:#f0883e">$legacyAuthCount</span></div>
            <div class="type-card"><span class="type-name">New Country</span><span class="type-count" style="color:#d29922">$newCountryCount</span></div>
            <div class="type-card"><span class="type-name">Unusual Hours</span><span class="type-count" style="color:#388bfd">$unusualHoursCount</span></div>
        </div>
    </div>

    <div class="section">
        <h2>Most Affected Users</h2>
        $(if ($affectedUsersHtml) {
            "<table><tr><th>User Principal Name</th><th>Anomalies</th><th>Highest Severity</th></tr>$affectedUsersHtml</table>"
        } else {
            "<p class='empty-state'>No affected users detected.</p>"
        })
    </div>

    <div class="section">
        <h2>All Anomalies</h2>
        $(if ($anomalyRowsHtml) {
            "<table><tr><th>Severity</th><th>Type</th><th>User</th><th>Timestamp</th><th>Description</th></tr>$anomalyRowsHtml</table>"
        } else {
            "<p class='empty-state'>No anomalies detected in the analysis window. All sign-in activity appears normal.</p>"
        })
    </div>

    <div class="section" style="text-align:center; color:#484f58; font-size:12px; padding:16px;">
        TenantScope - Sign-In Anomaly Detection | Generated $(Get-Date -Format "yyyy-MM-dd HH:mm:ss") UTC
    </div>
</body>
</html>
"@

$htmlFile = Join-Path $OutputPath "signin-anomaly-report-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

# -----------------------------------------------------------------------
# 7. Console summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  Results Summary" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Sign-ins analyzed:   $signInsAnalyzed" -ForegroundColor Gray
Write-Host "  Total anomalies:     $($anomalies.Count)" -ForegroundColor $(if ($anomalies.Count -gt 0) { "Yellow" } else { "Green" })
Write-Host ""
Write-Host "  By Severity:" -ForegroundColor White
Write-Host "    Critical:          $($bySeverity["critical"])" -ForegroundColor $(if ($bySeverity["critical"] -gt 0) { "Red" } else { "Gray" })
Write-Host "    High:              $($bySeverity["high"])" -ForegroundColor $(if ($bySeverity["high"] -gt 0) { "DarkYellow" } else { "Gray" })
Write-Host "    Medium:            $($bySeverity["medium"])" -ForegroundColor $(if ($bySeverity["medium"] -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Low:               $($bySeverity["low"])" -ForegroundColor $(if ($bySeverity["low"] -gt 0) { "Cyan" } else { "Gray" })
Write-Host ""
Write-Host "  By Type:" -ForegroundColor White
Write-Host "    Impossible travel: $impossibleTravelCount" -ForegroundColor $(if ($impossibleTravelCount -gt 0) { "Red" } else { "Gray" })
Write-Host "    Brute force:       $bruteForceCount" -ForegroundColor $(if ($bruteForceCount -gt 0) { "DarkYellow" } else { "Gray" })
Write-Host "    Token replay:      $tokenReplayCount" -ForegroundColor $(if ($tokenReplayCount -gt 0) { "Red" } else { "Gray" })
Write-Host "    Legacy auth:       $legacyAuthCount" -ForegroundColor $(if ($legacyAuthCount -gt 0) { "DarkYellow" } else { "Gray" })
Write-Host "    New country:       $newCountryCount" -ForegroundColor $(if ($newCountryCount -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Unusual hours:     $unusualHoursCount" -ForegroundColor $(if ($unusualHoursCount -gt 0) { "Cyan" } else { "Gray" })
Write-Host ""
Write-Host "  Affected users:      $($affectedUsers.Count)" -ForegroundColor $(if ($affectedUsers.Count -gt 0) { "Yellow" } else { "Gray" })
Write-Host ""
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green
Write-Host "  HTML report: $htmlFile" -ForegroundColor Green
Write-Host ""

return $report
