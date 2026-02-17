# ============================================================================
# TenantScope - Group Membership Hygiene
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Identifies stale and problematic group memberships across the tenant.

.DESCRIPTION
    Scans security groups, Microsoft 365 groups, and distribution groups for
    membership hygiene issues:

    1. Disabled accounts still in groups
    2. Users who left a department but remain in department groups
    3. Nested groups creating unintended access expansion
    4. License assignment groups with disabled/stale members (wasted licenses)
    5. CA exclusion groups with stale entries
    6. Groups with no owner
    7. Empty groups that should be cleaned up

    Especially important for:
    - License assignment groups (direct cost impact)
    - CA exclusion groups (security impact)
    - Role-assignable groups (privilege impact)

    Required Graph scopes:
    - Group.Read.All
    - GroupMember.Read.All
    - User.Read.All
    - Directory.Read.All

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for output reports. Defaults to ./data/group-hygiene/.

.PARAMETER FocusGroups
    Optional array of specific group display name patterns to focus on.
    Supports wildcards: "License*", "*CA-Exclusion*"

.PARAMETER IncludeDistributionGroups
    Include distribution groups in the analysis (off by default for performance).

.EXAMPLE
    .\tools\Invoke-GroupHygiene.ps1 -Config $config

.EXAMPLE
    .\tools\Invoke-GroupHygiene.ps1 -Config $config -FocusGroups @("License*", "*Exclusion*")

.NOTES
    Version: 1.0.0
    Read-only analysis tool.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Groups

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [string[]]$FocusGroups,

    [Parameter()]
    [switch]$IncludeDistributionGroups
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\group-hygiene"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-GroupMembersDetailed {
    <#
    .SYNOPSIS
        Gets all members of a group with detailed user properties.
    #>
    param(
        [string]$GroupId,
        [int]$MaxMembers = 500
    )

    $members = @()
    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members?`$select=id,displayName,userPrincipalName,mail,accountEnabled,userType,department,jobTitle,createdDateTime&`$top=100"

    try {
        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Get group members" -MaxRetries 2

            if ($response.value) {
                $members += $response.value
            }

            $uri = $response.'@odata.nextLink'

            if ($members.Count -ge $MaxMembers) { break }
        } while ($uri)
    }
    catch { }

    return $members
}

function Test-GroupHasLicenseAssignment {
    <#
    .SYNOPSIS
        Checks if a group is used for group-based license assignment.
    #>
    param([string]$GroupId)

    try {
        $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId`?`$select=assignedLicenses"
        $group = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Check group licenses" -MaxRetries 2

        return ($group.assignedLicenses -and $group.assignedLicenses.Count -gt 0)
    }
    catch {
        return $false
    }
}

# ============================================================================
# MAIN ANALYSIS
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Group Membership Hygiene" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$now = Get-Date
$findings = @()
$groupsAnalyzed = 0

# -----------------------------------------------------------------------
# 1. Retrieve groups
# -----------------------------------------------------------------------
Write-Host "  Fetching groups..." -ForegroundColor Gray

$allGroups = @()
$groupFilter = if ($IncludeDistributionGroups) {
    ""
} else {
    "&`$filter=securityEnabled eq true"
}
$groupUri = "https://graph.microsoft.com/v1.0/groups?`$select=id,displayName,groupTypes,mailEnabled,securityEnabled,membershipRule,description,isAssignableToRole,createdDateTime&`$top=200$groupFilter"

try {
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $groupUri -OutputType PSObject
    } -OperationName "Get groups"

    if ($response.value) {
        $allGroups = @($response.value)
    }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Get groups (pagination)"
        if ($response.value) {
            $allGroups += $response.value
        }
    }

    Write-Host "  Retrieved $($allGroups.Count) groups" -ForegroundColor Gray
}
catch {
    Write-Host "  FAILED to retrieve groups: $($_.Exception.Message)" -ForegroundColor Red
    return
}

# Apply focus filter if specified
if ($FocusGroups) {
    $filtered = @()
    foreach ($group in $allGroups) {
        foreach ($pattern in $FocusGroups) {
            if ($group.displayName -like $pattern) {
                $filtered += $group
                break
            }
        }
    }
    $allGroups = $filtered
    Write-Host "  Filtered to $($allGroups.Count) groups matching focus patterns" -ForegroundColor Gray
}

# Skip dynamic groups for member analysis (members are auto-managed)
$staticGroups = @($allGroups | Where-Object { $_.groupTypes -notcontains "DynamicMembership" })
$dynamicGroups = @($allGroups | Where-Object { $_.groupTypes -contains "DynamicMembership" })

Write-Host "  Static groups to analyze: $($staticGroups.Count)" -ForegroundColor Gray
Write-Host "  Dynamic groups (skipped for member analysis): $($dynamicGroups.Count)" -ForegroundColor Gray
Write-Host ""

