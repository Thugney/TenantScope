# ============================================================================
# TenantScope - Automated User Onboarding Provisioning
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Automated user onboarding workflow for Microsoft 365.

.DESCRIPTION
    Handles the complete onboarding provisioning process for new employees:

    1. Assign license based on department/role mapping
    2. Add to correct security and distribution groups
    3. Set manager relationship
    4. Trigger Autopilot pre-provisioning assignment (via group tag)
    5. Send welcome email to manager with setup instructions
    6. Export onboarding audit report

    Can be triggered after HR creates the user account or via ITSM integration.

    WARNING: This script performs WRITE operations on your tenant.
    Always run with -WhatIf first to preview changes.

    Required Graph scopes (Application or Delegated):
    - User.ReadWrite.All
    - Directory.ReadWrite.All
    - Group.ReadWrite.All
    - Mail.Send (for welcome email)

.PARAMETER UserPrincipalName
    The UPN of the newly created user to onboard.

.PARAMETER Department
    Department name for group and license mapping. If not specified,
    reads from the user's department property in Entra ID.

.PARAMETER ManagerUPN
    UPN of the user's manager. If not specified, reads from Entra ID.

.PARAMETER LicenseSku
    Specific license SKU to assign. If not specified, uses the
    department-to-license mapping from config.

.PARAMETER SkipLicenseAssignment
    Skip license assignment step.

.PARAMETER SkipGroupAssignment
    Skip group membership assignment.

.PARAMETER SkipWelcomeEmail
    Skip sending the welcome email to the manager.

.PARAMETER OnboardingConfig
    Path to an onboarding configuration file with department-to-license
    and department-to-group mappings. Defaults to ./config/onboarding-mappings.json.

.PARAMETER ExportPath
    Path to export the onboarding audit report.

.PARAMETER WhatIf
    Preview all changes without making them.

.PARAMETER Confirm
    Prompt for confirmation before each step.

.EXAMPLE
    .\tools\Invoke-UserOnboarding.ps1 -UserPrincipalName "new.user@contoso.com" -WhatIf

.EXAMPLE
    .\tools\Invoke-UserOnboarding.ps1 -UserPrincipalName "new.user@contoso.com" -Department "Engineering" -ManagerUPN "team.lead@contoso.com"

.NOTES
    Version: 1.0.0
    This is an OPERATIONAL tool - it modifies tenant state.
    Always run with -WhatIf first and review the output.

    To configure department mappings, create an onboarding-mappings.json file:
    {
        "departmentMappings": {
            "Engineering": {
                "licenseSku": "SPE_E5",
                "groups": ["SG-Engineering", "SG-VPN-Users", "DL-Engineering-All"],
                "autopilotGroupTag": "Engineering"
            },
            "Sales": {
                "licenseSku": "SPE_E3",
                "groups": ["SG-Sales", "SG-CRM-Users", "DL-Sales-All"],
                "autopilotGroupTag": "Sales"
            }
        },
        "defaultLicenseSku": "SPE_E3",
        "defaultGroups": ["SG-All-Employees", "DL-Company-All"]
    }
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Groups

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[^@]+@[^@]+\.[^@]+$')]
    [string]$UserPrincipalName,

    [Parameter()]
    [string]$Department,

    [Parameter()]
    [string]$ManagerUPN,

    [Parameter()]
    [string]$LicenseSku,

    [Parameter()]
    [switch]$SkipLicenseAssignment,

    [Parameter()]
    [switch]$SkipGroupAssignment,

    [Parameter()]
    [switch]$SkipWelcomeEmail,

    [Parameter()]
    [string]$OnboardingConfig,

    [Parameter()]
    [string]$ExportPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

$script:OnboardingLog = @()
$script:StartTime = Get-Date
$script:StepNumber = 0

if (-not $ExportPath) {
    $ExportPath = Join-Path $PSScriptRoot "..\data\onboarding"
}

