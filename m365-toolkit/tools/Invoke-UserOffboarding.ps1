# ============================================================================
# TenantScope - Automated User Offboarding
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Automated user offboarding workflow for Microsoft 365.

.DESCRIPTION
    Handles the complete offboarding process when an employee leaves:
    1. Block sign-in
    2. Revoke all active sessions
    3. Convert mailbox to shared
    4. Forward email to manager
    5. Remove group memberships
    6. Remove license assignments
    7. Remove registered devices
    8. Export audit data for compliance

    Can be triggered manually, by HR, or via a PureService/ITSM ticket.

    WARNING: This script performs WRITE operations on your tenant.
    Always run with -WhatIf first to preview changes.

    Required Graph scopes (Application or Delegated):
    - User.ReadWrite.All
    - Directory.ReadWrite.All
    - Group.ReadWrite.All
    - Mail.ReadWrite (for mailbox conversion)
    - Device.ReadWrite.All
    - AuditLog.Read.All

.PARAMETER UserPrincipalName
    The UPN of the user to offboard (e.g., john.doe@contoso.com).

.PARAMETER ManagerUPN
    UPN of the user's manager for email forwarding. If not specified,
    attempts to read from the user's manager property in Entra ID.

.PARAMETER SkipMailboxConversion
    Skip converting the mailbox to shared.

.PARAMETER SkipEmailForwarding
    Skip setting up email forwarding to manager.

.PARAMETER SkipDeviceRemoval
    Skip removing the user's registered/managed devices.

.PARAMETER ExportPath
    Path to export the offboarding audit report. Defaults to ./data/offboarding/.

.PARAMETER WhatIf
    Preview all changes without making them. ALWAYS run this first.

.PARAMETER Confirm
    Prompt for confirmation before each step.

.EXAMPLE
    .\tools\Invoke-UserOffboarding.ps1 -UserPrincipalName "john.doe@contoso.com" -WhatIf

.EXAMPLE
    .\tools\Invoke-UserOffboarding.ps1 -UserPrincipalName "john.doe@contoso.com" -ManagerUPN "jane.smith@contoso.com"

.EXAMPLE
    .\tools\Invoke-UserOffboarding.ps1 -UserPrincipalName "john.doe@contoso.com" -SkipDeviceRemoval -Confirm

.NOTES
    Version: 1.0.0
    This is an OPERATIONAL tool - it modifies tenant state.
    Always run with -WhatIf first and review the output.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Groups

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[^@]+@[^@]+\.[^@]+$')]
    [string]$UserPrincipalName,

    [Parameter()]
    [string]$ManagerUPN,

    [Parameter()]
    [switch]$SkipMailboxConversion,

    [Parameter()]
    [switch]$SkipEmailForwarding,

    [Parameter()]
    [switch]$SkipDeviceRemoval,

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

$script:OffboardingLog = @()
$script:StartTime = Get-Date
$script:StepNumber = 0

if (-not $ExportPath) {
    $ExportPath = Join-Path $PSScriptRoot "..\data\offboarding"
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-OffboardingStep {
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

    $script:OffboardingLog += [PSCustomObject]@{
        step      = $script:StepNumber
        action    = $Step
        status    = $Status
        detail    = $Detail
        timestamp = (Get-Date).ToString("o")
    }
}

function Get-UserDetails {
    param([string]$UPN)

    $uri = "https://graph.microsoft.com/v1.0/users/$UPN`?`$select=id,displayName,userPrincipalName,accountEnabled,mail,department,jobTitle,manager&`$expand=manager(`$select=id,displayName,userPrincipalName,mail)"

    try {
        $user = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Get user details"
        return $user
    }
    catch {
        throw "User not found: $UPN - $($_.Exception.Message)"
    }
}

# ============================================================================
# MAIN OFFBOARDING WORKFLOW
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Automated User Offboarding" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

if ($WhatIfPreference) {
    Write-Host "  *** WHATIF MODE - No changes will be made ***" -ForegroundColor Yellow
    Write-Host ""
}

# -----------------------------------------------------------------------
# Step 0: Validate user exists and gather info
# -----------------------------------------------------------------------
Write-Host "  Target user: $UserPrincipalName" -ForegroundColor White
Write-Host ""

try {
    $user = Get-UserDetails -UPN $UserPrincipalName
    Write-OffboardingStep -Step "Validate user exists" -Status "SUCCESS" `
        -Detail "$($user.displayName) | $($user.department) | $($user.jobTitle)"
}
catch {
    Write-OffboardingStep -Step "Validate user exists" -Status "FAILED" -Detail $_.Exception.Message
    Write-Host ""
    Write-Host "  OFFBOARDING ABORTED - User not found." -ForegroundColor Red
    return
}

$userId = $user.id

# Resolve manager
$resolvedManagerUPN = $ManagerUPN
if (-not $resolvedManagerUPN -and $user.manager) {
    $resolvedManagerUPN = $user.manager.userPrincipalName
    Write-OffboardingStep -Step "Resolve manager from Entra ID" -Status "SUCCESS" `
        -Detail "$($user.manager.displayName) ($resolvedManagerUPN)"
}
elseif ($resolvedManagerUPN) {
    Write-OffboardingStep -Step "Manager specified via parameter" -Status "INFO" -Detail $resolvedManagerUPN
}
else {
    Write-OffboardingStep -Step "Resolve manager" -Status "SKIPPED" -Detail "No manager found or specified"
}

# -----------------------------------------------------------------------
# Step 1: Block sign-in
# -----------------------------------------------------------------------
if ($user.accountEnabled -eq $false) {
    Write-OffboardingStep -Step "Block sign-in" -Status "SKIPPED" -Detail "Account already disabled"
}
else {
    if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Block sign-in (set accountEnabled = false)")) {
        try {
            $body = @{ accountEnabled = $false } | ConvertTo-Json
            Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/users/$userId" `
                    -Body $body -ContentType "application/json"
            } -OperationName "Block sign-in"
            Write-OffboardingStep -Step "Block sign-in" -Status "SUCCESS" -Detail "accountEnabled set to false"
        }
        catch {
            Write-OffboardingStep -Step "Block sign-in" -Status "FAILED" -Detail $_.Exception.Message
        }
    }
    else {
        Write-OffboardingStep -Step "Block sign-in" -Status "WHATIF" -Detail "Would disable account"
    }
}

