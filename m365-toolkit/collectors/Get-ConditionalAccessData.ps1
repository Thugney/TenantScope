# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Conditional Access policies from Microsoft Entra ID via Graph API.

.DESCRIPTION
    Retrieves all Conditional Access policies including their state, conditions,
    and grant/session controls. Analyzes policy coverage to identify users
    without MFA enforcement or other security gaps.

    Graph API endpoint: GET /identity/conditionalAccess/policies
    Required scope: Policy.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes conditional-access.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of policies collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-ConditionalAccessData.ps1 -Config $config -OutputPath ".\data\conditional-access.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.SignIns

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

function Get-PolicyTargetSummary {
    <#
    .SYNOPSIS
        Summarizes the target users/groups for a CA policy condition.
    #>
    param(
        [Parameter()]
        $Users
    )

    $summary = @{
        includesAllUsers = $false
        includesAllGuests = $false
        includedUsers = @()
        excludedUsers = @()
        includedGroups = @()
        excludedGroups = @()
        includedRoles = @()
        excludedRoles = @()
    }

    if ($null -eq $Users) {
        return $summary
    }

    # Check for "All" users
    if ($Users.IncludeUsers -contains "All") {
        $summary.includesAllUsers = $true
    }
    if ($Users.IncludeGuestsOrExternalUsers) {
        $summary.includesAllGuests = $true
    }

    # Specific includes/excludes
    if ($Users.IncludeUsers) {
        $summary.includedUsers = @($Users.IncludeUsers | Where-Object { $_ -ne "All" -and $_ -ne "None" -and $_ -ne "GuestsOrExternalUsers" })
    }
    if ($Users.ExcludeUsers) {
        $summary.excludedUsers = @($Users.ExcludeUsers)
    }
    if ($Users.IncludeGroups) {
        $summary.includedGroups = @($Users.IncludeGroups)
    }
    if ($Users.ExcludeGroups) {
        $summary.excludedGroups = @($Users.ExcludeGroups)
    }
    if ($Users.IncludeRoles) {
        $summary.includedRoles = @($Users.IncludeRoles)
    }
    if ($Users.ExcludeRoles) {
        $summary.excludedRoles = @($Users.ExcludeRoles)
    }

    return $summary
}

function Get-GrantControlsSummary {
    <#
    .SYNOPSIS
        Summarizes the grant controls for a CA policy.
    #>
    param(
        [Parameter()]
        $GrantControls
    )

    $summary = @{
        requiresMfa = $false
        requiresCompliantDevice = $false
        requiresHybridJoin = $false
        requiresApprovedApp = $false
        requiresAppProtection = $false
        requiresPasswordChange = $false
        blockAccess = $false
        operator = "OR"
        customControls = @()
    }

    if ($null -eq $GrantControls) {
        return $summary
    }

    $builtIn = $GrantControls.BuiltInControls
    if ($builtIn) {
        $summary.requiresMfa = $builtIn -contains "mfa"
        $summary.requiresCompliantDevice = $builtIn -contains "compliantDevice"
        $summary.requiresHybridJoin = $builtIn -contains "domainJoinedDevice"
        $summary.requiresApprovedApp = $builtIn -contains "approvedApplication"
        $summary.requiresAppProtection = $builtIn -contains "compliantApplication"
        $summary.requiresPasswordChange = $builtIn -contains "passwordChange"
        $summary.blockAccess = $builtIn -contains "block"
    }

    if ($GrantControls.Operator) {
        $summary.operator = $GrantControls.Operator
    }

    if ($GrantControls.CustomAuthenticationFactors) {
        $summary.customControls = @($GrantControls.CustomAuthenticationFactors)
    }

    return $summary
}

function Get-ApplicationsSummary {
    <#
    .SYNOPSIS
        Summarizes the target applications for a CA policy.
    #>
    param(
        [Parameter()]
        $Applications
    )

    $summary = @{
        includesAllApps = $false
        includesOffice365 = $false
        includedApps = @()
        excludedApps = @()
    }

    if ($null -eq $Applications) {
        return $summary
    }

    if ($Applications.IncludeApplications -contains "All") {
        $summary.includesAllApps = $true
    }
    if ($Applications.IncludeApplications -contains "Office365") {
        $summary.includesOffice365 = $true
    }

    if ($Applications.IncludeApplications) {
        $summary.includedApps = @($Applications.IncludeApplications | Where-Object { $_ -ne "All" -and $_ -ne "None" -and $_ -ne "Office365" })
    }
    if ($Applications.ExcludeApplications) {
        $summary.excludedApps = @($Applications.ExcludeApplications)
    }

    return $summary
}

