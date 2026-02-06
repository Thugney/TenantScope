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
    [string]$OutputPath
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

    .PARAMETER State
        The enrollment state value from Graph API.

    .OUTPUTS
        Friendly enrollment state name.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $State
    )

    if ($null -eq $State) {
        return "unknown"
    }

    switch ($State) {
        "unknown"           { return "unknown" }
        "enrolled"          { return "enrolled" }
        "pendingReset"      { return "pendingReset" }
        "failed"            { return "failed" }
        "notContacted"      { return "notContacted" }
        "blocked"           { return "blocked" }
        default             { return $State.ToString().ToLower() }
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
        # Map enrollment state (handle both PascalCase and camelCase property names)
        $enrollmentStateValue = $device.EnrollmentState
        if ($null -eq $enrollmentStateValue) {
            $enrollmentStateValue = $device.enrollmentState
        }
        $enrollmentState = Get-EnrollmentStateName -State $enrollmentStateValue

        # Determine if profile is assigned
        # Handle both PascalCase (cmdlet) and camelCase (direct API) property names
        # Graph API deploymentProfileAssignmentStatus values:
        #   - unknown, assignedInSync, assignedOutOfSync, assignedUnkownSyncState, notAssigned, pending, failed
        # Profile IS assigned when status is: assignedInSync, assignedOutOfSync, assignedUnkownSyncState, pending
        # Profile is NOT assigned when status is: unknown, notAssigned, failed
        $profileAssigned = $false
        $profileAssignmentStatus = "unknown"

        # Check deployment profile assignment status (handles both property name cases)
        $assignmentStatus = $device.DeploymentProfileAssignmentStatus
        if ($null -eq $assignmentStatus) {
            $assignmentStatus = $device.deploymentProfileAssignmentStatus
        }
        if ($assignmentStatus) {
            $profileAssignmentStatus = $assignmentStatus.ToString()
        }

        # Check if profile is assigned based on status
        # "assigned" prefix catches: assignedInSync, assignedOutOfSync, assignedUnkownSyncState
        # "pending" means assignment is in progress
        if ($profileAssignmentStatus -match "^assigned|^pending") {
            $profileAssigned = $true
        }

        # Also check if deploymentProfileAssignedDateTime is set as additional confirmation
        # (handles both property name cases)
        $assignedDateTime = $device.DeploymentProfileAssignedDateTime
        if ($null -eq $assignedDateTime) {
            $assignedDateTime = $device.deploymentProfileAssignedDateTime
        }
        if ($assignedDateTime -and -not $profileAssigned) {
            # If we have an assigned date but status didn't show assigned, still mark as assigned
            $profileAssigned = $true
        }

        # Build output object matching our schema
        # Handle both PascalCase (cmdlet) and camelCase (direct API) property names
        $deviceId = if ($device.Id) { $device.Id } else { $device.id }
        $serial = if ($device.SerialNumber) { $device.SerialNumber } else { $device.serialNumber }
        $model = if ($device.Model) { $device.Model } else { $device.model }
        $manufacturer = if ($device.Manufacturer) { $device.Manufacturer } else { $device.manufacturer }
        $groupTag = if ($device.GroupTag) { $device.GroupTag } else { $device.groupTag }
        $lastContactedDt = if ($device.LastContactedDateTime) { $device.LastContactedDateTime } else { $device.lastContactedDateTime }
        $purchaseOrderId = if ($device.PurchaseOrderIdentifier) { $device.PurchaseOrderIdentifier } else { $device.purchaseOrderIdentifier }

        $processedDevice = [PSCustomObject]@{
            id                      = $deviceId
            serialNumber            = $serial
            model                   = $model
            manufacturer            = $manufacturer
            groupTag                = $groupTag
            enrollmentState         = $enrollmentState
            lastContacted           = if ($lastContactedDt) { ([DateTime]$lastContactedDt).ToString("o") } else { $null }
            profileAssigned         = $profileAssigned
            profileAssignmentStatus = $profileAssignmentStatus
            purchaseOrder           = $purchaseOrderId
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