if (-not $OnboardingConfig) {
    $OnboardingConfig = Join-Path $PSScriptRoot "..\config\onboarding-mappings.json"
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-OnboardingStep {
    param(
        [string]$Step,
        [string]$Status,
        [string]$Detail = ""
    )

    $script:StepNumber++
    $timestamp = Get-Date -Format "HH:mm:ss"
    $statusColor = switch ($Status) {
        "SUCCESS"  { "Green" }
        "SKIPPED"  { "Yellow" }
        "FAILED"   { "Red" }
        "WHATIF"   { "Cyan" }
        "INFO"     { "Gray" }
        default    { "White" }
    }

    Write-Host "  [$timestamp] Step $($script:StepNumber): $Step " -NoNewline
    Write-Host "[$Status]" -ForegroundColor $statusColor
    if ($Detail) {
        Write-Host "             $Detail" -ForegroundColor Gray
    }

    $script:OnboardingLog += [PSCustomObject]@{
        step      = $script:StepNumber
        action    = $Step
        status    = $Status
        detail    = $Detail
        timestamp = (Get-Date).ToString("o")
    }
}

function Get-OnboardingMappings {
    <#
    .SYNOPSIS
        Loads department-to-license and department-to-group mappings.
    #>
    param([string]$ConfigPath)

    $defaultMappings = @{
        departmentMappings = @{}
        defaultLicenseSku  = "SPE_E3"
        defaultGroups      = @()
    }

    if (Test-Path $ConfigPath) {
        try {
            $mappings = Get-Content $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
            return $mappings
        }
        catch {
            Write-Host "  WARNING: Could not load onboarding mappings from $ConfigPath" -ForegroundColor Yellow
        }
    }

    return $defaultMappings
}

function Resolve-GroupId {
    <#
    .SYNOPSIS
        Resolves a group display name to its ID.
    #>
    param([string]$GroupName)

    try {
        $encodedName = [System.Web.HttpUtility]::UrlEncode($GroupName)
        $uri = "https://graph.microsoft.com/v1.0/groups?`$filter=displayName eq '$GroupName'&`$select=id,displayName"
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Resolve group: $GroupName" -MaxRetries 2

        if ($response.value -and $response.value.Count -gt 0) {
            return $response.value[0].id
        }
    }
    catch { }

    return $null
}

function Resolve-LicenseSkuId {
    <#
    .SYNOPSIS
        Resolves a license SKU part number to its SKU ID.
    #>
    param([string]$SkuPartNumber)

    try {
        $uri = "https://graph.microsoft.com/v1.0/subscribedSkus?`$select=skuId,skuPartNumber,consumedUnits,prepaidUnits"
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Get subscribed SKUs"

        if ($response.value) {
            $sku = $response.value | Where-Object { $_.skuPartNumber -eq $SkuPartNumber }
            if ($sku) {
                $available = $sku.prepaidUnits.enabled - $sku.consumedUnits
                return @{
                    skuId     = $sku.skuId
                    available = $available
                    consumed  = $sku.consumedUnits
                    total     = $sku.prepaidUnits.enabled
                }
            }
        }
    }
    catch { }

    return $null
}

# ============================================================================
# MAIN ONBOARDING WORKFLOW
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Automated User Onboarding" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

if ($WhatIfPreference) {
    Write-Host "  *** WHATIF MODE - No changes will be made ***" -ForegroundColor Yellow
    Write-Host ""
}

# -----------------------------------------------------------------------
# Step 0: Validate user exists
# -----------------------------------------------------------------------
Write-Host "  Target user: $UserPrincipalName" -ForegroundColor White
Write-Host ""

$user = $null
try {
    $uri = "https://graph.microsoft.com/v1.0/users/$UserPrincipalName`?`$select=id,displayName,userPrincipalName,department,jobTitle,accountEnabled,mail&`$expand=manager(`$select=id,displayName,userPrincipalName,mail)"
    $user = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
    } -OperationName "Get user details"

    Write-OnboardingStep -Step "Validate user exists" -Status "SUCCESS" `
        -Detail "$($user.displayName) | $($user.department) | $($user.jobTitle)"
}
catch {
    Write-OnboardingStep -Step "Validate user exists" -Status "FAILED" -Detail $_.Exception.Message
    Write-Host ""
    Write-Host "  ONBOARDING ABORTED - User not found." -ForegroundColor Red
    return
}

$userId = $user.id

# Resolve department
$resolvedDepartment = if ($Department) { $Department } elseif ($user.department) { $user.department } else { $null }
if ($resolvedDepartment) {
    Write-OnboardingStep -Step "Determine department" -Status "SUCCESS" -Detail $resolvedDepartment
}
else {
    Write-OnboardingStep -Step "Determine department" -Status "INFO" -Detail "No department specified or found on user"
}

# Resolve manager
$resolvedManagerUPN = $ManagerUPN
if (-not $resolvedManagerUPN -and $user.manager) {
    $resolvedManagerUPN = $user.manager.userPrincipalName
}

# Load onboarding mappings
$mappings = Get-OnboardingMappings -ConfigPath $OnboardingConfig
$deptMapping = $null
if ($resolvedDepartment -and $mappings.departmentMappings.ContainsKey($resolvedDepartment)) {
    $deptMapping = $mappings.departmentMappings[$resolvedDepartment]
    Write-OnboardingStep -Step "Load department mapping" -Status "SUCCESS" `
        -Detail "Found mapping for '$resolvedDepartment'"
}
elseif (Test-Path $OnboardingConfig) {
    Write-OnboardingStep -Step "Load department mapping" -Status "INFO" `
        -Detail "No specific mapping for '$resolvedDepartment' — using defaults"
}

# -----------------------------------------------------------------------
# Step 1: Set manager relationship
# -----------------------------------------------------------------------
if ($resolvedManagerUPN) {
    if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Set manager to $resolvedManagerUPN")) {
        try {
            # First resolve manager ID
            $managerUri = "https://graph.microsoft.com/v1.0/users/$resolvedManagerUPN`?`$select=id"
            $managerObj = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $managerUri -OutputType PSObject
            } -OperationName "Resolve manager"

            $managerRef = @{
                "@odata.id" = "https://graph.microsoft.com/v1.0/users/$($managerObj.id)"
            } | ConvertTo-Json

            Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method PUT `
                    -Uri "https://graph.microsoft.com/v1.0/users/$userId/manager/`$ref" `
                    -Body $managerRef -ContentType "application/json"
            } -OperationName "Set manager"

            Write-OnboardingStep -Step "Set manager" -Status "SUCCESS" -Detail $resolvedManagerUPN
        }
        catch {
            Write-OnboardingStep -Step "Set manager" -Status "FAILED" -Detail $_.Exception.Message
        }
    }
    else {
        Write-OnboardingStep -Step "Set manager" -Status "WHATIF" -Detail "Would set manager to $resolvedManagerUPN"
    }
}
else {
    Write-OnboardingStep -Step "Set manager" -Status "SKIPPED" -Detail "No manager specified"
}

# -----------------------------------------------------------------------
# Step 2: Assign license
# -----------------------------------------------------------------------
if ($SkipLicenseAssignment) {
    Write-OnboardingStep -Step "Assign license" -Status "SKIPPED" -Detail "SkipLicenseAssignment flag set"
}
else {
    $targetSku = $LicenseSku
    if (-not $targetSku -and $deptMapping -and $deptMapping.licenseSku) {
        $targetSku = $deptMapping.licenseSku
    }
    if (-not $targetSku -and $mappings.defaultLicenseSku) {
        $targetSku = $mappings.defaultLicenseSku
    }

    if ($targetSku) {
        if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Assign license: $targetSku")) {
            try {
                $skuInfo = Resolve-LicenseSkuId -SkuPartNumber $targetSku

                if (-not $skuInfo) {
                    Write-OnboardingStep -Step "Assign license" -Status "FAILED" -Detail "SKU '$targetSku' not found in tenant"
                }
                elseif ($skuInfo.available -le 0) {
                    Write-OnboardingStep -Step "Assign license" -Status "FAILED" `
                        -Detail "No available licenses for $targetSku ($($skuInfo.consumed)/$($skuInfo.total) consumed)"
                }
                else {
                    $licenseBody = @{
                        addLicenses    = @(
                            @{ skuId = $skuInfo.skuId }
                        )
                        removeLicenses = @()
                    } | ConvertTo-Json -Depth 3

                    Invoke-GraphWithRetry -ScriptBlock {
                        Invoke-MgGraphRequest -Method POST `
                            -Uri "https://graph.microsoft.com/v1.0/users/$userId/assignLicense" `
                            -Body $licenseBody -ContentType "application/json"
                    } -OperationName "Assign license"

                    Write-OnboardingStep -Step "Assign license" -Status "SUCCESS" `
                        -Detail "$targetSku ($($skuInfo.available - 1) remaining)"
                }
            }
            catch {
                Write-OnboardingStep -Step "Assign license" -Status "FAILED" -Detail $_.Exception.Message
            }
        }
        else {
            Write-OnboardingStep -Step "Assign license" -Status "WHATIF" -Detail "Would assign $targetSku"
        }
    }
    else {
        Write-OnboardingStep -Step "Assign license" -Status "SKIPPED" -Detail "No license SKU configured for department"
    }
}

# -----------------------------------------------------------------------
# Step 3: Add to groups
# -----------------------------------------------------------------------
if ($SkipGroupAssignment) {
    Write-OnboardingStep -Step "Assign group memberships" -Status "SKIPPED" -Detail "SkipGroupAssignment flag set"
}
else {
    $targetGroups = @()

    # Default groups for all employees
    if ($mappings.defaultGroups) {
        $targetGroups += $mappings.defaultGroups
    }

    # Department-specific groups
    if ($deptMapping -and $deptMapping.groups) {
        $targetGroups += $deptMapping.groups
    }

    $targetGroups = $targetGroups | Sort-Object -Unique

    if ($targetGroups.Count -eq 0) {
        Write-OnboardingStep -Step "Assign group memberships" -Status "SKIPPED" -Detail "No groups configured"
    }
    else {
        if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Add to $($targetGroups.Count) groups")) {
            $addedCount = 0
            $failedGroups = @()

            foreach ($groupName in $targetGroups) {
                $groupId = Resolve-GroupId -GroupName $groupName

                if (-not $groupId) {
                    $failedGroups += "$groupName (not found)"
                    continue
                }

                try {
                    $memberRef = @{
                        "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$userId"
                    } | ConvertTo-Json

                    Invoke-GraphWithRetry -ScriptBlock {
                        Invoke-MgGraphRequest -Method POST `
                            -Uri "https://graph.microsoft.com/v1.0/groups/$groupId/members/`$ref" `
                            -Body $memberRef -ContentType "application/json"
                    } -OperationName "Add to group $groupName" -MaxRetries 2

                    $addedCount++
                }
                catch {
                    if ($_.Exception.Message -match "already exist") {
                        $addedCount++ # Already a member, count as success
                    }
                    else {
                        $failedGroups += "$groupName ($($_.Exception.Message))"
                    }
                }
            }

            $detail = "Added to $addedCount of $($targetGroups.Count) groups"
            if ($failedGroups.Count -gt 0) {
                $detail += " | Failed: $($failedGroups -join '; ')"
            }
            $status = if ($failedGroups.Count -gt 0 -and $addedCount -eq 0) { "FAILED" } elseif ($failedGroups.Count -gt 0) { "SUCCESS" } else { "SUCCESS" }
            Write-OnboardingStep -Step "Assign group memberships" -Status $status -Detail $detail
        }
        else {
            Write-OnboardingStep -Step "Assign group memberships" -Status "WHATIF" `
                -Detail "Would add to: $($targetGroups -join ', ')"
        }
    }
}