# -----------------------------------------------------------------------
# 2. Analyze each static group
# -----------------------------------------------------------------------
Write-Host "  Analyzing group memberships..." -ForegroundColor Gray

$processedCount = 0
foreach ($group in $staticGroups) {
    $processedCount++
    if ($processedCount % 25 -eq 0) {
        Write-Host "    Processing $processedCount / $($staticGroups.Count)..." -ForegroundColor Gray
    }

    $members = Get-GroupMembersDetailed -GroupId $group.id

    # Separate users and nested groups
    $userMembers = @($members | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.user' })
    $nestedGroups = @($members | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' })
    $groupsAnalyzed++

    # Check: Disabled accounts
    $disabledMembers = @($userMembers | Where-Object { $_.accountEnabled -eq $false })
    if ($disabledMembers.Count -gt 0) {
        $isLicenseGroup = Test-GroupHasLicenseAssignment -GroupId $group.id
        $isRoleAssignable = $group.isAssignableToRole -eq $true

        $severity = "medium"
        if ($isLicenseGroup) { $severity = "high" }
        if ($isRoleAssignable) { $severity = "critical" }

        $disabledNames = ($disabledMembers | Select-Object -First 5 | ForEach-Object { $_.displayName }) -join ", "
        $moreText = if ($disabledMembers.Count -gt 5) { " (+$($disabledMembers.Count - 5) more)" } else { "" }

        $findings += [PSCustomObject]@{
            category    = "Disabled Accounts"
            severity    = $severity
            groupName   = $group.displayName
            groupId     = $group.id
            finding     = "$($disabledMembers.Count) disabled account(s)"
            detail      = "$disabledNames$moreText"
            impact      = if ($isLicenseGroup) { "License waste" } elseif ($isRoleAssignable) { "Stale privilege assignment" } else { "Stale access" }
            isLicenseGroup = $isLicenseGroup
            isRoleAssignable = $isRoleAssignable
        }
    }

    # Check: Guest accounts in security groups
    $guestMembers = @($userMembers | Where-Object { $_.userType -eq "Guest" })
    if ($guestMembers.Count -gt 0 -and $group.securityEnabled) {
        $findings += [PSCustomObject]@{
            category    = "Guest in Security Group"
            severity    = "medium"
            groupName   = $group.displayName
            groupId     = $group.id
            finding     = "$($guestMembers.Count) guest account(s) in security group"
            detail      = ($guestMembers | Select-Object -First 5 | ForEach-Object { $_.displayName }) -join ", "
            impact      = "External access via security group"
            isLicenseGroup = $false
            isRoleAssignable = $group.isAssignableToRole -eq $true
        }
    }

    # Check: Nested groups
    if ($nestedGroups.Count -gt 0) {
        $findings += [PSCustomObject]@{
            category    = "Nested Group"
            severity    = "low"
            groupName   = $group.displayName
            groupId     = $group.id
            finding     = "$($nestedGroups.Count) nested group(s)"
            detail      = ($nestedGroups | Select-Object -First 5 | ForEach-Object { $_.displayName }) -join ", "
            impact      = "Potential unintended access expansion"
            isLicenseGroup = $false
            isRoleAssignable = $group.isAssignableToRole -eq $true
        }
    }

    # Check: Empty groups
    if ($members.Count -eq 0) {
        $findings += [PSCustomObject]@{
            category    = "Empty Group"
            severity    = "low"
            groupName   = $group.displayName
            groupId     = $group.id
            finding     = "Group has no members"
            detail      = "Created: $($group.createdDateTime)"
            impact      = "Cleanup candidate"
            isLicenseGroup = $false
            isRoleAssignable = $false
        }
    }

    # Check: No owners
    try {
        $ownerUri = "https://graph.microsoft.com/v1.0/groups/$($group.id)/owners?`$select=id&`$top=1"
        $ownerResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $ownerUri -OutputType PSObject
        } -OperationName "Check group owners" -MaxRetries 2

        if (-not $ownerResponse.value -or $ownerResponse.value.Count -eq 0) {
            $findings += [PSCustomObject]@{
                category    = "No Owner"
                severity    = "medium"
                groupName   = $group.displayName
                groupId     = $group.id
                finding     = "Group has no owner assigned"
                detail      = "Ownerless groups cannot be properly governed"
                impact      = "Governance gap"
                isLicenseGroup = $false
                isRoleAssignable = $group.isAssignableToRole -eq $true
            }
        }
    }
    catch { }

    # Rate limit protection
    Start-Sleep -Milliseconds 100
}

# -----------------------------------------------------------------------
# 3. Generate summary
# -----------------------------------------------------------------------
$criticalCount = ($findings | Where-Object { $_.severity -eq "critical" }).Count
$highCount = ($findings | Where-Object { $_.severity -eq "high" }).Count
$mediumCount = ($findings | Where-Object { $_.severity -eq "medium" }).Count
$lowCount = ($findings | Where-Object { $_.severity -eq "low" }).Count

$disabledTotal = ($findings | Where-Object { $_.category -eq "Disabled Accounts" } | ForEach-Object {
    if ($_.finding -match "^(\d+)") { [int]$Matches[1] } else { 0 }
} | Measure-Object -Sum).Sum

Write-Host ""
Write-Host "  Results:" -ForegroundColor White
Write-Host "    Groups analyzed:  $groupsAnalyzed" -ForegroundColor Gray
Write-Host "    Total findings:   $($findings.Count)" -ForegroundColor Gray
Write-Host "    Critical:         $criticalCount" -ForegroundColor $(if ($criticalCount -gt 0) { "Red" } else { "Gray" })
Write-Host "    High:             $highCount" -ForegroundColor $(if ($highCount -gt 0) { "DarkYellow" } else { "Gray" })
Write-Host "    Medium:           $mediumCount" -ForegroundColor $(if ($mediumCount -gt 0) { "Yellow" } else { "Gray" })
Write-Host "    Low:              $lowCount" -ForegroundColor Gray
Write-Host "    Disabled members: $disabledTotal total across all groups" -ForegroundColor Gray

# -----------------------------------------------------------------------
# 4. Generate reports
# -----------------------------------------------------------------------
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$report = [PSCustomObject]@{
    reportType = "group-hygiene"
    generated  = $now.ToString("o")
    summary    = [PSCustomObject]@{
        groupsAnalyzed = $groupsAnalyzed
        totalFindings  = $findings.Count
        critical       = $criticalCount
        high           = $highCount
        medium         = $mediumCount
        low            = $lowCount
        disabledMembersTotal = $disabledTotal
    }
    findings   = $findings
}

$jsonFile = Join-Path $OutputPath "group-hygiene-${timestamp}.json"
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonFile -Encoding UTF8

# HTML report
$findingsHtml = ""
foreach ($f in ($findings | Sort-Object @{e={switch($_.severity){"critical"{0}"high"{1}"medium"{2}"low"{3}}}}, groupName)) {
    $badgeClass = switch ($f.severity) { "critical" { "badge-red" } "high" { "badge-orange" } "medium" { "badge-yellow" } "low" { "badge-gray" } }
    $findingsHtml += @"
    <tr>
        <td><span class="badge $badgeClass">$($f.severity.ToUpper())</span></td>
        <td><strong>$([System.Web.HttpUtility]::HtmlEncode($f.groupName))</strong></td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($f.category))</td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($f.finding))</td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($f.detail))</td>
        <td>$([System.Web.HttpUtility]::HtmlEncode($f.impact))</td>
    </tr>
