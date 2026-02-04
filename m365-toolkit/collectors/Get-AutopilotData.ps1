# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
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
# HELPER FUNCTIONS
# ============================================================================

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
        }
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
        }
    }

    if ($null -eq $autopilotDevices) {
        $autopilotDevices = @()
    }

    Write-Host "      Retrieved $($autopilotDevices.Count) Autopilot devices" -ForegroundColor Gray

    # Process each Autopilot device
    $processedDevices = @()

    foreach ($device in $autopilotDevices) {
        # Map enrollment state
        $enrollmentState = Get-EnrollmentStateName -State $device.EnrollmentState

        # Determine if profile is assigned
        # If deploymentProfileAssignmentStatus is "assigned" or similar, profile is assigned
        $profileAssigned = $false
        if ($device.DeploymentProfileAssignmentStatus) {
            if ($device.DeploymentProfileAssignmentStatus -match "assigned|pendingAssignment") {
                $profileAssigned = $true
            }
        }
        # Also check if deploymentProfileAssignedDateTime is set
        if ($device.DeploymentProfileAssignedDateTime) {
            $profileAssigned = $true
        }

        # Build output object matching our schema
        $processedDevice = [PSCustomObject]@{
            id              = $device.Id
            serialNumber    = $device.SerialNumber
            model           = $device.Model
            manufacturer    = $device.Manufacturer
            groupTag        = $device.GroupTag
            enrollmentState = $enrollmentState
            lastContacted   = if ($device.LastContactedDateTime) { $device.LastContactedDateTime.ToString("o") } else { $null }
            profileAssigned = $profileAssigned
            purchaseOrder   = $device.PurchaseOrderIdentifier
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

    # Write results to JSON file
    $processedDevices | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    ✓ Collected $autopilotCount Autopilot devices" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $autopilotCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Autopilot") {
        Write-Host "    ⚠ Autopilot collection requires appropriate Intune permissions" -ForegroundColor Yellow
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
