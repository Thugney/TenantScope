# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Intune application deployment status and inventory.

.DESCRIPTION
    Retrieves all applications managed by Intune including Win32 apps,
    LOB apps, Microsoft Store apps, and web clips. Shows deployment
    status, installation success/failure rates, and assignment targets.

    Graph API endpoints:
    - GET /deviceAppManagement/mobileApps
    - GET /deviceAppManagement/mobileApps/{id}/assignments
    - GET /deviceAppManagement/mobileApps/{id}/deviceStatuses

    Required scopes:
    - DeviceManagementApps.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes app-deployments.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-AppDeployments.ps1 -Config $config -OutputPath ".\data\app-deployments.json"
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

function Get-AppType {
    <#
    .SYNOPSIS
        Determines the app type from @odata.type.
    #>
    param([string]$ODataType)

    switch -Regex ($ODataType) {
        "win32LobApp"              { return "Win32" }
        "windowsMobileMSI"         { return "MSI" }
        "windowsUniversalAppX"     { return "MSIX/AppX" }
        "windowsStoreApp"          { return "Store App" }
        "microsoftStoreForBusiness" { return "Store for Business" }
        "officeSuiteApp"           { return "Microsoft 365 Apps" }
        "windowsWebApp"            { return "Web App" }
        "androidStoreApp"          { return "Android Store" }
        "androidLobApp"            { return "Android LOB" }
        "androidManagedStoreApp"   { return "Android Managed" }
        "iosStoreApp"              { return "iOS Store" }
        "iosLobApp"                { return "iOS LOB" }
        "iosVppApp"                { return "iOS VPP" }
        "macOSLobApp"              { return "macOS LOB" }
        "macOSDmgApp"              { return "macOS DMG" }
        "macOSPkgApp"              { return "macOS PKG" }
        "macOSMicrosoftEdgeApp"    { return "macOS Edge" }
        "macOSMicrosoftDefender"   { return "macOS Defender" }
        "webApp"                   { return "Web Link" }
        default                    { return "Other" }
    }
}

function Get-AppPlatform {
    <#
    .SYNOPSIS
        Determines the platform from @odata.type.
    #>
    param([string]$ODataType)

    switch -Regex ($ODataType) {
        "windows|win32|officeSuite" { return "Windows" }
        "android"  { return "Android" }
        "ios"      { return "iOS" }
        "macOS"    { return "macOS" }
        "webApp"   { return "Cross-platform" }
        default    { return "Unknown" }
    }
}

function Get-InstallIntent {
    <#
    .SYNOPSIS
        Maps install intent to readable string.
    #>
    param([string]$Intent)

    switch ($Intent) {
        "required"            { return "Required" }
        "available"           { return "Available" }
        "availableWithoutEnrollment" { return "Available (No Enrollment)" }
        "uninstall"           { return "Uninstall" }
        default               { return $Intent }
    }
}

function Get-AppVersion {
    <#
    .SYNOPSIS
        Resolves the most relevant version field across app types.
    #>
    param([Parameter(Mandatory)]$App)

    $candidates = @(
        $App.version,
        $App.displayVersion,
        $App.appVersion,
        $App.committedContentVersion,
        $App.productVersion
    )

    foreach ($v in $candidates) {
        if ($v -and ($v -is [string] -or $v -is [int])) {
            return $v
        }
    }

    return $null
}

