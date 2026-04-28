# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Runs data collection across multiple tenants for MSP scenarios.

.DESCRIPTION
    This script enables Managed Service Providers (MSPs) and multi-tenant
    administrators to collect data from multiple Microsoft 365 tenants
    in a single execution.

    Features:
    - Sequential or parallel tenant collection
    - Per-tenant output directories
    - Consolidated summary report
    - Failure isolation (one tenant failure doesn't stop others)
    - Resume capability for interrupted runs

.PARAMETER TenantsFile
    Path to a JSON file containing tenant configurations.
    Format: [{ "tenantId": "...", "name": "...", "authType": "..." }, ...]

.PARAMETER Tenants
    Array of tenant IDs to collect (alternative to TenantsFile).

.PARAMETER OutputRoot
    Root directory for tenant outputs. Each tenant gets a subdirectory.
    Defaults to ./data/tenants

.PARAMETER Parallel
    If specified, runs tenant collections in parallel (max 3 concurrent).

.PARAMETER MaxConcurrent
    Maximum number of concurrent tenant collections when -Parallel is used.
    Defaults to 3.

.PARAMETER ResumeFrom
    Resume collection from a specific tenant (by name or index).

.PARAMETER SkipDashboard
    If specified, skips opening the consolidated dashboard.

.EXAMPLE
    .\Invoke-MultiTenantCollection.ps1 -TenantsFile .\tenants.json
    Collects from all tenants defined in tenants.json.

.EXAMPLE
    .\Invoke-MultiTenantCollection.ps1 -Tenants @("tenant1-guid", "tenant2-guid")
    Collects from specific tenant IDs using interactive auth.

.EXAMPLE
    .\Invoke-MultiTenantCollection.ps1 -TenantsFile .\tenants.json -Parallel -MaxConcurrent 5
    Runs collections in parallel with up to 5 concurrent jobs.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(ParameterSetName = "File")]
    [string]$TenantsFile,

    [Parameter(ParameterSetName = "Inline")]
    [string[]]$Tenants,

    [Parameter()]
    [string]$OutputRoot,

    [Parameter()]
    [switch]$Parallel,

    [Parameter()]
    [int]$MaxConcurrent = 3,

    [Parameter()]
    [string]$ResumeFrom,

    [Parameter()]
    [switch]$SkipDashboard
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$scriptRoot = $PSScriptRoot
$defaultOutputRoot = Join-Path $scriptRoot "data" "tenants"

if (-not $OutputRoot) {
    $OutputRoot = $defaultOutputRoot
}

