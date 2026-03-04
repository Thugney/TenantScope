# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects all groups from Microsoft Entra ID via Graph API.

.DESCRIPTION
    Retrieves every group in the tenant including Security, Microsoft 365,
    Distribution, and Mail-enabled Security groups. Collects membership,
    ownership, and cross-references with user license data to identify
    groups used for license assignment.

    Graph API endpoints:
    - GET /groups
    - GET /groups/{id}/members
    - GET /groups/{id}/owners

    Required scopes: Group.Read.All, GroupMember.Read.All, Directory.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json containing tenant
    settings and threshold values.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes groups.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of groups collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-GroupData.ps1 -Config $config -OutputPath ".\data\groups.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Groups

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{},

    [Parameter()]
    [ValidateRange(1, 5000)]
    [int]$MaxGroupMemberDetails = 100,

    [Parameter()]
    [ValidateRange(1, 1000)]
    [int]$MaxGroupOwnerDetails = 100
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-GroupType {
    <#
    .SYNOPSIS
        Determines the group type based on its properties.
    #>
    param($Group)

    $groupTypes = $Group.groupTypes
    $mailEnabled = $Group.mailEnabled
    $securityEnabled = $Group.securityEnabled

    if ($groupTypes -contains "Unified") {
        return "Microsoft 365"
    }
    elseif ($mailEnabled -and $securityEnabled) {
        return "Mail-enabled Security"
    }
    elseif ($mailEnabled -and -not $securityEnabled) {
        return "Distribution"
    }
    elseif ($securityEnabled -and -not $mailEnabled) {
        return "Security"
    }
    else {
        return "Other"
    }
}

function Get-PositiveIntOrDefault {
    <#
    .SYNOPSIS
        Returns a positive integer value or a default fallback.
    #>
    param(
        [AllowNull()]
        $Value,
        [int]$Default
    )

    $parsed = 0
    if ([int]::TryParse([string]$Value, [ref]$parsed) -and $parsed -gt 0) {
        return $parsed
    }

    return $Default
}

function Get-CountFromGraphResponse {
    <#
    .SYNOPSIS
        Parses a Graph $count response (int/string/object) into int or null.
    #>
    param(
        [AllowNull()]
        $Response
    )

    if ($null -eq $Response) {
        return $null
    }

    if ($Response -is [int] -or $Response -is [long]) {
        return [int]$Response
    }

    if ($Response.PSObject -and $Response.PSObject.Properties['value']) {
        $Response = $Response.value
    }

    $parsed = 0
    if ([int]::TryParse([string]$Response, [ref]$parsed)) {
        return $parsed
    }

    return $null
}

function Get-GroupMembers {
    <#
    .SYNOPSIS
        Retrieves group user members up to a configured cap.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$GroupId,
        [ValidateRange(1, 5000)]
        [int]$MaxMembers = 100
    )

    $members = [System.Collections.Generic.List[object]]::new()
    $isTruncated = $false
    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members/microsoft.graph.user?`$select=id,displayName,userPrincipalName,mail,userType&`$top=100"

    try {
        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Group members retrieval"

            if ($response.value) {
                foreach ($member in $response.value) {
                    if ($members.Count -ge $MaxMembers) {
                        $isTruncated = $true
                        break
                    }
                    $members.Add($member)
                }
            }

            if ($members.Count -ge $MaxMembers) {
                if ($response.'@odata.nextLink') {
                    $isTruncated = $true
                }
                break
            }

            $uri = $response.'@odata.nextLink'
        } while ($uri)
    }
    catch {
        # Some groups may not allow member enumeration
    }

    return [PSCustomObject]@{
        Items       = @($members)
        IsTruncated = $isTruncated
    }
}

