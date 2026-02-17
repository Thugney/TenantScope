# ============================================================================
# TenantScope - CIS Microsoft 365 Foundations Benchmark Audit
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Audits tenant configuration against CIS Microsoft 365 Foundations Benchmark.

.DESCRIPTION
    Evaluates the current Microsoft 365 tenant configuration against the CIS
    Microsoft 365 Foundations Benchmark v3.1.0 controls. Maps collected data
    to specific benchmark controls and produces a compliance scorecard.

    Categories covered:
    1. Account / Authentication (MFA, password policies, admin roles)
    2. Application Permissions (OAuth consent, enterprise apps)
    3. Data Management (sensitivity labels, retention, DLP)
    5. Auditing (unified audit log)
    6. Storage (SharePoint sharing)
    7. Mobile Device Management (Intune compliance, device encryption)
    8. Microsoft Defender (alerts, ASR rules)

    Outputs:
    - cis-benchmark-results.json   (machine-readable for dashboard)
    - cis-benchmark-report.html    (standalone report)

    Required Graph scopes (read-only):
    - Policy.Read.All
    - User.Read.All
    - Directory.Read.All
    - SecurityEvents.Read.All
    - DeviceManagementConfiguration.Read.All

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/cis-benchmark/.

.PARAMETER BenchmarkVersion
    CIS Benchmark version to audit against. Default: "3.1.0".

.PARAMETER IncludeLevel2
    Include Level 2 (defense-in-depth) controls in addition to Level 1.

.EXAMPLE
    .\tools\Invoke-CISBenchmarkAudit.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-CISBenchmarkAudit.ps1 -Config $config -IncludeLevel2

.NOTES
    Version: 1.0.0
    Read-only analysis - does not modify any tenant configuration.
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

# ============================================================================
# CIS BENCHMARK CONTROL DEFINITIONS
# ============================================================================

