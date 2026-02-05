# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Builds the dashboard by copying data files and optionally opening in browser.

.DESCRIPTION
    This script prepares the dashboard for viewing by:
    1. Copying JSON data files from data/ to dashboard/data/
    2. Optionally using sample data for testing
    3. Opening the dashboard in the default browser

.PARAMETER UseSampleData
    If specified, copies sample data from data/sample/ instead of live data.
    Useful for testing the dashboard without running data collection.

.PARAMETER NoBrowser
    If specified, skips opening the dashboard in the browser.

.PARAMETER DataPath
    Custom path to the data directory. Defaults to ./data

.EXAMPLE
    .\scripts\Build-Dashboard.ps1
    Copies live data and opens dashboard.

.EXAMPLE
    .\scripts\Build-Dashboard.ps1 -UseSampleData
    Copies sample data and opens dashboard.

.EXAMPLE
    .\scripts\Build-Dashboard.ps1 -NoBrowser
    Copies data without opening browser.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$UseSampleData,

    [Parameter()]
    [switch]$NoBrowser,

    [Parameter()]
    [string]$DataPath
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$scriptRoot = Split-Path $PSScriptRoot -Parent
$dashboardPath = Join-Path $scriptRoot "dashboard"
$dashboardDataPath = Join-Path $dashboardPath "data"

# Determine source data path
if ($UseSampleData) {
    $sourceDataPath = Join-Path $scriptRoot "data" "sample"
    Write-Host "Using sample data from: $sourceDataPath" -ForegroundColor Cyan
}
elseif ($DataPath) {
    $sourceDataPath = $DataPath
    Write-Host "Using custom data path: $sourceDataPath" -ForegroundColor Cyan
}
else {
    $sourceDataPath = Join-Path $scriptRoot "data"
    Write-Host "Using collected data from: $sourceDataPath" -ForegroundColor Cyan
}

# ============================================================================
# VALIDATION
# ============================================================================

# Check if source data exists
if (-not (Test-Path $sourceDataPath)) {
    Write-Host "Error: Data directory not found: $sourceDataPath" -ForegroundColor Red

    if (-not $UseSampleData) {
        Write-Host ""
        Write-Host "No collected data found. Options:" -ForegroundColor Yellow
        Write-Host "  1. Run data collection: .\Invoke-DataCollection.ps1" -ForegroundColor White
        Write-Host "  2. Use sample data: .\scripts\Build-Dashboard.ps1 -UseSampleData" -ForegroundColor White
    }

    exit 1
}

# Check if dashboard exists
if (-not (Test-Path $dashboardPath)) {
    Write-Host "Error: Dashboard directory not found: $dashboardPath" -ForegroundColor Red
    exit 1
}

# ============================================================================
# COPY DATA FILES
# ============================================================================

Write-Host ""
Write-Host "Copying data files to dashboard..." -ForegroundColor Cyan

# Create dashboard data directory if it doesn't exist
if (-not (Test-Path $dashboardDataPath)) {
    New-Item -ItemType Directory -Path $dashboardDataPath -Force | Out-Null
    Write-Host "  Created: $dashboardDataPath" -ForegroundColor Gray
}

# Define data files to copy
$dataFiles = @(
    "users.json",
    "license-skus.json",
    "guests.json",
    "mfa-status.json",
    "admin-roles.json",
    "risky-signins.json",
    "devices.json",
    "autopilot.json",
    "defender-alerts.json",
    "enterprise-apps.json",
    "audit-logs.json",
    "pim-activity.json",
    "teams.json",
    "sharepoint-sites.json",
    "collection-metadata.json",
    "trend-history.json",
    "secure-score.json"
)

# Copy each file
$copiedCount = 0
$missingFiles = @()

foreach ($file in $dataFiles) {
    $sourcePath = Join-Path $sourceDataPath $file
    $destPath = Join-Path $dashboardDataPath $file

    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $destPath -Force
        Write-Host "  ✓ $file" -ForegroundColor Green
        $copiedCount++
    }
    else {
        Write-Host "  ⚠ $file (not found)" -ForegroundColor Yellow
        $missingFiles += $file

        # Create empty JSON file to prevent dashboard errors
        "[]" | Set-Content -Path $destPath -Encoding UTF8
    }
}

