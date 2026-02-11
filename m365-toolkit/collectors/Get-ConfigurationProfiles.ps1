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

function Convert-ReportRows {
    <#
    .SYNOPSIS
        Converts Intune report responses into an array of objects.
    #>
    param([Parameter(Mandatory)]$Report)

    if (-not $Report) { return @() }

    if ($Report.values -and $Report.columns) {
        $cols = @($Report.columns | ForEach-Object { $_.name })
        $rows = @()
        foreach ($row in $Report.values) {
            $obj = [ordered]@{}
            for ($i = 0; $i -lt $cols.Count; $i++) {
                $colName = $cols[$i]
                if (-not $colName) { continue }
                $obj[$colName] = if ($i -lt $row.Count) { $row[$i] } else { $null }
            }
            $rows += [PSCustomObject]$obj
        }
        return $rows
    }

    if ($Report.value -and $Report.schema) {
        $cols = @($Report.schema | ForEach-Object { $_.name })
        $rows = @()
        foreach ($row in $Report.value) {
            if (-not ($row -is [System.Array])) { continue }
            $obj = [ordered]@{}
            for ($i = 0; $i -lt $cols.Count; $i++) {
                $colName = $cols[$i]
                if (-not $colName) { continue }
                $obj[$colName] = if ($i -lt $row.Count) { $row[$i] } else { $null }
            }
            $rows += [PSCustomObject]$obj
        }
        return $rows
    }

    if ($Report.value -and $Report.value[0] -and $Report.value[0].PSObject) {
        return @($Report.value)
    }

    return @()
}

function Get-ReportValue {
    param(
        [Parameter(Mandatory)]$Row,
        [Parameter(Mandatory)][string[]]$Names
    )

    foreach ($name in $Names) {
        if (-not $name) { continue }
        if ($Row -is [hashtable]) {
            if ($Row.ContainsKey($name)) { return $Row[$name] }
        } else {
            $prop = $Row.PSObject.Properties[$name]
            if ($prop) { return $prop.Value }
        }
    }
    return $null
}

function Get-ConfigurationPolicyReportMap {
    $map = @{}
    $reportNames = @(
        "ConfigurationPolicyDeviceAggregatesWithPFV3",
        "ConfigurationPolicyDeviceAggregatesWithPF",
        "ConfigurationPolicyDeviceAggregatesV3",
        "ConfigurationPolicyDeviceAggregates"
    )

    $select = @(
        "PolicyId","PolicyName","ProfileSource","PolicyPlatformType","UnifiedPolicyPlatformType",
        "NumberOfCompliantDevices","NumberOfErrorDevices","NumberOfConflictDevices","NumberOfInProgressDevices","NumberOfNotApplicableDevices"
    )

    foreach ($reportName in $reportNames) {
        $rows = Invoke-IntuneExportReport -ReportName $reportName -Select $select
        if ($rows -and $rows.Count -gt 0) {
            foreach ($row in $rows) {
                $id = Get-ReportValue -Row $row -Names @("PolicyId","policyId","Id","id")
                if (-not $id) { continue }
                if (-not $map.ContainsKey($id)) {
                    $map[$id] = $row
                }
            }
            Write-Host "      Report map contains $($map.Count) policies (source: $reportName)" -ForegroundColor Gray
            break
        }
    }

    if ($map.Count -eq 0) {
        Write-Host "      Report export returned no rows - using individual status endpoints" -ForegroundColor Yellow
    }

    return $map
}