$CISControls = @(
    # --- 1. ACCOUNT / AUTHENTICATION ---
    @{
        id          = "1.1.1"
        section     = "Account / Authentication"
        title       = "Ensure MFA is enabled for all users in administrative roles"
        level       = 1
        severity    = "critical"
        check       = "admin-mfa"
        remediation = "Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess'; # Create CA policy requiring MFA for admin roles (Global Admin, SharePoint Admin, Exchange Admin, User Admin)"
    },
    @{
        id          = "1.1.3"
        section     = "Account / Authentication"
        title       = "Ensure that between two and four Global Admins are designated"
        level       = 1
        severity    = "high"
        check       = "global-admin-count"
        remediation = "Get-MgDirectoryRoleMember -DirectoryRoleId <GA-role-id> | Select Id,DisplayName,UserPrincipalName # Review and reduce to 2-4 Global Admins"
    },
    @{
        id          = "1.1.4"
        section     = "Account / Authentication"
        title       = "Ensure Self-Service Password Reset is enabled"
        level       = 1
        severity    = "medium"
        check       = "sspr-enabled"
        remediation = "# Azure AD > Password reset > Properties > Set SSPR to 'All'"
    },
    @{
        id          = "1.2.1"
        section     = "Account / Authentication"
        title       = "Ensure legacy authentication is blocked"
        level       = 1
        severity    = "critical"
        check       = "legacy-auth-block"
        remediation = "# Create CA policy: Conditions > ClientAppTypes = exchangeActiveSync,other > Grant = Block"
    },
    @{
        id          = "1.2.2"
        section     = "Account / Authentication"
        title       = "Ensure MFA is required for all users"
        level       = 1
        severity    = "critical"
        check       = "all-users-mfa"
        remediation = "# Create CA policy: Users = All > Apps = All > Grant = Require MFA"
    },
    @{
        id          = "1.3.1"
        section     = "Account / Authentication"
        title       = "Ensure sign-in risk policy blocks high-risk sign-ins"
        level       = 1
        severity    = "high"
        check       = "risk-based-block"
        remediation = "# Create CA policy: SignInRiskLevels = high > Grant = Block"
    },
    @{
        id          = "1.3.2"
        section     = "Account / Authentication"
        title       = "Ensure user risk policy blocks high-risk users"
        level       = 1
        severity    = "high"
        check       = "user-risk-block"
        remediation = "# Create CA policy: UserRiskLevels = high > Grant = Block"
    },
    @{
        id          = "1.4.1"
        section     = "Account / Authentication"
        title       = "Ensure Conditional Access policies cover all cloud apps"
        level       = 1
        severity    = "high"
        check       = "ca-covers-all-apps"
        remediation = "# Ensure at least one CA policy targets IncludeApplications = All"
    },
    @{
        id          = "1.4.2"
        section     = "Account / Authentication"
        title       = "Ensure no CA policies are stuck in report-only mode"
        level       = 1
        severity    = "medium"
        check       = "ca-no-stale-report-only"
        remediation = "# Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId <id> -State 'enabled'"
    },

    # --- 2. APPLICATION PERMISSIONS ---
    @{
        id          = "2.1"
        section     = "Application Permissions"
        title       = "Ensure third-party integrated applications are not allowed"
        level       = 1
        severity    = "high"
        check       = "user-consent-restricted"
        remediation = "# Azure AD > Enterprise apps > Consent and permissions > Do not allow user consent"
    },
    @{
        id          = "2.2"
        section     = "Application Permissions"
        title       = "Ensure calendar details sharing with external users is disabled"
        level       = 2
        severity    = "medium"
        check       = "calendar-sharing-external"
        remediation = "# Set-SharingPolicy -Identity 'Default Sharing Policy' -Domains @()"
    },
    @{
        id          = "2.3"
        section     = "Application Permissions"
        title       = "Ensure app registrations by users are restricted"
        level       = 1
        severity    = "medium"
        check       = "app-registration-restricted"
        remediation = "# Azure AD > User settings > App registrations > Users can register applications = No"
    },

    # --- 3. DATA MANAGEMENT ---
    @{
        id          = "3.1"
        section     = "Data Management"
        title       = "Ensure DLP policies are enabled"
        level       = 1
        severity    = "high"
        check       = "dlp-policies-enabled"
        remediation = "# Microsoft Purview > DLP > Create policies for sensitive data types"
    },
    @{
        id          = "3.2"
        section     = "Data Management"
        title       = "Ensure sensitivity labels are published and in use"
        level       = 1
        severity    = "medium"
        check       = "sensitivity-labels-active"
        remediation = "# Microsoft Purview > Information Protection > Labels > Create and publish label policies"
    },

    # --- 5. AUDITING ---
    @{
        id          = "5.1"
        section     = "Auditing"
        title       = "Ensure Microsoft 365 audit log search is enabled"
        level       = 1
        severity    = "critical"
        check       = "audit-log-enabled"
        remediation = "# Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled `$true"
    },

    # --- 6. STORAGE ---
    @{
        id          = "6.1"
        section     = "Storage"
        title       = "Ensure SharePoint external sharing is managed"
        level       = 1
        severity    = "high"
        check       = "sharepoint-external-sharing"
        remediation = "# Set-SPOTenant -SharingCapability ExternalUserSharingOnly"
    },

    # --- 7. MOBILE DEVICE MANAGEMENT ---
    @{
        id          = "7.1"
        section     = "Mobile Device Management"
        title       = "Ensure mobile device management policies are required"
        level       = 1
        severity    = "high"
        check       = "mdm-enrollment-required"
        remediation = "# Azure AD > Mobility > Microsoft Intune > MDM user scope = All"
    },
    @{
        id          = "7.2"
        section     = "Mobile Device Management"
        title       = "Ensure devices are required to be compliant"
        level       = 1
        severity    = "high"
        check       = "device-compliance-required"
        remediation = "# Create CA policy: Grant = Require compliant device"
    },
    @{
        id          = "7.3"
        section     = "Mobile Device Management"
        title       = "Ensure device encryption is required"
        level       = 1
        severity    = "high"
        check       = "device-encryption-required"
        remediation = "# Intune > Compliance policies > Windows > System Security > Require BitLocker"
    },

    # --- 8. MICROSOFT DEFENDER ---
    @{
        id          = "8.1"
        section     = "Microsoft Defender"
        title       = "Ensure Microsoft Defender alerts are reviewed and resolved"
        level       = 1
        severity    = "high"
        check       = "defender-alerts-reviewed"
        remediation = "# security.microsoft.com > Incidents & alerts > Triage high/critical alerts"
    },
    @{
        id          = "8.2"
        section     = "Microsoft Defender"
        title       = "Ensure ASR rules are configured in block mode"
        level       = 1
        severity    = "high"
        check       = "asr-rules-enforced"
        remediation = "# Intune > Endpoint security > Attack surface reduction > Enable 5+ rules in Block mode"
    }
)

# ============================================================================
# DATA LOADING
# ============================================================================

$dataDir = Join-Path $PSScriptRoot "..\data"
$dashboardDataDir = Join-Path $PSScriptRoot "..\dashboard\data"
$dataRoot = if (Test-Path $dashboardDataDir) { $dashboardDataDir } else { $dataDir }

