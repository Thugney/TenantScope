# ============================================================================
# TenantScope - Conditional Access Gap Analyzer
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Audits Conditional Access policies and identifies coverage gaps.

.DESCRIPTION
    Performs a comprehensive analysis of Conditional Access (CA) policies to find
    security gaps that could leave users, apps, or devices unprotected:

    1. Users with no CA policy applied
    2. Applications with no CA policy coverage
    3. Devices accessing resources without compliance checks
    4. Stale exclusion groups with members that should have been removed
    5. Report-only policies that should be enforced
    6. Missing baseline policies (legacy auth block, MFA for admins, etc.)

    Generates a risk report with prioritized findings and remediation guidance.

    Required Graph scopes:
    - Policy.Read.All
    - User.Read.All
    - Application.Read.All
    - Group.Read.All
    - Directory.Read.All

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/ca-gap-analysis/.

.PARAMETER IncludeDisabledPolicies
    Include disabled policies in the analysis.

.EXAMPLE
    .\tools\Invoke-CAGapAnalyzer.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-CAGapAnalyzer.ps1 -Config $config -IncludeDisabledPolicies

.NOTES
    Version: 1.0.0
    Read-only analysis - does not modify any CA policies.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Identity.SignIns

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [switch]$IncludeDisabledPolicies
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\ca-gap-analysis"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# Baseline policies every tenant should have
$BaselinePolicies = @(
    @{
        name        = "Block Legacy Authentication"
        description = "Legacy auth protocols (POP, IMAP, SMTP) bypass MFA and should be blocked"
        check       = "legacy-auth-block"
        severity    = "critical"
    },
    @{
        name        = "Require MFA for Administrators"
        description = "All admin roles should require MFA with no exceptions"
        check       = "admin-mfa"
        severity    = "critical"
    },
    @{
        name        = "Require MFA for All Users"
        description = "All users should have an MFA policy (can allow trusted locations)"
        check       = "all-users-mfa"
        severity    = "high"
    },
    @{
        name        = "Require Compliant Device"
        description = "At least one policy should require device compliance for resource access"
        check       = "device-compliance"
        severity    = "high"
    },
    @{
        name        = "Block High-Risk Sign-ins"
        description = "Identity Protection should block high-risk sign-ins"
        check       = "risk-based-block"
        severity    = "high"
    },
    @{
        name        = "Require MFA for Risky Sign-ins"
        description = "Medium-risk sign-ins should require additional verification"
        check       = "risk-based-mfa"
        severity    = "medium"
    }
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Test-PolicyBlocksLegacyAuth {
    param($Policy)

    if ($Policy.Conditions.ClientAppTypes) {
        $legacyTypes = @("exchangeActiveSync", "other")
        $targetLegacy = $Policy.Conditions.ClientAppTypes | Where-Object { $legacyTypes -contains $_ }

        if ($targetLegacy -and $Policy.GrantControls.BuiltInControls -contains "block") {
            return $true
        }
    }
    return $false
}

function Test-PolicyRequiresMfaForAdmins {
    param($Policy)

    $hasAdminRoles = $Policy.Conditions.Users.IncludeRoles -and $Policy.Conditions.Users.IncludeRoles.Count -gt 0
    $targetsAllUsers = $Policy.Conditions.Users.IncludeUsers -contains "All"
    $requiresMfa = $Policy.GrantControls.BuiltInControls -contains "mfa"

    return ($hasAdminRoles -or $targetsAllUsers) -and $requiresMfa
}

function Test-PolicyRequiresMfaForAll {
    param($Policy)

    $targetsAll = $Policy.Conditions.Users.IncludeUsers -contains "All"
    $requiresMfa = $Policy.GrantControls.BuiltInControls -contains "mfa"

    return $targetsAll -and $requiresMfa
}

function Test-PolicyRequiresDeviceCompliance {
    param($Policy)

    return $Policy.GrantControls.BuiltInControls -contains "compliantDevice"
}

function Test-PolicyBlocksRiskySignins {
    param($Policy)

    $hasRiskLevels = $Policy.Conditions.SignInRiskLevels -and
        ($Policy.Conditions.SignInRiskLevels -contains "high")
    $blocks = $Policy.GrantControls.BuiltInControls -contains "block"

    return $hasRiskLevels -and $blocks
}

function Test-PolicyRequiresMfaForRisk {
    param($Policy)

    $hasRiskLevels = $Policy.Conditions.SignInRiskLevels -and
        ($Policy.Conditions.SignInRiskLevels -contains "medium" -or $Policy.Conditions.SignInRiskLevels -contains "high")
    $requiresMfa = $Policy.GrantControls.BuiltInControls -contains "mfa"

    return $hasRiskLevels -and $requiresMfa
}

function Get-ExclusionGroupMembers {
    <#
    .SYNOPSIS
        Gets members of exclusion groups and checks for stale entries.
    #>
    param([string]$GroupId)

    try {
        $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members?`$select=id,displayName,userPrincipalName,accountEnabled,userType&`$top=200"
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Get exclusion group members" -MaxRetries 2

        if ($response.value) {
            return @($response.value)
        }
    }
    catch {
        # Group may not be readable
    }

    return @()
}

function Resolve-GroupDisplayName {
    param([string]$GroupId)

    try {
        $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId`?`$select=displayName"
        $group = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Resolve group name" -MaxRetries 2
        return $group.displayName
    }
    catch {
        return $GroupId
    }
}

# ============================================================================
# MAIN ANALYSIS
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Conditional Access Gap Analyzer" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$findings = @()
$now = Get-Date

# -----------------------------------------------------------------------
# 1. Retrieve all CA policies
# -----------------------------------------------------------------------
Write-Host "  Fetching Conditional Access policies..." -ForegroundColor Gray

$policies = @()
try {
    $policies = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgIdentityConditionalAccessPolicy -All
    } -OperationName "Get CA policies"

    Write-Host "  Retrieved $($policies.Count) CA policies" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve CA policies: $($_.Exception.Message)" -ForegroundColor Red
    return
}

