# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Exports TenantScope JSON data to CSV files for spreadsheet analysis.

.DESCRIPTION
    This script converts the collected JSON data files into CSV format,
    making them easy to import into Excel, Google Sheets, or other
    spreadsheet applications for further analysis.

    Supported exports:
    - Users (with MFA status, admin flags, activity)
    - Devices (with compliance, OS, last sync)
    - Groups (with member counts, types)
    - Guests (with activity, source domains)
    - Licenses (with usage, waste)
    - Alerts (Defender alerts)
    - Teams (with activity, ownership)
    - SharePoint Sites (with storage, sharing)

.PARAMETER DataPath
    Path to the data directory. Defaults to ./data

.PARAMETER OutputPath
    Path for CSV output. Defaults to ./exports

.PARAMETER ExportAll
    Export all available data types.

.PARAMETER ExportTypes
    Specific data types to export. Valid values:
    Users, Devices, Groups, Guests, Licenses, Alerts, Teams, SharePoint, All

.EXAMPLE
    .\scripts\Export-ToCsv.ps1
    Exports all data to ./exports folder.

.EXAMPLE
    .\scripts\Export-ToCsv.ps1 -ExportTypes Users,Devices
    Exports only users and devices.

.EXAMPLE
    .\scripts\Export-ToCsv.ps1 -OutputPath "C:\Reports"
    Exports all data to specified folder.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$DataPath,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [ValidateSet("Users", "Devices", "Groups", "Guests", "Licenses", "Alerts", "Teams", "SharePoint", "AdminRoles", "All")]
    [string[]]$ExportTypes = @("All")
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$scriptRoot = Split-Path $PSScriptRoot -Parent

if (-not $DataPath) {
    $DataPath = Join-Path $scriptRoot "data"
}

if (-not $OutputPath) {
    $OutputPath = Join-Path $scriptRoot "exports"
}

# Create output directory if needed
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    Write-Host "Created exports directory: $OutputPath" -ForegroundColor Cyan
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Export-JsonToCsv {
    param(
        [Parameter(Mandatory)]
        [string]$JsonPath,

        [Parameter(Mandatory)]
        [string]$CsvPath,

        [Parameter()]
        [string[]]$Properties,

        [Parameter()]
        [scriptblock]$TransformBlock
    )

    if (-not (Test-Path $JsonPath)) {
        Write-Host "  [!] Source file not found: $JsonPath" -ForegroundColor Yellow
        return $false
    }

    try {
        $data = Get-Content $JsonPath -Raw | ConvertFrom-Json

        # Check for error marker files
        if ($data._collectionError) {
            Write-Host "  [!] Source data contains collection error - skipping" -ForegroundColor Yellow
            return $false
        }

        if ($null -eq $data -or $data.Count -eq 0) {
            Write-Host "  [!] No data to export" -ForegroundColor Yellow
            return $false
        }

        # Apply transformation if provided
        if ($TransformBlock) {
            $data = $data | ForEach-Object { & $TransformBlock $_ }
        }

        # Select specific properties if provided
        if ($Properties) {
            $data = $data | Select-Object $Properties
        }

        # Export to CSV
        $data | Export-Csv -Path $CsvPath -NoTypeInformation -Encoding UTF8
        Write-Host "  [OK] Exported to: $CsvPath ($($data.Count) rows)" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "  [X] Export failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# ============================================================================
# EXPORT FUNCTIONS
# ============================================================================

function Export-Users {
    Write-Host ""
    Write-Host "Exporting Users..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "users.json"
    $csvPath = Join-Path $OutputPath "users.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($user)
        [PSCustomObject]@{
            Id = $user.id
            DisplayName = $user.displayName
            UserPrincipalName = $user.userPrincipalName
            Mail = $user.mail
            JobTitle = $user.jobTitle
            Department = $user.department
            Domain = $user.domain
            AccountEnabled = $user.accountEnabled
            MfaRegistered = $user.mfaRegistered
            IsInactive = $user.isInactive
            DaysSinceLastSignIn = $user.daysSinceLastSignIn
            CreatedDate = $user.createdDateTime
            LastSignInDate = $user.lastSignInDateTime
            Flags = ($user.flags -join "; ")
            LicenseCount = if ($user.assignedLicenses) { $user.assignedLicenses.Count } else { 0 }
        }
    }
}

function Export-Devices {
    Write-Host ""
    Write-Host "Exporting Devices..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "devices.json"
    $csvPath = Join-Path $OutputPath "devices.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($device)
        [PSCustomObject]@{
            Id = $device.id
            DeviceName = $device.deviceName
            UserPrincipalName = $device.userPrincipalName
            UserDisplayName = $device.userDisplayName
            OperatingSystem = $device.operatingSystem
            OsVersion = $device.osVersion
            ComplianceState = $device.complianceState
            IsManaged = $device.isManaged
            IsStale = $device.isStale
            DaysSinceLastSync = $device.daysSinceLastSync
            LastSyncDateTime = $device.lastSyncDateTime
            EnrolledDateTime = $device.enrolledDateTime
            Model = $device.model
            Manufacturer = $device.manufacturer
            SerialNumber = $device.serialNumber
            TotalStorageGB = $device.totalStorageSpaceInGB
            FreeStorageGB = $device.freeStorageSpaceInGB
            WindowsRelease = $device.windowsRelease
            WindowsSupported = $device.windowsSupported
        }
    }
}

