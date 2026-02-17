# ============================================================================
# TenantScope - Cross-Entity Risk Scoring Engine
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Computes cross-entity composite risk scores per user and for the overall tenant.

.DESCRIPTION
    Aggregates data from multiple TenantScope collectors to produce a unified risk
    score (0-100) for each user and the tenant as a whole. Risk factors include:

    1. MFA registration status (weight 25)
    2. Admin role exposure (weight 20)
    3. Device compliance posture (weight 15)
    4. Identity risk level from Entra ID Protection (weight 15)
    5. Risky sign-in activity (weight 10)
    6. Conditional Access policy coverage (weight 10)
    7. OAuth consent grants with high-risk scopes (weight 5)

    Each factor contributes 0 to its maximum weight. The sum of all factors
    yields the composite risk score (0-100). Users are classified into tiers:

    - Critical: 80-100
    - High:     60-79
    - Medium:   40-59
    - Low:      20-39
    - Minimal:  0-19

    Tenant-level aggregation produces an overall grade (A-F), average user risk,
    risk distribution, top risk users, and a breakdown of which categories
    contribute the most risk across the tenant.

    Outputs risk-scores.json for consumption by the TenantScope dashboard.
    Also generates a standalone HTML report with a dark theme.

    Required data files (from prior data collection):
    - users.json
    - mfa-status.json
    - admin-roles.json
    - devices.json
    - identity-risk-data.json
    - conditional-access.json
    - signin-logs.json
    - risky-signins.json
    - defender-alerts.json
    - oauth-consent-grants.json

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/risk-scores/.

.EXAMPLE
    .\tools\Invoke-TenantRiskScore.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-TenantRiskScore.ps1 -Config $config -OutputPath "C:\Reports\Risk"

.NOTES
    Version: 1.0.0
    Read-only analysis tool. Does not modify any tenant data.
    Requires prior data collection via Invoke-DataCollection.ps1.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\risk-scores"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# Resolve data directory: prefer dashboard/data/, fallback to data/
$dashboardDataPath = Join-Path $PSScriptRoot "..\dashboard\data"
$fallbackDataPath = Join-Path $PSScriptRoot "..\data"

$dataPath = if (Test-Path $dashboardDataPath) { $dashboardDataPath } else { $fallbackDataPath }

# ============================================================================
# RISK FACTOR WEIGHTS
# ============================================================================

$RiskWeights = @{
    mfa         = 25
    adminRole   = 20
    device      = 15
    identityRisk = 15
    signinRisk  = 10
    caCoverage  = 10
    oauthConsent = 5
}

# ============================================================================
# DATA LOADING
# ============================================================================

function Import-DataFile {
    <#
    .SYNOPSIS
        Loads a JSON data file from the data directory with graceful fallback.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$FileName,

        [Parameter()]
        [string]$DataDirectory = $dataPath
    )

    $filePath = Join-Path $DataDirectory $FileName

    if (-not (Test-Path $filePath)) {
        # Try fallback directory
        $altPath = if ($DataDirectory -eq $dashboardDataPath) {
            Join-Path $fallbackDataPath $FileName
        } else {
            Join-Path $dashboardDataPath $FileName
        }

        if (Test-Path $altPath) {
            $filePath = $altPath
        } else {
            Write-Host "    [!] Data file not found: $FileName" -ForegroundColor Yellow
            return $null
        }
    }

    try {
        $content = Get-Content -Path $filePath -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($content)) {
            Write-Host "    [!] Empty data file: $FileName" -ForegroundColor Yellow
            return $null
        }
        return ($content | ConvertFrom-Json)
    }
    catch {
        Write-Host "    [!] Failed to parse: $FileName - $($_.Exception.Message)" -ForegroundColor Yellow
        return $null
    }
}

# ============================================================================
# RISK SCORING FUNCTIONS
# ============================================================================

function Get-MfaRiskScore {
    <#
    .SYNOPSIS
        Scores MFA risk for a user. 0 if MFA registered, 25 if not.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        $MfaData
    )

    $maxScore = $RiskWeights.mfa

    if ($null -eq $MfaData -or $MfaData.Count -eq 0) {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "MFA data unavailable (assumed unregistered)" }
    }

    $userMfa = $MfaData | Where-Object {
        $_.id -eq $UserId -or $_.userId -eq $UserId -or $_.userPrincipalName -eq $UserId
    } | Select-Object -First 1

    if ($null -eq $userMfa) {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "MFA not registered" }
    }

    # Check various property names used across different collection schemas
    $isRegistered = $false
    $methodCount = 0

    if ($null -ne $userMfa.isMfaRegistered) {
        $isRegistered = [bool]$userMfa.isMfaRegistered
    }
    elseif ($null -ne $userMfa.isRegistered) {
        $isRegistered = [bool]$userMfa.isRegistered
    }
    elseif ($null -ne $userMfa.isMfaCapable) {
        $isRegistered = [bool]$userMfa.isMfaCapable
    }
    elseif ($null -ne $userMfa.methodsRegistered) {
        $methodCount = @($userMfa.methodsRegistered).Count
        $isRegistered = $methodCount -gt 0
    }
    elseif ($null -ne $userMfa.authMethods) {
        $methodCount = @($userMfa.authMethods).Count
        $isRegistered = $methodCount -gt 0
    }

    if ($isRegistered) {
        return @{ score = 0; maxScore = $maxScore; detail = "MFA registered" }
    }
    else {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "MFA not registered" }
    }
}

function Get-AdminRoleRiskScore {
    <#
    .SYNOPSIS
        Scores admin role risk. 0 if no role, 10 if non-GA admin, 20 if Global Admin.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        $AdminRolesData
    )

    $maxScore = $RiskWeights.adminRole

    if ($null -eq $AdminRolesData -or $AdminRolesData.Count -eq 0) {
        return @{ score = 0; maxScore = $maxScore; detail = "Admin role data unavailable" }
    }

    # Find all role assignments for this user
    $userRoles = @($AdminRolesData | Where-Object {
        $_.userId -eq $UserId -or
        $_.principalId -eq $UserId -or
        $_.userPrincipalName -eq $UserPrincipalName -or
        $_.memberUpn -eq $UserPrincipalName
    })

    if ($userRoles.Count -eq 0) {
        return @{ score = 0; maxScore = $maxScore; detail = "No admin roles" }
    }

    # Check for Global Administrator
    $isGlobalAdmin = $false
    $roleNames = @()

    foreach ($role in $userRoles) {
        $roleName = if ($role.roleName) { $role.roleName }
                    elseif ($role.roleDisplayName) { $role.roleDisplayName }
                    elseif ($role.displayName) { $role.displayName }
                    else { "Unknown" }

        $roleNames += $roleName

        if ($roleName -match "Global Administrator|Company Administrator") {
            $isGlobalAdmin = $true
        }
    }

    # Check if assignment is PIM-eligible (not permanent)
    $hasPimProtection = $false
    foreach ($role in $userRoles) {
        $assignmentType = $role.assignmentType
        $memberType = $role.memberType
        if ($assignmentType -eq "Eligible" -or $memberType -eq "Eligible") {
            $hasPimProtection = $true
        }
    }

    if ($isGlobalAdmin) {
        if ($hasPimProtection) {
            return @{ score = 15; maxScore = $maxScore; detail = "Global Administrator (PIM eligible)" }
        }
        return @{ score = $maxScore; maxScore = $maxScore; detail = "Global Administrator (permanent)" }
    }
    else {
        $topRole = $roleNames[0]
        if ($hasPimProtection) {
            return @{ score = 5; maxScore = $maxScore; detail = "$topRole (PIM eligible)" }
        }
        return @{ score = 10; maxScore = $maxScore; detail = "$topRole" }
    }
}

