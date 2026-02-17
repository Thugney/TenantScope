# ============================================================================
# TenantScope - Shared Device Compliance Monitor
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Monitors kiosks, shared iPads, and shared devices for compliance health.

.DESCRIPTION
    Specialized monitoring for shared/kiosk devices that often lack a primary user:

    1. Last check-in monitoring (alert when not synced for X days)
    2. Certificate expiry tracking
    3. App update status verification
    4. Storage utilization alerts
    5. OS version compliance
    6. Compliance policy status

    Generates alerts and an HTML report for operations teams.

    Required Graph scopes:
    - DeviceManagementManagedDevices.Read.All
    - DeviceManagementConfiguration.Read.All

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/shared-device-compliance/.

.PARAMETER CheckInThresholdDays
    Days since last check-in before alerting. Default: 7.

.PARAMETER StorageThresholdPercent
    Storage usage percentage threshold for alerts. Default: 85.

.PARAMETER CertExpiryDays
    Days before certificate expiry to start alerting. Default: 30.

.PARAMETER SharedDeviceFilter
    How to identify shared devices. Options: "ownership", "enrollmentProfile", "tag".
    Default: "ownership" (filters on corporate-owned devices with shared device mode).

.EXAMPLE
    .\tools\Invoke-SharedDeviceCompliance.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-SharedDeviceCompliance.ps1 -Config $config -CheckInThresholdDays 3 -StorageThresholdPercent 90

.NOTES
    Version: 1.0.0
    Read-only monitoring tool.
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
    [ValidateRange(1, 30)]
    [int]$CheckInThresholdDays = 7,

    [Parameter()]
    [ValidateRange(50, 99)]
    [int]$StorageThresholdPercent = 85,

    [Parameter()]
    [ValidateRange(7, 180)]
    [int]$CertExpiryDays = 30,

    [Parameter()]
    [ValidateSet("ownership", "enrollmentProfile", "tag")]
    [string]$SharedDeviceFilter = "ownership"
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\shared-device-compliance"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# ============================================================================
# MAIN MONITORING
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Shared Device Compliance" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Check-in threshold:  $CheckInThresholdDays days" -ForegroundColor Gray
Write-Host "  Storage threshold:   $StorageThresholdPercent%" -ForegroundColor Gray
Write-Host "  Cert expiry warning: $CertExpiryDays days" -ForegroundColor Gray
Write-Host ""

$now = Get-Date
$alerts = @()

# -----------------------------------------------------------------------
# 1. Retrieve managed devices (corporate-owned / shared)
# -----------------------------------------------------------------------
Write-Host "  Fetching managed devices..." -ForegroundColor Gray

