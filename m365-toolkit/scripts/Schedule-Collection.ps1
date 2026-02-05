# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Sets up scheduled task for automated data collection.

.DESCRIPTION
    Creates a Windows Scheduled Task that runs the data collection script
    on a regular schedule. This enables automatic, periodic updates of
    tenant data without manual intervention.

    Note: For attended collection (interactive sign-in), you must be logged
    in when the task runs. For unattended collection, you'll need to set up
    an Azure AD app registration with appropriate permissions.

.PARAMETER TaskName
    Name of the scheduled task. Default: "M365-Toolkit-DataCollection"

.PARAMETER Schedule
    Frequency of collection. Options: Daily, Weekly, Hourly
    Default: Daily

.PARAMETER Time
    Time to run the task (24-hour format). Default: "06:00"

.PARAMETER Remove
    If specified, removes the scheduled task instead of creating it.

.EXAMPLE
    .\scripts\Schedule-Collection.ps1
    Creates a daily task running at 6:00 AM.

.EXAMPLE
    .\scripts\Schedule-Collection.ps1 -Schedule Weekly -Time "08:00"
    Creates a weekly task running at 8:00 AM on Mondays.

.EXAMPLE
    .\scripts\Schedule-Collection.ps1 -Remove
    Removes the scheduled task.
#>

#Requires -Version 7.0
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [Parameter()]
    [string]$TaskName = "M365-Toolkit-DataCollection",

    [Parameter()]
    [ValidateSet("Daily", "Weekly", "Hourly")]
    [string]$Schedule = "Daily",

    [Parameter()]
    [string]$Time = "06:00",

    [Parameter()]
    [switch]$Remove
)

# ============================================================================
# WINDOWS ONLY CHECK
# ============================================================================

if (-not ($IsWindows -or $env:OS -match "Windows")) {
    Write-Host "Error: Scheduled Tasks are only supported on Windows." -ForegroundColor Red
    Write-Host ""
    Write-Host "For Linux/macOS, use cron instead:" -ForegroundColor Yellow
    Write-Host "  crontab -e" -ForegroundColor White
    Write-Host '  0 6 * * * pwsh -File "/path/to/Invoke-DataCollection.ps1"' -ForegroundColor White
    exit 1
}

# ============================================================================
# CONFIGURATION
# ============================================================================

$scriptRoot = Split-Path $PSScriptRoot -Parent
$collectionScript = Join-Path $scriptRoot "Invoke-DataCollection.ps1"
$pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source

if (-not $pwshPath) {
    # Fall back to PowerShell 7 common locations
    $pwshPath = "C:\Program Files\PowerShell\7\pwsh.exe"
    if (-not (Test-Path $pwshPath)) {
        Write-Host "Error: PowerShell 7 (pwsh) not found" -ForegroundColor Red
        exit 1
    }
}

# ============================================================================
# REMOVE TASK
# ============================================================================

if ($Remove) {
    Write-Host "Removing scheduled task: $TaskName" -ForegroundColor Cyan

    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "  ✓ Task removed successfully" -ForegroundColor Green
    }
    else {
        Write-Host "  Task not found (may already be removed)" -ForegroundColor Yellow
    }

    exit 0
}

# ============================================================================
# VALIDATE PREREQUISITES
# ============================================================================

Write-Host "Setting up scheduled task for TenantScope" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $collectionScript)) {
    Write-Host "Error: Collection script not found: $collectionScript" -ForegroundColor Red
    exit 1
}

Write-Host "Configuration:" -ForegroundColor White
Write-Host "  Task Name:  $TaskName" -ForegroundColor Gray
Write-Host "  Schedule:   $Schedule" -ForegroundColor Gray
Write-Host "  Time:       $Time" -ForegroundColor Gray
Write-Host "  Script:     $collectionScript" -ForegroundColor Gray
Write-Host "  PowerShell: $pwshPath" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# CREATE TASK ACTION
# ============================================================================

# Action: Run PowerShell with the collection script
$actionArgs = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$collectionScript`"",
    "-SkipDashboard"  # Don't try to open dashboard in scheduled run
)

$action = New-ScheduledTaskAction -Execute $pwshPath -Argument ($actionArgs -join " ") -WorkingDirectory $scriptRoot

# ============================================================================
# CREATE TASK TRIGGER
# ============================================================================

# Parse time
$timeParts = $Time -split ":"
$hours = [int]$timeParts[0]
$minutes = [int]$timeParts[1]
$startTime = (Get-Date -Hour $hours -Minute $minutes -Second 0)

switch ($Schedule) {
    "Daily" {
        $trigger = New-ScheduledTaskTrigger -Daily -At $startTime
    }
    "Weekly" {
        $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At $startTime
    }
    "Hourly" {
        $trigger = New-ScheduledTaskTrigger -Once -At $startTime -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 365)
    }
}

# ============================================================================
# CREATE TASK SETTINGS
# ============================================================================

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

# ============================================================================
# REGISTER TASK
# ============================================================================

# Check for existing task
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "Updating existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
else {
    Write-Host "Creating new task..." -ForegroundColor Cyan
}

# Register the task
try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Automated data collection for TenantScope" `
        -User $env:USERNAME `
        -RunLevel Limited | Out-Null

    Write-Host ""
    Write-Host "✓ Scheduled task created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Task details:" -ForegroundColor Cyan
    Get-ScheduledTask -TaskName $TaskName | Format-List TaskName, State, Description

    Write-Host ""
    Write-Host "Important notes:" -ForegroundColor Yellow
    Write-Host "  - Task runs under your user account" -ForegroundColor White
    Write-Host "  - You must be logged in for interactive Graph authentication" -ForegroundColor White
    Write-Host "  - For unattended collection, configure app-only authentication" -ForegroundColor White
    Write-Host ""
    Write-Host "To test the task manually:" -ForegroundColor Cyan
    Write-Host "  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host ""
    Write-Host "To remove the task:" -ForegroundColor Cyan
    Write-Host "  .\scripts\Schedule-Collection.ps1 -Remove" -ForegroundColor White
}
catch {
    Write-Host "Error creating scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
