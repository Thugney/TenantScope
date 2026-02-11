# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects ASR audit/block telemetry from Microsoft Defender Advanced Hunting.

.DESCRIPTION
    Uses the Defender Advanced Hunting API to retrieve ASR rule events and
    summarize telemetry coverage. This complements ASR policy configuration
    with real-world audit/block signal.

    API endpoint:
    - POST https://api.securitycenter.microsoft.com/api/advancedqueries/run

    Required permissions:
    - AdvancedQuery.Read (delegated) or AdvancedQuery.Read.All (application)

    Note: This collector requires Defender API authentication, which is separate
    from Microsoft Graph authentication. The main script handles this via
    Connect-DefenderApi in lib/DefenderApi.ps1.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.
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

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

$errors = @()
$daysBack = if ($Config.collection -and $Config.collection.asrEventDays) { [int]$Config.collection.asrEventDays } else { 30 }

try {
    Write-Host "    Collecting ASR audit events (last $daysBack days)..." -ForegroundColor Gray

    $query = @"
DeviceEvents
| where Timestamp >= ago(${daysBack}d)
| where ActionType startswith "Asr"
| extend fields = parse_json(AdditionalFields)
| extend RuleId = tostring(fields.RuleId)
| extend RuleId = iff(isempty(RuleId), tostring(fields.RuleGuid), RuleId)
| extend RuleName = tostring(fields.RuleName)
| summarize totalEvents=count(),
            blockEvents=countif(ActionType has "Block"),
            auditEvents=countif(ActionType has "Audit"),
            warnEvents=countif(ActionType has "Warn"),
            deviceCount=dcount(DeviceId),
            lastSeen=max(Timestamp)
        by RuleId, RuleName
| order by totalEvents desc
"@

    # Use Graph Security API for Advanced Hunting (requires ThreatHunting.Read.All)
    $response = Invoke-AdvancedHuntingQuery -Query $query -Timespan "P${daysBack}D"

    $rows = @()
    if ($response.Results) {
        $rows = $response.Results
    }
    elseif ($response.results) {
        $rows = $response.results
    }

    $rules = @()
    $summary = @{
        totalEvents = 0
        rulesWithEvents = 0
        devicesAffected = 0
        noisyRules = 0
        daysCovered = $daysBack
    }

    $noiseThreshold = if ($Config.thresholds -and $Config.thresholds.asrNoiseThreshold) {
        [int]$Config.thresholds.asrNoiseThreshold
    } else {
        20
    }

    foreach ($row in $rows) {
        $totalEvents = [int]($row.totalEvents | ForEach-Object { $_ })
        $auditEvents = [int]($row.auditEvents | ForEach-Object { $_ })
        $blockEvents = [int]($row.blockEvents | ForEach-Object { $_ })
        $warnEvents = [int]($row.warnEvents | ForEach-Object { $_ })
        $deviceCount = [int]($row.deviceCount | ForEach-Object { $_ })

        if ($totalEvents -gt 0) {
            $summary.rulesWithEvents++
            $summary.totalEvents += $totalEvents
            $summary.devicesAffected += $deviceCount
        }

        if ($auditEvents -ge $noiseThreshold) {
            $summary.noisyRules++
        }

        $rules += [PSCustomObject]@{
            ruleId      = $row.RuleId
            ruleName    = $row.RuleName
            totalEvents = $totalEvents
            auditEvents = $auditEvents
            blockEvents = $blockEvents
            warnEvents  = $warnEvents
            deviceCount = $deviceCount
            lastSeen    = Format-IsoDate -DateValue $row.lastSeen
            noisy       = ($auditEvents -ge $noiseThreshold)
        }
    }

    $output = @{
        rules = $rules
        summary = $summary
        noiseThreshold = $noiseThreshold
        collectionDate = (Get-Date).ToString("o")
    }

    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null
    Write-Host "    [OK] Collected ASR telemetry for $($rules.Count) rules" -ForegroundColor Green
    return New-CollectorResult -Success $true -Count $rules.Count -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = @{
        rules = @()
        summary = @{
            totalEvents = 0
            rulesWithEvents = 0
            devicesAffected = 0
            noisyRules = 0
            daysCovered = $daysBack
        }
        noiseThreshold = if ($Config.thresholds -and $Config.thresholds.asrNoiseThreshold) { [int]$Config.thresholds.asrNoiseThreshold } else { 20 }
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
