# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Installs prerequisites for the M365 Tenant Toolkit.

.DESCRIPTION
    This script installs the Microsoft Graph PowerShell SDK module required
    to run the M365 Tenant Toolkit data collectors. It performs the following:

    1. Verifies PowerShell 7.0 or later is installed
    2. Installs or updates the Microsoft.Graph module from PSGallery
    3. Verifies required sub-modules are available
    4. Creates the data directory structure
    5. Sets up a .gitignore for the data directory

    The script uses CurrentUser scope for installation, which does not require
    administrator privileges.

.PARAMETER Force
    If specified, reinstalls the Microsoft.Graph module even if already present.

.OUTPUTS
    Displays installation progress and status to the console.
    Creates data/ directory and data/.gitignore if they don't exist.

.EXAMPLE
    .\Install-Prerequisites.ps1
    Checks for and installs prerequisites if needed.

.EXAMPLE
    .\Install-Prerequisites.ps1 -Force
    Forces reinstallation of the Microsoft.Graph module.

.NOTES
    Requires: PowerShell 7.0 or later
    Run this script before using Invoke-DataCollection.ps1
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n>> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "   [OK] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "   [WARN] $Message" -ForegroundColor Yellow
}

function Write-Failure {
    param([string]$Message)
    Write-Host "   [FAIL] $Message" -ForegroundColor Red
}

# Header
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  M365 Tenant Toolkit - Prerequisites  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check PowerShell version
Write-Step "Checking PowerShell version..."
$psVersion = $PSVersionTable.PSVersion
if ($psVersion.Major -ge 7) {
    Write-Success "PowerShell $($psVersion.Major).$($psVersion.Minor) detected"
} else {
    Write-Failure "PowerShell 7.0 or later is required. Current version: $psVersion"
    Write-Host "`nPlease install PowerShell 7 from: https://aka.ms/powershell" -ForegroundColor Yellow
    exit 1
}

# Check if Microsoft.Graph module is installed
Write-Step "Checking for Microsoft Graph PowerShell SDK..."
$graphModule = Get-Module -Name Microsoft.Graph -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1

if ($graphModule -and -not $Force) {
    Write-Success "Microsoft.Graph module v$($graphModule.Version) is already installed"
    $updateChoice = Read-Host "   Would you like to check for updates? (y/N)"
    if ($updateChoice -eq 'y' -or $updateChoice -eq 'Y') {
        Write-Step "Checking for updates..."
        try {
            $onlineModule = Find-Module -Name Microsoft.Graph -ErrorAction SilentlyContinue
            if ($onlineModule.Version -gt $graphModule.Version) {
                Write-Host "   New version available: $($onlineModule.Version)" -ForegroundColor Yellow
                $upgradeChoice = Read-Host "   Would you like to upgrade? (y/N)"
                if ($upgradeChoice -eq 'y' -or $upgradeChoice -eq 'Y') {
                    Write-Step "Upgrading Microsoft.Graph module..."
                    Update-Module -Name Microsoft.Graph -Force
                    Write-Success "Microsoft.Graph module upgraded to v$($onlineModule.Version)"
                }
            } else {
                Write-Success "Microsoft.Graph module is up to date"
            }
        } catch {
            Write-Warning "Could not check for updates: $($_.Exception.Message)"
        }
    }
} else {
    Write-Step "Installing Microsoft Graph PowerShell SDK..."
    Write-Host "   This may take several minutes..." -ForegroundColor Gray

    try {
        # Set TLS 1.2 for PowerShell Gallery
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

        # Install the module for current user (doesn't require admin)
        Install-Module -Name Microsoft.Graph -Scope CurrentUser -Repository PSGallery -Force -AllowClobber

        # Verify installation
        $installedModule = Get-Module -Name Microsoft.Graph -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
        if ($installedModule) {
            Write-Success "Microsoft.Graph module v$($installedModule.Version) installed successfully"
        } else {
            Write-Failure "Module installation could not be verified"
            exit 1
        }
    } catch {
        Write-Failure "Failed to install Microsoft.Graph module"
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "`n   Try running PowerShell as Administrator or check your internet connection." -ForegroundColor Yellow
        exit 1
    }
}

# Verify required sub-modules
Write-Step "Verifying required sub-modules..."
$requiredSubModules = @(
    'Microsoft.Graph.Authentication',
    'Microsoft.Graph.Users',
    'Microsoft.Graph.Identity.DirectoryManagement',
    'Microsoft.Graph.Identity.SignIns',
    'Microsoft.Graph.Reports',
    'Microsoft.Graph.DeviceManagement',
    'Microsoft.Graph.Security'
)

$missingModules = @()
foreach ($subModule in $requiredSubModules) {
    $module = Get-Module -Name $subModule -ListAvailable
    if ($module) {
        Write-Host "   [OK] $subModule" -ForegroundColor Green
    } else {
        Write-Host "   [--] $subModule (will be loaded on demand)" -ForegroundColor Gray
        $missingModules += $subModule
    }
}

if ($missingModules.Count -gt 0) {
    Write-Host "`n   Note: Some sub-modules will be installed automatically when first used." -ForegroundColor Gray
}

# Create data directory if it doesn't exist
Write-Step "Checking data directory..."
$scriptPath = $PSScriptRoot
$dataPath = Join-Path -Path $scriptPath -ChildPath "data"
if (-not (Test-Path -Path $dataPath)) {
    New-Item -Path $dataPath -ItemType Directory -Force | Out-Null
    Write-Success "Created data directory: $dataPath"
} else {
    Write-Success "Data directory exists: $dataPath"
}

# Create .gitignore for data directory
$gitignorePath = Join-Path -Path $dataPath -ChildPath ".gitignore"
if (-not (Test-Path -Path $gitignorePath)) {
    @"
# Ignore all collected data files
*.json
!.gitignore
"@ | Out-File -FilePath $gitignorePath -Encoding utf8
    Write-Success "Created .gitignore in data directory"
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Prerequisites installation complete  " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Edit config.json with your tenant ID" -ForegroundColor White
Write-Host "  2. Run Invoke-DataCollection.ps1 to collect data" -ForegroundColor White
Write-Host "  3. Open dashboard/index.html to view results" -ForegroundColor White
Write-Host ""
Write-Host "Required Graph Permissions (delegated):" -ForegroundColor Cyan
Write-Host "  - User.Read.All" -ForegroundColor Gray
Write-Host "  - Directory.Read.All" -ForegroundColor Gray
Write-Host "  - AuditLog.Read.All" -ForegroundColor Gray
Write-Host "  - Reports.Read.All" -ForegroundColor Gray
Write-Host "  - DeviceManagementManagedDevices.Read.All" -ForegroundColor Gray
Write-Host "  - DeviceManagementConfiguration.Read.All" -ForegroundColor Gray
Write-Host "  - SecurityEvents.Read.All" -ForegroundColor Gray
Write-Host "  - IdentityRiskyUser.Read.All" -ForegroundColor Gray
Write-Host "  - IdentityRiskEvent.Read.All" -ForegroundColor Gray
Write-Host "  - RoleManagement.Read.Directory" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: You must have at minimum Global Reader role in Entra ID." -ForegroundColor Yellow
Write-Host "      For Intune data, Intune Administrator or Read-Only role is needed." -ForegroundColor Yellow
Write-Host ""
