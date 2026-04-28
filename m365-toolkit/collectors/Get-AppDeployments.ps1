# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
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
        $cols = @($Report.columns | ForEach-Object {
            $name = $null
            if ($_ -and $_.PSObject) {
                $name = $_.PSObject.Properties["name"]?.Value
                if (-not $name) { $name = $_.PSObject.Properties["Name"]?.Value }
            }
            if ([string]::IsNullOrWhiteSpace([string]$name)) {
                return "__column_$([guid]::NewGuid().ToString('N'))"
            }
            return [string]$name
        })
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
        $cols = @($Report.schema | ForEach-Object {
            $name = $null
            if ($_ -and $_.PSObject) {
                $name = $_.PSObject.Properties["name"]?.Value
                if (-not $name) { $name = $_.PSObject.Properties["Name"]?.Value }
            }
            if ([string]::IsNullOrWhiteSpace([string]$name)) {
                return "__column_$([guid]::NewGuid().ToString('N'))"
            }
            return [string]$name
        })
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

function Get-EffectiveThresholdValue {
    <#
    .SYNOPSIS
        Returns a config override when present, otherwise the supplied default.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Thresholds,

        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [int]$DefaultValue
    )

    if ($Thresholds.ContainsKey($Name)) {
        return [int]$Thresholds[$Name]
    }

    return $DefaultValue
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

    # Reduced from 30×4s (2 min) to 10×2s (20 sec) to prevent all-day collections
    for ($i = 0; $i -lt 10; $i++) {
        try {
            $statusResp = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $statusUri -OutputType PSObject
            } -OperationName "Export report status ($ReportName)" -MaxRetries 1

            $status = Get-GraphPropertyValue -Object $statusResp -PropertyNames @("status","Status")
            $downloadUrl = Get-GraphPropertyValue -Object $statusResp -PropertyNames @("url","Url","downloadUrl","DownloadUrl")

            if ($status -match "completed" -and $downloadUrl) { break }
            if (Test-GraphAccessError -Value $status) {
                throw "Intune report export job returned access failure status '$status' for report '$ReportName'."
            }
            if ($status -match "failed") { return @() }
        }
        catch {
            if (Test-GraphAccessError -Value $_) {
                throw
            }
            # Keep polling until attempts are exhausted for transient report status issues.
        }

        Start-Sleep -Seconds 2
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

function Get-AppInstallAggregateReportMap {
    $map = @{}
    $reportNames = @(
        "AppInstallStatusAggregate",
        "AppInstallStatus"
    )

    $select = @(
        "ApplicationId","ApplicationName","DisplayName","AppVersion","Publisher","Platform","AppType",
        "InstalledDeviceCount","FailedDeviceCount","PendingInstallDeviceCount","NotInstalledDeviceCount","NotApplicableDeviceCount",
        "InstalledUserCount","FailedUserCount","PendingInstallUserCount","NotInstalledUserCount","NotApplicableUserCount"
    )

    foreach ($reportName in $reportNames) {
        $rows = Invoke-IntuneExportReport -ReportName $reportName -Select $select
        if (-not $rows -or $rows.Count -eq 0) { continue }

        foreach ($row in $rows) {
            $id = Get-ReportValue -Row $row -Names @("ApplicationId","applicationId","AppId","appId","Id","id")
            $normalizedId = Normalize-GraphId -Id $id
            if (-not $normalizedId) { continue }

            try {
                $row | Add-Member -NotePropertyName "__source" -NotePropertyValue "export:$reportName" -Force
            }
            catch {
                # Ignore if the row type can't accept note properties.
            }

            if (-not $map.ContainsKey($normalizedId)) {
                $map[$normalizedId] = $row
            }
        }

        if ($map.Count -gt 0) {
            Write-Host "      Export report map contains $($map.Count) apps (source: $reportName)" -ForegroundColor Gray
            break
        }
    }

    return $map
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
                try {
                    $row | Add-Member -NotePropertyName "__source" -NotePropertyValue "legacy:reportSummary" -Force
                }
                catch {
                    # Ignore if the row type can't accept note properties.
                }
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

    if ($script:AppUserStatusFallbackDisabled) { return $null }

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
                Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject -ErrorAction Stop
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
        $msg = $_.Exception.Message
        if ($msg -match "pipeline has been stopped|PipelineStoppedException|Forbidden|Authorization|ResourceNotFound|NotFound") {
            $script:AppUserStatusFallbackDisabled = $true
        }
        return $null
    }

    return [PSCustomObject]$counts
}

