# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter Teams-data fra Microsoft Graph.

.DESCRIPTION
    Collects Microsoft Teams inventory data including membership counts,
    activity status, ownership, guest access, and channel counts.

    Uses two approaches:
    1. Group API to enumerate Teams-provisioned groups with members/owners
    2. Teams activity report (CSV) for last activity dates

    Graph API endpoints:
    - GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')
    - GET /teams/{id}
    - GET /groups/{id}/members
    - GET /groups/{id}/owners
    - GET /teams/{id}/channels
    - GET /reports/getTeamsTeamActivityDetail(period='D30')

    Required scopes:
    - Team.ReadBasic.All
    - TeamMember.Read.All
    - Channel.ReadBasic.All
    - Reports.Read.All
    - Directory.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes teams.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of teams collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-TeamsData.ps1 -Config $config -OutputPath ".\data\teams.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Teams, Microsoft.Graph.Groups

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-DaysSinceDate {
    <#
    .SYNOPSIS
        Calculates days between a given date and now.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $DateValue
    )

    if ($null -eq $DateValue) {
        return $null
    }

    try {
        $date = if ($DateValue -is [DateTime]) { $DateValue } else { [DateTime]::Parse($DateValue) }
        $days = ((Get-Date) - $date).Days
        return [Math]::Max(0, $days)
    }
    catch {
        return $null
    }
}

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling.
    #>
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [int]$MaxRetries = 5,

        [Parameter()]
        [int]$BaseBackoffSeconds = 60
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests|Too many retries") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $BaseBackoffSeconds * [Math]::Pow(2, $attempt - 1)
                Write-Host "      Throttled. Waiting ${wait}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
            }
            else { throw }
        }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$teamCount = 0

