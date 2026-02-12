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

    # Use beta API for full property set including deploymentProfileAssignmentStatus
    # v1.0 API doesn't include profile assignment properties
    # Explicitly select all needed properties to ensure they're returned
    $selectFields = @(
        'id',
        'serialNumber',
        'model',
        'manufacturer',
        'groupTag',
        'enrollmentState',
        'lastContactedDateTime',
        'deploymentProfileAssignmentStatus',
        'deploymentProfileAssignmentDetailedStatus',
        'deploymentProfileAssignedDateTime',
        'purchaseOrderIdentifier',
        'displayName',
        'userPrincipalName',
        'azureActiveDirectoryDeviceId',
        'azureAdDeviceId',
        'managedDeviceId',
        'productKey',
        'skuNumber',
        'systemFamily',
        'addressableUserName',
        'resourceName',
        'remediationState',
        'userlessEnrollmentStatus'
    ) -join ','

    $autopilotDevices = @()
    $apiUri = "https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeviceIdentities?`$select=$selectFields"

    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $apiUri -OutputType PSObject
    } -OperationName "Autopilot device retrieval"

    if ($response.value) {
        $autopilotDevices = @($response.value)
    }

    # Handle pagination
    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Autopilot device pagination"
        if ($response.value) {
            $autopilotDevices += $response.value
        }
    }

    Write-Host "      Retrieved $($autopilotDevices.Count) Autopilot devices" -ForegroundColor Gray

    # Debug: Show sample of available properties and values from first device
    if ($autopilotDevices.Count -gt 0) {
        $sampleDevice = $autopilotDevices[0]
        $propNames = @($sampleDevice.PSObject.Properties.Name) -join ", "
        Write-Host "      Properties returned: $($propNames.Substring(0, [Math]::Min(150, $propNames.Length)))..." -ForegroundColor Gray

        # Show key values for debugging profile status
        $sampleProfileStatus = if ($sampleDevice.deploymentProfileAssignmentStatus) { $sampleDevice.deploymentProfileAssignmentStatus } else { "(null)" }
        $sampleEnrollment = if ($sampleDevice.enrollmentState) { $sampleDevice.enrollmentState } else { "(null)" }
        $sampleGroupTag = if ($sampleDevice.groupTag) { $sampleDevice.groupTag } else { "(null)" }
        Write-Host "      Sample device - enrollmentState: $sampleEnrollment, profileStatus: $sampleProfileStatus, groupTag: $sampleGroupTag" -ForegroundColor Gray
    }

    # Process each Autopilot device
    $processedDevices = @()

    foreach ($device in $autopilotDevices) {
        # REST API returns camelCase properties consistently

        # Get enrollment state
        $enrollmentState = Get-EnrollmentStateName -State $device.enrollmentState

        # Get deployment profile assignment status
        # Values: unknown, assignedInSync, assignedOutOfSync, assignedUnkownSyncState, notAssigned, pending, failed
        $profileAssignmentStatus = if ($device.deploymentProfileAssignmentStatus) {
            $device.deploymentProfileAssignmentStatus.ToString()
        } else {
            "unknown"
        }

        # Profile IS assigned when status is: assignedInSync, assignedOutOfSync, assignedUnkownSyncState, pending
        $profileAssigned = $profileAssignmentStatus -match "(?i)^assigned|^pending"

        # Also check if deploymentProfileAssignedDateTime is set as additional confirmation
        if (-not $profileAssigned -and $device.deploymentProfileAssignedDateTime) {
            $assignedDtSafe = ConvertTo-SafeDateTime -DateValue $device.deploymentProfileAssignedDateTime
            if ($assignedDtSafe) {
                $profileAssigned = $true
            }
        }

        # Get deployment profile detailed status (beta property)
        $profileDetailedStatus = $device.deploymentProfileAssignmentDetailedStatus

        $processedDevice = [PSCustomObject]@{
            id                           = $device.id
            serialNumber                 = $device.serialNumber
            model                        = $device.model
            manufacturer                 = $device.manufacturer
            groupTag                     = $device.groupTag
            enrollmentState              = $enrollmentState
            lastContacted                = ConvertTo-SafeDateTime -DateValue $device.lastContactedDateTime
            profileAssigned              = $profileAssigned
            profileAssignmentStatus      = $profileAssignmentStatus
            profileDetailedStatus        = $profileDetailedStatus
            purchaseOrder                = $device.purchaseOrderIdentifier
            # Additional properties
            displayName                  = $device.displayName
            userPrincipalName            = $device.userPrincipalName
            azureActiveDirectoryDeviceId = $device.azureActiveDirectoryDeviceId
            azureAdDeviceId              = $device.azureAdDeviceId
            managedDeviceId              = $device.managedDeviceId
            productKey                   = $device.productKey
            skuNumber                    = $device.skuNumber
            systemFamily                 = $device.systemFamily
            addressableUserName          = $device.addressableUserName
            resourceName                 = $device.resourceName
            profileAssignedDateTime      = ConvertTo-SafeDateTime -DateValue $device.deploymentProfileAssignedDateTime
            # Beta properties
            remediationState             = $device.remediationState
            userlessEnrollmentStatus     = $device.userlessEnrollmentStatus
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

    # Summary statistics for debugging
    $enrolledCount = ($processedDevices | Where-Object { $_.enrollmentState -eq 'enrolled' }).Count
    $notContactedCount = ($processedDevices | Where-Object { $_.enrollmentState -eq 'notContacted' }).Count
    $failedCount = ($processedDevices | Where-Object { $_.enrollmentState -eq 'failed' }).Count
    $profileAssignedCount = ($processedDevices | Where-Object { $_.profileAssigned -eq $true }).Count
    $profileNotAssignedCount = ($processedDevices | Where-Object { $_.profileAssigned -eq $false }).Count

    # Count profile status values to verify API is returning data
    $statusCounts = @{}
    foreach ($d in $processedDevices) {
        $status = $d.profileAssignmentStatus
        if (-not $statusCounts.ContainsKey($status)) { $statusCounts[$status] = 0 }
        $statusCounts[$status]++
    }
    $statusSummary = ($statusCounts.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join ", "
    Write-Host "      Profile status breakdown: $statusSummary" -ForegroundColor Gray

    # Save data using shared utility
    Save-CollectorData -Data $processedDevices -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $autopilotCount Autopilot devices (Enrolled: $enrolledCount, Not Contacted: $notContactedCount, Failed: $failedCount)" -ForegroundColor Green
    Write-Host "      Profile assigned: $profileAssignedCount, No profile: $profileNotAssignedCount" -ForegroundColor Gray

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
