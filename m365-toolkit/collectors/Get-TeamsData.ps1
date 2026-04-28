# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
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
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
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
            [string]$GroupId,
            [int]$MaxMembers = 100
        )

        $members = @()
        # Restrict to user objects to avoid directoryObject select errors.
        $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members/microsoft.graph.user?`$select=id,displayName,mail,userPrincipalName,userType"

        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Group members retrieval"

            if ($response.value) {
                foreach ($member in $response.value) {
                    if ($members.Count -ge $MaxMembers) { break }
                    $members += $member
                }
            }

            if ($members.Count -ge $MaxMembers) { break }
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
                    memberCount    = Get-ReportIntValue -Row $row -Keys @('Member Count', 'MemberCount', 'Members', 'Team Members', 'Team Member Count', 'TeamMemberCount', 'Total Members', 'TotalMembers')
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

    Write-Host "      Fetching Teams groups..." -ForegroundColor Gray

    $teamsGroups = @()
    try {
        # Avoid brittle filter+expand combinations that return BadRequest in some tenants.
        # Fetch Microsoft 365 groups first, then keep only those provisioned as Teams.
        $uri = "https://graph.microsoft.com/v1.0/groups?`$filter=groupTypes/any(c:c eq 'Unified')&`$select=id,displayName,description,visibility,createdDateTime,mail,assignedLabels,resourceProvisioningOptions&`$top=999"

        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Teams groups retrieval"
            if ($response.value) {
                foreach ($group in @($response.value)) {
                    $provisioningOptions = @()
                    if ($group.resourceProvisioningOptions) { $provisioningOptions = @($group.resourceProvisioningOptions) }
                    if ($provisioningOptions -contains 'Team') {
                        $teamsGroups += $group
                    }
                }
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

    if ($teamsGroups.Count -gt 0) {
        Write-Host "      Fetching Teams owners in Graph batches..." -ForegroundColor Gray
        $ownerRequests = @()
        foreach ($group in $teamsGroups) {
            $groupId = if ($group.id) { $group.id } else { $group.Id }
            if (-not $groupId) { continue }
            $ownerRequests += [PSCustomObject]@{
                id  = [string]$groupId
                uri = "https://graph.microsoft.com/v1.0/groups/$groupId/owners/microsoft.graph.user?`$select=id,userPrincipalName,mail"
            }
        }

        try {
            $ownerResults = Invoke-GraphBatchGet -Requests $ownerRequests -OperationName "Teams owners batch"
            foreach ($group in $teamsGroups) {
                $groupId = if ($group.id) { $group.id } else { $group.Id }
                if (-not $groupId) { continue }
                $owners = @()
                if ($ownerResults.ContainsKey([string]$groupId)) {
                    $result = $ownerResults[[string]$groupId]
                    if ($result.status -ge 200 -and $result.status -lt 300 -and $result.body -and $result.body.value) {
                        $owners = @($result.body.value)
                    }
                }

                try {
                    $group | Add-Member -NotePropertyName owners -NotePropertyValue $owners -Force
                }
                catch {
                    # Ignore owner hydration issues for individual groups.
                }
            }
        }
        catch {
            Write-Host "      [!] Could not fetch owners in batch: $($_.Exception.Message)" -ForegroundColor Yellow
            $errors += "Owners fetch unavailable: $($_.Exception.Message)"
        }
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
    $deepCollection = ($Config.collection -is [hashtable] -and $Config.collection.deepCollection -eq $true)
    $maxTeamChannelLookups = if ($deepCollection) { [int]::MaxValue } else { 100 }
    $maxTeamSiteLookups = if ($deepCollection) { [int]::MaxValue } else { 100 }
    $maxTeamMemberLookups = if ($deepCollection) { [int]::MaxValue } else { 50 }
    if ($Config.thresholds -is [hashtable]) {
        if ($Config.thresholds.ContainsKey('maxTeamChannelLookups')) { $maxTeamChannelLookups = [int]$Config.thresholds.maxTeamChannelLookups }
        if ($Config.thresholds.ContainsKey('maxTeamSiteLookups')) { $maxTeamSiteLookups = [int]$Config.thresholds.maxTeamSiteLookups }
        if ($Config.thresholds.ContainsKey('maxTeamMemberLookups')) { $maxTeamMemberLookups = [int]$Config.thresholds.maxTeamMemberLookups }
    }
    $teamChannelLookups = 0
    $teamSiteLookups = 0
    $teamMemberLookups = 0
    $teamMemberCountMap = @{}
    $teamCountRequests = @()

    foreach ($group in $teamsGroups) {
        $groupId = if ($group.id) { $group.id } else { $group.Id }
        if (-not $groupId) { continue }
        if ($activityData.ContainsKey($groupId) -and $activityData[$groupId].memberCount -gt 0) { continue }

        $teamCountRequests += [PSCustomObject]@{
            id      = "teamMembers_$groupId"
            uri     = "https://graph.microsoft.com/v1.0/groups/$groupId/members/`$count"
            headers = @{ ConsistencyLevel = "eventual" }
        }
    }

    if ($teamCountRequests.Count -gt 0) {
        Write-Host "      Fetching missing Teams member counts in Graph batches ($($teamCountRequests.Count) teams)..." -ForegroundColor Gray
        $teamCountResults = Invoke-GraphBatchGet -Requests $teamCountRequests -OperationName "Teams member counts batch"
        foreach ($request in $teamCountRequests) {
            if ($teamCountResults.ContainsKey($request.id) -and $teamCountResults[$request.id].status -ge 200 -and $teamCountResults[$request.id].status -lt 300) {
                $groupId = ([string]$request.id).Substring("teamMembers_".Length)
                $count = Get-CountFromGraphResponse -Response $teamCountResults[$request.id].body
                if ($null -ne $count) { $teamMemberCountMap[$groupId] = $count }
            }
        }
    }

    # PERFORMANCE FIX: Batch fetch channel counts and site IDs instead of N+1 individual calls
    $channelCountsMap = @{}
    $siteIdsMap = @{}

    # Identify teams that need channel/site lookups
    $teamsNeedingChannels = @()
    $teamsNeedingSites = @()
    foreach ($group in $teamsGroups) {
        $groupId = if ($group.id) { $group.id } else { $group.Id }
        if (-not $groupId) { continue }

        $activity = $activityData[$groupId]
        $guestCount = if ($activity) { $activity.guestCount } else { 0 }
        $owners = if ($group.owners) { $group.owners } else { @() }
        $ownerCount = $owners.Count
        $lastActivityDate = if ($activity) { $activity.lastActivity } else { $null }
        $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
        $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or ($null -eq $lastActivityDate)
        $hasNoOwner = ($ownerCount -eq 0)
        $hasGuests = ($guestCount -gt 0)

        $shouldLookup = $deepCollection -or $hasGuests -or $hasNoOwner -or $isInactive
        if ($shouldLookup -and $teamsNeedingChannels.Count -lt $maxTeamChannelLookups) {
            $teamsNeedingChannels += $groupId
        }
        if ($shouldLookup -and $teamsNeedingSites.Count -lt $maxTeamSiteLookups) {
            $teamsNeedingSites += $groupId
        }
    }

    # Batch fetch channel counts
    if ($teamsNeedingChannels.Count -gt 0) {
        Write-Host "      Batch fetching channel counts for $($teamsNeedingChannels.Count) teams..." -ForegroundColor Gray
        $channelRequests = @()
        foreach ($teamId in $teamsNeedingChannels) {
            $channelRequests += [PSCustomObject]@{
                id  = [string]$teamId
                uri = "https://graph.microsoft.com/v1.0/teams/$teamId/channels?`$select=id,membershipType"
            }
        }

        try {
            $channelResults = Invoke-GraphBatchGet -Requests $channelRequests -OperationName "Teams channels batch"
            foreach ($teamId in $channelResults.Keys) {
                $result = $channelResults[$teamId]
                if ($result.status -ge 200 -and $result.status -lt 300 -and $result.body) {
                    $channels = if ($result.body.value) { @($result.body.value) } else { @() }
                    $total = $channels.Count
                    $private = @($channels | Where-Object { $_.membershipType -eq 'private' }).Count
                    $channelCountsMap[$teamId] = @{ total = $total; private = $private }
                }
            }
            Write-Host "      Retrieved channel counts for $($channelCountsMap.Count) teams" -ForegroundColor Gray
        }
        catch {
            Write-Host "      [!] Batch channel fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # Batch fetch SharePoint site IDs
    if ($teamsNeedingSites.Count -gt 0) {
        Write-Host "      Batch fetching SharePoint site IDs for $($teamsNeedingSites.Count) teams..." -ForegroundColor Gray
        $siteRequests = @()
        foreach ($groupId in $teamsNeedingSites) {
            $siteRequests += [PSCustomObject]@{
                id  = [string]$groupId
                uri = "https://graph.microsoft.com/v1.0/groups/$groupId/sites/root?`$select=id,webUrl"
            }
        }

        try {
            $siteResults = Invoke-GraphBatchGet -Requests $siteRequests -OperationName "Teams SharePoint sites batch"
            foreach ($groupId in $siteResults.Keys) {
                $result = $siteResults[$groupId]
                if ($result.status -ge 200 -and $result.status -lt 300 -and $result.body) {
                    $siteId = $result.body.id
                    $siteGuid = $null
                    if ($siteId -and $siteId -match ',') {
                        $parts = $siteId -split ','
                        if ($parts.Count -ge 2) { $siteGuid = $parts[1] }
                    }
                    $siteIdsMap[$groupId] = if ($siteGuid) { $siteGuid } else { $siteId }
                }
            }
            Write-Host "      Retrieved site IDs for $($siteIdsMap.Count) teams" -ForegroundColor Gray
        }
        catch {
            if ($_.Exception.Message -match "Forbidden|403|Authorization") {
                Write-Host "      [!] SharePoint site lookup requires Sites.Read.All permission (skipping)" -ForegroundColor Yellow
            } else {
                Write-Host "      [!] Batch site fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }

    foreach ($group in $teamsGroups) {
        $groupId = if ($group.id) { $group.id } else { $group.Id }
        $displayName = if ($group.displayName) { $group.displayName } else { $group.DisplayName }

        # Get activity data from report
        $activity = $activityData[$groupId]
        $lastActivityDate = if ($activity) { $activity.lastActivity } else { $null }
        $guestCount = if ($activity) { $activity.guestCount } else { 0 }
        $activeUsers = if ($activity) { $activity.activeUsers } else { 0 }
        $memberCount = if ($activity -and $activity.memberCount -gt 0) { $activity.memberCount } else { 0 }

        # Fallback: Get member count from transitiveMemberCount if report doesn't have it
        if ($memberCount -eq 0 -and $teamMemberCountMap.ContainsKey([string]$groupId)) {
            $memberCount = $teamMemberCountMap[[string]$groupId]
        }
        elseif ($memberCount -eq 0 -and $membersAvailable -and $groupId -and $deepCollection) {
            try {
                $memberCountUri = "https://graph.microsoft.com/v1.0/groups/$groupId`?`$select=id&`$count=true"
                $membersUri = "https://graph.microsoft.com/v1.0/groups/$groupId/members/`$count"
                $countResponse = Invoke-MgGraphRequest -Method GET -Uri $membersUri -Headers @{ 'ConsistencyLevel' = 'eventual' } -OutputType PSObject -ErrorAction SilentlyContinue
                if ($countResponse -is [int]) {
                    $memberCount = $countResponse
                }
            }
            catch {
                # Silently ignore count errors - will remain 0
            }
        }

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

        $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
        $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or ($null -eq $lastActivityDate)
        $hasNoOwner = ($ownerCount -eq 0)
        $hasGuests = ($guestCount -gt 0)

        # PERFORMANCE FIX: Lookup pre-fetched channel counts instead of N+1 API calls
        $channelCount = $null
        $privateChannelCount = $null
        if ($channelCountsMap.ContainsKey([string]$groupId)) {
            $channelCounts = $channelCountsMap[[string]$groupId]
            $channelCount = $channelCounts.total
            $privateChannelCount = $channelCounts.private
        }

        # PERFORMANCE FIX: Lookup pre-fetched site ID instead of N+1 API calls
        $linkedSharePointSiteId = $null
        if ($siteIdsMap.ContainsKey([string]$groupId)) {
            $linkedSharePointSiteId = $siteIdsMap[[string]$groupId]
        }

        $externalDomains = @()
        $suggestedOwners = @()
        if ($membersAvailable -and $groupId -and ($hasGuests -or $hasNoOwner) -and $teamMemberLookups -lt $maxTeamMemberLookups) {
            try {
                $teamMemberLookups++
                $members = Get-GroupMembers -GroupId $groupId -MaxMembers 100
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