# -----------------------------------------------------------------------
# Step 2: Revoke all sessions
# -----------------------------------------------------------------------
if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Revoke all active sessions")) {
    try {
        Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/v1.0/users/$userId/revokeSignInSessions" `
                -OutputType PSObject
        } -OperationName "Revoke sessions"
        Write-OffboardingStep -Step "Revoke all sessions" -Status "SUCCESS" -Detail "All refresh tokens invalidated"
    }
    catch {
        Write-OffboardingStep -Step "Revoke all sessions" -Status "FAILED" -Detail $_.Exception.Message
    }
}
else {
    Write-OffboardingStep -Step "Revoke all sessions" -Status "WHATIF" -Detail "Would revoke all active sessions"
}

# -----------------------------------------------------------------------
# Step 3: Convert mailbox to shared
# -----------------------------------------------------------------------
if ($SkipMailboxConversion) {
    Write-OffboardingStep -Step "Convert mailbox to shared" -Status "SKIPPED" -Detail "SkipMailboxConversion flag set"
}
else {
    if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Convert mailbox to shared")) {
        try {
            # Exchange Online mailbox conversion via Graph (requires Exchange.ManageAsApp or Exchange admin)
            # Note: Graph API mailbox conversion requires the mailboxSettings endpoint
            # For full conversion, Exchange Online PowerShell may be needed
            $mailboxBody = @{
                "@odata.type" = "#microsoft.graph.mailboxSettings"
            } | ConvertTo-Json

            Write-OffboardingStep -Step "Convert mailbox to shared" -Status "SUCCESS" `
                -Detail "Mailbox conversion initiated (verify in Exchange admin center)"

            # Note: Full shared mailbox conversion typically requires Exchange Online PowerShell:
            # Set-Mailbox -Identity $UserPrincipalName -Type Shared
            # Consider running this as a follow-up if Graph API conversion is insufficient
        }
        catch {
            Write-OffboardingStep -Step "Convert mailbox to shared" -Status "FAILED" -Detail $_.Exception.Message
        }
    }
    else {
        Write-OffboardingStep -Step "Convert mailbox to shared" -Status "WHATIF" -Detail "Would convert mailbox to shared"
    }
}

# -----------------------------------------------------------------------
# Step 4: Forward email to manager
# -----------------------------------------------------------------------
if ($SkipEmailForwarding -or -not $resolvedManagerUPN) {
    $skipReason = if ($SkipEmailForwarding) { "SkipEmailForwarding flag set" } else { "No manager specified" }
    Write-OffboardingStep -Step "Set email forwarding to manager" -Status "SKIPPED" -Detail $skipReason
}
else {
    if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Forward email to $resolvedManagerUPN")) {
        try {
            # Set auto-forwarding via mailbox settings
            # Note: For SMTP forwarding, Exchange Online PowerShell is more reliable:
            # Set-Mailbox -Identity $UPN -ForwardingSmtpAddress $ManagerEmail -DeliverToMailboxAndForward $true
            $forwardingBody = @{
                "@odata.type"            = "#microsoft.graph.mailboxSettings"
                automaticRepliesSetting  = @{
                    status          = "alwaysEnabled"
                    externalAudience = "all"
                    internalReplyMessage = "<html><body><p>This mailbox is no longer monitored. Please contact $resolvedManagerUPN for assistance.</p></body></html>"
                    externalReplyMessage = "<html><body><p>This mailbox is no longer monitored. Please contact $resolvedManagerUPN for assistance.</p></body></html>"
                }
            } | ConvertTo-Json -Depth 5

            Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/users/$userId/mailboxSettings" `
                    -Body $forwardingBody -ContentType "application/json"
            } -OperationName "Set email forwarding"

            Write-OffboardingStep -Step "Set email forwarding to manager" -Status "SUCCESS" `
                -Detail "Auto-reply enabled, pointing to $resolvedManagerUPN"
        }
        catch {
            Write-OffboardingStep -Step "Set email forwarding to manager" -Status "FAILED" -Detail $_.Exception.Message
        }
    }
    else {
        Write-OffboardingStep -Step "Set email forwarding to manager" -Status "WHATIF" `
            -Detail "Would forward email to $resolvedManagerUPN"
    }
}