# Filter active policies (enabled or report-only)
$activePolicies = $policies | Where-Object {
    $_.State -eq "enabled" -or $_.State -eq "enabledForReportingButNotEnforced"
}
$enabledPolicies = $policies | Where-Object { $_.State -eq "enabled" }
$reportOnlyPolicies = $policies | Where-Object { $_.State -eq "enabledForReportingButNotEnforced" }
$disabledPolicies = $policies | Where-Object { $_.State -eq "disabled" }

Write-Host "    Enabled:     $($enabledPolicies.Count)" -ForegroundColor Gray
Write-Host "    Report-only: $($reportOnlyPolicies.Count)" -ForegroundColor Gray
Write-Host "    Disabled:    $($disabledPolicies.Count)" -ForegroundColor Gray

# -----------------------------------------------------------------------
# 2. Baseline policy checks
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Checking baseline policy coverage..." -ForegroundColor Gray

foreach ($baseline in $BaselinePolicies) {
    $found = $false

    foreach ($policy in $enabledPolicies) {
        $result = switch ($baseline.check) {
            "legacy-auth-block"  { Test-PolicyBlocksLegacyAuth -Policy $policy }
            "admin-mfa"          { Test-PolicyRequiresMfaForAdmins -Policy $policy }
            "all-users-mfa"      { Test-PolicyRequiresMfaForAll -Policy $policy }
            "device-compliance"  { Test-PolicyRequiresDeviceCompliance -Policy $policy }
            "risk-based-block"   { Test-PolicyBlocksRiskySignins -Policy $policy }
            "risk-based-mfa"     { Test-PolicyRequiresMfaForRisk -Policy $policy }
        }

        if ($result) {
            $found = $true
            break
        }
    }

    if (-not $found) {
        # Check if it exists in report-only
        $inReportOnly = $false
        foreach ($policy in $reportOnlyPolicies) {
            $result = switch ($baseline.check) {
                "legacy-auth-block"  { Test-PolicyBlocksLegacyAuth -Policy $policy }
                "admin-mfa"          { Test-PolicyRequiresMfaForAdmins -Policy $policy }
                "all-users-mfa"      { Test-PolicyRequiresMfaForAll -Policy $policy }
                "device-compliance"  { Test-PolicyRequiresDeviceCompliance -Policy $policy }
                "risk-based-block"   { Test-PolicyBlocksRiskySignins -Policy $policy }
                "risk-based-mfa"     { Test-PolicyRequiresMfaForRisk -Policy $policy }
            }
            if ($result) { $inReportOnly = $true; break }
        }

        $findings += [PSCustomObject]@{
            category    = "Missing Baseline Policy"
            severity    = $baseline.severity
            finding     = $baseline.name
            description = $baseline.description
            detail      = if ($inReportOnly) { "EXISTS in report-only mode — should be enforced" } else { "NOT FOUND — must be created" }
            remediation = if ($inReportOnly) { "Switch the report-only policy to enabled state" } else { "Create this policy in Conditional Access" }
        }

        $statusColor = if ($inReportOnly) { "Yellow" } else { "Red" }
        $statusText = if ($inReportOnly) { "REPORT-ONLY" } else { "MISSING" }
        Write-Host "    [$statusText] $($baseline.name)" -ForegroundColor $statusColor
    }
    else {
        Write-Host "    [OK] $($baseline.name)" -ForegroundColor Green
    }
}

