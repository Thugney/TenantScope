# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects soft-deleted (recycle bin) users from Microsoft Entra ID.

.DESCRIPTION
    Retrieves all users in the Entra ID recycle bin awaiting permanent deletion.
    These users can be restored within 30 days of deletion. This is critical
    for lifecycle management and security visibility.

    Graph API endpoint: GET /directory/deletedItems/microsoft.graph.user
    Required scopes: User.Read.All, Directory.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes deleted-users.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of deleted users collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-DeletedUsers.ps1 -Config $config -OutputPath ".\data\deleted-users.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.DirectoryManagement

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
$deletedCount = 0

try {
    Write-Host "    Collecting deleted users from recycle bin..." -ForegroundColor Gray

    # Retrieve all deleted users from the directory recycle bin
    $deletedUsers = $null

    try {
        # Try using the direct cmdlet first
        $deletedUsers = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgDirectoryDeletedItemAsUser -All
        } -OperationName "Deleted user retrieval"
    }
    catch {
        # Fallback to direct API call
        Write-Host "      Trying alternative method..." -ForegroundColor Gray

        try {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/directory/deletedItems/microsoft.graph.user" -OutputType PSObject
            } -OperationName "Deleted users (direct API)"

            # Handle paged results
            if ($response.value) {
                $allDeleted = $response.value
                while ($response.'@odata.nextLink') {
                    $response = Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
                    $allDeleted += $response.value
                }
                $deletedUsers = $allDeleted
            }
        }
        catch {
            throw "Unable to retrieve deleted users: $($_.Exception.Message)"
        }
    }

    if ($null -eq $deletedUsers) {
        $deletedUsers = @()
    }

    Write-Host "      Retrieved $($deletedUsers.Count) deleted users from recycle bin" -ForegroundColor Gray

    # Process each deleted user
    $processedDeleted = @()

    foreach ($user in $deletedUsers) {
        # Handle both PascalCase (cmdlet) and camelCase (direct API) property names
        $userId = Get-GraphPropertyValue -Object $user -PropertyNames @("id", "Id")
        $upn = Get-GraphPropertyValue -Object $user -PropertyNames @("userPrincipalName", "UserPrincipalName")
        $displayName = Get-GraphPropertyValue -Object $user -PropertyNames @("displayName", "DisplayName")
        $mail = Get-GraphPropertyValue -Object $user -PropertyNames @("mail", "Mail")
        $userType = Get-GraphPropertyValue -Object $user -PropertyNames @("userType", "UserType")
        $department = Get-GraphPropertyValue -Object $user -PropertyNames @("department", "Department")
        $jobTitle = Get-GraphPropertyValue -Object $user -PropertyNames @("jobTitle", "JobTitle")

        # Get deletion timestamp
        $deletedDateTime = $null
        $deletedDateTime = Get-GraphPropertyValue -Object $user -PropertyNames @("deletedDateTime", "DeletedDateTime")

        # Calculate days until permanent deletion (30 days from deletion)
        $daysSinceDeletion = $null
        $daysUntilPermanentDeletion = $null
        $permanentDeletionDate = $null

        if ($deletedDateTime) {
            $deletedDate = [DateTime]$deletedDateTime
            $daysSinceDeletion = ((Get-Date) - $deletedDate).Days

            # Permanent deletion happens 30 days after soft delete
            $permanentDeletionDate = $deletedDate.AddDays(30)
            $daysUntilPermanentDeletion = ($permanentDeletionDate - (Get-Date)).Days

            # Clamp to 0 if already past (shouldn't happen but be safe)
            if ($daysUntilPermanentDeletion -lt 0) {
                $daysUntilPermanentDeletion = 0
            }
        }

        # Urgency classification
        $urgency = "Normal"
        if ($null -ne $daysUntilPermanentDeletion) {
            if ($daysUntilPermanentDeletion -le 3) {
                $urgency = "Critical"
            }
            elseif ($daysUntilPermanentDeletion -le 7) {
                $urgency = "High"
            }
            elseif ($daysUntilPermanentDeletion -le 14) {
                $urgency = "Medium"
            }
        }

        # Determine if this was a guest
        $isGuest = $userType -eq "Guest"

        # Extract source domain
        $sourceDomain = Get-SourceDomain -Email $upn

        # Build output object
        $deletedUser = [PSCustomObject]@{
            # Core identity
            id                          = $userId
            displayName                 = $displayName
            userPrincipalName           = $upn
            mail                        = $mail
            userType                    = $userType
            isGuest                     = $isGuest
            sourceDomain                = $sourceDomain

            # Organization (if set)
            department                  = $department
            jobTitle                    = $jobTitle

            # Deletion lifecycle
            deletedDateTime             = Format-IsoDate -DateValue $deletedDateTime
            daysSinceDeletion           = $daysSinceDeletion
            permanentDeletionDate       = Format-IsoDate -DateValue $permanentDeletionDate
            daysUntilPermanentDeletion  = $daysUntilPermanentDeletion
            urgency                     = $urgency
        }

        $processedDeleted += $deletedUser
        $deletedCount++
    }

    # Sort by urgency (critical first) then by days until permanent deletion
    $processedDeleted = $processedDeleted | Sort-Object -Property @{
        Expression = {
            switch ($_.urgency) {
                "Critical" { 0 }
                "High" { 1 }
                "Medium" { 2 }
                default { 3 }
            }
        }
    }, @{
        Expression = { $_.daysUntilPermanentDeletion }
        Ascending = $true
    }

    # Save data using shared utility
    Save-CollectorData -Data $processedDeleted -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $deletedCount deleted users" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $deletedCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
