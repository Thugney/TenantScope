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
    [hashtable]$SharedData = @{}
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

function Get-GroupMembers {
    <#
    .SYNOPSIS
        Retrieves members for a group with pagination.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$GroupId,
        [int]$MaxMembers = 1000
    )

    $members = @()
    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/members?`$select=id,displayName,userPrincipalName,mail,userType&`$top=100"

    try {
        do {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "Group members retrieval"

            if ($response.value) {
                $members += $response.value
            }

            $uri = $response.'@odata.nextLink'

            if ($members.Count -ge $MaxMembers) {
                break
            }
        } while ($uri)
    }
    catch {
        # Some groups may not allow member enumeration
    }

    return $members
}

function Get-GroupOwners {
    <#
    .SYNOPSIS
        Retrieves owners for a group.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$GroupId
    )

    $owners = @()
    $uri = "https://graph.microsoft.com/v1.0/groups/$GroupId/owners?`$select=id,displayName,userPrincipalName,mail"

    try {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
        } -OperationName "Group owners retrieval"

        if ($response.value) {
            $owners = $response.value
        }
    }
    catch {
        # Some groups may not allow owner enumeration
    }

    return $owners
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

    # Load users.json to cross-reference license assignments
    $usersPath = Join-Path (Split-Path $OutputPath -Parent) "users.json"
    $licenseGroupMap = @{}  # Key: "groupId|skuId" -> count
    $skuNameMap = @{}       # Key: skuId -> skuName

    if (Test-Path $usersPath) {
        Write-Host "      Cross-referencing with user license data..." -ForegroundColor Gray
        $usersData = Get-Content $usersPath -Raw | ConvertFrom-Json
        $users = if ($usersData.PSObject.Properties['users']) { $usersData.users } else { $usersData }

        foreach ($user in $users) {
            if ($user.assignedLicenses) {
                foreach ($license in $user.assignedLicenses) {
                    if ($license.assignedViaGroupId -and $license.skuId) {
                        $key = "$($license.assignedViaGroupId)|$($license.skuId)"
                        if (-not $licenseGroupMap.ContainsKey($key)) {
                            $licenseGroupMap[$key] = 0
                        }
                        $licenseGroupMap[$key]++

                        # Cache SKU name if available
                        if ($license.skuName -and -not $skuNameMap.ContainsKey($license.skuId)) {
                            $skuNameMap[$license.skuId] = $license.skuName
                        }
                    }
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
    $processedGroups = @()
    $processed = 0
    $totalGroups = $allGroups.Count

    foreach ($group in $allGroups) {
        $processed++
        if ($processed % 50 -eq 0) {
            Write-Host "      Processing group $processed of $totalGroups..." -ForegroundColor Gray
        }

        $groupType = Get-GroupType -Group $group
        $isDynamic = $group.membershipRule -ne $null -and $group.membershipRule -ne ""
        $isM365 = $group.groupTypes -contains "Unified"
        $onPremSync = $group.onPremisesSyncEnabled -eq $true

        # Get members and owners
        $members = Get-GroupMembers -GroupId $group.id
        $owners = Get-GroupOwners -GroupId $group.id

        # Count member types
        $userMembers = @($members | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.user' -or $_.userPrincipalName })
        $guestCount = @($userMembers | Where-Object { $_.userType -eq 'Guest' }).Count

        # Build license assignments for this group
        $assignedLicenses = @()
        $licenseGroupMap.Keys | Where-Object { $_ -like "$($group.id)|*" } | ForEach-Object {
            $parts = $_ -split '\|'
            $skuId = $parts[1]
            $count = $licenseGroupMap[$_]
            $assignedLicenses += [PSCustomObject]@{
                skuId = $skuId
                skuPartNumber = $null
                skuName = $skuNameMap[$skuId]
                assignedUserCount = $count
            }
        }

        # Calculate on-prem sync age
        $onPremSyncAge = $null
        if ($group.onPremisesLastSyncDateTime) {
            $onPremSyncAge = Get-DaysSinceDate -DateValue $group.onPremisesLastSyncDateTime
        }

        # Build flags
        $flags = @()
        if ($owners.Count -eq 0) { $flags += "ownerless" }
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

            memberCount = $userMembers.Count
            ownerCount = $owners.Count
            guestMemberCount = $guestCount
            licensedMemberCount = [int](($assignedLicenses | Measure-Object -Property assignedUserCount -Sum).Sum)

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

            hasNoOwner = $owners.Count -eq 0
            hasGuests = $guestCount -gt 0
            flags = $flags
        }

        $processedGroups += $processedGroup
    }

    $groupCount = $processedGroups.Count

    # Build summary statistics
    $summary = [PSCustomObject]@{
        totalGroups = $groupCount
        byType = [PSCustomObject]@{
            security = @($processedGroups | Where-Object { $_.groupType -eq "Security" }).Count
            microsoft365 = @($processedGroups | Where-Object { $_.groupType -eq "Microsoft 365" }).Count
            distribution = @($processedGroups | Where-Object { $_.groupType -eq "Distribution" }).Count
            mailEnabledSecurity = @($processedGroups | Where-Object { $_.groupType -eq "Mail-enabled Security" }).Count
        }
        cloudOnly = @($processedGroups | Where-Object { $_.userSource -eq "Cloud" }).Count
        onPremSynced = @($processedGroups | Where-Object { $_.userSource -eq "On-premises synced" }).Count
        withLicenseAssignments = @($processedGroups | Where-Object { $_.hasLicenseAssignments }).Count
        ownerless = @($processedGroups | Where-Object { $_.hasNoOwner }).Count
        withGuests = @($processedGroups | Where-Object { $_.hasGuests }).Count
        dynamicGroups = @($processedGroups | Where-Object { $_.isDynamicGroup }).Count
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

    $staleSync = @($processedGroups | Where-Object { $_.onPremSync -and $_.onPremSyncAge -gt 7 })
    if ($staleSync.Count -gt 0) {
        $insights += [PSCustomObject]@{
            type = "warning"
            category = "Sync"
            title = "Stale Directory Sync"
            description = "$($staleSync.Count) groups have not synced from on-premises in over 7 days"
            count = $staleSync.Count
            action = "Check Azure AD Connect sync status"
        }
    }

    $largeLicenseGroups = @($processedGroups | Where-Object { $_.licensedMemberCount -gt 100 })
    if ($largeLicenseGroups.Count -gt 0) {
        $insights += [PSCustomObject]@{
            type = "info"
            category = "Licensing"
            title = "Large License Groups"
            description = "$($largeLicenseGroups.Count) groups are used for license assignment with 100+ users"
            count = $largeLicenseGroups.Count
            action = "Review license group membership for accuracy"
        }
    }

    # Build output
    $outputData = [PSCustomObject]@{
        groups = $processedGroups
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