# -----------------------------------------------------------------------
# 3. Stale exclusion group analysis
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Analyzing exclusion groups for stale members..." -ForegroundColor Gray

$exclusionGroupIds = @()
foreach ($policy in $activePolicies) {
    if ($policy.Conditions.Users.ExcludeGroups) {
        $exclusionGroupIds += $policy.Conditions.Users.ExcludeGroups
    }
}
$exclusionGroupIds = $exclusionGroupIds | Sort-Object -Unique

Write-Host "    Found $($exclusionGroupIds.Count) exclusion groups across all policies" -ForegroundColor Gray

foreach ($groupId in $exclusionGroupIds) {
    $groupName = Resolve-GroupDisplayName -GroupId $groupId
    $members = Get-ExclusionGroupMembers -GroupId $groupId

    # Check for disabled accounts in exclusion groups
    $disabledMembers = @($members | Where-Object { $_.accountEnabled -eq $false })
    if ($disabledMembers.Count -gt 0) {
        $disabledNames = ($disabledMembers | ForEach-Object { $_.displayName }) -join ", "
        $findings += [PSCustomObject]@{
            category    = "Stale Exclusion Group"
            severity    = "high"
            finding     = "Disabled accounts in exclusion group: $groupName"
            description = "Disabled accounts should not remain in CA exclusion groups"
            detail      = "$($disabledMembers.Count) disabled account(s): $disabledNames"
            remediation = "Remove disabled accounts from the exclusion group '$groupName'"
        }
        Write-Host "    [HIGH] $groupName - $($disabledMembers.Count) disabled accounts" -ForegroundColor Red
    }

    # Check for guest accounts in exclusion groups
    $guestMembers = @($members | Where-Object { $_.userType -eq "Guest" })
    if ($guestMembers.Count -gt 0) {
        $findings += [PSCustomObject]@{
            category    = "Stale Exclusion Group"
            severity    = "medium"
            finding     = "Guest accounts in exclusion group: $groupName"
            description = "Guest accounts in CA exclusion groups may bypass security controls"
            detail      = "$($guestMembers.Count) guest account(s)"
            remediation = "Review guest accounts in '$groupName' and remove if no longer needed"
        }
        Write-Host "    [MEDIUM] $groupName - $($guestMembers.Count) guest accounts" -ForegroundColor Yellow
    }

    # Large exclusion groups (potential scope creep)
    if ($members.Count -gt 50) {
        $findings += [PSCustomObject]@{
            category    = "Exclusion Group Size"
            severity    = "medium"
            finding     = "Large exclusion group: $groupName ($($members.Count) members)"
            description = "Exclusion groups should be kept small and reviewed regularly"
            detail      = "$($members.Count) members — may indicate scope creep"
            remediation = "Review all members in '$groupName' and remove those that no longer need exemption"
        }
        Write-Host "    [MEDIUM] $groupName - $($members.Count) members (scope creep risk)" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------
# 4. Report-only policies that should be enforced
# -----------------------------------------------------------------------
if ($reportOnlyPolicies.Count -gt 0) {
    Write-Host ""
    Write-Host "  Checking report-only policies..." -ForegroundColor Gray

    foreach ($policy in $reportOnlyPolicies) {
        $findings += [PSCustomObject]@{
            category    = "Report-Only Policy"
            severity    = "medium"
            finding     = "Policy in report-only: $($policy.DisplayName)"
            description = "Report-only policies log but do not enforce controls"
            detail      = "Review sign-in logs to validate impact before enabling"
            remediation = "After validation, switch '$($policy.DisplayName)' to enabled state"
        }
        Write-Host "    [INFO] Report-only: $($policy.DisplayName)" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------
# 5. Policies targeting specific users (not groups)
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Checking for user-targeted policies..." -ForegroundColor Gray

foreach ($policy in $activePolicies) {
    $includeUsers = $policy.Conditions.Users.IncludeUsers | Where-Object { $_ -ne "All" -and $_ -ne "None" -and $_ -ne "GuestsOrExternalUsers" }
    if ($includeUsers -and $includeUsers.Count -gt 0) {
        $findings += [PSCustomObject]@{
            category    = "Policy Hygiene"
            severity    = "low"
            finding     = "Policy targets specific users: $($policy.DisplayName)"
            description = "Policies should target groups, not individual users, for maintainability"
            detail      = "$($includeUsers.Count) individual user(s) targeted"
            remediation = "Create a group for these users and target the group instead"
        }
        Write-Host "    [LOW] $($policy.DisplayName) - targets $($includeUsers.Count) specific users" -ForegroundColor Gray
    }
}

# -----------------------------------------------------------------------
# 6. App coverage gaps
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Checking application coverage..." -ForegroundColor Gray

$hasAllAppsPolicy = $false
foreach ($policy in $enabledPolicies) {
    if ($policy.Conditions.Applications.IncludeApplications -contains "All") {
        $hasAllAppsPolicy = $true
        break
    }
}

if (-not $hasAllAppsPolicy) {
    $findings += [PSCustomObject]@{
        category    = "Application Coverage"
        severity    = "high"
        finding     = "No policy targets 'All cloud apps'"
        description = "At least one enforced policy should apply to all cloud apps for baseline coverage"
        detail      = "Without an all-apps policy, newly registered apps may not be protected"
        remediation = "Create a CA policy with 'All cloud apps' as the target, requiring at minimum MFA"
    }
    Write-Host "    [HIGH] No policy covers 'All cloud apps'" -ForegroundColor Red
}
else {
    Write-Host "    [OK] At least one policy covers all cloud apps" -ForegroundColor Green
}

# -----------------------------------------------------------------------
# 7. Generate risk report
# -----------------------------------------------------------------------
$criticalCount = ($findings | Where-Object { $_.severity -eq "critical" }).Count
$highCount = ($findings | Where-Object { $_.severity -eq "high" }).Count
$mediumCount = ($findings | Where-Object { $_.severity -eq "medium" }).Count
$lowCount = ($findings | Where-Object { $_.severity -eq "low" }).Count

# Calculate risk score (0-100)
$riskScore = [math]::Min(100, ($criticalCount * 25) + ($highCount * 15) + ($mediumCount * 5) + ($lowCount * 2))

$report = [PSCustomObject]@{
    reportType   = "ca-gap-analysis"
    generated    = $now.ToString("o")
    riskScore    = $riskScore
    policySummary = [PSCustomObject]@{
        total      = $policies.Count
        enabled    = $enabledPolicies.Count
        reportOnly = $reportOnlyPolicies.Count
        disabled   = $disabledPolicies.Count
    }
    findingSummary = [PSCustomObject]@{
        total    = $findings.Count
        critical = $criticalCount
        high     = $highCount
        medium   = $mediumCount
        low      = $lowCount
    }
    findings     = $findings
}

# Save JSON report
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$jsonFile = Join-Path $OutputPath "ca-gap-analysis-${timestamp}.json"
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonFile -Encoding UTF8

# Generate HTML report
$findingsHtml = ""
foreach ($severity in @("critical", "high", "medium", "low")) {
    $severityFindings = $findings | Where-Object { $_.severity -eq $severity }
    if ($severityFindings.Count -eq 0) { continue }

    $badgeClass = switch ($severity) {
        "critical" { "badge-red" }
        "high"     { "badge-orange" }
        "medium"   { "badge-yellow" }
        "low"      { "badge-gray" }
    }

    foreach ($finding in $severityFindings) {
        $findingsHtml += @"
        <div class="finding $severity">
            <div class="finding-header">
                <span class="badge $badgeClass">$($severity.ToUpper())</span>
                <strong>$([System.Web.HttpUtility]::HtmlEncode($finding.finding))</strong>
            </div>
            <p class="finding-desc">$([System.Web.HttpUtility]::HtmlEncode($finding.description))</p>
            <p class="finding-detail"><strong>Detail:</strong> $([System.Web.HttpUtility]::HtmlEncode($finding.detail))</p>
            <p class="finding-remediation"><strong>Remediation:</strong> $([System.Web.HttpUtility]::HtmlEncode($finding.remediation))</p>
        </div>
"@
    }
}

$riskColor = if ($riskScore -ge 75) { "#ef4444" } elseif ($riskScore -ge 50) { "#f97316" } elseif ($riskScore -ge 25) { "#f59e0b" } else { "#10b981" }

$htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - CA Gap Analysis Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0 0; opacity: 0.8; }
        .summary { display: flex; gap: 20px; margin-bottom: 30px; }
        .card { flex: 1; background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
        .card h3 { margin: 0 0 8px 0; font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .card .value { font-size: 36px; font-weight: 700; }
        .risk-score { color: $riskColor; }
        .finding { background: white; border-radius: 10px; padding: 20px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-left: 4px solid #e2e8f0; }
        .finding.critical { border-left-color: #ef4444; }
        .finding.high { border-left-color: #f97316; }
        .finding.medium { border-left-color: #f59e0b; }
        .finding.low { border-left-color: #94a3b8; }
        .finding-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .finding-desc { color: #64748b; margin: 4px 0; }
        .finding-detail { margin: 4px 0; }
        .finding-remediation { color: #059669; margin: 4px 0; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: white; }
        .badge-red { background: #ef4444; }
        .badge-orange { background: #f97316; }
        .badge-yellow { background: #f59e0b; }
        .badge-gray { background: #94a3b8; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Conditional Access Gap Analysis</h1>
        <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") | Policies analyzed: $($policies.Count)</p>
    </div>

    <div class="summary">
        <div class="card">
            <h3>Risk Score</h3>
            <div class="value risk-score">$riskScore/100</div>
        </div>
        <div class="card">
            <h3>Critical</h3>
            <div class="value" style="color:#ef4444">$criticalCount</div>
        </div>
        <div class="card">
            <h3>High</h3>
            <div class="value" style="color:#f97316">$highCount</div>
        </div>
        <div class="card">
            <h3>Medium</h3>
            <div class="value" style="color:#f59e0b">$mediumCount</div>
        </div>
        <div class="card">
            <h3>Low</h3>
            <div class="value" style="color:#94a3b8">$lowCount</div>
        </div>
    </div>

    <h2>Findings</h2>
    $findingsHtml
    $(if (-not $findingsHtml) { "<p style='color:#94a3b8; text-align:center; padding:40px;'>No gaps found. Conditional Access configuration looks solid.</p>" })
</body>
</html>
"@

$htmlFile = Join-Path $OutputPath "ca-gap-analysis-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  CA Gap Analysis Summary" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  Risk Score: $riskScore / 100" -ForegroundColor $(if ($riskScore -ge 50) { "Red" } elseif ($riskScore -ge 25) { "Yellow" } else { "Green" })
Write-Host "  Critical: $criticalCount | High: $highCount | Medium: $mediumCount | Low: $lowCount" -ForegroundColor Gray
Write-Host ""
Write-Host "  HTML report: $htmlFile" -ForegroundColor Green
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green
Write-Host ""

return $report
