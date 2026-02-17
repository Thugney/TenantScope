# ============================================================================
# TenantScope - CIS Microsoft 365 Foundations Benchmark Audit
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Audits a Microsoft 365 tenant against the CIS Microsoft 365 Foundations Benchmark v3.1.0.

.DESCRIPTION
    Performs a comprehensive compliance audit of your Microsoft 365 tenant configuration
    against the CIS (Center for Internet Security) Microsoft 365 Foundations Benchmark
    version 3.1.0. Evaluates ~20 controls across the following sections:

    1. Account / Authentication
       - Admin MFA enforcement (1.1.1)
       - Global Administrator count 2-4 (1.1.3)
       - Legacy authentication blocking (1.2.1)
       - All-users MFA coverage (1.2.2)
       - Risk-based sign-in blocking (1.3.1)
       - User risk blocking (1.3.2)

    2. Application Permissions
       - User consent restricted (2.1)
       - App registration restricted (2.3)

    3. Data Management
       - DLP policies (3.1)
       - Sensitivity labels (3.2)

    5. Auditing
       - Audit log enabled (5.1)

    6. Storage
       - SharePoint external sharing (6.1)

    7. Mobile Device
       - MDM enrollment (7.1)
       - Device compliance required (7.2)
       - Device encryption (7.3)

    8. Microsoft Defender
       - Alerts reviewed (8.1)
       - ASR rules enforced (8.2)

    CA Completeness
       - Covers all apps (1.4.1)
       - No stale report-only (1.4.2)

    Uses previously collected JSON data from the TenantScope data pipeline.
    Generates JSON results, writes to dashboard/data/ for dashboard consumption,
    and produces an HTML report with a dark-themed dashboard including score ring SVG,
    section bars, and expandable remediation guidance.

    Required data files (from Invoke-DataCollection.ps1):
    - admin-roles.json
    - mfa-status.json
    - conditional-access.json
    - oauth-consent-grants.json
    - sensitivity-labels-data.json
    - audit-logs.json
    - sharepoint-sites.json
    - devices.json
    - bitlocker-status.json
    - defender-alerts.json
    - asr-rules.json
    - compliance-policies.json

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/cis-benchmark/.

.PARAMETER BenchmarkVersion
    CIS Benchmark version to audit against. Default: 3.1.0.

.PARAMETER IncludeLevel2
    Include Level 2 controls in the audit. By default, only Level 1 controls
    are evaluated. Level 2 controls are intended for environments requiring
    higher security but may reduce usability.

.EXAMPLE
    .\tools\Invoke-CISBenchmarkAudit.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-CISBenchmarkAudit.ps1 -Config $config -IncludeLevel2

.EXAMPLE
    .\tools\Invoke-CISBenchmarkAudit.ps1 -OutputPath "C:\Reports\CIS" -BenchmarkVersion "3.1.0"

.NOTES
    Version: 1.0.0
    Read-only audit - does not modify any tenant configuration.
    All remediation guidance is informational only.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [string]$BenchmarkVersion = "3.1.0",

    [Parameter()]
    [switch]$IncludeLevel2
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\cis-benchmark"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# Dashboard data path for web dashboard consumption
$DashboardDataPath = Join-Path $PSScriptRoot "..\dashboard\data"
if (-not (Test-Path $DashboardDataPath)) {
    New-Item -ItemType Directory -Path $DashboardDataPath -Force | Out-Null
}

# ============================================================================
# CIS BENCHMARK CONTROL DEFINITIONS
# ============================================================================

