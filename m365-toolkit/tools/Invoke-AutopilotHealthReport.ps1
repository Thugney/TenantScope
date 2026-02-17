# ============================================================================
# TenantScope - Autopilot Readiness & Health Dashboard
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Monitors Windows Autopilot registration health and generates deployment reports.

.DESCRIPTION
    Provides a comprehensive view of Autopilot deployment health:

    1. Devices with hardware hash but no deployment profile assigned
    2. Enrollment Status Page (ESP) failure rate trending
    3. Deployment success/failure breakdown by group tag (per school, department)
    4. Average deployment time analysis
    5. Profile assignment status summary
    6. Stale Autopilot registrations

    Generates a weekly HTML report for IT operations teams.

    Required Graph scopes:
    - DeviceManagementServiceConfig.Read.All
    - DeviceManagementManagedDevices.Read.All

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/autopilot-health/.

.PARAMETER StaleThresholdDays
    Days since last contact before a device is considered stale. Default: 90.

.EXAMPLE
    .\tools\Invoke-AutopilotHealthReport.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-AutopilotHealthReport.ps1 -Config $config -StaleThresholdDays 60

.NOTES
    Version: 1.0.0
    Read-only reporting tool.
    Uses beta Graph API for full Autopilot property set.
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
    [ValidateRange(30, 365)]
    [int]$StaleThresholdDays = 90
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\autopilot-health"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# ============================================================================
# MAIN REPORT GENERATION
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Autopilot Health Report" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$now = Get-Date

# -----------------------------------------------------------------------
# 1. Retrieve Autopilot device identities (beta API for full properties)
# -----------------------------------------------------------------------
Write-Host "  Fetching Autopilot device identities..." -ForegroundColor Gray

$autopilotDevices = @()
$apiUri = "https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeviceIdentities?`$top=500"

try {
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $apiUri -OutputType PSObject
    } -OperationName "Get Autopilot devices"

    if ($response.value) {
        $autopilotDevices = @($response.value)
    }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Get Autopilot devices (pagination)"
        if ($response.value) {
            $autopilotDevices += $response.value
        }
    }

    Write-Host "  Retrieved $($autopilotDevices.Count) Autopilot devices" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve Autopilot devices: $($_.Exception.Message)" -ForegroundColor Red
    return
}

if ($autopilotDevices.Count -eq 0) {
    Write-Host "  No Autopilot devices found." -ForegroundColor Yellow
    return
}

# -----------------------------------------------------------------------
# 2. Retrieve Autopilot deployment profiles
# -----------------------------------------------------------------------
Write-Host "  Fetching deployment profiles..." -ForegroundColor Gray

