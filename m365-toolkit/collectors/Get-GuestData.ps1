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
$guestCount = 0

try {
    Write-Host "    Collecting guest users from Entra ID..." -ForegroundColor Gray

    # Define properties to retrieve from Graph API
    $selectProperties = @(
        "id",
        "displayName",
        "mail",
        "userPrincipalName",
        "createdDateTime",
        "externalUserState",
        "externalUserStateChangeDateTime",
        "signInActivity"
    )

    # Retrieve all guest users
    $graphGuests = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -Filter "userType eq 'Guest'" -All -Property ($selectProperties -join ",") -ConsistencyLevel eventual
    } -OperationName "Guest user retrieval"

    Write-Host "      Retrieved $($graphGuests.Count) guests from Graph API" -ForegroundColor Gray

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

        # Determine if guest is stale using shared utility
        $activityStatus = Get-ActivityStatus -DaysSinceActivity $daysSinceLastSignIn -InactiveThreshold $staleThreshold
        $isStale = $activityStatus.isInactive

        # Determine if guest never signed in
        $neverSignedIn = ($null -eq $lastSignIn -and $invitationState -eq "Accepted")

        # Extract source domain using shared utility
        $sourceDomain = Get-SourceDomain -Email $guest.Mail

        # Build output object
        $processedGuest = [PSCustomObject]@{
            id                  = $guest.Id
            displayName         = $guest.DisplayName
            mail                = $guest.Mail
            sourceDomain        = $sourceDomain
            createdDateTime     = Format-IsoDate -DateValue $guest.CreatedDateTime
            invitationState     = $invitationState
            lastSignIn          = Format-IsoDate -DateValue $lastSignIn
            daysSinceLastSignIn = $daysSinceLastSignIn
            isStale             = $isStale
            neverSignedIn       = $neverSignedIn
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