function Export-Groups {
    Write-Host ""
    Write-Host "Exporting Groups..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "groups.json"
    $csvPath = Join-Path $OutputPath "groups.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($group)
        [PSCustomObject]@{
            Id = $group.id
            DisplayName = $group.displayName
            Description = $group.description
            Mail = $group.mail
            GroupType = $group.groupType
            MemberCount = $group.memberCount
            OwnerCount = $group.ownerCount
            GuestMemberCount = $group.guestMemberCount
            HasLicenses = $group.hasLicenses
            IsTeam = $group.isTeam
            CreatedDateTime = $group.createdDateTime
            SecurityEnabled = $group.securityEnabled
            MailEnabled = $group.mailEnabled
        }
    }
}

function Export-Guests {
    Write-Host ""
    Write-Host "Exporting Guests..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "guests.json"
    $csvPath = Join-Path $OutputPath "guests.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($guest)
        [PSCustomObject]@{
            Id = $guest.id
            DisplayName = $guest.displayName
            Mail = $guest.mail
            SourceDomain = $guest.sourceDomain
            CreationDate = $guest.creationDate
            LastSignInDate = $guest.lastSignInDate
            DaysSinceLastSignIn = $guest.daysSinceLastSignIn
            IsStale = $guest.isStale
            AccountEnabled = $guest.accountEnabled
            GroupMemberships = $guest.groupMembershipCount
        }
    }
}

function Export-Licenses {
    Write-Host ""
    Write-Host "Exporting Licenses..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "license-skus.json"
    $csvPath = Join-Path $OutputPath "licenses.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($sku)
        [PSCustomObject]@{
            SkuId = $sku.skuId
            SkuPartNumber = $sku.skuPartNumber
            DisplayName = $sku.displayName
            TotalLicenses = $sku.prepaidUnitsEnabled
            ConsumedLicenses = $sku.consumedUnits
            AvailableLicenses = $sku.availableUnits
            UtilizationPct = $sku.utilizationPct
            WastedLicenses = $sku.wastedLicenses
            WasteMonthlyCost = $sku.wasteMonthlyCost
            Status = $sku.status
        }
    }
}

function Export-Alerts {
    Write-Host ""
    Write-Host "Exporting Defender Alerts..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "defender-alerts.json"
    $csvPath = Join-Path $OutputPath "defender-alerts.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($alert)
        [PSCustomObject]@{
            Id = $alert.id
            Title = $alert.title
            Severity = $alert.severity
            Status = $alert.status
            Category = $alert.category
            CreatedDateTime = $alert.createdDateTime
            LastUpdatedDateTime = $alert.lastUpdatedDateTime
            DetectionSource = $alert.detectionSource
            ServiceSource = $alert.serviceSource
            DeviceName = if ($alert.devices) { ($alert.devices | Select-Object -First 1).deviceName } else { "" }
            UserPrincipalName = if ($alert.users) { ($alert.users | Select-Object -First 1).userPrincipalName } else { "" }
        }
    }
}

function Export-Teams {
    Write-Host ""
    Write-Host "Exporting Teams..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "teams.json"
    $csvPath = Join-Path $OutputPath "teams.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($team)
        [PSCustomObject]@{
            Id = $team.id
            DisplayName = $team.displayName
            Description = $team.description
            Visibility = $team.visibility
            MemberCount = $team.memberCount
            OwnerCount = $team.ownerCount
            GuestCount = $team.guestCount
            ChannelCount = $team.channelCount
            IsInactive = $team.isInactive
            IsArchived = $team.isArchived
            HasNoOwner = $team.hasNoOwner
            CreatedDateTime = $team.createdDateTime
            LastActivityDate = $team.lastActivityDate
        }
    }
}