function Get-DeviceComplianceRiskScore {
    <#
    .SYNOPSIS
        Scores device compliance risk.
        0 if all compliant, 7 if mixed, 15 if all noncompliant or no devices.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        $DevicesData
    )

    $maxScore = $RiskWeights.device

    if ($null -eq $DevicesData -or $DevicesData.Count -eq 0) {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "Device data unavailable" }
    }

    # Find devices for this user
    $userDevices = @($DevicesData | Where-Object {
        $_.userId -eq $UserId -or
        $_.userPrincipalName -eq $UserPrincipalName -or
        $_.userDisplayName -eq $UserPrincipalName
    })

    if ($userDevices.Count -eq 0) {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "No managed devices" }
    }

    $compliantCount = @($userDevices | Where-Object {
        $_.complianceState -eq "compliant" -or $_.isCompliant -eq $true
    }).Count

    $totalDevices = $userDevices.Count

    if ($compliantCount -eq $totalDevices) {
        return @{ score = 0; maxScore = $maxScore; detail = "All $totalDevices device(s) compliant" }
    }
    elseif ($compliantCount -gt 0) {
        return @{ score = 7; maxScore = $maxScore; detail = "$compliantCount of $totalDevices device(s) compliant" }
    }
    else {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "All $totalDevices device(s) noncompliant" }
    }
}

function Get-IdentityRiskScore {
    <#
    .SYNOPSIS
        Scores identity risk level. 0=none, 5=low, 10=medium, 15=high.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        $IdentityRiskData
    )

    $maxScore = $RiskWeights.identityRisk

    if ($null -eq $IdentityRiskData) {
        return @{ score = 0; maxScore = $maxScore; detail = "Identity risk data unavailable" }
    }

    # Handle both array and object formats
    $riskUsers = if ($IdentityRiskData.riskyUsers) { $IdentityRiskData.riskyUsers }
                 elseif ($IdentityRiskData -is [System.Collections.IEnumerable] -and $IdentityRiskData -isnot [string]) { $IdentityRiskData }
                 else { @() }

    $userRisk = $riskUsers | Where-Object {
        $_.id -eq $UserId -or
        $_.userId -eq $UserId -or
        $_.userPrincipalName -eq $UserPrincipalName
    } | Select-Object -First 1

    if ($null -eq $userRisk) {
        return @{ score = 0; maxScore = $maxScore; detail = "No identity risk detected" }
    }

    $riskLevel = if ($userRisk.riskLevel) { $userRisk.riskLevel.ToLower() }
                 elseif ($userRisk.riskState) { $userRisk.riskState.ToLower() }
                 else { "none" }

    switch ($riskLevel) {
        "high"   { return @{ score = 15; maxScore = $maxScore; detail = "High identity risk" } }
        "medium" { return @{ score = 10; maxScore = $maxScore; detail = "Medium identity risk" } }
        "low"    { return @{ score = 5; maxScore = $maxScore; detail = "Low identity risk" } }
        default  { return @{ score = 0; maxScore = $maxScore; detail = "No identity risk ($riskLevel)" } }
    }
}

function Get-SigninRiskScore {
    <#
    .SYNOPSIS
        Scores sign-in risk based on recent risky sign-ins count.
        0 for none, scaled up to 10 based on count.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        $RiskySigninsData,

        [Parameter()]
        $SigninLogsData
    )

    $maxScore = $RiskWeights.signinRisk

    # Count risky sign-ins for this user
    $riskyCount = 0

    if ($null -ne $RiskySigninsData -and $RiskySigninsData.Count -gt 0) {
        $userRiskySignins = @($RiskySigninsData | Where-Object {
            $_.userId -eq $UserId -or
            $_.userPrincipalName -eq $UserPrincipalName
        })
        $riskyCount = $userRiskySignins.Count
    }

    # Also check sign-in logs for risk indicators
    if ($null -ne $SigninLogsData -and $riskyCount -eq 0) {
        $signinData = if ($SigninLogsData.signIns) { $SigninLogsData.signIns }
                      elseif ($SigninLogsData -is [System.Collections.IEnumerable] -and $SigninLogsData -isnot [string]) { $SigninLogsData }
                      else { @() }

        $riskyFromLogs = @($signinData | Where-Object {
            ($_.userId -eq $UserId -or $_.userPrincipalName -eq $UserPrincipalName) -and
            ($_.riskLevelDuringSignIn -in @("high", "medium") -or $_.riskLevelAggregated -in @("high", "medium"))
        })
        $riskyCount += $riskyFromLogs.Count
    }

    if ($riskyCount -eq 0) {
        return @{ score = 0; maxScore = $maxScore; detail = "No risky sign-ins" }
    }
    elseif ($riskyCount -le 2) {
        return @{ score = 3; maxScore = $maxScore; detail = "$riskyCount risky sign-in(s)" }
    }
    elseif ($riskyCount -le 5) {
        return @{ score = 6; maxScore = $maxScore; detail = "$riskyCount risky sign-ins" }
    }
    elseif ($riskyCount -le 10) {
        return @{ score = 8; maxScore = $maxScore; detail = "$riskyCount risky sign-ins" }
    }
    else {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "$riskyCount risky sign-ins" }
    }
}

