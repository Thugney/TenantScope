# ============================================================================
# TenantScope PowerShell Module
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    TenantScope - Microsoft 365 Tenant Intelligence Dashboard

.DESCRIPTION
    A comprehensive data collection and visualization toolkit for Microsoft 365
    tenant administration. Provides insights for IT admins, security teams,
    and management through an interactive dashboard.

.NOTES
    Version: 2.4.0
    Requires: PowerShell 7.0+, Microsoft Graph PowerShell SDK
#>

#Requires -Version 7.0

# ============================================================================
# MODULE INITIALIZATION
# ============================================================================

$script:ModuleRoot = $PSScriptRoot

# Import shared utilities
. "$script:ModuleRoot\lib\CollectorBase.ps1"

# ============================================================================
# PUBLIC FUNCTIONS
# ============================================================================

function Invoke-TenantScopeCollection {
    <#
    .SYNOPSIS
        Runs the TenantScope data collection process.

    .DESCRIPTION
        Main entry point for collecting Microsoft 365 tenant data.
        Orchestrates all collectors, handles authentication, and generates
        the data files for the dashboard.

    .PARAMETER ConfigPath
        Path to the configuration JSON file. Defaults to ./config.json.

    .PARAMETER SkipDashboard
        If specified, skips opening the dashboard after collection.

    .PARAMETER CollectorsToRun
        Optional array of specific collector names to run.

    .EXAMPLE
        Invoke-TenantScopeCollection

    .EXAMPLE
        Invoke-TenantScopeCollection -CollectorsToRun @("UserData", "DeviceData")
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$ConfigPath = (Join-Path $script:ModuleRoot "config.json"),

        [Parameter()]
        [switch]$SkipDashboard,

        [Parameter()]
        [string[]]$CollectorsToRun
    )

    $scriptPath = Join-Path $script:ModuleRoot "Invoke-DataCollection.ps1"

    $params = @{
        ConfigPath = $ConfigPath
    }

    if ($SkipDashboard) {
        $params.SkipDashboard = $true
    }

    if ($CollectorsToRun) {
        $params.CollectorsToRun = $CollectorsToRun
    }

    & $scriptPath @params
}

function Start-TenantScopeCollection {
    <#
    .SYNOPSIS
        Alias for Invoke-TenantScopeCollection with simplified interface.

    .DESCRIPTION
        Starts the data collection process with sensible defaults.

    .PARAMETER Quick
        If specified, runs only essential collectors for faster execution.

    .EXAMPLE
        Start-TenantScopeCollection

    .EXAMPLE
        Start-TenantScopeCollection -Quick
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [switch]$Quick
    )

    if ($Quick) {
        $essentialCollectors = @(
            "UserData", "LicenseData", "DeviceData", "MFAData",
            "AdminRoleData", "DefenderData", "SecureScoreData"
        )
        Invoke-TenantScopeCollection -CollectorsToRun $essentialCollectors -SkipDashboard
    }
    else {
        Invoke-TenantScopeCollection
    }
}

function Get-TenantScopeConfig {
    <#
    .SYNOPSIS
        Retrieves the current TenantScope configuration.

    .PARAMETER ConfigPath
        Path to the configuration file.

    .OUTPUTS
        Hashtable containing the configuration.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$ConfigPath = (Join-Path $script:ModuleRoot "config.json")
    )

    if (-not (Test-Path $ConfigPath)) {
        throw "Configuration file not found: $ConfigPath"
    }

    return Get-Content $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
}

function Test-TenantScopeConfig {
    <#
    .SYNOPSIS
        Validates the TenantScope configuration file.

    .PARAMETER ConfigPath
        Path to the configuration file to validate.

    .OUTPUTS
        Boolean indicating if configuration is valid.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$ConfigPath = (Join-Path $script:ModuleRoot "config.json")
    )

    try {
        $config = Get-TenantScopeConfig -ConfigPath $ConfigPath

        # Validate required fields
        $requiredFields = @("tenantId", "domains", "thresholds", "collection")
        foreach ($field in $requiredFields) {
            if (-not $config.ContainsKey($field)) {
                Write-Warning "Missing required field: $field"
                return $false
            }
        }

        # Validate tenant ID format
        try {
            [guid]::Parse($config.tenantId) | Out-Null
        }
        catch {
            Write-Warning "Invalid tenantId format"
            return $false
        }

        if ($config.tenantId -eq "00000000-0000-0000-0000-000000000000") {
            Write-Warning "Tenant ID is placeholder value - please configure with actual tenant ID"
            return $false
        }

        Write-Host "Configuration is valid" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Warning "Configuration validation failed: $($_.Exception.Message)"
        return $false
    }
}

# ============================================================================
# ALIASES
# ============================================================================

Set-Alias -Name Collect-TenantData -Value Invoke-TenantScopeCollection

# ============================================================================
# MODULE EXPORTS
# ============================================================================

Export-ModuleMember -Function @(
    'Invoke-TenantScopeCollection',
    'Start-TenantScopeCollection',
    'Get-TenantScopeConfig',
    'Test-TenantScopeConfig',
    # Re-export utility functions from CollectorBase
    'Invoke-GraphWithRetry',
    'Get-DaysSinceDate',
    'Get-DaysUntilDate',
    'Format-IsoDate',
    'Get-DomainClassification',
    'Get-SourceDomain',
    'Get-ActivityStatus',
    'Get-CertificateStatus',
    'New-CollectorResult',
    'Write-CollectorProgress',
    'Save-CollectorData',
    'Get-SimplifiedOS',
    'Get-WindowsLifecycleInfo'
) -Alias @(
    'Collect-TenantData'
)

Write-Verbose "TenantScope module loaded from $script:ModuleRoot"
