# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Intune device configuration profiles and their deployment status.

.DESCRIPTION
    Retrieves all device configuration profiles from Microsoft Intune including
    endpoint security profiles, settings catalogs, and administrative templates.
    Shows assignment status and deployment success/failure rates.

    Graph API endpoints:
    - GET /deviceManagement/deviceConfigurations
    - GET /deviceManagement/configurationPolicies (Settings Catalog)
    - GET /deviceManagement/deviceConfigurations/{id}/deviceStatusOverview

    Required scopes:
    - DeviceManagementConfiguration.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes configuration-profiles.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-ConfigurationProfiles.ps1 -Config $config -OutputPath ".\data\configuration-profiles.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.DeviceManagement

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
# LOCAL HELPER FUNCTIONS
# ============================================================================

function Get-ProfileType {
    <#
    .SYNOPSIS
        Determines the profile type from @odata.type.
    #>
    param([string]$ODataType)

    switch -Regex ($ODataType) {
        "windows10EndpointProtection"      { return "Endpoint Protection" }
        "windows10General"                 { return "Device Restrictions" }
        "windows10Custom"                  { return "Custom (OMA-URI)" }
        "windowsHealthMonitoring"          { return "Health Monitoring" }
        "windowsIdentityProtection"        { return "Identity Protection" }
        "windowsKiosk"                     { return "Kiosk" }
        "windows10VpnConfiguration"        { return "VPN" }
        "windowsWifiConfiguration"         { return "Wi-Fi" }
        "windows10Compliance"              { return "Compliance" }
        "windowsUpdateForBusiness"         { return "Windows Update" }
        "windowsDeliveryOptimization"      { return "Delivery Optimization" }
        "windows10SecureAssessment"        { return "Secure Assessment" }
        "windows10PkcsCertificate"         { return "PKCS Certificate" }
        "windows10ImportedPFX"             { return "PFX Certificate" }
        "windows10TrustedRoot"             { return "Trusted Root" }
        "androidGeneral"                   { return "Android General" }
        "androidWorkProfile"               { return "Android Work Profile" }
        "iosGeneral"                       { return "iOS General" }
        "iosDevice"                        { return "iOS Device Features" }
        "macOS"                            { return "macOS" }
        "sharedPC"                         { return "Shared PC" }
        "editionUpgrade"                   { return "Edition Upgrade" }
        default                            { return "Configuration" }
    }
}