$CISControls = @(
    # --- Section 1: Account / Authentication ---
    @{
        id          = "1.1.1"
        section     = "Account/Authentication"
        title       = "Ensure administrative accounts use MFA"
        level       = 1
        severity    = "critical"
        check       = "admin-mfa"
        dataSource  = @("admin-roles", "mfa-status")
        remediation = @'
# Review admin MFA status via Microsoft Entra admin center > Protection > MFA
# Or use Graph API to verify MFA registration:
# Get-MgReportAuthenticationMethodUserRegistrationDetail `
#   -Filter "isAdmin eq true and isMfaRegistered eq false"
# Ensure all accounts with admin roles have MFA registered and enforced.
'@
    },
    @{
        id          = "1.1.3"
        section     = "Account/Authentication"
        title       = "Ensure that between two and four Global Administrators are designated"
        level       = 1
        severity    = "critical"
        check       = "global-admin-count"
        dataSource  = @("admin-roles")
        remediation = @'
# Review Global Administrators in Entra admin center:
#   Roles and administrators > Global Administrator
# Best practice: maintain exactly 2-4 Global Admins (including break-glass).
# Remove unnecessary GA assignments; use least-privilege roles instead.
# Get-MgDirectoryRoleMember -DirectoryRoleId <GA-RoleId>
'@
    },
    @{
        id          = "1.2.1"
        section     = "Account/Authentication"
        title       = "Ensure legacy authentication is blocked via Conditional Access"
        level       = 1
        severity    = "critical"
        check       = "legacy-auth-block"
        dataSource  = @("conditional-access")
        remediation = @'
# Create a Conditional Access policy to block legacy authentication:
# Target: All users
# Conditions > Client apps: Exchange ActiveSync clients, Other clients
# Grant: Block access | State: Enabled
# Verify: Review sign-in logs filtered by client app = "Other clients"
'@
    },
    @{
        id          = "1.2.2"
        section     = "Account/Authentication"
        title       = "Ensure MFA is required for all users via Conditional Access"
        level       = 1
        severity    = "critical"
        check       = "all-users-mfa"
        dataSource  = @("conditional-access", "mfa-status")
        remediation = @'
# Create or verify a CA policy requiring MFA for all users:
# Target: All users (with minimal exclusions for break-glass accounts)
# Cloud apps: All cloud apps | Grant: Require MFA
# Verify MFA registration: Entra > Protection > Authentication methods > Activity
'@
    },
    @{
        id          = "1.3.1"
        section     = "Account/Authentication"
        title       = "Ensure sign-in risk policy blocks high-risk sign-ins"
        level       = 1
        severity    = "high"
        check       = "risk-based-block"
        dataSource  = @("conditional-access")
        remediation = @'
# Configure Identity Protection sign-in risk policy:
# Entra admin center > Protection > Identity Protection > Sign-in risk policy
# Or create a CA policy: Conditions > Sign-in risk = High | Grant: Block access
# Requires Azure AD P2 or Microsoft 365 E5 license.
'@
    },
    @{
        id          = "1.3.2"
        section     = "Account/Authentication"
        title       = "Ensure user risk policy blocks high-risk users"
        level       = 1
        severity    = "high"
        check       = "user-risk-block"
        dataSource  = @("conditional-access")
        remediation = @'
# Configure Identity Protection user risk policy:
# Entra admin center > Protection > Identity Protection > User risk policy
# Or create a CA policy: Conditions > User risk = High | Grant: Block access
# Consider requiring password change for medium-risk users.
'@
    },

    # --- Section 2: Application Permissions ---
    @{
        id          = "2.1"
        section     = "Application Permissions"
        title       = "Ensure user consent to apps is restricted or disabled"
        level       = 1
        severity    = "high"
        check       = "user-consent-restricted"
        dataSource  = @("oauth-consent-grants")
        remediation = @'
# Restrict user consent in Entra admin center:
#   Enterprise applications > Consent and permissions
#   Set "Users can consent to apps" to "No" or
#   "Allow user consent for apps from verified publishers"
# Review existing user-consented grants:
# Get-MgOauth2PermissionGrant -Filter "consentType eq 'Principal'"
'@
    },
    @{
        id          = "2.3"
        section     = "Application Permissions"
        title       = "Ensure app registration by users is restricted"
        level       = 1
        severity    = "medium"
        check       = "app-registration-restricted"
        dataSource  = @("oauth-consent-grants")
        remediation = @'
# Restrict app registrations in Entra admin center:
#   Users > User settings > "Users can register applications" = No
# This ensures only admins can register new applications.
# Verify: (Get-MgPolicyAuthorizationPolicy).DefaultUserRolePermissions
'@
    },

    # --- Section 3: Data Management ---
    @{
        id          = "3.1"
        section     = "Data Management"
        title       = "Ensure DLP policies are enabled for sensitive data"
        level       = 1
        severity    = "high"
        check       = "dlp-policies-enabled"
        dataSource  = @("sensitivity-labels-data")
        remediation = @'
# Configure DLP policies in Microsoft Purview compliance portal:
#   Data loss prevention > Policies
# Create policies targeting sensitive info types (SSN, credit cards, etc.)
# Apply to Exchange, SharePoint, OneDrive, and Teams.
'@
    },
    @{
        id          = "3.2"
        section     = "Data Management"
        title       = "Ensure sensitivity labels are published and in use"
        level       = 2
        severity    = "medium"
        check       = "sensitivity-labels-published"
        dataSource  = @("sensitivity-labels-data")
        remediation = @'
# Configure sensitivity labels in Microsoft Purview:
#   Information protection > Labels
# Create labels (Public, Internal, Confidential, Highly Confidential)
# Publish labels via label policies to all users.
# Enable auto-labeling for sensitive content detection.
'@
    },

    # --- Section 5: Auditing ---
    @{
        id          = "5.1"
        section     = "Auditing"
        title       = "Ensure unified audit log is enabled and capturing events"
        level       = 1
        severity    = "high"
        check       = "audit-log-enabled"
        dataSource  = @("audit-logs")
        remediation = @'
# Verify audit logging is enabled:
#   Microsoft Purview compliance portal > Audit > Audit search
# PowerShell: Get-AdminAuditLogConfig | Select UnifiedAuditLogIngestionEnabled
# If disabled: Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $true
'@
    },

    # --- Section 6: Storage ---
    @{
        id          = "6.1"
        section     = "Storage"
        title       = "Ensure SharePoint external sharing is managed and restricted"
        level       = 1
        severity    = "high"
        check       = "sharepoint-external-sharing"
        dataSource  = @("sharepoint-sites")
        remediation = @'
# Review SharePoint sharing settings:
#   SharePoint admin center > Policies > Sharing
# Set org-level sharing to "Only people in your organization" or
# "New and existing guests" (avoid "Anyone" links).
# Per-site: Get-SPOSite | Select Url, SharingCapability
'@
    },

    # --- Section 7: Mobile Device ---
    @{
        id          = "7.1"
        section     = "Mobile Device"
        title       = "Ensure MDM enrollment is required for device access"
        level       = 1
        severity    = "high"
        check       = "mdm-enrollment-required"
        dataSource  = @("devices")
        remediation = @'
# Ensure devices are enrolled in Intune MDM:
#   Intune admin center > Devices > Enrollment restrictions
# Set default enrollment to "Allow" for corporate-owned devices.
# Create a CA policy requiring enrolled/compliant devices.
'@
    },
    @{
        id          = "7.2"
        section     = "Mobile Device"
        title       = "Ensure device compliance is required via Conditional Access"
        level       = 1
        severity    = "high"
        check       = "device-compliance-required"
        dataSource  = @("conditional-access", "compliance-policies")
        remediation = @'
# Create a CA policy requiring device compliance:
# Target: All users | Cloud apps: All (or Office 365)
# Grant: Require device to be marked as compliant
# Ensure Intune compliance policies are configured and assigned:
#   Intune admin center > Devices > Compliance policies
'@
    },
    @{
        id          = "7.3"
        section     = "Mobile Device"
        title       = "Ensure device encryption is required (BitLocker/FileVault)"
        level       = 2
        severity    = "medium"
        check       = "device-encryption-required"
        dataSource  = @("bitlocker-status")
        remediation = @'
# Ensure encryption is enforced via Intune compliance policy:
#   Intune > Devices > Compliance policies > Windows 10/11
#   Enable "Require BitLocker" setting.
# Monitor: Intune > Devices > Monitor > Encryption report
# For macOS: Require FileVault in compliance policy.
'@
    },

    # --- Section 8: Microsoft Defender ---
    @{
        id          = "8.1"
        section     = "Microsoft Defender"
        title       = "Ensure Defender alerts are reviewed and resolved in a timely manner"
        level       = 1
        severity    = "high"
        check       = "defender-alerts-reviewed"
        dataSource  = @("defender-alerts")
        remediation = @'
# Review and triage Defender alerts regularly:
#   Microsoft 365 Defender portal > Incidents & alerts > Alerts
# Ensure high/critical severity alerts are triaged within 24 hours.
# Configure alert notification policies for SOC/security team.
'@
    },
    @{
        id          = "8.2"
        section     = "Microsoft Defender"
        title       = "Ensure Attack Surface Reduction rules are enforced (5+ rules in Block mode)"
        level       = 1
        severity    = "high"
        check       = "asr-rules-enforced"
        dataSource  = @("asr-rules")
        remediation = @'
# Configure ASR rules in Intune:
#   Endpoint security > Attack surface reduction
# Enable at least 5 rules in Block mode. Recommended:
#   - Block executable content from email/webmail
#   - Block Office apps from creating child processes
#   - Block credential stealing from LSASS
#   - Block process creations from PSExec/WMI
#   - Use advanced protection against ransomware
'@
    },

    # --- Section 1.4: CA Completeness ---
    @{
        id          = "1.4.1"
        section     = "CA Completeness"
        title       = "Ensure at least one CA policy covers all cloud applications"
        level       = 1
        severity    = "high"
        check       = "ca-covers-all-apps"
        dataSource  = @("conditional-access")
        remediation = @'
# Ensure at least one enabled CA policy targets All cloud apps:
#   Entra > Protection > Conditional Access > Policies
# Create or update a policy:
#   Cloud apps or actions > Include > All cloud apps
# This ensures newly registered apps are automatically protected.
'@
    },
    @{
        id          = "1.4.2"
        section     = "CA Completeness"
        title       = "Ensure no Conditional Access policies are left in report-only mode indefinitely"
        level       = 2
        severity    = "medium"
        check       = "ca-no-stale-report-only"
        dataSource  = @("conditional-access")
        remediation = @'
# Review report-only policies and either enforce or remove them:
#   Entra > Protection > Conditional Access > Policies
#   Filter by state = "Report-only"
# Report-only policies log but do not enforce controls.
# Evaluate sign-in logs, then switch to "On" or delete.
'@
    }
)

# ============================================================================
# DATA LOADING HELPERS
# ============================================================================

function Import-DataFile {
    <#
    .SYNOPSIS
        Loads a JSON data file from the data directory.
    .DESCRIPTION
        Tries the dashboard/data/ directory first, then data/, then data/sample/.
        Returns $null if the file is not found in any location.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$FileName
    )

    $baseName = if ($FileName -match '\.json$') { $FileName } else { "$FileName.json" }

    # Priority order: dashboard/data > data > data/sample
    $searchPaths = @(
        (Join-Path $PSScriptRoot "..\dashboard\data\$baseName"),
        (Join-Path $PSScriptRoot "..\data\$baseName"),
        (Join-Path $PSScriptRoot "..\data\sample\$baseName")
    )

    foreach ($path in $searchPaths) {
        $resolvedPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path)
        if (Test-Path $resolvedPath) {
            try {
                $content = Get-Content -Path $resolvedPath -Raw -Encoding UTF8
                $data = $content | ConvertFrom-Json
                Write-Verbose "  Loaded data file: $resolvedPath"
                return $data
            }
            catch {
                Write-Warning "  Failed to parse ${resolvedPath}: $($_.Exception.Message)"
            }
        }
    }

    Write-Verbose "  Data file not found: $baseName"
    return $null
}

