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
    # Phase 2: Enumerate Teams-provisioned groups with expanded members/owners
    # ========================================================================

    Write-Host "      Enumerating Teams-provisioned groups..." -ForegroundColor Gray

    # Use direct API call with $expand to get members and owners in a single call per group
    # This significantly reduces the number of API calls needed
    $teamsGroups = @()
    try {
        $teamsGroups = Invoke-GraphWithRetry -ScriptBlock {
            $allGroups = @()
            $uri = "https://graph.microsoft.com/v1.0/groups?`$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&`$select=id,displayName,description,visibility,createdDateTime,mail,classification&`$expand=members(`$select=id,userPrincipalName),owners(`$select=id)"
            do {
                $response = Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
                if ($response.value) {
                    $allGroups += $response.value
                }
                $uri = $response.'@odata.nextLink'
            } while ($uri)
            return $allGroups
        }
    }
    catch {
        # Fallback to simple group enumeration if expand fails
        Write-Host "      Falling back to simple group enumeration..." -ForegroundColor Yellow
        $teamsGroups = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgGroup -Filter "resourceProvisioningOptions/Any(x:x eq 'Team')" -All `
                -Property Id,DisplayName,Description,Visibility,CreatedDateTime,Mail,Classification
        }
    }

    Write-Host "      Found $($teamsGroups.Count) Teams-provisioned groups" -ForegroundColor Gray

    # ========================================================================
    # Phase 3: Get team settings in batches using Graph batch API
    # ========================================================================

    Write-Host "      Fetching team settings and channels in batches..." -ForegroundColor Gray

    # Build lookup tables for team settings and channels using batch requests
    $teamSettingsLookup = @{}
    $channelCountLookup = @{}

    # Process in batches of 20 (Graph batch limit)
    $batchSize = 20
    $groupIds = $teamsGroups | ForEach-Object { if ($_.Id) { $_.Id } else { $_.id } }

    for ($i = 0; $i -lt $groupIds.Count; $i += $batchSize) {
        $batchIds = $groupIds[$i..([Math]::Min($i + $batchSize - 1, $groupIds.Count - 1))]

        # Build batch request for team settings
        $batchRequests = @()
        $requestId = 1
        foreach ($id in $batchIds) {
            $batchRequests += @{
                id = [string]$requestId
                method = "GET"
                url = "/teams/$id"
            }
            $requestId++
        }

        # Add channel count requests
        foreach ($id in $batchIds) {
            $batchRequests += @{
                id = [string]$requestId
                method = "GET"
                url = "/teams/$id/channels?`$select=id&`$top=999"
            }
            $requestId++
        }

        # Execute batch request
        try {
            $batchResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/`$batch" `
                    -Body @{ requests = $batchRequests } -OutputType PSObject
            }

            # Process batch responses
            $halfPoint = $batchIds.Count
            foreach ($response in $batchResponse.responses) {
                $respId = [int]$response.id
                if ($respId -le $halfPoint) {
                    # Team settings response
                    $teamId = $batchIds[$respId - 1]
                    if ($response.status -eq 200 -and $response.body) {
                        $teamSettingsLookup[$teamId] = $response.body
                    }
                }
                else {
                    # Channel count response
                    $teamId = $batchIds[$respId - $halfPoint - 1]
                    if ($response.status -eq 200 -and $response.body -and $response.body.value) {
                        $channelCountLookup[$teamId] = $response.body.value.Count
                    }
                }
            }
        }
        catch {
            Write-Host "      Warning: Batch request failed, will use fallback for some teams" -ForegroundColor Yellow
        }

        # Show progress
        $processed = [Math]::Min($i + $batchSize, $groupIds.Count)
        Write-Host "      Batch progress: $processed / $($groupIds.Count) teams..." -ForegroundColor Gray
    }

    # ========================================================================
    # Phase 4: Process each team (now much faster with pre-fetched data)
    # ========================================================================

    $processedTeams = @()

    foreach ($group in $teamsGroups) {
        try {
            $groupId = if ($group.Id) { $group.Id } else { $group.id }

            # Get team settings from lookup (or fetch individually if not in batch)
            $teamSettings = $teamSettingsLookup[$groupId]
            $isArchived = if ($teamSettings -and $teamSettings.isArchived) { $true } else { $false }

            # Get members and owners from expanded data or fetch if needed
            $members = @()
            $owners = @()

            if ($group.members) {
                $members = $group.members
            }
            else {
                # Fallback: fetch members individually
                try {
                    $members = Invoke-GraphWithRetry -ScriptBlock {
                        Get-MgGroupMember -GroupId $groupId -All -Property Id,UserPrincipalName,DisplayName
                    }
                }
                catch {
                    $errors += "Could not get members for team $($group.displayName): $($_.Exception.Message)"
                }
            }

            if ($group.owners) {
                $owners = $group.owners
            }
            else {
                # Fallback: fetch owners individually
                try {
                    $owners = Invoke-GraphWithRetry -ScriptBlock {
                        Get-MgGroupOwner -GroupId $groupId -All
                    }
                }
                catch {
                    $errors += "Could not get owners for team $($group.displayName): $($_.Exception.Message)"
                }
            }

            # Get channel count from lookup
            $channelCount = if ($channelCountLookup.ContainsKey($groupId)) { $channelCountLookup[$groupId] } else { 0 }

            # Count guests (members with #EXT# in UPN)
            $guestCount = 0
            foreach ($member in $members) {
                $upn = $null
                if ($member.userPrincipalName) {
                    $upn = $member.userPrincipalName
                }
                elseif ($member.AdditionalProperties -and $member.AdditionalProperties["userPrincipalName"]) {
                    $upn = $member.AdditionalProperties["userPrincipalName"]
                }
                if ($upn -and $upn -match "#EXT#") {
                    $guestCount++
                }
            }

            $memberCount = $members.Count
            $ownerCount = $owners.Count
            $hasNoOwner = ($ownerCount -eq 0)
            $hasGuests = ($guestCount -gt 0)

            # Get activity data from report
            $lastActivityDate = $null
            if ($activityLookup.ContainsKey($groupId)) {
                $lastActivityDate = $activityLookup[$groupId].lastActivityDate
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

            # Get display name and other properties (handle both cases)
            $displayName = if ($group.DisplayName) { $group.DisplayName } else { $group.displayName }
            $description = if ($group.Description) { $group.Description } else { $group.description }
            $visibility = if ($group.Visibility) { $group.Visibility } elseif ($group.visibility) { $group.visibility } else { "Private" }
            $createdDt = if ($group.CreatedDateTime) { $group.CreatedDateTime } else { $group.createdDateTime }
            $mail = if ($group.Mail) { $group.Mail } else { $group.mail }
            $classification = if ($group.Classification) { $group.Classification } else { $group.classification }

            # Build output object
            $processedTeam = [PSCustomObject]@{
                id                = $groupId
                displayName       = $displayName
                description       = $description
                visibility        = $visibility
                createdDateTime   = if ($createdDt) { ([DateTime]$createdDt).ToString("o") } else { $null }
                mail              = $mail
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
                classification    = $classification
                flags             = $flags
            }

            $processedTeams += $processedTeam
            $teamCount++

            # Progress indicator every 25 teams
            if ($teamCount % 25 -eq 0) {
                Write-Host "      Processed $teamCount teams..." -ForegroundColor Gray
            }

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