function Get-GroupOwners {
    <#
    .SYNOPSIS
        Retrieves group owners up to a configured cap.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$GroupId,
        [ValidateRange(1, 1000)]
        [int]$MaxOwners = 100
    )

    $owners = [System.Collections.Generic.List[object]]::new()
    $isTruncated = $false
    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/owners?`$select=id,displayName,userPrincipalName,mail&`$top=100"

    try {
        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Group owners retrieval"

            if ($response.value) {
                foreach ($owner in $response.value) {
                    if ($owners.Count -ge $MaxOwners) {
                        $isTruncated = $true
                        break
                    }
                    $owners.Add($owner)
                }
            }

            if ($owners.Count -ge $MaxOwners) {
                if ($response.'@odata.nextLink') {
                    $isTruncated = $true
                }
                break
            }

            $uri = $response.'@odata.nextLink'
        } while ($uri)
    }
    catch {
        # Some groups may not allow owner enumeration
    }

    return [PSCustomObject]@{
        Items       = @($owners)
        IsTruncated = $isTruncated
    }
}

function Get-GroupDirectoryObjectCount {
    <#
    .SYNOPSIS
        Retrieves exact count for group members/owners via $count endpoint.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$GroupId,
        [Parameter(Mandatory)]
        [ValidateSet("members", "members/microsoft.graph.user", "owners")]
        [string]$CollectionPath,
        [Parameter()]
        [string]$OperationName = "Group count retrieval"
    )

    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/$CollectionPath/`$count"

    try {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -Headers @{ 'ConsistencyLevel' = 'eventual' } -OutputType PSObject
        } -OperationName $OperationName

        return Get-CountFromGraphResponse -Response $response
    }
    catch {
        return $null
    }
}

function Get-GroupGuestCount {
    <#
    .SYNOPSIS
        Retrieves exact guest user count for a group when member list is truncated.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$GroupId
    )

    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members/microsoft.graph.user/`$count?`$filter=userType eq 'Guest'"

    try {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -Headers @{ 'ConsistencyLevel' = 'eventual' } -OutputType PSObject
        } -OperationName "Group guest count retrieval"

        return Get-CountFromGraphResponse -Response $response
    }
    catch {
        return $null
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$groupCount = 0

try {
    Write-Host "    Collecting groups from Entra ID..." -ForegroundColor Gray

    # Define properties to retrieve
    $selectProperties = @(
        "id",
        "displayName",
        "description",
        "mail",
        "mailEnabled",
        "mailNickname",
        "securityEnabled",
        "groupTypes",
        "visibility",
        "createdDateTime",
        "expirationDateTime",
        "membershipRule",
        "membershipRuleProcessingState",
        "onPremisesSyncEnabled",
        "onPremisesLastSyncDateTime",
        "onPremisesDomainName",
        "onPremisesSamAccountName",
        "onPremisesSecurityIdentifier",
        "classification",
        "assignedLabels",
        "resourceProvisioningOptions"
    )

    $uri = "https://graph.microsoft.com/v1.0/groups?`$select=$($selectProperties -join ',')&`$top=100"
    $allGroups = @()

    try {
        $allGroups = Get-GraphAllPages -Uri $uri -OperationName "Groups retrieval"
    }
    catch {
        Write-Host "      [!] Group retrieval failed with full property set. Retrying with reduced properties..." -ForegroundColor Yellow
        $reducedProperties = $selectProperties | Where-Object { $_ -notin @("assignedLabels", "resourceProvisioningOptions") }
        $fallbackUri = "https://graph.microsoft.com/v1.0/groups?`$select=$($reducedProperties -join ',')&`$top=100"
        $allGroups = Get-GraphAllPages -Uri $fallbackUri -OperationName "Groups retrieval (reduced)"
    }

    Write-Host "      Retrieved $($allGroups.Count) groups" -ForegroundColor Gray

    # Share groups data with downstream collectors (Get-TeamsData)
    if ($SharedData -is [hashtable]) {
        $SharedData['Groups'] = $allGroups
    }

    # Optional config override for detail caps
    if ($Config.thresholds -is [hashtable]) {
        if ($Config.thresholds.ContainsKey('maxGroupMemberDetails')) {
            $MaxGroupMemberDetails = Get-PositiveIntOrDefault -Value $Config.thresholds['maxGroupMemberDetails'] -Default $MaxGroupMemberDetails
        }
        if ($Config.thresholds.ContainsKey('maxGroupOwnerDetails')) {
            $MaxGroupOwnerDetails = Get-PositiveIntOrDefault -Value $Config.thresholds['maxGroupOwnerDetails'] -Default $MaxGroupOwnerDetails
        }
    }
    Write-Host "      Group detail caps - members: $MaxGroupMemberDetails, owners: $MaxGroupOwnerDetails" -ForegroundColor DarkGray

    # Load users.json to cross-reference license assignments
    $usersPath = Join-Path (Split-Path $OutputPath -Parent) "users.json"
    $licenseGroupMap = @{}  # Key: groupId -> hashtable(skuId -> assigned user count)
    $skuNameMap = @{}       # Key: skuId -> skuName

    if (Test-Path $usersPath) {
        Write-Host "      Cross-referencing with user license data..." -ForegroundColor Gray
        $usersData = Get-Content $usersPath -Raw | ConvertFrom-Json
        $users = if ($usersData.PSObject.Properties['users']) { $usersData.users } else { $usersData }

        foreach ($user in $users) {
            if (-not $user.assignedLicenses) { continue }

            foreach ($license in $user.assignedLicenses) {
                if (-not $license.assignedViaGroupId -or -not $license.skuId) { continue }

                $groupId = [string]$license.assignedViaGroupId
                $skuId = [string]$license.skuId

                if (-not $licenseGroupMap.ContainsKey($groupId)) {
                    $licenseGroupMap[$groupId] = @{}
                }
                if (-not $licenseGroupMap[$groupId].ContainsKey($skuId)) {
                    $licenseGroupMap[$groupId][$skuId] = 0
                }
                $licenseGroupMap[$groupId][$skuId]++

                # Cache SKU name if available
                if ($license.skuName -and -not $skuNameMap.ContainsKey($skuId)) {
                    $skuNameMap[$skuId] = $license.skuName
                }
            }
        }
    }

    # Load licenses.json for SKU names
    $licensesPath = Join-Path (Split-Path $OutputPath -Parent) "license-skus.json"
    if (Test-Path $licensesPath) {
        $licensesData = Get-Content $licensesPath -Raw | ConvertFrom-Json
        $licenses = if ($licensesData.PSObject.Properties['licenses']) { $licensesData.licenses } else { $licensesData }
        foreach ($lic in $licenses) {
            if ($lic.skuId -and $lic.skuName -and -not $skuNameMap.ContainsKey($lic.skuId)) {
                $skuNameMap[$lic.skuId] = $lic.skuName
            }
        }
    }

    # Process each group
    $processedGroups = [System.Collections.Generic.List[object]]::new()
    $processed = 0
    $totalGroups = $allGroups.Count

    # Summary counters (single-pass accumulation)
    $securityTypeCount = 0
    $m365TypeCount = 0
    $distributionTypeCount = 0
    $mailEnabledSecurityTypeCount = 0
    $cloudOnlyCount = 0
    $onPremSyncedCount = 0
    $withLicenseAssignmentsCount = 0
    $ownerlessCount = 0
    $withGuestsCount = 0
    $dynamicGroupsCount = 0
    $staleSyncCount = 0
    $largeLicenseGroupsCount = 0

    foreach ($group in $allGroups) {
        $processed++
        if ($processed % 50 -eq 0) {
            Write-Host "      Processing group $processed of $totalGroups..." -ForegroundColor Gray
        }

        $groupType = Get-GroupType -Group $group
        $isDynamic = $group.membershipRule -ne $null -and $group.membershipRule -ne ""
        $isM365 = $group.groupTypes -contains "Unified"
        $onPremSync = $group.onPremisesSyncEnabled -eq $true

        # Get members and owners (detail lists are capped for scale)
        $memberResult = Get-GroupMembers -GroupId $group.id -MaxMembers $MaxGroupMemberDetails
        $ownerResult = Get-GroupOwners -GroupId $group.id -MaxOwners $MaxGroupOwnerDetails

        $userMembers = @($memberResult.Items)
        $owners = @($ownerResult.Items)

        $memberCount = $userMembers.Count
        if ($memberResult.IsTruncated) {
            $exactMemberCount = Get-GroupDirectoryObjectCount -GroupId $group.id -CollectionPath "members/microsoft.graph.user" -OperationName "Group members count retrieval"
            if ($null -ne $exactMemberCount) {
                $memberCount = $exactMemberCount
            }
        }

        $ownerCount = $owners.Count
        if ($ownerResult.IsTruncated) {
            $exactOwnerCount = Get-GroupDirectoryObjectCount -GroupId $group.id -CollectionPath "owners" -OperationName "Group owners count retrieval"
            if ($null -ne $exactOwnerCount) {
                $ownerCount = $exactOwnerCount
            }
        }

        $guestCount = @($userMembers | Where-Object { $_.userType -eq 'Guest' }).Count
        if ($memberResult.IsTruncated -and $guestCount -eq 0) {
            $exactGuestCount = Get-GroupGuestCount -GroupId $group.id
            if ($null -ne $exactGuestCount) {
                $guestCount = $exactGuestCount
            }
        }

        # Build license assignments for this group
        $assignedLicenseList = [System.Collections.Generic.List[object]]::new()
        $groupLicenseMap = $licenseGroupMap[[string]$group.id]
        if ($groupLicenseMap) {
            foreach ($licenseEntry in $groupLicenseMap.GetEnumerator()) {
                $skuId = [string]$licenseEntry.Key
                $count = [int]$licenseEntry.Value
                $assignedLicenseList.Add([PSCustomObject]@{
                    skuId = $skuId
                    skuPartNumber = $null
                    skuName = $skuNameMap[$skuId]
                    assignedUserCount = $count
                })
            }
        }
        $assignedLicenses = @($assignedLicenseList | Sort-Object -Property assignedUserCount -Descending)
        $licensedMemberCount = [int](($assignedLicenses | Measure-Object -Property assignedUserCount -Sum).Sum)

        # Calculate on-prem sync age
        $onPremSyncAge = $null
        if ($group.onPremisesLastSyncDateTime) {
            $onPremSyncAge = Get-DaysSinceDate -DateValue $group.onPremisesLastSyncDateTime
        }

        # Build flags
        $flags = @()
        if ($ownerCount -eq 0) { $flags += "ownerless" }
        if ($guestCount -gt 0) { $flags += "has-guests" }
        if ($assignedLicenses.Count -gt 0) { $flags += "has-licenses" }
        if ($isDynamic) { $flags += "dynamic" }
        if ($onPremSync) { $flags += "on-prem-synced" }

        # Build processed group object
        $processedGroup = [PSCustomObject]@{
            id = $group.id
            displayName = $group.displayName
            description = $group.description
            mail = $group.mail
            mailNickname = $group.mailNickname

            groupType = $groupType
            mailEnabled = $group.mailEnabled
            securityEnabled = $group.securityEnabled
            visibility = $group.visibility
            isM365Group = $isM365
            isDynamicGroup = $isDynamic
            membershipRule = $group.membershipRule
            membershipRuleProcessingState = $group.membershipRuleProcessingState

            userSource = if ($onPremSync) { "On-premises synced" } else { "Cloud" }
            onPremSync = $onPremSync
            onPremLastSync = Format-IsoDate -DateValue $group.onPremisesLastSyncDateTime
            onPremSyncAge = $onPremSyncAge
            onPremDomainName = $group.onPremisesDomainName
            onPremSamAccountName = $group.onPremisesSamAccountName

            createdDateTime = Format-IsoDate -DateValue $group.createdDateTime
            expirationDateTime = Format-IsoDate -DateValue $group.expirationDateTime
            classification = $group.classification
            sensitivityLabel = if ($group.assignedLabels -and $group.assignedLabels.Count -gt 0) { $group.assignedLabels[0].displayName } else { $null }

            memberCount = $memberCount
            ownerCount = $ownerCount
            guestMemberCount = $guestCount
            licensedMemberCount = $licensedMemberCount
            membersTruncated = [bool]$memberResult.IsTruncated
            ownersTruncated = [bool]$ownerResult.IsTruncated

            members = @($userMembers | ForEach-Object {
                [PSCustomObject]@{
                    id = $_.id
                    displayName = $_.displayName
                    userPrincipalName = $_.userPrincipalName
                    mail = $_.mail
                    memberType = "User"
                    userType = $_.userType
                }
            })
            owners = @($owners | ForEach-Object {
                [PSCustomObject]@{
                    id = $_.id
                    displayName = $_.displayName
                    userPrincipalName = $_.userPrincipalName
                }
            })

            assignedLicenses = $assignedLicenses
            hasLicenseAssignments = $assignedLicenses.Count -gt 0
            licenseAssignmentCount = $assignedLicenses.Count

            hasNoOwner = $ownerCount -eq 0
            hasGuests = $guestCount -gt 0
            flags = $flags
        }

        $processedGroups.Add($processedGroup)

        switch ($groupType) {
            "Security" { $securityTypeCount++ }
            "Microsoft 365" { $m365TypeCount++ }
            "Distribution" { $distributionTypeCount++ }
            "Mail-enabled Security" { $mailEnabledSecurityTypeCount++ }
        }
        if ($onPremSync) { $onPremSyncedCount++ } else { $cloudOnlyCount++ }
        if ($assignedLicenses.Count -gt 0) { $withLicenseAssignmentsCount++ }
        if ($ownerCount -eq 0) { $ownerlessCount++ }
        if ($guestCount -gt 0) { $withGuestsCount++ }
        if ($isDynamic) { $dynamicGroupsCount++ }
        if ($onPremSync -and $onPremSyncAge -gt 7) { $staleSyncCount++ }
        if ($licensedMemberCount -gt 100) { $largeLicenseGroupsCount++ }
    }

    $groupCount = $processedGroups.Count

    # Build summary statistics
    $summary = [PSCustomObject]@{
        totalGroups = $groupCount
        byType = [PSCustomObject]@{
            security = $securityTypeCount
            microsoft365 = $m365TypeCount
            distribution = $distributionTypeCount
            mailEnabledSecurity = $mailEnabledSecurityTypeCount
        }
        cloudOnly = $cloudOnlyCount
        onPremSynced = $onPremSyncedCount
        withLicenseAssignments = $withLicenseAssignmentsCount
        ownerless = $ownerlessCount
        withGuests = $withGuestsCount
        dynamicGroups = $dynamicGroupsCount
    }

    # Build insights
    $insights = @()

    if ($summary.ownerless -gt 0) {
        $insights += [PSCustomObject]@{
            type = "warning"
            category = "Governance"
            title = "Ownerless Groups"
            description = "$($summary.ownerless) groups have no assigned owners"
            count = $summary.ownerless
            action = "Assign owners to ownerless groups for proper governance"
        }
    }

    if ($staleSyncCount -gt 0) {
        $insights += [PSCustomObject]@{
            type = "warning"
            category = "Sync"
            title = "Stale Directory Sync"
            description = "$staleSyncCount groups have not synced from on-premises in over 7 days"
            count = $staleSyncCount
            action = "Check Azure AD Connect sync status"
        }
    }

    if ($largeLicenseGroupsCount -gt 0) {
        $insights += [PSCustomObject]@{
            type = "info"
            category = "Licensing"
            title = "Large License Groups"
            description = "$largeLicenseGroupsCount groups are used for license assignment with 100+ users"
            count = $largeLicenseGroupsCount
            action = "Review license group membership for accuracy"
        }
    }

    # Build output
    $outputData = [PSCustomObject]@{
        groups = @($processedGroups)
        summary = $summary
        insights = $insights
        collectedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    Save-CollectorData -Data $outputData -OutputPath $OutputPath | Out-Null
    Write-Host "      Saved $groupCount groups" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $groupCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed to collect groups: $errorMessage" -ForegroundColor Red

    # Write empty structure to prevent dashboard errors
    $emptyData = [PSCustomObject]@{
        groups = @()
        summary = [PSCustomObject]@{
            totalGroups = 0
            byType = [PSCustomObject]@{ security = 0; microsoft365 = 0; distribution = 0; mailEnabledSecurity = 0 }
            cloudOnly = 0
            onPremSynced = 0
            withLicenseAssignments = 0
            ownerless = 0
            withGuests = 0
            dynamicGroups = 0
        }
        insights = @()
        collectedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    Save-CollectorData -Data $emptyData -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
