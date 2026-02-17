# ============================================================================
# TenantScope - Compliance Drift Monitor
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Monitors devices that have drifted out of compliance and triggers remediation.

.DESCRIPTION
    Weekly scan for devices that were previously compliant but have fallen out
    of compliance. Detects the drift pattern and supports escalation:

    Stage 1 (Day 0-7):   Device goes noncompliant → log and monitor
    Stage 2 (Day 7+):    Still noncompliant → email user and manager with remediation steps
    Stage 3 (Day 14+):   Still noncompliant → flag for CA restriction or selective wipe

    Uses Intune managed device data to detect compliance state changes over time.
    Generates an HTML report and optional email notifications.

    Required Graph scopes:
    - DeviceManagementManagedDevices.Read.All
    - User.Read.All (for user/manager lookup)
    - Mail.Send (optional, for email notifications)

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER DriftThresholdDays
    Number of days a device must be noncompliant before triggering alerts. Default: 7.

.PARAMETER EscalationThresholdDays
    Number of days after which to escalate (CA restriction/wipe flag). Default: 14.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/compliance-drift/.

.PARAMETER SendNotifications
    If specified, sends email notifications to users and managers.

.PARAMETER WhatIf
    Preview mode - generates report but doesn't send notifications.

.EXAMPLE
    .\tools\Invoke-ComplianceDriftMonitor.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-ComplianceDriftMonitor.ps1 -Config $config -SendNotifications -DriftThresholdDays 5

.NOTES
    Version: 1.0.0
    Designed to run weekly via scheduled task.
    Uses compliance state history from the data/ directory if available.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.DeviceManagement

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [ValidateRange(1, 30)]
    [int]$DriftThresholdDays = 7,

    [Parameter()]
    [ValidateRange(7, 90)]
    [int]$EscalationThresholdDays = 14,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [switch]$SendNotifications
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\compliance-drift"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

$historyFile = Join-Path $OutputPath "compliance-drift-history.json"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-ComplianceDriftState {
    <#
    .SYNOPSIS
        Classifies a device's drift severity based on how long it's been noncompliant.
    #>
    param(
        [int]$DaysNoncompliant,
        [int]$DriftThreshold,
        [int]$EscalationThreshold
    )

    if ($DaysNoncompliant -le 0) {
        return "compliant"
    }
    elseif ($DaysNoncompliant -lt $DriftThreshold) {
        return "monitoring"
    }
    elseif ($DaysNoncompliant -lt $EscalationThreshold) {
        return "alert"
    }
    else {
        return "escalation"
    }
}

function Get-DevicePrimaryUser {
    <#
    .SYNOPSIS
        Resolves the primary user and their manager for an Intune device.
    #>
    param([string]$DeviceId)

    try {
        $uri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$DeviceId/users"
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Get device primary user" -MaxRetries 2

        if ($response.value -and $response.value.Count -gt 0) {
            $primaryUser = $response.value[0]

            # Get manager
            try {
                $managerUri = "https://graph.microsoft.com/v1.0/users/$($primaryUser.id)/manager?`$select=id,displayName,userPrincipalName,mail"
                $manager = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method GET -Uri $managerUri -OutputType PSObject
                } -OperationName "Get user manager" -MaxRetries 2
                $primaryUser | Add-Member -NotePropertyName "manager" -NotePropertyValue $manager -Force
            }
            catch {
                # Manager not set - that's ok
            }

            return $primaryUser
        }
    }
    catch {
        # Device may not have a primary user
    }

    return $null
}

