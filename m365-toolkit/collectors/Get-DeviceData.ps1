# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Intune managed device data from Microsoft Graph.

.DESCRIPTION
    Retrieves all devices managed by Microsoft Intune including compliance
    status, encryption state, and last sync time. Identifies stale devices
    that haven't synced within the configured threshold.

    Graph API endpoint: GET /deviceManagement/managedDevices
    Required scope: DeviceManagementManagedDevices.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes devices.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of devices collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-DeviceData.ps1 -Config $config -OutputPath ".\data\devices.json"
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
# Device-specific functions that don't belong in CollectorBase
# ============================================================================

function Get-ComplianceState {
    <#
    .SYNOPSIS
        Maps Intune compliance state to our schema values.
    #>
    param([string]$IntuneState)

    switch ($IntuneState) {
        "compliant"     { return "compliant" }
        "noncompliant"  { return "noncompliant" }
        "conflict"      { return "noncompliant" }
        "error"         { return "unknown" }
        "inGracePeriod" { return "noncompliant" }
        "configManager" { return "unknown" }
        default         { return "unknown" }
    }
}

function Get-DeviceOwnership {
    <#
    .SYNOPSIS
        Maps Intune ownership type to our schema values.
    #>
    param([string]$OwnerType)

    switch ($OwnerType) {
        "personal" { return "personal" }
        "company"  { return "corporate" }
        default    { return "corporate" }
    }
}

function Get-ManagementAgent {
    <#
    .SYNOPSIS
        Maps Intune management agent to our schema values.
    #>
    param([string]$Agent)

    switch ($Agent) {
        "mdm"                           { return "mdm" }
        "easMdm"                        { return "easMdm" }
        "configurationManagerClient"    { return "configManager" }
        "configurationManagerClientMdm" { return "configManager" }
        default                         { return $Agent }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$deviceCount = 0

try {
    Write-Host "    Collecting Intune managed devices..." -ForegroundColor Gray

    # Get stale threshold from config
    $staleThreshold = $Config.thresholds.staleDeviceDays
    if ($null -eq $staleThreshold -or $staleThreshold -le 0) {
        $staleThreshold = 90
    }

    # Retrieve all managed devices from Intune
    $managedDevices = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgDeviceManagementManagedDevice -All
    } -OperationName "Intune device retrieval"

    Write-Host "      Retrieved $($managedDevices.Count) devices from Intune" -ForegroundColor Gray

    # Process each device
    $processedDevices = @()

    foreach ($device in $managedDevices) {
        # Calculate days since last sync using shared utility
        $daysSinceSync = Get-DaysSinceDate -DateValue $device.LastSyncDateTime

        # Determine if device is stale using shared utility
        $activityStatus = Get-ActivityStatus -DaysSinceActivity $daysSinceSync -InactiveThreshold $staleThreshold
        $isStale = $activityStatus.isInactive

        # Map compliance state
        $complianceState = Get-ComplianceState -IntuneState $device.ComplianceState

        # Map ownership
        $ownership = Get-DeviceOwnership -OwnerType $device.ManagedDeviceOwnerType

        # Map management agent
        $managementAgent = Get-ManagementAgent -Agent $device.ManagementAgent

        # Calculate certificate expiry using shared utilities
        $daysUntilCertExpiry = Get-DaysUntilDate -DateValue $device.ManagedDeviceCertificateExpirationDate
        $certStatus = Get-CertificateStatus -DaysUntilExpiry $daysUntilCertExpiry

        # Get Windows lifecycle info using shared utility
        $winLifecycle = Get-WindowsLifecycleInfo -OsVersion $device.OsVersion

        # Build output object
        $processedDevice = [PSCustomObject]@{
            id                     = $device.Id
            deviceName             = $device.DeviceName
            userPrincipalName      = $device.UserPrincipalName
            os                     = Get-SimplifiedOS -OperatingSystem $device.OperatingSystem
            osVersion              = $device.OsVersion
            complianceState        = $complianceState
            lastSync               = Format-IsoDate -DateValue $device.LastSyncDateTime
            daysSinceSync          = $daysSinceSync
            isStale                = $isStale
            enrolledDateTime       = Format-IsoDate -DateValue $device.EnrolledDateTime
            ownership              = $ownership
            manufacturer           = $device.Manufacturer
            model                  = $device.Model
            serialNumber           = $device.SerialNumber
            isEncrypted            = [bool]$device.IsEncrypted
            managementAgent        = $managementAgent
            certExpiryDate         = Format-IsoDate -DateValue $device.ManagedDeviceCertificateExpirationDate
            daysUntilCertExpiry    = $daysUntilCertExpiry
            certStatus             = $certStatus
            # Extended fields
            primaryUserDisplayName = $device.UserDisplayName
            autopilotEnrolled      = [bool]$device.AutopilotEnrolled
            deviceCategory         = $device.DeviceCategoryDisplayName
            totalStorageGB         = if ($device.TotalStorageSpaceInBytes -and $device.TotalStorageSpaceInBytes -gt 0) {
                                         [Math]::Round($device.TotalStorageSpaceInBytes / 1GB, 1)
                                     } else { $null }
            freeStorageGB          = if ($device.FreeStorageSpaceInBytes -and $device.FreeStorageSpaceInBytes -gt 0) {
                                         [Math]::Round($device.FreeStorageSpaceInBytes / 1GB, 1)
                                     } else { $null }
            storageUsedPct         = if ($device.TotalStorageSpaceInBytes -and $device.TotalStorageSpaceInBytes -gt 0) {
                                         $used = $device.TotalStorageSpaceInBytes - $device.FreeStorageSpaceInBytes
                                         [Math]::Round(($used / $device.TotalStorageSpaceInBytes) * 100, 1)
                                     } else { $null }
            wifiMacAddress         = $device.WiFiMacAddress
            joinType               = $device.JoinType
            # Windows lifecycle fields
            windowsRelease         = $winLifecycle.windowsRelease
            windowsBuild           = $winLifecycle.windowsBuild
            windowsType            = $winLifecycle.windowsType
            windowsEOL             = $winLifecycle.windowsEOL
            windowsSupported       = $winLifecycle.windowsSupported
        }

        $processedDevices += $processedDevice
        $deviceCount++

        # Progress indicator
        if ($deviceCount % 50 -eq 0) {
            Write-Host "      Processed $deviceCount devices..." -ForegroundColor Gray
        }
    }

    # Sort by compliance state (non-compliant first) then by last sync
    $processedDevices = $processedDevices | Sort-Object -Property @{
        Expression = {
            switch ($_.complianceState) {
                "noncompliant" { 0 }
                "unknown"      { 1 }
                "compliant"    { 2 }
                default        { 3 }
            }
        }
    }, @{ Expression = "daysSinceSync"; Descending = $true }

    # Save data using shared utility
    Save-CollectorData -Data $processedDevices -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $deviceCount devices" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $deviceCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Intune|license|subscription|permission|forbidden") {
        Write-Host "    [!] Device collection requires Intune license and appropriate permissions" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