function Get-CACoverageRiskScore {
    <#
    .SYNOPSIS
        Scores CA coverage risk. 0 if user is covered by CA policies, 10 if not.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        $ConditionalAccessData,

        [Parameter()]
        $AdminRolesData
    )

    $maxScore = $RiskWeights.caCoverage

    if ($null -eq $ConditionalAccessData -or $ConditionalAccessData.Count -eq 0) {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "CA policy data unavailable" }
    }

    # Check if any enabled CA policy covers this user
    $enabledPolicies = @($ConditionalAccessData | Where-Object {
        $_.state -eq "enabled" -or $_.State -eq "enabled"
    })

    if ($enabledPolicies.Count -eq 0) {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "No enabled CA policies" }
    }

    $isCovered = $false
    $coveringPolicyCount = 0

    foreach ($policy in $enabledPolicies) {
        $conditions = $policy.conditions
        if ($null -eq $conditions) { $conditions = $policy.Conditions }
        if ($null -eq $conditions) { continue }

        $users = $conditions.users
        if ($null -eq $users) { $users = $conditions.Users }
        if ($null -eq $users) { continue }

        $includeUsers = $users.includeUsers
        if ($null -eq $includeUsers) { $includeUsers = $users.IncludeUsers }

        $excludeUsers = $users.excludeUsers
        if ($null -eq $excludeUsers) { $excludeUsers = $users.ExcludeUsers }

        # Check if user is explicitly excluded
        if ($excludeUsers -and ($excludeUsers -contains $UserId)) {
            continue
        }

        # Check if policy targets all users
        if ($includeUsers -and ($includeUsers -contains "All")) {
            $isCovered = $true
            $coveringPolicyCount++
            continue
        }

        # Check if user is explicitly included
        if ($includeUsers -and ($includeUsers -contains $UserId)) {
            $isCovered = $true
            $coveringPolicyCount++
            continue
        }

        # Check role-based targeting
        $includeRoles = $users.includeRoles
        if ($null -eq $includeRoles) { $includeRoles = $users.IncludeRoles }

        if ($includeRoles -and $includeRoles.Count -gt 0 -and $null -ne $AdminRolesData) {
            $userRoles = @($AdminRolesData | Where-Object {
                ($_.userId -eq $UserId -or $_.principalId -eq $UserId) -and
                ($_.roleDefinitionId -in $includeRoles -or $_.roleId -in $includeRoles)
            })
            if ($userRoles.Count -gt 0) {
                $isCovered = $true
                $coveringPolicyCount++
            }
        }
    }

    if ($isCovered) {
        return @{ score = 0; maxScore = $maxScore; detail = "Covered by $coveringPolicyCount CA policy/policies" }
    }
    else {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "No CA policy coverage detected" }
    }
}

function Get-OAuthConsentRiskScore {
    <#
    .SYNOPSIS
        Scores OAuth consent risk based on high-risk app consents.
        0 for none, scaled up to 5 based on risk severity.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserId,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        $OAuthConsentData
    )

    $maxScore = $RiskWeights.oauthConsent

    if ($null -eq $OAuthConsentData -or $OAuthConsentData.Count -eq 0) {
        return @{ score = 0; maxScore = $maxScore; detail = "No OAuth consent data" }
    }

    # High-risk OAuth scopes
    $highRiskScopes = @(
        "Mail.Read", "Mail.ReadWrite", "Mail.Send",
        "Directory.ReadWrite.All", "Directory.AccessAsUser.All",
        "User.ReadWrite.All", "Files.ReadWrite.All",
        "Sites.ReadWrite.All", "Application.ReadWrite.All",
        "RoleManagement.ReadWrite.Directory", "full_access_as_app"
    )

    # Find consents by or for this user
    $userConsents = @($OAuthConsentData | Where-Object {
        $_.principalId -eq $UserId -or
        $_.userId -eq $UserId -or
        ($_.consentType -eq "AllPrincipals")
    })

    if ($userConsents.Count -eq 0) {
        return @{ score = 0; maxScore = $maxScore; detail = "No OAuth consents" }
    }

    $highRiskCount = 0

    foreach ($consent in $userConsents) {
        $scopes = @()
        if ($consent.scope) {
            $scopes = $consent.scope -split " " | Where-Object { $_ -ne "" }
        }

        foreach ($scope in $scopes) {
            if ($highRiskScopes -contains $scope) {
                $highRiskCount++
                break
            }
        }
    }

    if ($highRiskCount -eq 0) {
        return @{ score = 0; maxScore = $maxScore; detail = "$($userConsents.Count) consent(s), none high-risk" }
    }
    elseif ($highRiskCount -le 2) {
        return @{ score = 3; maxScore = $maxScore; detail = "$highRiskCount high-risk app consent(s)" }
    }
    else {
        return @{ score = $maxScore; maxScore = $maxScore; detail = "$highRiskCount high-risk app consents" }
    }
}

# ============================================================================
# CLASSIFICATION AND GRADING
# ============================================================================

function Get-RiskTier {
    <#
    .SYNOPSIS
        Classifies a composite risk score into a named tier.
    #>
    param([int]$Score)

    if ($Score -ge 80) { return "critical" }
    if ($Score -ge 60) { return "high" }
    if ($Score -ge 40) { return "medium" }
    if ($Score -ge 20) { return "low" }
    return "minimal"
}

function Get-TenantGrade {
    <#
    .SYNOPSIS
        Assigns a letter grade to the overall tenant risk score.
    #>
    param([double]$Score)

    if ($Score -le 15) { return "A" }
    if ($Score -le 30) { return "B" }
    if ($Score -le 50) { return "C" }
    if ($Score -le 70) { return "D" }
    return "F"
}

function Get-TierColor {
    <#
    .SYNOPSIS
        Returns a console color for a given risk tier.
    #>
    param([string]$Tier)

    switch ($Tier) {
        "critical" { return "Red" }
        "high"     { return "DarkYellow" }
        "medium"   { return "Yellow" }
        "low"      { return "Cyan" }
        "minimal"  { return "Green" }
        default    { return "Gray" }
    }
}

# ============================================================================
# MAIN RISK SCORING ENGINE
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Cross-Entity Risk Scoring" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$now = Get-Date

# -----------------------------------------------------------------------
# 1. Load all required data files
# -----------------------------------------------------------------------
Write-Host "  Loading data files..." -ForegroundColor Gray

$users              = Import-DataFile -FileName "users.json"
$mfaStatus          = Import-DataFile -FileName "mfa-status.json"
$adminRoles         = Import-DataFile -FileName "admin-roles.json"
$devices            = Import-DataFile -FileName "devices.json"
$identityRiskData   = Import-DataFile -FileName "identity-risk-data.json"
$conditionalAccess  = Import-DataFile -FileName "conditional-access.json"
$signinLogs         = Import-DataFile -FileName "signin-logs.json"
$riskySignins       = Import-DataFile -FileName "risky-signins.json"
$defenderAlerts     = Import-DataFile -FileName "defender-alerts.json"
$oauthConsentGrants = Import-DataFile -FileName "oauth-consent-grants.json"

