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
    3. Teams channels endpoint - channel counts and private channel counts
    4. Group root site lookup - SharePoint site correlation

    Graph API endpoints:
    - GET /reports/getTeamsTeamActivityDetail(period='D30')
    - GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$expand=owners($select=id)
    - GET /teams/{team-id}/channels
    - GET /groups/{group-id}/sites/root

    Required scopes:
    - Reports.Read.All
    - Directory.Read.All
    - GroupMember.Read.All
    - Channel.ReadBasic.All
    - Sites.Read.All

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

    function Get-ReportIntValue {
        param(
            [Parameter(Mandatory)]
            [psobject]$Row,
            [Parameter(Mandatory)]
            [string[]]$Keys,
            [int]$Default = 0
        )

        foreach ($key in $Keys) {
            if ($Row.PSObject.Properties.Name -contains $key) {
                $value = $Row.$key
                if ($null -ne $value -and $value -ne '') {
                    return [int]$value
                }
            }
        }

        return $Default
    }

    function Get-TeamChannelCounts {
        param(
            [Parameter(Mandatory)]
            [string]$TeamId
        )

        $total = 0
        $private = 0
        $uri = "https://graph.microsoft.com/v1.0/teams/$TeamId/channels?`$select=id,membershipType"

        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Teams channels retrieval"

            if ($response.value) {
                foreach ($ch in $response.value) {
                    $total++
                    if ($ch.membershipType -eq 'private') { $private++ }
                }
            }

            $uri = $response.'@odata.nextLink'
        } while ($uri)

        return @{
            total = $total
            private = $private
        }
    }

    function Get-LinkedSharePointSiteId {
        param(
            [Parameter(Mandatory)]
            [string]$GroupId
        )

        $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/sites/root?`$select=id,webUrl"
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Group root site lookup"

        $siteId = $response.id
        $siteGuid = $null
        if ($siteId -and $siteId -match ',') {
            $parts = $siteId -split ','
            if ($parts.Count -ge 2) { $siteGuid = $parts[1] }
        }

        return @{
            id = if ($siteGuid) { $siteGuid } else { $siteId }
            webUrl = $response.webUrl
        }
    }

    function Get-GroupMembers {
        param(
            [Parameter(Mandatory)]
            [string]$GroupId
        )

        $members = @()
        $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members?`$select=id,displayName,mail,userPrincipalName,userType"

        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Group members retrieval"

            if ($response.value) {
                $members += $response.value
            }

            $uri = $response.'@odata.nextLink'
        } while ($uri)

        return $members
    }

    # ========================================================================
    # Phase 1: Get Teams activity report (has guest counts, activity dates)
    # ========================================================================

    Write-Host "      Fetching Teams activity report..." -ForegroundColor Gray

    $activityData = @{}
    $reportPeriod = Get-ReportPeriod -Days $inactiveThreshold

    try {
        $reportRows = Get-ReportCsvData -Uri "https://graph.microsoft.com/v1.0/reports/getTeamsTeamActivityDetail(period='$reportPeriod')" -OperationName "Teams activity report" -TempPrefix "teams-activity"
        foreach ($row in $reportRows) {
            $teamId = $row.'Team Id'
            if ($teamId) {
                $activityData[$teamId] = @{
                    teamName       = $row.'Team Name'
                    lastActivity   = $row.'Last Activity Date'
                    guestCount     = Get-ReportIntValue -Row $row -Keys @('Guests')
                    activeUsers    = Get-ReportIntValue -Row $row -Keys @('Active Users')
                    activeChannels = Get-ReportIntValue -Row $row -Keys @('Active Channels')
                    postMessages   = Get-ReportIntValue -Row $row -Keys @('Post Messages')
                    memberCount    = Get-ReportIntValue -Row $row -Keys @('Member Count', 'Members', 'Team Members', 'Team Member Count')
                }
            }
        }
        Write-Host "      Activity report ($reportPeriod): $($activityData.Count) teams" -ForegroundColor Gray
    }
    catch {
        Write-Host "      [!] Could not fetch activity report: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Activity report unavailable: $($_.Exception.Message)"
    }

    # ========================================================================
    # Phase 2: Get Teams groups with owner counts (single API call with paging)
    # ========================================================================

    Write-Host "      Fetching Teams groups with owners..." -ForegroundColor Gray

    $teamsGroups = @()
    try {
        # Use direct API to get groups with expanded owners
        $uri = "https://graph.microsoft.com/v1.0/groups?`$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&`$select=id,displayName,description,visibility,createdDateTime,mail,assignedLabels&`$expand=owners(`$select=id,userPrincipalName,mail)"

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
        Write-Host "      [!] Could not fetch groups: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Groups fetch error: $($_.Exception.Message)"
    }

    # ========================================================================
    # Phase 3: Build output - focus on governance gaps
    # ========================================================================

    Write-Host "      Processing governance data..." -ForegroundColor Gray

    $processedTeams = @()
    $channelsAvailable = $true
    $channelsErrorLogged = $false
    $siteLinkAvailable = $true
    $siteLinkErrorLogged = $false
    $membersAvailable = $true
    $membersErrorLogged = $false

    foreach ($group in $teamsGroups) {
        $groupId = if ($group.id) { $group.id } else { $group.Id }
        $displayName = if ($group.displayName) { $group.displayName } else { $group.DisplayName }

        # Get activity data from report
        $activity = $activityData[$groupId]
        $lastActivityDate = if ($activity) { $activity.lastActivity } else { $null }
        $guestCount = if ($activity) { $activity.guestCount } else { 0 }
        $activeUsers = if ($activity) { $activity.activeUsers } else { 0 }
        $memberCount = if ($activity) { $activity.memberCount } else { 0 }

        # Get owner count from expanded data
        $owners = if ($group.owners) { $group.owners } else { @() }
        $ownerCount = $owners.Count
        $ownerUpns = @()
        if ($ownerCount -gt 0) {
            foreach ($owner in $owners) {
                $ownerUpn = $null
                if ($owner.userPrincipalName) { $ownerUpn = $owner.userPrincipalName }
                elseif ($owner.additionalProperties -and $owner.additionalProperties.userPrincipalName) { $ownerUpn = $owner.additionalProperties.userPrincipalName }
                elseif ($owner.mail) { $ownerUpn = $owner.mail }
                if ($ownerUpn) { $ownerUpns += $ownerUpn }
            }
        }
        $ownerUpns = $ownerUpns | Where-Object { $_ } | Sort-Object -Unique

        $assignedLabels = if ($group.assignedLabels) { $group.assignedLabels } elseif ($group.AssignedLabels) { $group.AssignedLabels } else { @() }
        $labelNames = @()
        if ($assignedLabels) {
            foreach ($label in $assignedLabels) {
                $labelName = $null
                if ($label.displayName) { $labelName = $label.displayName }
                elseif ($label.DisplayName) { $labelName = $label.DisplayName }
                if ($labelName) { $labelNames += $labelName }
            }
        }
        $sensitivityLabelName = if ($labelNames.Count -gt 0) { ($labelNames | Sort-Object -Unique) -join ', ' } else { $null }

        $channelCount = $null
        $privateChannelCount = $null
        if ($channelsAvailable -and $groupId) {
            try {
                $channelCounts = Get-TeamChannelCounts -TeamId $groupId
                $channelCount = $channelCounts.total
                $privateChannelCount = $channelCounts.private
            }
            catch {
                if (-not $channelsErrorLogged) {
                    Write-Host "      [!] Could not fetch channel counts: $($_.Exception.Message)" -ForegroundColor Yellow
                    $errors += "Channels unavailable: $($_.Exception.Message)"
                    $channelsErrorLogged = $true
                }
                $channelsAvailable = $false
            }
        }

        $linkedSharePointSiteId = $null
        if ($siteLinkAvailable -and $groupId) {
            try {
                $siteInfo = Get-LinkedSharePointSiteId -GroupId $groupId
                $linkedSharePointSiteId = $siteInfo.id
            }
            catch {
                if (-not $siteLinkErrorLogged) {
                    if ($_.Exception.Message -match "Forbidden|403|Authorization") {
                        Write-Host "      [!] SharePoint site lookup requires Sites.Read.All permission (skipping)" -ForegroundColor Yellow
                        $errors += "Linked SharePoint site lookup requires Sites.Read.All permission"
                    }
                    else {
                        Write-Host "      [!] Could not fetch linked SharePoint site IDs: $($_.Exception.Message)" -ForegroundColor Yellow
                        $errors += "Linked SharePoint site lookup unavailable: $($_.Exception.Message)"
                    }
                    $siteLinkErrorLogged = $true
                }
                $siteLinkAvailable = $false
            }
        }

        # Calculate governance flags
        $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
        $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or ($null -eq $lastActivityDate)
        $hasNoOwner = ($ownerCount -eq 0)
        $hasGuests = ($guestCount -gt 0)

        $externalDomains = @()
        $suggestedOwners = @()
        if ($membersAvailable -and $groupId -and ($hasGuests -or $hasNoOwner)) {
            try {
                $members = Get-GroupMembers -GroupId $groupId
                foreach ($member in $members) {
                    $userType = $member.userType
                    $upn = if ($member.userPrincipalName) { $member.userPrincipalName } elseif ($member.mail) { $member.mail } else { $null }
                    if ($upn) {
                        $domain = $upn.Split('@')[-1].ToLower()
                        if ($userType -eq 'Guest') {
                            if ($domain) { $externalDomains += $domain }
                        } elseif ($hasNoOwner -and $suggestedOwners.Count -lt 3) {
                            $suggestedOwners += $upn
                        }
                    }
                }
                $externalDomains = $externalDomains | Sort-Object -Unique
                $suggestedOwners = $suggestedOwners | Sort-Object -Unique
            }
            catch {
                if (-not $membersErrorLogged) {
                    Write-Host "      [!] Could not fetch group members: $($_.Exception.Message)" -ForegroundColor Yellow
                    $errors += "Group members unavailable: $($_.Exception.Message)"
                    $membersErrorLogged = $true
                }
                $membersAvailable = $false
            }
        }

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
            ownerUpns         = $ownerUpns
            sensitivityLabelName = $sensitivityLabelName
            guestCount        = $guestCount
            memberCount       = $memberCount
            channelCount      = $channelCount
            privateChannelCount = $privateChannelCount
            linkedSharePointSiteId = $linkedSharePointSiteId
            externalDomains   = $externalDomains
            suggestedOwners   = $suggestedOwners
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