function Get-ProfilePlatform {
    <#
    .SYNOPSIS
        Determines the platform from @odata.type.
    #>
    param([string]$ODataType)

    switch -Regex ($ODataType) {
        "windows10|windows81|windowsPhone|sharedPC|editionUpgrade" { return "Windows" }
        "android"  { return "Android" }
        "ios"      { return "iOS/iPadOS" }
        "macOS"    { return "macOS" }
        default    { return "Cross-platform" }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$profileCount = 0

try {
    Write-Host "    Collecting device configuration profiles..." -ForegroundColor Gray

    # Initialize data structure
    $profileData = @{
        profiles = @()
        failedDevices = @()
        settingFailures = @()
        insights = @()
        summary = @{
            totalProfiles = 0
            totalDevices = 0
            successDevices = 0
            errorDevices = 0
            conflictDevices = 0
            pendingDevices = 0
            overallSuccessRate = 0
            profilesWithErrors = 0
            profilesWithConflicts = 0
            platformBreakdown = @{}
            typeBreakdown = @{}
        }
    }

    $allProfiles = @()
    $allFailedDevices = @{}

    # ========================================
    # Collect Device Configurations (Legacy)
    # ========================================
    try {
        $configs = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations" -OutputType PSObject
        } -OperationName "Device configuration retrieval"

        $legacyConfigs = @($configs.value)

        while ($configs.'@odata.nextLink') {
            $configs = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $configs.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Device configuration pagination"
            $legacyConfigs += $configs.value
        }

        foreach ($config in $legacyConfigs) {
            $allProfiles += [PSCustomObject]@{
                source = "deviceConfigurations"
                data = $config
            }
        }

        Write-Host "      Retrieved $($legacyConfigs.Count) device configurations" -ForegroundColor Gray
    }
    catch {
        $errors += "Device configurations: $($_.Exception.Message)"
    }

    # ========================================
    # Collect Settings Catalog Policies
    # ========================================
    try {
        $settingsCatalog = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies" -OutputType PSObject
        } -OperationName "Settings catalog retrieval"

        $catalogPolicies = @($settingsCatalog.value)

        while ($settingsCatalog.'@odata.nextLink') {
            $settingsCatalog = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $settingsCatalog.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Settings catalog pagination"
            $catalogPolicies += $settingsCatalog.value
        }

        foreach ($policy in $catalogPolicies) {
            $allProfiles += [PSCustomObject]@{
                source = "configurationPolicies"
                data = $policy
            }
        }

        Write-Host "      Retrieved $($catalogPolicies.Count) settings catalog policies" -ForegroundColor Gray
    }
    catch {
        $errors += "Settings catalog: $($_.Exception.Message)"
    }

    # ========================================
    # Process all profiles
    # ========================================

    $processedProfiles = @()

    # Build a cache for group names
    $groupNameCache = @{}

    foreach ($item in $allProfiles) {
        try {
            $profile = $item.data
            $source = $item.source

            # Determine platform early (needed for setting failures)
            $platform = if ($source -eq "configurationPolicies" -and $profile.platforms) {
                switch ($profile.platforms) {
                    "windows10" { "Windows" }
                    "android"   { "Android" }
                    "iOS"       { "iOS/iPadOS" }
                    "macOS"     { "macOS" }
                    default     { $profile.platforms }
                }
            } else {
                Get-ProfilePlatform -ODataType $profile.'@odata.type'
            }

            # Determine profile type early
            $profileType = if ($source -eq "configurationPolicies") {
                "Settings Catalog"
            } else {
                Get-ProfileType -ODataType $profile.'@odata.type'
            }

            # Get status overview
            $successCount = 0
            $errorCount = 0
            $conflictCount = 0
            $pendingCount = 0
            $notApplicableCount = 0

            try {
                if ($source -eq "deviceConfigurations") {
                    # Legacy device configurations have deviceStatusOverview endpoint
                    $statusOverview = Invoke-MgGraphRequest -Method GET `
                        -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/deviceStatusOverview" `
                        -OutputType PSObject

                    # Handle null values from Graph API - use 0 as default
                    $compliant = if ($null -ne $statusOverview.compliantDeviceCount) { $statusOverview.compliantDeviceCount } else { 0 }
                    $remediated = if ($null -ne $statusOverview.remediatedDeviceCount) { $statusOverview.remediatedDeviceCount } else { 0 }
                    $successCount = $compliant + $remediated
                    $errorCount = if ($null -ne $statusOverview.errorDeviceCount) { $statusOverview.errorDeviceCount } else { 0 }
                    $conflictCount = if ($null -ne $statusOverview.conflictDeviceCount) { $statusOverview.conflictDeviceCount } else { 0 }
                    $pendingCount = if ($null -ne $statusOverview.pendingDeviceCount) { $statusOverview.pendingDeviceCount } else { 0 }
                    $notApplicableCount = if ($null -ne $statusOverview.notApplicableDeviceCount) { $statusOverview.notApplicableDeviceCount } else { 0 }
                }
                elseif ($source -eq "configurationPolicies") {
                    # Settings Catalog policies don't have deviceStatusOverview endpoint
                    # Instead, we can get assignment filter evaluation status or just use assignment counts
                    # For now, we leave counts at 0 as Settings Catalog tracks status differently
                    # The status is tracked per-setting rather than per-policy in the Intune portal
                    $successCount = 0
                    $errorCount = 0
                    $conflictCount = 0
                    $pendingCount = 0
                }
            }
            catch {
                # Only log warning for legacy profiles that should support status overview
                if ($source -eq "deviceConfigurations") {
                    Write-Warning "      Failed to get status overview for profile $($profile.displayName): $($_.Exception.Message)"
                }
            }

            # Get assignments for this profile
            $assignments = @()
            try {
                $assignmentUri = if ($source -eq "deviceConfigurations") {
                    "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/assignments"
                } else {
                    "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($profile.id)/assignments"
                }

                $assignmentResponse = Invoke-MgGraphRequest -Method GET -Uri $assignmentUri -OutputType PSObject

                foreach ($assignment in $assignmentResponse.value) {
                    $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -ExcludeSuffix " (Excluded)"
                    $assignments += $target
                }
            }
            catch {
                Write-Warning "      Failed to get assignments for profile $($profile.displayName): $($_.Exception.Message)"
            }

            # Get failed device details
            $deviceStatuses = @()
            $profileNameForTracking = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unknown Profile" }

            if ($errorCount -gt 0 -or $conflictCount -gt 0) {
                try {
                    $statusUri = if ($source -eq "deviceConfigurations") {
                        "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/deviceStatuses?`$filter=status eq 'error' or status eq 'conflict'&`$top=50"
                    } else {
                        "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($profile.id)/deviceStatuses?`$filter=status eq 'error' or status eq 'conflict'&`$top=50"
                    }

                    $deviceStatusResponse = Invoke-MgGraphRequest -Method GET -Uri $statusUri -OutputType PSObject

                    foreach ($status in $deviceStatusResponse.value) {
                        $deviceStatuses += [PSCustomObject]@{
                            deviceName = $status.deviceDisplayName
                            userName = $status.userName
                            status = $status.status
                            lastReportedDateTime = Format-IsoDate -DateValue $status.lastReportedDateTime
                        }

                        # Track unique failed devices across all profiles
                        $deviceKey = $status.deviceDisplayName
                        if ($deviceKey) {
                            if (-not $allFailedDevices.ContainsKey($deviceKey)) {
                                $allFailedDevices[$deviceKey] = @{
                                    deviceName = $status.deviceDisplayName
                                    userName = $status.userName
                                    failedProfiles = @()
                                    errorCount = 0
                                    conflictCount = 0
                                }
                            }
                            $allFailedDevices[$deviceKey].failedProfiles += $profileNameForTracking
                            if ($status.status -eq "error") { $allFailedDevices[$deviceKey].errorCount++ }
                            if ($status.status -eq "conflict") { $allFailedDevices[$deviceKey].conflictCount++ }
                        }
                    }
                }
                catch {
                    Write-Warning "      Failed to get device statuses for profile $($profileNameForTracking): $($_.Exception.Message)"
                }
            }

            # Get setting-level failures for this profile
            # Note: Setting-level failures are available for deviceConfigurations via deviceSettingStateSummaries
            # For Settings Catalog (configurationPolicies), detailed setting failures require different approach
            $settingStatuses = @()
            $profileDisplayName = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unknown" }

            if ($source -eq "deviceConfigurations") {
                try {
                    $settingUri = "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/deviceSettingStateSummaries"
                    $settingResponse = Invoke-MgGraphRequest -Method GET -Uri $settingUri -OutputType PSObject

                    foreach ($setting in $settingResponse.value) {
                        if ($setting.errorDeviceCount -gt 0 -or $setting.conflictDeviceCount -gt 0) {
                            $settingStatuses += [PSCustomObject]@{
                                settingName = $setting.settingName
                                errorCount = $setting.errorDeviceCount
                                conflictCount = $setting.conflictDeviceCount
                            }

                            # Track setting failures globally
                            $profileData.settingFailures += [PSCustomObject]@{
                                profileId = $profile.id
                                profileName = $profileDisplayName
                                platform = $platform
                                settingName = $setting.settingName
                                errorCount = $setting.errorDeviceCount
                                conflictCount = $setting.conflictDeviceCount
                            }
                        }
                    }
                }
                catch {
                    Write-Warning "      Failed to get setting state summaries for profile $($profileDisplayName): $($_.Exception.Message)"
                }
            }

            $totalDevices = $successCount + $errorCount + $conflictCount + $pendingCount
            $successRate = if ($totalDevices -gt 0) {
                [Math]::Round(($successCount / $totalDevices) * 100, 1)
            } else { $null }

            # Determine category based on profile type (platform and profileType already set above)
            $category = "General"
            if ($profileType -match "Endpoint Protection|Firewall|Identity") { $category = "Security" }
            elseif ($profileType -match "VPN|Wi-Fi|Certificate") { $category = "Network" }
            elseif ($profileType -match "Kiosk|Shared") { $category = "Kiosk" }
            elseif ($profileType -match "Update|Delivery") { $category = "Updates" }
            elseif ($profileType -match "Restriction") { $category = "Restrictions" }

            # Get display name (Settings Catalog uses 'name', legacy uses 'displayName')
            $displayName = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unnamed Profile" }

            # Build processed profile object
            $processedProfile = [PSCustomObject]@{
                id                   = $profile.id
                displayName          = $displayName
                description          = $profile.description
                profileType          = $profileType
                platform             = $platform
                category             = $category
                source               = $source
                createdDateTime      = Format-IsoDate -DateValue $profile.createdDateTime
                lastModifiedDateTime = Format-IsoDate -DateValue $profile.lastModifiedDateTime
                version              = $profile.version
                # Assignments
                assignments          = $assignments
                assignmentCount      = $assignments.Count
                # Deployment status
                successDevices       = $successCount
                errorDevices         = $errorCount
                conflictDevices      = $conflictCount
                pendingDevices       = $pendingCount
                notApplicableDevices = $notApplicableCount
                totalDevices         = $totalDevices
                successRate          = $successRate
                # Detailed statuses
                deviceStatuses       = $deviceStatuses
                settingStatuses      = $settingStatuses
                # Health indicators
                hasErrors            = ($errorCount -gt 0)
                hasConflicts         = ($conflictCount -gt 0)
                needsAttention       = ($errorCount -gt 0 -or $conflictCount -gt 0)
            }

            $processedProfiles += $processedProfile
            $profileCount++

            # Update summary
            $profileData.summary.totalDevices += $totalDevices
            $profileData.summary.successDevices += $successCount
            $profileData.summary.errorDevices += $errorCount
            $profileData.summary.conflictDevices += $conflictCount
            $profileData.summary.pendingDevices += $pendingCount
            if ($errorCount -gt 0) { $profileData.summary.profilesWithErrors++ }
            if ($conflictCount -gt 0) { $profileData.summary.profilesWithConflicts++ }

            # Update platform breakdown
            if (-not $profileData.summary.platformBreakdown.ContainsKey($platform)) {
                $profileData.summary.platformBreakdown[$platform] = @{ profiles = 0; success = 0; errors = 0 }
            }
            $profileData.summary.platformBreakdown[$platform].profiles++
            $profileData.summary.platformBreakdown[$platform].success += $successCount
            $profileData.summary.platformBreakdown[$platform].errors += $errorCount

            # Update type breakdown
            if (-not $profileData.summary.typeBreakdown.ContainsKey($profileType)) {
                $profileData.summary.typeBreakdown[$profileType] = @{ profiles = 0; success = 0; errors = 0 }
            }
            $profileData.summary.typeBreakdown[$profileType].profiles++
            $profileData.summary.typeBreakdown[$profileType].success += $successCount
            $profileData.summary.typeBreakdown[$profileType].errors += $errorCount

        }
        catch {
            $errors += "Error processing profile: $($_.Exception.Message)"
        }
    }

    # Sort by success rate (worst first), then by errors
    $processedProfiles = $processedProfiles | Sort-Object -Property @{
        Expression = { if ($null -eq $_.successRate) { 101 } else { $_.successRate } }
    }, @{
        Expression = { $_.errorDevices }
        Descending = $true
    }

    # Finalize data structure
    $profileData.profiles = $processedProfiles
    $profileData.summary.totalProfiles = $processedProfiles.Count

    # Convert failed devices hashtable to array
    foreach ($device in $allFailedDevices.Values) {
        $profileData.failedDevices += [PSCustomObject]@{
            deviceName = $device.deviceName
            userName = $device.userName
            failedProfiles = $device.failedProfiles
            failedProfileCount = $device.failedProfiles.Count
            errorCount = $device.errorCount
            conflictCount = $device.conflictCount
        }
    }

    # Sort failed devices by count
    $profileData.failedDevices = $profileData.failedDevices |
        Sort-Object -Property failedProfileCount -Descending

    # Calculate overall success rate
    if ($profileData.summary.totalDevices -gt 0) {
        $profileData.summary.overallSuccessRate = [Math]::Round(
            ($profileData.summary.successDevices / $profileData.summary.totalDevices) * 100, 1
        )
    }

    # Sort setting failures
    $profileData.settingFailures = $profileData.settingFailures |
        Sort-Object -Property errorCount -Descending |
        Select-Object -First 20

    # ========================================
    # Generate Insights
    # ========================================

    # Insight: Profiles with low success rate
    $lowSuccessProfiles = $processedProfiles | Where-Object { $_.successRate -lt 80 -and $_.successRate -ne $null }
    if ($lowSuccessProfiles.Count -gt 0) {
        $profileData.insights += [PSCustomObject]@{
            id = "low-success-profiles"
            severity = "high"
            description = "$($lowSuccessProfiles.Count) profiles have success rate below 80%"
            impactedProfiles = $lowSuccessProfiles.Count
            affectedDevices = ($lowSuccessProfiles | Measure-Object -Property errorDevices -Sum).Sum
            recommendedAction = "Review failed devices and remediate configuration issues"
            category = "Deployment"
        }
    }

    # Insight: Profiles with conflicts
    $conflictProfiles = $processedProfiles | Where-Object { $_.hasConflicts }
    if ($conflictProfiles.Count -gt 0) {
        $totalConflicts = ($conflictProfiles | Measure-Object -Property conflictDevices -Sum).Sum
        $profileData.insights += [PSCustomObject]@{
            id = "profile-conflicts"
            severity = "high"
            description = "$($conflictProfiles.Count) profiles have configuration conflicts"
            impactedProfiles = $conflictProfiles.Count
            affectedDevices = $totalConflicts
            recommendedAction = "Review conflicting profiles and consolidate settings"
            category = "Conflicts"
        }
    }

    # Insight: Devices failing multiple profiles
    $multiFailDevices = $profileData.failedDevices | Where-Object { $_.failedProfileCount -gt 2 }
    if ($multiFailDevices.Count -gt 0) {
        $profileData.insights += [PSCustomObject]@{
            id = "multi-profile-failures"
            severity = "high"
            description = "$($multiFailDevices.Count) devices are failing 3 or more configuration profiles"
            impactedDevices = $multiFailDevices.Count
            recommendedAction = "Investigate these devices for systemic issues"
            category = "Device Health"
        }
    }

    # Insight: Security profiles with errors
    $securityWithErrors = $processedProfiles | Where-Object { $_.category -eq "Security" -and $_.hasErrors }
    if ($securityWithErrors.Count -gt 0) {
        $profileData.insights += [PSCustomObject]@{
            id = "security-profile-errors"
            severity = "critical"
            description = "$($securityWithErrors.Count) security profiles have deployment errors"
            impactedProfiles = $securityWithErrors.Count
            affectedDevices = ($securityWithErrors | Measure-Object -Property errorDevices -Sum).Sum
            recommendedAction = "Prioritize fixing security profile deployment issues"
            category = "Security"
        }
    }

    # Insight: Pending deployments
    $pendingProfiles = $processedProfiles | Where-Object { $_.pendingDevices -gt 10 }
    if ($pendingProfiles.Count -gt 0) {
        $totalPending = ($pendingProfiles | Measure-Object -Property pendingDevices -Sum).Sum
        $profileData.insights += [PSCustomObject]@{
            id = "pending-deployments"
            severity = "medium"
            description = "$totalPending devices have pending profile deployments"
            impactedProfiles = $pendingProfiles.Count
            affectedDevices = $totalPending
            recommendedAction = "Check device connectivity and sync status"
            category = "Pending"
        }
    }

    Write-Host "      Generated $($profileData.insights.Count) deployment insights" -ForegroundColor Gray

    # Add collection date
    $profileData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $profileData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $profileCount configuration profiles" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $profileCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Authorization") {
        Write-Host "    [!] Configuration profile collection requires Intune license and DeviceManagementConfiguration.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        profiles = @()
        failedDevices = @()
        settingFailures = @()
        insights = @()
        summary = @{}
        collectionDate = (Get-Date).ToString("o")
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