if ($null -eq $users -or @($users).Count -eq 0) {
    Write-Host "  [X] No user data found. Cannot compute risk scores." -ForegroundColor Red
    Write-Host "      Run Invoke-DataCollection.ps1 first to collect tenant data." -ForegroundColor Red
    Write-Host ""
    return
}

$userList = @($users)
Write-Host "  Loaded data for $($userList.Count) users" -ForegroundColor Gray
Write-Host ""

# -----------------------------------------------------------------------
# 2. Compute per-user risk scores
# -----------------------------------------------------------------------
Write-Host "  Computing per-user risk scores..." -ForegroundColor Gray

$userRiskResults = @()
$factorTotals = @{
    mfa          = 0
    adminRole    = 0
    device       = 0
    identityRisk = 0
    signinRisk   = 0
    caCoverage   = 0
    oauthConsent = 0
}

$processedCount = 0

foreach ($user in $userList) {
    $userId = $user.id
    $upn = $user.userPrincipalName
    $displayName = $user.displayName

    if ([string]::IsNullOrWhiteSpace($userId)) { continue }

    # Compute each risk factor
    $mfaResult = Get-MfaRiskScore -UserId $userId -MfaData $mfaStatus
    $adminResult = Get-AdminRoleRiskScore -UserId $userId -UserPrincipalName $upn -AdminRolesData $adminRoles
    $deviceResult = Get-DeviceComplianceRiskScore -UserId $userId -UserPrincipalName $upn -DevicesData $devices
    $identityResult = Get-IdentityRiskScore -UserId $userId -UserPrincipalName $upn -IdentityRiskData $identityRiskData
    $signinResult = Get-SigninRiskScore -UserId $userId -UserPrincipalName $upn -RiskySigninsData $riskySignins -SigninLogsData $signinLogs
    $caResult = Get-CACoverageRiskScore -UserId $userId -UserPrincipalName $upn -ConditionalAccessData $conditionalAccess -AdminRolesData $adminRoles
    $oauthResult = Get-OAuthConsentRiskScore -UserId $userId -UserPrincipalName $upn -OAuthConsentData $oauthConsentGrants

    # Sum composite score
    $compositeScore = $mfaResult.score + $adminResult.score + $deviceResult.score +
                      $identityResult.score + $signinResult.score + $caResult.score +
                      $oauthResult.score

    $compositeScore = [math]::Min(100, [math]::Max(0, $compositeScore))
    $riskTier = Get-RiskTier -Score $compositeScore

    # Accumulate factor totals for tenant-level analysis
    $factorTotals.mfa          += $mfaResult.score
    $factorTotals.adminRole    += $adminResult.score
    $factorTotals.device       += $deviceResult.score
    $factorTotals.identityRisk += $identityResult.score
    $factorTotals.signinRisk   += $signinResult.score
    $factorTotals.caCoverage   += $caResult.score
    $factorTotals.oauthConsent += $oauthResult.score

    $userRiskResults += [PSCustomObject]@{
        id                = $userId
        displayName       = $displayName
        userPrincipalName = $upn
        compositeScore    = $compositeScore
        riskTier          = $riskTier
        factors           = [ordered]@{
            mfa          = @{ score = $mfaResult.score; maxScore = $mfaResult.maxScore; detail = $mfaResult.detail }
            adminRole    = @{ score = $adminResult.score; maxScore = $adminResult.maxScore; detail = $adminResult.detail }
            device       = @{ score = $deviceResult.score; maxScore = $deviceResult.maxScore; detail = $deviceResult.detail }
            identityRisk = @{ score = $identityResult.score; maxScore = $identityResult.maxScore; detail = $identityResult.detail }
            signinRisk   = @{ score = $signinResult.score; maxScore = $signinResult.maxScore; detail = $signinResult.detail }
            caCoverage   = @{ score = $caResult.score; maxScore = $caResult.maxScore; detail = $caResult.detail }
            oauthConsent = @{ score = $oauthResult.score; maxScore = $oauthResult.maxScore; detail = $oauthResult.detail }
        }
    }

    $processedCount++
    if ($processedCount % 100 -eq 0) {
        Write-Host "    Processed $processedCount / $($userList.Count) users..." -ForegroundColor Gray
    }
}

Write-Host "  Scored $processedCount users" -ForegroundColor Gray
Write-Host ""

# -----------------------------------------------------------------------
# 3. Compute tenant-level aggregates
# -----------------------------------------------------------------------
Write-Host "  Computing tenant-level aggregates..." -ForegroundColor Gray

$totalUsers = $userRiskResults.Count

# Risk distribution
$distribution = @{
    critical = @($userRiskResults | Where-Object { $_.riskTier -eq "critical" }).Count
    high     = @($userRiskResults | Where-Object { $_.riskTier -eq "high" }).Count
    medium   = @($userRiskResults | Where-Object { $_.riskTier -eq "medium" }).Count
    low      = @($userRiskResults | Where-Object { $_.riskTier -eq "low" }).Count
    minimal  = @($userRiskResults | Where-Object { $_.riskTier -eq "minimal" }).Count
}

# Average risk score
$averageRisk = if ($totalUsers -gt 0) {
    [math]::Round(($userRiskResults | Measure-Object -Property compositeScore -Average).Average, 1)
} else { 0 }

# Overall tenant score: weighted average that penalizes high-risk users
# Uses a formula that weighs critical/high users more heavily
$overallScore = if ($totalUsers -gt 0) {
    $weightedSum = ($distribution.critical * 90) + ($distribution.high * 70) +
                   ($distribution.medium * 50) + ($distribution.low * 30) +
                   ($distribution.minimal * 10)
    [math]::Round($weightedSum / $totalUsers, 0)
} else { 0 }

$tenantGrade = Get-TenantGrade -Score $overallScore

# Top 10 highest-risk users
$topRiskUsers = $userRiskResults | Sort-Object -Property compositeScore -Descending | Select-Object -First 10

# Category breakdown: which factors contribute most risk across the tenant
$topRiskFactors = @()
$factorLabels = @{
    mfa          = "MFA Registration"
    adminRole    = "Admin Role Exposure"
    device       = "Device Compliance"
    identityRisk = "Identity Risk Level"
    signinRisk   = "Sign-in Risk"
    caCoverage   = "CA Policy Coverage"
    oauthConsent = "OAuth Consent Risk"
}