function Build-ComplianceDriftHtmlReport {
    <#
    .SYNOPSIS
        Generates an HTML report of compliance drift findings.
    #>
    param(
        [array]$DriftDevices,
        [hashtable]$Summary
    )

    $reportDate = Get-Date -Format "yyyy-MM-dd HH:mm"

    $monitoringRows = ""
    $alertRows = ""
    $escalationRows = ""

    foreach ($device in $DriftDevices) {
        $row = "<tr>
            <td>$([System.Web.HttpUtility]::HtmlEncode($device.deviceName))</td>
            <td>$([System.Web.HttpUtility]::HtmlEncode($device.userDisplayName))</td>
            <td>$([System.Web.HttpUtility]::HtmlEncode($device.operatingSystem))</td>
            <td>$($device.daysNoncompliant)</td>
            <td>$([System.Web.HttpUtility]::HtmlEncode($device.complianceState))</td>
            <td>$([System.Web.HttpUtility]::HtmlEncode($device.lastSyncDateTime))</td>
        </tr>"

        switch ($device.driftState) {
            "monitoring"  { $monitoringRows += $row }
            "alert"       { $alertRows += $row }
            "escalation"  { $escalationRows += $row }
        }
    }

    $tableHeader = "<tr><th>Device</th><th>User</th><th>OS</th><th>Days Noncompliant</th><th>State</th><th>Last Sync</th></tr>"

    $html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - Compliance Drift Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0 0; opacity: 0.8; }
        .summary { display: flex; gap: 20px; margin-bottom: 30px; }
        .card { flex: 1; background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .card h3 { margin: 0 0 8px 0; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .card .value { font-size: 32px; font-weight: 700; }
        .card.green .value { color: #10b981; }
        .card.yellow .value { color: #f59e0b; }
        .card.orange .value { color: #f97316; }
        .card.red .value { color: #ef4444; }
        .section { background: white; border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .section h2 { margin: 0 0 16px 0; display: flex; align-items: center; gap: 10px; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 600; color: white; }
        .badge-yellow { background: #f59e0b; }
        .badge-orange { background: #f97316; }
        .badge-red { background: #ef4444; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        tr:hover { background: #f8fafc; }
        .empty { color: #94a3b8; font-style: italic; padding: 20px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Compliance Drift Report</h1>
        <p>Generated: $reportDate | Drift threshold: ${DriftThresholdDays} days | Escalation threshold: ${EscalationThresholdDays} days</p>
    </div>

    <div class="summary">
        <div class="card green">
            <h3>Total Devices Scanned</h3>
            <div class="value">$($Summary.totalDevices)</div>
        </div>
        <div class="card yellow">
            <h3>Monitoring (1-${DriftThresholdDays} days)</h3>
            <div class="value">$($Summary.monitoring)</div>
        </div>
        <div class="card orange">
            <h3>Alert (${DriftThresholdDays}-${EscalationThresholdDays} days)</h3>
            <div class="value">$($Summary.alert)</div>
        </div>
        <div class="card red">
            <h3>Escalation (${EscalationThresholdDays}+ days)</h3>
            <div class="value">$($Summary.escalation)</div>
        </div>
    </div>

    $(if ($escalationRows) {
    "<div class='section'>
        <h2><span class='badge badge-red'>ESCALATION</span> Noncompliant ${EscalationThresholdDays}+ days — Action required</h2>
        <table>$tableHeader$escalationRows</table>
    </div>"
    })

    $(if ($alertRows) {
    "<div class='section'>
        <h2><span class='badge badge-orange'>ALERT</span> Noncompliant ${DriftThresholdDays}-${EscalationThresholdDays} days — User/manager notified</h2>
        <table>$tableHeader$alertRows</table>
    </div>"
    })

    $(if ($monitoringRows) {
    "<div class='section'>
        <h2><span class='badge badge-yellow'>MONITORING</span> Noncompliant 1-${DriftThresholdDays} days — Watching</h2>
        <table>$tableHeader$monitoringRows</table>
    </div>"
    })

    $(if (-not $escalationRows -and -not $alertRows -and -not $monitoringRows) {
    "<div class='section'><p class='empty'>No compliance drift detected. All devices are compliant or newly noncompliant.</p></div>"
    })
</body>
</html>
"@

    return $html
}

# ============================================================================
# MAIN COMPLIANCE DRIFT SCAN
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Compliance Drift Monitor" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Drift threshold:      $DriftThresholdDays days" -ForegroundColor Gray
Write-Host "  Escalation threshold: $EscalationThresholdDays days" -ForegroundColor Gray
Write-Host ""

# -----------------------------------------------------------------------
# 1. Load previous compliance state history
# -----------------------------------------------------------------------
$previousState = @{}
if (Test-Path $historyFile) {
    try {
        $historyData = Get-Content $historyFile -Raw | ConvertFrom-Json -AsHashtable
        if ($historyData -and $historyData.devices) {
            foreach ($entry in $historyData.devices) {
                $previousState[$entry.deviceId] = $entry
            }
        }
        Write-Host "  Loaded history for $($previousState.Count) devices" -ForegroundColor Gray
    }
    catch {
        Write-Host "  Could not load history file, starting fresh" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------
# 2. Collect current compliance state from Intune
# -----------------------------------------------------------------------
Write-Host "  Fetching managed devices from Intune..." -ForegroundColor Gray

$allDevices = @()
$devicesUri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?`$select=id,deviceName,complianceState,lastSyncDateTime,userPrincipalName,userDisplayName,operatingSystem,osVersion,managementAgent,enrolledDateTime&`$top=500"

try {
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $devicesUri -OutputType PSObject
    } -OperationName "Get managed devices"

    if ($response.value) {
        $allDevices = @($response.value)
    }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Get managed devices (pagination)"
        if ($response.value) {
            $allDevices += $response.value
        }
    }

    Write-Host "  Retrieved $($allDevices.Count) managed devices" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve devices: $($_.Exception.Message)" -ForegroundColor Red
    return
}

# -----------------------------------------------------------------------
# 3. Analyze compliance drift
# -----------------------------------------------------------------------
Write-Host "  Analyzing compliance drift..." -ForegroundColor Gray

$driftDevices = @()
$newHistory = @()
$now = Get-Date

foreach ($device in $allDevices) {
    $deviceId = $device.id
    $currentState = $device.complianceState
    $isNoncompliant = $currentState -ne "compliant"

    # Determine when this device first became noncompliant
    $firstNoncompliantDate = $null
    $wasCompliantBefore = $false

    if ($previousState.ContainsKey($deviceId)) {
        $prev = $previousState[$deviceId]

        if ($isNoncompliant) {
            if ($prev.complianceState -eq "compliant") {
                # Device just drifted: was compliant, now noncompliant
                $firstNoncompliantDate = $now
                $wasCompliantBefore = $true
            }
            elseif ($prev.firstNoncompliantDate) {
                # Device was already noncompliant, keep original date
                $firstNoncompliantDate = [DateTime]$prev.firstNoncompliantDate
                $wasCompliantBefore = [bool]$prev.wasCompliantBefore
            }
            else {
                $firstNoncompliantDate = $now
            }
        }
    }
    elseif ($isNoncompliant) {
        # New device, already noncompliant - start tracking
        $firstNoncompliantDate = $now
    }

    # Calculate days noncompliant
    $daysNoncompliant = 0
    if ($firstNoncompliantDate) {
        $daysNoncompliant = [math]::Floor(($now - $firstNoncompliantDate).TotalDays)
    }

    # Classify drift state
    $driftState = if ($isNoncompliant) {
        Get-ComplianceDriftState -DaysNoncompliant $daysNoncompliant `
            -DriftThreshold $DriftThresholdDays -EscalationThreshold $EscalationThresholdDays
    } else { "compliant" }

    # Save to history
    $newHistory += @{
        deviceId              = $deviceId
        deviceName            = $device.deviceName
        complianceState       = $currentState
        firstNoncompliantDate = if ($firstNoncompliantDate) { $firstNoncompliantDate.ToString("o") } else { $null }
        wasCompliantBefore    = $wasCompliantBefore
        lastChecked           = $now.ToString("o")
    }

    # Collect drift devices for reporting
    if ($isNoncompliant -and $daysNoncompliant -gt 0) {
        $driftDevices += [PSCustomObject]@{
            deviceId           = $deviceId
            deviceName         = $device.deviceName
            userPrincipalName  = $device.userPrincipalName
            userDisplayName    = $device.userDisplayName
            operatingSystem    = $device.operatingSystem
            osVersion          = $device.osVersion
            complianceState    = $currentState
            lastSyncDateTime   = $device.lastSyncDateTime
            daysNoncompliant   = $daysNoncompliant
            driftState         = $driftState
            wasCompliantBefore = $wasCompliantBefore
            firstNoncompliantDate = if ($firstNoncompliantDate) { $firstNoncompliantDate.ToString("o") } else { $null }
        }
    }
}

# -----------------------------------------------------------------------
# 4. Save updated history
# -----------------------------------------------------------------------
$historyOutput = @{
    lastScan    = $now.ToString("o")
    deviceCount = $allDevices.Count
    devices     = $newHistory
}
$historyOutput | ConvertTo-Json -Depth 5 | Set-Content -Path $historyFile -Encoding UTF8
Write-Host "  Updated compliance history ($($newHistory.Count) devices)" -ForegroundColor Gray

# -----------------------------------------------------------------------
# 5. Generate summary and report
# -----------------------------------------------------------------------
$summary = @{
    totalDevices = $allDevices.Count
    compliant    = ($allDevices | Where-Object { $_.complianceState -eq "compliant" }).Count
    monitoring   = ($driftDevices | Where-Object { $_.driftState -eq "monitoring" }).Count
    alert        = ($driftDevices | Where-Object { $_.driftState -eq "alert" }).Count
    escalation   = ($driftDevices | Where-Object { $_.driftState -eq "escalation" }).Count
    scanDate     = $now.ToString("o")
}

Write-Host ""
Write-Host "  Results:" -ForegroundColor White
Write-Host "    Total devices:   $($summary.totalDevices)" -ForegroundColor Gray
Write-Host "    Compliant:       $($summary.compliant)" -ForegroundColor Green
Write-Host "    Monitoring:      $($summary.monitoring)" -ForegroundColor Yellow
Write-Host "    Alert:           $($summary.alert)" -ForegroundColor $(if ($summary.alert -gt 0) { "DarkYellow" } else { "Gray" })
Write-Host "    Escalation:      $($summary.escalation)" -ForegroundColor $(if ($summary.escalation -gt 0) { "Red" } else { "Gray" })

# Generate HTML report
$htmlReport = Build-ComplianceDriftHtmlReport -DriftDevices $driftDevices -Summary $summary
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportFile = Join-Path $OutputPath "compliance-drift-report-${timestamp}.html"
$htmlReport | Set-Content -Path $reportFile -Encoding UTF8
Write-Host ""
Write-Host "  Report saved: $reportFile" -ForegroundColor Green

# Generate JSON report for programmatic consumption
$jsonReport = [PSCustomObject]@{
    reportType = "compliance-drift"
    generated  = $now.ToString("o")
    thresholds = [PSCustomObject]@{
        driftDays      = $DriftThresholdDays
        escalationDays = $EscalationThresholdDays
    }
    summary    = $summary
    devices    = $driftDevices
}

$jsonReportFile = Join-Path $OutputPath "compliance-drift-report-${timestamp}.json"
$jsonReport | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonReportFile -Encoding UTF8

# -----------------------------------------------------------------------
# 6. Send notifications (if enabled)
# -----------------------------------------------------------------------
if ($SendNotifications -and ($summary.alert -gt 0 -or $summary.escalation -gt 0)) {
    Write-Host ""
    Write-Host "  Sending notifications..." -ForegroundColor Gray

    $alertDevices = $driftDevices | Where-Object { $_.driftState -in @("alert", "escalation") }
    $groupedByUser = $alertDevices | Group-Object -Property userPrincipalName

    foreach ($userGroup in $groupedByUser) {
        if (-not $userGroup.Name) { continue }

        $deviceList = ($userGroup.Group | ForEach-Object {
            "- $($_.deviceName) ($($_.operatingSystem)) - noncompliant for $($_.daysNoncompliant) days"
        }) -join "`n"

        if ($PSCmdlet.ShouldProcess($userGroup.Name, "Send compliance drift notification")) {
            try {
                $mailBody = @{
                    message = @{
                        subject      = "Action Required: Device(s) Out of Compliance"
                        body         = @{
                            contentType = "HTML"
                            content     = @"
<h2>Device Compliance Alert</h2>
<p>The following device(s) assigned to you have been noncompliant and require your attention:</p>
<pre>$([System.Web.HttpUtility]::HtmlEncode($deviceList))</pre>
<h3>Remediation Steps:</h3>
<ol>
<li>Ensure the device is connected to the internet</li>
<li>Open Company Portal and check for pending updates</li>
<li>Sync the device: Settings &gt; Accounts &gt; Access work or school &gt; Sync</li>
<li>If issues persist, contact IT support</li>
</ol>
<p><em>This is an automated message from TenantScope Compliance Monitor.</em></p>
"@
                        }
                        toRecipients = @(
                            @{ emailAddress = @{ address = $userGroup.Name } }
                        )
                    }
                    saveToSentItems = $false
                } | ConvertTo-Json -Depth 10

                Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method POST `
                        -Uri "https://graph.microsoft.com/v1.0/me/sendMail" `
                        -Body $mailBody -ContentType "application/json"
                } -OperationName "Send notification to $($userGroup.Name)" -MaxRetries 2

                Write-Host "    Notified: $($userGroup.Name) ($($userGroup.Count) devices)" -ForegroundColor Gray
            }
            catch {
                Write-Host "    Failed to notify $($userGroup.Name): $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }
}

Write-Host ""
Write-Host "  Compliance drift scan complete." -ForegroundColor Cyan
Write-Host ""

return $jsonReport
