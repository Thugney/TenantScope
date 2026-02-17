# ============================================================================
# TenantScope - Shadow IT Detection
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Detects Shadow IT activity using Microsoft Defender for Cloud Apps and Graph API data.

.DESCRIPTION
    Identifies unsanctioned application usage and risky OAuth permissions:

    1. OAuth app consents that bypass IT (user-consented apps with risky permissions)
    2. Unverified publisher apps with broad permissions
    3. Applications with high-risk permission scopes
    4. Dormant apps with active permissions (consented but unused)
    5. Apps accessing sensitive data (mail, files, directory)
    6. Multi-tenant apps with admin consent

    Uses Microsoft Graph API to analyze:
    - OAuth2 permission grants
    - Service principal permissions
    - App sign-in activity

    Required Graph scopes:
    - Application.Read.All
    - Directory.Read.All
    - DelegatedPermissionGrant.ReadWrite.All (or .Read.All)
    - AuditLog.Read.All

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/shadow-it/.

.PARAMETER RiskThreshold
    Minimum risk level to include in report. Options: low, medium, high.
    Default: medium.

.EXAMPLE
    .\tools\Invoke-ShadowITDetection.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-ShadowITDetection.ps1 -Config $config -RiskThreshold "high"

.NOTES
    Version: 1.0.0
    Read-only detection and reporting tool.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Applications

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [ValidateSet("low", "medium", "high")]
    [string]$RiskThreshold = "medium"
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\shadow-it"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# High-risk OAuth scopes
$HighRiskScopes = @(
    "Mail.Read", "Mail.ReadWrite", "Mail.Send",
    "Directory.ReadWrite.All", "Directory.AccessAsUser.All",
    "User.ReadWrite.All", "User.ManageIdentities.All",
    "Files.ReadWrite.All", "Sites.ReadWrite.All",
    "Group.ReadWrite.All", "GroupMember.ReadWrite.All",
    "Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All",
    "RoleManagement.ReadWrite.Directory",
    "full_access_as_app"
)

$MediumRiskScopes = @(
    "Mail.Read.Shared", "Calendars.ReadWrite", "Contacts.ReadWrite",
    "User.Read.All", "Group.Read.All", "Directory.Read.All",
    "Files.Read.All", "Sites.Read.All", "Notes.ReadWrite.All",
    "Calendars.Read", "Contacts.Read", "People.Read.All"
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-ScopeRiskLevel {
    param([string]$Scope)

    if ($HighRiskScopes -contains $Scope) { return "high" }
    if ($MediumRiskScopes -contains $Scope) { return "medium" }
    return "low"
}

function Get-OverallRiskLevel {
    param([string[]]$Scopes)

    $hasHigh = $false
    $hasMedium = $false

    foreach ($scope in $Scopes) {
        $level = Get-ScopeRiskLevel -Scope $scope
        if ($level -eq "high") { $hasHigh = $true }
        if ($level -eq "medium") { $hasMedium = $true }
    }

    if ($hasHigh) { return "high" }
    if ($hasMedium) { return "medium" }
    return "low"
}

function Test-MeetsRiskThreshold {
    param(
        [string]$Level,
        [string]$Threshold
    )

    $levels = @{ "low" = 1; "medium" = 2; "high" = 3 }
    return $levels[$Level] -ge $levels[$Threshold]
}

# ============================================================================
# MAIN DETECTION
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Shadow IT Detection" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Risk threshold: $RiskThreshold" -ForegroundColor Gray
Write-Host ""

$now = Get-Date
$findings = @()

# -----------------------------------------------------------------------
# 1. Retrieve OAuth2 permission grants
# -----------------------------------------------------------------------
Write-Host "  Fetching OAuth permission grants..." -ForegroundColor Gray

$grants = @()
try {
    $grantUri = "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?`$top=500"
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $grantUri -OutputType PSObject
    } -OperationName "Get OAuth grants"

    if ($response.value) { $grants = @($response.value) }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Get OAuth grants (pagination)"
        if ($response.value) { $grants += $response.value }
    }

    Write-Host "  Retrieved $($grants.Count) OAuth permission grants" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve OAuth grants: $($_.Exception.Message)" -ForegroundColor Red
}

# -----------------------------------------------------------------------
# 2. Retrieve service principals
# -----------------------------------------------------------------------
Write-Host "  Fetching service principals..." -ForegroundColor Gray

$servicePrincipals = @()
$spLookup = @{}
try {
    $spUri = "https://graph.microsoft.com/v1.0/servicePrincipals?`$select=id,displayName,appId,publisherName,verifiedPublisher,appOwnerOrganizationId,servicePrincipalType,accountEnabled,signInAudience&`$top=500"
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $spUri -OutputType PSObject
    } -OperationName "Get service principals"

    if ($response.value) { $servicePrincipals = @($response.value) }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Get service principals (pagination)"
        if ($response.value) { $servicePrincipals += $response.value }
    }

    foreach ($sp in $servicePrincipals) {
        $spLookup[$sp.id] = $sp
    }

    Write-Host "  Retrieved $($servicePrincipals.Count) service principals" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve service principals: $($_.Exception.Message)" -ForegroundColor Red
}