function Get-AppInstallSummary {
    <#
    .SYNOPSIS
        Retrieves aggregate install counts for an app (when deviceStatuses is unavailable).
    #>
    param([Parameter(Mandatory)][string]$AppId)

    try {
        $summary = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/installSummary" -OutputType PSObject
        } -OperationName "App install summary"
    }
    catch {
        return $null
    }

    if (-not $summary) { return $null }

    $installed = Get-CountValue -Object $summary -Names @("installedDeviceCount","installedCount","installedUserCount")
    $failed = Get-CountValue -Object $summary -Names @("failedDeviceCount","failedCount","failedUserCount")
    $pending = Get-CountValue -Object $summary -Names @("pendingInstallDeviceCount","pendingDeviceCount","pendingCount","pendingInstallUserCount","pendingUserCount")
    $notInstalled = Get-CountValue -Object $summary -Names @("notInstalledDeviceCount","notInstalledCount","notInstalledUserCount")
    $notApplicable = Get-CountValue -Object $summary -Names @("notApplicableDeviceCount","notApplicableCount","notApplicableUserCount")

    return [PSCustomObject]@{
        installed = $installed
        failed = $failed
        pending = $pending
        notInstalled = $notInstalled
        notApplicable = $notApplicable
    }
}

function Convert-ReportRows {
    <#
    .SYNOPSIS
        Converts Intune report responses into an array of objects.
    #>
    param([Parameter(Mandatory)]$Report)

    if (-not $Report) { return @() }

    # Pattern: { columns: [...], values: [[...], ...] }
    if ($Report.values -and $Report.columns) {
        $cols = @($Report.columns | ForEach-Object { $_.name })
        $rows = @()
        foreach ($row in $Report.values) {
            $obj = [ordered]@{}
            for ($i = 0; $i -lt $cols.Count; $i++) {
                $obj[$cols[$i]] = if ($i -lt $row.Count) { $row[$i] } else { $null }
            }
            $rows += [PSCustomObject]$obj
        }
        return $rows
    }

    # Pattern: { schema: [...], value: [[...], ...] }
    if ($Report.value -and $Report.schema) {
        $cols = @($Report.schema | ForEach-Object { $_.name })
        $rows = @()
        foreach ($row in $Report.value) {
            if (-not ($row -is [System.Array])) { continue }
            $obj = [ordered]@{}
            for ($i = 0; $i -lt $cols.Count; $i++) {
                $obj[$cols[$i]] = if ($i -lt $row.Count) { $row[$i] } else { $null }
            }
            $rows += [PSCustomObject]$obj
        }
        return $rows
    }

    # Pattern: { value: [ {..}, {..} ] }
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
        $prop = $Row.PSObject.Properties[$name]
        if ($prop) { return $prop.Value }
    }
    return $null
}

function Convert-ToIntSafe {
    param([Parameter()]$Value)

    if ($null -eq $Value) { return 0 }
    if ($Value -is [int]) { return $Value }
    if ($Value -is [long]) { return [int]$Value }
    if ($Value -is [double] -or $Value -is [decimal]) { return [int][Math]::Round($Value, 0) }

    $text = $Value.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return 0 }

    $parsed = 0
    if ([int]::TryParse($text, [ref]$parsed)) { return $parsed }

    $parsedDouble = 0.0
    if ([double]::TryParse($text, [ref]$parsedDouble)) { return [int][Math]::Round($parsedDouble, 0) }

    return 0
}

function Get-CountValue {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string[]]$Names
    )

    foreach ($name in $Names) {
        $value = Get-ReportValue -Row $Object -Names @($name)
        if ($null -ne $value -and $value.ToString().Trim().Length -gt 0) {
            return Convert-ToIntSafe -Value $value
        }
    }

    return 0
}

function Normalize-GraphId {
    param([Parameter()]$Id)

    if ($null -eq $Id) { return $null }
    $text = $Id.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return $text.Trim("{}").ToLowerInvariant()
}