function Load-AllDataSources {
    <#
    .SYNOPSIS
        Loads all required data source files into a hashtable keyed by source name.
    #>
    $sources = @{}

    $fileMap = @{
        "admin-roles"             = "admin-roles.json"
        "mfa-status"              = "mfa-status.json"
        "conditional-access"      = "conditional-access.json"
        "oauth-consent-grants"    = "oauth-consent-grants.json"
        "sensitivity-labels-data" = "sensitivity-labels-data.json"
        "audit-logs"              = "audit-logs.json"
        "sharepoint-sites"        = "sharepoint-sites.json"
        "devices"                 = "devices.json"
        "bitlocker-status"        = "bitlocker-status.json"
        "defender-alerts"         = "defender-alerts.json"
        "asr-rules"              = "asr-rules.json"
        "compliance-policies"     = "compliance-policies.json"
    }

    foreach ($entry in $fileMap.GetEnumerator()) {
        $data = Import-DataFile -FileName $entry.Value
        $sources[$entry.Key] = $data
    }

    return $sources
}

# ============================================================================
# CONTROL EVALUATION ENGINE
# ============================================================================

function Invoke-ControlCheck {
    <#
    .SYNOPSIS
        Evaluates a single CIS benchmark control against collected data.
    .DESCRIPTION
        Takes a control definition hashtable and the loaded data sources,
        runs the appropriate evaluation logic, and returns a result object
        with: id, section, title, level, severity, status, details, remediation.
    .OUTPUTS
        Hashtable with evaluation results. Status values:
        pass, fail, warning, manual, no-data
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Control,

        [Parameter(Mandatory)]
        [hashtable]$DataSources
    )

    $result = @{
        id          = $Control.id
        section     = $Control.section
        title       = $Control.title
        level       = $Control.level
        severity    = $Control.severity
        status      = "manual"
        details     = ""
        remediation = $Control.remediation
    }

    # Check if required data sources are available
    $missingData = @()
    foreach ($src in $Control.dataSource) {
        if ($null -eq $DataSources[$src]) {
            $missingData += $src
        }
    }

    if ($missingData.Count -gt 0) {
        $result.status = "no-data"
        $result.details = "Missing data source(s): $($missingData -join ', '). Run Invoke-DataCollection.ps1 first."
        return $result
    }

    try {
        switch ($Control.check) {

            "admin-mfa" {
                # Cross-reference admin role members against MFA status
                $adminRoles = $DataSources["admin-roles"]
                $mfaStatus = $DataSources["mfa-status"]

                # Build a lookup of MFA registration by user ID
                $mfaLookup = @{}
                foreach ($user in $mfaStatus) {
                    if ($user.userId) {
                        $mfaLookup[$user.userId] = [bool]$user.isMfaRegistered
                    }
                }

                $adminsWithoutMfa = @()
                $checkedAdminIds = @{}

                foreach ($role in $adminRoles) {
                    if (-not $role.isHighPrivilege) { continue }
                    foreach ($member in $role.members) {
                        if ($member.memberType -ne "User") { continue }
                        if ($checkedAdminIds.ContainsKey($member.id)) { continue }
                        $checkedAdminIds[$member.id] = $true

                        # Check MFA via the member's own mfaRegistered field first
                        $hasMfa = $false
                        if ($null -ne $member.mfaRegistered) {
                            $hasMfa = [bool]$member.mfaRegistered
                        }
                        elseif ($mfaLookup.ContainsKey($member.id)) {
                            $hasMfa = $mfaLookup[$member.id]
                        }

                        if (-not $hasMfa) {
                            $adminsWithoutMfa += "$($member.displayName) ($($role.roleName))"
                        }
                    }
                }

                $totalAdminUsers = $checkedAdminIds.Count

                if ($adminsWithoutMfa.Count -eq 0 -and $totalAdminUsers -gt 0) {
                    $result.status = "pass"
                    $result.details = "All $totalAdminUsers privileged admin role members have MFA registered."
                }
                elseif ($adminsWithoutMfa.Count -gt 0) {
                    $result.status = "fail"
                    $result.details = "$($adminsWithoutMfa.Count) admin(s) without MFA: $($adminsWithoutMfa -join '; ')"
                }
                else {
                    $result.status = "warning"
                    $result.details = "No admin user members found in high-privilege roles."
                }
            }

            "global-admin-count" {
                $adminRoles = $DataSources["admin-roles"]
                $globalAdminRole = $adminRoles | Where-Object {
                    $_.roleName -eq "Global Administrator" -or
                    $_.roleTemplateId -eq "62e90394-69f5-4237-9190-012177145e10"
                }

                if (-not $globalAdminRole) {
                    $result.status = "no-data"
                    $result.details = "Global Administrator role not found in admin-roles data."
                    break
                }

                # Count only user members (not service principals or groups)
                $gaUsers = @($globalAdminRole.members | Where-Object { $_.memberType -eq "User" })
                $gaCount = $gaUsers.Count

                if ($gaCount -ge 2 -and $gaCount -le 4) {
                    $names = ($gaUsers | ForEach-Object { $_.displayName }) -join ', '
                    $result.status = "pass"
                    $result.details = "Global Administrator count is $gaCount (within recommended range of 2-4). Users: $names"
                }
                elseif ($gaCount -lt 2) {
                    $result.status = "fail"
                    $result.details = "Only $gaCount Global Administrator(s) found. CIS recommends at least 2 for redundancy."
                }
                else {
                    $names = ($gaUsers | ForEach-Object { $_.displayName }) -join ', '
                    $result.status = "fail"
                    $result.details = "$gaCount Global Administrators found (CIS recommends max 4). Users: $names"
                }
            }

            "legacy-auth-block" {
                $caPolicies = $DataSources["conditional-access"]

                # Check for policy that blocks legacy auth via the blocksLegacyAuth flag
                $blockingPolicy = @($caPolicies | Where-Object {
                    $_.state -eq "enabled" -and
                    $_.blocksLegacyAuth -eq $true -and
                    $_.blockAccess -eq $true
                })

                if ($blockingPolicy.Count -gt 0) {
                    $policyNames = ($blockingPolicy | ForEach-Object { $_.displayName }) -join ', '
                    $result.status = "pass"
                    $result.details = "Legacy authentication is blocked by CA policy: $policyNames"
                }
                else {
                    # Check report-only
                    $reportOnlyBlock = @($caPolicies | Where-Object {
                        $_.state -eq "enabledForReportingButNotEnforced" -and
                        $_.blocksLegacyAuth -eq $true
                    })

                    if ($reportOnlyBlock.Count -gt 0) {
                        $result.status = "warning"
                        $result.details = "Legacy auth block policy exists in report-only mode: $(($reportOnlyBlock | ForEach-Object { $_.displayName }) -join ', '). Must be enforced."
                    }
                    else {
                        $result.status = "fail"
                        $result.details = "No Conditional Access policy found that blocks legacy authentication (Exchange ActiveSync / Other clients)."
                    }
                }
            }

            "all-users-mfa" {
                $caPolicies = $DataSources["conditional-access"]
                $mfaStatus = $DataSources["mfa-status"]

                # Check for a CA policy targeting all users with MFA grant
                $mfaPolicy = @($caPolicies | Where-Object {
                    $_.state -eq "enabled" -and
                    $_.includesAllUsers -eq $true -and
                    $_.requiresMfa -eq $true
                })

                # Calculate MFA registration percentage
                $totalUsers = @($mfaStatus).Count
                $registeredUsers = @($mfaStatus | Where-Object { $_.isMfaRegistered -eq $true }).Count
                $registrationPct = if ($totalUsers -gt 0) { [math]::Round(($registeredUsers / $totalUsers) * 100, 1) } else { 0 }

                if ($mfaPolicy.Count -gt 0 -and $registrationPct -ge 95) {
                    $result.status = "pass"
                    $result.details = "CA policy requires MFA for all users ('$($mfaPolicy[0].displayName)'). MFA registration: $registeredUsers/$totalUsers ($registrationPct%)."
                }
                elseif ($mfaPolicy.Count -gt 0 -and $registrationPct -lt 95) {
                    $result.status = "warning"
                    $gap = $totalUsers - $registeredUsers
                    $result.details = "CA policy requires MFA for all users, but only $registrationPct% registered ($registeredUsers/$totalUsers). Gap of $gap user(s) without MFA."
                }
                elseif ($mfaPolicy.Count -eq 0) {
                    $result.status = "fail"
                    $result.details = "No enabled CA policy found that requires MFA for All users. MFA registration: $registrationPct% ($registeredUsers/$totalUsers)."
                }
            }

            "risk-based-block" {
                $caPolicies = $DataSources["conditional-access"]

                # Look for a CA policy that blocks based on risk condition
                $riskPolicy = @($caPolicies | Where-Object {
                    $_.state -eq "enabled" -and
                    $_.hasRiskCondition -eq $true -and
                    $_.blockAccess -eq $true
                })

                if ($riskPolicy.Count -gt 0) {
                    $result.status = "pass"
                    $result.details = "High-risk sign-ins are blocked by CA policy: $(($riskPolicy | ForEach-Object { $_.displayName }) -join ', ')"
                }
                else {
                    # Check for risk-based MFA as a partial control
                    $riskMfa = @($caPolicies | Where-Object {
                        $_.state -eq "enabled" -and
                        $_.hasRiskCondition -eq $true -and
                        $_.requiresMfa -eq $true
                    })

                    if ($riskMfa.Count -gt 0) {
                        $result.status = "warning"
                        $result.details = "Risk-based CA policy requires MFA instead of blocking: $(($riskMfa | ForEach-Object { $_.displayName }) -join ', '). CIS recommends blocking high-risk sign-ins."
                    }
                    else {
                        $result.status = "fail"
                        $result.details = "No CA policy found that blocks or challenges high-risk sign-ins. Configure Identity Protection or a risk-based CA policy."
                    }
                }
            }

            "user-risk-block" {
                $caPolicies = $DataSources["conditional-access"]

                # Look for a CA policy that blocks high user risk
                $userRiskPolicy = @($caPolicies | Where-Object {
                    $_.state -eq "enabled" -and
                    $_.hasRiskCondition -eq $true -and
                    $_.blockAccess -eq $true -and
                    $_.displayName -match "(?i)user|risk"
                })

                if ($userRiskPolicy.Count -eq 0) {
                    # Broader check: any risk-blocking policy
                    $userRiskPolicy = @($caPolicies | Where-Object {
                        $_.state -eq "enabled" -and
                        $_.hasRiskCondition -eq $true -and
                        $_.blockAccess -eq $true
                    })
                }

                if ($userRiskPolicy.Count -gt 0) {
                    $result.status = "pass"
                    $result.details = "High-risk users are blocked by CA policy: $(($userRiskPolicy | ForEach-Object { $_.displayName }) -join ', ')"
                }
                else {
                    $result.status = "fail"
                    $result.details = "No CA policy found that blocks high-risk users. Configure an Identity Protection user risk policy or CA policy with user risk condition."
                }
            }

            "user-consent-restricted" {
                $oauthData = $DataSources["oauth-consent-grants"]

                # Check for user-consented grants with high-risk scopes
                $grants = if ($oauthData.grants) { $oauthData.grants } else { @($oauthData) }

                $userConsentedHighRisk = @($grants | Where-Object {
                    $_.consentType -eq "Principal" -and
                    $_.isAdminConsent -eq $false -and
                    $_.highRiskScopes -and @($_.highRiskScopes).Count -gt 0
                })

                if ($userConsentedHighRisk.Count -eq 0) {
                    # Also check for any user-consented grants at all
                    $anyUserConsented = @($grants | Where-Object {
                        $_.consentType -eq "Principal" -and
                        $_.isAdminConsent -eq $false
                    })

                    if ($anyUserConsented.Count -eq 0) {
                        $result.status = "pass"
                        $result.details = "No user-consented applications found. User consent appears to be restricted."
                    }
                    else {
                        $result.status = "warning"
                        $result.details = "$($anyUserConsented.Count) user-consented app(s) found, but none with high-risk scopes. Review consent settings."
                    }
                }
                else {
                    $result.status = "fail"
                    $appNames = ($userConsentedHighRisk | ForEach-Object { "$($_.appDisplayName) (by $($_.principalDisplayName))" }) -join '; '
                    $result.details = "$($userConsentedHighRisk.Count) user-consented app(s) with high-risk scopes: $appNames. User consent should be restricted."
                }
            }

            "app-registration-restricted" {
                $oauthData = $DataSources["oauth-consent-grants"]

                $grants = if ($oauthData.grants) { $oauthData.grants } else { @($oauthData) }
                $unverifiedUserGrants = @($grants | Where-Object {
                    $_.isAdminConsent -eq $false -and
                    $_.isVerifiedPublisher -eq $false
                })

                if ($unverifiedUserGrants.Count -eq 0) {
                    $result.status = "pass"
                    $result.details = "No user-consented apps from unverified publishers detected. App registration appears restricted."
                }
                else {
                    $result.status = "warning"
                    $appNames = ($unverifiedUserGrants | ForEach-Object { $_.appDisplayName }) -join ', '
                    $result.details = "$($unverifiedUserGrants.Count) user-consented app(s) from unverified publishers: $appNames. Verify that 'Users can register applications' is set to 'No'."
                }
            }

            "dlp-policies-enabled" {
                $labelsData = $DataSources["sensitivity-labels-data"]

                $labels = if ($labelsData.labels) { $labelsData.labels } else { @() }

                if (@($labels).Count -gt 0) {
                    $encryptedLabels = @($labels | Where-Object { $_.hasEncryption -eq $true })
                    $autoLabels = @($labels | Where-Object { $_.isAutoLabelingEnabled -eq $true })

                    if ($encryptedLabels.Count -gt 0 -or $autoLabels.Count -gt 0) {
                        $result.status = "pass"
                    }
                    else {
                        $result.status = "warning"
                    }
                    $result.details = "$(@($labels).Count) sensitivity label(s) configured. Encryption-enabled: $($encryptedLabels.Count). Auto-labeling: $($autoLabels.Count). Verify DLP policies in Purview."
                }
                else {
                    $result.status = "fail"
                    $result.details = "No sensitivity labels found. DLP policies and sensitivity labels should be configured to protect sensitive data."
                }
            }

            "sensitivity-labels-published" {
                $labelsData = $DataSources["sensitivity-labels-data"]

                $labels = if ($labelsData.labels) { $labelsData.labels } else { @() }

                if (@($labels).Count -ge 3) {
                    $labelNames = ($labels | ForEach-Object { $_.displayName }) -join ', '
                    $result.status = "pass"
                    $result.details = "$(@($labels).Count) sensitivity labels published: $labelNames"
                }
                elseif (@($labels).Count -gt 0) {
                    $result.status = "warning"
                    $result.details = "Only $(@($labels).Count) sensitivity label(s) found. CIS recommends a complete taxonomy (Public, Internal, Confidential, Highly Confidential)."
                }
                else {
                    $result.status = "fail"
                    $result.details = "No sensitivity labels are published. Create and publish a label taxonomy in Microsoft Purview."
                }
            }

            "audit-log-enabled" {
                $auditLogs = $DataSources["audit-logs"]

                if ($auditLogs -and @($auditLogs).Count -gt 0) {
                    $logCount = @($auditLogs).Count
                    $latestLog = ($auditLogs | Sort-Object -Property activityDateTime -Descending | Select-Object -First 1)
                    $latestDate = if ($latestLog.activityDateTime) { $latestLog.activityDateTime } else { "unknown" }
                    $result.status = "pass"
                    $result.details = "Unified audit log is active. $logCount recent log entries found. Latest activity: $latestDate"
                }
                else {
                    $result.status = "fail"
                    $result.details = "No audit log entries found. Verify that unified audit log ingestion is enabled in Microsoft Purview."
                }
            }

            "sharepoint-external-sharing" {
                $sites = $DataSources["sharepoint-sites"]
                $siteList = if ($sites -is [array]) { $sites } else { @($sites) }

                # Check for sites with unrestricted external sharing (Anyone links)
                $unrestrictedSites = @($siteList | Where-Object {
                    $_.externalSharing -eq "Anyone" -or
                    $_.externalSharing -eq "ExternalUserAndGuestSharing" -or
                    ($_.anonymousLinkCount -and [int]$_.anonymousLinkCount -gt 0)
                })

                $externalSharingSites = @($siteList | Where-Object {
                    $_.hasExternalSharing -eq $true -or
                    ($_.externalSharing -and $_.externalSharing -ne "Disabled")
                })

                if ($unrestrictedSites.Count -eq 0 -and $externalSharingSites.Count -eq 0) {
                    $result.status = "pass"
                    $result.details = "No SharePoint sites with unrestricted external sharing. All $($siteList.Count) site(s) have sharing disabled or restricted."
                }
                elseif ($unrestrictedSites.Count -gt 0) {
                    $result.status = "fail"
                    $siteNames = ($unrestrictedSites | ForEach-Object { $_.displayName }) -join ', '
                    $result.details = "$($unrestrictedSites.Count) site(s) allow unrestricted external sharing (Anyone links): $siteNames"
                }
                else {
                    $result.status = "warning"
                    $result.details = "$($externalSharingSites.Count) of $($siteList.Count) site(s) have some level of external sharing enabled. Review and restrict as needed."
                }
            }

            "mdm-enrollment-required" {
                $devicesData = $DataSources["devices"]

                $deviceList = if ($devicesData.devices) { $devicesData.devices } else { @($devicesData) }

                if (@($deviceList).Count -eq 0) {
                    $result.status = "no-data"
                    $result.details = "No device data available."
                    break
                }

                # Check managementAgent to determine MDM enrollment
                $mdmManaged = @($deviceList | Where-Object {
                    $_.managementAgent -eq "mdm" -or
                    $_.managementAgent -eq "easMdm" -or
                    $_.managementAgent -eq "intuneClient" -or
                    $_.managementAgent -eq "configurationManagerClientMdm"
                })

                $totalDevices = @($deviceList).Count
                $managedPct = if ($totalDevices -gt 0) { [math]::Round(($mdmManaged.Count / $totalDevices) * 100, 1) } else { 0 }

                if ($managedPct -ge 95) {
                    $result.status = "pass"
                    $result.details = "$($mdmManaged.Count)/$totalDevices devices ($managedPct%) are MDM-enrolled."
                }
                elseif ($managedPct -ge 80) {
                    $unmanagedCount = $totalDevices - $mdmManaged.Count
                    $result.status = "warning"
                    $result.details = "$($mdmManaged.Count)/$totalDevices devices ($managedPct%) are MDM-enrolled. $unmanagedCount device(s) not managed."
                }
                else {
                    $result.status = "fail"
                    $result.details = "Only $($mdmManaged.Count)/$totalDevices devices ($managedPct%) are MDM-enrolled. Ensure all devices are enrolled in Intune."
                }
            }

            "device-compliance-required" {
                $caPolicies = $DataSources["conditional-access"]
                $complianceData = $DataSources["compliance-policies"]

                # Check for CA policy requiring compliant device
                $complianceCAPolicy = @($caPolicies | Where-Object {
                    $_.state -eq "enabled" -and
                    $_.requiresCompliantDevice -eq $true
                })

                # Check compliance policy rates
                $policies = if ($complianceData.policies) { $complianceData.policies } else { @($complianceData) }
                $totalCompliance = 0
                $totalDevices = 0
                foreach ($pol in $policies) {
                    if ($pol.compliantDevices -and $pol.totalDevices) {
                        $totalCompliance += [int]$pol.compliantDevices
                        $totalDevices += [int]$pol.totalDevices
                    }
                }
                $compliancePct = if ($totalDevices -gt 0) { [math]::Round(($totalCompliance / $totalDevices) * 100, 1) } else { 0 }

                if ($complianceCAPolicy.Count -gt 0 -and $compliancePct -ge 90) {
                    $result.status = "pass"
                    $result.details = "CA policy requires compliant device ('$($complianceCAPolicy[0].displayName)'). Device compliance: $compliancePct% ($totalCompliance/$totalDevices)."
                }
                elseif ($complianceCAPolicy.Count -gt 0) {
                    $result.status = "warning"
                    $result.details = "CA policy requires compliant device, but compliance rate is only $compliancePct% ($totalCompliance/$totalDevices). Investigate noncompliant devices."
                }
                else {
                    $result.status = "fail"
                    $result.details = "No enabled CA policy requires device compliance. Create a CA policy with 'Require device to be marked as compliant' grant control."
                }
            }

            "device-encryption-required" {
                $bitlockerData = $DataSources["bitlocker-status"]

                $deviceList = if ($bitlockerData.devices) { $bitlockerData.devices } else { @($bitlockerData) }

                if (@($deviceList).Count -eq 0) {
                    $result.status = "no-data"
                    $result.details = "No BitLocker/encryption status data available."
                    break
                }

                $encryptedDevices = @($deviceList | Where-Object { $_.isEncrypted -eq $true })
                $totalDevices = @($deviceList).Count
                $encryptionPct = if ($totalDevices -gt 0) { [math]::Round(($encryptedDevices.Count / $totalDevices) * 100, 1) } else { 0 }

                if ($encryptionPct -ge 95) {
                    $result.status = "pass"
                    $result.details = "$($encryptedDevices.Count)/$totalDevices devices ($encryptionPct%) have disk encryption enabled."
                }
                elseif ($encryptionPct -ge 80) {
                    $unencrypted = $totalDevices - $encryptedDevices.Count
                    $result.status = "warning"
                    $result.details = "$($encryptedDevices.Count)/$totalDevices devices ($encryptionPct%) encrypted. $unencrypted device(s) not encrypted."
                }
                else {
                    $result.status = "fail"
                    $result.details = "Only $($encryptedDevices.Count)/$totalDevices devices ($encryptionPct%) encrypted. Enforce BitLocker/FileVault via compliance policy."
                }
            }

            "defender-alerts-reviewed" {
                $alerts = $DataSources["defender-alerts"]

                if (-not $alerts -or @($alerts).Count -eq 0) {
                    $result.status = "pass"
                    $result.details = "No Defender alerts found. Alert queue is clear."
                    break
                }

                $alertList = @($alerts)
                $unresolvedHighCritical = @($alertList | Where-Object {
                    ($_.severity -eq "high" -or $_.severity -eq "critical") -and
                    ($_.status -eq "new" -or $_.status -eq "inProgress") -and
                    $null -eq $_.resolvedDateTime
                })

                if ($unresolvedHighCritical.Count -eq 0) {
                    $result.status = "pass"
                    $result.details = "All high/critical Defender alerts have been resolved. Total alerts: $($alertList.Count)."
                }
                else {
                    $result.status = "fail"
                    $alertSummary = ($unresolvedHighCritical | ForEach-Object { "$($_.severity.ToUpper()): $($_.title)" }) -join '; '
                    $result.details = "$($unresolvedHighCritical.Count) unresolved high/critical alert(s): $alertSummary"
                }
            }

            "asr-rules-enforced" {
                $asrData = $DataSources["asr-rules"]

                # Count rules in block mode from various data structures
                $rulesInBlock = 0

                if ($asrData.rulesArray) {
                    $rulesInBlock = @($asrData.rulesArray | Where-Object {
                        $_.blockCount -and [int]$_.blockCount -gt 0
                    }).Count
                }
                elseif ($asrData.rulesSummary) {
                    foreach ($key in $asrData.rulesSummary.PSObject.Properties) {
                        if ($key.Value.blockCount -and [int]$key.Value.blockCount -gt 0) {
                            $rulesInBlock++
                        }
                    }
                }
                elseif ($asrData.policies) {
                    $blockRuleIds = @()
                    foreach ($policy in $asrData.policies) {
                        if ($policy.asrRules) {
                            $blockRuleIds += @($policy.asrRules | Where-Object { $_.mode -eq "Block" } | ForEach-Object { $_.ruleId })
                        }
                    }
                    $rulesInBlock = ($blockRuleIds | Sort-Object -Unique).Count
                }

                if ($rulesInBlock -ge 5) {
                    $result.status = "pass"
                    $result.details = "$rulesInBlock ASR rule(s) deployed in Block mode (meets CIS minimum of 5)."
                }
                elseif ($rulesInBlock -gt 0) {
                    $result.status = "warning"
                    $result.details = "Only $rulesInBlock ASR rule(s) in Block mode. CIS recommends at least 5 rules enforced."
                }
                else {
                    $result.status = "fail"
                    $result.details = "No ASR rules deployed in Block mode. Configure at least 5 ASR rules via Intune endpoint security."
                }
            }

            "ca-covers-all-apps" {
                $caPolicies = $DataSources["conditional-access"]

                $allAppsPolicy = @($caPolicies | Where-Object {
                    $_.state -eq "enabled" -and
                    $_.includesAllApps -eq $true
                })

                if ($allAppsPolicy.Count -gt 0) {
                    $policyNames = ($allAppsPolicy | ForEach-Object { $_.displayName }) -join ', '
                    $result.status = "pass"
                    $result.details = "$($allAppsPolicy.Count) CA policy/policies target all cloud applications: $policyNames"
                }
                else {
                    $result.status = "fail"
                    $result.details = "No enabled CA policy targets 'All cloud apps'. New applications will not be protected by Conditional Access."
                }
            }

            "ca-no-stale-report-only" {
                $caPolicies = $DataSources["conditional-access"]

                $reportOnlyPolicies = @($caPolicies | Where-Object {
                    $_.state -eq "enabledForReportingButNotEnforced"
                })

                if ($reportOnlyPolicies.Count -eq 0) {
                    $result.status = "pass"
                    $result.details = "No CA policies are in report-only mode. All policies are either enabled or disabled."
                }
                else {
                    $policyNames = ($reportOnlyPolicies | ForEach-Object { $_.displayName }) -join ', '
                    $result.status = "warning"
                    $result.details = "$($reportOnlyPolicies.Count) CA policy/policies in report-only mode: $policyNames. Review and enforce or remove."
                }
            }

            default {
                $result.status = "manual"
                $result.details = "This control requires manual verification. Automated check not available for '$($Control.check)'."
            }
        }
    }
    catch {
        $result.status = "warning"
        $result.details = "Error evaluating control: $($_.Exception.Message)"
    }

    return $result
}