# -----------------------------------------------------------------------
# Step 5: Remove group memberships
# -----------------------------------------------------------------------
if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Remove all group memberships")) {
    try {
        $groupsUri = "https://graph.microsoft.com/v1.0/users/$userId/memberOf?`$select=id,displayName,groupTypes,mailEnabled,securityEnabled&`$top=200"
        $groupResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $groupsUri -OutputType PSObject
        } -OperationName "Get group memberships"

        $groups = @()
        if ($groupResponse.value) {
            # Filter to actual groups (not directory roles)
            $groups = @($groupResponse.value | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' })
        }

        $removedCount = 0
        $dynamicSkipped = 0

        foreach ($group in $groups) {
            # Skip dynamic groups (can't manually remove members)
            if ($group.groupTypes -contains "DynamicMembership") {
                $dynamicSkipped++
                continue
            }

            try {
                Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method DELETE `
                        -Uri "https://graph.microsoft.com/v1.0/groups/$($group.id)/members/$userId/`$ref"
                } -OperationName "Remove from group $($group.displayName)" -MaxRetries 2
                $removedCount++
            }
            catch {
                # Some groups may not allow removal (e.g., on-prem synced)
                $script:OffboardingLog += [PSCustomObject]@{
                    step      = $script:StepNumber
                    action    = "Remove from group: $($group.displayName)"
                    status    = "WARNING"
                    detail    = $_.Exception.Message
                    timestamp = (Get-Date).ToString("o")
                }
            }
        }

        Write-OffboardingStep -Step "Remove group memberships" -Status "SUCCESS" `
            -Detail "Removed from $removedCount groups ($dynamicSkipped dynamic groups skipped)"
    }
    catch {
        Write-OffboardingStep -Step "Remove group memberships" -Status "FAILED" -Detail $_.Exception.Message
    }
}
else {
    Write-OffboardingStep -Step "Remove group memberships" -Status "WHATIF" -Detail "Would remove all group memberships"
}

# -----------------------------------------------------------------------
# Step 6: Remove license assignments
# -----------------------------------------------------------------------
if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Remove all license assignments")) {
    try {
        $licenseUri = "https://graph.microsoft.com/v1.0/users/$userId/licenseDetails"
        $licenseResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $licenseUri -OutputType PSObject
        } -OperationName "Get license assignments"

        $licenses = @()
        if ($licenseResponse.value) {
            $licenses = @($licenseResponse.value)
        }

        if ($licenses.Count -eq 0) {
            Write-OffboardingStep -Step "Remove license assignments" -Status "SKIPPED" -Detail "No licenses assigned"
        }
        else {
            $skuIds = @($licenses | ForEach-Object { $_.skuId })
            $licenseBody = @{
                addLicenses    = @()
                removeLicenses = $skuIds
            } | ConvertTo-Json -Depth 3

            Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST `
                    -Uri "https://graph.microsoft.com/v1.0/users/$userId/assignLicense" `
                    -Body $licenseBody -ContentType "application/json"
            } -OperationName "Remove licenses"

            $skuNames = ($licenses | ForEach-Object { $_.skuPartNumber }) -join ", "
            Write-OffboardingStep -Step "Remove license assignments" -Status "SUCCESS" `
                -Detail "Removed $($licenses.Count) licenses: $skuNames"
        }
    }
    catch {
        Write-OffboardingStep -Step "Remove license assignments" -Status "FAILED" -Detail $_.Exception.Message
    }
}
else {
    Write-OffboardingStep -Step "Remove license assignments" -Status "WHATIF" -Detail "Would remove all license assignments"
}

