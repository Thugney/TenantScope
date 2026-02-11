# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Windows Autopilot device information from Microsoft Graph.

.DESCRIPTION
    Retrieves all Windows Autopilot device identities registered in the
    tenant, including deployment profile assignments, group tags, and
    enrollment state.

    Graph API endpoint: GET /deviceManagement/windowsAutopilotDeviceIdentities
    Required scope: DeviceManagementServiceConfig.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes autopilot.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of Autopilot devices collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-AutopilotData.ps1 -Config $config -OutputPath ".\data\autopilot.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.DeviceManagement.Enrollment

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

function Get-EnrollmentStateName {
    <#
    .SYNOPSIS
        Converts enrollment state enum to friendly name.
        Handles both numeric enum values (from direct REST API) and string values (from cmdlets).

    .PARAMETER State
        The enrollment state value from Graph API (numeric or string).

    .OUTPUTS
        Friendly enrollment state name (lowercase string).
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $State
    )

    if ($null -eq $State) {
        return "unknown"
    }

    # Convert to string for comparison (handles both numeric and string inputs)
    $stateStr = $State.ToString().ToLower()

    switch ($stateStr) {
        # Numeric enum values from Graph API
        "0"                 { return "unknown" }
        "1"                 { return "enrolled" }
        "2"                 { return "pendingReset" }
        "3"                 { return "failed" }
        "4"                 { return "notContacted" }
        "5"                 { return "blocked" }
        # String values from cmdlets
        "unknown"           { return "unknown" }
        "enrolled"          { return "enrolled" }
        "pendingreset"      { return "pendingReset" }
        "failed"            { return "failed" }
        "notcontacted"      { return "notContacted" }
        "blocked"           { return "blocked" }
        default             { return "unknown" }  # Default to unknown for unrecognized values
    }
}