function Invoke-IntuneExportReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ReportName,

        [Parameter()]
        [string[]]$Select = @(),

        [Parameter()]
        [string]$Filter
    )

    $body = @{
        reportName = $ReportName
        format = "json"
    }
    if ($Select -and $Select.Count -gt 0) { $body.select = $Select }
    if ($Filter) { $body.filter = $Filter }

    $bodyJson = $body | ConvertTo-Json -Depth 6
    $job = $null
    $baseUri = $null

    $jobEndpoints = @(
        "https://graph.microsoft.com/v1.0/deviceManagement/reports/exportJobs",
        "https://graph.microsoft.com/beta/deviceManagement/reports/exportJobs"
    )

    foreach ($endpoint in $jobEndpoints) {
        try {
            $job = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST -Uri $endpoint -Body $bodyJson -ContentType "application/json" -OutputType PSObject
            } -OperationName "Export report job ($ReportName)" -MaxRetries 2

            if ($job -and $job.id) {
                $baseUri = if ($endpoint -match "/v1.0/") { "https://graph.microsoft.com/v1.0" } else { "https://graph.microsoft.com/beta" }
                break
            }
        }
        catch {
            continue
        }
    }

    if (-not $job -or -not $job.id) {
        return @()
    }

    $statusUri = "$baseUri/deviceManagement/reports/exportJobs('$($job.id)')"
    $downloadUrl = $null
    $status = $null
    $maxAttempts = 30
    $delaySeconds = 4

    for ($i = 0; $i -lt $maxAttempts; $i++) {
        try {
            $statusResp = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $statusUri -OutputType PSObject
            } -OperationName "Export report status ($ReportName)" -MaxRetries 2

            $status = Get-GraphPropertyValue -Object $statusResp -PropertyNames @("status","Status")
            $downloadUrl = Get-GraphPropertyValue -Object $statusResp -PropertyNames @("url","Url","downloadUrl","DownloadUrl")

            if ($status -match "completed" -and $downloadUrl) { break }
            if ($status -match "failed") { return @() }
        }
        catch {
            # keep polling
        }

        Start-Sleep -Seconds $delaySeconds
    }

    if (-not $downloadUrl) { return @() }

    $tempRoot = Join-Path $env:TEMP ("tenantscope-report-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $zipPath = Join-Path $tempRoot "report.zip"

    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $tempRoot -Force

        $jsonFile = Get-ChildItem -Path $tempRoot -Filter *.json -Recurse | Select-Object -First 1
        if ($jsonFile) {
            $raw = Get-Content $jsonFile.FullName -Raw
            $parsed = $null
            try {
                $parsed = $raw | ConvertFrom-Json
            }
            catch {
                return @()
            }

            if ($parsed -is [System.Collections.IEnumerable] -and $parsed.Count -gt 0 -and $parsed[0].PSObject) {
                return @($parsed)
            }

            return (Convert-ReportRows -Report $parsed)
        }

        $csvFile = Get-ChildItem -Path $tempRoot -Filter *.csv -Recurse | Select-Object -First 1
        if ($csvFile) {
            return @(Import-Csv -Path $csvFile.FullName)
        }

        return @()
    }
    finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
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

    $allProfiles = New-Object System.Collections.ArrayList
    $allFailedDevices = @{}

    # ========================================
    # Collect Device Configurations (Legacy)
    # ========================================
    try {
        $configs = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations" -OutputType PSObject
        } -OperationName "Device configuration retrieval"

        $legacyConfigs = New-Object System.Collections.ArrayList
        if ($configs.value) {
            foreach ($cfg in @($configs.value)) {
                if ($cfg) { [void]$legacyConfigs.Add($cfg) }
            }
        }

        # Handle pagination - capture nextLink before ScriptBlock to avoid closure issues
        while ($configs.'@odata.nextLink') {
            $nextLink = $configs.'@odata.nextLink'
            $configs = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $nextLink -OutputType PSObject
            } -OperationName "Device configuration pagination"
            if ($configs.value) {
                foreach ($cfg in @($configs.value)) {
                    if ($cfg) { [void]$legacyConfigs.Add($cfg) }
                }
            }
        }

        foreach ($config in $legacyConfigs) {
            try {
                $wrapper = [PSCustomObject]@{
                    source = "deviceConfigurations"
                    data = $config
                }
                [void]$allProfiles.Add($wrapper)
            }
            catch {
                Write-Host "      [!] Skipped invalid device configuration" -ForegroundColor Yellow
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

        $catalogPolicies = New-Object System.Collections.ArrayList
        if ($settingsCatalog.value) {
            foreach ($pol in @($settingsCatalog.value)) {
                if ($pol) { [void]$catalogPolicies.Add($pol) }
            }
        }

        # Handle pagination - capture nextLink before ScriptBlock to avoid closure issues
        while ($settingsCatalog.'@odata.nextLink') {
            $nextLink = $settingsCatalog.'@odata.nextLink'
            $settingsCatalog = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $nextLink -OutputType PSObject
            } -OperationName "Settings catalog pagination"
            if ($settingsCatalog.value) {
                foreach ($pol in @($settingsCatalog.value)) {
                    if ($pol) { [void]$catalogPolicies.Add($pol) }
                }
            }
        }

        foreach ($policy in $catalogPolicies) {
            try {
                $wrapper = [PSCustomObject]@{
                    source = "configurationPolicies"
                    data = $policy
                }
                [void]$allProfiles.Add($wrapper)
            }
            catch {
                Write-Host "      [!] Skipped invalid settings catalog policy" -ForegroundColor Yellow
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
    $policyReportMap = Get-ConfigurationPolicyReportMap

    # Build a cache for group names
    $groupNameCache = @{}

    # Throttle control: limit detailed API calls to avoid 429s
    $detailedStatusLimit = 100  # Fetch detailed status for first N profiles (increased for Settings Catalog)
    $apiCallCount = 0
    $throttleDelay = 200  # ms between API-heavy operations (increased to prevent throttling)

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
            $usedStatusFallback = $false
            $deviceStatusList = @()
            $skipDetailedStatus = ($profileCount -ge $detailedStatusLimit)

            # For Settings Catalog, prefer report data to avoid extra API calls
            if ($policyReportMap.ContainsKey($profile.id)) {
                $row = $policyReportMap[$profile.id]
                $successCount = [int](Get-ReportValue -Row $row -Names @("NumberOfCompliantDevices","successDeviceCount","successCount"))
                $errorCount = [int](Get-ReportValue -Row $row -Names @("NumberOfErrorDevices","errorDeviceCount","errorCount"))
                $conflictCount = [int](Get-ReportValue -Row $row -Names @("NumberOfConflictDevices","conflictDeviceCount","conflictCount"))
                $pendingCount = [int](Get-ReportValue -Row $row -Names @("NumberOfInProgressDevices","pendingDeviceCount","pendingCount"))
                $notApplicableCount = [int](Get-ReportValue -Row $row -Names @("NumberOfNotApplicableDevices","notApplicableDeviceCount","notApplicableCount"))
                $usedStatusFallback = $true
            }
            elseif (-not $skipDetailedStatus) {
                # Only fetch status overview if we don't have report data and haven't hit limit
                try {
                    $apiCallCount++
                    if ($apiCallCount % 10 -eq 0) {
                        Start-Sleep -Milliseconds $throttleDelay
                    }

                    if ($source -eq "deviceConfigurations") {
                        $statusOverview = Invoke-MgGraphRequest -Method GET `
                            -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/deviceStatusOverview" `
                            -OutputType PSObject

                        $successCount = if ($null -ne $statusOverview.successCount) { [int]$statusOverview.successCount }
                                       elseif ($null -ne $statusOverview.compliantDeviceCount) { [int]$statusOverview.compliantDeviceCount + [int]$statusOverview.remediatedDeviceCount }
                                       else { 0 }
                        $errorCount = if ($null -ne $statusOverview.errorCount) { [int]$statusOverview.errorCount }
                                     elseif ($null -ne $statusOverview.errorDeviceCount) { [int]$statusOverview.errorDeviceCount }
                                     else { 0 }
                        $conflictCount = if ($null -ne $statusOverview.conflictCount) { [int]$statusOverview.conflictCount }
                                        elseif ($null -ne $statusOverview.conflictDeviceCount) { [int]$statusOverview.conflictDeviceCount }
                                        else { 0 }
                        $pendingCount = if ($null -ne $statusOverview.pendingCount) { [int]$statusOverview.pendingCount }
                                       elseif ($null -ne $statusOverview.pendingDeviceCount) { [int]$statusOverview.pendingDeviceCount }
                                       else { 0 }
                        $notApplicableCount = if ($null -ne $statusOverview.notApplicableCount) { [int]$statusOverview.notApplicableCount }
                                             elseif ($null -ne $statusOverview.notApplicableDeviceCount) { [int]$statusOverview.notApplicableDeviceCount }
                                             else { 0 }
                    }
                    elseif ($source -eq "configurationPolicies") {
                        # Settings Catalog: use per-policy report endpoint
                        try {
                            $reportBody = @{
                                name = "DeviceAssignment"
                                filter = "(PolicyId eq '$($profile.id)')"
                                select = @("PolicyStatus")
                            } | ConvertTo-Json -Depth 4

                            $policyReport = Invoke-MgGraphRequest -Method POST `
                                -Uri "https://graph.microsoft.com/beta/deviceManagement/reports/getConfigurationPolicyDevicesReport" `
                                -Body $reportBody -ContentType "application/json" -OutputType PSObject

                            # Count statuses from report values
                            if ($policyReport.Values) {
                                foreach ($row in $policyReport.Values) {
                                    # PolicyStatus is typically at index based on schema
                                    $statusVal = if ($row -is [System.Array] -and $row.Count -gt 0) { $row[0] } else { $row }
                                    switch -Regex ($statusVal) {
                                        "Success|Compliant" { $successCount++ }
                                        "Error|Failed" { $errorCount++ }
                                        "Conflict" { $conflictCount++ }
                                        "Pending|InProgress" { $pendingCount++ }
                                        "NotApplicable" { $notApplicableCount++ }
                                    }
                                }
                            }
                        }
                        catch {
                            # Fallback: try deviceStatuses endpoint
                            try {
                                $statuses = Invoke-MgGraphRequest -Method GET `
                                    -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($profile.id)/deviceStatuses?`$top=999" `
                                    -OutputType PSObject

                                if ($statuses.value) {
                                    foreach ($s in $statuses.value) {
                                        switch ($s.status) {
                                            "succeeded" { $successCount++ }
                                            "error" { $errorCount++ }
                                            "conflict" { $conflictCount++ }
                                            "pending" { $pendingCount++ }
                                            "notApplicable" { $notApplicableCount++ }
                                        }
                                    }
                                }
                            }
                            catch {
                                # Neither endpoint available for this policy
                            }
                        }
                    }
                }
                catch {
                    # Silently continue - we'll try fallbacks
                }
            }

            # Status source tracking
            $statusSource = if ($usedStatusFallback) { "report" } else { "overview" }

            # Get assignments for this profile (only for first N profiles to reduce API calls)
            $assignments = @()
            if (-not $skipDetailedStatus) {
                try {
                    $apiCallCount++
                    if ($apiCallCount % 10 -eq 0) { Start-Sleep -Milliseconds $throttleDelay }

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
                    # Silently continue
                }
            }

            # Get failed device details (only for profiles with errors and within limit)
            $deviceStatuses = @()
            $profileNameForTracking = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unknown Profile" }

            if (($errorCount -gt 0 -or $conflictCount -gt 0) -and -not $skipDetailedStatus) {
                try {
                    $apiCallCount++
                    if ($apiCallCount % 10 -eq 0) { Start-Sleep -Milliseconds $throttleDelay }

                    $statusUri = if ($source -eq "deviceConfigurations") {
                        "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/deviceStatuses?`$filter=status eq 'error' or status eq 'conflict'&`$top=20"
                    } else {
                        "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($profile.id)/deviceStatuses?`$filter=status eq 'error' or status eq 'conflict'&`$top=20"
                    }

                    $deviceStatusResponse = Invoke-MgGraphRequest -Method GET -Uri $statusUri -OutputType PSObject
                    $sourceStatuses = @($deviceStatusResponse.value)

                    foreach ($status in $sourceStatuses) {
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
                    # Silently continue
                }
            }

            # Get setting-level failures for this profile (only for deviceConfigurations within limit)
            $settingStatuses = @()
            $profileDisplayName = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unknown" }

            if ($source -eq "deviceConfigurations" -and -not $skipDetailedStatus -and ($errorCount -gt 0 -or $conflictCount -gt 0)) {
                try {
                    $apiCallCount++
                    if ($apiCallCount % 10 -eq 0) { Start-Sleep -Milliseconds $throttleDelay }

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
                    # Silently continue
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