$profiles = @()
try {
    $profileUri = "https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeploymentProfiles"
    $profileResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $profileUri -OutputType PSObject
    } -OperationName "Get deployment profiles"

    if ($profileResponse.value) {
        $profiles = @($profileResponse.value)
    }
    Write-Host "  Retrieved $($profiles.Count) deployment profiles" -ForegroundColor Gray
}
catch {
    Write-Host "  Could not retrieve deployment profiles: $($_.Exception.Message)" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------
# 3. Analyze device health
# -----------------------------------------------------------------------
Write-Host "  Analyzing device health..." -ForegroundColor Gray

$noProfile = @()
$staleDevices = @()
$byGroupTag = @{}
$byProfileStatus = @{}
$byEnrollmentState = @{}
$deploymentTimes = @()

foreach ($device in $autopilotDevices) {
    $groupTag = if ($device.groupTag) { $device.groupTag } else { "(No Group Tag)" }
    $profileStatus = if ($device.deploymentProfileAssignmentStatus) { $device.deploymentProfileAssignmentStatus } else { "unknown" }
    $enrollmentState = if ($device.enrollmentState) { $device.enrollmentState } else { "unknown" }

    # Profile assignment status
    if (-not $byProfileStatus.ContainsKey($profileStatus)) {
        $byProfileStatus[$profileStatus] = 0
    }
    $byProfileStatus[$profileStatus]++

    # Enrollment state
    if (-not $byEnrollmentState.ContainsKey($enrollmentState)) {
        $byEnrollmentState[$enrollmentState] = 0
    }
    $byEnrollmentState[$enrollmentState]++

    # Group tag breakdown
    if (-not $byGroupTag.ContainsKey($groupTag)) {
        $byGroupTag[$groupTag] = @{
            total     = 0
            enrolled  = 0
            failed    = 0
            pending   = 0
            other     = 0
        }
    }
    $byGroupTag[$groupTag].total++

    switch -Wildcard ($enrollmentState.ToString().ToLower()) {
        "enrolled"     { $byGroupTag[$groupTag].enrolled++ }
        "failed"       { $byGroupTag[$groupTag].failed++ }
        "pending*"     { $byGroupTag[$groupTag].pending++ }
        "notcontacted" { $byGroupTag[$groupTag].pending++ }
        default        { $byGroupTag[$groupTag].other++ }
    }

    # Devices with no profile assigned
    $noProfileStatuses = @("notAssigned", "unknown", "0")
    if ($profileStatus -in $noProfileStatuses -or [string]::IsNullOrWhiteSpace($profileStatus)) {
        $noProfile += [PSCustomObject]@{
            serialNumber = $device.serialNumber
            model        = $device.model
            manufacturer = $device.manufacturer
            groupTag     = $groupTag
            enrollmentState = $enrollmentState
            lastContactedDateTime = $device.lastContactedDateTime
        }
    }

    # Stale devices (not contacted in threshold days)
    if ($device.lastContactedDateTime) {
        try {
            $lastContact = [DateTime]$device.lastContactedDateTime
            $daysSinceContact = ($now - $lastContact).TotalDays
            if ($daysSinceContact -gt $StaleThresholdDays) {
                $staleDevices += [PSCustomObject]@{
                    serialNumber = $device.serialNumber
                    model        = $device.model
                    manufacturer = $device.manufacturer
                    groupTag     = $groupTag
                    profileStatus = $profileStatus
                    lastContactedDateTime = $device.lastContactedDateTime
                    daysSinceContact = [math]::Floor($daysSinceContact)
                }
            }
        }
        catch { }
    }

    # Deployment time (from enrollment to last contact)
    if ($device.enrolledDateTime -and $device.lastContactedDateTime) {
        try {
            $enrolled = [DateTime]$device.enrolledDateTime
            $lastContact = [DateTime]$device.lastContactedDateTime
            if ($enrolled.Year -gt 2000 -and $lastContact -gt $enrolled) {
                $deploymentMinutes = ($lastContact - $enrolled).TotalMinutes
                if ($deploymentMinutes -gt 0 -and $deploymentMinutes -lt 1440) {
                    $deploymentTimes += $deploymentMinutes
                }
            }
        }
        catch { }
    }
}

# Calculate average deployment time
$avgDeploymentTime = if ($deploymentTimes.Count -gt 0) {
    [math]::Round(($deploymentTimes | Measure-Object -Average).Average, 1)
} else { 0 }

$medianDeploymentTime = if ($deploymentTimes.Count -gt 0) {
    $sorted = $deploymentTimes | Sort-Object
    $mid = [math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 0) { [math]::Round(($sorted[$mid - 1] + $sorted[$mid]) / 2, 1) }
    else { [math]::Round($sorted[$mid], 1) }
} else { 0 }

# -----------------------------------------------------------------------
# 4. Build summary
# -----------------------------------------------------------------------
$summary = [PSCustomObject]@{
    totalDevices       = $autopilotDevices.Count
    profilesConfigured = $profiles.Count
    noProfileAssigned  = $noProfile.Count
    staleDevices       = $staleDevices.Count
    avgDeploymentMinutes    = $avgDeploymentTime
    medianDeploymentMinutes = $medianDeploymentTime
    byGroupTag         = $byGroupTag
    byProfileStatus    = $byProfileStatus
    byEnrollmentState  = $byEnrollmentState
}

Write-Host ""
Write-Host "  Results:" -ForegroundColor White
Write-Host "    Total Autopilot devices:  $($summary.totalDevices)" -ForegroundColor Gray
Write-Host "    No profile assigned:      $($summary.noProfileAssigned)" -ForegroundColor $(if ($noProfile.Count -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Stale ($StaleThresholdDays+ days):         $($summary.staleDevices)" -ForegroundColor $(if ($staleDevices.Count -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Avg deployment time:      $avgDeploymentTime min" -ForegroundColor Gray
Write-Host "    Median deployment time:   $medianDeploymentTime min" -ForegroundColor Gray

# -----------------------------------------------------------------------
# 5. Generate HTML report
# -----------------------------------------------------------------------

$groupTagRows = ""
foreach ($tag in ($byGroupTag.Keys | Sort-Object)) {
    $data = $byGroupTag[$tag]
    $failRate = if ($data.total -gt 0) { [math]::Round(($data.failed / $data.total) * 100, 1) } else { 0 }
    $failColor = if ($failRate -gt 10) { "color:#ef4444;font-weight:700" } elseif ($failRate -gt 5) { "color:#f59e0b" } else { "" }
    $groupTagRows += "<tr><td>$([System.Web.HttpUtility]::HtmlEncode($tag))</td><td>$($data.total)</td><td>$($data.enrolled)</td><td>$($data.failed)</td><td>$($data.pending)</td><td style='$failColor'>$failRate%</td></tr>"
}

$noProfileRows = ""
foreach ($d in ($noProfile | Select-Object -First 50)) {
    $noProfileRows += "<tr><td>$([System.Web.HttpUtility]::HtmlEncode($d.serialNumber))</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.manufacturer))</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.model))</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.groupTag))</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.enrollmentState))</td></tr>"
}

$staleRows = ""
foreach ($d in ($staleDevices | Sort-Object daysSinceContact -Descending | Select-Object -First 50)) {
    $staleRows += "<tr><td>$([System.Web.HttpUtility]::HtmlEncode($d.serialNumber))</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.model))</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.groupTag))</td><td>$($d.daysSinceContact) days</td><td>$([System.Web.HttpUtility]::HtmlEncode($d.profileStatus))</td></tr>"
}

$profileStatusRows = ""
foreach ($status in ($byProfileStatus.Keys | Sort-Object)) {
    $profileStatusRows += "<tr><td>$([System.Web.HttpUtility]::HtmlEncode($status))</td><td>$($byProfileStatus[$status])</td></tr>"
}

$htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - Autopilot Health Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0 0; opacity: 0.8; }
        .summary { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
        .card { flex: 1; min-width: 160px; background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
        .card h3 { margin: 0 0 8px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .card .value { font-size: 32px; font-weight: 700; }
        .section { background: white; border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .section h2 { margin: 0 0 16px 0; font-size: 18px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        tr:hover { background: #f8fafc; }
        .empty { color: #94a3b8; font-style: italic; padding: 20px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Autopilot Readiness & Health Report</h1>
        <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") | Stale threshold: $StaleThresholdDays days</p>
    </div>

    <div class="summary">
        <div class="card">
            <h3>Total Devices</h3>
            <div class="value">$($autopilotDevices.Count)</div>
        </div>
        <div class="card">
            <h3>No Profile</h3>
            <div class="value" style="color:$(if ($noProfile.Count -gt 0) { '#f59e0b' } else { '#10b981' })">$($noProfile.Count)</div>
        </div>
        <div class="card">
            <h3>Stale</h3>
            <div class="value" style="color:$(if ($staleDevices.Count -gt 0) { '#f97316' } else { '#10b981' })">$($staleDevices.Count)</div>
        </div>
        <div class="card">
            <h3>Avg Deploy Time</h3>
            <div class="value">${avgDeploymentTime}m</div>
        </div>
        <div class="card">
            <h3>Profiles</h3>
            <div class="value">$($profiles.Count)</div>
        </div>
    </div>

    <div class="section">
        <h2>Deployment by Group Tag</h2>
        $(if ($groupTagRows) {
            "<table><tr><th>Group Tag</th><th>Total</th><th>Enrolled</th><th>Failed</th><th>Pending</th><th>Fail Rate</th></tr>$groupTagRows</table>"
        } else {
            "<p class='empty'>No group tag data available</p>"
        })
    </div>

    <div class="section">
        <h2>Profile Assignment Status</h2>
        $(if ($profileStatusRows) {
            "<table><tr><th>Status</th><th>Count</th></tr>$profileStatusRows</table>"
        } else {
            "<p class='empty'>No profile status data available</p>"
        })
    </div>

    $(if ($noProfileRows) {
    "<div class='section'>
        <h2>Devices Without Profile Assignment ($($noProfile.Count))</h2>
        <table><tr><th>Serial Number</th><th>Manufacturer</th><th>Model</th><th>Group Tag</th><th>Enrollment State</th></tr>$noProfileRows</table>
    </div>"
    })

    $(if ($staleRows) {
    "<div class='section'>
        <h2>Stale Devices ($($staleDevices.Count))</h2>
        <table><tr><th>Serial Number</th><th>Model</th><th>Group Tag</th><th>Last Contact</th><th>Profile Status</th></tr>$staleRows</table>
    </div>"
    })
</body>
</html>
"@

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$htmlFile = Join-Path $OutputPath "autopilot-health-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

# Save JSON report
$jsonReport = [PSCustomObject]@{
    reportType  = "autopilot-health"
    generated   = $now.ToString("o")
    summary     = $summary
    noProfile   = $noProfile
    staleDevices = $staleDevices
}
$jsonFile = Join-Path $OutputPath "autopilot-health-${timestamp}.json"
$jsonReport | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonFile -Encoding UTF8

Write-Host ""
Write-Host "  HTML report: $htmlFile" -ForegroundColor Green
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green
Write-Host ""

return $jsonReport