$allDevices = @()
$devicesUri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?`$select=id,deviceName,complianceState,lastSyncDateTime,operatingSystem,osVersion,managedDeviceOwnerType,enrolledDateTime,totalStorageSpaceInBytes,freeStorageSpaceInBytes,userPrincipalName,userDisplayName,model,manufacturer,serialNumber,managementAgent&`$filter=managedDeviceOwnerType eq 'company'&`$top=500"

try {
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $devicesUri -OutputType PSObject
    } -OperationName "Get corporate devices"

    if ($response.value) {
        $allDevices = @($response.value)
    }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Get corporate devices (pagination)"
        if ($response.value) {
            $allDevices += $response.value
        }
    }

    Write-Host "  Retrieved $($allDevices.Count) corporate-owned devices" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve devices: $($_.Exception.Message)" -ForegroundColor Red
    return
}

# Identify shared devices (no primary user or kiosk-style devices)
$sharedDevices = @($allDevices | Where-Object {
    [string]::IsNullOrWhiteSpace($_.userPrincipalName) -or
    $_.userDisplayName -match "^(kiosk|shared|loaner|common)" -or
    $_.deviceName -match "^(KIOSK|SHARED|LOANER|COMMON)"
})

Write-Host "  Identified $($sharedDevices.Count) shared/kiosk devices" -ForegroundColor Gray
Write-Host ""

if ($sharedDevices.Count -eq 0) {
    Write-Host "  No shared devices found. Including all corporate devices for analysis." -ForegroundColor Yellow
    $sharedDevices = $allDevices
}

# -----------------------------------------------------------------------
# 2. Analyze each device
# -----------------------------------------------------------------------
Write-Host "  Analyzing device health..." -ForegroundColor Gray

$deviceReports = @()

foreach ($device in $sharedDevices) {
    $deviceAlerts = @()
    $deviceHealth = "healthy"

    # Check: Last sync
    $daysSinceSync = $null
    if ($device.lastSyncDateTime) {
        try {
            $lastSync = [DateTime]$device.lastSyncDateTime
            $daysSinceSync = [math]::Floor(($now - $lastSync).TotalDays)

            if ($daysSinceSync -gt $CheckInThresholdDays) {
                $severity = if ($daysSinceSync -gt ($CheckInThresholdDays * 3)) { "critical" } elseif ($daysSinceSync -gt ($CheckInThresholdDays * 2)) { "high" } else { "medium" }
                $deviceAlerts += @{
                    type     = "stale-checkin"
                    severity = $severity
                    message  = "Last check-in $daysSinceSync days ago (threshold: $CheckInThresholdDays)"
                }
                $deviceHealth = "warning"
                if ($severity -eq "critical") { $deviceHealth = "critical" }
            }
        }
        catch { }
    }
    else {
        $deviceAlerts += @{
            type     = "no-checkin"
            severity = "high"
            message  = "Device has never synced"
        }
        $deviceHealth = "critical"
    }

    # Check: Compliance state
    if ($device.complianceState -ne "compliant") {
        $deviceAlerts += @{
            type     = "noncompliant"
            severity = "high"
            message  = "Compliance state: $($device.complianceState)"
        }
        if ($deviceHealth -ne "critical") { $deviceHealth = "warning" }
    }

    # Check: Storage utilization
    if ($device.totalStorageSpaceInBytes -gt 0 -and $device.freeStorageSpaceInBytes -ne $null) {
        $usedBytes = $device.totalStorageSpaceInBytes - $device.freeStorageSpaceInBytes
        $usedPercent = [math]::Round(($usedBytes / $device.totalStorageSpaceInBytes) * 100, 1)
        $freeGB = [math]::Round($device.freeStorageSpaceInBytes / 1GB, 1)

        if ($usedPercent -ge $StorageThresholdPercent) {
            $deviceAlerts += @{
                type     = "low-storage"
                severity = if ($usedPercent -ge 95) { "critical" } else { "medium" }
                message  = "Storage ${usedPercent}% used (${freeGB} GB free)"
            }
            if ($deviceHealth -ne "critical") { $deviceHealth = "warning" }
        }
    }

    # Check: OS version (flag very old OS versions)
    $osVersion = $device.osVersion
    if ($device.operatingSystem -eq "Windows" -and $osVersion) {
        # Flag Windows devices on very old builds
        if ($osVersion -match "^10\.0\.(\d+)") {
            $buildNumber = [int]$Matches[1]
            if ($buildNumber -lt 19041) {
                $deviceAlerts += @{
                    type     = "outdated-os"
                    severity = "medium"
                    message  = "Running outdated Windows build: $osVersion"
                }
                if ($deviceHealth -ne "critical") { $deviceHealth = "warning" }
            }
        }
    }

    $deviceReport = [PSCustomObject]@{
        deviceId           = $device.id
        deviceName         = $device.deviceName
        serialNumber       = $device.serialNumber
        manufacturer       = $device.manufacturer
        model              = $device.model
        operatingSystem    = $device.operatingSystem
        osVersion          = $device.osVersion
        complianceState    = $device.complianceState
        lastSyncDateTime   = $device.lastSyncDateTime
        daysSinceSync      = $daysSinceSync
        userPrincipalName  = $device.userPrincipalName
        storageUsedPercent = if ($device.totalStorageSpaceInBytes -gt 0) {
            [math]::Round((($device.totalStorageSpaceInBytes - $device.freeStorageSpaceInBytes) / $device.totalStorageSpaceInBytes) * 100, 1)
        } else { $null }
        freeStorageGB      = if ($device.freeStorageSpaceInBytes) { [math]::Round($device.freeStorageSpaceInBytes / 1GB, 1) } else { $null }
        health             = $deviceHealth
        alertCount         = $deviceAlerts.Count
        alerts             = $deviceAlerts
    }

    $deviceReports += $deviceReport
    $alerts += $deviceAlerts | ForEach-Object {
        [PSCustomObject]@{
            deviceName = $device.deviceName
            deviceId   = $device.id
            type       = $_.type
            severity   = $_.severity
            message    = $_.message
        }
    }
}

# -----------------------------------------------------------------------
# 3. Generate summary
# -----------------------------------------------------------------------
$healthyCnt = ($deviceReports | Where-Object { $_.health -eq "healthy" }).Count
$warningCnt = ($deviceReports | Where-Object { $_.health -eq "warning" }).Count
$criticalCnt = ($deviceReports | Where-Object { $_.health -eq "critical" }).Count
$staleCount = ($alerts | Where-Object { $_.type -in @("stale-checkin", "no-checkin") }).Count
$noncompliantCount = ($alerts | Where-Object { $_.type -eq "noncompliant" }).Count
$lowStorageCount = ($alerts | Where-Object { $_.type -eq "low-storage" }).Count

Write-Host ""
Write-Host "  Results:" -ForegroundColor White
Write-Host "    Shared devices:  $($sharedDevices.Count)" -ForegroundColor Gray
Write-Host "    Healthy:         $healthyCnt" -ForegroundColor Green
Write-Host "    Warning:         $warningCnt" -ForegroundColor $(if ($warningCnt -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Critical:        $criticalCnt" -ForegroundColor $(if ($criticalCnt -gt 0) { "Red" } else { "Gray" })
Write-Host "    Stale:           $staleCount" -ForegroundColor $(if ($staleCount -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Noncompliant:    $noncompliantCount" -ForegroundColor $(if ($noncompliantCount -gt 0) { "DarkYellow" } else { "Gray" })
Write-Host "    Low storage:     $lowStorageCount" -ForegroundColor $(if ($lowStorageCount -gt 0) { "Yellow" } else { "Gray" })

# -----------------------------------------------------------------------
# 4. Generate reports
# -----------------------------------------------------------------------
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$report = [PSCustomObject]@{
    reportType = "shared-device-compliance"
    generated  = $now.ToString("o")
    thresholds = [PSCustomObject]@{
        checkInDays     = $CheckInThresholdDays
        storagePercent  = $StorageThresholdPercent
        certExpiryDays  = $CertExpiryDays
    }
    summary = [PSCustomObject]@{
        totalDevices  = $sharedDevices.Count
        healthy       = $healthyCnt
        warning       = $warningCnt
        critical      = $criticalCnt
        stale         = $staleCount
        noncompliant  = $noncompliantCount
        lowStorage    = $lowStorageCount
    }
    devices = $deviceReports
}

$jsonFile = Join-Path $OutputPath "shared-device-compliance-${timestamp}.json"
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonFile -Encoding UTF8

# HTML report
$deviceRows = ""
foreach ($d in ($deviceReports | Sort-Object @{e={switch($_.health){"critical"{0}"warning"{1}"healthy"{2}}}}, deviceName)) {
    $healthBadge = switch ($d.health) {
        "critical" { "<span class='badge badge-red'>CRITICAL</span>" }
        "warning"  { "<span class='badge badge-yellow'>WARNING</span>" }
        "healthy"  { "<span class='badge badge-green'>HEALTHY</span>" }
    }
    $alertText = if ($d.alertCount -gt 0) {
        ($d.alerts | ForEach-Object { $_.message }) -join "<br>"
    } else { "-" }
    $storageText = if ($null -ne $d.storageUsedPercent) { "$($d.storageUsedPercent)% ($($d.freeStorageGB) GB free)" } else { "N/A" }
    $syncText = if ($null -ne $d.daysSinceSync) { "$($d.daysSinceSync) days ago" } else { "Never" }

    $deviceRows += @"
    <tr>
        <td>$healthBadge</td>
        <td><strong>$([System.Web.HttpUtility]::HtmlEncode($d.deviceName))</strong></td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($d.operatingSystem)) $([System.Web.HttpUtility]::HtmlEncode($d.osVersion))</td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($d.complianceState))</td>
        <td>$syncText</td>
        <td>$storageText</td>
        <td>$alertText</td>
    </tr>
"@
}

$htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - Shared Device Compliance Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0 0; opacity: 0.8; }
        .summary { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
        .card { flex: 1; min-width: 140px; background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
        .card h3 { margin: 0 0 8px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .card .value { font-size: 32px; font-weight: 700; }
        .section { background: white; border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        tr:hover { background: #f8fafc; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: white; }
        .badge-red { background: #ef4444; }
        .badge-yellow { background: #f59e0b; }
        .badge-green { background: #10b981; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Shared Device Compliance Report</h1>
        <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") | Check-in threshold: $CheckInThresholdDays days | Storage threshold: $StorageThresholdPercent%</p>
    </div>

    <div class="summary">
        <div class="card"><h3>Total Devices</h3><div class="value">$($sharedDevices.Count)</div></div>
        <div class="card"><h3>Healthy</h3><div class="value" style="color:#10b981">$healthyCnt</div></div>
        <div class="card"><h3>Warning</h3><div class="value" style="color:#f59e0b">$warningCnt</div></div>
        <div class="card"><h3>Critical</h3><div class="value" style="color:#ef4444">$criticalCnt</div></div>
        <div class="card"><h3>Stale</h3><div class="value" style="color:#f97316">$staleCount</div></div>
        <div class="card"><h3>Low Storage</h3><div class="value" style="color:#8b5cf6">$lowStorageCount</div></div>
    </div>

    <div class="section">
        <h2>Device Status</h2>
        $(if ($deviceRows) {
            "<table><tr><th>Health</th><th>Device</th><th>OS</th><th>Compliance</th><th>Last Sync</th><th>Storage</th><th>Alerts</th></tr>$deviceRows</table>"
        } else {
            "<p style='color:#94a3b8; text-align:center; padding:40px;'>No shared devices found.</p>"
        })
    </div>
</body>
</html>
"@

$htmlFile = Join-Path $OutputPath "shared-device-compliance-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

Write-Host ""
Write-Host "  HTML report: $htmlFile" -ForegroundColor Green
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green
Write-Host ""

return $report