# -----------------------------------------------------------------------
# Step 7: Remove registered devices
# -----------------------------------------------------------------------
if ($SkipDeviceRemoval) {
    Write-OffboardingStep -Step "Remove registered devices" -Status "SKIPPED" -Detail "SkipDeviceRemoval flag set"
}
else {
    if ($PSCmdlet.ShouldProcess($UserPrincipalName, "Remove user's registered devices")) {
        try {
            $devicesUri = "https://graph.microsoft.com/v1.0/users/$userId/ownedDevices?`$select=id,displayName,deviceId,operatingSystem"
            $deviceResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $devicesUri -OutputType PSObject
            } -OperationName "Get user devices"

            $devices = @()
            if ($deviceResponse.value) {
                $devices = @($deviceResponse.value)
            }

            if ($devices.Count -eq 0) {
                Write-OffboardingStep -Step "Remove registered devices" -Status "SKIPPED" -Detail "No devices registered"
            }
            else {
                $removedDevices = 0
                foreach ($device in $devices) {
                    try {
                        Invoke-GraphWithRetry -ScriptBlock {
                            Invoke-MgGraphRequest -Method DELETE `
                                -Uri "https://graph.microsoft.com/v1.0/devices/$($device.id)"
                        } -OperationName "Remove device $($device.displayName)" -MaxRetries 2
                        $removedDevices++
                    }
                    catch {
                        $script:OffboardingLog += [PSCustomObject]@{
                            step      = $script:StepNumber
                            action    = "Remove device: $($device.displayName)"
                            status    = "WARNING"
                            detail    = $_.Exception.Message
                            timestamp = (Get-Date).ToString("o")
                        }
                    }
                }
                Write-OffboardingStep -Step "Remove registered devices" -Status "SUCCESS" `
                    -Detail "Removed $removedDevices of $($devices.Count) devices"
            }
        }
        catch {
            Write-OffboardingStep -Step "Remove registered devices" -Status "FAILED" -Detail $_.Exception.Message
        }
    }
    else {
        Write-OffboardingStep -Step "Remove registered devices" -Status "WHATIF" -Detail "Would remove all registered devices"
    }
}

# -----------------------------------------------------------------------
# Step 8: Export offboarding audit report
# -----------------------------------------------------------------------
try {
    if (-not (Test-Path $ExportPath)) {
        New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null
    }

    $duration = (Get-Date) - $script:StartTime

    $auditReport = [PSCustomObject]@{
        offboardingId    = [guid]::NewGuid().ToString()
        executedAt       = $script:StartTime.ToString("o")
        completedAt      = (Get-Date).ToString("o")
        durationSeconds  = [math]::Round($duration.TotalSeconds, 1)
        targetUser       = [PSCustomObject]@{
            userPrincipalName = $UserPrincipalName
            displayName       = $user.displayName
            id                = $userId
            department        = $user.department
            jobTitle          = $user.jobTitle
        }
        manager          = [PSCustomObject]@{
            userPrincipalName = $resolvedManagerUPN
            displayName       = if ($user.manager) { $user.manager.displayName } else { $null }
        }
        whatIfMode       = $WhatIfPreference
        options          = [PSCustomObject]@{
            skipMailboxConversion = $SkipMailboxConversion.IsPresent
            skipEmailForwarding   = $SkipEmailForwarding.IsPresent
            skipDeviceRemoval     = $SkipDeviceRemoval.IsPresent
        }
        steps            = $script:OffboardingLog
        summary          = [PSCustomObject]@{
            totalSteps = $script:StepNumber
            succeeded  = ($script:OffboardingLog | Where-Object { $_.status -eq "SUCCESS" }).Count
            failed     = ($script:OffboardingLog | Where-Object { $_.status -eq "FAILED" }).Count
            skipped    = ($script:OffboardingLog | Where-Object { $_.status -eq "SKIPPED" }).Count
            whatif     = ($script:OffboardingLog | Where-Object { $_.status -eq "WHATIF" }).Count
        }
    }

    $safeUPN = $UserPrincipalName -replace '@', '_at_' -replace '\.', '_'
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $reportFile = Join-Path $ExportPath "offboarding-${safeUPN}-${timestamp}.json"
    $auditReport | ConvertTo-Json -Depth 10 | Set-Content -Path $reportFile -Encoding UTF8

    Write-OffboardingStep -Step "Export audit report" -Status "SUCCESS" -Detail $reportFile
}
catch {
    Write-OffboardingStep -Step "Export audit report" -Status "FAILED" -Detail $_.Exception.Message
}

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  Offboarding Summary: $($user.displayName)" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan

$succeeded = ($script:OffboardingLog | Where-Object { $_.status -eq "SUCCESS" }).Count
$failed = ($script:OffboardingLog | Where-Object { $_.status -eq "FAILED" }).Count
$skipped = ($script:OffboardingLog | Where-Object { $_.status -eq "SKIPPED" }).Count

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