function Export-SharePoint {
    Write-Host ""
    Write-Host "Exporting SharePoint Sites..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "sharepoint-sites.json"
    $csvPath = Join-Path $OutputPath "sharepoint-sites.csv"

    Export-JsonToCsv -JsonPath $jsonPath -CsvPath $csvPath -TransformBlock {
        param($site)
        [PSCustomObject]@{
            Id = $site.id
            DisplayName = $site.displayName
            WebUrl = $site.webUrl
            Template = $site.template
            StorageUsedGB = $site.storageUsedGB
            StorageQuotaGB = $site.storageQuotaGB
            StoragePct = $site.storagePct
            IsInactive = $site.isInactive
            IsPersonalSite = $site.isPersonalSite
            HasExternalSharing = $site.hasExternalSharing
            AnonymousLinkCount = $site.anonymousLinkCount
            LastActivityDate = $site.lastActivityDate
            CreatedDateTime = $site.createdDateTime
        }
    }
}

function Export-AdminRoles {
    Write-Host ""
    Write-Host "Exporting Admin Roles..." -ForegroundColor Cyan

    $jsonPath = Join-Path $DataPath "admin-roles.json"
    $csvPath = Join-Path $OutputPath "admin-roles.csv"

    if (-not (Test-Path $jsonPath)) {
        Write-Host "  [!] Source file not found: $jsonPath" -ForegroundColor Yellow
        return
    }

    try {
        $roles = Get-Content $jsonPath -Raw | ConvertFrom-Json

        if ($roles._collectionError) {
            Write-Host "  [!] Source data contains collection error - skipping" -ForegroundColor Yellow
            return
        }

        # Flatten role members into rows
        $rows = @()
        foreach ($role in $roles) {
            foreach ($member in $role.members) {
                $rows += [PSCustomObject]@{
                    RoleId = $role.id
                    RoleDisplayName = $role.displayName
                    RoleDescription = $role.description
                    IsBuiltIn = $role.isBuiltIn
                    MemberCount = $role.memberCount
                    MemberId = $member.id
                    MemberDisplayName = $member.displayName
                    MemberUserPrincipalName = $member.userPrincipalName
                    MemberType = $member.type
                }
            }

            # Include roles with no members
            if ($role.members.Count -eq 0) {
                $rows += [PSCustomObject]@{
                    RoleId = $role.id
                    RoleDisplayName = $role.displayName
                    RoleDescription = $role.description
                    IsBuiltIn = $role.isBuiltIn
                    MemberCount = 0
                    MemberId = ""
                    MemberDisplayName = ""
                    MemberUserPrincipalName = ""
                    MemberType = ""
                }
            }
        }

        $rows | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
        Write-Host "  [OK] Exported to: $csvPath ($($rows.Count) rows)" -ForegroundColor Green
    }
    catch {
        Write-Host "  [X] Export failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  TenantScope CSV Export" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Data source: $DataPath" -ForegroundColor Gray
Write-Host "  Output path: $OutputPath" -ForegroundColor Gray

$exportAll = "All" -in $ExportTypes

$exportCount = 0

if ($exportAll -or "Users" -in $ExportTypes) {
    Export-Users
    $exportCount++
}

if ($exportAll -or "Devices" -in $ExportTypes) {
    Export-Devices
    $exportCount++
}

if ($exportAll -or "Groups" -in $ExportTypes) {
    Export-Groups
    $exportCount++
}

if ($exportAll -or "Guests" -in $ExportTypes) {
    Export-Guests
    $exportCount++
}

if ($exportAll -or "Licenses" -in $ExportTypes) {
    Export-Licenses
    $exportCount++
}

if ($exportAll -or "Alerts" -in $ExportTypes) {
    Export-Alerts
    $exportCount++
}

if ($exportAll -or "Teams" -in $ExportTypes) {
    Export-Teams
    $exportCount++
}

if ($exportAll -or "SharePoint" -in $ExportTypes) {
    Export-SharePoint
    $exportCount++
}

if ($exportAll -or "AdminRoles" -in $ExportTypes) {
    Export-AdminRoles
    $exportCount++
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Export complete! $exportCount data types processed." -ForegroundColor Green
Write-Host "  Files saved to: $OutputPath" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