# Create output root if needed
if (-not (Test-Path $OutputRoot)) {
    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-TenantConfig {
    param([string]$TenantsFilePath, [string[]]$TenantIds)

    $configs = @()

    if ($TenantsFilePath -and (Test-Path $TenantsFilePath)) {
        $fileContent = Get-Content $TenantsFilePath -Raw | ConvertFrom-Json
        foreach ($tenant in $fileContent) {
            $configs += @{
                TenantId = $tenant.tenantId
                Name = if ($tenant.name) { $tenant.name } else { $tenant.tenantId.Substring(0, 8) }
                AuthType = if ($tenant.authType) { $tenant.authType } else { "delegated" }
                ClientId = $tenant.clientId
                ClientSecret = $tenant.clientSecret
                CertificatePath = $tenant.certificatePath
            }
        }
    }
    elseif ($TenantIds) {
        foreach ($tenantId in $TenantIds) {
            $configs += @{
                TenantId = $tenantId
                Name = $tenantId.Substring(0, 8)
                AuthType = "delegated"
            }
        }
    }
    else {
        throw "Either -TenantsFile or -Tenants must be specified"
    }

    return $configs
}

function Invoke-TenantCollection {
    param(
        [hashtable]$TenantConfig,
        [string]$OutputPath,
        [int]$Index,
        [int]$Total
    )

    $tenantName = $TenantConfig.Name
    $tenantId = $TenantConfig.TenantId

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Tenant $Index of ${Total}: $tenantName" -ForegroundColor Cyan
    Write-Host "  ID: $tenantId" -ForegroundColor Gray
    Write-Host "============================================================" -ForegroundColor Cyan

    $result = @{
        TenantId = $tenantId
        Name = $tenantName
        Success = $false
        StartTime = Get-Date
        EndTime = $null
        Duration = $null
        Errors = @()
        CollectedItems = 0
    }

    try {
        # Create tenant output directory
        $tenantOutputPath = Join-Path $OutputPath $tenantName
        if (-not (Test-Path $tenantOutputPath)) {
            New-Item -ItemType Directory -Path $tenantOutputPath -Force | Out-Null
        }

        # Create temporary config for this tenant
        $tempConfig = Join-Path $tenantOutputPath "config.json"
        $configContent = @{
            tenantId = $tenantId
            authType = $TenantConfig.AuthType
            clientId = $TenantConfig.ClientId
            clientSecret = $TenantConfig.ClientSecret
            certificatePath = $TenantConfig.CertificatePath
        }
        $configContent | ConvertTo-Json -Depth 10 | Set-Content $tempConfig -Encoding UTF8

        # Run collection
        $collectionScript = Join-Path $scriptRoot "Invoke-DataCollection.ps1"
        $collectionArgs = @(
            "-ConfigPath", $tempConfig,
            "-DataPath", $tenantOutputPath,
            "-NoBrowser"
        )

        Write-Host "  Starting collection..." -ForegroundColor White
        $collectionResult = & $collectionScript @collectionArgs

        # Check results
        $metadataPath = Join-Path $tenantOutputPath "collection-metadata.json"
        if (Test-Path $metadataPath) {
            $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
            $result.Success = $metadata.success -eq $true
            $result.CollectedItems = ($metadata.collectors | Where-Object { $_.success }).Count
            if ($metadata.errors) {
                $result.Errors = $metadata.errors
            }
        }
        else {
            $result.Errors = @("No collection metadata found")
        }

        # Clean up temp config
        Remove-Item $tempConfig -Force -ErrorAction SilentlyContinue
    }
    catch {
        $result.Errors = @($_.Exception.Message)
        Write-Host "  [X] Collection failed: $($_.Exception.Message)" -ForegroundColor Red
    }

    $result.EndTime = Get-Date
    $result.Duration = ($result.EndTime - $result.StartTime).TotalSeconds

    if ($result.Success) {
        Write-Host "  [OK] Completed in $("{0:N1}" -f $result.Duration)s - $($result.CollectedItems) collectors" -ForegroundColor Green
    }
    else {
        Write-Host "  [X] Failed: $($result.Errors -join '; ')" -ForegroundColor Red
    }

    return $result
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  TenantScope Multi-Tenant Collection" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Get tenant configurations
try {
    $tenantConfigs = Get-TenantConfig -TenantsFilePath $TenantsFile -TenantIds $Tenants
}
catch {
    Write-Host "Error loading tenant configurations: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($tenantConfigs.Count -eq 0) {
    Write-Host "No tenants found to collect. Check your configuration." -ForegroundColor Yellow
    exit 1
}

Write-Host "  Tenants to collect: $($tenantConfigs.Count)" -ForegroundColor Gray
Write-Host "  Output directory: $OutputRoot" -ForegroundColor Gray
Write-Host "  Mode: $(if ($Parallel) { "Parallel ($MaxConcurrent concurrent)" } else { "Sequential" })" -ForegroundColor Gray
Write-Host ""

# Handle resume
$startIndex = 0
if ($ResumeFrom) {
    for ($i = 0; $i -lt $tenantConfigs.Count; $i++) {
        if ($tenantConfigs[$i].Name -eq $ResumeFrom -or $tenantConfigs[$i].TenantId -eq $ResumeFrom -or $i.ToString() -eq $ResumeFrom) {
            $startIndex = $i
            Write-Host "  Resuming from tenant $($startIndex + 1): $($tenantConfigs[$i].Name)" -ForegroundColor Yellow
            break
        }
    }
}

# Collection timing
$collectionStart = Get-Date
$results = @()

# Run collections
if ($Parallel) {
    Write-Host "Running parallel collection..." -ForegroundColor Cyan

    $jobs = @()
    $pendingConfigs = @($tenantConfigs[$startIndex..($tenantConfigs.Count - 1)])
    $configIndex = $startIndex

    while ($pendingConfigs.Count -gt 0 -or $jobs.Count -gt 0) {
        # Start new jobs up to MaxConcurrent
        while ($jobs.Count -lt $MaxConcurrent -and $pendingConfigs.Count -gt 0) {
            $config = $pendingConfigs[0]
            $pendingConfigs = @($pendingConfigs[1..($pendingConfigs.Count - 1)])
            $configIndex++

            $job = Start-Job -ScriptBlock {
                param($ScriptRoot, $Config, $OutputPath, $Index, $Total)
                Set-Location $ScriptRoot
                . "$ScriptRoot\Invoke-MultiTenantCollection.ps1"
                Invoke-TenantCollection -TenantConfig $Config -OutputPath $OutputPath -Index $Index -Total $Total
            } -ArgumentList $scriptRoot, $config, $OutputRoot, $configIndex, $tenantConfigs.Count

            $jobs += @{ Job = $job; Config = $config; Index = $configIndex }
            Write-Host "  Started: $($config.Name)" -ForegroundColor Gray
        }

        # Check for completed jobs
        $completedJobs = @()
        foreach ($jobInfo in $jobs) {
            if ($jobInfo.Job.State -eq 'Completed') {
                $result = Receive-Job -Job $jobInfo.Job
                Remove-Job -Job $jobInfo.Job
                $results += $result
                $completedJobs += $jobInfo
            }
            elseif ($jobInfo.Job.State -eq 'Failed') {
                $error = $jobInfo.Job.ChildJobs[0].Error[0]
                $results += @{
                    TenantId = $jobInfo.Config.TenantId
                    Name = $jobInfo.Config.Name
                    Success = $false
                    Errors = @($error.ToString())
                }
                Remove-Job -Job $jobInfo.Job
                $completedJobs += $jobInfo
            }
        }

        # Remove completed jobs from tracking
        $jobs = @($jobs | Where-Object { $completedJobs -notcontains $_ })

        # Brief pause to prevent tight loop
        if ($jobs.Count -gt 0) {
            Start-Sleep -Seconds 2
        }
    }
}
else {
    # Sequential execution
    for ($i = $startIndex; $i -lt $tenantConfigs.Count; $i++) {
        $result = Invoke-TenantCollection `
            -TenantConfig $tenantConfigs[$i] `
            -OutputPath $OutputRoot `
            -Index ($i + 1) `
            -Total $tenantConfigs.Count

        $results += $result
    }
}

$collectionEnd = Get-Date
$totalDuration = ($collectionEnd - $collectionStart).TotalSeconds

# ============================================================================
# SUMMARY REPORT
# ============================================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Multi-Tenant Collection Summary" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$successCount = @($results | Where-Object { $_.Success }).Count
$failCount = @($results | Where-Object { -not $_.Success }).Count

Write-Host "  Total Tenants: $($results.Count)" -ForegroundColor Gray
Write-Host "  Successful: $successCount" -ForegroundColor $(if ($successCount -gt 0) { "Green" } else { "Gray" })
Write-Host "  Failed: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Gray" })
Write-Host "  Total Duration: $("{0:N1}" -f $totalDuration) seconds" -ForegroundColor Gray
Write-Host ""

