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
# HELPER FUNCTIONS
# ============================================================================

function Get-DaysSinceDate {
    <#
    .SYNOPSIS
        Calculates days between a given date and now.

    .PARAMETER DateString
        ISO 8601 formatted date string, or null.

    .OUTPUTS
        Integer number of days, or null if input is null.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $DateString
    )

    if ($null -eq $DateString -or $DateString -eq "") {
        return $null
    }

    try {
        $date = [DateTime]::Parse($DateString)
        $days = ((Get-Date) - $date).Days
        return [Math]::Max(0, $days)
    }
    catch {
        return $null
    }
}

function Get-SourceDomain {
    <#
    .SYNOPSIS
        Extracts the domain from an email address.

    .PARAMETER Email
        The email address to extract domain from.

    .OUTPUTS
        Domain string without the @ symbol, or "unknown" if parsing fails.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        [string]$Email
    )

    if ([string]::IsNullOrWhiteSpace($Email)) {
        return "unknown"
    }

    try {
        $parts = $Email -split "@"
        if ($parts.Count -ge 2) {
            return $parts[-1].ToLower()
        }
        return "unknown"
    }
    catch {
        return "unknown"
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
    # Using filter to only get Guest userType
    $graphGuests = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -Filter "userType eq 'Guest'" -All -Property ($selectProperties -join ",") -ConsistencyLevel eventual
    }

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

        # Calculate days since last sign-in
        $daysSinceLastSignIn = Get-DaysSinceDate -DateString $lastSignIn

        # Determine invitation state
        # externalUserState can be: PendingAcceptance, Accepted, null
        $invitationState = "Accepted"
        if ($guest.ExternalUserState -eq "PendingAcceptance") {
            $invitationState = "PendingAcceptance"
        }
        elseif ($null -eq $guest.ExternalUserState) {
            # If null, likely means pending
            $invitationState = "PendingAcceptance"
        }

        # Determine if guest is stale
        $isStale = $false
        if ($null -ne $daysSinceLastSignIn -and $daysSinceLastSignIn -ge $staleThreshold) {
            $isStale = $true
        }

        # Determine if guest never signed in
        $neverSignedIn = $false
        if ($null -eq $lastSignIn -and $invitationState -eq "Accepted") {
            $neverSignedIn = $true
        }

        # Extract source domain from email
        $sourceDomain = Get-SourceDomain -Email $guest.Mail

        # Build output object
        $processedGuest = [PSCustomObject]@{
            id                  = $guest.Id
            displayName         = $guest.DisplayName
            mail                = $guest.Mail
            sourceDomain        = $sourceDomain
            createdDateTime     = if ($guest.CreatedDateTime) { $guest.CreatedDateTime.ToString("o") } else { $null }
            invitationState     = $invitationState
            lastSignIn          = if ($lastSignIn) { ([DateTime]$lastSignIn).ToString("o") } else { $null }
            daysSinceLastSignIn = $daysSinceLastSignIn
            isStale             = $isStale
            neverSignedIn       = $neverSignedIn
        }

        $processedGuests += $processedGuest
        $guestCount++
    }

    # Sort by days since last sign-in (stale guests first)
    $processedGuests = $processedGuests | Sort-Object -Property @{Expression = {if ($null -eq $_.daysSinceLastSignIn) { 999999 } else { $_.daysSinceLastSignIn }}; Descending = $true}

    # Write results to JSON file
    $processedGuests | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    ✓ Collected $guestCount guest users" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $guestCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    ✗ Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