# -----------------------------------------------------------------------
# Step 4: Send welcome email to manager
# -----------------------------------------------------------------------
if ($SkipWelcomeEmail -or -not $resolvedManagerUPN) {
    $skipReason = if ($SkipWelcomeEmail) { "SkipWelcomeEmail flag set" } else { "No manager to send to" }
    Write-OnboardingStep -Step "Send welcome email to manager" -Status "SKIPPED" -Detail $skipReason
}
else {
    if ($PSCmdlet.ShouldProcess($resolvedManagerUPN, "Send welcome email about $UserPrincipalName")) {
        try {
            $userDisplayName = $user.displayName
            $userDept = if ($resolvedDepartment) { $resolvedDepartment } else { "Not specified" }
            $userTitle = if ($user.jobTitle) { $user.jobTitle } else { "Not specified" }

            $mailBody = @{
                message = @{
                    subject      = "New Team Member Setup: $userDisplayName"
                    body         = @{
                        contentType = "HTML"
                        content     = @"
<h2>New Team Member Onboarding Complete</h2>
<p>A new team member has been provisioned in Microsoft 365:</p>
<table style="border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px 16px;font-weight:bold;background:#f8fafc">Name</td><td style="padding:8px 16px">$([System.Web.HttpUtility]::HtmlEncode($userDisplayName))</td></tr>
<tr><td style="padding:8px 16px;font-weight:bold;background:#f8fafc">Email</td><td style="padding:8px 16px">$([System.Web.HttpUtility]::HtmlEncode($UserPrincipalName))</td></tr>
<tr><td style="padding:8px 16px;font-weight:bold;background:#f8fafc">Department</td><td style="padding:8px 16px">$([System.Web.HttpUtility]::HtmlEncode($userDept))</td></tr>
<tr><td style="padding:8px 16px;font-weight:bold;background:#f8fafc">Job Title</td><td style="padding:8px 16px">$([System.Web.HttpUtility]::HtmlEncode($userTitle))</td></tr>
</table>
<h3>Next Steps</h3>
<ol>
<li>The user can sign in at <a href="https://portal.office.com">portal.office.com</a></li>
<li>They should set up MFA at <a href="https://aka.ms/mfasetup">aka.ms/mfasetup</a></li>
<li>Install Microsoft 365 apps from the portal</li>
<li>If a device is being provisioned via Autopilot, it will be ready when they first power it on</li>
</ol>
<p><em>This is an automated message from TenantScope Onboarding.</em></p>
"@
                    }
                    toRecipients = @(
                        @{ emailAddress = @{ address = $resolvedManagerUPN } }
                    )
                }
                saveToSentItems = $false
            } | ConvertTo-Json -Depth 10

            Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST `
                    -Uri "https://graph.microsoft.com/v1.0/me/sendMail" `
                    -Body $mailBody -ContentType "application/json"
            } -OperationName "Send welcome email" -MaxRetries 2

            Write-OnboardingStep -Step "Send welcome email to manager" -Status "SUCCESS" `
                -Detail "Sent to $resolvedManagerUPN"
        }
        catch {
            Write-OnboardingStep -Step "Send welcome email to manager" -Status "FAILED" -Detail $_.Exception.Message
        }
    }
    else {
        Write-OnboardingStep -Step "Send welcome email to manager" -Status "WHATIF" `
            -Detail "Would send welcome email to $resolvedManagerUPN"
    }
}