Write-Host ""
Write-Host "Copied $copiedCount of $($dataFiles.Count) data files" -ForegroundColor Cyan

if ($missingFiles.Count -gt 0) {
    Write-Host "Missing files (empty placeholders created): $($missingFiles -join ', ')" -ForegroundColor Yellow
}

# ============================================================================
# GENERATE JAVASCRIPT DATA BUNDLE
# Embeds all JSON data directly into a JS file so the dashboard works
# when opened as a local file (file:// protocol) without CORS issues.
# ============================================================================

Write-Host ""
Write-Host "Generating data bundle for local file access..." -ForegroundColor Cyan

$bundlePath = Join-Path $dashboardPath "js" "data-bundle.js"

# Build the bundle content by reading each JSON file
$bundleLines = @()
$bundleLines += "// Auto-generated by Build-Dashboard.ps1 - DO NOT EDIT"
$bundleLines += "// Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$bundleLines += "window.__M365_DATA = {};"

# Map of JS property names to JSON file names
$bundleMap = @{
    "users"          = "users.json"
    "licenseSkus"    = "license-skus.json"
    "guests"         = "guests.json"
    "mfaStatus"      = "mfa-status.json"
    "adminRoles"     = "admin-roles.json"
    "riskySignins"   = "risky-signins.json"
    "devices"        = "devices.json"
    "autopilot"      = "autopilot.json"
    "defenderAlerts"  = "defender-alerts.json"
    "enterpriseApps"  = "enterprise-apps.json"
    "auditLogs"       = "audit-logs.json"
    "pimActivity"     = "pim-activity.json"
    "teams"           = "teams.json"
    "sharepointSites" = "sharepoint-sites.json"
    "metadata"        = "collection-metadata.json"
    "trendHistory"    = "trend-history.json"
    "secureScore"     = "secure-score.json"
}

foreach ($entry in $bundleMap.GetEnumerator()) {
    $jsonFile = Join-Path $dashboardDataPath $entry.Value
    if (Test-Path $jsonFile) {
        $jsonContent = Get-Content -Path $jsonFile -Raw -Encoding UTF8
        $bundleLines += "window.__M365_DATA[`"$($entry.Key)`"] = $jsonContent;"
    }
    else {
        if ($entry.Key -eq "metadata") {
            $bundleLines += "window.__M365_DATA[`"$($entry.Key)`"] = null;"
        }
        else {
            $bundleLines += "window.__M365_DATA[`"$($entry.Key)`"] = [];"
        }
    }
}

$bundleLines -join "`n" | Set-Content -Path $bundlePath -Encoding UTF8
Write-Host "  ✓ Data bundle generated: $bundlePath" -ForegroundColor Green

# ============================================================================
# OPEN DASHBOARD
# ============================================================================

if (-not $NoBrowser) {
    Write-Host ""
    Write-Host "Opening dashboard in browser..." -ForegroundColor Cyan

    $indexPath = Join-Path $dashboardPath "index.html"

    if (Test-Path $indexPath) {
        # Convert to file:// URL
        $fileUrl = "file:///$($indexPath -replace '\\', '/')"

        # Open in default browser based on platform
        if ($IsWindows -or $env:OS -match "Windows") {
            Start-Process $fileUrl
        }
        elseif ($IsMacOS) {
            & open $fileUrl
        }
        elseif ($IsLinux) {
            & xdg-open $fileUrl 2>/dev/null || & sensible-browser $fileUrl 2>/dev/null || Write-Host "Please open manually: $fileUrl" -ForegroundColor Yellow
        }

        Write-Host "  Dashboard opened at: $fileUrl" -ForegroundColor Green
    }
    else {
        Write-Host "  Error: index.html not found at $indexPath" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Dashboard build complete!" -ForegroundColor Green
Write-Host ""
