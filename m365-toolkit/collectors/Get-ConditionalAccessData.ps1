# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
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

function Get-CaProperty {
    param(
        [Parameter()]
        [AllowNull()]
        $Object,

        [Parameter(Mandatory)]
        [string[]]$Names
    )

    return Get-GraphPropertyValue -Object $Object -PropertyNames $Names
}

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

    $includeUsers = Get-CaProperty -Object $Users -Names @("IncludeUsers","includeUsers")
    $excludeUsers = Get-CaProperty -Object $Users -Names @("ExcludeUsers","excludeUsers")
    $includeGroups = Get-CaProperty -Object $Users -Names @("IncludeGroups","includeGroups")
    $excludeGroups = Get-CaProperty -Object $Users -Names @("ExcludeGroups","excludeGroups")
    $includeRoles = Get-CaProperty -Object $Users -Names @("IncludeRoles","includeRoles")
    $excludeRoles = Get-CaProperty -Object $Users -Names @("ExcludeRoles","excludeRoles")
    $includeGuests = Get-CaProperty -Object $Users -Names @("IncludeGuestsOrExternalUsers","includeGuestsOrExternalUsers")

    # Check for "All" users
    if ($includeUsers -contains "All") {
        $summary.includesAllUsers = $true
    }
    if ($includeGuests) {
        $summary.includesAllGuests = $true
    }

    # Specific includes/excludes
    if ($includeUsers) {
        $summary.includedUsers = @($includeUsers | Where-Object { $_ -ne "All" -and $_ -ne "None" -and $_ -ne "GuestsOrExternalUsers" })
    }
    if ($excludeUsers) {
        $summary.excludedUsers = @($excludeUsers)
    }
    if ($includeGroups) {
        $summary.includedGroups = @($includeGroups)
    }
    if ($excludeGroups) {
        $summary.excludedGroups = @($excludeGroups)
    }
    if ($includeRoles) {
        $summary.includedRoles = @($includeRoles)
    }
    if ($excludeRoles) {
        $summary.excludedRoles = @($excludeRoles)
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

    $builtIn = Get-CaProperty -Object $GrantControls -Names @("BuiltInControls","builtInControls")
    if ($builtIn) {
        $summary.requiresMfa = $builtIn -contains "mfa"
        $summary.requiresCompliantDevice = $builtIn -contains "compliantDevice"
        $summary.requiresHybridJoin = $builtIn -contains "domainJoinedDevice"
        $summary.requiresApprovedApp = $builtIn -contains "approvedApplication"
        $summary.requiresAppProtection = $builtIn -contains "compliantApplication"
        $summary.requiresPasswordChange = $builtIn -contains "passwordChange"
        $summary.blockAccess = $builtIn -contains "block"
    }

    $operator = Get-CaProperty -Object $GrantControls -Names @("Operator","operator")
    if ($operator) {
        $summary.operator = $operator
    }

    $customFactors = Get-CaProperty -Object $GrantControls -Names @("CustomAuthenticationFactors","customAuthenticationFactors")
    if ($customFactors) {
        $summary.customControls = @($customFactors)
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

    $includeApplications = Get-CaProperty -Object $Applications -Names @("IncludeApplications","includeApplications")
    $excludeApplications = Get-CaProperty -Object $Applications -Names @("ExcludeApplications","excludeApplications")

    if ($includeApplications -contains "All") {
        $summary.includesAllApps = $true
    }
    if ($includeApplications -contains "Office365") {
        $summary.includesOffice365 = $true
    }

    if ($includeApplications) {
        $summary.includedApps = @($includeApplications | Where-Object { $_ -ne "All" -and $_ -ne "None" -and $_ -ne "Office365" })
    }
    if ($excludeApplications) {
        $summary.excludedApps = @($excludeApplications)
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
    $policyState = Get-CaProperty -Object $Policy -Names @("State","state")
    if ($policyState -eq "enabledForReportingButNotEnforced") {
        return "report-only"
    }

    # Disabled policies
    if ($policyState -eq "disabled") {
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

    # Retrieve all CA policies. Prefer the SDK cmdlet, then fall back to direct
    # REST because some tenants return "does not have access to this report"
    # through the cmdlet even when the same delegated session can read the API.
    $policies = @()
    try {
        $policies = @(Invoke-GraphWithRetry -ScriptBlock {
            Get-MgIdentityConditionalAccessPolicy -All
        } -OperationName "CA policy retrieval")
    }
    catch {
        $cmdletError = $_.Exception.Message
        Write-Host "      [!] CA cmdlet failed, trying direct Graph API: $cmdletError" -ForegroundColor Yellow

        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?`$top=100" -OutputType PSObject
        } -OperationName "CA policy REST retrieval"

        if ($response.value) {
            $policies = @($response.value)
        }

        while ($response.'@odata.nextLink') {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
            } -OperationName "CA policy REST pagination"
            if ($response.value) {
                $policies += @($response.value)
            }
        }
    }

    Write-Host "      Retrieved $($policies.Count) policies from Graph API" -ForegroundColor Gray

    # Share CA policies with downstream collectors (Get-NamedLocations)
    if ($SharedData -is [hashtable]) {
        $SharedData['CAPolicies'] = $policies
    }

    # Process each policy
    $processedPolicies = @()

    foreach ($policy in $policies) {
        $conditions = Get-CaProperty -Object $policy -Names @("Conditions","conditions")
        $usersCondition = Get-CaProperty -Object $conditions -Names @("Users","users")
        $applicationsCondition = Get-CaProperty -Object $conditions -Names @("Applications","applications")
        $grantControls = Get-CaProperty -Object $policy -Names @("GrantControls","grantControls")
        $state = Get-CaProperty -Object $policy -Names @("State","state")
        $createdDateTime = Get-CaProperty -Object $policy -Names @("CreatedDateTime","createdDateTime")
        $modifiedDateTime = Get-CaProperty -Object $policy -Names @("ModifiedDateTime","modifiedDateTime")

        # Parse conditions
        $targetSummary = Get-PolicyTargetSummary -Users $usersCondition
        $appSummary = Get-ApplicationsSummary -Applications $applicationsCondition
        $grantSummary = Get-GrantControlsSummary -GrantControls $grantControls

        # Determine policy classification
        $riskLevel = Get-PolicyRiskLevel -Policy $policy -GrantSummary $grantSummary -TargetSummary $targetSummary

        # Check for legacy auth blocking
        $blocksLegacyAuth = $false
        $clientAppTypes = Get-CaProperty -Object $conditions -Names @("ClientAppTypes","clientAppTypes")
        if ($clientAppTypes) {
            $legacyTypes = @("exchangeActiveSync", "other")
            $hasLegacy = $clientAppTypes | Where-Object { $legacyTypes -contains $_ }
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
            id                    = Get-CaProperty -Object $policy -Names @("Id","id")
            displayName           = Get-CaProperty -Object $policy -Names @("DisplayName","displayName")
            state                 = $state
            createdDateTime       = Format-IsoDate -DateValue $createdDateTime
            modifiedDateTime      = Format-IsoDate -DateValue $modifiedDateTime
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
            hasLocationCondition  = ($null -ne (Get-CaProperty -Object $conditions -Names @("Locations","locations")))
            hasPlatformCondition  = ($null -ne (Get-CaProperty -Object $conditions -Names @("Platforms","platforms")))
            hasRiskCondition      = @((Get-CaProperty -Object $conditions -Names @("UserRiskLevels","userRiskLevels"))).Count -gt 0 -or @((Get-CaProperty -Object $conditions -Names @("SignInRiskLevels","signInRiskLevels"))).Count -gt 0
            hasDeviceCondition    = ($null -ne (Get-CaProperty -Object $conditions -Names @("Devices","devices")))
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
    if ((Test-GraphAccessError -Value $errorMessage) -or $errorMessage -match "Premium|license|subscription|Entra ID P1|P2") {
        Write-Host "    [!] CA policy collection requires Entra ID P1/P2 and Policy.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}