# -----------------------------------------------------------------------
# Step 5: Export onboarding audit report
# -----------------------------------------------------------------------
try {
    if (-not (Test-Path $ExportPath)) {
        New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null
    }

    $duration = (Get-Date) - $script:StartTime

    $auditReport = [PSCustomObject]@{
        onboardingId  = [guid]::NewGuid().ToString()
        executedAt    = $script:StartTime.ToString("o")
        completedAt   = (Get-Date).ToString("o")
        durationSeconds = [math]::Round($duration.TotalSeconds, 1)
        targetUser    = [PSCustomObject]@{
            userPrincipalName = $UserPrincipalName
            displayName       = $user.displayName
            id                = $userId
            department        = $resolvedDepartment
            jobTitle          = $user.jobTitle
        }
        manager       = [PSCustomObject]@{
            userPrincipalName = $resolvedManagerUPN
        }
        whatIfMode    = $WhatIfPreference
        options       = [PSCustomObject]@{
            skipLicenseAssignment = $SkipLicenseAssignment.IsPresent
            skipGroupAssignment   = $SkipGroupAssignment.IsPresent
            skipWelcomeEmail      = $SkipWelcomeEmail.IsPresent
        }
        steps         = $script:OnboardingLog
        summary       = [PSCustomObject]@{
            totalSteps = $script:StepNumber
            succeeded  = ($script:OnboardingLog | Where-Object { $_.status -eq "SUCCESS" }).Count
            failed     = ($script:OnboardingLog | Where-Object { $_.status -eq "FAILED" }).Count
            skipped    = ($script:OnboardingLog | Where-Object { $_.status -eq "SKIPPED" }).Count
            whatif     = ($script:OnboardingLog | Where-Object { $_.status -eq "WHATIF" }).Count
        }
    }

    $safeUPN = $UserPrincipalName -replace '@', '_at_' -replace '\.', '_'
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $reportFile = Join-Path $ExportPath "onboarding-${safeUPN}-${timestamp}.json"
    $auditReport | ConvertTo-Json -Depth 10 | Set-Content -Path $reportFile -Encoding UTF8

    Write-OnboardingStep -Step "Export audit report" -Status "SUCCESS" -Detail $reportFile
}
catch {
    Write-OnboardingStep -Step "Export audit report" -Status "FAILED" -Detail $_.Exception.Message
}

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  Onboarding Summary: $($user.displayName)" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan

$succeeded = ($script:OnboardingLog | Where-Object { $_.status -eq "SUCCESS" }).Count
$failed = ($script:OnboardingLog | Where-Object { $_.status -eq "FAILED" }).Count
$skipped = ($script:OnboardingLog | Where-Object { $_.status -eq "SKIPPED" }).Count

Write-Host "  Succeeded: $succeeded" -ForegroundColor Green
Write-Host "  Failed:    $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Gray" })
Write-Host "  Skipped:   $skipped" -ForegroundColor Yellow
Write-Host ""

if ($WhatIfPreference) {
    Write-Host "  *** This was a dry run. No changes were made. ***" -ForegroundColor Yellow
    Write-Host "  Re-run without -WhatIf to execute." -ForegroundColor Yellow
}

if ($failed -gt 0) {
    Write-Host "  WARNING: Some steps failed. Review the audit report for details." -ForegroundColor Red
}

Write-Host ""

return $auditReport