function Import-DataFile {
    param([string]$FileName)
    $path = Join-Path $dataRoot $FileName
    if (Test-Path $path) {
        try { return Get-Content $path -Raw | ConvertFrom-Json } catch { return $null }
    }
    # Try alternate location
    $altPath = Join-Path (if ($dataRoot -eq $dashboardDataDir) { $dataDir } else { $dashboardDataDir }) $FileName
    if (Test-Path $altPath) {
        try { return Get-Content $altPath -Raw | ConvertFrom-Json } catch { return $null }
    }
    return $null
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " CIS Microsoft 365 Benchmark Audit" -ForegroundColor Cyan
Write-Host " Benchmark Version: $BenchmarkVersion" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Loading collected data from: $dataRoot" -ForegroundColor Gray

$dataSources = @{
    mfaStatus          = Import-DataFile "mfa-status.json"
    adminRoles         = Import-DataFile "admin-roles.json"
    conditionalAccess  = Import-DataFile "conditional-access.json"
    oauthConsentGrants = Import-DataFile "oauth-consent-grants.json"
    sensitivityLabels  = Import-DataFile "sensitivity-labels-data.json"
    auditLogs          = Import-DataFile "audit-logs.json"
    sharepointSites    = Import-DataFile "sharepoint-sites.json"
    devices            = Import-DataFile "devices.json"
    compliancePolicies = Import-DataFile "compliance-policies.json"
    bitlockerStatus    = Import-DataFile "bitlocker-status.json"
    defenderAlerts     = Import-DataFile "defender-alerts.json"
    asrRules           = Import-DataFile "asr-rules.json"
    users              = Import-DataFile "users.json"
}

# ============================================================================
# CONTROL EVALUATION ENGINE
# ============================================================================

function Invoke-ControlCheck {
    param(
        [hashtable]$Control,
        [hashtable]$Data
    )

    $result = @{
        id          = $Control.id
        section     = $Control.section
        title       = $Control.title
        level       = $Control.level
        severity    = $Control.severity
        status      = "unknown"
        details     = ""
        remediation = $Control.remediation
    }

    try {
        switch ($Control.check) {

            "admin-mfa" {
                $mfa = $Data.mfaStatus
                $roles = $Data.adminRoles
                if (-not $roles -or -not $mfa) { $result.status = "no-data"; $result.details = "Admin role or MFA data not collected"; break }

                $adminIds = @()
                foreach ($role in $roles) {
                    if ($role.members) { $adminIds += $role.members | ForEach-Object { $_.id } }
                }
                $adminIds = $adminIds | Select-Object -Unique
                if ($adminIds.Count -eq 0) { $result.status = "pass"; $result.details = "No admin role members found"; break }

                $noMfa = @()
                foreach ($aid in $adminIds) {
                    $m = $mfa | Where-Object { $_.id -eq $aid -or $_.userId -eq $aid }
                    if (-not $m -or $m.mfaRegistered -eq $false -or $m.isMfaRegistered -eq $false) { $noMfa += $aid }
                }
                if ($noMfa.Count -gt 0) {
                    $result.status = "fail"; $result.details = "$($noMfa.Count) of $($adminIds.Count) admins lack MFA"
                } else {
                    $result.status = "pass"; $result.details = "All $($adminIds.Count) admin accounts have MFA"
                }
            }

            "global-admin-count" {
                $roles = $Data.adminRoles
                if (-not $roles) { $result.status = "no-data"; $result.details = "Admin role data not collected"; break }
                $ga = $roles | Where-Object { $_.displayName -eq "Global Administrator" -or $_.roleTemplateId -eq "62e90394-69f5-4237-9190-012177145e10" }
                $count = 0
                if ($ga -and $ga.members) { $count = ($ga.members | Measure-Object).Count }
                if ($count -ge 2 -and $count -le 4) {
                    $result.status = "pass"; $result.details = "$count Global Admins (recommended: 2-4)"
                } elseif ($count -lt 2) {
                    $result.status = "fail"; $result.details = "Only $count Global Admin(s) - minimum 2 for redundancy"
                } else {
                    $result.status = "fail"; $result.details = "$count Global Admins - max 4 recommended"
                }
            }

            "sspr-enabled" {
                $result.status = "manual"; $result.details = "Verify Azure AD > Password reset > Properties: SSPR enabled for all users"
            }

            "legacy-auth-block" {
                $ca = $Data.conditionalAccess
                if (-not $ca) { $result.status = "no-data"; $result.details = "CA data not collected"; break }
                $enabled = $ca | Where-Object { $_.state -eq "enabled" }
                $legacyBlock = $enabled | Where-Object {
                    $legacy = @("exchangeActiveSync", "other")
                    $matchLegacy = $_.conditions.clientAppTypes | Where-Object { $legacy -contains $_ }
                    $blocks = $_.grantControls.builtInControls -contains "block"
                    $matchLegacy -and $blocks
                }
                if ($legacyBlock) {
                    $result.status = "pass"; $result.details = "Legacy auth blocked by: $($legacyBlock[0].displayName)"
                } else {
                    $result.status = "fail"; $result.details = "No enabled CA policy blocks legacy authentication"
                }
            }

            "all-users-mfa" {
                $ca = $Data.conditionalAccess
                $mfa = $Data.mfaStatus
                if (-not $ca -and -not $mfa) { $result.status = "no-data"; $result.details = "No CA or MFA data"; break }

                $policyExists = $false
                if ($ca) {
                    $enabled = $ca | Where-Object { $_.state -eq "enabled" }
                    $mfaAll = $enabled | Where-Object {
                        ($_.conditions.users.includeUsers -contains "All") -and ($_.grantControls.builtInControls -contains "mfa")
                    }
                    $policyExists = $null -ne $mfaAll
                }

                if ($mfa) {
                    $total = ($mfa | Measure-Object).Count
                    $registered = ($mfa | Where-Object { $_.mfaRegistered -eq $true -or $_.isMfaRegistered -eq $true -or ($_.strongAuthenticationMethods -and $_.strongAuthenticationMethods.Count -gt 0) } | Measure-Object).Count
                    $pct = if ($total -gt 0) { [math]::Round(($registered / $total) * 100, 1) } else { 0 }
                    if ($policyExists -and $pct -ge 95) {
                        $result.status = "pass"; $result.details = "MFA policy enforced. $pct% registered ($registered/$total)"
                    } elseif ($policyExists) {
                        $result.status = "fail"; $result.details = "MFA policy exists but only $pct% registered ($registered/$total)"
                    } else {
                        $result.status = "fail"; $result.details = "No all-users MFA policy. $pct% have MFA"
                    }
                } elseif ($policyExists) {
                    $result.status = "pass"; $result.details = "CA policy requires MFA for all users"
                } else {
                    $result.status = "fail"; $result.details = "No CA policy requires MFA for all users"
                }
            }

            "risk-based-block" {
                $ca = $Data.conditionalAccess
                if (-not $ca) { $result.status = "no-data"; $result.details = "CA data not collected"; break }
                $enabled = $ca | Where-Object { $_.state -eq "enabled" }
                $riskBlock = $enabled | Where-Object {
                    $_.conditions.signInRiskLevels -contains "high" -and $_.grantControls.builtInControls -contains "block"
                }
                if ($riskBlock) { $result.status = "pass"; $result.details = "High-risk sign-ins blocked by CA" }
                else { $result.status = "fail"; $result.details = "No CA policy blocks high-risk sign-ins" }
            }

            "user-risk-block" {
                $ca = $Data.conditionalAccess
                if (-not $ca) { $result.status = "no-data"; $result.details = "CA data not collected"; break }
                $enabled = $ca | Where-Object { $_.state -eq "enabled" }
                $userBlock = $enabled | Where-Object {
                    $_.conditions.userRiskLevels -contains "high" -and $_.grantControls.builtInControls -contains "block"
                }
                if ($userBlock) { $result.status = "pass"; $result.details = "High-risk users blocked by CA" }
                else { $result.status = "fail"; $result.details = "No CA policy blocks high-risk users" }
            }

            "ca-covers-all-apps" {
                $ca = $Data.conditionalAccess
                if (-not $ca) { $result.status = "no-data"; $result.details = "CA data not collected"; break }
                $enabled = $ca | Where-Object { $_.state -eq "enabled" }
                $allApps = $enabled | Where-Object { $_.conditions.applications.includeApplications -contains "All" }
                if ($allApps) { $result.status = "pass"; $result.details = "$(($allApps | Measure-Object).Count) CA policies target all cloud apps" }
                else { $result.status = "warning"; $result.details = "No CA policy targets 'All cloud apps'" }
            }

            "ca-no-stale-report-only" {
                $ca = $Data.conditionalAccess
                if (-not $ca) { $result.status = "no-data"; $result.details = "CA data not collected"; break }
                $reportOnly = @($ca | Where-Object { $_.state -eq "enabledForReportingButNotEnforced" })
                if ($reportOnly.Count -eq 0) { $result.status = "pass"; $result.details = "No CA policies in report-only mode" }
                else { $result.status = "warning"; $result.details = "$($reportOnly.Count) CA policies in report-only mode" }
            }

            "user-consent-restricted" {
                $oauth = $Data.oauthConsentGrants
                if (-not $oauth) { $result.status = "no-data"; $result.details = "OAuth consent data not collected"; break }
                $grantList = if ($oauth.grants) { $oauth.grants } else { $oauth }
                $userGrants = @($grantList | Where-Object { $_.consentType -eq "Principal" })
                if ($userGrants.Count -eq 0) {
                    $result.status = "pass"; $result.details = "No user-consented third-party app grants"
                } else {
                    $highRisk = @($userGrants | Where-Object { $_.scope -match "Mail\.|Files\.|Directory\." })
                    if ($highRisk.Count -gt 0) {
                        $result.status = "fail"; $result.details = "$($userGrants.Count) user grants, $($highRisk.Count) with high-risk permissions"
                    } else {
                        $result.status = "warning"; $result.details = "$($userGrants.Count) user-consented grants (review recommended)"
                    }
                }
            }

            "calendar-sharing-external" {
                $result.status = "manual"; $result.details = "Verify: Get-SharingPolicy | FL"
            }

            "app-registration-restricted" {
                $result.status = "manual"; $result.details = "Verify Azure AD > User settings > App registrations = No"
            }

            "dlp-policies-enabled" {
                $labels = $Data.sensitivityLabels
                if (-not $labels) { $result.status = "no-data"; $result.details = "Sensitivity/DLP data not collected"; break }
                $list = if ($labels.labels) { $labels.labels } else { $labels }
                if (($list | Measure-Object).Count -gt 0) {
                    $result.status = "pass"; $result.details = "$(($list | Measure-Object).Count) sensitivity labels configured"
                } else {
                    $result.status = "fail"; $result.details = "No sensitivity labels or DLP policies detected"
                }
            }

            "sensitivity-labels-active" {
                $labels = $Data.sensitivityLabels
                if (-not $labels) { $result.status = "no-data"; $result.details = "Sensitivity labels data not collected"; break }
                $list = if ($labels.labels) { $labels.labels } else { $labels }
                $active = @($list | Where-Object { $_.isActive -eq $true -or $_.contentFormats })
                if ($active.Count -gt 0) { $result.status = "pass"; $result.details = "$($active.Count) labels active/published" }
                else { $result.status = "warning"; $result.details = "Labels exist but none appear published" }
            }

            "audit-log-enabled" {
                $logs = $Data.auditLogs
                if ($logs -and ($logs | Measure-Object).Count -gt 0) {
                    $result.status = "pass"; $result.details = "Audit log data present ($(($logs | Measure-Object).Count) entries)"
                } else {
                    $result.status = "warning"; $result.details = "No audit log data - verify unified audit log is enabled"
                }
            }

            "sharepoint-external-sharing" {
                $sp = $Data.sharepointSites
                if (-not $sp) { $result.status = "no-data"; $result.details = "SharePoint data not collected"; break }
                $sites = if ($sp -is [array]) { $sp } else { @($sp) }
                $external = @($sites | Where-Object {
                    $_.sharingCapability -eq "ExternalUserAndGuestSharing" -or $_.externalSharing -eq "Anyone"
                })
                if ($external.Count -gt 0) {
                    $result.status = "warning"; $result.details = "$($external.Count) sites allow external/anonymous sharing"
                } else {
                    $result.status = "pass"; $result.details = "No sites with unrestricted external sharing"
                }
            }

            "mdm-enrollment-required" {
                $dev = $Data.devices
                if (-not $dev) { $result.status = "no-data"; $result.details = "Device data not collected"; break }
                $devList = if ($dev -is [array]) { $dev } else { @($dev) }
                $managed = @($devList | Where-Object { $_.managementAgent -ne "none" -and $null -ne $_.managementAgent })
                $total = ($devList | Measure-Object).Count
                $pct = if ($total -gt 0) { [math]::Round(($managed.Count / $total) * 100, 1) } else { 0 }
                if ($pct -ge 90) { $result.status = "pass"; $result.details = "$pct% MDM-managed ($($managed.Count)/$total)" }
                else { $result.status = "fail"; $result.details = "Only $pct% MDM enrollment ($($managed.Count)/$total)" }
            }

            "device-compliance-required" {
                $ca = $Data.conditionalAccess
                $dev = $Data.devices
                $caReq = $false
                if ($ca) {
                    $enabled = $ca | Where-Object { $_.state -eq "enabled" }
                    $compPolicy = $enabled | Where-Object { $_.grantControls.builtInControls -contains "compliantDevice" }
                    $caReq = $null -ne $compPolicy
                }
                if ($dev) {
                    $devList = if ($dev -is [array]) { $dev } else { @($dev) }
                    $compliant = @($devList | Where-Object { $_.complianceState -eq "compliant" -or $_.isCompliant -eq $true })
                    $total = ($devList | Measure-Object).Count
                    $pct = if ($total -gt 0) { [math]::Round(($compliant.Count / $total) * 100, 1) } else { 0 }
                    if ($caReq -and $pct -ge 80) { $result.status = "pass"; $result.details = "CA requires compliance. $pct% compliant ($($compliant.Count)/$total)" }
                    elseif ($caReq) { $result.status = "warning"; $result.details = "CA requires compliance but only $pct% compliant" }
                    else { $result.status = "fail"; $result.details = "No CA policy requires device compliance. $pct% compliant" }
                } elseif ($caReq) { $result.status = "pass"; $result.details = "CA requires device compliance" }
                else { $result.status = "fail"; $result.details = "No CA policy requires device compliance" }
            }

            "device-encryption-required" {
                $bl = $Data.bitlockerStatus
                if (-not $bl) { $result.status = "no-data"; $result.details = "BitLocker data not collected"; break }
                $blData = if ($bl.devices) { $bl.devices } else { $bl }
                $blList = if ($blData -is [array]) { $blData } else { @($blData) }
                $encrypted = @($blList | Where-Object { $_.encryptionState -eq "encrypted" -or $_.isEncrypted -eq $true })
                $total = ($blList | Measure-Object).Count
                $pct = if ($total -gt 0) { [math]::Round(($encrypted.Count / $total) * 100, 1) } else { 0 }
                if ($pct -ge 90) { $result.status = "pass"; $result.details = "$pct% encrypted ($($encrypted.Count)/$total)" }
                else { $result.status = "fail"; $result.details = "Only $pct% encrypted ($($encrypted.Count)/$total)" }
            }

            "defender-alerts-reviewed" {
                $alerts = $Data.defenderAlerts
                if (-not $alerts) { $result.status = "no-data"; $result.details = "Defender alerts not collected"; break }
                $alertList = if ($alerts -is [array]) { $alerts } else { @($alerts) }
                $activeHigh = @($alertList | Where-Object {
                    ($_.severity -eq "high" -or $_.severity -eq "critical") -and ($_.status -ne "resolved" -and $_.status -ne "dismissed")
                })
                if ($activeHigh.Count -eq 0) { $result.status = "pass"; $result.details = "No unresolved high/critical alerts" }
                else { $result.status = "fail"; $result.details = "$($activeHigh.Count) unresolved high/critical Defender alerts" }
            }

            "asr-rules-enforced" {
                $asr = $Data.asrRules
                if (-not $asr) { $result.status = "no-data"; $result.details = "ASR rules data not collected"; break }
                $asrList = if ($asr.rules) { $asr.rules } elseif ($asr -is [array]) { $asr } else { @($asr) }
                $blockMode = @($asrList | Where-Object { $_.state -eq "block" -or $_.actionType -eq "block" -or $_.enabledState -eq 1 })
                if ($blockMode.Count -ge 5) { $result.status = "pass"; $result.details = "$($blockMode.Count) ASR rules in block mode" }
                elseif ($blockMode.Count -gt 0) { $result.status = "warning"; $result.details = "Only $($blockMode.Count) ASR rules in block mode (5+ recommended)" }
                else { $result.status = "fail"; $result.details = "No ASR rules in block mode" }
            }

            default {
                $result.status = "manual"; $result.details = "Manual verification required"
            }
        }
    } catch {
        $result.status = "error"; $result.details = "Error: $($_.Exception.Message)"
    }

    return $result
}

# ============================================================================
# EVALUATE CONTROLS
# ============================================================================

$controlsToEvaluate = if ($IncludeLevel2) { $CISControls } else { $CISControls | Where-Object { $_.level -eq 1 } }
Write-Host "Evaluating $($controlsToEvaluate.Count) controls (Level 1$(if ($IncludeLevel2) { ' + Level 2' }))...`n" -ForegroundColor White

$results = @()
foreach ($ctrl in $controlsToEvaluate) {
    Write-Host "  [$($ctrl.id)] $($ctrl.title)... " -NoNewline
    $r = Invoke-ControlCheck -Control $ctrl -Data $dataSources
    $results += $r

    $color = switch ($r.status) { "pass" { "Green" } "fail" { "Red" } "warning" { "Yellow" } "manual" { "Cyan" } "no-data" { "DarkGray" } default { "White" } }
    $icon = switch ($r.status) { "pass" { "[PASS]" } "fail" { "[FAIL]" } "warning" { "[WARN]" } "manual" { "[MANUAL]" } "no-data" { "[NO DATA]" } default { "[?]" } }
    Write-Host $icon -ForegroundColor $color
}

# ============================================================================
# CALCULATE SCORES
# ============================================================================

$passCount = ($results | Where-Object { $_.status -eq "pass" }).Count
$failCount = ($results | Where-Object { $_.status -eq "fail" }).Count
$warnCount = ($results | Where-Object { $_.status -eq "warning" }).Count
$manualCount = ($results | Where-Object { $_.status -eq "manual" }).Count
$noDataCount = ($results | Where-Object { $_.status -eq "no-data" }).Count
$errorCount = ($results | Where-Object { $_.status -eq "error" }).Count
$evaluated = $results.Count - $manualCount - $noDataCount - $errorCount
$complianceScore = if ($evaluated -gt 0) { [math]::Round(($passCount / $evaluated) * 100, 1) } else { 0 }

$sectionScores = @{}
$results | Group-Object -Property section | ForEach-Object {
    $grp = $_.Group
    $sEval = ($grp | Where-Object { $_.status -in @("pass", "fail", "warning") }).Count
    $sPass = ($grp | Where-Object { $_.status -eq "pass" }).Count
    $sScore = if ($sEval -gt 0) { [math]::Round(($sPass / $sEval) * 100, 1) } else { 0 }
    $sectionScores[$_.Name] = @{
        total    = $grp.Count
        passed   = $sPass
        failed   = ($grp | Where-Object { $_.status -eq "fail" }).Count
        warnings = ($grp | Where-Object { $_.status -eq "warning" }).Count
        score    = $sScore
    }
}

# ============================================================================
# CONSOLE SUMMARY
# ============================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " BENCHMARK RESULTS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$scoreColor = if ($complianceScore -ge 80) { "Green" } elseif ($complianceScore -ge 60) { "Yellow" } else { "Red" }
Write-Host "  Overall Compliance: $complianceScore%" -ForegroundColor $scoreColor
Write-Host "  Passed: $passCount | Failed: $failCount | Warnings: $warnCount | Manual: $manualCount | No Data: $noDataCount" -ForegroundColor White
Write-Host ""
foreach ($sec in ($sectionScores.Keys | Sort-Object)) {
    $s = $sectionScores[$sec]
    $c = if ($s.score -ge 80) { "Green" } elseif ($s.score -ge 60) { "Yellow" } else { "Red" }
    Write-Host "  $sec : $($s.score)% ($($s.passed)/$($s.total))" -ForegroundColor $c
}

# ============================================================================
# JSON OUTPUT
# ============================================================================

$outputJson = @{
    benchmarkVersion = $BenchmarkVersion
    auditDate        = (Get-Date).ToUniversalTime().ToString("o")
    includesLevel2   = $IncludeLevel2.IsPresent
    summary          = @{
        totalControls   = $results.Count
        passed          = $passCount
        failed          = $failCount
        warnings        = $warnCount
        manual          = $manualCount
        noData          = $noDataCount
        errors          = $errorCount
        complianceScore = $complianceScore
    }
    sectionScores = $sectionScores
    controls      = $results | ForEach-Object {
        @{
            id          = $_.id
            section     = $_.section
            title       = $_.title
            level       = $_.level
            severity    = $_.severity
            status      = $_.status
            details     = $_.details
            remediation = $_.remediation
        }
    }
}

$jsonPath = Join-Path $OutputPath "cis-benchmark-results.json"
$outputJson | ConvertTo-Json -Depth 10 | Set-Content $jsonPath -Encoding UTF8

# Write to dashboard data directory
if (Test-Path (Split-Path $dashboardDataDir)) {
    if (-not (Test-Path $dashboardDataDir)) { New-Item -ItemType Directory -Path $dashboardDataDir -Force | Out-Null }
    $dashJsonPath = Join-Path $dashboardDataDir "cis-benchmark-results.json"
    $outputJson | ConvertTo-Json -Depth 10 | Set-Content $dashJsonPath -Encoding UTF8
    Write-Host "`nDashboard data: $dashJsonPath" -ForegroundColor Green
}

# ============================================================================
# HTML REPORT
# ============================================================================

$failedHtml = ""
foreach ($f in ($results | Where-Object { $_.status -eq "fail" } | Sort-Object severity)) {
    $sevCol = switch ($f.severity) { "critical" { "#dc3545" } "high" { "#fd7e14" } "medium" { "#ffc107" } default { "#6c757d" } }
    $escRem = $f.remediation -replace '<', '&lt;' -replace '>', '&gt;' -replace '&', '&amp;'
    $failedHtml += @"
<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #f85149;border-radius:8px;padding:1rem;margin-bottom:1rem">
<div style="display:flex;justify-content:space-between;margin-bottom:.5rem"><span style="color:#58a6ff;font-weight:600;font-family:monospace">$($f.id)</span><span style="background:$sevCol;color:#fff;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600">$($f.severity.ToUpper())</span></div>
<h3 style="font-size:.95rem;margin-bottom:.5rem;color:#e6edf3">$($f.title)</h3>
<p style="color:#8b949e;font-size:.85rem">$($f.details)</p>
<details><summary style="cursor:pointer;color:#58a6ff;font-size:.85rem;margin-top:.5rem">Remediation guidance</summary>
<pre style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:1rem;margin-top:.5rem;font-size:.8rem;overflow-x:auto;white-space:pre-wrap;color:#c9d1d9">$escRem</pre></details>
</div>
"@
}

$sectionsHtml = ""
foreach ($sec in ($sectionScores.Keys | Sort-Object)) {
    $s = $sectionScores[$sec]
    $barCol = if ($s.score -ge 80) { "#28a745" } elseif ($s.score -ge 60) { "#ffc107" } else { "#dc3545" }
    $sectionsHtml += "<div style='display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid #21262d'>"
    $sectionsHtml += "<span style='width:220px;font-size:.9rem'>$sec</span>"
    $sectionsHtml += "<div style='flex:1;height:8px;background:#21262d;border-radius:4px;overflow:hidden'><div style='height:100%;width:$($s.score)%;background:$barCol;border-radius:4px'></div></div>"
    $sectionsHtml += "<span style='width:50px;text-align:right;font-weight:600'>$($s.score)%</span>"
    $sectionsHtml += "<span style='width:60px;text-align:right;color:#8b949e;font-size:.8rem'>$($s.passed)/$($s.total)</span></div>"
}

$ringColor = if ($complianceScore -ge 80) { "#3fb950" } elseif ($complianceScore -ge 60) { "#d29922" } else { "#f85149" }
$dashLen = [math]::Round(440 * $complianceScore / 100, 1)

$htmlReport = @"
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>CIS M365 Benchmark - TenantScope</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem}
.header{text-align:center;margin-bottom:2rem}.header h1{color:#58a6ff;font-size:1.8rem}.header p{color:#8b949e;margin-top:.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;margin:1.5rem 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;text-align:center}
.card .v{font-size:1.8rem;font-weight:700}.card .l{font-size:.75rem;color:#8b949e;text-transform:uppercase}
.footer{text-align:center;color:#484f58;margin-top:3rem;font-size:.8rem}</style></head>
<body>
<div class="header"><h1>CIS Microsoft 365 Foundations Benchmark v$BenchmarkVersion</h1><p>$(Get-Date -Format 'yyyy-MM-dd HH:mm') UTC | TenantScope</p></div>
<div style="text-align:center"><div style="width:160px;height:160px;margin:1.5rem auto;position:relative">
<svg width="160" height="160" viewBox="0 0 160 160" style="transform:rotate(-90deg)"><circle cx="80" cy="80" r="70" fill="none" stroke="#21262d" stroke-width="12"/><circle cx="80" cy="80" r="70" fill="none" stroke="$ringColor" stroke-width="12" stroke-dasharray="$dashLen 440" stroke-linecap="round"/></svg>
<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:2.5rem;font-weight:700;color:$ringColor">$complianceScore%</div></div></div>
<div class="grid"><div class="card"><div class="v" style="color:#3fb950">$passCount</div><div class="l">Passed</div></div>
<div class="card"><div class="v" style="color:#f85149">$failCount</div><div class="l">Failed</div></div>
<div class="card"><div class="v" style="color:#d29922">$warnCount</div><div class="l">Warnings</div></div>
<div class="card"><div class="v" style="color:#58a6ff">$manualCount</div><div class="l">Manual</div></div>
<div class="card"><div class="v" style="color:#8b949e">$noDataCount</div><div class="l">No Data</div></div></div>
<div style="margin:2rem 0"><h2 style="color:#58a6ff;margin-bottom:1rem">Section Scores</h2>$sectionsHtml</div>
<div style="margin:2rem 0"><h2 style="color:#f85149;margin-bottom:1rem;border-bottom:1px solid #21262d;padding-bottom:.5rem">Failed Controls</h2>$failedHtml</div>
<div class="footer">Generated by TenantScope CIS Benchmark Audit | Read-only | github.com/Thugney/-M365-TENANT-TOOLKIT</div>
</body></html>
"@

$htmlPath = Join-Path $OutputPath "cis-benchmark-report.html"
$htmlReport | Set-Content $htmlPath -Encoding UTF8

Write-Host "`nReports:" -ForegroundColor Green
Write-Host "  JSON: $jsonPath" -ForegroundColor White
Write-Host "  HTML: $htmlPath" -ForegroundColor White
Write-Host "`nCIS Benchmark Audit complete.`n" -ForegroundColor Cyan
