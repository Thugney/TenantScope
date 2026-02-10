# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Credential Guard and Memory Integrity coverage from MDE.

.DESCRIPTION
    Uses Defender Advanced Hunting to read device secure configuration
    assessments for Credential Guard and Memory Integrity. Produces
    device-level coverage to identify gaps.

    API endpoint:
    - POST https://api.securitycenter.microsoft.com/api/advancedhunting/run

    Required permissions:
    - AdvancedHunting.Read.All
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

function Get-ControlName {
    param(
        [string]$ConfigurationName,
        [string]$ConfigurationSubcategory
    )
    $name = ($ConfigurationName + " " + $ConfigurationSubcategory).ToLowerInvariant()
    if ($name -match "credential guard") { return "Credential Guard" }
    if ($name -match "memory integrity") { return "Memory Integrity" }
    return $null
}

function Normalize-ControlStatus {
    param(
        $IsCompliant,
        $IsApplicable
    )
    if ($IsApplicable -eq $false) { return "notApplicable" }
    if ($IsCompliant -eq $true) { return "compliant" }
    if ($IsCompliant -eq $false) { return "noncompliant" }
    return "unknown"
}

function Get-WorstControlStatus {
    param(
        [string]$Current,
        [string]$Candidate
    )

    $rank = @{
        noncompliant = 4
        unknown = 3
        notApplicable = 1
        compliant = 0
    }
    $currentRank = if ($rank.ContainsKey($Current)) { $rank[$Current] } else { 0 }
    $candidateRank = if ($rank.ContainsKey($Candidate)) { $rank[$Candidate] } else { 0 }
    if ($candidateRank -gt $currentRank) { return $Candidate }
    return $Current
}

$errors = @()
$apiBase = "https://api.securitycenter.microsoft.com"

try {
    Write-Host "    Collecting device hardening coverage..." -ForegroundColor Gray

    $query = @"
DeviceTvmSecureConfigurationAssessment
| where ConfigurationSubcategory has "Credential Guard" or ConfigurationSubcategory has "Memory integrity"
| project DeviceId, DeviceName, ConfigurationName, ConfigurationSubcategory, IsCompliant, IsApplicable
"@
    $body = @{ Query = $query } | ConvertTo-Json -Depth 4

    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method POST -Uri "$apiBase/api/advancedhunting/run" -Body $body -OutputType PSObject
    } -OperationName "Device hardening coverage"

    $rows = @()
    if ($response.Results) { $rows = $response.Results }
    elseif ($response.results) { $rows = $response.results }

    $deviceMap = @{}

    foreach ($row in $rows) {
        if (-not $row.DeviceId) { continue }
        $control = Get-ControlName -ConfigurationName $row.ConfigurationName -ConfigurationSubcategory $row.ConfigurationSubcategory
        if (-not $control) { continue }

        if (-not $deviceMap.ContainsKey($row.DeviceId)) {
            $deviceMap[$row.DeviceId] = @{
                deviceId = $row.DeviceId
                deviceName = $row.DeviceName
                credentialGuardStatus = "unknown"
                memoryIntegrityStatus = "unknown"
            }
        }

        $status = Normalize-ControlStatus -IsCompliant $row.IsCompliant -IsApplicable $row.IsApplicable
        if ($control -eq "Credential Guard") {
            $deviceMap[$row.DeviceId].credentialGuardStatus = Get-WorstControlStatus -Current $deviceMap[$row.DeviceId].credentialGuardStatus -Candidate $status
        }
        elseif ($control -eq "Memory Integrity") {
            $deviceMap[$row.DeviceId].memoryIntegrityStatus = Get-WorstControlStatus -Current $deviceMap[$row.DeviceId].memoryIntegrityStatus -Candidate $status
        }
    }

    $devices = @()
    $summary = @{
        totalDevices = 0
        credentialGuardGaps = 0
        memoryIntegrityGaps = 0
        unknownDevices = 0
    }

    foreach ($entry in $deviceMap.GetEnumerator()) {
        $row = $entry.Value
        $issues = @()
        if ($row.credentialGuardStatus -eq "noncompliant" -or $row.credentialGuardStatus -eq "unknown") {
            $issues += "Credential Guard"
            $summary.credentialGuardGaps++
        }
        if ($row.memoryIntegrityStatus -eq "noncompliant" -or $row.memoryIntegrityStatus -eq "unknown") {
            $issues += "Memory Integrity"
            $summary.memoryIntegrityGaps++
        }
        if ($issues.Count -eq 0) {
            # still track unknowns
        }
        if ($row.credentialGuardStatus -eq "unknown" -or $row.memoryIntegrityStatus -eq "unknown") {
            $summary.unknownDevices++
        }

        $devices += [PSCustomObject]@{
            deviceId = $row.deviceId
            deviceName = $row.deviceName
            credentialGuardStatus = $row.credentialGuardStatus
            memoryIntegrityStatus = $row.memoryIntegrityStatus
            issues = $issues
            hasIssues = ($issues.Count -gt 0)
        }
    }

    $summary.totalDevices = $devices.Count

    $output = @{
        devices = $devices
        summary = $summary
        collectionDate = (Get-Date).ToString("o")
    }

    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null
    Write-Host "    [OK] Collected hardening coverage for $($devices.Count) devices" -ForegroundColor Green
    return New-CollectorResult -Success $true -Count $devices.Count -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = @{
        devices = @()
        summary = @{
            totalDevices = 0
            credentialGuardGaps = 0
            memoryIntegrityGaps = 0
            unknownDevices = 0
        }
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null
    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