# Per-tenant results
Write-Host "  Per-Tenant Results:" -ForegroundColor White
foreach ($result in $results) {
    $icon = if ($result.Success) { "[OK]" } else { "[X]" }
    $color = if ($result.Success) { "Green" } else { "Red" }
    Write-Host "    $icon $($result.Name): $("{0:N1}" -f $result.Duration)s" -ForegroundColor $color
    if (-not $result.Success -and $result.Errors) {
        foreach ($error in $result.Errors) {
            Write-Host "        Error: $error" -ForegroundColor Red
        }
    }
}

# Save summary report
$summaryPath = Join-Path $OutputRoot "multi-tenant-summary.json"
$summaryReport = @{
    collectionStart = $collectionStart.ToString("o")
    collectionEnd = $collectionEnd.ToString("o")
    totalDurationSeconds = $totalDuration
    totalTenants = $results.Count
    successfulTenants = $successCount
    failedTenants = $failCount
    tenants = $results
}
$summaryReport | ConvertTo-Json -Depth 10 | Set-Content $summaryPath -Encoding UTF8
Write-Host ""
Write-Host "  Summary saved to: $summaryPath" -ForegroundColor Gray

# ============================================================================
# CONSOLIDATED DASHBOARD (optional)
# ============================================================================

if (-not $SkipDashboard -and $successCount -gt 0) {
    Write-Host ""
    Write-Host "  Note: Multi-tenant dashboard consolidation is available." -ForegroundColor Cyan
    Write-Host "  To view a specific tenant's dashboard, run:" -ForegroundColor Gray
    Write-Host "    .\scripts\Build-Dashboard.ps1 -DataPath `"$OutputRoot\<tenant-name>`"" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Multi-Tenant Collection Complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