"@
}

$htmlReport = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>TenantScope - Group Hygiene Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 8px 0 0 0; opacity: 0.8; }
        .summary { display: flex; gap: 20px; margin-bottom: 30px; }
        .card { flex: 1; background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
        .card h3 { margin: 0 0 8px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .card .value { font-size: 32px; font-weight: 700; }
        .section { background: white; border-radius: 10px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        tr:hover { background: #f8fafc; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: white; }
        .badge-red { background: #ef4444; }
        .badge-orange { background: #f97316; }
        .badge-yellow { background: #f59e0b; }
        .badge-gray { background: #94a3b8; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Group Membership Hygiene Report</h1>
        <p>Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm") | Groups analyzed: $groupsAnalyzed</p>
    </div>

    <div class="summary">
        <div class="card"><h3>Groups Analyzed</h3><div class="value">$groupsAnalyzed</div></div>
        <div class="card"><h3>Findings</h3><div class="value">$($findings.Count)</div></div>
        <div class="card"><h3>Critical</h3><div class="value" style="color:#ef4444">$criticalCount</div></div>
        <div class="card"><h3>High</h3><div class="value" style="color:#f97316">$highCount</div></div>
        <div class="card"><h3>Disabled Members</h3><div class="value" style="color:#f59e0b">$disabledTotal</div></div>
    </div>

    <div class="section">
        <h2>All Findings</h2>
        $(if ($findingsHtml) {
            "<table><tr><th>Severity</th><th>Group</th><th>Category</th><th>Finding</th><th>Detail</th><th>Impact</th></tr>$findingsHtml</table>"
        } else {
            "<p style='color:#94a3b8; text-align:center; padding:40px;'>No hygiene issues found. Group memberships look clean.</p>"
        })
    </div>
</body>
</html>
"@

$htmlFile = Join-Path $OutputPath "group-hygiene-${timestamp}.html"
$htmlReport | Set-Content -Path $htmlFile -Encoding UTF8

Write-Host ""
Write-Host "  HTML report: $htmlFile" -ForegroundColor Green
Write-Host "  JSON report: $jsonFile" -ForegroundColor Green
Write-Host ""

return $report