foreach ($factorKey in $factorTotals.Keys) {
    $totalPoints = $factorTotals[$factorKey]
    $maxPossible = $RiskWeights[$factorKey] * $totalUsers
    $percentage = if ($maxPossible -gt 0) { [math]::Round(($totalPoints / $maxPossible) * 100, 1) } else { 0 }

    $topRiskFactors += [PSCustomObject]@{
        factor        = $factorKey
        label         = $factorLabels[$factorKey]
        totalPoints   = $totalPoints
        maxPossible   = $maxPossible
        percentage    = $percentage
        averageScore  = if ($totalUsers -gt 0) { [math]::Round($totalPoints / $totalUsers, 1) } else { 0 }
        weight        = $RiskWeights[$factorKey]
    }
}

$topRiskFactors = $topRiskFactors | Sort-Object -Property percentage -Descending

# -----------------------------------------------------------------------
# 4. Build output JSON
# -----------------------------------------------------------------------
Write-Host "  Generating risk-scores.json..." -ForegroundColor Gray

$riskReport = [ordered]@{
    generatedAt = $now.ToString("o")
    tenantRisk  = [ordered]@{
        overallScore    = [int]$overallScore
        grade           = $tenantGrade
        averageUserRisk = $averageRisk
        distribution    = [ordered]@{
            critical = $distribution.critical
            high     = $distribution.high
            medium   = $distribution.medium
            low      = $distribution.low
            minimal  = $distribution.minimal
        }
        topRiskFactors  = @($topRiskFactors | ForEach-Object {
            [ordered]@{
                factor       = $_.factor
                label        = $_.label
                totalPoints  = $_.totalPoints
                maxPossible  = $_.maxPossible
                percentage   = $_.percentage
                averageScore = $_.averageScore
                weight       = $_.weight
            }
        })
    }
    users = @($userRiskResults | Sort-Object -Property compositeScore -Descending | ForEach-Object {
        [ordered]@{
            id                = $_.id
            displayName       = $_.displayName
            userPrincipalName = $_.userPrincipalName
            compositeScore    = $_.compositeScore
            riskTier          = $_.riskTier
            factors           = $_.factors
        }
    })
}

$jsonContent = $riskReport | ConvertTo-Json -Depth 10

# Save to OutputPath
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = Join-Path $OutputPath "risk-scores.json"
$jsonContent | Set-Content -Path $outputFile -Encoding UTF8

# Also save timestamped copy
$timestampedFile = Join-Path $OutputPath "risk-scores-${timestamp}.json"
$jsonContent | Set-Content -Path $timestampedFile -Encoding UTF8