function Get-AppInstallReportMap {
    <#
    .SYNOPSIS
        Retrieves app install summary report and returns map keyed by appId.
    #>
    $map = @{}
    $selectSets = @(
        @(
            "appId","appName","installedDeviceCount","failedDeviceCount",
            "pendingInstallDeviceCount","notInstalledDeviceCount","notApplicableDeviceCount",
            "deviceCount"
        ),
        @(
            "applicationId","applicationName","installedDeviceCount","failedDeviceCount",
            "pendingInstallDeviceCount","notInstalledDeviceCount","notApplicableDeviceCount",
            "deviceCount"
        )
    )

    $endpoints = @(
        "https://graph.microsoft.com/beta/deviceManagement/reports/getAppInstallSummaryReport",
        "https://graph.microsoft.com/beta/deviceManagement/reports/getAppInstallStatusReport"
    )

    $report = $null
    foreach ($endpoint in $endpoints) {
        foreach ($select in $selectSets) {
            $body = @{
                select = $select
                skip = 0
                top = 2000
            } | ConvertTo-Json -Depth 6

            try {
                $report = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method POST `
                        -Uri $endpoint `
                        -Body $body -ContentType "application/json" -OutputType PSObject
                } -OperationName "App install report"
            }
            catch {
                $report = $null
            }

            if (-not $report) { continue }

            $rows = Convert-ReportRows -Report $report
            if (-not $rows -or $rows.Count -eq 0) { continue }

            foreach ($row in $rows) {
                $id = Get-ReportValue -Row $row -Names @("appId", "applicationId", "ApplicationId", "id")
                $normalizedId = Normalize-GraphId -Id $id
                if (-not $normalizedId) { continue }
                if (-not $map.ContainsKey($normalizedId)) {
                    $map[$normalizedId] = $row
                }
            }
        }
    }

    return $map
}

function Add-InstallStateCounts {
    param(
        [Parameter(Mandatory)][string]$State,
        [Parameter(Mandatory)][hashtable]$Counts
    )

    $s = $State.ToLowerInvariant()
    if ($s -match "notinstalled|uninstall") { $Counts.notInstalled += 1; return }
    if ($s -match "installed") { $Counts.installed += 1; return }
    if ($s -match "fail|error") { $Counts.failed += 1; return }
    if ($s -match "pending|inprogress|queued|wait|reboot") { $Counts.pending += 1; return }
    if ($s -match "notapplicable") { $Counts.notApplicable += 1; return }
}

