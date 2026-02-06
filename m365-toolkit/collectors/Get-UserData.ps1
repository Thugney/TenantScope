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
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

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
    $graphUsers = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -All -Property ($selectProperties -join ",") -ExpandProperty "manager(`$select=displayName,id)" -ConsistencyLevel eventual -CountVariable userTotal
    } -OperationName "User retrieval"

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

        # Calculate days since last sign-in using shared utility
        $daysSinceLastSignIn = Get-DaysSinceDate -DateValue $lastSignIn

        # Determine if user is inactive using shared utility
        $activityStatus = Get-ActivityStatus -DaysSinceActivity $daysSinceLastSignIn -InactiveThreshold $inactiveThreshold
        $isInactive = $activityStatus.isInactive

        # Classify user domain using shared utility
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
            id                       = $user.Id
            displayName              = $user.DisplayName
            userPrincipalName        = $user.UserPrincipalName
            mail                     = $user.Mail
            accountEnabled           = $user.AccountEnabled
            userType                 = $user.UserType
            domain                   = $domain
            department               = $user.Department
            jobTitle                 = $user.JobTitle
            companyName              = $user.CompanyName
            officeLocation           = $user.OfficeLocation
            city                     = $user.City
            country                  = $user.Country
            mobilePhone              = $user.MobilePhone
            usageLocation            = $user.UsageLocation
            manager                  = $managerName
            userSource               = $userSource
            createdDateTime          = Format-IsoDate -DateValue $user.CreatedDateTime
            lastSignIn               = Format-IsoDate -DateValue $lastSignIn
            lastNonInteractiveSignIn = Format-IsoDate -DateValue $lastNonInteractiveSignIn
            daysSinceLastSignIn      = $daysSinceLastSignIn
            isInactive               = $isInactive
            onPremSync               = [bool]$user.OnPremisesSyncEnabled
            licenseCount             = $licenseCount
            assignedSkuIds           = $assignedSkuIds
            mfaRegistered            = $true  # Default, will be updated by MFA cross-reference
            flags                    = $flags
        }

        $processedUsers += $processedUser
        $userCount++

        # Progress indicator for large tenants
        if ($userCount % 100 -eq 0) {
            Write-Host "      Processed $userCount users..." -ForegroundColor Gray
        }
    }

    # Save data using shared utility
    Save-CollectorData -Data $processedUsers -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $userCount users" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $userCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
