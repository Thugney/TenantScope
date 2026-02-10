# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects endpoint security policy compliance states per device.

.DESCRIPTION
    Retrieves device state compliance for Endpoint Security policies
    (Firewall, Antivirus, Disk Encryption, ASR, Account Protection)
    via Intune endpoint security intents.

    Graph API endpoints:
    - GET /deviceManagement/intents
    - GET /deviceManagement/intents/{id}/deviceStates

    Required scopes:
    - DeviceManagementConfiguration.Read.All
    - DeviceManagementManagedDevices.Read.All (for device name mapping)
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

function Get-EndpointSecurityCategory {
    param($Intent)
    $name = (($Intent.displayName) -as [string])
    if ([string]::IsNullOrWhiteSpace($name)) { $name = "" }
    $nameLower = $name.ToLowerInvariant()

    if ($nameLower -match "attack surface|asr") { return "Attack Surface Reduction" }
    if ($nameLower -match "antivirus|defender|endpoint protection") { return "Antivirus" }
    if ($nameLower -match "firewall") { return "Firewall" }
    if ($nameLower -match "disk encryption|bitlocker|encryption") { return "Disk Encryption" }
    if ($nameLower -match "account protection|local admin|laps") { return "Account Protection" }

    return "Other"
}

function Normalize-ComplianceStatus {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return "unknown" }
    $v = $Value.ToString().ToLowerInvariant()
    switch ($v) {
        "compliant" { return "compliant" }
        "success" { return "compliant" }
        "succeeded" { return "compliant" }
        "noncompliant" { return "noncompliant" }
        "non-compliant" { return "noncompliant" }
        "failed" { return "noncompliant" }
        "error" { return "error" }
        "conflict" { return "conflict" }
        "pending" { return "pending" }
        "notapplicable" { return "notApplicable" }
        default { return "unknown" }
    }
}

function Get-WorstStatus {
    param(
        [string]$Current,
        [string]$Candidate
    )

    $rank = @{
        error = 5
        noncompliant = 4
        conflict = 3
        pending = 2
        notApplicable = 1
        compliant = 0
        unknown = 0
    }

    $currentRank = if ($rank.ContainsKey($Current)) { $rank[$Current] } else { 0 }
    $candidateRank = if ($rank.ContainsKey($Candidate)) { $rank[$Candidate] } else { 0 }
    if ($candidateRank -gt $currentRank) { return $Candidate }
    return $Current
}

$errors = @()

try {
    Write-Host "    Collecting endpoint security policy device states..." -ForegroundColor Gray

    $deviceLookup = @{}
    if ($SharedData -and $SharedData.ContainsKey('ManagedDevices') -and $SharedData['ManagedDevices'].Count -gt 0) {
        foreach ($d in $SharedData['ManagedDevices']) {
            $id = if ($d.Id) { $d.Id } else { $d.id }
            if ([string]::IsNullOrWhiteSpace($id)) { continue }
            $deviceLookup[$id] = $d
        }
    }

    $intentsResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/intents" -OutputType PSObject
    } -OperationName "Endpoint security intents retrieval"

    $intents = @()
    if ($intentsResponse.value) { $intents = $intentsResponse.value }

    $policies = @()
    $deviceMap = @{}

    foreach ($intent in $intents) {
        $category = Get-EndpointSecurityCategory -Intent $intent
        $policyId = $intent.id

        $summary = @{
            compliant = 0
            noncompliant = 0
            error = 0
            conflict = 0
            pending = 0
            notApplicable = 0
            unknown = 0
        }

        try {
            $states = Get-GraphAllPages -Uri "https://graph.microsoft.com/beta/deviceManagement/intents/$policyId/deviceStates" -OperationName "Endpoint security device states"
            foreach ($state in $states) {
                $deviceId = Get-GraphPropertyValue -Object $state -PropertyNames @("deviceId", "managedDeviceId", "id")
                if ([string]::IsNullOrWhiteSpace($deviceId)) { continue }

                $rawStatus = Get-GraphPropertyValue -Object $state -PropertyNames @("status", "state", "complianceState")
                $status = Normalize-ComplianceStatus -Value $rawStatus

                if ($summary.ContainsKey($status)) { $summary[$status]++ } else { $summary.unknown++ }

                if (-not $deviceMap.ContainsKey($deviceId)) {
                    $lookup = if ($deviceLookup.ContainsKey($deviceId)) { $deviceLookup[$deviceId] } else { $null }
                    $deviceName = $null
                    $userPrincipalName = $null
                    if ($lookup) {
                        if ($lookup.DeviceName) { $deviceName = $lookup.DeviceName }
                        elseif ($lookup.deviceName) { $deviceName = $lookup.deviceName }
                        if ($lookup.UserPrincipalName) { $userPrincipalName = $lookup.UserPrincipalName }
                        elseif ($lookup.userPrincipalName) { $userPrincipalName = $lookup.userPrincipalName }
                    }
                    if (-not $deviceName) {
                        $deviceName = Get-GraphPropertyValue -Object $state -PropertyNames @("deviceName", "managedDeviceName")
                    }
                    if (-not $userPrincipalName) {
                        $userPrincipalName = Get-GraphPropertyValue -Object $state -PropertyNames @("userPrincipalName", "userName")
                    }
                    $deviceMap[$deviceId] = @{
                        deviceId = $deviceId
                        deviceName = $deviceName
                        userPrincipalName = $userPrincipalName
                        categories = @{}
                        worstStatus = "compliant"
                    }
                }

                $deviceMap[$deviceId].categories[$category] = $status
                $deviceMap[$deviceId].worstStatus = Get-WorstStatus -Current $deviceMap[$deviceId].worstStatus -Candidate $status
            }
        }
        catch {
            $errors += "Intent $($intent.displayName): $($_.Exception.Message)"
        }

        $policies += [PSCustomObject]@{
            id = $policyId
            displayName = $intent.displayName
            description = $intent.description
            category = $category
            createdDateTime = Format-IsoDate -DateValue $intent.createdDateTime
            lastModifiedDateTime = Format-IsoDate -DateValue $intent.lastModifiedDateTime
            isAssigned = $intent.isAssigned
            summary = $summary
        }
    }

    $devices = @()
    foreach ($entry in $deviceMap.GetEnumerator()) {
        $row = $entry.Value
        $row.hasIssues = ($row.worstStatus -ne "compliant" -and $row.worstStatus -ne "unknown")
        $devices += [PSCustomObject]$row
    }

    $output = @{
        policies = $policies
        devices = $devices
        summary = @{
            totalPolicies = $policies.Count
            totalDevices = $devices.Count
            devicesWithIssues = ($devices | Where-Object { $_.hasIssues }).Count
        }
        collectionDate = (Get-Date).ToString("o")
    }

    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null
    Write-Host "    [OK] Collected endpoint security device states for $($devices.Count) devices" -ForegroundColor Green
    return New-CollectorResult -Success $true -Count $devices.Count -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = @{
        policies = @()
        devices = @()
        summary = @{
            totalPolicies = 0
            totalDevices = 0
            devicesWithIssues = 0
        }
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null
    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
