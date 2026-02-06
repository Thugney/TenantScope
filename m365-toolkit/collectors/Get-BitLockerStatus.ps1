# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects BitLocker encryption status and recovery key information.

.DESCRIPTION
    Retrieves BitLocker encryption status for all Windows devices managed
    by Intune. Provides visibility into encryption compliance and enables
    recovery key lookup capability in the dashboard.

    Graph API endpoints:
    - GET /deviceManagement/managedDevices (filter Windows, encryption fields)
    - GET /informationProtection/bitlocker/recoveryKeys

    Required scopes:
    - DeviceManagementManagedDevices.Read.All
    - BitLockerKey.Read.All (for recovery keys)

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes bitlocker-status.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-BitLockerStatus.ps1 -Config $config -OutputPath ".\data\bitlocker-status.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.DeviceManagement

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# LOCAL HELPER FUNCTIONS
# ============================================================================

function Get-EncryptionReadinessState {
    <#
    .SYNOPSIS
        Maps encryption readiness state to readable status.
    #>
    param([string]$State)

    switch ($State) {
        "ready"     { return "Ready" }
        "notReady"  { return "Not Ready" }
        default     { return $State }
    }
}

function Get-EncryptionState {
    <#
    .SYNOPSIS
        Maps encryption state to readable status.
    #>
    param([string]$State)

    switch ($State) {
        "encrypted"           { return "Encrypted" }
        "notEncrypted"        { return "Not Encrypted" }
        "encryptionSuspended" { return "Suspended" }
        default               { return $State }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$deviceCount = 0

try {
    Write-Host "    Collecting BitLocker encryption status..." -ForegroundColor Gray

    # Get managed devices with encryption information
    # Fetch all devices and filter Windows client-side (server-side filter not reliable)
    $devicesResponse = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$select=id,deviceName,userPrincipalName,operatingSystem,osVersion,isEncrypted,encryptionState,complianceState,lastSyncDateTime,model,manufacturer,serialNumber" `
            -OutputType PSObject
    } -OperationName "Device encryption retrieval"

    $allDevices = @($devicesResponse.value)

    # Handle pagination
    while ($devicesResponse.'@odata.nextLink') {
        $devicesResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $devicesResponse.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Device pagination"
        $allDevices += $devicesResponse.value
    }

    # Filter to Windows devices only (client-side)
    $allDevices = $allDevices | Where-Object { $_.operatingSystem -like "Windows*" }

    Write-Host "      Retrieved $($allDevices.Count) Windows devices" -ForegroundColor Gray

    # Try to get recovery keys (requires BitLockerKey.ReadBasic.All or BitLockerKey.Read.All)
    # Note: User-Agent header is required for BitLocker API
    $recoveryKeys = @{}
    try {
        $headers = @{
            "User-Agent" = "TenantScope/2.0 (PowerShell)"
        }
        $keysResponse = Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/informationProtection/bitlocker/recoveryKeys" `
            -Headers $headers `
            -OutputType PSObject

        foreach ($key in $keysResponse.value) {
            if ($key.deviceId -and -not $recoveryKeys.ContainsKey($key.deviceId)) {
                $recoveryKeys[$key.deviceId] = @()
            }
            if ($key.deviceId) {
                $recoveryKeys[$key.deviceId] += @{
                    keyId = $key.id
                    createdDateTime = $key.createdDateTime
                    volumeType = $key.volumeType
                }
            }
        }

        # Handle pagination
        while ($keysResponse.'@odata.nextLink') {
            $keysResponse = Invoke-MgGraphRequest -Method GET `
                -Uri $keysResponse.'@odata.nextLink' `
                -Headers $headers `
                -OutputType PSObject
            foreach ($key in $keysResponse.value) {
                if ($key.deviceId -and -not $recoveryKeys.ContainsKey($key.deviceId)) {
                    $recoveryKeys[$key.deviceId] = @()
                }
                if ($key.deviceId) {
                    $recoveryKeys[$key.deviceId] += @{
                        keyId = $key.id
                        createdDateTime = $key.createdDateTime
                        volumeType = $key.volumeType
                    }
                }
            }
        }

        Write-Host "      Retrieved recovery key metadata for $($recoveryKeys.Count) devices" -ForegroundColor Gray
    }
    catch {
        # BitLockerKey.ReadBasic.All may not be consented
        $errors += "Recovery keys not accessible (BitLockerKey.ReadBasic.All scope may be required)"
    }

    # Process devices
    $processedDevices = @()
    $summary = @{
        totalDevices = 0
        encryptedDevices = 0
        notEncryptedDevices = 0
        suspendedDevices = 0
        unknownDevices = 0
        devicesWithRecoveryKeys = 0
        encryptionRate = 0
    }

    foreach ($device in $allDevices) {
        $hasRecoveryKey = $recoveryKeys.ContainsKey($device.id)
        $recoveryKeyInfo = if ($hasRecoveryKey) { $recoveryKeys[$device.id] } else { @() }

        # Determine encryption status
        $encryptionStatus = if ($device.isEncrypted) {
            "Encrypted"
        } elseif ($device.encryptionState) {
            Get-EncryptionState -State $device.encryptionState
        } else {
            "Unknown"
        }

        $daysSinceSync = Get-DaysSinceDate -DateValue $device.lastSyncDateTime

        $processedDevice = [PSCustomObject]@{
            id                = $device.id
            deviceName        = $device.deviceName
            userPrincipalName = $device.userPrincipalName
            manufacturer      = $device.manufacturer
            model             = $device.model
            serialNumber      = $device.serialNumber
            osVersion         = $device.osVersion
            complianceState   = $device.complianceState
            lastSyncDateTime  = Format-IsoDate -DateValue $device.lastSyncDateTime
            daysSinceSync     = $daysSinceSync
            # Encryption info
            isEncrypted       = [bool]$device.isEncrypted
            encryptionStatus  = $encryptionStatus
            # Recovery keys
            hasRecoveryKey    = $hasRecoveryKey
            recoveryKeyCount  = $recoveryKeyInfo.Count
            recoveryKeys      = $recoveryKeyInfo
            # Compliance flags
            needsEncryption   = (-not $device.isEncrypted -and $encryptionStatus -ne "Encrypted")
            isSuspended       = ($encryptionStatus -eq "Suspended")
        }

        $processedDevices += $processedDevice
        $deviceCount++

        # Update summary
        $summary.totalDevices++
        switch ($encryptionStatus) {
            "Encrypted"     { $summary.encryptedDevices++ }
            "Not Encrypted" { $summary.notEncryptedDevices++ }
            "Suspended"     { $summary.suspendedDevices++ }
            default         { $summary.unknownDevices++ }
        }
        if ($hasRecoveryKey) { $summary.devicesWithRecoveryKeys++ }
    }

    # Calculate encryption rate
    if ($summary.totalDevices -gt 0) {
        $summary.encryptionRate = [Math]::Round(($summary.encryptedDevices / $summary.totalDevices) * 100, 1)
    }

    # Sort by encryption status (not encrypted first)
    $processedDevices = $processedDevices | Sort-Object -Property @{
        Expression = {
            switch ($_.encryptionStatus) {
                "Not Encrypted" { 0 }
                "Suspended"     { 1 }
                "Unknown"       { 2 }
                "Encrypted"     { 3 }
                default         { 4 }
            }
        }
    }

    # Build output
    $output = @{
        devices = $processedDevices
        summary = $summary
        collectionDate = (Get-Date).ToString("o")
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected BitLocker status for $deviceCount devices ($(($summary.encryptionRate))% encrypted)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $deviceCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Authorization") {
        Write-Host "    [!] BitLocker collection requires Intune license and DeviceManagementManagedDevices.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        devices = @()
        summary = @{}
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