try {
    Write-Host "    Collecting Microsoft Teams data..." -ForegroundColor Gray

    # Get inactive threshold from config
    $inactiveThreshold = $Config.thresholds.inactiveTeamDays
    if ($null -eq $inactiveThreshold -or $inactiveThreshold -le 0) {
        $inactiveThreshold = 90
    }

    # Large team threshold
    $largeTeamThreshold = 100

    # ========================================================================
    # Phase 1: Get Teams activity report for last activity dates
    # ========================================================================

    Write-Host "      Fetching Teams activity report..." -ForegroundColor Gray

    $activityLookup = @{}

    try {
        $tempCsvPath = Join-Path ([System.IO.Path]::GetTempPath()) "teams-activity-$((Get-Date).ToString('yyyyMMddHHmmss')).csv"

        Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/reports/getTeamsTeamActivityDetail(period='D30')" `
                -OutputFilePath $tempCsvPath
        }

        if (Test-Path $tempCsvPath) {
            $activityData = Import-Csv -Path $tempCsvPath

            foreach ($row in $activityData) {
                $teamId = $row.'Team Id'
                if ($teamId) {
                    $lastActivity = $row.'Last Activity Date'
                    $activityLookup[$teamId] = @{
                        lastActivityDate = if ($lastActivity) { $lastActivity } else { $null }
                    }
                }
            }

            Remove-Item -Path $tempCsvPath -Force -ErrorAction SilentlyContinue
            Write-Host "      Activity report: $($activityLookup.Count) teams with activity data" -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "      Warning: Could not fetch activity report: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Activity report unavailable: $($_.Exception.Message)"
    }

    # ========================================================================
    # Phase 2: Enumerate Teams-provisioned groups
    # ========================================================================

    Write-Host "      Enumerating Teams-provisioned groups..." -ForegroundColor Gray

    $teamsGroups = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgGroup -Filter "resourceProvisioningOptions/Any(x:x eq 'Team')" -All `
            -Property Id,DisplayName,Description,Visibility,CreatedDateTime,Mail,Classification
    }

    Write-Host "      Found $($teamsGroups.Count) Teams-provisioned groups" -ForegroundColor Gray

    # ========================================================================
    # Phase 3: Process each team
    # ========================================================================

    $processedTeams = @()

    foreach ($group in $teamsGroups) {
        try {
            # Get team-specific settings (archived status)
            $teamSettings = $null
            try {
                $teamSettings = Invoke-GraphWithRetry -ScriptBlock {
                    Get-MgTeam -TeamId $group.Id -ErrorAction Stop
                }
            }
            catch {
                # Team may not be fully provisioned
            }

            $isArchived = if ($teamSettings) { [bool]$teamSettings.IsArchived } else { $false }

            # Get members
            $members = @()
            try {
                $members = Invoke-GraphWithRetry -ScriptBlock {
                    Get-MgGroupMember -GroupId $group.Id -All -Property Id,UserPrincipalName,DisplayName
                }
            }
            catch {
                $errors += "Could not get members for team $($group.DisplayName): $($_.Exception.Message)"
            }

            # Get owners
            $owners = @()
            try {
                $owners = Invoke-GraphWithRetry -ScriptBlock {
                    Get-MgGroupOwner -GroupId $group.Id -All
                }
            }
            catch {
                $errors += "Could not get owners for team $($group.DisplayName): $($_.Exception.Message)"
            }

            # Get channels
            $channels = @()
            try {
                $channels = Invoke-GraphWithRetry -ScriptBlock {
                    Get-MgTeamChannel -TeamId $group.Id -All
                }
            }
            catch {
                # Channels may not be accessible for archived teams
            }

            # Count guests (members with #EXT# in UPN)
            $guestCount = 0
            foreach ($member in $members) {
                $memberObj = $member.AdditionalProperties
                $upn = $memberObj["userPrincipalName"]
                if ($upn -and $upn -match "#EXT#") {
                    $guestCount++
                }
            }

            $memberCount = $members.Count
            $ownerCount = $owners.Count
            $channelCount = $channels.Count
            $hasNoOwner = ($ownerCount -eq 0)
            $hasGuests = ($guestCount -gt 0)

            # Get activity data from report
            $lastActivityDate = $null
            if ($activityLookup.ContainsKey($group.Id)) {
                $lastActivityDate = $activityLookup[$group.Id].lastActivityDate
            }

            $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
            $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or
                          ($null -eq $lastActivityDate)

            # Build flags array
            $flags = @()
            if ($isInactive) { $flags += "inactive" }
            if ($hasNoOwner) { $flags += "ownerless" }
            if ($hasGuests) { $flags += "has-guests" }
            if ($isArchived) { $flags += "archived" }
            if ($memberCount -ge $largeTeamThreshold) { $flags += "large-team" }

            # Build output object
            $processedTeam = [PSCustomObject]@{
                id                = $group.Id
                displayName       = $group.DisplayName
                description       = $group.Description
                visibility        = if ($group.Visibility) { $group.Visibility } else { "Private" }
                createdDateTime   = if ($group.CreatedDateTime) { $group.CreatedDateTime.ToString("o") } else { $null }
                mail              = $group.Mail
                memberCount       = $memberCount
                ownerCount        = $ownerCount
                guestCount        = $guestCount
                isArchived        = $isArchived
                channelCount      = $channelCount
                lastActivityDate  = $lastActivityDate
                daysSinceActivity = $daysSinceActivity
                isInactive        = $isInactive
                hasNoOwner        = $hasNoOwner
                hasGuests         = $hasGuests
                classification    = $group.Classification
                flags             = $flags
            }

            $processedTeams += $processedTeam
            $teamCount++

            # Progress indicator every 10 teams
            if ($teamCount % 10 -eq 0) {
                Write-Host "      Processed $teamCount teams..." -ForegroundColor Gray
            }

            # Brief pause between per-team API calls to avoid throttling
            Start-Sleep -Seconds 1

        }
        catch {
            $errors += "Error processing team $($group.DisplayName): $($_.Exception.Message)"
            Write-Host "      Warning: Error processing $($group.DisplayName): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # Sort by: ownerless first, then inactive, then by name
    $processedTeams = $processedTeams | Sort-Object -Property @{
        Expression = {
            if ($_.hasNoOwner) { 0 }
            elseif ($_.isInactive) { 1 }
            else { 2 }
        }
    }, DisplayName

    # Write results to JSON file
    $processedTeams | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    Collected $teamCount teams" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $teamCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|unauthorized") {
        Write-Host "    Teams collection requires Team.ReadBasic.All and related permissions" -ForegroundColor Yellow
    }

    Write-Host "    Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
