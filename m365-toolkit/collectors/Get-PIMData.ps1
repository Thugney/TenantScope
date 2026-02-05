# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter PIM-aktivitetsdata fra Microsoft Entra ID.

.DESCRIPTION
    Retrieves Privileged Identity Management (PIM) activity data including
    role assignment schedule requests (activations, assignments, removals)
    and eligible role assignments.

    Graph API endpoints:
    - GET /roleManagement/directory/roleAssignmentScheduleRequests
    - GET /roleManagement/directory/roleEligibilitySchedules

    Required scopes: RoleManagement.Read.Directory,
                     RoleAssignmentSchedule.Read.Directory

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes pim-activity.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of PIM entries collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-PIMData.ps1 -Config $config -OutputPath ".\data\pim-activity.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.Governance

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
        [int]$MaxRetries = 5,

        [Parameter()]
        [int]$BaseBackoffSeconds = 60
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests|Too many retries") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $BaseBackoffSeconds * [Math]::Pow(2, $attempt - 1)
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
$entryCount = 0

try {
    Write-Host "    Collecting PIM activity data..." -ForegroundColor Gray

    # Build role definition lookup
    Write-Host "      Building role definition lookup..." -ForegroundColor Gray
    $roleDefinitions = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgRoleManagementDirectoryRoleDefinition -All
    }

    $roleLookup = @{}
    foreach ($role in $roleDefinitions) {
        $roleLookup[$role.Id] = $role.DisplayName
    }
    Write-Host "      Loaded $($roleLookup.Count) role definitions" -ForegroundColor Gray

    # Collect role assignment schedule requests (activations/assignments)
    Write-Host "      Retrieving role assignment schedule requests..." -ForegroundColor Gray

    $processedEntries = @()

    try {
        $assignmentRequests = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgRoleManagementDirectoryRoleAssignmentScheduleRequest -All `
                -ExpandProperty "principal" `
                -Top 999
        }

        Write-Host "      Retrieved $($assignmentRequests.Count) assignment requests" -ForegroundColor Gray

        foreach ($request in $assignmentRequests) {
            # Extract principal info
            $principalName = ""
            $principalUpn = ""
            if ($request.Principal) {
                $principalName = $request.Principal.AdditionalProperties.displayName
                $principalUpn = $request.Principal.AdditionalProperties.userPrincipalName
            }

            # Lookup role name
            $roleName = $roleLookup[$request.RoleDefinitionId]
            if (-not $roleName) { $roleName = "Unknown Role" }

            # Calculate duration if schedule info exists
            $startDateTime = $null
            $endDateTime = $null
            if ($request.ScheduleInfo) {
                if ($request.ScheduleInfo.StartDateTime) {
                    $startDateTime = $request.ScheduleInfo.StartDateTime.ToString("o")
                }
                if ($request.ScheduleInfo.Expiration -and $request.ScheduleInfo.Expiration.EndDateTime) {
                    $endDateTime = $request.ScheduleInfo.Expiration.EndDateTime.ToString("o")
                }
            }

            $processedEntry = [PSCustomObject]@{
                id                     = $request.Id
                action                 = $request.Action
                principalDisplayName   = $principalName
                principalUpn           = $principalUpn
                roleName               = $roleName
                roleDefinitionId       = $request.RoleDefinitionId
                status                 = $request.Status
                createdDateTime        = if ($request.CreatedDateTime) { $request.CreatedDateTime.ToString("o") } else { $null }
                justification          = $request.Justification
                scheduleStartDateTime  = $startDateTime
                scheduleEndDateTime    = $endDateTime
                isEligible             = $false
                entryType              = "request"
            }

            $processedEntries += $processedEntry
            $entryCount++
        }
    }
    catch {
        Write-Host "      Could not retrieve assignment requests: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Assignment requests: $($_.Exception.Message)"
    }

    # Collect eligible role assignments
    Write-Host "      Retrieving eligible role assignments..." -ForegroundColor Gray

    try {
        $eligibleSchedules = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All `
                -ExpandProperty "principal" `
                -Top 999
        }

        Write-Host "      Retrieved $($eligibleSchedules.Count) eligible assignments" -ForegroundColor Gray

        foreach ($schedule in $eligibleSchedules) {
            $principalName = ""
            $principalUpn = ""
            if ($schedule.Principal) {
                $principalName = $schedule.Principal.AdditionalProperties.displayName
                $principalUpn = $schedule.Principal.AdditionalProperties.userPrincipalName
            }

            $roleName = $roleLookup[$schedule.RoleDefinitionId]
            if (-not $roleName) { $roleName = "Unknown Role" }

            $processedEntry = [PSCustomObject]@{
                id                     = $schedule.Id
                action                 = "eligible"
                principalDisplayName   = $principalName
                principalUpn           = $principalUpn
                roleName               = $roleName
                roleDefinitionId       = $schedule.RoleDefinitionId
                status                 = $schedule.Status
                createdDateTime        = if ($schedule.CreatedDateTime) { $schedule.CreatedDateTime.ToString("o") } else { $null }
                justification          = ""
                scheduleStartDateTime  = if ($schedule.ScheduleInfo -and $schedule.ScheduleInfo.StartDateTime) { $schedule.ScheduleInfo.StartDateTime.ToString("o") } else { $null }
                scheduleEndDateTime    = if ($schedule.ScheduleInfo -and $schedule.ScheduleInfo.Expiration -and $schedule.ScheduleInfo.Expiration.EndDateTime) { $schedule.ScheduleInfo.Expiration.EndDateTime.ToString("o") } else { $null }
                isEligible             = $true
                entryType              = "eligible"
            }

            $processedEntries += $processedEntry
            $entryCount++
        }
    }
    catch {
        Write-Host "      Could not retrieve eligible assignments: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Eligible assignments: $($_.Exception.Message)"
    }

    # Sort by date descending
    $processedEntries = $processedEntries | Sort-Object -Property createdDateTime -Descending

    # Write results to JSON file
    $processedEntries | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    + Collected $entryCount PIM entries" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $entryCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    x Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