function Get-AppUserStatusSummary {
    param([Parameter(Mandatory)][string]$AppId)

    $counts = @{
        installed = 0
        failed = 0
        pending = 0
        notInstalled = 0
        notApplicable = 0
    }

    try {
        $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/userStatuses?`$top=100"
        $allStatuses = @()
        do {
            $resp = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
            } -OperationName "App user status retrieval"

            if ($resp.value) { $allStatuses += @($resp.value) }
            $uri = $resp.'@odata.nextLink'
        } while ($uri -and $allStatuses.Count -lt 2000)

        foreach ($status in $allStatuses) {
            if (-not $status.installState) { continue }
            Add-InstallStateCounts -State $status.installState.ToString() -Counts $counts
        }
    }
    catch {
        return $null
    }

    return [PSCustomObject]$counts
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$appCount = 0

try {
    Write-Host "    Collecting Intune app deployments..." -ForegroundColor Gray

    # Initialize data structure
    $appData = @{
        apps = @()
        failedDevices = @()
        insights = @()
        summary = @{
            totalApps = 0
            win32Apps = 0
            storeApps = 0
            lobApps = 0
            webApps = 0
            m365Apps = 0
            totalInstalled = 0
            totalFailed = 0
            totalPending = 0
            appsWithFailures = 0
            overallInstallRate = 0
            platformBreakdown = @{}
            typeBreakdown = @{}
        }
    }

    # Build a cache for group names
    $groupNameCache = @{}

    # Track failed devices across all apps
    $allFailedDevices = @{}

    # Get all mobile apps
    $apps = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?`$filter=isAssigned eq true" `
            -OutputType PSObject
    } -OperationName "Mobile apps retrieval"

    $allApps = @($apps.value)

    # Handle pagination
    while ($apps.'@odata.nextLink') {
        $apps = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $apps.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Mobile apps pagination"
        $allApps += $apps.value
    }

    Write-Host "      Retrieved $($allApps.Count) assigned apps" -ForegroundColor Gray

    $processedApps = @()
    $installReportMap = Get-AppInstallReportMap

    foreach ($app in $allApps) {
        try {
            $appType = Get-AppType -ODataType $app.'@odata.type'
            $platform = Get-AppPlatform -ODataType $app.'@odata.type'
            $version = Get-AppVersion -App $app

            # Get assignments
            $assignments = @()
            try {
                $assignmentResponse = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($app.id)/assignments" `
                    -OutputType PSObject

                foreach ($assignment in $assignmentResponse.value) {
                    $intent = Get-InstallIntent -Intent $assignment.intent
                    $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -ExcludeSuffix " (Excluded)"
                    $assignments += @{
                        intent     = $intent
                        targetType = $target.type  # Use friendly name (AllDevices, Group, etc.) not @odata.type
                        targetName = $target.name
                        groupId    = $target.groupId
                    }
                }
            }
            catch {
                Write-Warning "      Failed to get assignments for app $($app.displayName): $($_.Exception.Message)"
            }

            # Get device install status
            $installedCount = 0
            $failedCount = 0
            $pendingCount = 0
            $notApplicableCount = 0
            $notInstalledCount = 0
            $deviceStatuses = @()
            $usedInstallSummary = $false

            # Prefer report summary map when available (covers all app types)
            # Only use it if we get actual non-zero data
            $normalizedAppId = Normalize-GraphId -Id $app.id
            if ($normalizedAppId -and $installReportMap.ContainsKey($normalizedAppId)) {
                $row = $installReportMap[$normalizedAppId]
                $reportInstalled = Get-CountValue -Object $row -Names @("installedDeviceCount","installedCount","installedUserCount")
                $reportFailed = Get-CountValue -Object $row -Names @("failedDeviceCount","failedCount","failedUserCount")
                $reportPending = Get-CountValue -Object $row -Names @("pendingInstallDeviceCount","pendingCount","pendingInstallUserCount","pendingUserCount")
                $reportNotInstalled = Get-CountValue -Object $row -Names @("notInstalledDeviceCount","notInstalledCount","notInstalledUserCount")
                $reportNotApplicable = Get-CountValue -Object $row -Names @("notApplicableDeviceCount","notApplicableCount","notApplicableUserCount")

                # Only use report data if we got at least some counts
                if (($reportInstalled + $reportFailed + $reportPending + $reportNotInstalled + $reportNotApplicable) -gt 0) {
                    $installedCount = $reportInstalled
                    $failedCount = $reportFailed
                    $pendingCount = $reportPending
                    $notInstalledCount = $reportNotInstalled
                    $notApplicableCount = $reportNotApplicable
                    $usedInstallSummary = $true
                }
            }

            # Fallback to aggregate install summary endpoint when report data unavailable
            if (-not $usedInstallSummary) {
                $installSummary = Get-AppInstallSummary -AppId $app.id
                if ($installSummary) {
                    $summaryTotal = $installSummary.installed + $installSummary.failed + $installSummary.pending + $installSummary.notInstalled + $installSummary.notApplicable
                    # Only use summary data if we got at least some counts
                    if ($summaryTotal -gt 0) {
                        $installedCount = $installSummary.installed
                        $failedCount = $installSummary.failed
                        $pendingCount = $installSummary.pending
                        $notInstalledCount = $installSummary.notInstalled
                        $notApplicableCount = $installSummary.notApplicable
                        $usedInstallSummary = $true
                    }
                }
            }

            try {
                # deviceStatuses endpoint only works for managed app types (Win32, LOB)
                # Store apps and web links don't have device-level status
                # Use $top=100 as Graph API max for paginated endpoints
                $deviceStatusUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($app.id)/deviceStatuses?`$top=100"
                $allStatuses = @()
                $useStatusCounts = -not $usedInstallSummary

                do {
                    $deviceStatus = Invoke-GraphWithRetry -ScriptBlock {
                        Invoke-MgGraphRequest -Method GET -Uri $deviceStatusUri -OutputType PSObject
                    } -OperationName "App device status retrieval"
                    if ($deviceStatus.value) {
                        $allStatuses += $deviceStatus.value
                    }
                    $deviceStatusUri = $deviceStatus.'@odata.nextLink'
                } while ($deviceStatusUri -and $allStatuses.Count -lt 1000)

                foreach ($status in $allStatuses) {
                    switch ($status.installState) {
                        "installed"      { if ($useStatusCounts) { $installedCount++ } }
                        "failed"         {
                            if ($useStatusCounts) { $failedCount++ }
                            # Track failed device details with extended info
                            $deviceStatuses += [PSCustomObject]@{
                                deviceName = $status.deviceName
                                userName = $status.userName
                                deviceId = $status.deviceId
                                osVersion = $status.osVersion
                                installState = $status.installState
                                installStateDetail = $status.installStateDetail
                                errorCode = $status.errorCode
                                lastSyncDateTime = Format-IsoDate -DateValue $status.lastSyncDateTime
                            }

                            # Track unique failed devices across all apps
                            $deviceKey = $status.deviceName
                            if ($deviceKey) {
                                if (-not $allFailedDevices.ContainsKey($deviceKey)) {
                                    $allFailedDevices[$deviceKey] = @{
                                        deviceName = $status.deviceName
                                        userName = $status.userName
                                        failedApps = @()
                                        failedCount = 0
                                    }
                                }
                                $allFailedDevices[$deviceKey].failedApps += $app.displayName
                                $allFailedDevices[$deviceKey].failedCount++
                            }
                        }
                        { $_ -in @("pending", "pendingInstall", "pendingReboot") } { if ($useStatusCounts) { $pendingCount++ } }
                        "notInstalled"   { if ($useStatusCounts) { $notInstalledCount++ } }
                        "notApplicable"  { if ($useStatusCounts) { $notApplicableCount++ } }
                        "unknown"        { } # Ignore unknown states
                        default          { } # Ignore other states
                    }
                }
            }
            catch {
                # deviceStatuses not available for this app type (e.g., Store apps, web links)
                # This is expected - only managed apps (Win32, LOB) have device-level status
            }

            # Final fallback for user-targeted apps where device counters remain empty.
            if (($installedCount + $failedCount + $pendingCount + $notInstalledCount + $notApplicableCount) -eq 0 -and $assignments.Count -gt 0) {
                $userSummary = Get-AppUserStatusSummary -AppId $app.id
                if ($userSummary) {
                    $userTotal = $userSummary.installed + $userSummary.failed + $userSummary.pending + $userSummary.notInstalled + $userSummary.notApplicable
                    if ($userTotal -gt 0) {
                        $installedCount = $userSummary.installed
                        $failedCount = $userSummary.failed
                        $pendingCount = $userSummary.pending
                        $notInstalledCount = $userSummary.notInstalled
                        $notApplicableCount = $userSummary.notApplicable
                    }
                }
            }

            $totalDevices = $installedCount + $failedCount + $pendingCount + $notInstalledCount
            $successRate = if ($totalDevices -gt 0) {
                [Math]::Round(($installedCount / $totalDevices) * 100, 1)
            } else { $null }

            # Build processed app object
            $processedApp = [PSCustomObject]@{
                id                   = $app.id
                displayName          = $app.displayName
                description          = $app.description
                publisher            = $app.publisher
                appType              = $appType
                platform             = $platform
                version              = $version
                createdDateTime      = Format-IsoDate -DateValue $app.createdDateTime
                lastModifiedDateTime = Format-IsoDate -DateValue $app.lastModifiedDateTime
                isFeatured           = [bool]$app.isFeatured
                privacyInformationUrl = $app.privacyInformationUrl
                informationUrl       = $app.informationUrl
                # Assignments
                assignments          = $assignments
                assignmentCount      = $assignments.Count
                hasRequiredAssignment = ($assignments | Where-Object { $_.intent -eq "Required" }).Count -gt 0
                # Installation status
                installedDevices     = $installedCount
                failedDevices        = $failedCount
                pendingDevices       = $pendingCount
                notInstalledDevices  = $notInstalledCount
                notApplicableDevices = $notApplicableCount
                totalDevices         = $totalDevices
                successRate          = $successRate
                # Device statuses (failed only)
                deviceStatuses       = $deviceStatuses
                # Health
                hasFailures          = ($failedCount -gt 0)
                needsAttention       = ($failedCount -gt 5 -or ($successRate -and $successRate -lt 80))
            }

            $processedApps += $processedApp
            $appCount++

            # Update summary
            $appData.summary.totalApps++
            $appData.summary.totalInstalled += $installedCount
            $appData.summary.totalFailed += $failedCount
            $appData.summary.totalPending += $pendingCount
            if ($failedCount -gt 0) { $appData.summary.appsWithFailures++ }

            # Update type breakdown
            switch ($appType) {
                "Win32"              { $appData.summary.win32Apps++ }
                "Store App"          { $appData.summary.storeApps++ }
                "Store for Business" { $appData.summary.storeApps++ }
                "Microsoft 365 Apps" { $appData.summary.m365Apps++ }
                "Web Link"           { $appData.summary.webApps++ }
                "Web App"            { $appData.summary.webApps++ }
                { $_ -match "LOB" }  { $appData.summary.lobApps++ }
            }

            # Update platform breakdown
            if (-not $appData.summary.platformBreakdown.ContainsKey($platform)) {
                $appData.summary.platformBreakdown[$platform] = @{ apps = 0; installed = 0; failed = 0 }
            }
            $appData.summary.platformBreakdown[$platform].apps++
            $appData.summary.platformBreakdown[$platform].installed += $installedCount
            $appData.summary.platformBreakdown[$platform].failed += $failedCount

            # Update type breakdown details
            if (-not $appData.summary.typeBreakdown.ContainsKey($appType)) {
                $appData.summary.typeBreakdown[$appType] = @{ apps = 0; installed = 0; failed = 0 }
            }
            $appData.summary.typeBreakdown[$appType].apps++
            $appData.summary.typeBreakdown[$appType].installed += $installedCount
            $appData.summary.typeBreakdown[$appType].failed += $failedCount

            # Progress indicator
            if ($appCount % 20 -eq 0) {
                Write-Host "      Processed $appCount apps..." -ForegroundColor Gray
            }
        }
        catch {
            $errors += "Error processing app $($app.displayName): $($_.Exception.Message)"
        }
    }

    # Sort by failure count (most failures first)
    $processedApps = $processedApps | Sort-Object -Property @{
        Expression = { $_.failedDevices }
        Descending = $true
    }, @{
        Expression = { if ($null -eq $_.successRate) { 101 } else { $_.successRate } }
    }

    $appData.apps = $processedApps

    # Convert failed devices hashtable to array
    foreach ($device in $allFailedDevices.Values) {
        $appData.failedDevices += [PSCustomObject]@{
            deviceName = $device.deviceName
            userName = $device.userName
            failedApps = $device.failedApps
            failedAppCount = $device.failedApps.Count
        }
    }

    # Sort failed devices by count
    $appData.failedDevices = $appData.failedDevices | Sort-Object -Property failedAppCount -Descending

    # Calculate overall install rate
    $totalAttempted = $appData.summary.totalInstalled + $appData.summary.totalFailed + $appData.summary.totalPending
    if ($totalAttempted -gt 0) {
        $appData.summary.overallInstallRate = [Math]::Round(($appData.summary.totalInstalled / $totalAttempted) * 100, 1)
    }

    # ========================================
    # Generate Insights
    # ========================================

    # Insight: Apps with high failure rates
    $highFailureApps = $processedApps | Where-Object { $_.failedDevices -gt 10 }
    if ($highFailureApps.Count -gt 0) {
        $totalFailures = ($highFailureApps | Measure-Object -Property failedDevices -Sum).Sum
        $appData.insights += [PSCustomObject]@{
            id = "high-failure-apps"
            title = "Apps with high failure rates"
            severity = "critical"
            description = "$($highFailureApps.Count) apps have more than 10 failed installations"
            impactedApps = $highFailureApps.Count
            impactedDevices = $totalFailures
            recommendedAction = "Review installation logs and app requirements for failing applications"
            category = "Installation Failures"
        }
    }

    # Insight: Required apps failing
    $requiredAppsFailing = $processedApps | Where-Object { $_.hasRequiredAssignment -and $_.failedDevices -gt 0 }
    if ($requiredAppsFailing.Count -gt 0) {
        $appData.insights += [PSCustomObject]@{
            id = "required-apps-failing"
            title = "Required apps with failures"
            severity = "high"
            description = "$($requiredAppsFailing.Count) required apps have installation failures"
            impactedApps = $requiredAppsFailing.Count
            impactedDevices = ($requiredAppsFailing | Measure-Object -Property failedDevices -Sum).Sum
            recommendedAction = "Prioritize fixing required app deployments as they impact device compliance"
            category = "Required Apps"
        }
    }

    # Insight: Low install rates
    $lowInstallRateApps = $processedApps | Where-Object { $_.successRate -and $_.successRate -lt 80 -and $_.totalDevices -ge 10 }
    if ($lowInstallRateApps.Count -gt 0) {
        $appData.insights += [PSCustomObject]@{
            id = "low-install-rate"
            title = "Apps with low install rates"
            severity = "high"
            description = "$($lowInstallRateApps.Count) apps have install success rate below 80%"
            impactedApps = $lowInstallRateApps.Count
            recommendedAction = "Review app compatibility and deployment settings"
            category = "Deployment Health"
        }
    }

    # Insight: Devices failing multiple apps
    $multiFailDevices = $appData.failedDevices | Where-Object { $_.failedAppCount -ge 3 }
    if ($multiFailDevices.Count -gt 0) {
        $appData.insights += [PSCustomObject]@{
            id = "multi-app-failures"
            title = "Devices with multiple app failures"
            severity = "high"
            description = "$($multiFailDevices.Count) devices are failing 3 or more app installations"
            impactedDevices = $multiFailDevices.Count
            recommendedAction = "Investigate these devices for systemic issues (disk space, permissions, connectivity)"
            category = "Device Health"
        }
    }

    # Insight: Pending deployments
    $pendingApps = $processedApps | Where-Object { $_.pendingDevices -gt 10 }
    if ($pendingApps.Count -gt 0) {
        $totalPending = ($pendingApps | Measure-Object -Property pendingDevices -Sum).Sum
        $appData.insights += [PSCustomObject]@{
            id = "pending-deployments"
            title = "Apps with pending installations"
            severity = "medium"
            description = "$totalPending devices have pending app installations across $($pendingApps.Count) apps"
            impactedApps = $pendingApps.Count
            impactedDevices = $totalPending
            recommendedAction = "Check device connectivity and sync status"
            category = "Pending"
        }
    }

    Write-Host "      Generated $($appData.insights.Count) deployment insights" -ForegroundColor Gray

    # Add collection date
    $appData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $appData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $appCount app deployments" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $appCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Authorization") {
        Write-Host "    [!] App deployment collection requires Intune license and DeviceManagementApps.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        apps = @()
        failedDevices = @()
        insights = @()
        summary = @{}
        collectionDate = (Get-Date).ToString("o")
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