# ============================================================================
# HTML REPORT GENERATION
# ============================================================================

function New-CISHtmlReport {
    <#
    .SYNOPSIS
        Generates a dark-themed HTML report for CIS benchmark audit results.
    #>
    param(
        [Parameter(Mandatory)] [hashtable]$Summary,
        [Parameter(Mandatory)] [array]$SectionScores,
        [Parameter(Mandatory)] [array]$ControlResults,
        [Parameter(Mandatory)] [string]$BenchmarkVer,
        [Parameter(Mandatory)] [bool]$Level2Included,
        [Parameter(Mandatory)] [string]$OutputFile
    )

    $complianceScore = $Summary.complianceScore
    $totalControls = $Summary.total
    $passCount = $Summary.pass
    $failCount = $Summary.fail
    $warningCount = $Summary.warning
    $manualCount = $Summary.manual
    $noDataCount = $Summary.noData

    # Score ring color
    $scoreColor = if ($complianceScore -ge 80) { "#10b981" }
                  elseif ($complianceScore -ge 60) { "#f59e0b" }
                  elseif ($complianceScore -ge 40) { "#f97316" }
                  else { "#ef4444" }

    # SVG ring parameters (circumference = 2 * pi * r, r=54)
    $circumference = 339.292
    $dashOffset = [math]::Round($circumference - ($circumference * $complianceScore / 100), 2)

    # Build section score bars HTML
    $sectionBarsHtml = ""
    foreach ($section in $SectionScores) {
        $sectionColor = if ($section.score -ge 80) { "#10b981" }
                        elseif ($section.score -ge 60) { "#f59e0b" }
                        elseif ($section.score -ge 40) { "#f97316" }
                        else { "#ef4444" }

        $escapedSection = $section.section -replace '<', '&lt;' -replace '>', '&gt;'
        $sectionBarsHtml += @"
            <div class="section-bar">
                <div class="section-bar-header">
                    <span class="section-name">$escapedSection</span>
                    <span class="section-score" style="color:$sectionColor">$($section.score)%</span>
                </div>
                <div class="bar-track">
                    <div class="bar-fill" style="width:$($section.score)%;background:$sectionColor"></div>
                </div>
                <div class="section-detail">$($section.pass)/$($section.total) controls passed</div>
            </div>
"@
    }

    # Build controls table HTML grouped by status
    $controlsHtml = ""
    $statusOrder = @("fail", "warning", "manual", "no-data", "pass")

    foreach ($status in $statusOrder) {
        $filteredControls = @($ControlResults | Where-Object { $_.status -eq $status })
        if ($filteredControls.Count -eq 0) { continue }

        $statusLabel = switch ($status) {
            "fail"    { "FAILED" }
            "warning" { "WARNING" }
            "manual"  { "MANUAL REVIEW" }
            "no-data" { "NO DATA" }
            "pass"    { "PASSED" }
        }

        $controlsHtml += "<h3 class='status-header status-$status'>$statusLabel ($($filteredControls.Count))</h3>`n"

        foreach ($ctrl in $filteredControls) {
            $severityBadge = switch ($ctrl.severity) {
                "critical" { "<span class='severity-badge severity-critical'>CRITICAL</span>" }
                "high"     { "<span class='severity-badge severity-high'>HIGH</span>" }
                "medium"   { "<span class='severity-badge severity-medium'>MEDIUM</span>" }
                default    { "<span class='severity-badge severity-low'>LOW</span>" }
            }

            $statusIcon = switch ($ctrl.status) {
                "pass"    { "&#10003;" }
                "fail"    { "&#10007;" }
                "warning" { "&#9888;" }
                "manual"  { "&#9998;" }
                "no-data" { "&#8212;" }
            }

            $escapedTitle = $ctrl.title -replace '<', '&lt;' -replace '>', '&gt;'
            $escapedDetails = $ctrl.details -replace '<', '&lt;' -replace '>', '&gt;'
            $escapedId = $ctrl.id -replace '<', '&lt;' -replace '>', '&gt;'

            $remediationSection = ""
            if ($ctrl.status -ne "pass" -and $ctrl.remediation) {
                $escapedRemediation = $ctrl.remediation -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;'
                $remediationSection = @"
                <details class="remediation-details">
                    <summary>View Remediation Guidance</summary>
                    <pre class="remediation-code">$escapedRemediation</pre>
                </details>
"@
            }

            $controlsHtml += @"
            <div class="control-card control-$($ctrl.status)">
                <div class="control-header">
                    <span class="control-status-icon status-icon-$($ctrl.status)">$statusIcon</span>
                    <span class="control-id">$escapedId</span>
                    $severityBadge
                    <span class="control-title">$escapedTitle</span>
                    <span class="control-level">L$($ctrl.level)</span>
                </div>
                <div class="control-details">$escapedDetails</div>
                $remediationSection
            </div>
"@
        }
    }

    $auditDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $levelText = if ($Level2Included) { "Level 1 + Level 2" } else { "Level 1 only" }

    $htmlContent = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TenantScope - CIS M365 Benchmark Audit Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #0d1117;
            color: #c9d1d9;
            line-height: 1.6;
            padding: 24px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .report-header {
            background: linear-gradient(135deg, #161b22, #1c2333);
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .report-header h1 { font-size: 24px; color: #f0f6fc; margin-bottom: 4px; }
        .report-header .subtitle { color: #8b949e; font-size: 14px; }
        .report-header .meta { color: #8b949e; font-size: 13px; text-align: right; }
        .report-header .meta span { display: block; margin-bottom: 2px; }
        .score-section {
            display: flex;
            gap: 24px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }
        .score-ring-container {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 32px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 220px;
        }
        .score-ring-container h3 { color: #8b949e; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
        .score-ring { position: relative; width: 140px; height: 140px; }
        .score-ring svg { transform: rotate(-90deg); }
        .score-ring .ring-bg { fill: none; stroke: #21262d; stroke-width: 8; }
        .score-ring .ring-fill { fill: none; stroke: $scoreColor; stroke-width: 8; stroke-linecap: round; stroke-dasharray: $circumference; stroke-dashoffset: $dashOffset; transition: stroke-dashoffset 1s ease; }
        .score-ring .score-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 32px; font-weight: 700; color: $scoreColor; }
        .summary-cards {
            flex: 1;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 12px;
        }
        .summary-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 10px;
            padding: 16px;
            text-align: center;
        }
        .summary-card .card-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .summary-card .card-value { font-size: 28px; font-weight: 700; }
        .card-pass .card-value { color: #10b981; }
        .card-fail .card-value { color: #ef4444; }
        .card-warning .card-value { color: #f59e0b; }
        .card-manual .card-value { color: #8b949e; }
        .card-nodata .card-value { color: #6e7681; }
        .card-total .card-value { color: #58a6ff; }
        .section-scores {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }
        .section-scores h2 { font-size: 16px; color: #f0f6fc; margin-bottom: 16px; }
        .section-bar { margin-bottom: 16px; }
        .section-bar-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .section-name { font-size: 13px; color: #c9d1d9; }
        .section-score { font-size: 13px; font-weight: 700; }
        .bar-track { height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 4px; transition: width 0.8s ease; }
        .section-detail { font-size: 11px; color: #8b949e; margin-top: 2px; }
        .controls-section { margin-bottom: 24px; }
        .controls-section h2 { font-size: 16px; color: #f0f6fc; margin-bottom: 16px; }
        .status-header {
            font-size: 14px;
            padding: 8px 12px;
            border-radius: 6px;
            margin: 16px 0 8px 0;
            font-weight: 600;
        }
        .status-fail { background: rgba(239,68,68,0.1); color: #ef4444; }
        .status-warning { background: rgba(245,158,11,0.1); color: #f59e0b; }
        .status-manual { background: rgba(139,148,158,0.1); color: #8b949e; }
        .status-no-data { background: rgba(110,118,129,0.1); color: #6e7681; }
        .status-pass { background: rgba(16,185,129,0.1); color: #10b981; }
        .control-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 8px;
            border-left: 3px solid #30363d;
        }
        .control-fail { border-left-color: #ef4444; }
        .control-warning { border-left-color: #f59e0b; }
        .control-manual { border-left-color: #8b949e; }
        .control-no-data { border-left-color: #6e7681; }
        .control-pass { border-left-color: #10b981; }
        .control-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .control-status-icon { font-size: 16px; font-weight: 700; width: 20px; text-align: center; }
        .status-icon-pass { color: #10b981; }
        .status-icon-fail { color: #ef4444; }
        .status-icon-warning { color: #f59e0b; }
        .status-icon-manual { color: #8b949e; }
        .status-icon-no-data { color: #6e7681; }
        .control-id {
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 12px;
            background: #21262d;
            padding: 2px 8px;
            border-radius: 4px;
            color: #58a6ff;
        }
        .control-title { font-size: 13px; color: #f0f6fc; font-weight: 500; flex: 1; }
        .control-level {
            font-size: 11px;
            background: #21262d;
            padding: 2px 6px;
            border-radius: 4px;
            color: #8b949e;
        }
        .control-details { font-size: 12px; color: #8b949e; margin-top: 6px; line-height: 1.5; }
        .severity-badge {
            font-size: 10px;
            font-weight: 700;
            padding: 1px 6px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .severity-critical { background: rgba(239,68,68,0.2); color: #ef4444; }
        .severity-high { background: rgba(249,115,22,0.2); color: #f97316; }
        .severity-medium { background: rgba(245,158,11,0.2); color: #f59e0b; }
        .severity-low { background: rgba(148,163,184,0.2); color: #94a3b8; }
        .remediation-details {
            margin-top: 8px;
            border-top: 1px solid #21262d;
            padding-top: 8px;
        }
        .remediation-details summary {
            cursor: pointer;
            font-size: 12px;
            color: #58a6ff;
            font-weight: 500;
            user-select: none;
        }
        .remediation-details summary:hover { color: #79c0ff; }
        .remediation-code {
            margin-top: 8px;
            background: #0d1117;
            border: 1px solid #21262d;
            border-radius: 6px;
            padding: 12px;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 11px;
            color: #7ee787;
            white-space: pre-wrap;
            word-break: break-word;
            overflow-x: auto;
            line-height: 1.5;
        }
        .report-footer {
            text-align: center;
            color: #6e7681;
            font-size: 12px;
            padding: 24px 0;
            border-top: 1px solid #21262d;
            margin-top: 24px;
        }
        .report-footer a { color: #58a6ff; text-decoration: none; }
        .report-footer a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <div class="report-header">
            <div>
                <h1>CIS Microsoft 365 Foundations Benchmark Audit</h1>
                <div class="subtitle">Version $BenchmarkVer | $levelText</div>
            </div>
            <div class="meta">
                <span>Audit Date: $auditDate</span>
                <span>Generated by TenantScope</span>
            </div>
        </div>
        <div class="score-section">
            <div class="score-ring-container">
                <h3>Compliance Score</h3>
                <div class="score-ring">
                    <svg viewBox="0 0 120 120" width="140" height="140">
                        <circle class="ring-bg" cx="60" cy="60" r="54"/>
                        <circle class="ring-fill" cx="60" cy="60" r="54"/>
                    </svg>
                    <div class="score-text">$complianceScore%</div>
                </div>
            </div>
            <div class="summary-cards">
                <div class="summary-card card-total"><div class="card-label">Total Controls</div><div class="card-value">$totalControls</div></div>
                <div class="summary-card card-pass"><div class="card-label">Passed</div><div class="card-value">$passCount</div></div>
                <div class="summary-card card-fail"><div class="card-label">Failed</div><div class="card-value">$failCount</div></div>
                <div class="summary-card card-warning"><div class="card-label">Warning</div><div class="card-value">$warningCount</div></div>
                <div class="summary-card card-manual"><div class="card-label">Manual</div><div class="card-value">$manualCount</div></div>
                <div class="summary-card card-nodata"><div class="card-label">No Data</div><div class="card-value">$noDataCount</div></div>
            </div>
        </div>
        <div class="section-scores">
            <h2>Section Scores</h2>
            $sectionBarsHtml
        </div>
        <div class="controls-section">
            <h2>Control Results</h2>
            $controlsHtml
        </div>
        <div class="report-footer">
            TenantScope CIS Benchmark Audit | CIS Microsoft 365 Foundations Benchmark v$BenchmarkVer<br/>
            <a href="https://github.com/Thugney/-M365-TENANT-TOOLKIT">github.com/Thugney/-M365-TENANT-TOOLKIT</a>
        </div>
    </div>
</body>
</html>
"@

    $htmlContent | Set-Content -Path $OutputFile -Encoding UTF8
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - CIS M365 Benchmark Audit" -ForegroundColor Cyan
Write-Host "  Benchmark: CIS Microsoft 365 Foundations v$BenchmarkVersion" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$now = Get-Date

# -----------------------------------------------------------------------
# 1. Load all data sources
# -----------------------------------------------------------------------
Write-Host "  Loading data sources..." -ForegroundColor Gray

$DataSources = Load-AllDataSources

$loadedCount = @($DataSources.GetEnumerator() | Where-Object { $null -ne $_.Value }).Count
$totalSources = $DataSources.Count
Write-Host "    Loaded $loadedCount / $totalSources data sources" -ForegroundColor Gray

$missingSources = @($DataSources.GetEnumerator() | Where-Object { $null -eq $_.Value } | ForEach-Object { $_.Key })
if ($missingSources.Count -gt 0) {
    Write-Host "    Missing: $($missingSources -join ', ')" -ForegroundColor Yellow
}
Write-Host ""

# -----------------------------------------------------------------------
# 2. Filter controls by level
# -----------------------------------------------------------------------
$controlsToEvaluate = if ($IncludeLevel2) {
    $CISControls
}
else {
    @($CISControls | Where-Object { $_.level -eq 1 })
}

$levelText = if ($IncludeLevel2) { "Level 1 + Level 2" } else { "Level 1 only" }
Write-Host "  Evaluating $($controlsToEvaluate.Count) controls ($levelText)..." -ForegroundColor Gray
Write-Host ""

# -----------------------------------------------------------------------
# 3. Evaluate all controls
# -----------------------------------------------------------------------
$controlResults = @()

foreach ($control in $controlsToEvaluate) {
    $checkResult = Invoke-ControlCheck -Control $control -DataSources $DataSources
    $controlResults += [PSCustomObject]$checkResult

    # Print colored status per control
    $statusSymbol = switch ($checkResult.status) {
        "pass"    { "[PASS]" }
        "fail"    { "[FAIL]" }
        "warning" { "[WARN]" }
        "manual"  { "[MANUAL]" }
        "no-data" { "[NO DATA]" }
        default   { "[????]" }
    }

    $statusColor = switch ($checkResult.status) {
        "pass"    { "Green" }
        "fail"    { "Red" }
        "warning" { "Yellow" }
        "manual"  { "Gray" }
        "no-data" { "DarkGray" }
        default   { "White" }
    }

    $paddedStatus = $statusSymbol.PadRight(10)
    Write-Host "  $paddedStatus" -ForegroundColor $statusColor -NoNewline
    Write-Host " $($checkResult.id) " -ForegroundColor Cyan -NoNewline
    Write-Host "$($checkResult.title)" -ForegroundColor White
}

# -----------------------------------------------------------------------
# 4. Calculate scores
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Calculating scores..." -ForegroundColor Gray

$passCount = @($controlResults | Where-Object { $_.status -eq "pass" }).Count
$failCount = @($controlResults | Where-Object { $_.status -eq "fail" }).Count
$warningCount = @($controlResults | Where-Object { $_.status -eq "warning" }).Count
$manualCount = @($controlResults | Where-Object { $_.status -eq "manual" }).Count
$noDataCount = @($controlResults | Where-Object { $_.status -eq "no-data" }).Count
$totalControls = $controlResults.Count

# Compliance score: pass / (total - manual - no-data) * 100
$scorableControls = $totalControls - $manualCount - $noDataCount
$complianceScore = if ($scorableControls -gt 0) {
    [int][math]::Round(($passCount / $scorableControls) * 100, 0)
}
else { 0 }

# Section scores
$sections = $controlResults | Group-Object -Property section
$sectionScores = @()
foreach ($section in $sections) {
    $sectionPass = @($section.Group | Where-Object { $_.status -eq "pass" }).Count
    $sectionFail = @($section.Group | Where-Object { $_.status -eq "fail" }).Count
    $sectionWarn = @($section.Group | Where-Object { $_.status -eq "warning" }).Count
    $sectionManual = @($section.Group | Where-Object { $_.status -eq "manual" }).Count
    $sectionNoData = @($section.Group | Where-Object { $_.status -eq "no-data" }).Count
    $sectionTotal = $section.Group.Count
    $sectionScorable = $sectionTotal - $sectionManual - $sectionNoData
    $sectionScore = if ($sectionScorable -gt 0) { [int][math]::Round(($sectionPass / $sectionScorable) * 100, 0) } else { 0 }

    $sectionScores += @{
        section  = $section.Name
        total    = $sectionTotal
        pass     = $sectionPass
        fail     = $sectionFail
        warning  = $sectionWarn
        manual   = $sectionManual
        noData   = $sectionNoData
        score    = $sectionScore
    }
}

# Sort sections by score ascending (worst first)
$sectionScores = @($sectionScores | Sort-Object { $_.score })

# -----------------------------------------------------------------------
# 5. Print summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  CIS Benchmark Audit Summary" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$scoreColor = if ($complianceScore -ge 80) { "Green" } elseif ($complianceScore -ge 60) { "Yellow" } else { "Red" }
Write-Host "  Overall Compliance Score: $complianceScore%" -ForegroundColor $scoreColor
Write-Host ""
Write-Host "  Pass: $passCount | Fail: $failCount | Warning: $warningCount | Manual: $manualCount | No Data: $noDataCount" -ForegroundColor Gray
Write-Host ""

Write-Host "  Section Scores:" -ForegroundColor Gray
foreach ($section in $sectionScores) {
    $sColor = if ($section.score -ge 80) { "Green" } elseif ($section.score -ge 60) { "Yellow" } else { "Red" }
    $sectionNamePadded = "$($section.section)".PadRight(30)
    Write-Host "    $sectionNamePadded $($section.score)% ($($section.pass)/$($section.total) passed)" -ForegroundColor $sColor
}
Write-Host ""

# -----------------------------------------------------------------------
# 6. Write JSON results
# -----------------------------------------------------------------------
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$jsonReport = [PSCustomObject]@{
    benchmarkVersion = $BenchmarkVersion
    auditDate        = $now.ToString("o")
    includesLevel2   = [bool]$IncludeLevel2
    summary          = [PSCustomObject]@{
        total           = $totalControls
        pass            = $passCount
        fail            = $failCount
        warning         = $warningCount
        manual          = $manualCount
        noData          = $noDataCount
        complianceScore = $complianceScore
    }
    sectionScores    = @($sectionScores | ForEach-Object {
        [PSCustomObject]@{
            section = $_.section
            total   = $_.total
            pass    = $_.pass
            fail    = $_.fail
            warning = $_.warning
            manual  = $_.manual
            noData  = $_.noData
            score   = $_.score
        }
    })
    controls         = @($controlResults | ForEach-Object {
        [PSCustomObject]@{
            id          = $_.id
            section     = $_.section
            title       = $_.title
            level       = $_.level
            severity    = $_.severity
            status      = $_.status
            details     = $_.details
            remediation = $_.remediation
        }
    })
}

# Write to output path
$jsonFile = Join-Path $OutputPath "cis-benchmark-results.json"
$jsonReport | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonFile -Encoding UTF8
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green

# Also write timestamped copy
$jsonFileTimestamped = Join-Path $OutputPath "cis-benchmark-results-${timestamp}.json"
$jsonReport | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonFileTimestamped -Encoding UTF8

# Write to dashboard/data/ for dashboard consumption
$dashboardJsonFile = Join-Path $DashboardDataPath "cis-benchmark-results.json"
$jsonReport | ConvertTo-Json -Depth 10 | Set-Content -Path $dashboardJsonFile -Encoding UTF8
Write-Host "  Dashboard data: $dashboardJsonFile" -ForegroundColor Green

# -----------------------------------------------------------------------
# 7. Generate HTML report
# -----------------------------------------------------------------------
$htmlFile = Join-Path $OutputPath "cis-benchmark-report-${timestamp}.html"

$summaryHash = @{
    total           = $totalControls
    pass            = $passCount
    fail            = $failCount
    warning         = $warningCount
    manual          = $manualCount
    noData          = $noDataCount
    complianceScore = $complianceScore
}

New-CISHtmlReport `
    -Summary $summaryHash `
    -SectionScores $sectionScores `
    -ControlResults $controlResults `
    -BenchmarkVer $BenchmarkVersion `
    -Level2Included ([bool]$IncludeLevel2) `
    -OutputFile $htmlFile

Write-Host "  HTML report: $htmlFile" -ForegroundColor Green

# Also write latest HTML to a stable filename for dashboard linking
$htmlFileLatest = Join-Path $OutputPath "cis-benchmark-report-latest.html"
Copy-Item -Path $htmlFile -Destination $htmlFileLatest -Force

Write-Host ""
Write-Host "  Audit complete." -ForegroundColor Cyan
Write-Host ""

# Return the report object for pipeline consumption
return $jsonReport
