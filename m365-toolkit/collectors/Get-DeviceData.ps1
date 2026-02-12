# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Intune managed device data from Microsoft Graph.

.DESCRIPTION
    Retrieves all devices managed by Microsoft Intune including compliance
    status, encryption state, and last sync time. Identifies stale devices
    that haven't synced within the configured threshold.

    Graph API endpoint: GET /deviceManagement/managedDevices
    Required scope: DeviceManagementManagedDevices.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes devices.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of devices collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-DeviceData.ps1 -Config $config -OutputPath ".\data\devices.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.DeviceManagement

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
# LOCAL HELPER FUNCTIONS
# Device-specific functions that don't belong in CollectorBase
# ============================================================================

function Get-ComplianceState {
    <#
    .SYNOPSIS
        Maps Intune compliance state to our schema values.
    .PARAMETER IntuneState
        The compliance state from Intune.
    .PARAMETER GracePeriodAsNoncompliant
        If true, devices in grace period are counted as noncompliant.
        If false, they are counted as a separate "inGracePeriod" state.
    #>
    param(
        [string]$IntuneState,
        [bool]$GracePeriodAsNoncompliant = $true
    )

    switch ($IntuneState) {
        "compliant"     { return "compliant" }
        "noncompliant"  { return "noncompliant" }
        "conflict"      { return "noncompliant" }
        "error"         { return "unknown" }
        "inGracePeriod" {
            if ($GracePeriodAsNoncompliant) { return "noncompliant" }
            else { return "inGracePeriod" }
        }
        "configManager" { return "unknown" }
        default         { return "unknown" }
    }
}

function Get-DeviceOwnership {
    <#
    .SYNOPSIS
        Maps Intune ownership type to our schema values.
    #>
    param([string]$OwnerType)

    switch ($OwnerType) {
        "personal" { return "personal" }
        "company"  { return "corporate" }
        default    { return "corporate" }
    }
}

function Get-ManagementAgent {
    <#
    .SYNOPSIS
        Maps Intune management agent to our schema values.
    #>
    param([string]$Agent)

    switch ($Agent) {
        "mdm"                           { return "mdm" }
        "easMdm"                        { return "easMdm" }
        "configurationManagerClient"    { return "configManager" }
        "configurationManagerClientMdm" { return "configManager" }
        default                         { return $Agent }
    }
}

function Get-EnrollmentTypeDisplay {
    <#
    .SYNOPSIS
        Returns a readable enrollment type label.
    #>
    param([string]$EnrollmentType)

    switch ($EnrollmentType) {
        "userEnrollment"                    { return "User Enrollment" }
        "deviceEnrollmentManager"           { return "DEM" }
        "appleBulkWithUser"                 { return "Apple Bulk (User)" }
        "appleBulkWithoutUser"              { return "Apple Bulk" }
        "windowsAzureADJoin"                { return "Azure AD Join" }
        "windowsBulkUserless"               { return "Bulk Userless" }
        "windowsAutoEnrollment"             { return "Auto Enrollment" }
        "windowsBulkAzureDomainJoin"        { return "Bulk Domain Join" }
        "windowsCoManagement"               { return "Co-Management" }
        "windowsAzureADJoinUsingDeviceAuth" { return "Device Auth Join" }
        "appleUserEnrollment"               { return "Apple User Enroll" }
        "appleUserEnrollmentWithServiceAccount" { return "Apple User + SA" }
        "azureAdJoinUsingAzureVmExtension"  { return "Azure VM Join" }
        "androidEnterpriseDedicatedDevice"  { return "Android Dedicated" }
        "androidEnterpriseFullyManaged"     { return "Android Fully Managed" }
        "androidEnterpriseCorporateWorkProfile" { return "Android Work Profile" }
        default                             { return $EnrollmentType }
    }
}

function Get-RegistrationStateDisplay {
    <#
    .SYNOPSIS
        Returns a readable device registration state.
    #>
    param([string]$State)

    switch ($State) {
        "notRegistered"                     { return "Not Registered" }
        "registered"                        { return "Registered" }
        "revoked"                           { return "Revoked" }
        "keyConflict"                       { return "Key Conflict" }
        "approvalPending"                   { return "Approval Pending" }
        "certificateReset"                  { return "Certificate Reset" }
        "notRegisteredPendingEnrollment"    { return "Pending Enrollment" }
        "unknown"                           { return "Unknown" }
        default                             { return $State }
    }
}

function Get-ThreatStateDisplay {
    <#
    .SYNOPSIS
        Returns a readable partner threat state.
    #>
    param([string]$State)

    switch ($State) {
        "unknown"        { return "Unknown" }
        "activated"      { return "Active" }
        "deactivated"    { return "Deactivated" }
        "secured"        { return "Secured" }
        "lowSeverity"    { return "Low" }
        "mediumSeverity" { return "Medium" }
        "highSeverity"   { return "High" }
        "unresponsive"   { return "Unresponsive" }
        "compromised"    { return "Compromised" }
        "misconfigured"  { return "Misconfigured" }
        default          { return $State }
    }
}

function Get-ExchangeAccessStateDisplay {
    <#
    .SYNOPSIS
        Returns a readable Exchange access state.
    #>
    param([string]$State)

    switch ($State) {
        "none"        { return "None" }
        "unknown"     { return "Unknown" }
        "allowed"     { return "Allowed" }
        "blocked"     { return "Blocked" }
        "quarantined" { return "Quarantined" }
        default       { return $State }
    }
}

function Get-ChassisType {
    <#
    .SYNOPSIS
        Determines chassis type from device model string.
    #>
    param([string]$Model, [string]$OS)

    if ([string]::IsNullOrWhiteSpace($Model)) { return $null }

    $modelLower = $Model.ToLower()

    # Mobile devices
    if ($OS -eq "iOS" -or $OS -eq "Android") {
        if ($modelLower -match "ipad|tablet|tab") { return "Tablet" }
        return "Phone"
    }

    # Apple Mac
    if ($modelLower -match "macbook") { return "Laptop" }
    if ($modelLower -match "imac|mac mini|mac pro|mac studio") { return "Desktop" }

    # Windows/Other
    if ($modelLower -match "surface pro|surface go") { return "Tablet" }
    if ($modelLower -match "thinkpad|latitude|elitebook|probook|zbook|precision|xps|inspiron|pavilion|envy|spectre|surface laptop|macbook|ideapad|yoga") { return "Laptop" }
    if ($modelLower -match "optiplex|prodesk|thinkcentre|elitedesk|tower|desktop|workstation") { return "Desktop" }

    return $null
}

