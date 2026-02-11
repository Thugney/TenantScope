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
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# LOCAL HELPERS
# ============================================================================

function Resolve-PrincipalIdentity {
    [CmdletBinding()]
    param(
        [Parameter()]
        [object]$Principal
    )

    if ($null -eq $Principal) {
        return @{
            displayName       = $null
            userPrincipalName = $null
        }
    }

    $displayName = Get-GraphPropertyValue -Object $Principal -PropertyNames @("displayName", "DisplayName")
    $userPrincipalName = Get-GraphPropertyValue -Object $Principal -PropertyNames @("userPrincipalName", "UserPrincipalName")

    if ((-not $displayName) -and $Principal.AdditionalProperties) {
        $displayName = $Principal.AdditionalProperties.displayName
    }
    if ((-not $userPrincipalName) -and $Principal.AdditionalProperties) {
        $userPrincipalName = $Principal.AdditionalProperties.userPrincipalName
    }

    return @{
        displayName       = $displayName
        userPrincipalName = $userPrincipalName
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
    } -OperationName "Role definition retrieval"

    $roleLookup = @{}
    foreach ($role in $roleDefinitions) {
        $roleLookup[$role.Id] = $role.DisplayName
    }
    Write-Host "      Loaded $($roleLookup.Count) role definitions" -ForegroundColor Gray

    # Collect role assignment schedule requests (activations/assignments)
    # Note: This requires RoleAssignmentSchedule.ReadWrite.Directory which many tenants don't grant
    Write-Host "      Retrieving role assignment schedule requests..." -ForegroundColor Gray

    $processedEntries = @()
    $assignmentRequests = @()

    # Try to get assignment requests - requires RoleAssignmentSchedule.ReadWrite.Directory
    # which many tenants don't grant. Use SilentlyContinue to suppress verbose error output.
    $assignmentError = $null
    $assignmentRequests = Get-MgRoleManagementDirectoryRoleAssignmentScheduleRequest -All `
        -ExpandProperty "principal" `
        -Top 999 `
        -ErrorAction SilentlyContinue `
        -ErrorVariable assignmentError

    if ($assignmentError) {
        $errMsg = $assignmentError[0].Exception.Message
        if ($errMsg -match "PermissionScopeNotGranted|403|Forbidden|Authorization") {
            Write-Host "      [!] Assignment requests require RoleAssignmentSchedule.ReadWrite.Directory (skipping)" -ForegroundColor Yellow
        } else {
            Write-Host "      [!] Assignment requests: $($errMsg.Substring(0, [Math]::Min(80, $errMsg.Length)))..." -ForegroundColor Yellow
        }
        $assignmentRequests = @()
    } else {
        Write-Host "      Retrieved $($assignmentRequests.Count) assignment requests" -ForegroundColor Gray
    }

    foreach ($request in $assignmentRequests) {
        # Extract principal info
        $principalIdentity = Resolve-PrincipalIdentity -Principal $request.Principal
        $principalName = $principalIdentity.displayName
        $principalUpn = $principalIdentity.userPrincipalName

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

        # Get ticket info if available
        $ticketNumber = $null
        $ticketSystem = $null
        if ($request.TicketInfo) {
            $ticketNumber = $request.TicketInfo.TicketNumber
            $ticketSystem = $request.TicketInfo.TicketSystem
        }

        # Get approval ID if available
        $approvalId = $request.ApprovalId

        # Check if this is a validation-only request
        $isValidationOnly = $request.IsValidationOnly

        # Get completed datetime if available
        $completedDateTime = $null
        if ($request.CompletedDateTime) {
            $completedDateTime = $request.CompletedDateTime.ToString("o")
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
            completedDateTime      = $completedDateTime
            justification          = $request.Justification
            scheduleStartDateTime  = $startDateTime
            scheduleEndDateTime    = $endDateTime
            ticketNumber           = $ticketNumber
            ticketSystem           = $ticketSystem
            approvalId             = $approvalId
            isValidationOnly       = $isValidationOnly
            isEligible             = $false
            entryType              = "request"
        }

        $processedEntries += $processedEntry
        $entryCount++
    }

    # Collect eligible role assignments
    Write-Host "      Retrieving eligible role assignments..." -ForegroundColor Gray

    try {
        $eligibleSchedules = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All `
                -ExpandProperty "principal" `
                -Top 999
        } -OperationName "PIM eligible assignments"

        Write-Host "      Retrieved $($eligibleSchedules.Count) eligible assignments" -ForegroundColor Gray

        foreach ($schedule in $eligibleSchedules) {
            $principalIdentity = Resolve-PrincipalIdentity -Principal $schedule.Principal
            $principalName = $principalIdentity.displayName
            $principalUpn = $principalIdentity.userPrincipalName

            $roleName = $roleLookup[$schedule.RoleDefinitionId]
            if (-not $roleName) { $roleName = "Unknown Role" }

            # Get schedule times - try both direct properties and nested ScheduleInfo
            # (Graph API version may return at different paths)
            $eligibleStart = $null
            $eligibleEnd = $null

            # Try direct properties first (some API versions)
            if ($schedule.StartDateTime) {
                $eligibleStart = $schedule.StartDateTime.ToString("o")
            }
            # Fall back to nested ScheduleInfo
            elseif ($schedule.ScheduleInfo -and $schedule.ScheduleInfo.StartDateTime) {
                $eligibleStart = $schedule.ScheduleInfo.StartDateTime.ToString("o")
            }

            # End time from direct property or nested
            if ($schedule.EndDateTime) {
                $eligibleEnd = $schedule.EndDateTime.ToString("o")
            }
            elseif ($schedule.ScheduleInfo -and $schedule.ScheduleInfo.Expiration -and $schedule.ScheduleInfo.Expiration.EndDateTime) {
                $eligibleEnd = $schedule.ScheduleInfo.Expiration.EndDateTime.ToString("o")
            }

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
                scheduleStartDateTime  = $eligibleStart
                scheduleEndDateTime    = $eligibleEnd
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

    # Save data using shared utility
    Save-CollectorData -Data $processedEntries -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $entryCount PIM entries" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $entryCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
