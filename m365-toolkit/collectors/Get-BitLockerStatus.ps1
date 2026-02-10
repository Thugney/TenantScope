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
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
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

    # Reuse managed devices from SharedData (populated by Get-DeviceData) to avoid
    # a duplicate API call. Falls back to fetching directly if SharedData not available.
    $allDevices = @()
    if ($SharedData -and $SharedData.ContainsKey('ManagedDevices') -and $SharedData['ManagedDevices'].Count -gt 0) {
        # Reuse devices already fetched by Get-DeviceData - filter to Windows only
        $allDevices = @($SharedData['ManagedDevices'] | Where-Object {
            $os = if ($_.OperatingSystem) { $_.OperatingSystem } else { $_.operatingSystem }
            $os -like "Windows*"
        })
        Write-Host "      Reusing $($allDevices.Count) Windows devices from shared data (no extra API call)" -ForegroundColor Gray
    }
    else {
        # Fallback: fetch from API if shared data not available
        $devicesUri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices"

        do {
            $devicesResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $devicesUri -OutputType PSObject
            } -OperationName "Device retrieval"

            if ($devicesResponse.value) {
                $allDevices += $devicesResponse.value
            }
            $devicesUri = $devicesResponse.'@odata.nextLink'

            if ($allDevices.Count % 100 -eq 0 -and $allDevices.Count -gt 0) {
                Write-Host "      Retrieved $($allDevices.Count) devices..." -ForegroundColor Gray
            }
        } while ($devicesUri)

        # Filter to Windows devices only (client-side)
        $allDevices = $allDevices | Where-Object { $_.operatingSystem -like "Windows*" }

        Write-Host "      Retrieved $($allDevices.Count) Windows devices" -ForegroundColor Gray
    }

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
        unknownDevices = 0
        devicesWithRecoveryKeys = 0
        encryptionRate = 0
    }

    foreach ($device in $allDevices) {
        $hasRecoveryKey = $recoveryKeys.ContainsKey($device.id)
        $recoveryKeyInfo = if ($hasRecoveryKey) { $recoveryKeys[$device.id] } else { @() }

        # Determine encryption state (isEncrypted is boolean only - no encryptionState in API)
        # Handle both PascalCase (from SDK/SharedData) and camelCase (from REST)
        $isEncryptedRaw = if ($null -ne $device.IsEncrypted) { $device.IsEncrypted } else { $device.isEncrypted }
        # Use lowercase values to match dashboard expectations
        $encryptionState = if ($null -eq $isEncryptedRaw) {
            "unknown"
        } elseif ($isEncryptedRaw -eq $true) {
            "encrypted"
        } else {
            "notEncrypted"
        }

        $lastSyncVal = if ($device.LastSyncDateTime) { $device.LastSyncDateTime } else { $device.lastSyncDateTime }
        $daysSinceSync = Get-DaysSinceDate -DateValue $lastSyncVal

        $processedDevice = [PSCustomObject]@{
            id                = if ($device.Id) { $device.Id } else { $device.id }
            deviceName        = if ($device.DeviceName) { $device.DeviceName } else { $device.deviceName }
            userPrincipalName = if ($device.UserPrincipalName) { $device.UserPrincipalName } else { $device.userPrincipalName }
            manufacturer      = if ($device.Manufacturer) { $device.Manufacturer } else { $device.manufacturer }
            model             = if ($device.Model) { $device.Model } else { $device.model }
            serialNumber      = if ($device.SerialNumber) { $device.SerialNumber } else { $device.serialNumber }
            osVersion         = if ($device.OsVersion) { $device.OsVersion } else { $device.osVersion }
            complianceState   = if ($device.ComplianceState) { $device.ComplianceState } else { $device.complianceState }
            lastSyncDateTime  = Format-IsoDate -DateValue $lastSyncVal
            daysSinceSync     = $daysSinceSync
            # Encryption info
            isEncrypted       = if ($null -eq $isEncryptedRaw) { $null } else { [bool]$isEncryptedRaw }
            encryptionState   = $encryptionState
            # Recovery keys (use recoveryKeyEscrowed for dashboard compatibility)
            hasRecoveryKey    = $hasRecoveryKey
            recoveryKeyEscrowed = $hasRecoveryKey
            recoveryKeyCount  = $recoveryKeyInfo.Count
            recoveryKeys      = $recoveryKeyInfo
            # Compliance flags
            needsEncryption   = ($encryptionState -eq "notEncrypted")
        }

        $processedDevices += $processedDevice
        $deviceCount++

        # Update summary
        $summary.totalDevices++
        switch ($encryptionState) {
            "encrypted"     { $summary.encryptedDevices++ }
            "notEncrypted"  { $summary.notEncryptedDevices++ }
            default         { $summary.unknownDevices++ }
        }
        if ($hasRecoveryKey) { $summary.devicesWithRecoveryKeys++ }
    }

    # Calculate encryption rate
    if ($summary.totalDevices -gt 0) {
        $summary.encryptionRate = [Math]::Round(($summary.encryptedDevices / $summary.totalDevices) * 100, 1)
    }

    # Build manufacturer breakdown
    $manufacturerBreakdown = @{}
    foreach ($device in $processedDevices) {
        $mfr = if ($device.manufacturer) { $device.manufacturer } else { "Unknown" }
        if (-not $manufacturerBreakdown.ContainsKey($mfr)) {
            $manufacturerBreakdown[$mfr] = @{ total = 0; encrypted = 0 }
        }
        $manufacturerBreakdown[$mfr].total++
        if ($device.encryptionState -eq "encrypted") {
            $manufacturerBreakdown[$mfr].encrypted++
        }
    }
    $summary.manufacturerBreakdown = $manufacturerBreakdown

    # Build OS breakdown (Windows 11 vs Windows 10)
    $osBreakdown = @{}
    foreach ($device in $processedDevices) {
        $osType = "Unknown"
        if ($device.osVersion) {
            # Windows 11 builds start with 10.0.22000 and higher
            # Windows 10 builds are 10.0.19xxx
            if ($device.osVersion -match "10\.0\.(2[2-9]\d{3}|[3-9]\d{4})") {
                $osType = "Windows 11"
            }
            elseif ($device.osVersion -match "10\.0\.1\d{4}") {
                $osType = "Windows 10"
            }
        }
        if (-not $osBreakdown.ContainsKey($osType)) {
            $osBreakdown[$osType] = @{ total = 0; encrypted = 0 }
        }
        $osBreakdown[$osType].total++
        if ($device.encryptionState -eq "encrypted") {
            $osBreakdown[$osType].encrypted++
        }
    }
    $summary.osBreakdown = $osBreakdown

    # Sort by encryption state (not encrypted first)
    $processedDevices = $processedDevices | Sort-Object -Property @{
        Expression = {
            switch ($_.encryptionState) {
                "notEncrypted"  { 0 }
                "unknown"       { 1 }
                "encrypted"     { 2 }
                default         { 3 }
            }
        }
    }

    # ========================================
    # Generate Insights
    # ========================================
    $insights = @()

    # Insight: Not encrypted devices
    if ($summary.notEncryptedDevices -gt 0) {
        $insights += [PSCustomObject]@{
            id = "not-encrypted-devices"
            severity = "critical"
            description = "$($summary.notEncryptedDevices) devices are not encrypted with BitLocker"
            affectedDevices = $summary.notEncryptedDevices
            recommendedAction = "Enable BitLocker encryption on these devices to protect sensitive data"
            category = "Security"
        }
    }

    # Insight: Missing recovery keys
    $encryptedWithoutKeys = ($processedDevices | Where-Object {
        $_.encryptionState -eq "encrypted" -and $_.recoveryKeyEscrowed -eq $false
    }).Count
    if ($encryptedWithoutKeys -gt 0) {
        $insights += [PSCustomObject]@{
            id = "missing-recovery-keys"
            severity = "high"
            description = "$encryptedWithoutKeys encrypted devices do not have recovery keys escrowed to Azure AD"
            affectedDevices = $encryptedWithoutKeys
            recommendedAction = "Backup BitLocker recovery keys to Azure AD for these devices"
            category = "Recovery"
        }
    }

    # Insight: Stale devices (not synced in 14+ days)
    $staleDevices = ($processedDevices | Where-Object { $_.daysSinceSync -gt 14 }).Count
    if ($staleDevices -gt 0) {
        $insights += [PSCustomObject]@{
            id = "stale-devices"
            severity = "medium"
            description = "$staleDevices devices have not synced in over 14 days"
            affectedDevices = $staleDevices
            recommendedAction = "Verify these devices are still active and connected to the network"
            category = "Compliance"
        }
    }

    # Insight: Multiple volume encryption
    $multiVolumeDevices = ($processedDevices | Where-Object { $_.recoveryKeyCount -gt 1 }).Count
    if ($multiVolumeDevices -gt 0) {
        $insights += [PSCustomObject]@{
            id = "multiple-volumes"
            severity = "info"
            description = "$multiVolumeDevices devices have multiple volumes encrypted with separate recovery keys"
            affectedDevices = $multiVolumeDevices
            recommendedAction = "Ensure all recovery keys are properly documented for disaster recovery"
            category = "Recovery"
        }
    }

    # Insight: Low encryption rate
    if ($summary.encryptionRate -lt 90 -and $summary.totalDevices -gt 0) {
        $insights += [PSCustomObject]@{
            id = "low-encryption-rate"
            severity = "high"
            description = "Overall encryption rate is only $($summary.encryptionRate)%"
            affectedDevices = $summary.notEncryptedDevices
            recommendedAction = "Review and remediate devices that are not encrypted to improve security posture"
            category = "Security"
        }
    }

    Write-Host "      Generated $($insights.Count) BitLocker insights" -ForegroundColor Gray

    # Add additional summary fields
    $summary.devicesMissingKeys = $encryptedWithoutKeys
    $summary.recoveryKeyRate = if ($summary.encryptedDevices -gt 0) {
        [Math]::Round(($summary.devicesWithRecoveryKeys / $summary.encryptedDevices) * 100, 1)
    } else { 0 }

    # Build output
    $output = @{
        devices = $processedDevices
        insights = $insights
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