function Get-AppDeviceInstallReportSummary {
    param([Parameter(Mandatory)][string]$AppId)

    if ($script:AppInstallStatusReportDisabled) { return $null }

    if (-not $script:AppInstallStatusReportCache) {
        $script:AppInstallStatusReportCache = @{}
    }

    $normalizedId = Normalize-GraphId -Id $AppId
    if ($normalizedId -and $script:AppInstallStatusReportCache.ContainsKey($normalizedId)) {
        return $script:AppInstallStatusReportCache[$normalizedId]
    }

    $exportFilters = @(
        "(ApplicationId eq '$AppId')",
        "(AppId eq '$AppId')",
        "(applicationId eq '$AppId')",
        "(appId eq '$AppId')"
    )

    $exportSelectColumns = @(
        "DeviceName","UserName","UserPrincipalName","DeviceId","Platform","AppVersion",
        "InstallState","InstallStateDetail","AppInstallState","AppInstallStateDetails",
        "ErrorCode","HexErrorCode","LastModifiedDateTime","ApplicationId"
    )

    foreach ($filter in $exportFilters) {
        $rows = Invoke-IntuneExportReport -ReportName "DeviceInstallStatusByApp" -Select $exportSelectColumns -Filter $filter
        if (-not $rows -or $rows.Count -eq 0) { continue }

        $counts = @{
            installed = 0
            failed = 0
            pending = 0
            notInstalled = 0
            notApplicable = 0
        }
        $failedDevices = @()

        foreach ($row in $rows) {
            $state = Get-ReportValue -Row $row -Names @(
                "AppInstallState","InstallState","appInstallState","installState","InstallStateDetail","installStateDetail"
            )
            if ($state) {
                Add-InstallStateCounts -State $state.ToString() -Counts $counts
            }

            $stateText = if ($state) { $state.ToString() } else { "" }
            if ($stateText -match "fail|error") {
                $failedDevices += [PSCustomObject]@{
                    deviceName = Get-ReportValue -Row $row -Names @("DeviceName","deviceName")
                    userName = Get-ReportValue -Row $row -Names @("UserName","userName","UserPrincipalName","userPrincipalName")
                    deviceId = Get-ReportValue -Row $row -Names @("DeviceId","deviceId")
                    osVersion = $null
                    installState = $stateText
                    installStateDetail = Get-ReportValue -Row $row -Names @("InstallStateDetail","installStateDetail","AppInstallStateDetails","appInstallStateDetails")
                    errorCode = Get-ReportValue -Row $row -Names @("HexErrorCode","hexErrorCode","ErrorCode","errorCode")
                    lastSyncDateTime = Format-IsoDate -DateValue (Get-ReportValue -Row $row -Names @("LastModifiedDateTime","lastModifiedDateTime"))
                }
            }
        }

        $result = [PSCustomObject]@{
            installed = $counts.installed
            failed = $counts.failed
            pending = $counts.pending
            notInstalled = $counts.notInstalled
            notApplicable = $counts.notApplicable
            failedDevices = $failedDevices
            source = "export:DeviceInstallStatusByApp"
        }

        if ($normalizedId) { $script:AppInstallStatusReportCache[$normalizedId] = $result }
        return $result
    }

    $filters = @(
        "(ApplicationId eq '$AppId')",
        "(AppId eq '$AppId')",
        "(applicationId eq '$AppId')",
        "(appId eq '$AppId')"
    )

    $selectColumns = @(
        "DeviceName","UserPrincipalName","Platform","AppVersion","InstallState","InstallStateDetail",
        "AssignmentFilterIdsExist","LastModifiedDateTime","DeviceId","ErrorCode","UserName","UserId",
        "ApplicationId","AssignmentFilterIdsList","AppInstallState","AppInstallStateDetails","HexErrorCode"
    )

    $pageSize = 50
    $maxRows = 5000

    $endpointCandidates = @()
    if ($script:AppInstallStatusReportEndpoint) {
        $endpointCandidates += $script:AppInstallStatusReportEndpoint
    }
    else {
        $endpointCandidates += @(
            "https://graph.microsoft.com/v1.0/deviceManagement/reports/microsoft.graph.retrieveDeviceAppInstallationStatusReport",
            "https://graph.microsoft.com/v1.0/deviceManagement/reports/retrieveDeviceAppInstallationStatusReport",
            "https://graph.microsoft.com/beta/deviceManagement/reports/getDeviceInstallStatusReport"
        )
    }

    $authFailure = $false
    foreach ($endpoint in $endpointCandidates) {
        $anySuccessfulCall = $false
        $endpointMissing = $false

        foreach ($filter in $filters) {
            $counts = @{
                installed = 0
                failed = 0
                pending = 0
                notInstalled = 0
                notApplicable = 0
            }

            $skip = 0
            $processedRows = 0

            while ($processedRows -lt $maxRows) {
                $body = @{
                    select = $selectColumns
                    skip = $skip
                    top = $pageSize
                    filter = $filter
                    orderBy = @()
                } | ConvertTo-Json -Depth 8

                $report = $null
                try {
                    $report = Invoke-GraphWithRetry -ScriptBlock {
                        Invoke-MgGraphRequest -Method POST `
                            -Uri $endpoint `
                            -Body $body -ContentType "application/json" -OutputType PSObject
                    } -OperationName "Device install status report" -MaxRetries 2
                }
                catch {
                    $msg = $_.Exception.Message
                    if ($msg -match "Forbidden|Authorization|permission|Insufficient privileges") {
                        $authFailure = $true
                        $endpointMissing = $true
                        break
                    }
                    if ($msg -match "Resource not found|ResourceNotFound|BadRequest|NotFound") {
                        $endpointMissing = $true
                        break
                    }
                    break
                }

                $anySuccessfulCall = $true
                if (-not $report) { break }

                $rows = Convert-ReportRows -Report $report
                if (-not $rows -or $rows.Count -eq 0) { break }

                foreach ($row in $rows) {
                    $state = Get-ReportValue -Row $row -Names @(
                        "AppInstallState","InstallState","appInstallState","installState","InstallStateDetail","installStateDetail"
                    )
                    if (-not $state) { continue }
                    Add-InstallStateCounts -State $state.ToString() -Counts $counts
                }

                $processedRows += $rows.Count
                $skip += $pageSize
                if ($rows.Count -lt $pageSize) { break }
            }

            if ($endpointMissing) { break }

            $total = $counts.installed + $counts.failed + $counts.pending + $counts.notInstalled + $counts.notApplicable
            if ($total -gt 0) {
                $result = [PSCustomObject]@{
                    installed = $counts.installed
                    failed = $counts.failed
                    pending = $counts.pending
                    notInstalled = $counts.notInstalled
                    notApplicable = $counts.notApplicable
                    failedDevices = @()
                    source = "legacy:deviceInstallStatusReport"
                }
                if ($normalizedId) { $script:AppInstallStatusReportCache[$normalizedId] = $result }
                $script:AppInstallStatusReportEndpoint = $endpoint
                return $result
            }
        }

        if ($endpointMissing) { continue }

        if ($anySuccessfulCall) {
            # Pin the working endpoint for subsequent apps in this run.
            $script:AppInstallStatusReportEndpoint = $endpoint
            break
        }
    }

    if ($authFailure) { $script:AppInstallStatusReportDisabled = $true }

    if ($normalizedId) { $script:AppInstallStatusReportCache[$normalizedId] = $null }
    return $null
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
            appsWithoutStatus = 0
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

    $deepCollection = $false
    if ($Config.collection -is [hashtable]) {
        $deepCollection = ($Config.collection.deepCollection -eq $true -or $Config.collection.appDeploymentDeepScan -eq $true)
    }

    $processedApps = @()
    $aggregateInstallReportMap = Get-AppInstallAggregateReportMap
    $installReportMap = if ($aggregateInstallReportMap.Count -lt $allApps.Count) { Get-AppInstallReportMap } else { @{} }

    $maxAssignmentFetches = if ($deepCollection) { [int]::MaxValue } else { $allApps.Count }
    $maxPerAppInstallSummaryFallbacks = if ($deepCollection) { [int]::MaxValue } else { 25 }
    $maxDeviceStatusApps = if ($deepCollection) { [int]::MaxValue } else { 10 }
    $maxDeviceStatusesPerApp = if ($deepCollection) { 1000 } else { 200 }
    if ($Config.thresholds -is [hashtable]) {
        $maxAssignmentFetches = Get-EffectiveThresholdValue -Thresholds $Config.thresholds -Name 'maxAppAssignmentFetches' -DefaultValue $maxAssignmentFetches
        $maxPerAppInstallSummaryFallbacks = Get-EffectiveThresholdValue -Thresholds $Config.thresholds -Name 'maxAppInstallSummaryFallbacks' -DefaultValue $maxPerAppInstallSummaryFallbacks
        $maxDeviceStatusApps = Get-EffectiveThresholdValue -Thresholds $Config.thresholds -Name 'maxAppDeviceStatusApps' -DefaultValue $maxDeviceStatusApps
        $maxDeviceStatusesPerApp = Get-EffectiveThresholdValue -Thresholds $Config.thresholds -Name 'maxAppDeviceStatusesPerApp' -DefaultValue $maxDeviceStatusesPerApp
    }

    $assignmentFetchCount = 0
    $installSummaryFallbackCount = 0
    $deviceStatusAppCount = 0
    $perAppReportFallbackCount = 0
    $maxPerAppReportFallbacks = if ($deepCollection) { 10 } else { 3 }
    if ($Config.thresholds -is [hashtable]) {
        $maxPerAppReportFallbacks = Get-EffectiveThresholdValue -Thresholds $Config.thresholds -Name 'maxAppReportFallbacks' -DefaultValue $maxPerAppReportFallbacks
    }
    $assignmentBatchMap = @{}

    if (-not $deepCollection -and $aggregateInstallReportMap.Count -eq 0 -and $installReportMap.Count -eq 0) {
        Write-Host "      Aggregate app status reports unavailable. Expanding per-app fallbacks for this run..." -ForegroundColor Yellow
        $maxPerAppInstallSummaryFallbacks = [Math]::Max($maxPerAppInstallSummaryFallbacks, $allApps.Count)
        $maxPerAppReportFallbacks = [Math]::Max($maxPerAppReportFallbacks, $allApps.Count)
        $maxDeviceStatusApps = [Math]::Max($maxDeviceStatusApps, [Math]::Min($allApps.Count, 50))
    }

    if ($maxAssignmentFetches -gt 0) {
        $assignmentTargets = @($allApps | Select-Object -First $maxAssignmentFetches)
        $assignmentRequests = @()
        $requestIndex = 0
        foreach ($assignmentApp in $assignmentTargets) {
            if (-not $assignmentApp.id) { continue }
            $requestIndex++
            $requestId = "appAssignments$requestIndex"
            $assignmentBatchMap[[string]$requestId] = [string]$assignmentApp.id
            $assignmentRequests += [PSCustomObject]@{
                id  = $requestId
                uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($assignmentApp.id)/assignments"
            }
        }

        if ($assignmentRequests.Count -gt 0) {
            Write-Host "      Fetching app assignments in Graph batches ($($assignmentRequests.Count) apps)..." -ForegroundColor Gray
            $assignmentBatchResults = Invoke-GraphBatchGet -Requests $assignmentRequests -OperationName "App assignments batch"
            $assignmentFetchCount = $assignmentRequests.Count
        }
        else {
            $assignmentBatchResults = @{}
        }
    }
    else {
        $assignmentBatchResults = @{}
    }

    foreach ($app in $allApps) {
        try {
            $appType = Get-AppType -ODataType $app.'@odata.type'
            $platform = Get-AppPlatform -ODataType $app.'@odata.type'
            $version = Get-AppVersion -App $app

            # Get assignments
            $assignments = @()
            $assignmentsFetched = $false
            $assignmentRequestId = $null
            foreach ($entry in $assignmentBatchMap.GetEnumerator()) {
                if ($entry.Value -eq [string]$app.id) {
                    $assignmentRequestId = $entry.Key
                    break
                }
            }

            if ($assignmentRequestId -and $assignmentBatchResults.ContainsKey($assignmentRequestId)) {
                $assignmentResult = $assignmentBatchResults[$assignmentRequestId]
                if ($assignmentResult.status -ge 200 -and $assignmentResult.status -lt 300) {
                    $assignmentsFetched = $true
                    foreach ($assignment in @($assignmentResult.body.value)) {
                        $intent = Get-InstallIntent -Intent $assignment.intent
                        $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -ExcludeSuffix " (Excluded)"
                        $assignments += @{
                            intent     = $intent
                            targetType = $target.type
                            targetName = $target.name
                            groupId    = $target.groupId
                        }
                    }
                }
            }
            elseif ($deepCollection) {
                try {
                    $assignmentResponse = Invoke-MgGraphRequest -Method GET `
                        -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($app.id)/assignments" `
                        -OutputType PSObject
                    $assignmentsFetched = $true

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
            }

            # Get device install status
            $installedCount = 0
            $failedCount = 0
            $pendingCount = 0
            $notApplicableCount = 0
            $notInstalledCount = 0
            $deviceStatuses = @()
            $statusAvailable = $false
            $statusSource = $null
            $statusUnavailableReason = $null
            $usedInstallSummary = $false

            # Prefer report summary maps when available because they cover more app types than deviceStatuses.
            $normalizedAppId = Normalize-GraphId -Id $app.id
            $reportRow = $null
            if ($normalizedAppId) {
                if ($aggregateInstallReportMap.ContainsKey($normalizedAppId)) {
                    $reportRow = $aggregateInstallReportMap[$normalizedAppId]
                }
                elseif ($installReportMap.ContainsKey($normalizedAppId)) {
                    $reportRow = $installReportMap[$normalizedAppId]
                }
            }

            if ($reportRow) {
                $row = $reportRow
                $reportInstalled = Get-CountValue -Object $row -Names @("installedDeviceCount","installedCount","installedUserCount")
                $reportFailed = Get-CountValue -Object $row -Names @("failedDeviceCount","failedCount","failedUserCount")
                $reportPending = Get-CountValue -Object $row -Names @("pendingInstallDeviceCount","pendingCount","pendingInstallUserCount","pendingUserCount")
                $reportNotInstalled = Get-CountValue -Object $row -Names @("notInstalledDeviceCount","notInstalledCount","notInstalledUserCount")
                $reportNotApplicable = Get-CountValue -Object $row -Names @("notApplicableDeviceCount","notApplicableCount","notApplicableUserCount")

                $installedCount = $reportInstalled
                $failedCount = $reportFailed
                $pendingCount = $reportPending
                $notInstalledCount = $reportNotInstalled
                $notApplicableCount = $reportNotApplicable
                $usedInstallSummary = $true
                $statusAvailable = $true
                $statusSource = Get-ReportValue -Row $row -Names @("__source")
                if (-not $statusSource) { $statusSource = "reportSummary" }
            }

            # Fallback to aggregate install summary endpoint when report data unavailable
            if (-not $statusAvailable -and $installSummaryFallbackCount -lt $maxPerAppInstallSummaryFallbacks) {
                $installSummaryFallbackCount++
                $installSummary = Get-AppInstallSummary -AppId $app.id
                if ($installSummary) {
                    $installedCount = $installSummary.installed
                    $failedCount = $installSummary.failed
                    $pendingCount = $installSummary.pending
                    $notInstalledCount = $installSummary.notInstalled
                    $notApplicableCount = $installSummary.notApplicable
                    $usedInstallSummary = $true
                    $statusAvailable = $true
                    $statusSource = "installSummary"
                }
            }

            $deviceStatusRetrieved = $false
            $shouldFetchDeviceStatuses = $deepCollection -or (
                $deviceStatusAppCount -lt $maxDeviceStatusApps -and (
                    (-not $statusAvailable) -or
                    ($failedCount -gt 0 -and $deviceStatuses.Count -eq 0)
                )
            )

            if ($shouldFetchDeviceStatuses) {
                $deviceStatusAppCount++
                try {
                # deviceStatuses endpoint only works for managed app types (Win32, LOB)
                # Store apps and web links don't have device-level status
                # Use $top=100 as Graph API max for paginated endpoints
                $deviceStatusUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($app.id)/deviceStatuses?`$top=100"
                $allStatuses = @()
                $useStatusCounts = -not $usedInstallSummary

                do {
                    $deviceStatus = Invoke-GraphWithRetry -ScriptBlock {
                        Invoke-MgGraphRequest -Method GET -Uri $deviceStatusUri -OutputType PSObject -ErrorAction Stop
                    } -OperationName "App device status retrieval"
                    if ($deviceStatus.value) {
                        $allStatuses += $deviceStatus.value
                    }
                    $deviceStatusUri = $deviceStatus.'@odata.nextLink'
                } while ($deviceStatusUri -and $allStatuses.Count -lt $maxDeviceStatusesPerApp)
                $deviceStatusRetrieved = $true

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
            }

            if ($deviceStatusRetrieved -and -not $statusAvailable) {
                $statusAvailable = $true
                $statusSource = "deviceStatuses"
                $usedInstallSummary = $true
            }

            # Primary fallback: device install status report endpoint.
            # PERFORMANCE FIX: Limit to maxPerAppReportFallbacks to prevent hours of collection time
            if (-not $statusAvailable -and $perAppReportFallbackCount -lt $maxPerAppReportFallbacks) {
                $perAppReportFallbackCount++
                $reportSummary = Get-AppDeviceInstallReportSummary -AppId $app.id
                if ($reportSummary) {
                    $installedCount = $reportSummary.installed
                    $failedCount = $reportSummary.failed
                    $pendingCount = $reportSummary.pending
                    $notInstalledCount = $reportSummary.notInstalled
                    $notApplicableCount = $reportSummary.notApplicable
                    if ($reportSummary.failedDevices -and $reportSummary.failedDevices.Count -gt 0 -and $deviceStatuses.Count -eq 0) {
                        $deviceStatuses = @($reportSummary.failedDevices)
                    }
                    $statusAvailable = $true
                    $statusSource = if ($reportSummary.source) { $reportSummary.source } else { "deviceInstallStatusReport" }
                }
            }

            # Secondary fallback: user-targeted status endpoint (legacy/best-effort).
            # PERFORMANCE FIX: Also limit user status fallbacks
            if (-not $statusAvailable -and $perAppReportFallbackCount -lt $maxPerAppReportFallbacks) {
                $perAppReportFallbackCount++
                $userSummary = Get-AppUserStatusSummary -AppId $app.id
                if ($userSummary) {
                    $installedCount = $userSummary.installed
                    $failedCount = $userSummary.failed
                    $pendingCount = $userSummary.pending
                    $notInstalledCount = $userSummary.notInstalled
                    $notApplicableCount = $userSummary.notApplicable
                    $statusAvailable = $true
                    $statusSource = "userStatuses"
                }
            }

            if (-not $statusAvailable) {
                if ($assignments.Count -eq 0 -and $assignmentsFetched) {
                    $statusUnavailableReason = "No assignments found for this app."
                }
                elseif (-not $assignmentsFetched -and $assignmentFetchCount -ge $maxAssignmentFetches -and $maxAssignmentFetches -lt $allApps.Count) {
                    $statusUnavailableReason = "Assignment and device-status detail limit reached. Run deepCollection for full per-app detail."
                }
                elseif (-not $assignmentsFetched) {
                    $statusUnavailableReason = "App assignments could not be retrieved for this app."
                }
                elseif ($perAppReportFallbackCount -ge $maxPerAppReportFallbacks) {
                    $statusUnavailableReason = "Status fallback limit reached ($maxPerAppReportFallbacks apps). Aggregate report data unavailable for this app."
                }
                elseif ($appType -in @("Store App", "Store for Business", "Web Link", "Web App")) {
                    $statusUnavailableReason = "Intune did not return deployment status for this app type in the available report APIs."
                }
                else {
                    $statusUnavailableReason = "Intune did not return deployment status for this app from the available report endpoints."
                }
                $statusSource = "unavailable"
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
                statusAvailable      = $statusAvailable
                statusSource         = $statusSource
                statusUnavailableReason = $statusUnavailableReason
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
            if (-not $statusAvailable) { $appData.summary.appsWithoutStatus++ }
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