function Get-PolicyRiskLevel {
    <#
    .SYNOPSIS
        Determines policy risk classification based on its configuration.
    .OUTPUTS
        String: "high-security", "standard", "weak", or "report-only"
    #>
    param(
        [Parameter(Mandatory)]
        $Policy,
        [Parameter(Mandatory)]
        $GrantSummary,
        [Parameter(Mandatory)]
        $TargetSummary
    )

    # Report-only policies don't enforce anything
    if ($Policy.State -eq "enabledForReportingButNotEnforced") {
        return "report-only"
    }

    # Disabled policies
    if ($Policy.State -eq "disabled") {
        return "disabled"
    }

    # High security: blocks access or requires MFA for all users
    if ($GrantSummary.blockAccess) {
        return "high-security"
    }

    if ($GrantSummary.requiresMfa -and $TargetSummary.includesAllUsers) {
        return "high-security"
    }

    # Standard: requires MFA or compliant device for specific scenarios
    if ($GrantSummary.requiresMfa -or $GrantSummary.requiresCompliantDevice -or $GrantSummary.requiresHybridJoin) {
        return "standard"
    }

    # Weak: no strong controls
    return "weak"
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$policyCount = 0

try {
    Write-Host "    Collecting Conditional Access policies..." -ForegroundColor Gray

    # Retrieve all CA policies
    $policies = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgIdentityConditionalAccessPolicy -All
    } -OperationName "CA policy retrieval"

    Write-Host "      Retrieved $($policies.Count) policies from Graph API" -ForegroundColor Gray

    # Process each policy
    $processedPolicies = @()

    foreach ($policy in $policies) {
        # Parse conditions
        $targetSummary = Get-PolicyTargetSummary -Users $policy.Conditions.Users
        $appSummary = Get-ApplicationsSummary -Applications $policy.Conditions.Applications
        $grantSummary = Get-GrantControlsSummary -GrantControls $policy.GrantControls

        # Determine policy classification
        $riskLevel = Get-PolicyRiskLevel -Policy $policy -GrantSummary $grantSummary -TargetSummary $targetSummary

        # Check for legacy auth blocking
        $blocksLegacyAuth = $false
        if ($policy.Conditions.ClientAppTypes) {
            $legacyTypes = @("exchangeActiveSync", "other")
            $hasLegacy = $policy.Conditions.ClientAppTypes | Where-Object { $legacyTypes -contains $_ }
            if ($hasLegacy -and $grantSummary.blockAccess) {
                $blocksLegacyAuth = $true
            }
        }

        # Determine policy type/category
        $policyType = "other"
        if ($grantSummary.requiresMfa) { $policyType = "mfa" }
        elseif ($grantSummary.blockAccess) { $policyType = "block" }
        elseif ($grantSummary.requiresCompliantDevice) { $policyType = "device-compliance" }
        elseif ($grantSummary.requiresHybridJoin) { $policyType = "hybrid-join" }

        # Build output object
        $processedPolicy = [PSCustomObject]@{
            id                    = $policy.Id
            displayName           = $policy.DisplayName
            state                 = $policy.State
            createdDateTime       = if ($policy.CreatedDateTime) { $policy.CreatedDateTime.ToString("o") } else { $null }
            modifiedDateTime      = if ($policy.ModifiedDateTime) { $policy.ModifiedDateTime.ToString("o") } else { $null }
            # Target summary
            includesAllUsers      = $targetSummary.includesAllUsers
            includesAllGuests     = $targetSummary.includesAllGuests
            includedUserCount     = $targetSummary.includedUsers.Count
            excludedUserCount     = $targetSummary.excludedUsers.Count
            includedGroupCount    = $targetSummary.includedGroups.Count
            excludedGroupCount    = $targetSummary.excludedGroups.Count
            includedRoleCount     = $targetSummary.includedRoles.Count
            excludedRoleCount     = $targetSummary.excludedRoles.Count
            # Detailed arrays for cross-reference
            excludedUserIds       = $targetSummary.excludedUsers
            excludedGroupIds      = $targetSummary.excludedGroups
            includedGroupIds      = $targetSummary.includedGroups
            includedRoleIds       = $targetSummary.includedRoles
            # Application targeting
            includesAllApps       = $appSummary.includesAllApps
            includesOffice365     = $appSummary.includesOffice365
            # Grant controls
            requiresMfa           = $grantSummary.requiresMfa
            requiresCompliantDevice = $grantSummary.requiresCompliantDevice
            requiresHybridJoin    = $grantSummary.requiresHybridJoin
            blockAccess           = $grantSummary.blockAccess
            grantOperator         = $grantSummary.operator
            # Classification
            policyType            = $policyType
            riskLevel             = $riskLevel
            blocksLegacyAuth      = $blocksLegacyAuth
            # Conditions summary
            hasLocationCondition  = ($null -ne $policy.Conditions.Locations -and ($policy.Conditions.Locations.IncludeLocations -or $policy.Conditions.Locations.ExcludeLocations))
            hasPlatformCondition  = ($null -ne $policy.Conditions.Platforms -and ($policy.Conditions.Platforms.IncludePlatforms -or $policy.Conditions.Platforms.ExcludePlatforms))
            hasRiskCondition      = ($null -ne $policy.Conditions.UserRiskLevels -and $policy.Conditions.UserRiskLevels.Count -gt 0) -or ($null -ne $policy.Conditions.SignInRiskLevels -and $policy.Conditions.SignInRiskLevels.Count -gt 0)
            hasDeviceCondition    = ($null -ne $policy.Conditions.Devices)
        }

        $processedPolicies += $processedPolicy
        $policyCount++
    }

    # Sort by state (enabled first) then by name
    $processedPolicies = $processedPolicies | Sort-Object -Property @{Expression = {
        switch ($_.state) {
            "enabled" { 0 }
            "enabledForReportingButNotEnforced" { 1 }
            "disabled" { 2 }
            default { 3 }
        }
    }}, displayName

    # Save data using shared utility
    Save-CollectorData -Data $processedPolicies -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $policyCount Conditional Access policies" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $policyCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Premium|license|subscription|permission|forbidden|Entra ID P1|P2") {
        Write-Host "    [!] CA policy collection requires Entra ID P1/P2 and Policy.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