function ConvertTo-SafeDateTime {
    <#
    .SYNOPSIS
        Safely converts a value to ISO 8601 date string, handling nulls and DateTime.MinValue.
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
        $dt = [DateTime]$DateValue
        # Check for DateTime.MinValue (0001-01-01) which means "not set"
        if ($dt -eq [DateTime]::MinValue -or $dt.Year -lt 1900) {
            return $null
        }
        return $dt.ToString("o")
    }
    catch {
        return $null
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$autopilotCount = 0

try {
    Write-Host "    Collecting Windows Autopilot devices..." -ForegroundColor Gray

    # Retrieve all Autopilot device identities
    $autopilotDevices = $null

    try {
        # Try the dedicated cmdlet first
        $autopilotDevices = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgDeviceManagementWindowsAutopilotDeviceIdentity -All
        } -OperationName "Autopilot device retrieval"
    }
    catch {
        # If cmdlet fails, try direct API call
        Write-Host "      Trying alternative method..." -ForegroundColor Gray

        $autopilotDevices = Invoke-GraphWithRetry -ScriptBlock {
            $response = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/deviceManagement/windowsAutopilotDeviceIdentities" -OutputType PSObject

            # Handle pagination
            $allDevices = @()
            if ($response.value) {
                $allDevices = $response.value
            }
            while ($response.'@odata.nextLink') {
                $response = Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
                if ($response.value) {
                    $allDevices += $response.value
                }
            }
            return $allDevices
        } -OperationName "Autopilot device retrieval (direct API)"
    }

    if ($null -eq $autopilotDevices) {
        $autopilotDevices = @()
    }

    Write-Host "      Retrieved $($autopilotDevices.Count) Autopilot devices" -ForegroundColor Gray

    # Process each Autopilot device
    $processedDevices = @()

    foreach ($device in $autopilotDevices) {
        # For SDK objects, try direct property access first, then fall back to Get-GraphPropertyValue
        # SDK returns strongly-typed objects with PascalCase properties

        # Get enrollment state - SDK returns enum, direct API returns string/number
        $enrollmentStateValue = $null
        if ($null -ne $device.EnrollmentState) {
            $enrollmentStateValue = $device.EnrollmentState
        } elseif ($null -ne $device.enrollmentState) {
            $enrollmentStateValue = $device.enrollmentState
        }
        $enrollmentState = Get-EnrollmentStateName -State $enrollmentStateValue

        # Determine if profile is assigned
        # Graph API deploymentProfileAssignmentStatus values:
        #   - unknown, assignedInSync, assignedOutOfSync, assignedUnkownSyncState, notAssigned, pending, failed
        $profileAssigned = $false
        $profileAssignmentStatus = "unknown"

        # Get deployment profile assignment status - try direct access first
        $assignmentStatus = $null
        if ($null -ne $device.DeploymentProfileAssignmentStatus) {
            $assignmentStatus = $device.DeploymentProfileAssignmentStatus
        } elseif ($null -ne $device.deploymentProfileAssignmentStatus) {
            $assignmentStatus = $device.deploymentProfileAssignmentStatus
        }

        if ($assignmentStatus) {
            $profileAssignmentStatus = $assignmentStatus.ToString()
            # "assigned" prefix catches: assignedInSync, assignedOutOfSync, assignedUnkownSyncState
            # "pending" means assignment is in progress
            if ($profileAssignmentStatus -match "(?i)^assigned|^pending") {
                $profileAssigned = $true
            }
        }

        # Also check if deploymentProfileAssignedDateTime is set as additional confirmation
        $assignedDateTime = $device.DeploymentProfileAssignedDateTime
        if ($null -eq $assignedDateTime) { $assignedDateTime = $device.deploymentProfileAssignedDateTime }

        if ($assignedDateTime -and -not $profileAssigned) {
            $assignedDtSafe = ConvertTo-SafeDateTime -DateValue $assignedDateTime
            if ($assignedDtSafe) {
                $profileAssigned = $true
            }
        }

        # Extract properties - try direct SDK access first, then camelCase
        $deviceId = if ($device.Id) { $device.Id } else { $device.id }
        $serial = if ($device.SerialNumber) { $device.SerialNumber } else { $device.serialNumber }
        $model = if ($device.Model) { $device.Model } else { $device.model }
        $manufacturer = if ($device.Manufacturer) { $device.Manufacturer } else { $device.manufacturer }
        $groupTag = if ($device.GroupTag) { $device.GroupTag } else { $device.groupTag }
        $lastContactedDt = if ($null -ne $device.LastContactedDateTime) { $device.LastContactedDateTime } else { $device.lastContactedDateTime }
        $purchaseOrderId = if ($device.PurchaseOrderIdentifier) { $device.PurchaseOrderIdentifier } else { $device.purchaseOrderIdentifier }

        # Additional properties
        $displayName = if ($device.DisplayName) { $device.DisplayName } else { $device.displayName }
        $userPrincipalName = if ($device.UserPrincipalName) { $device.UserPrincipalName } else { $device.userPrincipalName }
        $azureAdDeviceId = if ($device.AzureActiveDirectoryDeviceId) { $device.AzureActiveDirectoryDeviceId } else { $device.azureActiveDirectoryDeviceId }
        $managedDeviceId = if ($device.ManagedDeviceId) { $device.ManagedDeviceId } else { $device.managedDeviceId }
        $productKey = if ($device.ProductKey) { $device.ProductKey } else { $device.productKey }
        $skuNumber = if ($device.SkuNumber) { $device.SkuNumber } else { $device.skuNumber }
        $systemFamily = if ($device.SystemFamily) { $device.SystemFamily } else { $device.systemFamily }
        $addressableUserName = if ($device.AddressableUserName) { $device.AddressableUserName } else { $device.addressableUserName }
        $resourceName = if ($device.ResourceName) { $device.ResourceName } else { $device.resourceName }
        $deploymentProfileAssignedDt = if ($null -ne $device.DeploymentProfileAssignedDateTime) { $device.DeploymentProfileAssignedDateTime } else { $device.deploymentProfileAssignedDateTime }

        $processedDevice = [PSCustomObject]@{
            id                          = $deviceId
            serialNumber                = $serial
            model                       = $model
            manufacturer                = $manufacturer
            groupTag                    = $groupTag
            enrollmentState             = $enrollmentState
            lastContacted               = ConvertTo-SafeDateTime -DateValue $lastContactedDt
            profileAssigned             = $profileAssigned
            profileAssignmentStatus     = $profileAssignmentStatus
            purchaseOrder               = $purchaseOrderId
            # Additional properties
            displayName                 = $displayName
            userPrincipalName           = $userPrincipalName
            azureActiveDirectoryDeviceId = $azureAdDeviceId
            managedDeviceId             = $managedDeviceId
            productKey                  = $productKey
            skuNumber                   = $skuNumber
            systemFamily                = $systemFamily
            addressableUserName         = $addressableUserName
            resourceName                = $resourceName
            profileAssignedDateTime     = ConvertTo-SafeDateTime -DateValue $deploymentProfileAssignedDt
        }

        $processedDevices += $processedDevice
        $autopilotCount++
    }

    # Sort by enrollment state (not enrolled first) then by last contacted
    $processedDevices = $processedDevices | Sort-Object -Property @{Expression = {
        switch ($_.enrollmentState) {
            "notContacted" { 0 }
            "failed"       { 1 }
            "unknown"      { 2 }
            "enrolled"     { 3 }
            default        { 4 }
        }
    }}, @{Expression = "lastContacted"; Descending = $false}

    # Save data using shared utility
    Save-CollectorData -Data $processedDevices -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $autopilotCount Autopilot devices" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $autopilotCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Autopilot") {
        Write-Host "    [!] Autopilot collection requires appropriate Intune permissions" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