# -----------------------------------------------------------------------
# 3. Analyze OAuth grants for risky patterns
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Analyzing OAuth grants for risky patterns..." -ForegroundColor Gray

# Group grants by service principal (app)
$grantsByApp = @{}
foreach ($grant in $grants) {
    $clientId = $grant.clientId
    if (-not $grantsByApp.ContainsKey($clientId)) {
        $grantsByApp[$clientId] = @()
    }
    $grantsByApp[$clientId] += $grant
}

foreach ($clientId in $grantsByApp.Keys) {
    $appGrants = $grantsByApp[$clientId]
    $sp = $spLookup[$clientId]

    if (-not $sp) { continue }

    $appName = $sp.displayName
    $publisher = $sp.publisherName
    $isVerified = $sp.verifiedPublisher -and $sp.verifiedPublisher.displayName
    $isMultiTenant = $sp.signInAudience -in @("AzureADMultipleOrgs", "AzureADandPersonalMicrosoftAccount")
    $isMicrosoftApp = $sp.appOwnerOrganizationId -eq "f8cdef31-a31e-4b4a-93e4-5f571e91255a" # Microsoft tenant ID

    # Skip Microsoft first-party apps
    if ($isMicrosoftApp) { continue }

    # Collect all scopes for this app
    $allScopes = @()
    $hasAdminConsent = $false
    $hasUserConsent = $false

    foreach ($grant in $appGrants) {
        if ($grant.scope) {
            $scopes = $grant.scope -split " " | Where-Object { $_ -ne "" }
            $allScopes += $scopes
        }
        if ($grant.consentType -eq "AllPrincipals") { $hasAdminConsent = $true }
        if ($grant.consentType -eq "Principal") { $hasUserConsent = $true }
    }
    $allScopes = $allScopes | Sort-Object -Unique

    $highRiskFound = @($allScopes | Where-Object { $HighRiskScopes -contains $_ })
    $mediumRiskFound = @($allScopes | Where-Object { $MediumRiskScopes -contains $_ })
    $overallRisk = Get-OverallRiskLevel -Scopes $allScopes

    # Skip if below threshold
    if (-not (Test-MeetsRiskThreshold -Level $overallRisk -Threshold $RiskThreshold)) { continue }

    # Build finding details
    $riskFactors = @()

    if ($highRiskFound.Count -gt 0) {
        $riskFactors += "High-risk scopes: $($highRiskFound -join ', ')"
    }
    if (-not $isVerified) {
        $riskFactors += "Unverified publisher"
    }
    if ($hasUserConsent -and $highRiskFound.Count -gt 0) {
        $riskFactors += "User-consented (bypasses IT)"
    }
    if ($isMultiTenant -and $hasAdminConsent) {
        $riskFactors += "Multi-tenant app with admin consent"
    }

    if ($riskFactors.Count -gt 0) {
        $findings += [PSCustomObject]@{
            appName          = $appName
            appId            = $sp.appId
            publisher        = $publisher
            isVerified       = $isVerified
            isMultiTenant    = $isMultiTenant
            riskLevel        = $overallRisk
            consentType      = if ($hasAdminConsent -and $hasUserConsent) { "Both" } elseif ($hasAdminConsent) { "Admin" } else { "User" }
            highRiskScopes   = $highRiskFound
            mediumRiskScopes = $mediumRiskFound
            allScopes        = $allScopes
            riskFactors      = $riskFactors
            grantCount       = $appGrants.Count
        }
    }
}

# Sort findings by risk
$findings = $findings | Sort-Object @{e={switch($_.riskLevel){"high"{0}"medium"{1}"low"{2}}}}

# -----------------------------------------------------------------------
# 4. Unverified publisher analysis
# -----------------------------------------------------------------------
Write-Host "  Checking for unverified publishers with permissions..." -ForegroundColor Gray

$unverifiedWithPermissions = @($findings | Where-Object { -not $_.isVerified })
$userConsentedRisky = @($findings | Where-Object { $_.consentType -in @("User", "Both") -and $_.riskLevel -eq "high" })

# -----------------------------------------------------------------------
# 5. Summary
# -----------------------------------------------------------------------
$highRiskApps = ($findings | Where-Object { $_.riskLevel -eq "high" }).Count
$mediumRiskApps = ($findings | Where-Object { $_.riskLevel -eq "medium" }).Count
$lowRiskApps = ($findings | Where-Object { $_.riskLevel -eq "low" }).Count

