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

    For unattended execution, you must provide app registration credentials:
    - Certificate authentication (recommended): -ClientId and -CertificateThumbprint
    - Client secret authentication: -ClientId and -ClientSecret

    See docs/USAGE.md for app registration setup instructions.

.PARAMETER TaskName
    Name of the scheduled task. Default: "M365-Toolkit-DataCollection"

.PARAMETER Schedule
    Frequency of collection. Options: Daily, Weekly, Hourly
    Default: Daily

.PARAMETER Time
    Time to run the task (24-hour format). Default: "06:00"

.PARAMETER ClientId
    Application (client) ID from your Azure AD app registration.
    Required for unattended execution.

.PARAMETER CertificateThumbprint
    Certificate thumbprint for app-only authentication.
    The certificate must be installed in CurrentUser\My or LocalMachine\My.
    Recommended for production use.

.PARAMETER ClientSecret
    Client secret for app-only authentication.
    Less secure than certificate - secrets expire and can be leaked.

.PARAMETER Remove
    If specified, removes the scheduled task instead of creating it.

.EXAMPLE
    .\scripts\Schedule-Collection.ps1 -ClientId "00000000-..." -CertificateThumbprint "ABC123..."
    Creates a daily task using certificate authentication.

.EXAMPLE
    .\scripts\Schedule-Collection.ps1 -Schedule Weekly -Time "08:00" -ClientId "00000000-..." -ClientSecret "secret"
    Creates a weekly task using client secret authentication.

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
    [string]$ClientId,

    [Parameter()]
    [string]$CertificateThumbprint,

    [Parameter()]
    [string]$ClientSecret,

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
# VALIDATE AUTHENTICATION
# ============================================================================

$authMode = "None"
if ($ClientId -and $CertificateThumbprint) {
    $authMode = "Certificate"
}
elseif ($ClientId -and $ClientSecret) {
    $authMode = "ClientSecret"
}
elseif ($ClientId) {
    Write-Host "Error: -ClientId requires either -CertificateThumbprint or -ClientSecret" -ForegroundColor Red
    exit 1
}

if ($authMode -eq "None") {
    Write-Host ""
    Write-Host "WARNING: No app registration credentials provided." -ForegroundColor Yellow
    Write-Host "  Scheduled tasks require unattended authentication." -ForegroundColor Yellow
    Write-Host "  Without -ClientId and credentials, the task will fail." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  To set up app registration:" -ForegroundColor Cyan
    Write-Host "    1. Create an App Registration in Azure AD" -ForegroundColor White
    Write-Host "    2. Add API permissions (Application type, not Delegated)" -ForegroundColor White
    Write-Host "    3. Create a certificate or client secret" -ForegroundColor White
    Write-Host "    4. Run this script with -ClientId and credentials" -ForegroundColor White
    Write-Host ""
    Write-Host "  See docs/USAGE.md for detailed instructions." -ForegroundColor Gray
    Write-Host ""

    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "  Auth Mode:  $authMode" -ForegroundColor Gray

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

# Add authentication parameters if provided
if ($ClientId) {
    $actionArgs += "-ClientId", "`"$ClientId`""
}
if ($CertificateThumbprint) {
    $actionArgs += "-CertificateThumbprint", "`"$CertificateThumbprint`""
}
if ($ClientSecret) {
    # Note: Storing secrets in scheduled task arguments is not ideal
    # Consider using Windows Credential Manager or Azure Key Vault in production
    $actionArgs += "-ClientSecret", "`"$ClientSecret`""
}

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
    if ($authMode -eq "None") {
        Write-Host "Important notes:" -ForegroundColor Yellow
        Write-Host "  - Task runs under your user account" -ForegroundColor White
        Write-Host "  - You must be logged in for interactive Graph authentication" -ForegroundColor White
        Write-Host "  - For unattended collection, re-run with -ClientId and credentials" -ForegroundColor White
    }
    else {
        Write-Host "Authentication configured:" -ForegroundColor Green
        Write-Host "  - Mode: $authMode" -ForegroundColor White
        Write-Host "  - ClientId: $ClientId" -ForegroundColor White
        if ($CertificateThumbprint) {
            Write-Host "  - Certificate: $CertificateThumbprint" -ForegroundColor White
        }
        Write-Host "  - Task will run unattended (no login required)" -ForegroundColor Green
    }
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
