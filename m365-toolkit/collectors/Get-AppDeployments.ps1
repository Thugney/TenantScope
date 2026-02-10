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

    $installed = if ($null -ne $summary.installedDeviceCount) { [int]$summary.installedDeviceCount } else { 0 }
    $failed = if ($null -ne $summary.failedDeviceCount) { [int]$summary.failedDeviceCount } else { 0 }
    $pending = if ($null -ne $summary.pendingInstallDeviceCount) { [int]$summary.pendingInstallDeviceCount }
               elseif ($null -ne $summary.pendingDeviceCount) { [int]$summary.pendingDeviceCount }
               else { 0 }
    $notInstalled = if ($null -ne $summary.notInstalledDeviceCount) { [int]$summary.notInstalledDeviceCount } else { 0 }
    $notApplicable = if ($null -ne $summary.notApplicableDeviceCount) { [int]$summary.notApplicableDeviceCount } else { 0 }

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

function Get-AppInstallReportMap {
    <#
    .SYNOPSIS
        Retrieves app install summary report and returns map keyed by appId.
    #>
    $map = @{}
    $body = @{
        select = @(
            "appId","appName","installedDeviceCount","failedDeviceCount",
            "pendingInstallDeviceCount","notInstalledDeviceCount","notApplicableDeviceCount",
            "deviceCount"
        )
        skip = 0
        top = 2000
    } | ConvertTo-Json -Depth 6

    $report = $null
    try {
        $report = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/reports/getAppInstallSummaryReport" `
                -Body $body -OutputType PSObject
        } -OperationName "App install summary report"
    }
    catch {
        # Fallback to alternate report endpoint name (if supported)
        try {
            $report = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/reports/getAppInstallStatusReport" `
                    -Body $body -OutputType PSObject
            } -OperationName "App install status report"
        }
        catch {
            return $map
        }
    }

    $rows = Convert-ReportRows -Report $report
    foreach ($row in $rows) {
        $id = Get-ReportValue -Row $row -Names @("appId", "id")
        if (-not $id) { continue }
        $map[$id] = $row
    }

    return $map
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
            if ($installReportMap.ContainsKey($app.id)) {
                $row = $installReportMap[$app.id]
                $reportInstalled = [int](Get-ReportValue -Row $row -Names @("installedDeviceCount","installedCount"))
                $reportFailed = [int](Get-ReportValue -Row $row -Names @("failedDeviceCount","failedCount"))
                $reportPending = [int](Get-ReportValue -Row $row -Names @("pendingInstallDeviceCount","pendingCount"))
                $reportNotInstalled = [int](Get-ReportValue -Row $row -Names @("notInstalledDeviceCount","notInstalledCount"))
                $reportNotApplicable = [int](Get-ReportValue -Row $row -Names @("notApplicableDeviceCount","notApplicableCount"))

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