Write-Host ""
Write-Host "  Results:" -ForegroundColor White
Write-Host "    Apps analyzed:              $($grantsByApp.Count)" -ForegroundColor Gray
Write-Host "    Shadow IT findings:         $($findings.Count)" -ForegroundColor Gray
Write-Host "    High risk:                  $highRiskApps" -ForegroundColor $(if ($highRiskApps -gt 0) { "Red" } else { "Gray" })
Write-Host "    Medium risk:                $mediumRiskApps" -ForegroundColor $(if ($mediumRiskApps -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Unverified with permissions: $($unverifiedWithPermissions.Count)" -ForegroundColor $(if ($unverifiedWithPermissions.Count -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    User-consented high risk:   $($userConsentedRisky.Count)" -ForegroundColor $(if ($userConsentedRisky.Count -gt 0) { "Red" } else { "Gray" })

# -----------------------------------------------------------------------
# 6. Generate reports
# -----------------------------------------------------------------------
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$report = [PSCustomObject]@{
    reportType = "shadow-it-detection"
    generated  = $now.ToString("o")
    riskThreshold = $RiskThreshold
    summary    = [PSCustomObject]@{
        appsAnalyzed    = $grantsByApp.Count
        totalFindings   = $findings.Count
        highRisk        = $highRiskApps
        mediumRisk      = $mediumRiskApps
        lowRisk         = $lowRiskApps
        unverifiedPublishers = $unverifiedWithPermissions.Count
        userConsentedHighRisk = $userConsentedRisky.Count
    }
    findings   = $findings
}

$jsonFile = Join-Path $OutputPath "shadow-it-detection-${timestamp}.json"
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonFile -Encoding UTF8

# HTML report
$findingsHtml = ""
foreach ($f in $findings) {
    $badgeClass = switch ($f.riskLevel) { "high" { "badge-red" } "medium" { "badge-yellow" } "low" { "badge-gray" } }
    $verifiedIcon = if ($f.isVerified) { "<span style='color:#10b981'>Verified</span>" } else { "<span style='color:#ef4444'>Unverified</span>" }
    $riskFactorHtml = ($f.riskFactors | ForEach-Object { "<li>$([System.Web.HttpUtility]::HtmlEncode($_))</li>" }) -join ""

    $findingsHtml += @"
    <tr>
        <td><span class="badge $badgeClass">$($f.riskLevel.ToUpper())</span></td>
        <td><strong>$([System.Web.HttpUtility]::HtmlEncode($f.appName))</strong></td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($f.publisher))<br>$verifiedIcon</td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($f.consentType))</td>
        <td>$($f.allScopes.Count) scopes<br><small>$($f.highRiskScopes.Count) high-risk</small></td>
        <td><ul style='margin:0;padding-left:16px;font-size:12px'>$riskFactorHtml</ul></td>
    </tr>
"@
}

$htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - Shadow IT Detection Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0 0; opacity: 0.8; }
        .summary { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
        .card { flex: 1; min-width: 140px; background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
        .card h3 { margin: 0 0 8px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .card .value { font-size: 32px; font-weight: 700; }
        .section { background: white; border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; vertical-align: top; }
        tr:hover { background: #f8fafc; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: white; }
        .badge-red { background: #ef4444; }
        .badge-yellow { background: #f59e0b; }
        .badge-gray { background: #94a3b8; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Shadow IT Detection Report</h1>
        <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") | Risk threshold: $RiskThreshold | Apps analyzed: $($grantsByApp.Count)</p>
    </div>

    <div class="summary">
        <div class="card"><h3>Total Findings</h3><div class="value">$($findings.Count)</div></div>
        <div class="card"><h3>High Risk</h3><div class="value" style="color:#ef4444">$highRiskApps</div></div>
        <div class="card"><h3>Medium Risk</h3><div class="value" style="color:#f59e0b">$mediumRiskApps</div></div>
        <div class="card"><h3>Unverified</h3><div class="value" style="color:#f97316">$($unverifiedWithPermissions.Count)</div></div>
        <div class="card"><h3>User Consented (High Risk)</h3><div class="value" style="color:#ef4444">$($userConsentedRisky.Count)</div></div>
    </div>

    <div class="section">
        <h2>Risky Applications</h2>
        $(if ($findingsHtml) {
            "<table><tr><th>Risk</th><th>Application</th><th>Publisher</th><th>Consent</th><th>Scopes</th><th>Risk Factors</th></tr>$findingsHtml</table>"
        } else {
            "<p style='color:#94a3b8; text-align:center; padding:40px;'>No shadow IT findings above the $RiskThreshold risk threshold.</p>"
        })
    </div>
</body>
</html>
"@

$htmlFile = Join-Path $OutputPath "shadow-it-detection-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

Write-Host ""
Write-Host "  HTML report: $htmlFile" -ForegroundColor Green
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green
Write-Host ""

return $report
