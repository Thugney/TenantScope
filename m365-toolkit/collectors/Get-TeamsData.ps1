# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter Teams governance-data fra Microsoft Graph.

.DESCRIPTION
    Collects Microsoft Teams governance data focusing on:
    - Inactive teams (no activity in X days)
    - Ownerless teams (no owners assigned)
    - Teams with guest access

    Uses efficient report-based approach:
    1. Teams activity report (CSV) - activity dates, guest counts, member counts
    2. Groups API with $expand=owners - owner counts in single request

    Graph API endpoints:
    - GET /reports/getTeamsTeamActivityDetail(period='D30')
    - GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$expand=owners($select=id)

    Required scopes:
    - Reports.Read.All
    - Directory.Read.All
    - GroupMember.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes teams.json to the specified output path.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Groups

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$teamCount = 0

try {
    Write-Host "    Collecting Microsoft Teams governance data..." -ForegroundColor Gray

    $inactiveThreshold = $Config.thresholds.inactiveTeamDays
    if ($null -eq $inactiveThreshold -or $inactiveThreshold -le 0) { $inactiveThreshold = 90 }

    # ========================================================================
    # Phase 1: Get Teams activity report (has guest counts, activity dates)
    # ========================================================================

    Write-Host "      Fetching Teams activity report..." -ForegroundColor Gray

    $activityData = @{}
    $tempCsvPath = Join-Path ([System.IO.Path]::GetTempPath()) "teams-activity-$((Get-Date).ToString('yyyyMMddHHmmss')).csv"

    try {
        Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/reports/getTeamsTeamActivityDetail(period='D30')" `
                -OutputFilePath $tempCsvPath
        } -OperationName "Teams activity report"

        if (Test-Path $tempCsvPath) {
            $reportRows = Import-Csv -Path $tempCsvPath
            foreach ($row in $reportRows) {
                $teamId = $row.'Team Id'
                if ($teamId) {
                    $activityData[$teamId] = @{
                        teamName       = $row.'Team Name'
                        lastActivity   = $row.'Last Activity Date'
                        guestCount     = if ($row.'Guests') { [int]$row.'Guests' } else { 0 }
                        activeUsers    = if ($row.'Active Users') { [int]$row.'Active Users' } else { 0 }
                        activeChannels = if ($row.'Active Channels') { [int]$row.'Active Channels' } else { 0 }
                        postMessages   = if ($row.'Post Messages') { [int]$row.'Post Messages' } else { 0 }
                    }
                }
            }
            Remove-Item -Path $tempCsvPath -Force -ErrorAction SilentlyContinue
            Write-Host "      Activity report: $($activityData.Count) teams" -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "      Warning: Could not fetch activity report: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Activity report unavailable: $($_.Exception.Message)"
    }

    # ========================================================================
    # Phase 2: Get Teams groups with owner counts (single API call with paging)
    # ========================================================================

    Write-Host "      Fetching Teams groups with owners..." -ForegroundColor Gray

    $teamsGroups = @()
    try {
        # Use direct API to get groups with expanded owners
        $uri = "https://graph.microsoft.com/v1.0/groups?`$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&`$select=id,displayName,description,visibility,createdDateTime,mail&`$expand=owners(`$select=id)"

        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Teams groups retrieval"
            if ($response.value) {
                $teamsGroups += $response.value
            }
            $uri = $response.'@odata.nextLink'

            if ($teamsGroups.Count % 500 -eq 0 -and $teamsGroups.Count -gt 0) {
                Write-Host "      Loaded $($teamsGroups.Count) teams..." -ForegroundColor Gray
            }
        } while ($uri)

        Write-Host "      Found $($teamsGroups.Count) Teams groups" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Error fetching groups: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Groups fetch error: $($_.Exception.Message)"
    }

    # ========================================================================
    # Phase 3: Build output - focus on governance gaps
    # ========================================================================

    Write-Host "      Processing governance data..." -ForegroundColor Gray

    $processedTeams = @()

    foreach ($group in $teamsGroups) {
        $groupId = if ($group.id) { $group.id } else { $group.Id }
        $displayName = if ($group.displayName) { $group.displayName } else { $group.DisplayName }

        # Get activity data from report
        $activity = $activityData[$groupId]
        $lastActivityDate = if ($activity) { $activity.lastActivity } else { $null }
        $guestCount = if ($activity) { $activity.guestCount } else { 0 }
        $activeUsers = if ($activity) { $activity.activeUsers } else { 0 }

        # Get owner count from expanded data
        $owners = if ($group.owners) { $group.owners } else { @() }
        $ownerCount = $owners.Count

        # Calculate governance flags
        $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
        $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or ($null -eq $lastActivityDate)
        $hasNoOwner = ($ownerCount -eq 0)
        $hasGuests = ($guestCount -gt 0)

        # Build flags array
        $flags = @()
        if ($isInactive) { $flags += "inactive" }
        if ($hasNoOwner) { $flags += "ownerless" }
        if ($hasGuests) { $flags += "has-guests" }

        # Only include teams with governance issues OR all teams if no issues (for complete inventory)
        $processedTeam = [PSCustomObject]@{
            id                = $groupId
            displayName       = $displayName
            description       = if ($group.description) { $group.description } else { $null }
            visibility        = if ($group.visibility) { $group.visibility } else { "Private" }
            createdDateTime   = if ($group.createdDateTime) { ([DateTime]$group.createdDateTime).ToString("o") } else { $null }
            mail              = $group.mail
            ownerCount        = $ownerCount
            guestCount        = $guestCount
            activeUsers       = $activeUsers
            lastActivityDate  = $lastActivityDate
            daysSinceActivity = $daysSinceActivity
            isInactive        = $isInactive
            hasNoOwner        = $hasNoOwner
            hasGuests         = $hasGuests
            flags             = $flags
        }

        $processedTeams += $processedTeam
        $teamCount++
    }

    # Sort: governance issues first (ownerless, then inactive with guests)
    $processedTeams = $processedTeams | Sort-Object -Property @{
        Expression = { $_.hasNoOwner }; Descending = $true
    }, @{
        Expression = { $_.isInactive -and $_.hasGuests }; Descending = $true
    }, @{
        Expression = { $_.isInactive }; Descending = $true
    }, @{
        Expression = { $_.displayName }; Ascending = $true
    }

    # Summary stats
    $inactiveCount = ($processedTeams | Where-Object { $_.isInactive }).Count
    $ownerlessCount = ($processedTeams | Where-Object { $_.hasNoOwner }).Count
    $withGuestsCount = ($processedTeams | Where-Object { $_.hasGuests }).Count

    Write-Host "      Governance summary:" -ForegroundColor Gray
    Write-Host "        - Inactive teams: $inactiveCount" -ForegroundColor $(if ($inactiveCount -gt 0) { "Yellow" } else { "Gray" })
    Write-Host "        - Ownerless teams: $ownerlessCount" -ForegroundColor $(if ($ownerlessCount -gt 0) { "Yellow" } else { "Gray" })
    Write-Host "        - Teams with guests: $withGuestsCount" -ForegroundColor Gray

    # Build output
    $output = [PSCustomObject]@{
        metadata = [PSCustomObject]@{
            collectedAt   = (Get-Date).ToString("o")
            totalTeams    = $teamCount
            inactiveCount = $inactiveCount
            ownerlessCount = $ownerlessCount
            withGuestsCount = $withGuestsCount
            inactiveThresholdDays = $inactiveThreshold
        }
        teams = $processedTeams
    }

    # Save data using shared utility
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $teamCount teams (governance-focused)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $teamCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty output on failure
    $emptyOutput = [PSCustomObject]@{
        metadata = [PSCustomObject]@{
            collectedAt = (Get-Date).ToString("o")
            error       = $errorMessage
        }
        teams = @()
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
