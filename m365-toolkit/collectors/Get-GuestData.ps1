# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects guest (external) user accounts from Microsoft Entra ID.

.DESCRIPTION
    Retrieves all guest users in the tenant with their invitation status
    and sign-in activity. Identifies stale guests who haven't signed in
    within the configured threshold period.

    Graph API endpoint: GET /users?$filter=userType eq 'Guest'
    Required scopes: User.Read.All, AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes guests.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of guests collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-GuestData.ps1 -Config $config -OutputPath ".\data\guests.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Users

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
$guestCount = 0

try {
    Write-Host "    Collecting guest users from Entra ID..." -ForegroundColor Gray

    # Define properties to retrieve from Graph API
    # Extended properties for security visibility
    $selectProperties = @(
        # Core identity
        "id",
        "displayName",
        "mail",
        "userPrincipalName",
        "accountEnabled",

        # Invitation and external state
        "createdDateTime",
        "creationType",
        "externalUserState",
        "externalUserStateChangeDateTime",

        # Identity providers (critical for security)
        "identities",

        # Organization info (if set)
        "companyName",
        "department",
        "jobTitle",

        # Activity
        "signInActivity"
    )

    # Retrieve all guest users
    $graphGuests = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -Filter "userType eq 'Guest'" -All -Property ($selectProperties -join ",") -ConsistencyLevel eventual
    } -OperationName "Guest user retrieval"

    Write-Host "      Retrieved $($graphGuests.Count) guests from Graph API" -ForegroundColor Gray

    # Get group membership counts for each guest (for access scope visibility)
    # This is critical for security - understanding what guests can access
    Write-Host "      Collecting group memberships for guests..." -ForegroundColor Gray
    $guestGroupMemberships = @{}

    foreach ($guest in $graphGuests) {
        try {
            $memberships = Get-MgUserMemberOf -UserId $guest.Id -All -ErrorAction SilentlyContinue
            $guestGroupMemberships[$guest.Id] = @{
                totalGroups      = ($memberships | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' }).Count
                securityGroups   = ($memberships | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' -and $_.SecurityEnabled }).Count
                m365Groups       = ($memberships | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' -and $_.GroupTypes -contains 'Unified' }).Count
                teams            = ($memberships | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' -and $_.ResourceProvisioningOptions -contains 'Team' }).Count
                directoryRoles   = ($memberships | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.directoryRole' }).Count
            }
        }
        catch {
            $guestGroupMemberships[$guest.Id] = @{
                totalGroups      = 0
                securityGroups   = 0
                m365Groups       = 0
                teams            = 0
                directoryRoles   = 0
            }
        }
    }

    # Get stale threshold from config
    $staleThreshold = $Config.thresholds.staleGuestDays

    # Process each guest
    $processedGuests = @()

    foreach ($guest in $graphGuests) {
        # Extract sign-in activity (may be null without P1/P2)
        $lastSignIn = $null
        if ($guest.SignInActivity) {
            $lastSignIn = $guest.SignInActivity.LastSignInDateTime
        }

        # Calculate days since last sign-in using shared utility
        $daysSinceLastSignIn = Get-DaysSinceDate -DateValue $lastSignIn

        # Determine invitation state
        $invitationState = "Accepted"
        if ($guest.ExternalUserState -eq "PendingAcceptance") {
            $invitationState = "PendingAcceptance"
        }
        elseif ($null -eq $guest.ExternalUserState) {
            $invitationState = "PendingAcceptance"
        }

        # Calculate days since invitation (for pending invitations)
        $daysSinceInvitation = Get-DaysSinceDate -DateValue $guest.CreatedDateTime
        $invitationAge = if ($invitationState -eq "PendingAcceptance") { $daysSinceInvitation } else { $null }

        # Determine if guest is stale using shared utility
        $activityStatus = Get-ActivityStatus -DaysSinceActivity $daysSinceLastSignIn -InactiveThreshold $staleThreshold
        $isStale = $activityStatus.isInactive

        # Determine if guest never signed in
        $neverSignedIn = ($null -eq $lastSignIn -and $invitationState -eq "Accepted")

        # Extract source domain using shared utility
        $sourceDomain = Get-SourceDomain -Email $guest.Mail

        # Extract identity providers (shows how guest authenticates)
        $identityProviders = @()
        $primaryIdentityProvider = "Unknown"
        if ($guest.Identities) {
            foreach ($identity in $guest.Identities) {
                $identityProviders += [PSCustomObject]@{
                    signInType       = $identity.SignInType
                    issuer           = $identity.Issuer
                    issuerAssignedId = $identity.IssuerAssignedId
                }
                # Primary is typically the first one
                if ($identity.SignInType -eq "federated") {
                    $primaryIdentityProvider = $identity.Issuer
                }
                elseif ($identity.SignInType -eq "emailAddress") {
                    $primaryIdentityProvider = "Email OTP"
                }
            }
        }

        # Get group membership data for this guest
        $groupMembership = $guestGroupMemberships[$guest.Id]
        if (-not $groupMembership) {
            $groupMembership = @{ totalGroups = 0; securityGroups = 0; m365Groups = 0; teams = 0; directoryRoles = 0 }
        }

        # Determine if guest has any access (security flag)
        $hasGroupAccess = $groupMembership.totalGroups -gt 0
        $hasAdminRole = $groupMembership.directoryRoles -gt 0

        # Build comprehensive output object
        $processedGuest = [PSCustomObject]@{
            # Core identity
            id                     = $guest.Id
            displayName            = $guest.DisplayName
            mail                   = $guest.Mail
            userPrincipalName      = $guest.UserPrincipalName
            accountEnabled         = $guest.AccountEnabled
            sourceDomain           = $sourceDomain

            # Invitation tracking
            createdDateTime        = Format-IsoDate -DateValue $guest.CreatedDateTime
            creationType           = $guest.CreationType
            invitationState        = $invitationState
            invitationStateChanged = Format-IsoDate -DateValue $guest.ExternalUserStateChangeDateTime
            daysSinceInvitation    = $daysSinceInvitation
            invitationAge          = $invitationAge

            # Identity provider (critical for security)
            primaryIdentityProvider = $primaryIdentityProvider
            identityProviders       = $identityProviders

            # Organization (if set by guest)
            companyName            = $guest.CompanyName
            department             = $guest.Department
            jobTitle               = $guest.JobTitle

            # Activity
            lastSignIn             = Format-IsoDate -DateValue $lastSignIn
            daysSinceLastSignIn    = $daysSinceLastSignIn
            isStale                = $isStale
            neverSignedIn          = $neverSignedIn

            # Access scope (security visibility)
            groupCount             = $groupMembership.totalGroups
            securityGroupCount     = $groupMembership.securityGroups
            m365GroupCount         = $groupMembership.m365Groups
            teamsCount             = $groupMembership.teams
            directoryRoleCount     = $groupMembership.directoryRoles
            hasGroupAccess         = $hasGroupAccess
            hasAdminRole           = $hasAdminRole
        }

        $processedGuests += $processedGuest
        $guestCount++
    }

    # Sort by days since last sign-in (stale guests first)
    $processedGuests = $processedGuests | Sort-Object -Property @{
        Expression = { if ($null -eq $_.daysSinceLastSignIn) { 999999 } else { $_.daysSinceLastSignIn } }
        Descending = $true
    }

    # Save data using shared utility
    Save-CollectorData -Data $processedGuests -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $guestCount guest users" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $guestCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
