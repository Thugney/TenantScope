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

    Also retrieves enrolled device IDs from Intune to link users to their
    managed devices for endpoint security correlation.

    Graph API endpoints:
    - GET /users
    - GET /deviceManagement/managedDevices (for device linking)

    Required scopes: User.Read.All, AuditLog.Read.All, DeviceManagementManagedDevices.Read.All

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
    # licenseAssignmentStates shows group vs direct assignment
    $selectProperties = @(
        # Core identity
        "id",
        "displayName",
        "userPrincipalName",
        "mail",
        "accountEnabled",
        "createdDateTime",
        "userType",

        # Organization
        "department",
        "jobTitle",
        "companyName",
        "officeLocation",
        "city",
        "country",
        "usageLocation",

        # Contact info
        "mobilePhone",
        "businessPhones",
        "proxyAddresses",
        "otherMails",

        # Employee lifecycle attributes (HR integration)
        "employeeId",
        "employeeType",
        "employeeHireDate",
        "employeeLeaveDateTime",

        # Password management
        "lastPasswordChangeDateTime",
        "passwordPolicies",

        # On-premises sync details (hybrid environments)
        "onPremisesSyncEnabled",
        "onPremisesLastSyncDateTime",
        "onPremisesSamAccountName",
        "onPremisesDistinguishedName",
        "onPremisesDomainName",
        "onPremisesImmutableId",

        # Licensing
        "assignedLicenses",
        "licenseAssignmentStates",

        # Activity (requires P1/P2)
        "signInActivity"
    )

    # Retrieve all users with pagination handled by -All parameter
    # Expand manager with full details for org hierarchy
    $graphUsers = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -All -Property ($selectProperties -join ",") -ExpandProperty "manager(`$select=id,displayName,userPrincipalName,mail)" -ConsistencyLevel eventual -CountVariable userTotal
    } -OperationName "User retrieval"

    Write-Host "      Retrieved $($graphUsers.Count) users from Graph API" -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # Build user-to-device lookup from Intune managed devices
    # This is done once to avoid per-user API calls
    # -----------------------------------------------------------------------
    $userDeviceLookup = @{}
    try {
        Write-Host "      Building user-device mapping from Intune..." -ForegroundColor Gray

        $deviceResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?`$select=id,deviceName,userPrincipalName,userId,managementAgent,complianceState,operatingSystem&`$top=999" `
                -OutputType PSObject
        } -OperationName "Managed devices for user linking"

        $managedDevices = @()
        if ($deviceResponse.value) {
            $managedDevices = @($deviceResponse.value)
        }

        # Handle pagination
        while ($deviceResponse.'@odata.nextLink') {
            $deviceResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $deviceResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Managed devices pagination"
            if ($deviceResponse.value) {
                $managedDevices += $deviceResponse.value
            }
        }

        # Build lookup by userId
        foreach ($device in $managedDevices) {
            $userId = $device.userId
            if ($userId) {
                if (-not $userDeviceLookup.ContainsKey($userId)) {
                    $userDeviceLookup[$userId] = @()
                }
                $userDeviceLookup[$userId] += @{
                    deviceId = $device.id
                    deviceName = $device.deviceName
                    operatingSystem = $device.operatingSystem
                    complianceState = $device.complianceState
                    managementAgent = $device.managementAgent
                }
            }
        }

        Write-Host "      Mapped $($managedDevices.Count) devices to $($userDeviceLookup.Count) users" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Could not retrieve managed devices: $($_.Exception.Message)" -ForegroundColor Yellow
        # Continue without device data - not critical
    }

    # Transform users into our output schema
    $processedUsers = @()
    $inactiveThreshold = $Config.thresholds.inactiveDays
    if ($null -eq $inactiveThreshold -or $inactiveThreshold -le 0) {
        $inactiveThreshold = 90
    }

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

        # Count assigned licenses and extract detailed license information
        $licenseCount = 0
        $assignedSkuIds = @()
        $assignedLicenses = @()
        $directLicenseCount = 0
        $groupLicenseCount = 0
        $hasDisabledPlans = $false

        if ($user.AssignedLicenses) {
            $licenseCount = $user.AssignedLicenses.Count
            $assignedSkuIds = $user.AssignedLicenses | ForEach-Object { $_.SkuId }

            # Build detailed license assignments with disabled plans
            foreach ($license in $user.AssignedLicenses) {
                $disabledPlans = @()
                if ($license.DisabledPlans) {
                    $disabledPlans = @($license.DisabledPlans)
                    if ($disabledPlans.Count -gt 0) {
                        $hasDisabledPlans = $true
                    }
                }

                # Get assignment state for this license (group vs direct)
                $assignmentSource = "Direct"
                $assignedViaGroupId = $null
                $assignmentState = "Active"
                $assignmentError = $null

                $assignmentCounted = $false
                if ($user.LicenseAssignmentStates) {
                    $state = $user.LicenseAssignmentStates | Where-Object { $_.SkuId -eq $license.SkuId } | Select-Object -First 1
                    if ($state) {
                        if ($state.AssignedByGroup) {
                            $assignmentSource = "Group"
                            $assignedViaGroupId = $state.AssignedByGroup
                            $groupLicenseCount++
                        }
                        else {
                            $directLicenseCount++
                        }
                        $assignmentState = $state.State
                        $assignmentError = $state.Error
                        $assignmentCounted = $true
                    }
                }
                if (-not $assignmentCounted) {
                    $directLicenseCount++
                }

                $assignedLicenses += [PSCustomObject]@{
                    skuId              = $license.SkuId
                    disabledPlans      = $disabledPlans
                    disabledPlanCount  = $disabledPlans.Count
                    assignmentSource   = $assignmentSource
                    assignedViaGroupId = $assignedViaGroupId
                    state              = $assignmentState
                    error              = $assignmentError
                }
            }
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

        # Extract full manager details for org hierarchy (not just display name)
        $managerName = $null
        $managerId = $null
        $managerUpn = $null
        $managerMail = $null
        if ($user.Manager) {
            $managerName = $user.Manager.AdditionalProperties.displayName
            $managerId = $user.Manager.Id
            $managerUpn = $user.Manager.AdditionalProperties.userPrincipalName
            $managerMail = $user.Manager.AdditionalProperties.mail

            if (-not $managerName -and $user.Manager.DisplayName) { $managerName = $user.Manager.DisplayName }
            if (-not $managerUpn -and $user.Manager.UserPrincipalName) { $managerUpn = $user.Manager.UserPrincipalName }
            if (-not $managerMail -and $user.Manager.Mail) { $managerMail = $user.Manager.Mail }
        }

        # Determine user source (cloud-only vs on-premises synced)
        $userSource = if ($user.OnPremisesSyncEnabled) { "On-premises synced" } else { "Cloud" }

        # Calculate password age (days since last password change)
        $passwordAge = $null
        $lastPasswordChange = $null
        if ($user.LastPasswordChangeDateTime) {
            $lastPasswordChange = Format-IsoDate -DateValue $user.LastPasswordChangeDateTime
            $passwordAge = Get-DaysSinceDate -DateValue $user.LastPasswordChangeDateTime
        }

        # Parse password policies
        $passwordNeverExpires = $false
        $disableStrongPassword = $false
        if ($user.PasswordPolicies) {
            $passwordNeverExpires = $user.PasswordPolicies -match "DisablePasswordExpiration"
            $disableStrongPassword = $user.PasswordPolicies -match "DisableStrongPassword"
        }

        # Calculate account age (days since creation)
        $accountAge = Get-DaysSinceDate -DateValue $user.CreatedDateTime

        # Calculate days until leave (if employeeLeaveDateTime is set)
        $daysUntilLeave = $null
        if ($user.EmployeeLeaveDateTime) {
            $leaveDate = [DateTime]$user.EmployeeLeaveDateTime
            $daysUntilLeave = ($leaveDate - (Get-Date)).Days
        }

        # Extract on-premises sync details
        $onPremLastSync = $null
        $onPremSyncAge = $null
        if ($user.OnPremisesLastSyncDateTime) {
            $onPremLastSync = Format-IsoDate -DateValue $user.OnPremisesLastSyncDateTime
            $onPremSyncAge = Get-DaysSinceDate -DateValue $user.OnPremisesLastSyncDateTime
        }

        # Build output object matching our schema
        $processedUser = [PSCustomObject]@{
            # Core identity
            id                       = $user.Id
            displayName              = $user.DisplayName
            userPrincipalName        = $user.UserPrincipalName
            mail                     = $user.Mail
            accountEnabled           = $user.AccountEnabled
            userType                 = $user.UserType
            domain                   = $domain

            # Organization
            department               = $user.Department
            jobTitle                 = $user.JobTitle
            companyName              = $user.CompanyName
            officeLocation           = $user.OfficeLocation
            city                     = $user.City
            country                  = $user.Country
            usageLocation            = $user.UsageLocation

            # Manager (full details for org hierarchy)
            manager                  = $managerName
            managerId                = $managerId
            managerUpn               = $managerUpn
            managerMail              = $managerMail

            # Contact info
            mobilePhone              = $user.MobilePhone
            businessPhones           = @($user.BusinessPhones)
            proxyAddresses           = @($user.ProxyAddresses)
            otherMails               = @($user.OtherMails)

            # Employee lifecycle (HR integration)
            employeeId               = $user.EmployeeId
            employeeType             = $user.EmployeeType
            employeeHireDate         = Format-IsoDate -DateValue $user.EmployeeHireDate
            employeeLeaveDateTime    = Format-IsoDate -DateValue $user.EmployeeLeaveDateTime
            daysUntilLeave           = $daysUntilLeave

            # Account lifecycle
            userSource               = $userSource
            createdDateTime          = Format-IsoDate -DateValue $user.CreatedDateTime
            accountAge               = $accountAge

            # Password management
            lastPasswordChange       = $lastPasswordChange
            passwordAge              = $passwordAge
            passwordNeverExpires     = $passwordNeverExpires
            disableStrongPassword    = $disableStrongPassword

            # Activity
            lastSignIn               = Format-IsoDate -DateValue $lastSignIn
            lastNonInteractiveSignIn = Format-IsoDate -DateValue $lastNonInteractiveSignIn
            daysSinceLastSignIn      = $daysSinceLastSignIn
            isInactive               = $isInactive

            # On-premises sync (hybrid)
            onPremSync               = [bool]$user.OnPremisesSyncEnabled
            onPremLastSync           = $onPremLastSync
            onPremSyncAge            = $onPremSyncAge
            onPremSamAccountName     = $user.OnPremisesSamAccountName
            onPremDistinguishedName  = $user.OnPremisesDistinguishedName
            onPremDomainName         = $user.OnPremisesDomainName
            onPremImmutableId        = $user.OnPremisesImmutableId

            # Licensing
            licenseCount             = $licenseCount
            assignedSkuIds           = $assignedSkuIds
            assignedLicenses         = $assignedLicenses
            directLicenseCount       = $directLicenseCount
            groupLicenseCount        = $groupLicenseCount
            hasDisabledPlans         = $hasDisabledPlans

            # Security
            mfaRegistered            = $true  # Default, will be updated by MFA cross-reference
            flags                    = $flags

            # Enrolled devices (from Intune)
            enrolledDevices          = if ($userDeviceLookup.ContainsKey($user.Id)) { $userDeviceLookup[$user.Id] } else { @() }
            enrolledDeviceCount      = if ($userDeviceLookup.ContainsKey($user.Id)) { $userDeviceLookup[$user.Id].Count } else { 0 }
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