# Save to dashboard/data/ for the web dashboard
$dashboardOutputFile = Join-Path $dashboardDataPath "risk-scores.json"
try {
    if (-not (Test-Path $dashboardDataPath)) {
        New-Item -ItemType Directory -Path $dashboardDataPath -Force | Out-Null
    }
    $jsonContent | Set-Content -Path $dashboardOutputFile -Encoding UTF8
    Write-Host "    Saved to dashboard: $dashboardOutputFile" -ForegroundColor Gray
}
catch {
    Write-Host "    [!] Could not save to dashboard path: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "    Saved: $outputFile" -ForegroundColor Gray

# -----------------------------------------------------------------------
# 5. Print colored summary table to console
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  Tenant Risk Score Summary" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# Overall score and grade
$gradeColor = switch ($tenantGrade) {
    "A" { "Green" }
    "B" { "Cyan" }
    "C" { "Yellow" }
    "D" { "DarkYellow" }
    "F" { "Red" }
}

Write-Host "  Overall Tenant Score: " -NoNewline -ForegroundColor White
Write-Host "$overallScore / 100" -NoNewline -ForegroundColor $gradeColor
Write-Host "  Grade: " -NoNewline -ForegroundColor White
Write-Host "$tenantGrade" -ForegroundColor $gradeColor
Write-Host "  Average User Risk:   $averageRisk" -ForegroundColor Gray
Write-Host "  Total Users Scored:  $totalUsers" -ForegroundColor Gray
Write-Host ""

# Distribution table
Write-Host "  Risk Distribution:" -ForegroundColor White
Write-Host "  -------------------------------------------" -ForegroundColor DarkGray

$tierOrder = @("critical", "high", "medium", "low", "minimal")
foreach ($tier in $tierOrder) {
    $count = $distribution[$tier]
    $pct = if ($totalUsers -gt 0) { [math]::Round(($count / $totalUsers) * 100, 1) } else { 0 }
    $color = Get-TierColor -Tier $tier
    $tierLabel = $tier.Substring(0,1).ToUpper() + $tier.Substring(1)
    $bar = "[" + ("=" * [math]::Min(30, [math]::Max(0, [math]::Round($pct / 3.33)))) + (" " * [math]::Max(0, 30 - [math]::Round($pct / 3.33))) + "]"

    Write-Host "    $($tierLabel.PadRight(10))" -NoNewline -ForegroundColor $color
    Write-Host " $($count.ToString().PadLeft(5)) " -NoNewline -ForegroundColor White
    Write-Host "$bar" -NoNewline -ForegroundColor $color
    Write-Host " $pct%" -ForegroundColor Gray
}

Write-Host ""

# Top risk factors
Write-Host "  Top Risk Factors (tenant-wide):" -ForegroundColor White
Write-Host "  -------------------------------------------" -ForegroundColor DarkGray

foreach ($factor in $topRiskFactors) {
    $factorColor = if ($factor.percentage -ge 60) { "Red" }
                   elseif ($factor.percentage -ge 40) { "DarkYellow" }
                   elseif ($factor.percentage -ge 20) { "Yellow" }
                   else { "Green" }

    Write-Host "    $($factor.label.PadRight(22))" -NoNewline -ForegroundColor White
    Write-Host " $($factor.percentage.ToString('0.0').PadLeft(5))%" -NoNewline -ForegroundColor $factorColor
    Write-Host "  (avg $($factor.averageScore) / $($factor.weight))" -ForegroundColor Gray
}

Write-Host ""

# Top 10 riskiest users
if ($topRiskUsers.Count -gt 0) {
    Write-Host "  Top 10 Highest-Risk Users:" -ForegroundColor White
    Write-Host "  -------------------------------------------" -ForegroundColor DarkGray
    Write-Host "    $("Score".PadRight(8)) $("Tier".PadRight(10)) $("User".PadRight(40)) Top Factor" -ForegroundColor DarkGray

    foreach ($riskUser in $topRiskUsers) {
        $color = Get-TierColor -Tier $riskUser.riskTier
        $tierLabel = $riskUser.riskTier.Substring(0,1).ToUpper() + $riskUser.riskTier.Substring(1)

        # Find the highest scoring factor
        $topFactor = ""
        $topFactorScore = 0
        foreach ($fKey in $riskUser.factors.Keys) {
            $fValue = $riskUser.factors[$fKey]
            if ($fValue.score -gt $topFactorScore) {
                $topFactorScore = $fValue.score
                $topFactor = $fValue.detail
            }
        }

        $nameDisplay = if ($riskUser.displayName.Length -gt 38) {
            $riskUser.displayName.Substring(0, 35) + "..."
        } else { $riskUser.displayName }

        Write-Host "    $($riskUser.compositeScore.ToString().PadRight(8))" -NoNewline -ForegroundColor $color
        Write-Host "$($tierLabel.PadRight(10))" -NoNewline -ForegroundColor $color
        Write-Host "$($nameDisplay.PadRight(40))" -NoNewline -ForegroundColor White
        Write-Host "$topFactor" -ForegroundColor Gray
    }
}

Write-Host ""

# -----------------------------------------------------------------------
# 6. Generate HTML report with dark theme
# -----------------------------------------------------------------------
Write-Host "  Generating HTML report..." -ForegroundColor Gray

# Build user rows for the HTML table
$userRowsHtml = ""
$sortedUsers = $userRiskResults | Sort-Object -Property compositeScore -Descending

foreach ($u in $sortedUsers) {
    $tierClass = $u.riskTier
    $tierLabel = $u.riskTier.Substring(0,1).ToUpper() + $u.riskTier.Substring(1)
    $badgeClass = switch ($u.riskTier) {
        "critical" { "badge-critical" }
        "high"     { "badge-high" }
        "medium"   { "badge-medium" }
        "low"      { "badge-low" }
        "minimal"  { "badge-minimal" }
    }

    # Build factor breakdown cells
    $factorCells = ""
    foreach ($fKey in @("mfa", "adminRole", "device", "identityRisk", "signinRisk", "caCoverage", "oauthConsent")) {
        $f = $u.factors[$fKey]
        $cellClass = if ($f.score -eq 0) { "factor-ok" }
                     elseif ($f.score -ge $f.maxScore) { "factor-critical" }
                     elseif ($f.score -ge ($f.maxScore * 0.5)) { "factor-warn" }
                     else { "factor-low" }
        $factorCells += "<td class=`"$cellClass`" title=`"$([System.Web.HttpUtility]::HtmlEncode($f.detail))`">$($f.score)/$($f.maxScore)</td>"
    }

    $userRowsHtml += @"
        <tr class="tier-$tierClass">
            <td class="score-cell"><span class="score-badge $badgeClass">$($u.compositeScore)</span></td>
            <td><span class="badge $badgeClass">$tierLabel</span></td>
            <td class="user-name">$([System.Web.HttpUtility]::HtmlEncode($u.displayName))</td>
            <td class="user-upn">$([System.Web.HttpUtility]::HtmlEncode($u.userPrincipalName))</td>
            $factorCells
        </tr>
"@
}

# Build risk factor summary rows
$factorSummaryHtml = ""
foreach ($factor in $topRiskFactors) {
    $barWidth = [math]::Min(100, [math]::Max(0, $factor.percentage))
    $barColor = if ($factor.percentage -ge 60) { "#ef4444" }
                elseif ($factor.percentage -ge 40) { "#f97316" }
                elseif ($factor.percentage -ge 20) { "#f59e0b" }
                else { "#10b981" }

    $factorSummaryHtml += @"
        <div class="factor-row">
            <div class="factor-label">$([System.Web.HttpUtility]::HtmlEncode($factor.label))</div>
            <div class="factor-bar-container">
                <div class="factor-bar" style="width: ${barWidth}%; background: $barColor;"></div>
            </div>
            <div class="factor-pct">$($factor.percentage)%</div>
            <div class="factor-detail">avg $($factor.averageScore) / $($factor.weight)</div>
        </div>
"@
}

# Build top 10 user cards for the HTML
$topUsersHtml = ""
$rank = 0
foreach ($tu in $topRiskUsers) {
    $rank++
    $tierLabel = $tu.riskTier.Substring(0,1).ToUpper() + $tu.riskTier.Substring(1)
    $badgeClass = switch ($tu.riskTier) {
        "critical" { "badge-critical" }
        "high"     { "badge-high" }
        "medium"   { "badge-medium" }
        "low"      { "badge-low" }
        "minimal"  { "badge-minimal" }
    }

    $factorBars = ""
    foreach ($fKey in @("mfa", "adminRole", "device", "identityRisk", "signinRisk", "caCoverage", "oauthConsent")) {
        $f = $tu.factors[$fKey]
        $pct = if ($f.maxScore -gt 0) { [math]::Round(($f.score / $f.maxScore) * 100) } else { 0 }
        $fColor = if ($f.score -eq 0) { "#10b981" }
                  elseif ($f.score -ge $f.maxScore) { "#ef4444" }
                  elseif ($f.score -ge ($f.maxScore * 0.5)) { "#f97316" }
                  else { "#f59e0b" }
        $fLabel = $factorLabels[$fKey]

        $factorBars += @"
            <div class="mini-factor">
                <span class="mini-label">$fLabel</span>
                <div class="mini-bar-bg"><div class="mini-bar" style="width:${pct}%;background:$fColor;"></div></div>
                <span class="mini-score">$($f.score)/$($f.maxScore)</span>
            </div>
"@
    }

    $topUsersHtml += @"
        <div class="risk-user-card">
            <div class="risk-user-header">
                <span class="risk-rank">#$rank</span>
                <span class="score-badge $badgeClass large">$($tu.compositeScore)</span>
                <div class="risk-user-info">
                    <div class="risk-user-name">$([System.Web.HttpUtility]::HtmlEncode($tu.displayName))</div>
                    <div class="risk-user-upn">$([System.Web.HttpUtility]::HtmlEncode($tu.userPrincipalName))</div>
                </div>
                <span class="badge $badgeClass">$tierLabel</span>
            </div>
            <div class="risk-user-factors">
                $factorBars
            </div>
        </div>
"@
}

# Distribution chart data
$gradeColorHtml = switch ($tenantGrade) {
    "A" { "#10b981" }
    "B" { "#06b6d4" }
    "C" { "#f59e0b" }
    "D" { "#f97316" }
    "F" { "#ef4444" }
}

$htmlReport = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TenantScope - Risk Score Report</title>
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-card: #1e293b;
            --bg-hover: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --border: #334155;
            --accent: #3b82f6;
            --critical: #ef4444;
            --high: #f97316;
            --medium: #f59e0b;
            --low: #06b6d4;
            --minimal: #10b981;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            padding: 24px;
        }

        .header {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            border-radius: 16px;
            padding: 32px 40px;
            margin-bottom: 24px;
            border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .header .subtitle {
            color: var(--text-secondary);
            font-size: 14px;
        }

        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .kpi-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px 24px;
            text-align: center;
        }

        .kpi-card .kpi-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: var(--text-muted);
            margin-bottom: 8px;
        }

        .kpi-card .kpi-value {
            font-size: 36px;
            font-weight: 800;
            line-height: 1.1;
        }

        .kpi-card .kpi-sub {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 4px;
        }

        .grade-card .kpi-value {
            font-size: 48px;
        }

        .section {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }

        .section h2 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
        }

        /* Distribution bars */
        .dist-row {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
            gap: 12px;
        }

        .dist-label {
            width: 80px;
            font-size: 13px;
            font-weight: 600;
            text-align: right;
        }

        .dist-bar-bg {
            flex: 1;
            height: 28px;
            background: rgba(255,255,255,0.05);
            border-radius: 6px;
            overflow: hidden;
            position: relative;
        }

        .dist-bar {
            height: 100%;
            border-radius: 6px;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            padding-left: 8px;
            font-size: 12px;
            font-weight: 600;
            color: white;
            min-width: fit-content;
        }

        .dist-count {
            width: 60px;
            text-align: right;
            font-size: 13px;
            color: var(--text-secondary);
        }

        /* Factor rows */
        .factor-row {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
            gap: 12px;
        }

        .factor-label {
            width: 180px;
            font-size: 13px;
            color: var(--text-primary);
        }

        .factor-bar-container {
            flex: 1;
            height: 20px;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            overflow: hidden;
        }

        .factor-bar {
            height: 100%;
            border-radius: 4px;
            transition: width 0.3s ease;
        }

        .factor-pct {
            width: 50px;
            text-align: right;
            font-size: 13px;
            font-weight: 600;
        }

        .factor-detail {
            width: 110px;
            text-align: right;
            font-size: 12px;
            color: var(--text-muted);
        }

        /* Top risk user cards */
        .risk-user-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 16px 20px;
            margin-bottom: 12px;
        }

        .risk-user-card:hover {
            background: var(--bg-hover);
        }

        .risk-user-header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 12px;
        }

        .risk-rank {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-muted);
            width: 28px;
        }

        .risk-user-info {
            flex: 1;
        }

        .risk-user-name {
            font-weight: 600;
            font-size: 14px;
        }

        .risk-user-upn {
            font-size: 12px;
            color: var(--text-muted);
        }

        .risk-user-factors {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 6px;
            padding-left: 42px;
        }

        .mini-factor {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
        }

        .mini-label {
            width: 100px;
            color: var(--text-secondary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .mini-bar-bg {
            flex: 1;
            height: 6px;
            background: rgba(255,255,255,0.08);
            border-radius: 3px;
            overflow: hidden;
        }

        .mini-bar {
            height: 100%;
            border-radius: 3px;
        }

        .mini-score {
            width: 36px;
            text-align: right;
            color: var(--text-muted);
            font-weight: 600;
        }

        /* Badges */
        .badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .badge-critical { background: rgba(239,68,68,0.2); color: #ef4444; }
        .badge-high     { background: rgba(249,115,22,0.2); color: #f97316; }
        .badge-medium   { background: rgba(245,158,11,0.2); color: #f59e0b; }
        .badge-low      { background: rgba(6,182,212,0.2); color: #06b6d4; }
        .badge-minimal  { background: rgba(16,185,129,0.2); color: #10b981; }

        .score-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 800;
        }

        .score-badge.large {
            width: 48px;
            height: 48px;
            font-size: 20px;
        }

        .score-badge.badge-critical { background: rgba(239,68,68,0.15); color: #ef4444; border: 2px solid rgba(239,68,68,0.3); }
        .score-badge.badge-high     { background: rgba(249,115,22,0.15); color: #f97316; border: 2px solid rgba(249,115,22,0.3); }
        .score-badge.badge-medium   { background: rgba(245,158,11,0.15); color: #f59e0b; border: 2px solid rgba(245,158,11,0.3); }
        .score-badge.badge-low      { background: rgba(6,182,212,0.15); color: #06b6d4; border: 2px solid rgba(6,182,212,0.3); }
        .score-badge.badge-minimal  { background: rgba(16,185,129,0.15); color: #10b981; border: 2px solid rgba(16,185,129,0.3); }

        /* All users table */
        .table-container {
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        th {
            text-align: left;
            padding: 10px 12px;
            background: rgba(255,255,255,0.03);
            border-bottom: 2px solid var(--border);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            white-space: nowrap;
        }

        td {
            padding: 8px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            vertical-align: middle;
        }

        tr:hover {
            background: rgba(255,255,255,0.03);
        }

        .score-cell {
            text-align: center;
        }

        .user-name {
            font-weight: 500;
        }

        .user-upn {
            color: var(--text-muted);
            font-size: 12px;
        }

        .factor-ok       { color: var(--minimal); text-align: center; }
        .factor-low      { color: var(--medium); text-align: center; }
        .factor-warn     { color: var(--high); text-align: center; }
        .factor-critical { color: var(--critical); text-align: center; font-weight: 700; }

        .footer {
            text-align: center;
            color: var(--text-muted);
            font-size: 12px;
            padding: 24px;
        }

        .two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }

        @media (max-width: 900px) {
            .two-col { grid-template-columns: 1fr; }
            .kpi-grid { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>TenantScope Risk Score Report</h1>
        <div class="subtitle">Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") UTC | Users analyzed: $totalUsers</div>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid">
        <div class="kpi-card grade-card">
            <div class="kpi-label">Tenant Grade</div>
            <div class="kpi-value" style="color: $gradeColorHtml">$tenantGrade</div>
            <div class="kpi-sub">Score: $overallScore / 100</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Average User Risk</div>
            <div class="kpi-value" style="color: $gradeColorHtml">$averageRisk</div>
            <div class="kpi-sub">out of 100</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Critical Users</div>
            <div class="kpi-value" style="color: var(--critical)">$($distribution.critical)</div>
            <div class="kpi-sub">score 80-100</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">High Risk Users</div>
            <div class="kpi-value" style="color: var(--high)">$($distribution.high)</div>
            <div class="kpi-sub">score 60-79</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Total Users</div>
            <div class="kpi-value" style="color: var(--accent)">$totalUsers</div>
            <div class="kpi-sub">scored</div>
        </div>
    </div>

    <!-- Distribution and Factors side by side -->
    <div class="two-col">
        <div class="section">
            <h2>Risk Distribution</h2>
            <div class="dist-row">
                <div class="dist-label" style="color:var(--critical)">Critical</div>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: $(if ($totalUsers -gt 0) { [math]::Round(($distribution.critical / $totalUsers) * 100, 1) } else { 0 })%; background: var(--critical);">$(if ($distribution.critical -gt 0) { $distribution.critical })</div>
                </div>
                <div class="dist-count">$(if ($totalUsers -gt 0) { [math]::Round(($distribution.critical / $totalUsers) * 100, 1) } else { 0 })%</div>
            </div>
            <div class="dist-row">
                <div class="dist-label" style="color:var(--high)">High</div>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: $(if ($totalUsers -gt 0) { [math]::Round(($distribution.high / $totalUsers) * 100, 1) } else { 0 })%; background: var(--high);">$(if ($distribution.high -gt 0) { $distribution.high })</div>
                </div>
                <div class="dist-count">$(if ($totalUsers -gt 0) { [math]::Round(($distribution.high / $totalUsers) * 100, 1) } else { 0 })%</div>
            </div>
            <div class="dist-row">
                <div class="dist-label" style="color:var(--medium)">Medium</div>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: $(if ($totalUsers -gt 0) { [math]::Round(($distribution.medium / $totalUsers) * 100, 1) } else { 0 })%; background: var(--medium);">$(if ($distribution.medium -gt 0) { $distribution.medium })</div>
                </div>
                <div class="dist-count">$(if ($totalUsers -gt 0) { [math]::Round(($distribution.medium / $totalUsers) * 100, 1) } else { 0 })%</div>
            </div>
            <div class="dist-row">
                <div class="dist-label" style="color:var(--low)">Low</div>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: $(if ($totalUsers -gt 0) { [math]::Round(($distribution.low / $totalUsers) * 100, 1) } else { 0 })%; background: var(--low);">$(if ($distribution.low -gt 0) { $distribution.low })</div>
                </div>
                <div class="dist-count">$(if ($totalUsers -gt 0) { [math]::Round(($distribution.low / $totalUsers) * 100, 1) } else { 0 })%</div>
            </div>
            <div class="dist-row">
                <div class="dist-label" style="color:var(--minimal)">Minimal</div>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: $(if ($totalUsers -gt 0) { [math]::Round(($distribution.minimal / $totalUsers) * 100, 1) } else { 0 })%; background: var(--minimal);">$(if ($distribution.minimal -gt 0) { $distribution.minimal })</div>
                </div>
                <div class="dist-count">$(if ($totalUsers -gt 0) { [math]::Round(($distribution.minimal / $totalUsers) * 100, 1) } else { 0 })%</div>
            </div>
        </div>

        <div class="section">
            <h2>Risk Factor Breakdown</h2>
            $factorSummaryHtml
        </div>
    </div>

    <!-- Top 10 Risk Users -->
    <div class="section">
        <h2>Top 10 Highest-Risk Users</h2>
        $(if ($topUsersHtml) { $topUsersHtml } else { "<p style='color:var(--text-muted);text-align:center;padding:40px;'>No users scored.</p>" })
    </div>

    <!-- Full User Table -->
    <div class="section">
        <h2>All Users ($totalUsers)</h2>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Score</th>
                        <th>Tier</th>
                        <th>Name</th>
                        <th>UPN</th>
                        <th title="MFA Registration (max $($RiskWeights.mfa))">MFA</th>
                        <th title="Admin Role (max $($RiskWeights.adminRole))">Admin</th>
                        <th title="Device Compliance (max $($RiskWeights.device))">Device</th>
                        <th title="Identity Risk (max $($RiskWeights.identityRisk))">Identity</th>
                        <th title="Sign-in Risk (max $($RiskWeights.signinRisk))">Sign-in</th>
                        <th title="CA Coverage (max $($RiskWeights.caCoverage))">CA</th>
                        <th title="OAuth Consent (max $($RiskWeights.oauthConsent))">OAuth</th>
                    </tr>
                </thead>
                <tbody>
                    $userRowsHtml
                </tbody>
            </table>
        </div>
    </div>

    <!-- Grade Scale Reference -->
    <div class="section">
        <h2>Grading Scale</h2>
        <div style="display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px;">
            <div><span style="color:#10b981;font-weight:700;font-size:18px;">A</span> <span style="color:var(--text-secondary)">0-15 (Excellent)</span></div>
            <div><span style="color:#06b6d4;font-weight:700;font-size:18px;">B</span> <span style="color:var(--text-secondary)">16-30 (Good)</span></div>
            <div><span style="color:#f59e0b;font-weight:700;font-size:18px;">C</span> <span style="color:var(--text-secondary)">31-50 (Needs Improvement)</span></div>
            <div><span style="color:#f97316;font-weight:700;font-size:18px;">D</span> <span style="color:var(--text-secondary)">51-70 (Poor)</span></div>
            <div><span style="color:#ef4444;font-weight:700;font-size:18px;">F</span> <span style="color:var(--text-secondary)">71-100 (Critical)</span></div>
        </div>
        <div style="margin-top: 16px; font-size: 13px; color: var(--text-muted);">
            <strong>Risk Tiers:</strong> Critical (80-100) | High (60-79) | Medium (40-59) | Low (20-39) | Minimal (0-19)
        </div>
        <div style="margin-top: 8px; font-size: 13px; color: var(--text-muted);">
            <strong>Factor Weights:</strong> MFA ($($RiskWeights.mfa)) | Admin Role ($($RiskWeights.adminRole)) | Device ($($RiskWeights.device)) | Identity Risk ($($RiskWeights.identityRisk)) | Sign-in Risk ($($RiskWeights.signinRisk)) | CA Coverage ($($RiskWeights.caCoverage)) | OAuth ($($RiskWeights.oauthConsent))
        </div>
    </div>

    <div class="footer">
        TenantScope Risk Score Report | Generated $(Get-Date -Format "yyyy-MM-dd HH:mm") UTC | github.com/Thugney/-M365-TENANT-TOOLKIT
    </div>
</body>
</html>
"@

$htmlFile = Join-Path $OutputPath "risk-score-report-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

# -----------------------------------------------------------------------
# Final summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Output files:" -ForegroundColor White
Write-Host "    JSON:       $outputFile" -ForegroundColor Green
Write-Host "    HTML:       $htmlFile" -ForegroundColor Green
Write-Host "    Dashboard:  $dashboardOutputFile" -ForegroundColor Green
Write-Host ""
Write-Host "  Risk scoring complete." -ForegroundColor Cyan
Write-Host ""

return $riskReport
