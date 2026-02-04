# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
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
# HELPER FUNCTIONS
# ============================================================================

function Get-DaysSinceDate {
    <#
    .SYNOPSIS
        Calculates days between a given date and now.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $DateValue
    )

    if ($null -eq $DateValue) {
        return $null
    }

    try {
        $date = if ($DateValue -is [DateTime]) { $DateValue } else { [DateTime]::Parse($DateValue) }
        $days = ((Get-Date) - $date).Days
        return [Math]::Max(0, $days)
    }
    catch {
        return $null
    }
}

function Get-SimplifiedOS {
    <#
    .SYNOPSIS
        Returns a simplified OS name from the full operating system string.

    .PARAMETER OperatingSystem
        The full operating system name.

    .OUTPUTS
        Simplified OS name: Windows, macOS, iOS, Android, or the original value.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        [string]$OperatingSystem
    )

    if ([string]::IsNullOrWhiteSpace($OperatingSystem)) {
        return "Unknown"
    }

    $os = $OperatingSystem.ToLower()

    if ($os -match "windows") { return "Windows" }
    if ($os -match "macos|mac os") { return "macOS" }
    if ($os -match "ios|iphone|ipad") { return "iOS" }
    if ($os -match "android") { return "Android" }
    if ($os -match "linux") { return "Linux" }
    if ($os -match "chrome") { return "ChromeOS" }

    return $OperatingSystem
}

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling.
    #>
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [int]$MaxRetries = 3,

        [Parameter()]
        [int]$DefaultBackoffSeconds = 30
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $DefaultBackoffSeconds * $attempt
                Write-Host "      Throttled. Waiting ${wait}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
            }
            else { throw }
        }
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
    }

    Write-Host "      Retrieved $($managedDevices.Count) devices from Intune" -ForegroundColor Gray

    # Process each device
    $processedDevices = @()

    foreach ($device in $managedDevices) {
        # Calculate days since last sync
        $daysSinceSync = Get-DaysSinceDate -DateValue $device.LastSyncDateTime

        # Determine if device is stale
        $isStale = $false
        if ($null -ne $daysSinceSync -and $daysSinceSync -ge $staleThreshold) {
            $isStale = $true
        }

        # Map compliance state to our schema values
        $complianceState = "unknown"
        if ($device.ComplianceState) {
            switch ($device.ComplianceState) {
                "compliant"     { $complianceState = "compliant" }
                "noncompliant"  { $complianceState = "noncompliant" }
                "conflict"      { $complianceState = "noncompliant" }
                "error"         { $complianceState = "unknown" }
                "inGracePeriod" { $complianceState = "noncompliant" }
                "configManager" { $complianceState = "unknown" }
                default         { $complianceState = "unknown" }
            }
        }

        # Map ownership
        $ownership = "corporate"
        if ($device.ManagedDeviceOwnerType) {
            switch ($device.ManagedDeviceOwnerType) {
                "personal" { $ownership = "personal" }
                "company"  { $ownership = "corporate" }
                default    { $ownership = "corporate" }
            }
        }

        # Map management agent
        $managementAgent = "mdm"
        if ($device.ManagementAgent) {
            switch ($device.ManagementAgent) {
                "mdm"                   { $managementAgent = "mdm" }
                "easMdm"                { $managementAgent = "easMdm" }
                "configurationManagerClient" { $managementAgent = "configManager" }
                "configurationManagerClientMdm" { $managementAgent = "configManager" }
                default                 { $managementAgent = $device.ManagementAgent }
            }
        }

        # Build output object matching our schema
        $processedDevice = [PSCustomObject]@{
            id              = $device.Id
            deviceName      = $device.DeviceName
            userPrincipalName = $device.UserPrincipalName
            os              = Get-SimplifiedOS -OperatingSystem $device.OperatingSystem
            osVersion       = $device.OsVersion
            complianceState = $complianceState
            lastSync        = if ($device.LastSyncDateTime) { $device.LastSyncDateTime.ToString("o") } else { $null }
            daysSinceSync   = $daysSinceSync
            isStale         = $isStale
            enrolledDateTime = if ($device.EnrolledDateTime) { $device.EnrolledDateTime.ToString("o") } else { $null }
            ownership       = $ownership
            manufacturer    = $device.Manufacturer
            model           = $device.Model
            serialNumber    = $device.SerialNumber
            isEncrypted     = [bool]$device.IsEncrypted
            managementAgent = $managementAgent
        }

        $processedDevices += $processedDevice
        $deviceCount++

        # Progress indicator
        if ($deviceCount % 50 -eq 0) {
            Write-Host "      Processed $deviceCount devices..." -ForegroundColor Gray
        }
    }

    # Sort by compliance state (non-compliant first) then by last sync
    $processedDevices = $processedDevices | Sort-Object -Property @{Expression = {
        switch ($_.complianceState) {
            "noncompliant" { 0 }
            "unknown"      { 1 }
            "compliant"    { 2 }
            default        { 3 }
        }
    }}, @{Expression = "daysSinceSync"; Descending = $true}

    # Write results to JSON file
    $processedDevices | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    ✓ Collected $deviceCount devices" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $deviceCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Intune|license|subscription|permission|forbidden") {
        Write-Host "    ⚠ Device collection requires Intune license and appropriate permissions" -ForegroundColor Yellow
    }

    Write-Host "    ✗ Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
