# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Local Admin / LAPS coverage and rotation status.

.DESCRIPTION
    Attempts to read LAPS device local credentials metadata to identify
    devices missing LAPS coverage or with stale rotation.

    Graph API endpoints (beta):
    - GET /deviceManagement/deviceLocalCredentials

    Required scopes:
    - DeviceManagementManagedDevices.Read.All
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
$rotationThreshold = if ($Config.thresholds -and $Config.thresholds.lapsRotationDays) {
    [int]$Config.thresholds.lapsRotationDays
} else {
    30
}
$localAdminDays = if ($Config.collection -and $Config.collection.localAdminLogonDays) {
    [int]$Config.collection.localAdminLogonDays
} else {
    30
}

try {
    Write-Host "    Collecting LAPS coverage..." -ForegroundColor Gray

    $windowsDevices = @()
    if ($SharedData -and $SharedData.ContainsKey('ManagedDevices') -and $SharedData['ManagedDevices'].Count -gt 0) {
        $windowsDevices = @($SharedData['ManagedDevices'] | Where-Object {
            $os = if ($_.OperatingSystem) { $_.OperatingSystem } else { $_.operatingSystem }
            $os -eq 'Windows'
        })
    }
    else {
        $deviceResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$filter=operatingSystem eq 'Windows'&`$select=id,deviceName,userPrincipalName,lastSyncDateTime&`$top=500" `
                -OutputType PSObject
        } -OperationName "Windows devices for LAPS"

        $windowsDevices = @($deviceResponse.value)
        while ($deviceResponse.'@odata.nextLink') {
            $deviceResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $deviceResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Windows devices for LAPS pagination"
            $windowsDevices += $deviceResponse.value
        }
    }

    $lapsRecords = @()
    $lapsApiFailed = $false
    try {
        $lapsResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/deviceLocalCredentials" -OutputType PSObject
        } -OperationName "LAPS device local credentials"

        if ($lapsResponse.value) {
            $lapsRecords = $lapsResponse.value
            while ($lapsResponse.'@odata.nextLink') {
                $lapsResponse = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method GET -Uri $lapsResponse.'@odata.nextLink' -OutputType PSObject
                } -OperationName "LAPS device local credentials pagination"
                if ($lapsResponse.value) {
                    $lapsRecords += $lapsResponse.value
                }
            }
        }
    }
    catch {
        $errors += "LAPS API: $($_.Exception.Message)"
        $lapsApiFailed = $true
    }

    $lapsMap = @{}
    foreach ($record in $lapsRecords) {
        $deviceId = Get-GraphPropertyValue -Object $record -PropertyNames @("managedDeviceId", "deviceId", "id")
        if ([string]::IsNullOrWhiteSpace($deviceId)) { continue }
        $lapsMap[$deviceId] = $record
    }

    $devices = @()
    $summary = @{
        totalDevices = 0
        lapsEnabled = 0
        lapsMissing = 0
        rotationStale = 0
        rotationThresholdDays = $rotationThreshold
        dataAvailable = (-not $lapsApiFailed)
        localAdminObserved = 0
        localAdminLookbackDays = $localAdminDays
    }

    foreach ($device in $windowsDevices) {
        $deviceId = if ($device.id) { $device.id } else { $device.Id }
        if ([string]::IsNullOrWhiteSpace($deviceId)) { continue }

        $record = if ($lapsMap.ContainsKey($deviceId)) { $lapsMap[$deviceId] } else { $null }
        $localAdminInfo = if ($localAdminMap.ContainsKey($deviceId)) { $localAdminMap[$deviceId] } else { $null }
        $lapsEnabled = $false
        $lastRotation = $null
        $accountName = $null
        if ($record) {
            $lapsEnabled = $true
            $lastRotation = Get-GraphPropertyValue -Object $record -PropertyNames @(
                "lastBackupDateTime",
                "lastPasswordRotationDateTime",
                "lastUpdatedDateTime",
                "modifiedDateTime"
            )
            $accountName = Get-GraphPropertyValue -Object $record -PropertyNames @("accountName", "localAdminAccountName", "userName")
        }

        $rotationAgeDays = Get-DaysSinceDate -DateValue $lastRotation
        $status = "healthy"
        $localAdminObserved = if ($localAdminInfo) { $true } else { $false }
        if ($localAdminObserved) { $summary.localAdminObserved++ }
        $localAdminLastSeen = if ($localAdminInfo) { $localAdminInfo.lastSeen } else { $null }
        $localAdminLogonCount = if ($localAdminInfo) { $localAdminInfo.logonCount } else { 0 }

        if ($lapsApiFailed) {
            $status = "unknown"
        }
        else {
            if (-not $lapsEnabled) {
                $status = "missing"
                $summary.lapsMissing++
            }
            elseif ($rotationAgeDays -ne $null -and $rotationAgeDays -gt $rotationThreshold) {
                $status = "stale"
                $summary.rotationStale++
            }
            else {
                $summary.lapsEnabled++
            }
        }

        $devices += [PSCustomObject]@{
            deviceId = $deviceId
            deviceName = if ($device.deviceName) { $device.deviceName } else { $device.DeviceName }
            userPrincipalName = if ($device.userPrincipalName) { $device.userPrincipalName } else { $device.UserPrincipalName }
            lapsEnabled = $lapsEnabled
            accountName = $accountName
            lastRotationDateTime = Format-IsoDate -DateValue $lastRotation
            rotationAgeDays = $rotationAgeDays
            status = $status
            hasIssues = ($status -ne "healthy" -and $status -ne "unknown")
            localAdminObserved = if ($localAdminQueryFailed) { $null } else { $localAdminObserved }
            localAdminLastSeen = if ($localAdminQueryFailed) { $null } else { Format-IsoDate -DateValue $localAdminLastSeen }
            localAdminLogonCount = if ($localAdminQueryFailed) { $null } else { $localAdminLogonCount }
        }
    }

    $summary.totalDevices = $devices.Count

    $output = @{
        devices = $devices
        summary = $summary
        collectionDate = (Get-Date).ToString("o")
    }

    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null
    Write-Host "    [OK] Collected LAPS coverage for $($devices.Count) devices" -ForegroundColor Green
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
            lapsEnabled = 0
            lapsMissing = 0
            rotationStale = 0
            rotationThresholdDays = $rotationThreshold
            dataAvailable = $false
            localAdminObserved = 0
            localAdminLookbackDays = $localAdminDays
        }
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null
    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
    $localAdminMap = @{}
    $localAdminQueryFailed = $false
    try {
        $query = @"
DeviceLogonEvents
| where Timestamp >= ago(${localAdminDays}d)
| where IsLocalAdmin == true
| summarize localAdminLogons=count(), lastSeen=max(Timestamp) by DeviceId, DeviceName
"@
        $body = @{ Query = $query } | ConvertTo-Json -Depth 4
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method POST -Uri "https://api.securitycenter.microsoft.com/api/advancedhunting/run" -Body $body -OutputType PSObject
        } -OperationName "Local admin logons"

        $rows = @()
        if ($response.Results) { $rows = $response.Results }
        elseif ($response.results) { $rows = $response.results }

        foreach ($row in $rows) {
            if (-not $row.DeviceId) { continue }
            $localAdminMap[$row.DeviceId] = @{
                logonCount = [int]$row.localAdminLogons
                lastSeen = $row.lastSeen
            }
        }
    }
    catch {
        $errors += "Local admin logons: $($_.Exception.Message)"
        $localAdminQueryFailed = $true
    }
