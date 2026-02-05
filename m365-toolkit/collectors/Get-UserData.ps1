# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects all user accounts from Microsoft Entra ID via Graph API.

.DESCRIPTION
    Retrieves every user in the tenant with key properties including sign-in
    activity, license assignments, and account status. Classifies users by
    domain (employee vs student) and flags inactive accounts.

    Graph API endpoint: GET /users
    Required scopes: User.Read.All, AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json containing tenant
    settings, domain mappings, and threshold values.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes users.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of users collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-UserData.ps1 -Config $config -OutputPath ".\data\users.json"
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

function Get-DomainClassification {
    <#
    .SYNOPSIS
        Classifies a user's domain based on their UPN suffix.

    .DESCRIPTION
        Compares the user's UPN against configured domain patterns
        to determine if they are an employee, student, or other.

    .PARAMETER UserPrincipalName
        The user's UPN to classify.

    .PARAMETER Config
        Configuration hashtable containing domain mappings.

    .OUTPUTS
        String: "employee", "student", or "other"
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UserPrincipalName,

        [Parameter(Mandatory)]
        [hashtable]$Config
    )

    # Extract domain from UPN (everything after @)
    $upnDomain = "@" + ($UserPrincipalName -split "@")[-1]

    # Check against configured domains
    if ($upnDomain -eq $Config.domains.employees) {
        return "employee"
    }
    elseif ($upnDomain -eq $Config.domains.students) {
        return "student"
    }
    else {
        return "other"
    }
}

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

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling.

    .PARAMETER ScriptBlock
        The script block containing the Graph API call.

    .PARAMETER MaxRetries
        Maximum retry attempts (default 5).

    .PARAMETER BaseBackoffSeconds
        Base backoff time in seconds, doubles each attempt (default 60).
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
$userCount = 0

try {
    Write-Host "    Collecting users from Entra ID..." -ForegroundColor Gray

    # Define properties to retrieve from Graph API
    # signInActivity requires AuditLog.Read.All and Entra ID P1/P2
    $selectProperties = @(
        "id",
        "displayName",
        "userPrincipalName",
        "mail",
        "accountEnabled",
        "createdDateTime",
        "lastPasswordChangeDateTime",
        "userType",
        "department",
        "jobTitle",
        "companyName",
        "officeLocation",
        "city",
        "country",
        "mobilePhone",
        "usageLocation",
        "onPremisesSyncEnabled",
        "assignedLicenses",
        "signInActivity"
    )

    # Retrieve all users with pagination handled by -All parameter
    # Expand manager relationship to get manager display name
    # This may take time for large tenants
    $graphUsers = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -All -Property ($selectProperties -join ",") -ExpandProperty "manager(`$select=displayName,id)" -ConsistencyLevel eventual -CountVariable userTotal
    }

    Write-Host "      Retrieved $($graphUsers.Count) users from Graph API" -ForegroundColor Gray

    # Transform users into our output schema
    $processedUsers = @()
    $inactiveThreshold = $Config.thresholds.inactiveDays

    foreach ($user in $graphUsers) {
        # Skip Guest users - they're collected separately
        if ($user.UserType -eq "Guest") {
            continue
        }

        # Extract sign-in activity (may be null without P1/P2 license)
        $lastSignIn = $null
        $lastNonInteractiveSignIn = $null

        if ($user.SignInActivity) {
            $lastSignIn = $user.SignInActivity.LastSignInDateTime
            $lastNonInteractiveSignIn = $user.SignInActivity.LastNonInteractiveSignInDateTime
        }

        # Calculate days since last sign-in
        $daysSinceLastSignIn = Get-DaysSinceDate -DateString $lastSignIn

        # Determine if user is inactive based on threshold
        $isInactive = $false
        if ($null -ne $daysSinceLastSignIn -and $daysSinceLastSignIn -ge $inactiveThreshold) {
            $isInactive = $true
        }

        # Classify user domain
        $domain = Get-DomainClassification -UserPrincipalName $user.UserPrincipalName -Config $Config

        # Count assigned licenses and extract SKU IDs
        $licenseCount = 0
        $assignedSkuIds = @()
        if ($user.AssignedLicenses) {
            $licenseCount = $user.AssignedLicenses.Count
            $assignedSkuIds = $user.AssignedLicenses | ForEach-Object { $_.SkuId }
        }

        # Build flags array based on user state
        $flags = @()
        if (-not $user.AccountEnabled) {
            $flags += "disabled"
        }
        if ($isInactive) {
            $flags += "inactive"
        }
        # MFA flag will be added by cross-reference step
        # Admin flag will be added by cross-reference step

        # Extract manager display name if available
        $managerName = $null
        if ($user.Manager) {
            $managerName = $user.Manager.AdditionalProperties.displayName
        }

        # Determine user source (cloud-only vs on-premises synced)
        $userSource = if ($user.OnPremisesSyncEnabled) { "On-premises synced" } else { "Cloud" }

        # Build output object matching our schema
        $processedUser = [PSCustomObject]@{
            id                      = $user.Id
            displayName             = $user.DisplayName
            userPrincipalName       = $user.UserPrincipalName
            mail                    = $user.Mail
            accountEnabled          = $user.AccountEnabled
            userType                = $user.UserType
            domain                  = $domain
            department              = $user.Department
            jobTitle                = $user.JobTitle
            companyName             = $user.CompanyName
            officeLocation          = $user.OfficeLocation
            city                    = $user.City
            country                 = $user.Country
            mobilePhone             = $user.MobilePhone
            usageLocation           = $user.UsageLocation
            manager                 = $managerName
            userSource              = $userSource
            createdDateTime         = if ($user.CreatedDateTime) { $user.CreatedDateTime.ToString("o") } else { $null }
            lastSignIn              = if ($lastSignIn) { ([DateTime]$lastSignIn).ToString("o") } else { $null }
            lastNonInteractiveSignIn = if ($lastNonInteractiveSignIn) { ([DateTime]$lastNonInteractiveSignIn).ToString("o") } else { $null }
            daysSinceLastSignIn     = $daysSinceLastSignIn
            isInactive              = $isInactive
            onPremSync              = [bool]$user.OnPremisesSyncEnabled
            licenseCount            = $licenseCount
            assignedSkuIds          = $assignedSkuIds
            mfaRegistered           = $true  # Default, will be updated by MFA cross-reference
            flags                   = $flags
        }

        $processedUsers += $processedUser
        $userCount++

        # Progress indicator for large tenants
        if ($userCount % 100 -eq 0) {
            Write-Host "      Processed $userCount users..." -ForegroundColor Gray
        }
    }

    # Write results to JSON file
    $processedUsers | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    ✓ Collected $userCount users" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $userCount
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