function Get-DirectoryOwnership {
    <#
    .SYNOPSIS
        Maps Entra directory device ownership values to our schema.
    #>
    param([string]$OwnerType)

    switch ($OwnerType) {
        "company"   { return "corporate" }
        "corporate" { return "corporate" }
        "personal"  { return "personal" }
        default     { return "unknown" }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$deviceCount = 0

try {
    Write-Host "    Collecting Intune managed devices..." -ForegroundColor Gray

    # Get stale threshold from config
    $staleThreshold = $Config.thresholds.staleDeviceDays
    if ($null -eq $staleThreshold -or $staleThreshold -le 0) {
        $staleThreshold = 90
    }

    # Get grace period handling from config (default: count as noncompliant for backward compatibility)
    $gracePeriodAsNoncompliant = $Config.thresholds.gracePeriodAsNoncompliant
    if ($null -eq $gracePeriodAsNoncompliant) {
        $gracePeriodAsNoncompliant = $true
    }

    # Retrieve all managed devices from Intune with extended properties
    # Using direct API call to get all properties including those requiring $select
    $managedDevices = $null

    try {
        # Try using cmdlet with -Property for all needed fields
        $managedDevices = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgDeviceManagementManagedDevice -All -Property @(
                "id", "deviceName", "userPrincipalName", "operatingSystem", "osVersion",
                "complianceState", "lastSyncDateTime", "enrolledDateTime",
                "managedDeviceOwnerType", "manufacturer", "model", "serialNumber",
                "isEncrypted", "managementAgent",
                "userDisplayName", "deviceCategoryDisplayName",
                "totalStorageSpaceInBytes", "freeStorageSpaceInBytes", "wiFiMacAddress",
                "azureADDeviceId", "deviceEnrollmentType", "deviceRegistrationState",
                "jailBroken", "isSupervised", "partnerReportedThreatState",
                "exchangeAccessState", "exchangeAccessStateReason", "exchangeLastSuccessfulSyncDateTime",
                "physicalMemoryInBytes", "ethernetMacAddress", "phoneNumber", "subscriberCarrier",
                "imei", "meid", "iccid", "udid", "enrollmentProfileName",
                "androidSecurityPatchLevel", "complianceGracePeriodExpirationDateTime",
                "notes", "managedDeviceName", "userId", "emailAddress",
                "azureADRegistered", "easActivated", "easActivationDateTime", "easDeviceId"
            )
        } -OperationName "Intune device retrieval"
    }
    catch {
        # Fallback to basic retrieval if extended properties fail
        Write-Host "      Extended properties unavailable, using standard retrieval..." -ForegroundColor Yellow
        $managedDevices = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgDeviceManagementManagedDevice -All
        } -OperationName "Intune device retrieval (fallback)"
    }

    Write-Host "      Retrieved $($managedDevices.Count) devices from Intune" -ForegroundColor Gray

    # Share managed devices with downstream collectors (BitLockerStatus, WindowsUpdateStatus, UserData)
    # so they don't need to re-fetch from the API
    if ($SharedData -is [hashtable]) {
        $SharedData['ManagedDevices'] = $managedDevices
    }

    # Build lookup for Azure AD device IDs to avoid duplicates when adding Entra-only devices
    $managedAzureAdIds = @{}
    foreach ($device in $managedDevices) {
        $aadId = $device.AzureADDeviceId
        if (-not [string]::IsNullOrWhiteSpace($aadId)) {
            $managedAzureAdIds[$aadId] = $true
        }
    }

    # Retrieve Entra ID devices that are not Intune-managed
    # Include $expand=registeredOwners to get user info for Entra-only devices
    $entraDevices = @()
    try {
        Write-Host "    Collecting Entra ID registered devices..." -ForegroundColor Gray
        $entraDevices = Get-GraphAllPages -Uri "https://graph.microsoft.com/v1.0/devices?`$select=id,deviceId,displayName,operatingSystem,operatingSystemVersion,trustType,registrationDateTime,approximateLastSignInDateTime,isCompliant,isManaged,accountEnabled,deviceOwnership&`$expand=registeredOwners(`$select=id,displayName,userPrincipalName)" -OperationName "Entra device retrieval"

        if ($entraDevices.Count -gt 0) {
            $entraDevices = @($entraDevices | Where-Object {
                $entraAadId = $_.deviceId
                if ([string]::IsNullOrWhiteSpace($entraAadId)) { return $true }
                return -not $managedAzureAdIds.ContainsKey($entraAadId)
            })
            Write-Host "      Retrieved $($entraDevices.Count) Entra-only devices (not managed by Intune)" -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "      [!] Could not retrieve Entra ID devices: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Entra devices: $($_.Exception.Message)"
        $entraDevices = @()
    }

    # Collect Autopilot device identities and build serial number lookup
    $autopilotSerialLookup = @{}
    try {
        Write-Host "    Collecting Windows Autopilot device identities..." -ForegroundColor Gray
        $autopilotDevices = @()

        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsAutopilotDeviceIdentities" `
                -OutputType PSObject
        } -OperationName "Autopilot device retrieval"

        if ($response.value) {
            $autopilotDevices = @($response.value)
        }

        # Handle pagination
        while ($response.'@odata.nextLink') {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Autopilot device pagination"
            if ($response.value) {
                $autopilotDevices += $response.value
            }
        }

        Write-Host "      Retrieved $($autopilotDevices.Count) Autopilot devices" -ForegroundColor Gray

        # Build lookup by serial number (case-insensitive)
        foreach ($apDevice in $autopilotDevices) {
            if (-not [string]::IsNullOrWhiteSpace($apDevice.serialNumber)) {
                $serialLower = $apDevice.serialNumber.ToLower()
                $autopilotSerialLookup[$serialLower] = $apDevice
            }
        }

        # Debug: Show profile status breakdown from Autopilot data
        $statusCounts = @{}
        foreach ($ap in $autopilotDevices) {
            $status = if ($ap.deploymentProfileAssignmentStatus) { $ap.deploymentProfileAssignmentStatus.ToString() } else { "(null)" }
            if (-not $statusCounts.ContainsKey($status)) { $statusCounts[$status] = 0 }
            $statusCounts[$status]++
        }
        $statusSummary = ($statusCounts.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join ", "
        Write-Host "      Autopilot profile status breakdown: $statusSummary" -ForegroundColor Gray
    }
    catch {
        Write-Host "      [!] Could not retrieve Autopilot devices: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Autopilot devices: $($_.Exception.Message)"
    }

    # Process each device
    $processedDevices = @()
    $policyStateSupported = $true
    $policyStateErrorLogged = $false

    foreach ($device in $managedDevices) {
        # Calculate days since last sync using shared utility
        $daysSinceSync = Get-DaysSinceDate -DateValue $device.LastSyncDateTime

        # Determine if device is stale using shared utility
        $activityStatus = Get-ActivityStatus -DaysSinceActivity $daysSinceSync -InactiveThreshold $staleThreshold
        $isStale = $activityStatus.isInactive

        $encValue = Get-GraphPropertyValue -Object $device -PropertyNames @("isEncrypted", "IsEncrypted")
        $isEncryptedValue = if ($null -eq $encValue) { $null } else { [bool]$encValue }

        # Map compliance state
        $complianceState = Get-ComplianceState -IntuneState $device.ComplianceState -GracePeriodAsNoncompliant $gracePeriodAsNoncompliant

        # Map ownership
        $ownership = Get-DeviceOwnership -OwnerType $device.ManagedDeviceOwnerType

        # Map management agent
        $managementAgent = Get-ManagementAgent -Agent $device.ManagementAgent

        # Calculate certificate expiry using shared utilities
        $daysUntilCertExpiry = Get-DaysUntilDate -DateValue $device.ManagedDeviceCertificateExpirationDate
        $certStatus = Get-CertificateStatus -DaysUntilExpiry $daysUntilCertExpiry

        # Get Windows lifecycle info using shared utility
        $winLifecycle = Get-WindowsLifecycleInfo -OsVersion $device.OsVersion

        # Get simplified OS for processing
        $simplifiedOS = Get-SimplifiedOS -OperatingSystem $device.OperatingSystem

        # Calculate physical memory in GB
        $physicalMemoryGB = $null
        if ($device.PhysicalMemoryInBytes -and $device.PhysicalMemoryInBytes -gt 0) {
            $physicalMemoryGB = [Math]::Round($device.PhysicalMemoryInBytes / 1GB, 1)
        }

        # Calculate compliance grace period days
        $graceExpiryDays = Get-DaysUntilDate -DateValue $device.ComplianceGracePeriodExpirationDateTime
        $inGracePeriod = $null -ne $graceExpiryDays -and $graceExpiryDays -gt 0

        # Check if device is in Autopilot registry by serial number (more reliable than AutopilotEnrolled property)
        $isInAutopilot = $false
        $autopilotRecord = $null
        if (-not [string]::IsNullOrWhiteSpace($device.SerialNumber)) {
            $serialLower = $device.SerialNumber.ToLower()
            if ($autopilotSerialLookup.ContainsKey($serialLower)) {
                $isInAutopilot = $true
                $autopilotRecord = $autopilotSerialLookup[$serialLower]
            }
        }

        # Optional: compliance policy state details (only for non-compliant/unknown)
        $nonCompliantPolicyCount = $null
        $nonCompliantPolicies = @()
        if ($policyStateSupported -and $complianceState -ne "compliant") {
            try {
                $policyStates = Get-GraphAllPages -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$($device.Id)/deviceCompliancePolicyStates" -OperationName "Device compliance policy states"
                if ($policyStates.Count -gt 0) {
                    foreach ($state in $policyStates) {
                        $stateValue = $state.state
                        if ($stateValue -and $stateValue -ne "compliant") {
                            if ($state.displayName) {
                                $nonCompliantPolicies += $state.displayName
                            }
                        }
                    }
                    $nonCompliantPolicyCount = $nonCompliantPolicies.Count
                }
            }
            catch {
                if (-not $policyStateErrorLogged) {
                    $errors += "Compliance policy states: $($_.Exception.Message)"
                    $policyStateErrorLogged = $true
                }
                $policyStateSupported = $false
            }
        }

        # Determine threat level severity
        $threatSeverity = $null
        if ($device.PartnerReportedThreatState) {
            switch ($device.PartnerReportedThreatState) {
                "compromised"    { $threatSeverity = "critical" }
                "highSeverity"   { $threatSeverity = "high" }
                "mediumSeverity" { $threatSeverity = "medium" }
                "lowSeverity"    { $threatSeverity = "low" }
                "secured"        { $threatSeverity = "none" }
                default          { $threatSeverity = "unknown" }
            }
        }

        # Build output object with ALL properties for Endpoint Admins
        $processedDevice = [PSCustomObject]@{
            # ===== CORE IDENTITY =====
            id                     = $device.Id
            deviceName             = $device.DeviceName
            managedDeviceName      = $device.ManagedDeviceName
            userPrincipalName      = $device.UserPrincipalName
            primaryUserDisplayName = $device.UserDisplayName
            userId                 = $device.UserId
            emailAddress           = $device.EmailAddress

            # ===== AZURE AD INTEGRATION =====
            azureAdDeviceId        = $device.AzureADDeviceId
            azureAdRegistered      = if ($null -ne $device.AzureADRegistered) { [bool]$device.AzureADRegistered } else { $null }

            # ===== OPERATING SYSTEM =====
            os                     = $simplifiedOS
            osVersion              = $device.OsVersion
            windowsType            = $winLifecycle.windowsType
            windowsRelease         = $winLifecycle.windowsRelease
            windowsBuild           = $winLifecycle.windowsBuild
            windowsEOL             = $winLifecycle.windowsEOL
            windowsSupported       = $winLifecycle.windowsSupported
            androidSecurityPatchLevel = $device.AndroidSecurityPatchLevel

            # ===== COMPLIANCE =====
            complianceState        = $complianceState
            complianceGracePeriodExpiry = Format-IsoDate -DateValue $device.ComplianceGracePeriodExpirationDateTime
            complianceGraceDays    = $graceExpiryDays
            inGracePeriod          = $inGracePeriod
            nonCompliantPolicyCount = $nonCompliantPolicyCount
            nonCompliantPolicies   = $nonCompliantPolicies

            # ===== SYNC & ACTIVITY =====
            lastSync               = Format-IsoDate -DateValue $device.LastSyncDateTime
            daysSinceSync          = $daysSinceSync
            isStale                = $isStale
            enrolledDateTime       = Format-IsoDate -DateValue $device.EnrolledDateTime

            # ===== OWNERSHIP & ENROLLMENT =====
            ownership              = $ownership
            deviceEnrollmentType   = $device.DeviceEnrollmentType
            enrollmentTypeDisplay  = Get-EnrollmentTypeDisplay -EnrollmentType $device.DeviceEnrollmentType
            deviceRegistrationState = $device.DeviceRegistrationState
            registrationStateDisplay = Get-RegistrationStateDisplay -State $device.DeviceRegistrationState
            enrollmentProfileName  = $device.EnrollmentProfileName

            # ===== HARDWARE =====
            manufacturer           = $device.Manufacturer
            model                  = $device.Model
            serialNumber           = $device.SerialNumber
            chassisType            = Get-ChassisType -Model $device.Model -OS $simplifiedOS
            deviceCategory         = $device.DeviceCategoryDisplayName
            physicalMemoryGB       = $physicalMemoryGB

            # ===== SECURITY =====
            isEncrypted            = $isEncryptedValue
            jailBroken             = $device.JailBroken
            isSupervised           = if ($null -ne $device.IsSupervised) { [bool]$device.IsSupervised } else { $null }
            partnerThreatState     = $device.PartnerReportedThreatState
            threatStateDisplay     = Get-ThreatStateDisplay -State $device.PartnerReportedThreatState
            threatSeverity         = $threatSeverity
            activationLockBypass   = if ($device.ActivationLockBypassCode) { $true } else { $false }

            # ===== MANAGEMENT =====
            managementAgent        = $managementAgent
            managementSource       = "Intune"
            joinType               = if ($null -ne $device.JoinType) {
                $device.JoinType
            }
            elseif (-not [string]::IsNullOrWhiteSpace($device.DeviceRegistrationState)) {
                $device.DeviceRegistrationState
            }
            elseif ($device.AzureADRegistered -eq $true) {
                "azureADRegistered"
            }
            else {
                $null
            }
            autopilotEnrolled      = $isInAutopilot
            # Additional Autopilot data from cross-reference (only available if device is in Autopilot registry)
            autopilotGroupTag               = if ($autopilotRecord) { $autopilotRecord.groupTag } else { $null }
            autopilotProfileAssigned        = if ($autopilotRecord) {
                                                  # Check if profile is assigned based on status
                                                  $apStatus = $autopilotRecord.deploymentProfileAssignmentStatus
                                                  if ($apStatus -match "(?i)^assigned|^pending") { $true } else { $false }
                                              } else { $null }
            autopilotProfileStatus          = if ($autopilotRecord) {
                                                  if ($autopilotRecord.deploymentProfileAssignmentStatus) {
                                                      $autopilotRecord.deploymentProfileAssignmentStatus.ToString()
                                                  } else { "unknown" }
                                              } else { $null }
            autopilotEnrollmentState        = if ($autopilotRecord) { $autopilotRecord.enrollmentState } else { $null }
            autopilotLastContacted          = if ($autopilotRecord) { Format-IsoDate -DateValue $autopilotRecord.lastContactedDateTime } else { $null }

            # ===== CERTIFICATES =====
            certExpiryDate         = Format-IsoDate -DateValue $device.ManagedDeviceCertificateExpirationDate
            daysUntilCertExpiry    = $daysUntilCertExpiry
            certStatus             = $certStatus

            # ===== EXCHANGE (EAS) =====
            exchangeAccessState    = $device.ExchangeAccessState
            exchangeAccessDisplay  = Get-ExchangeAccessStateDisplay -State $device.ExchangeAccessState
            exchangeAccessReason   = $device.ExchangeAccessStateReason
            exchangeLastSync       = Format-IsoDate -DateValue $device.ExchangeLastSuccessfulSyncDateTime
            easActivated           = if ($null -ne $device.EasActivated) { [bool]$device.EasActivated } else { $null }
            easDeviceId            = $device.EasDeviceId

            # ===== STORAGE =====
            totalStorageGB         = if ($device.TotalStorageSpaceInBytes -and $device.TotalStorageSpaceInBytes -gt 0) {
                                         [Math]::Round($device.TotalStorageSpaceInBytes / 1GB, 1)
                                     } else { $null }
            freeStorageGB          = if ($device.FreeStorageSpaceInBytes -and $device.FreeStorageSpaceInBytes -gt 0) {
                                         [Math]::Round($device.FreeStorageSpaceInBytes / 1GB, 1)
                                     } else { $null }
            storageUsedPct         = if ($device.TotalStorageSpaceInBytes -and $device.TotalStorageSpaceInBytes -gt 0) {
                                         $used = $device.TotalStorageSpaceInBytes - $device.FreeStorageSpaceInBytes
                                         [Math]::Round(($used / $device.TotalStorageSpaceInBytes) * 100, 1)
                                     } else { $null }

            # ===== NETWORK =====
            wifiMacAddress         = $device.WiFiMacAddress
            ethernetMacAddress     = $device.EthernetMacAddress
            phoneNumber            = $device.PhoneNumber
            subscriberCarrier      = $device.SubscriberCarrier

            # ===== MOBILE IDENTIFIERS =====
            imei                   = $device.Imei
            meid                   = $device.Meid
            iccid                  = $device.Iccid
            udid                   = $device.Udid

            # ===== ADMIN NOTES =====
            notes                  = $device.Notes
        }

        $processedDevices += $processedDevice
        $deviceCount++

        # Progress indicator
        if ($deviceCount % 50 -eq 0) {
            Write-Host "      Processed $deviceCount devices..." -ForegroundColor Gray
        }
    }

    # Process Entra-only devices (not managed by Intune)
    $entraDeviceCount = 0
    foreach ($device in $entraDevices) {
        $entraDeviceId = Get-GraphPropertyValue -Object $device -PropertyNames @("id", "Id")
        $entraAadDeviceId = Get-GraphPropertyValue -Object $device -PropertyNames @("deviceId", "DeviceId")
        $entraName = Get-GraphPropertyValue -Object $device -PropertyNames @("displayName", "DisplayName")
        $entraOs = Get-GraphPropertyValue -Object $device -PropertyNames @("operatingSystem", "OperatingSystem")
        $entraOsVersion = Get-GraphPropertyValue -Object $device -PropertyNames @("operatingSystemVersion", "OperatingSystemVersion")
        $entraTrustType = Get-GraphPropertyValue -Object $device -PropertyNames @("trustType", "TrustType")
        $entraRegDate = Get-GraphPropertyValue -Object $device -PropertyNames @("registrationDateTime", "RegistrationDateTime")
        $entraLastSignIn = Get-GraphPropertyValue -Object $device -PropertyNames @("approximateLastSignInDateTime", "ApproximateLastSignInDateTime")
        $entraIsCompliant = Get-GraphPropertyValue -Object $device -PropertyNames @("isCompliant", "IsCompliant")
        $entraIsManaged = Get-GraphPropertyValue -Object $device -PropertyNames @("isManaged", "IsManaged")
        $entraOwnership = Get-GraphPropertyValue -Object $device -PropertyNames @("deviceOwnership", "DeviceOwnership")
        $entraAccountEnabled = Get-GraphPropertyValue -Object $device -PropertyNames @("accountEnabled", "AccountEnabled")

        # Extract registered owner info (first owner if multiple)
        $entraUserPrincipalName = $null
        $entraUserDisplayName = $null
        $entraUserId = $null
        $registeredOwners = Get-GraphPropertyValue -Object $device -PropertyNames @("registeredOwners", "RegisteredOwners")
        if ($registeredOwners -and $registeredOwners.Count -gt 0) {
            $firstOwner = $registeredOwners[0]
            $entraUserPrincipalName = Get-GraphPropertyValue -Object $firstOwner -PropertyNames @("userPrincipalName", "UserPrincipalName")
            $entraUserDisplayName = Get-GraphPropertyValue -Object $firstOwner -PropertyNames @("displayName", "DisplayName")
            $entraUserId = Get-GraphPropertyValue -Object $firstOwner -PropertyNames @("id", "Id")
        }

        $daysSinceSync = Get-DaysSinceDate -DateValue $entraLastSignIn
        $activityStatus = Get-ActivityStatus -DaysSinceActivity $daysSinceSync -InactiveThreshold $staleThreshold
        $isStale = $activityStatus.isInactive

        $simplifiedOS = Get-SimplifiedOS -OperatingSystem $entraOs
        $winLifecycle = Get-WindowsLifecycleInfo -OsVersion $entraOsVersion

        $complianceState = "unknown"
        if ($entraIsCompliant -eq $true) { $complianceState = "compliant" }
        elseif ($entraIsCompliant -eq $false) { $complianceState = "noncompliant" }

        $ownership = Get-DirectoryOwnership -OwnerType $entraOwnership
        $enrollmentTypeDisplay = switch ($entraTrustType) {
            "AzureAD"  { "Entra Joined" }
            "ServerAD" { "Hybrid Joined" }
            "Workplace" { "Entra Registered" }
            default    { $entraTrustType }
        }

        $processedDevice = [PSCustomObject]@{
            # ===== CORE IDENTITY =====
            id                     = $entraDeviceId
            deviceName             = $entraName
            managedDeviceName      = $null
            userPrincipalName      = $entraUserPrincipalName
            primaryUserDisplayName = $entraUserDisplayName
            userId                 = $entraUserId
            emailAddress           = $entraUserPrincipalName  # UPN is typically the email

            # ===== AZURE AD INTEGRATION =====
            azureAdDeviceId        = $entraAadDeviceId
            azureAdRegistered      = $null

            # ===== OPERATING SYSTEM =====
            os                     = $simplifiedOS
            osVersion              = $entraOsVersion
            windowsType            = $winLifecycle.windowsType
            windowsRelease         = $winLifecycle.windowsRelease
            windowsBuild           = $winLifecycle.windowsBuild
            windowsEOL             = $winLifecycle.windowsEOL
            windowsSupported       = $winLifecycle.windowsSupported
            androidSecurityPatchLevel = $null

            # ===== COMPLIANCE =====
            complianceState        = $complianceState
            complianceGracePeriodExpiry = $null
            complianceGraceDays    = $null
            inGracePeriod          = $false
            nonCompliantPolicyCount = $null
            nonCompliantPolicies   = @()

            # ===== SYNC & ACTIVITY =====
            lastSync               = Format-IsoDate -DateValue $entraLastSignIn
            daysSinceSync          = $daysSinceSync
            isStale                = $isStale
            enrolledDateTime       = Format-IsoDate -DateValue $entraRegDate

            # ===== OWNERSHIP & ENROLLMENT =====
            ownership              = $ownership
            deviceEnrollmentType   = $null
            enrollmentTypeDisplay  = $enrollmentTypeDisplay
            deviceRegistrationState = $null
            registrationStateDisplay = $null
            enrollmentProfileName  = $null

            # ===== HARDWARE =====
            manufacturer           = $null
            model                  = $null
            serialNumber           = $null
            chassisType            = $null
            deviceCategory         = $null
            physicalMemoryGB       = $null

            # ===== SECURITY =====
            isEncrypted            = $null
            jailBroken             = $null
            isSupervised           = $null
            partnerThreatState     = $null
            threatStateDisplay     = $null
            threatSeverity         = $null
            activationLockBypass   = $false

            # ===== MANAGEMENT =====
            managementAgent        = if ($entraIsManaged -eq $true) { "mdm" } else { "entra" }
            managementSource       = "Entra"
            joinType               = $entraTrustType
            autopilotEnrolled      = $null

            # ===== CERTIFICATES =====
            certExpiryDate         = $null
            daysUntilCertExpiry    = $null
            certStatus             = "unknown"

            # ===== EXCHANGE (EAS) =====
            exchangeAccessState    = $null
            exchangeAccessDisplay  = $null
            exchangeAccessReason   = $null
            exchangeLastSync       = $null
            easActivated           = $null
            easDeviceId            = $null

            # ===== STORAGE =====
            totalStorageGB         = $null
            freeStorageGB          = $null
            storageUsedPct         = $null

            # ===== NETWORK =====
            wifiMacAddress         = $null
            ethernetMacAddress     = $null
            phoneNumber            = $null
            subscriberCarrier      = $null

            # ===== MOBILE IDENTIFIERS =====
            imei                   = $null
            meid                   = $null
            iccid                  = $null
            udid                   = $null

            # ===== ADMIN NOTES =====
            notes                  = $null
        }

        # Track if the directory device is disabled
        if ($null -ne $entraAccountEnabled) {
            $processedDevice | Add-Member -NotePropertyName "accountEnabled" -NotePropertyValue ([bool]$entraAccountEnabled) -Force
        }

        $processedDevices += $processedDevice
        $deviceCount++
        $entraDeviceCount++
    }

    # Sort by compliance state (non-compliant first) then by last sync
    $processedDevices = $processedDevices | Sort-Object -Property @{
        Expression = {
            switch ($_.complianceState) {
                "noncompliant" { 0 }
                "unknown"      { 1 }
                "compliant"    { 2 }
                default        { 3 }
            }
        }
    }, @{ Expression = "daysSinceSync"; Descending = $true }

    # ============================================================================
    # GENERATE SUMMARY STATISTICS
    # ============================================================================

    Write-Host "      Generating summary statistics..." -ForegroundColor Gray

    # Compliance counts
    $compliantCount = ($processedDevices | Where-Object { $_.complianceState -eq "compliant" }).Count
    $noncompliantCount = ($processedDevices | Where-Object { $_.complianceState -eq "noncompliant" }).Count
    $unknownCount = ($processedDevices | Where-Object { $_.complianceState -eq "unknown" }).Count

    # Encryption counts
    $encryptedCount = ($processedDevices | Where-Object { $_.isEncrypted -eq $true }).Count
    $notEncryptedCount = ($processedDevices | Where-Object { $_.isEncrypted -eq $false }).Count
    $unknownEncryptedCount = ($processedDevices | Where-Object { $null -eq $_.isEncrypted }).Count

    # Stale device counts
    $staleCount = ($processedDevices | Where-Object { $_.isStale -eq $true }).Count
    $activeCount = ($processedDevices | Where-Object { $_.isStale -eq $false }).Count

    # Certificate status counts
    $certExpiredCount = ($processedDevices | Where-Object { $_.certStatus -eq "expired" }).Count
    $certCriticalCount = ($processedDevices | Where-Object { $_.certStatus -eq "critical" }).Count
    $certWarningCount = ($processedDevices | Where-Object { $_.certStatus -eq "warning" }).Count
    $certHealthyCount = ($processedDevices | Where-Object { $_.certStatus -eq "healthy" }).Count
    $certUnknownCount = ($processedDevices | Where-Object { $_.certStatus -eq "unknown" }).Count

    # Windows device stats
    $windowsDevices = $processedDevices | Where-Object { $_.os -eq "Windows" }
    $windows11Count = ($windowsDevices | Where-Object { $_.windowsType -eq "Windows 11" }).Count
    $windows10Count = ($windowsDevices | Where-Object { $_.windowsType -eq "Windows 10" }).Count
    $windowsSupportedCount = ($windowsDevices | Where-Object { $_.windowsSupported -eq $true }).Count
    $windowsUnsupportedCount = ($windowsDevices | Where-Object { $_.windowsSupported -eq $false }).Count

    # Ownership counts
    $corporateCount = ($processedDevices | Where-Object { $_.ownership -eq "corporate" }).Count
    $personalCount = ($processedDevices | Where-Object { $_.ownership -eq "personal" }).Count

    # Autopilot counts
    $autopilotCount = ($processedDevices | Where-Object { $_.autopilotEnrolled -eq $true }).Count
    $notAutopilotCount = ($processedDevices | Where-Object { $_.autopilotEnrolled -eq $false }).Count

    # Security counts (new)
    $jailbrokenCount = ($processedDevices | Where-Object { $_.jailBroken -eq "True" -or $_.jailBroken -eq $true }).Count
    $supervisedCount = ($processedDevices | Where-Object { $_.isSupervised -eq $true }).Count
    $unsupervisedIos = ($processedDevices | Where-Object { $_.os -eq "iOS" -and $_.isSupervised -ne $true }).Count
    $threatHighCount = ($processedDevices | Where-Object { $_.threatSeverity -eq "high" -or $_.threatSeverity -eq "critical" }).Count
    $threatMediumCount = ($processedDevices | Where-Object { $_.threatSeverity -eq "medium" }).Count
    $compromisedCount = ($processedDevices | Where-Object { $_.partnerThreatState -eq "compromised" }).Count
    $inGracePeriodCount = ($processedDevices | Where-Object { $_.inGracePeriod -eq $true }).Count

    # Enrollment type breakdown
    $enrollmentTypeBreakdown = @{}
    foreach ($device in $processedDevices) {
        $enrollType = if ($device.enrollmentTypeDisplay) { $device.enrollmentTypeDisplay } else { "Unknown" }
        if (-not $enrollmentTypeBreakdown.ContainsKey($enrollType)) {
            $enrollmentTypeBreakdown[$enrollType] = 0
        }
        $enrollmentTypeBreakdown[$enrollType]++
    }
    $enrollmentTypeArray = @()
    foreach ($key in $enrollmentTypeBreakdown.Keys | Sort-Object { $enrollmentTypeBreakdown[$_] } -Descending) {
        $enrollmentTypeArray += [PSCustomObject]@{
            name = $key
            count = $enrollmentTypeBreakdown[$key]
        }
    }

    # Chassis type breakdown
    $chassisBreakdown = @{}
    foreach ($device in $processedDevices) {
        $chassis = if ($device.chassisType) { $device.chassisType } else { "Unknown" }
        if (-not $chassisBreakdown.ContainsKey($chassis)) {
            $chassisBreakdown[$chassis] = 0
        }
        $chassisBreakdown[$chassis]++
    }
    $chassisBreakdownArray = @()
    foreach ($key in $chassisBreakdown.Keys | Sort-Object { $chassisBreakdown[$_] } -Descending) {
        $chassisBreakdownArray += [PSCustomObject]@{
            name = $key
            count = $chassisBreakdown[$key]
        }
    }

    # OS breakdown
    $osBreakdown = @{}
    foreach ($device in $processedDevices) {
        $os = if ($device.os) { $device.os } else { "Unknown" }
        if (-not $osBreakdown.ContainsKey($os)) {
            $osBreakdown[$os] = 0
        }
        $osBreakdown[$os]++
    }
    $osBreakdownArray = @()
    foreach ($key in $osBreakdown.Keys | Sort-Object) {
        $osBreakdownArray += [PSCustomObject]@{
            name = $key
            count = $osBreakdown[$key]
        }
    }

    # Manufacturer breakdown
    $manufacturerBreakdown = @{}
    foreach ($device in $processedDevices) {
        $mfr = if ($device.manufacturer) { $device.manufacturer } else { "Unknown" }
        if (-not $manufacturerBreakdown.ContainsKey($mfr)) {
            $manufacturerBreakdown[$mfr] = 0
        }
        $manufacturerBreakdown[$mfr]++
    }
    $manufacturerBreakdownArray = @()
    foreach ($key in $manufacturerBreakdown.Keys | Sort-Object { $manufacturerBreakdown[$_] } -Descending) {
        $manufacturerBreakdownArray += [PSCustomObject]@{
            name = $key
            count = $manufacturerBreakdown[$key]
        }
    }

    # Model breakdown (top 10)
    $modelBreakdown = @{}
    foreach ($device in $processedDevices) {
        $model = if ($device.model) { $device.model } else { "Unknown" }
        if (-not $modelBreakdown.ContainsKey($model)) {
            $modelBreakdown[$model] = 0
        }
        $modelBreakdown[$model]++
    }
    $modelBreakdownArray = @()
    foreach ($key in $modelBreakdown.Keys | Sort-Object { $modelBreakdown[$_] } -Descending | Select-Object -First 10) {
        $modelBreakdownArray += [PSCustomObject]@{
            name = $key
            count = $modelBreakdown[$key]
        }
    }

    # Windows release breakdown
    $windowsReleaseBreakdown = @{}
    foreach ($device in $windowsDevices) {
        $release = if ($device.windowsRelease) { "$($device.windowsType) $($device.windowsRelease)" } else { "Unknown" }
        if (-not $windowsReleaseBreakdown.ContainsKey($release)) {
            $windowsReleaseBreakdown[$release] = 0
        }
        $windowsReleaseBreakdown[$release]++
    }
    $windowsReleaseArray = @()
    foreach ($key in $windowsReleaseBreakdown.Keys | Sort-Object) {
        $windowsReleaseArray += [PSCustomObject]@{
            name = $key
            count = $windowsReleaseBreakdown[$key]
        }
    }

    # Management source counts
    $intuneDeviceCount = $deviceCount - $entraDeviceCount

    # Build summary object
    $complianceRate = if ($deviceCount -gt 0) {
        [Math]::Round(($compliantCount / $deviceCount) * 100, 1)
    } else { 0 }

    $summary = [PSCustomObject]@{
        # Core counts
        totalDevices           = $deviceCount
        compliant              = $compliantCount
        noncompliant           = $noncompliantCount
        unknown                = $unknownCount
        compliantDevices       = $compliantCount
        noncompliantDevices    = $noncompliantCount
        unknownDevices         = $unknownCount
        complianceRate         = $complianceRate
        inGracePeriod          = $inGracePeriodCount

        # Encryption
        encrypted              = $encryptedCount
        notEncrypted           = $notEncryptedCount
        unknownEncrypted       = $unknownEncryptedCount
        encryptedDevices       = $encryptedCount
        notEncryptedDevices    = $notEncryptedCount
        unknownEncryptedDevices = $unknownEncryptedCount

        # Activity
        stale                  = $staleCount
        active                 = $activeCount
        staleDevices           = $staleCount
        activeDevices          = $activeCount

        # Certificates
        certExpired            = $certExpiredCount
        certCritical           = $certCriticalCount
        certWarning            = $certWarningCount
        certHealthy            = $certHealthyCount
        certUnknown            = $certUnknownCount

        # Windows
        windows11              = $windows11Count
        windows10              = $windows10Count
        windowsSupported       = $windowsSupportedCount
        windowsUnsupported     = $windowsUnsupportedCount
        win11Count             = $windows11Count
        win10Count             = $windows10Count
        winSupportedCount      = $windowsSupportedCount
        winUnsupportedCount    = $windowsUnsupportedCount

        # Ownership
        corporate              = $corporateCount
        personal               = $personalCount
        corporateDevices       = $corporateCount
        personalDevices        = $personalCount

        # Management source
        intuneDevices          = $intuneDeviceCount
        entraDevices           = $entraDeviceCount

        # Enrollment
        autopilotEnrolled      = $autopilotCount
        notAutopilotEnrolled   = $notAutopilotCount

        # Security
        jailbroken             = $jailbrokenCount
        supervised             = $supervisedCount
        unsupervisedIos        = $unsupervisedIos
        threatHigh             = $threatHighCount
        threatMedium           = $threatMediumCount
        compromised            = $compromisedCount

        # Breakdowns
        osBreakdown             = $osBreakdown
        osBreakdownArray        = $osBreakdownArray
        manufacturerBreakdown   = $manufacturerBreakdown
        manufacturerBreakdownArray = $manufacturerBreakdownArray
        modelBreakdown          = $modelBreakdownArray
        windowsReleaseBreakdown = $windowsReleaseArray
        enrollmentTypeBreakdown = $enrollmentTypeArray
        chassisTypeBreakdown    = $chassisBreakdownArray
    }

    # ============================================================================
    # GENERATE INSIGHTS
    # ============================================================================

    Write-Host "      Generating insights..." -ForegroundColor Gray

    $insights = @()

    # Critical: Non-compliant devices
    if ($noncompliantCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "noncompliant-devices"
            severity          = "critical"
            description       = "$noncompliantCount device$(if($noncompliantCount -ne 1){'s'}) $(if($noncompliantCount -eq 1){'is'}else{'are'}) non-compliant with organizational policies"
            affectedDevices   = $noncompliantCount
            recommendedAction = "Review non-compliant devices and remediate policy violations"
            category          = "Compliance"
        }
    }

    # Critical: Unencrypted devices
    if ($notEncryptedCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "unencrypted-devices"
            severity          = "critical"
            description       = "$notEncryptedCount device$(if($notEncryptedCount -ne 1){'s'}) $(if($notEncryptedCount -eq 1){'is'}else{'are'}) not encrypted"
            affectedDevices   = $notEncryptedCount
            recommendedAction = "Enable encryption on these devices to protect data at rest"
            category          = "Security"
        }
    }

    # Critical: Expired certificates
    if ($certExpiredCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "expired-certificates"
            severity          = "critical"
            description       = "$certExpiredCount device$(if($certExpiredCount -ne 1){'s'}) $(if($certExpiredCount -eq 1){'has'}else{'have'}) expired management certificates"
            affectedDevices   = $certExpiredCount
            recommendedAction = "Re-enroll devices with expired certificates to restore management capabilities"
            category          = "Certificate"
        }
    }

    # Critical: Compromised devices (threat partner detected)
    if ($compromisedCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "compromised-devices"
            severity          = "critical"
            description       = "$compromisedCount device$(if($compromisedCount -ne 1){'s'}) $(if($compromisedCount -eq 1){'is'}else{'are'}) reported as compromised by threat detection partner"
            affectedDevices   = $compromisedCount
            recommendedAction = "Immediately investigate compromised devices and initiate incident response"
            category          = "Security"
        }
    }

    # Critical: Jailbroken devices
    if ($jailbrokenCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "jailbroken-devices"
            severity          = "critical"
            description       = "$jailbrokenCount device$(if($jailbrokenCount -ne 1){'s'}) $(if($jailbrokenCount -eq 1){'is'}else{'are'}) jailbroken or rooted"
            affectedDevices   = $jailbrokenCount
            recommendedAction = "Block access from jailbroken devices - they bypass security controls"
            category          = "Security"
        }
    }

    # High: High-severity threats detected
    if ($threatHighCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "high-threats"
            severity          = "high"
            description       = "$threatHighCount device$(if($threatHighCount -ne 1){'s'}) $(if($threatHighCount -eq 1){'has'}else{'have'}) high or critical severity threats"
            affectedDevices   = $threatHighCount
            recommendedAction = "Review threat details and initiate remediation for high-severity threats"
            category          = "Security"
        }
    }

    # High: Unsupervised iOS devices
    if ($unsupervisedIos -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "unsupervised-ios"
            severity          = "high"
            description       = "$unsupervisedIos iOS device$(if($unsupervisedIos -ne 1){'s'}) $(if($unsupervisedIos -eq 1){'is'}else{'are'}) not supervised"
            affectedDevices   = $unsupervisedIos
            recommendedAction = "Consider supervision for corporate iOS devices to enable full MDM capabilities"
            category          = "Management"
        }
    }

    # High: Unsupported Windows versions
    if ($windowsUnsupportedCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "unsupported-windows"
            severity          = "high"
            description       = "$windowsUnsupportedCount Windows device$(if($windowsUnsupportedCount -ne 1){'s'}) $(if($windowsUnsupportedCount -eq 1){'is'}else{'are'}) running unsupported versions"
            affectedDevices   = $windowsUnsupportedCount
            recommendedAction = "Upgrade devices to supported Windows versions to receive security updates"
            category          = "Lifecycle"
        }
    }

    # High: Stale devices
    if ($staleCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "stale-devices"
            severity          = "high"
            description       = "$staleCount device$(if($staleCount -ne 1){'s'}) $(if($staleCount -eq 1){'has'}else{'have'}) not synced in over $staleThreshold days"
            affectedDevices   = $staleCount
            recommendedAction = "Investigate stale devices - they may be lost, retired, or have connectivity issues"
            category          = "Sync"
        }
    }

    # High: Critical certificates (expiring within 30 days)
    if ($certCriticalCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "critical-certificates"
            severity          = "high"
            description       = "$certCriticalCount device$(if($certCriticalCount -ne 1){'s'}) $(if($certCriticalCount -eq 1){'has'}else{'have'}) certificates expiring within 30 days"
            affectedDevices   = $certCriticalCount
            recommendedAction = "Proactively renew certificates to prevent management disruption"
            category          = "Certificate"
        }
    }

    # Medium: Warning certificates (expiring within 60 days)
    if ($certWarningCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "warning-certificates"
            severity          = "medium"
            description       = "$certWarningCount device$(if($certWarningCount -ne 1){'s'}) $(if($certWarningCount -eq 1){'has'}else{'have'}) certificates expiring within 60 days"
            affectedDevices   = $certWarningCount
            recommendedAction = "Plan certificate renewals for upcoming expirations"
            category          = "Certificate"
        }
    }

    # Medium: Windows 10 devices (approaching EOL)
    if ($windows10Count -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "windows10-devices"
            severity          = "medium"
            description       = "$windows10Count device$(if($windows10Count -ne 1){'s'}) $(if($windows10Count -eq 1){'is'}else{'are'}) still running Windows 10"
            affectedDevices   = $windows10Count
            recommendedAction = "Plan migration to Windows 11 before Windows 10 end of support"
            category          = "Lifecycle"
        }
    }

    # Medium: Unknown compliance state
    if ($unknownCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "unknown-compliance"
            severity          = "medium"
            description       = "$unknownCount device$(if($unknownCount -ne 1){'s'}) $(if($unknownCount -eq 1){'has'}else{'have'}) unknown compliance state"
            affectedDevices   = $unknownCount
            recommendedAction = "Review devices with unknown compliance - they may need policy assignment or sync"
            category          = "Compliance"
        }
    }

    # Medium: Entra-only devices (not Intune managed)
    if ($entraDeviceCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "entra-only-devices"
            severity          = "medium"
            description       = "$entraDeviceCount device$(if($entraDeviceCount -ne 1){'s'}) registered in Entra ID but not managed by Intune"
            affectedDevices   = $entraDeviceCount
            recommendedAction = "Review if these devices should be enrolled into Intune for compliance and security policies"
            category          = "Inventory"
        }
    }

    # Info: Personal devices
    if ($personalCount -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "personal-devices"
            severity          = "info"
            description       = "$personalCount personal (BYOD) device$(if($personalCount -ne 1){'s'}) enrolled in management"
            affectedDevices   = $personalCount
            recommendedAction = "Ensure appropriate policies are applied to personal devices"
            category          = "Enrollment"
        }
    }

    # Info: Autopilot enrollment
    $autopilotPct = if ($deviceCount -gt 0) { [Math]::Round(($autopilotCount / $deviceCount) * 100, 1) } else { 0 }
    if ($autopilotPct -lt 50 -and $windowsDevices.Count -gt 0) {
        $insights += [PSCustomObject]@{
            id                = "low-autopilot"
            severity          = "info"
            description       = "Only $autopilotPct% of devices are enrolled via Windows Autopilot"
            affectedDevices   = $notAutopilotCount
            recommendedAction = "Consider expanding Autopilot adoption for streamlined provisioning"
            category          = "Enrollment"
        }
    }

    # Info: High compliance rate
    $compliancePct = if ($deviceCount -gt 0) { [Math]::Round(($compliantCount / $deviceCount) * 100, 1) } else { 0 }
    if ($compliancePct -ge 95 -and $deviceCount -gt 10) {
        $insights += [PSCustomObject]@{
            id                = "high-compliance"
            severity          = "info"
            description       = "Excellent compliance rate: $compliancePct% of devices are compliant"
            affectedDevices   = $compliantCount
            recommendedAction = "Maintain current compliance policies and monitoring"
            category          = "Compliance"
        }
    }

    # ============================================================================
    # BUILD OUTPUT OBJECT
    # ============================================================================

    $outputData = [PSCustomObject]@{
        devices    = $processedDevices
        summary    = $summary
        insights   = $insights
        collectedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    # Save data using shared utility
    Save-CollectorData -Data $outputData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $deviceCount devices" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $deviceCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Intune|license|subscription|permission|forbidden") {
        Write-Host "    [!] Device collection requires Intune license and appropriate permissions" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty structure to prevent dashboard errors
    $emptyData = [PSCustomObject]@{
        devices     = @()
        summary     = [PSCustomObject]@{
            totalDevices = 0
            compliant = 0
            noncompliant = 0
            unknown = 0
            compliantDevices = 0
            noncompliantDevices = 0
            unknownDevices = 0
            complianceRate = 0
            inGracePeriod = 0
            encrypted = 0
            notEncrypted = 0
            unknownEncrypted = 0
            encryptedDevices = 0
            notEncryptedDevices = 0
            unknownEncryptedDevices = 0
            stale = 0
            active = 0
            staleDevices = 0
            activeDevices = 0
            certExpired = 0
            certCritical = 0
            certWarning = 0
            certHealthy = 0
            certUnknown = 0
            windows11 = 0
            windows10 = 0
            windowsSupported = 0
            windowsUnsupported = 0
            win11Count = 0
            win10Count = 0
            winSupportedCount = 0
            winUnsupportedCount = 0
            corporate = 0
            personal = 0
            corporateDevices = 0
            personalDevices = 0
            autopilotEnrolled = 0
            notAutopilotEnrolled = 0
            osBreakdown = @{}
            osBreakdownArray = @()
            manufacturerBreakdown = @{}
            manufacturerBreakdownArray = @()
            modelBreakdown = @()
            windowsReleaseBreakdown = @()
        }
        insights    = @()
        collectedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    Save-CollectorData -Data $emptyData -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
