# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects directory role assignments from Microsoft Entra ID.

.DESCRIPTION
    Retrieves all active directory roles and their members. Identifies
    high-privilege roles that require special attention. Cross-references
    with user data to include member activity status.

    Graph API endpoints:
    - GET /directoryRoles
    - GET /directoryRoles/{id}/members

    Required scope: RoleManagement.Read.Directory, Directory.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes admin-roles.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of roles collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-AdminRoleData.ps1 -Config $config -OutputPath ".\data\admin-roles.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.DirectoryManagement

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
# HIGH-PRIVILEGE ROLES DEFINITION
# Roles that grant significant administrative access and require extra scrutiny
# ============================================================================

$highPrivilegeRoles = @(
    "Global Administrator",
    "Privileged Role Administrator",
    "Security Administrator",
    "Exchange Administrator",
    "SharePoint Administrator",
    "User Administrator",
    "Intune Administrator",
    "Cloud Application Administrator",
    "Application Administrator",
    "Conditional Access Administrator",
    "Privileged Authentication Administrator",
    "Authentication Administrator",
    "Billing Administrator",
    "Azure AD Joined Device Local Administrator",
    "Password Administrator"
)

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$roleCount = 0

try {
    Write-Host "    Collecting directory roles and members..." -ForegroundColor Gray

    # Load user data for cross-reference (to get activity status)
    $usersPath = Join-Path (Split-Path $OutputPath -Parent) "users.json"
    $userLookup = @{}

    if (Test-Path $usersPath) {
        $users = Get-Content $usersPath -Raw | ConvertFrom-Json
        foreach ($user in $users) {
            $userLookup[$user.id] = $user
        }
        Write-Host "      Loaded $($users.Count) users for cross-reference" -ForegroundColor Gray
    }

    # Get all active directory roles
    # Note: Only roles that have been activated (have members) are returned
    $directoryRoles = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgDirectoryRole -All
    } -OperationName "Directory role retrieval"

    Write-Host "      Retrieved $($directoryRoles.Count) active roles from Graph API" -ForegroundColor Gray

    # Process each role
    $processedRoles = @()

    foreach ($role in $directoryRoles) {
        Write-Host "      Processing role: $($role.DisplayName)..." -ForegroundColor Gray

        # Determine if this is a high-privilege role
        $isHighPrivilege = $role.DisplayName -in $highPrivilegeRoles

        # Get role members - includes users, service principals, and groups
        # Use direct API call to get all member types with their properties
        $members = @()
        $userMembers = @()
        $servicePrincipalMembers = @()
        $groupMembers = @()

        try {
            $membersUri = "https://graph.microsoft.com/v1.0/directoryRoles/$($role.Id)/members"
            $roleMembers = Get-GraphAllPages -Uri $membersUri -OperationName "Role member retrieval"

            foreach ($member in $roleMembers) {
                $memberType = $member.'@odata.type'
                $memberId = $member.id
                $memberName = $member.displayName

                # Process based on member type - SECURITY CRITICAL: Include ALL principal types
                if ($memberType -eq '#microsoft.graph.user' -or $null -eq $memberType) {
                    # User member
                    $memberUpn = $member.userPrincipalName

                    # Try to get additional info from user lookup
                    $accountEnabled = if ($null -ne $member.accountEnabled) { $member.accountEnabled } else { $true }
                    $isInactive = $false
                    $daysSinceLastSignIn = $null
                    $mfaRegistered = $null

                    if ($userLookup.ContainsKey($memberId)) {
                        $userData = $userLookup[$memberId]
                        $accountEnabled = $userData.accountEnabled
                        $isInactive = $userData.isInactive
                        $daysSinceLastSignIn = $userData.daysSinceLastSignIn
                        $mfaRegistered = $userData.mfaRegistered
                        if ([string]::IsNullOrEmpty($memberName)) {
                            $memberName = $userData.displayName
                        }
                        if ([string]::IsNullOrEmpty($memberUpn)) {
                            $memberUpn = $userData.userPrincipalName
                        }
                    }

                    $memberObj = [PSCustomObject]@{
                        id                  = $memberId
                        userId              = $memberId
                        displayName         = $memberName
                        memberType          = "User"
                        userPrincipalName   = $memberUpn
                        accountEnabled      = $accountEnabled
                        isInactive          = $isInactive
                        daysSinceLastSignIn = $daysSinceLastSignIn
                        mfaRegistered       = $mfaRegistered
                    }

                    $members += $memberObj
                    $userMembers += $memberObj
                }
                elseif ($memberType -eq '#microsoft.graph.servicePrincipal') {
                    # Service Principal (App) - SECURITY CRITICAL
                    $appId = $member.appId
                    $servicePrincipalType = $member.servicePrincipalType

                    $memberObj = [PSCustomObject]@{
                        id                   = $memberId
                        displayName          = $memberName
                        memberType           = "ServicePrincipal"
                        appId                = $appId
                        servicePrincipalType = $servicePrincipalType
                        accountEnabled       = $member.accountEnabled
                    }

                    $members += $memberObj
                    $servicePrincipalMembers += $memberObj
                }
                elseif ($memberType -eq '#microsoft.graph.group') {
                    # Group - SECURITY CRITICAL: Role-assignable groups
                    $groupType = "Security"
                    if ($member.groupTypes -contains 'Unified') {
                        $groupType = "Microsoft365"
                    }

                    $memberObj = [PSCustomObject]@{
                        id                = $memberId
                        displayName       = $memberName
                        memberType        = "Group"
                        groupType         = $groupType
                        isRoleAssignable  = $member.isAssignableToRole
                        securityEnabled   = $member.securityEnabled
                    }

                    $members += $memberObj
                    $groupMembers += $memberObj
                }
                else {
                    # Unknown type - log for visibility
                    $memberObj = [PSCustomObject]@{
                        id          = $memberId
                        displayName = $memberName
                        memberType  = $memberType ?? "Unknown"
                    }
                    $members += $memberObj
                }
            }
        }
        catch {
            Write-Host "        [!] Could not retrieve members: $($_.Exception.Message)" -ForegroundColor Yellow
            $errors += "Failed to get members for role $($role.DisplayName): $($_.Exception.Message)"
        }

        # Security flags for this role
        $hasServicePrincipals = $servicePrincipalMembers.Count -gt 0
        $hasGroups = $groupMembers.Count -gt 0
        $hasInactiveUsers = ($userMembers | Where-Object { $_.isInactive }).Count -gt 0
        $hasDisabledUsers = ($userMembers | Where-Object { -not $_.accountEnabled }).Count -gt 0
        $hasUsersWithoutMfa = ($userMembers | Where-Object { $_.mfaRegistered -eq $false }).Count -gt 0

        # Build comprehensive output object
        $processedRole = [PSCustomObject]@{
            roleId                    = $role.Id
            roleName                  = $role.DisplayName
            roleDescription           = $role.Description
            roleTemplateId            = $role.RoleTemplateId
            isHighPrivilege           = $isHighPrivilege

            # All members
            members                   = $members
            memberCount               = $members.Count

            # Member type breakdown
            userCount                 = $userMembers.Count
            servicePrincipalCount     = $servicePrincipalMembers.Count
            groupCount                = $groupMembers.Count

            # Security flags
            hasServicePrincipals      = $hasServicePrincipals
            hasGroups                 = $hasGroups
            hasInactiveUsers          = $hasInactiveUsers
            hasDisabledUsers          = $hasDisabledUsers
            hasUsersWithoutMfa        = $hasUsersWithoutMfa
        }

        $processedRoles += $processedRole
        $roleCount++
    }

    # Sort by high privilege first, then by member count
    $processedRoles = $processedRoles | Sort-Object -Property @{Expression = "isHighPrivilege"; Descending = $true}, @{Expression = "memberCount"; Descending = $true}

    # Save data using shared utility
    Save-CollectorData -Data $processedRoles -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $roleCount directory roles" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $roleCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
