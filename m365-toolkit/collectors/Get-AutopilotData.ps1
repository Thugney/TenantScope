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
        $enrollmentStateValue = Get-GraphPropertyValue -Object $device -PropertyNames @("enrollmentState", "EnrollmentState")
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
        $assignmentStatus = Get-GraphPropertyValue -Object $device -PropertyNames @("deploymentProfileAssignmentStatus", "DeploymentProfileAssignmentStatus")
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
        $assignedDateTime = Get-GraphPropertyValue -Object $device -PropertyNames @("deploymentProfileAssignedDateTime", "DeploymentProfileAssignedDateTime")
        if ($assignedDateTime -and -not $profileAssigned) {
            # If we have an assigned date but status didn't show assigned, still mark as assigned
            $profileAssigned = $true
        }

        # Build output object matching our schema
        # Handle both PascalCase (cmdlet) and camelCase (direct API) property names
        $deviceId = Get-GraphPropertyValue -Object $device -PropertyNames @("id", "Id")
        $serial = Get-GraphPropertyValue -Object $device -PropertyNames @("serialNumber", "SerialNumber")
        $model = Get-GraphPropertyValue -Object $device -PropertyNames @("model", "Model")
        $manufacturer = Get-GraphPropertyValue -Object $device -PropertyNames @("manufacturer", "Manufacturer")
        $groupTag = Get-GraphPropertyValue -Object $device -PropertyNames @("groupTag", "GroupTag")
        $lastContactedDt = Get-GraphPropertyValue -Object $device -PropertyNames @("lastContactedDateTime", "LastContactedDateTime")
        $purchaseOrderId = Get-GraphPropertyValue -Object $device -PropertyNames @("purchaseOrderIdentifier", "PurchaseOrderIdentifier")

        # Additional properties from Graph API
        $displayName = Get-GraphPropertyValue -Object $device -PropertyNames @("displayName", "DisplayName")
        $userPrincipalName = Get-GraphPropertyValue -Object $device -PropertyNames @("userPrincipalName", "UserPrincipalName")
        $azureAdDeviceId = Get-GraphPropertyValue -Object $device -PropertyNames @("azureActiveDirectoryDeviceId", "AzureActiveDirectoryDeviceId")
        $managedDeviceId = Get-GraphPropertyValue -Object $device -PropertyNames @("managedDeviceId", "ManagedDeviceId")
        $productKey = Get-GraphPropertyValue -Object $device -PropertyNames @("productKey", "ProductKey")
        $skuNumber = Get-GraphPropertyValue -Object $device -PropertyNames @("skuNumber", "SkuNumber")
        $systemFamily = Get-GraphPropertyValue -Object $device -PropertyNames @("systemFamily", "SystemFamily")
        $addressableUserName = Get-GraphPropertyValue -Object $device -PropertyNames @("addressableUserName", "AddressableUserName")
        $resourceName = Get-GraphPropertyValue -Object $device -PropertyNames @("resourceName", "ResourceName")
        $deploymentProfileAssignedDt = Get-GraphPropertyValue -Object $device -PropertyNames @("deploymentProfileAssignedDateTime", "DeploymentProfileAssignedDateTime")

        $processedDevice = [PSCustomObject]@{
            id                          = $deviceId
            serialNumber                = $serial
            model                       = $model
            manufacturer                = $manufacturer
            groupTag                    = $groupTag
            enrollmentState             = $enrollmentState
            lastContacted               = if ($lastContactedDt) { ([DateTime]$lastContactedDt).ToString("o") } else { $null }
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
            profileAssignedDateTime     = if ($deploymentProfileAssignedDt) { ([DateTime]$deploymentProfileAssignedDt).ToString("o") } else { $null }
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
