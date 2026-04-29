# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Windows Update for Business configuration and update status.

.DESCRIPTION
    Retrieves Windows Update rings, feature update policies, and device
    update compliance status. Enables visibility into patch management
    posture across the device fleet.

    Graph API endpoints:
    - GET /deviceManagement/deviceConfigurations (filter for update rings)
    - GET /deviceManagement/windowsFeatureUpdateProfiles
    - GET /deviceManagement/windowsQualityUpdateProfiles

    Required scopes:
    - DeviceManagementConfiguration.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes windows-update-status.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-WindowsUpdateStatus.ps1 -Config $config -OutputPath ".\data\windows-update-status.json"
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

function Add-DeviceUpdateStates {
    <#
    .SYNOPSIS
        Aggregates device update states into a status map.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$StateMap,

        [Parameter(Mandatory)]
        [array]$States,

        [Parameter(Mandatory)]
        [string[]]$StatusPropertyNames
    )

    foreach ($state in $States) {
        $deviceId = Get-GraphPropertyValue -Object $state -PropertyNames @("deviceId", "managedDeviceId", "id")
        if ([string]::IsNullOrWhiteSpace($deviceId)) {
            continue
        }

        if (-not $StateMap.ContainsKey($deviceId)) {
            $StateMap[$deviceId] = @{ pending = 0; failed = 0; succeeded = 0; lastEvent = $null }
        }

        $statusValue = Get-GraphPropertyValue -Object $state -PropertyNames $StatusPropertyNames
        if ($null -eq $statusValue) { continue }
        $status = $statusValue.ToString().ToLowerInvariant()

        switch ($status) {
            "failed" { $StateMap[$deviceId].failed++ }
            "error" { $StateMap[$deviceId].failed++ }
            "pending" { $StateMap[$deviceId].pending++ }
            "downloading" { $StateMap[$deviceId].pending++ }
            "installing" { $StateMap[$deviceId].pending++ }
            "inprogress" { $StateMap[$deviceId].pending++ }
            "rebootrequired" { $StateMap[$deviceId].pending++ }
            "rebootpending" { $StateMap[$deviceId].pending++ }
            "restartrequired" { $StateMap[$deviceId].pending++ }
            "offeringreceived" { $StateMap[$deviceId].succeeded++ }
            "installed" { $StateMap[$deviceId].succeeded++ }
            "succeeded" { $StateMap[$deviceId].succeeded++ }
            "complete" { $StateMap[$deviceId].succeeded++ }
            "uptodate" { $StateMap[$deviceId].succeeded++ }
            default { }
        }

        $eventTime = Get-UpdateStateTimestamp -State $state
        if ($eventTime) {
            $existingTime = $StateMap[$deviceId].lastEvent
            if (-not $existingTime -or $eventTime -gt $existingTime) {
                $StateMap[$deviceId].lastEvent = $eventTime
            }
        }
    }
}

function Get-UpdateStateTimestamp {
    <#
    .SYNOPSIS
        Attempts to extract a useful timestamp from a device update state entry.
    #>
    param(
        [Parameter(Mandatory)]
        $State
    )

    $timestamp = Get-GraphPropertyValue -Object $State -PropertyNames @(
        "lastStatusChangeDateTime",
        "lastUpdatedDateTime",
        "lastModifiedDateTime",
        "lastEventDateTime",
        "reportedDateTime",
        "lastContactedDateTime",
        "lastCheckInDateTime",
        "lastSyncDateTime",
        "statusChangeDateTime"
    )

    if ($null -eq $timestamp -or $timestamp -eq "") {
        return $null
    }

    try {
        return [DateTime]$timestamp
    }
    catch {
        return $null
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
        $cols = @($Report.columns | ForEach-Object {
            $name = Get-GraphPropertyValue -Object $_ -PropertyNames @("name", "Name")
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

    if ($Report.value -and $Report.schema) {
        $cols = @($Report.schema | ForEach-Object {
            $name = Get-GraphPropertyValue -Object $_ -PropertyNames @("name", "Name")
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

    if ($Report.value -and $Report.value[0] -and $Report.value[0].PSObject) {
        return @($Report.value)
    }

    return @()
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

    foreach ($endpoint in @(
        "https://graph.microsoft.com/v1.0/deviceManagement/reports/exportJobs",
        "https://graph.microsoft.com/beta/deviceManagement/reports/exportJobs"
    )) {
        try {
            $job = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST -Uri $endpoint -Body $bodyJson -ContentType "application/json" -OutputType PSObject
            } -OperationName "Export report job ($ReportName)" -MaxRetries 2
        }
        catch {
            if (Test-GraphAccessError -Value $_) { throw }
            continue
        }

        if ($job) {
            $baseUri = $endpoint
            break
        }
    }

    if (-not $job -or -not $baseUri) { return @() }

    $jobId = Get-GraphPropertyValue -Object $job -PropertyNames @("id", "Id")
    if (-not $jobId) { return @() }

    $statusUri = "$baseUri/$jobId"
    $downloadUrl = $null

    for ($i = 0; $i -lt 10; $i++) {
        try {
            $statusResp = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $statusUri -OutputType PSObject
            } -OperationName "Export report status ($ReportName)" -MaxRetries 1

            $status = Get-GraphPropertyValue -Object $statusResp -PropertyNames @("status", "Status")
            $downloadUrl = Get-GraphPropertyValue -Object $statusResp -PropertyNames @("url", "Url", "downloadUrl", "DownloadUrl")

            if ($status -match "completed" -and $downloadUrl) { break }
            if (Test-GraphAccessError -Value $status) {
                throw "Intune report export job returned access failure status '$status' for report '$ReportName'."
            }
            if ($status -match "failed") { return @() }
        }
        catch {
            if (Test-GraphAccessError -Value $_) { throw }
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

            return Convert-ReportRows -Report $parsed
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

function Get-FeatureUpdateStatusSummaryMap {
    <#
    .SYNOPSIS
        Returns per-policy feature update summary counts keyed by policy id.
    #>
    $map = @{}
    $rows = Invoke-IntuneExportReport -ReportName "FeatureUpdatePolicyStatusSummary" -Select @(
        "PolicyId",
        "PolicyName",
        "FeatureUpdateVersion",
        "CountDevicesSuccessStatus",
        "CountDevicesInProgressStatus",
        "CountDevicesErrorStatus"
    )

    foreach ($row in @($rows)) {
        $policyId = Get-GraphPropertyValue -Object $row -PropertyNames @("PolicyId", "policyId")
        if ([string]::IsNullOrWhiteSpace([string]$policyId)) { continue }

        $succeeded = Convert-ToIntSafe (Get-GraphPropertyValue -Object $row -PropertyNames @("CountDevicesSuccessStatus", "countDevicesSuccessStatus"))
        $pending = Convert-ToIntSafe (Get-GraphPropertyValue -Object $row -PropertyNames @("CountDevicesInProgressStatus", "countDevicesInProgressStatus"))
        $failed = Convert-ToIntSafe (Get-GraphPropertyValue -Object $row -PropertyNames @("CountDevicesErrorStatus", "countDevicesErrorStatus"))
        $total = $succeeded + $pending + $failed

        $map[[string]$policyId] = [PSCustomObject]@{
            total = $total
            succeeded = $succeeded
            pending = $pending
            failed = $failed
            notApplicable = 0
            source = "FeatureUpdatePolicyStatusSummary"
        }
    }

    return $map
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$totalItems = 0

try {
    Write-Host "    Collecting Windows Update configuration..." -ForegroundColor Gray

    $updateData = @{
        updateRings = @()
        featureUpdates = @()
        qualityUpdates = @()
        driverUpdates = @()
        deviceCompliance = @()
        summary = @{
            totalRings = 0
            totalFeaturePolicies = 0
            totalQualityPolicies = 0
            totalDriverUpdates = 0
            totalManagedDevices = 0
            devicesUpToDate = 0
            devicesPendingUpdate = 0
            devicesWithErrors = 0
            complianceRate = 0
            expeditedUpdatesActive = 0
            securityUpdates = 0
            pausedRings = 0
            driversNeedingReview = 0
            devicesPatchStale = 0
            devicesPatchCurrent = 0
            patchAgeThresholdDays = 30
        }
    }

    $groupNameCache = @{}
    $deviceUpdateStateMap = @{}
    $deviceRingAssignments = @{}
    $ringStatusErrorLogged = $false
    $deepCollection = ($Config.collection -is [hashtable] -and $Config.collection.deepCollection -eq $true)

    # ========================================
    # Collect Windows Update Rings
    # ========================================
    try {
        $updateRings = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/deviceConfigurations?`$filter=isof('microsoft.graph.windowsUpdateForBusinessConfiguration')" `
                -OutputType PSObject
        } -OperationName "Windows Update rings retrieval"

        foreach ($ring in $updateRings.value) {
            # Get status overview
            $successCount = 0
            $errorCount = 0
            $pendingCount = 0
            $ringName = if ($ring.displayName) { $ring.displayName } else { $ring.id }
            $useStatusFallback = $false

            try {
                $statusOverview = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/deviceConfigurations/$($ring.id)/deviceStatusOverview" `
                    -OutputType PSObject

                # Handle null values from Graph API
                $successCount = if ($null -ne $statusOverview.compliantDeviceCount) { $statusOverview.compliantDeviceCount } else { 0 }
                $errorCount = if ($null -ne $statusOverview.errorDeviceCount) { $statusOverview.errorDeviceCount } else { 0 }
                $pendingCount = if ($null -ne $statusOverview.pendingDeviceCount) { $statusOverview.pendingDeviceCount } else { 0 }
            }
            catch {
                Write-Host "      Warning: Could not get status for ring $ringName - $($_.Exception.Message)" -ForegroundColor Yellow
            }

            if (($successCount + $errorCount + $pendingCount) -eq 0) {
                $useStatusFallback = $true
            }

            # Get assignments for this ring
            $assignedGroups = @()
            try {
                $assignmentResponse = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/deviceConfigurations/$($ring.id)/assignments" `
                    -OutputType PSObject

                foreach ($assignment in $assignmentResponse.value) {
                    $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -GroupPrefix "Group: "
                    $assignedGroups += $target.name
                }
            }
            catch { }

            # DeviceStatuses can be very large. Use it only when overview counts
            # are unavailable, or when deepCollection is explicitly enabled.
            if ($useStatusFallback -or $deepCollection) {
                try {
                    $deviceStatuses = Get-GraphAllPages `
                        -Uri "https://graph.microsoft.com/beta/deviceManagement/deviceConfigurations/$($ring.id)/deviceStatuses" `
                        -OperationName "Update ring device status retrieval"

                    foreach ($status in $deviceStatuses) {
                        if ($useStatusFallback) {
                            $state = if ($status.status) { $status.status.ToString().ToLowerInvariant() } else { "" }
                            switch ($state) {
                                "compliant" { $successCount++ }
                                "success" { $successCount++ }
                                "noncompliant" { $errorCount++ }
                                "conflict" { $errorCount++ }
                                "error" { $errorCount++ }
                                "notapplicable" { $pendingCount++ }
                                "unknown" { $pendingCount++ }
                                default { }
                            }
                        }

                        if ($deepCollection) {
                            $deviceId = Get-GraphPropertyValue -Object $status -PropertyNames @("deviceId", "managedDeviceId", "id")
                            if ([string]::IsNullOrWhiteSpace($deviceId)) { continue }
                            if (-not $deviceRingAssignments.ContainsKey($deviceId)) {
                                $deviceRingAssignments[$deviceId] = @()
                            }
                            if ($deviceRingAssignments[$deviceId] -notcontains $ringName) {
                                $deviceRingAssignments[$deviceId] += $ringName
                            }
                        }
                    }
                }
                catch {
                    if (-not $ringStatusErrorLogged) {
                        $errors += "Update ring device statuses: $($_.Exception.Message)"
                        $ringStatusErrorLogged = $true
                    }
                }
            }

            # Track paused rings
            if ($ring.qualityUpdatesPaused -or $ring.featureUpdatesPaused) {
                $updateData.summary.pausedRings++
            }

            $updateData.updateRings += [PSCustomObject]@{
                id                          = $ring.id
                displayName                 = $ring.displayName
                description                 = $ring.description
                createdDateTime             = Format-IsoDate -DateValue $ring.createdDateTime
                lastModifiedDateTime        = Format-IsoDate -DateValue $ring.lastModifiedDateTime
                # Deferral settings
                qualityUpdatesDeferralDays  = $ring.qualityUpdatesDeferralPeriodInDays
                featureUpdatesDeferralDays  = $ring.featureUpdatesDeferralPeriodInDays
                qualityUpdatesPaused        = $ring.qualityUpdatesPaused
                featureUpdatesPaused        = $ring.featureUpdatesPaused
                # Deadline settings
                deadlineForQualityUpdates   = $ring.deadlineForQualityUpdatesInDays
                deadlineForFeatureUpdates   = $ring.deadlineForFeatureUpdatesInDays
                deadlineGracePeriod         = $ring.deadlineGracePeriodInDays
                # Behavior settings
                automaticUpdateMode         = $ring.automaticUpdateMode
                microsoftUpdateServiceAllowed = $ring.microsoftUpdateServiceAllowed
                driversExcluded             = $ring.driversExcluded
                allowWindows11Upgrade       = $ring.allowWindows11Upgrade
                # Assignments
                assignedGroups              = $assignedGroups
                # Status
                successDevices              = $successCount
                errorDevices                = $errorCount
                pendingDevices              = $pendingCount
                totalDevices                = $successCount + $errorCount + $pendingCount
            }

            $updateData.summary.devicesUpToDate += $successCount
            $updateData.summary.devicesPendingUpdate += $pendingCount
            $updateData.summary.devicesWithErrors += $errorCount
            $totalItems++
        }

        $updateData.summary.totalRings = $updateData.updateRings.Count
        $ringTotalDevices = ($updateData.updateRings | Measure-Object -Property totalDevices -Sum).Sum
        if ($ringTotalDevices) {
            $updateData.summary.totalManagedDevices = $ringTotalDevices
        }
        Write-Host "      Retrieved $($updateData.updateRings.Count) update rings" -ForegroundColor Gray
    }
    catch {
        $errors += "Update rings: $($_.Exception.Message)"
    }

    # ========================================
    # Collect Feature Update Policies
    # ========================================
    try {
        $featureStatusSummaryMap = @{}
        try {
            $featureStatusSummaryMap = Get-FeatureUpdateStatusSummaryMap
            if ($featureStatusSummaryMap.Count -gt 0) {
                Write-Host "      Retrieved feature update status summary for $($featureStatusSummaryMap.Count) policies" -ForegroundColor Gray
            }
        }
        catch {
            if (Test-GraphAccessError -Value $_) {
                $errors += "Feature update status summary: $($_.Exception.Message)"
            }
        }

        $featureUpdates = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsFeatureUpdateProfiles" `
                -OutputType PSObject
        } -OperationName "Feature update profiles retrieval"

        foreach ($policy in $featureUpdates.value) {
            $deploymentState = if ($featureStatusSummaryMap.ContainsKey([string]$policy.id)) {
                $featureStatusSummaryMap[[string]$policy.id]
            }
            else {
                [PSCustomObject]@{
                    total = 0
                    succeeded = 0
                    pending = 0
                    failed = 0
                    notApplicable = 0
                    source = "unavailable"
                }
            }

            # Get assignments
            $assignedGroups = @()
            try {
                $assignmentResponse = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsFeatureUpdateProfiles/$($policy.id)/assignments" `
                    -OutputType PSObject

                foreach ($assignment in $assignmentResponse.value) {
                    $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -GroupPrefix "Group: "
                    $assignedGroups += $target.name
                }
            }
            catch { }

            $updateData.featureUpdates += [PSCustomObject]@{
                id                   = $policy.id
                displayName          = $policy.displayName
                description          = $policy.description
                featureUpdateVersion = $policy.featureUpdateVersion
                createdDateTime      = Format-IsoDate -DateValue $policy.createdDateTime
                lastModifiedDateTime = Format-IsoDate -DateValue $policy.lastModifiedDateTime
                rolloutSettings      = $policy.rolloutSettings
                endOfSupportDate     = Format-IsoDate -DateValue $policy.endOfSupportDate
                assignedGroups       = $assignedGroups
                deploymentState      = $deploymentState
                statusAvailable      = ($deploymentState.total -gt 0)
                statusSource         = $deploymentState.source
                statusUnavailableReason = if ($deploymentState.total -gt 0) {
                    $null
                }
                else {
                    "Feature update deployment summary was not returned by the Intune reports API for this policy."
                }
            }

            $totalItems++
        }

        $updateData.summary.totalFeaturePolicies = $updateData.featureUpdates.Count
        Write-Host "      Retrieved $($updateData.featureUpdates.Count) feature update policies" -ForegroundColor Gray
    }
    catch {
        $errors += "Feature updates: $($_.Exception.Message)"
    }

    # ========================================
    # Collect Quality Update Policies (Expedited)
    # ========================================
    try {
        $qualityUpdates = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsQualityUpdateProfiles" `
                -OutputType PSObject
        } -OperationName "Quality update profiles retrieval"

        foreach ($policy in $qualityUpdates.value) {
            # Determine classification (Security, Critical, etc.) from name/description
            $classification = "Update"
            $isExpedited = $false
            $displayName = $policy.displayName
            $description = $policy.description

            if ($displayName -match "Security|CVE" -or $description -match "Security|CVE") {
                $classification = "Security"
                $updateData.summary.securityUpdates++
            }
            elseif ($displayName -match "Critical" -or $description -match "Critical") {
                $classification = "Critical"
            }

            if ($policy.expeditedUpdateSettings -or $displayName -match "Expedite") {
                $isExpedited = $true
                $updateData.summary.expeditedUpdatesActive++
            }

            # Get deployment status for this policy
            $deployedDevices = 0
            $pendingDevices = 0
            $failedDevices = 0
            $progressPercent = 0

            try {
                $assignments = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsQualityUpdateProfiles/$($policy.id)/assignments" `
                    -OutputType PSObject

                # Note: deviceUpdateStates endpoint may not be available for all quality update profiles
                # This is expected behavior for non-expedited updates - status tracked differently
                if ($assignments.value -and $assignments.value.Count -gt 0) {
                    try {
                        $stateSummary = Invoke-MgGraphRequest -Method GET `
                            -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsQualityUpdateProfiles/$($policy.id)/deviceUpdateStates" `
                            -OutputType PSObject

                        $states = $stateSummary.value
                        if ($states -and $states.Count -gt 0) {
                            # Handle multiple possible property names for status
                            $deployedDevices = ($states | Where-Object {
                                $status = Get-GraphPropertyValue -Object $_ -PropertyNames @("qualityUpdateState", "status", "state")
                                $status -in @("installed", "succeeded", "compliant")
                            }).Count
                            $pendingDevices = ($states | Where-Object {
                                $status = Get-GraphPropertyValue -Object $_ -PropertyNames @("qualityUpdateState", "status", "state")
                                $status -in @("pending", "downloading", "installing", "inProgress")
                            }).Count
                            $failedDevices = ($states | Where-Object {
                                $status = Get-GraphPropertyValue -Object $_ -PropertyNames @("qualityUpdateState", "status", "state")
                                $status -in @("failed", "error")
                            }).Count

                            Add-DeviceUpdateStates -StateMap $deviceUpdateStateMap -States $states -StatusPropertyNames @("qualityUpdateState", "status", "state")

                            $totalTarget = $deployedDevices + $pendingDevices + $failedDevices
                            if ($totalTarget -gt 0) {
                                $progressPercent = [Math]::Round(($deployedDevices / $totalTarget) * 100, 0)
                            }
                        }
                    }
                    catch {
                        # deviceUpdateStates endpoint not available for this policy type - this is expected
                    }
                }
            }
            catch {
                Write-Host "      Warning: Could not get assignments for quality update $($policy.displayName)" -ForegroundColor Yellow
            }

            # Get assignments for quality update
            $assignedGroups = @()
            try {
                $qAssignments = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsQualityUpdateProfiles/$($policy.id)/assignments" `
                    -OutputType PSObject

                foreach ($assignment in $qAssignments.value) {
                    $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -GroupPrefix "Group: "
                    $label = if ($target.type -eq "AllDevices") { "All Managed Devices" } else { $target.name }
                    $assignedGroups += $label
                }
            }
            catch { }

            $totalDevices = $deployedDevices + $pendingDevices + $failedDevices
            $statusAvailable = ($totalDevices -gt 0)

            $updateData.qualityUpdates += [PSCustomObject]@{
                id                      = $policy.id
                displayName             = $displayName
                description             = $description
                qualityUpdateClassification = $classification
                isExpedited             = $isExpedited
                expeditedUpdateSettings = $policy.expeditedUpdateSettings
                releaseDateDisplayName  = $policy.releaseDateDisplayName
                createdDateTime         = Format-IsoDate -DateValue $policy.createdDateTime
                lastModifiedDateTime    = Format-IsoDate -DateValue $policy.lastModifiedDateTime
                assignedGroups          = $assignedGroups
                deploymentState         = @{
                    total     = $totalDevices
                    succeeded = $deployedDevices
                    pending   = $pendingDevices
                    failed    = $failedDevices
                }
                progressPercent         = $progressPercent
                statusAvailable         = $statusAvailable
                statusSource            = if ($statusAvailable) { "deviceUpdateStates" } else { "unavailable" }
                statusUnavailableReason = if ($statusAvailable) {
                    $null
                }
                else {
                    "Quality update deployment status was not returned by Graph for this policy."
                }
            }

            $totalItems++
        }

        $updateData.summary.totalQualityPolicies = $updateData.qualityUpdates.Count
        Write-Host "      Retrieved $($updateData.qualityUpdates.Count) quality update policies" -ForegroundColor Gray
    }
    catch {
        $errors += "Quality updates: $($_.Exception.Message)"
    }

    # ========================================
    # Collect Driver Update Policies with Inventory
    # ========================================
    try {
        $driverProfiles = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsDriverUpdateProfiles" `
                -OutputType PSObject
        } -OperationName "Driver update profiles retrieval"

        foreach ($profile in $driverProfiles.value) {
            # Get driver inventories for this profile
            try {
                $inventoryResponse = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsDriverUpdateProfiles/$($profile.id)/driverInventories?`$top=100" `
                    -OutputType PSObject

                $profileDeviceStates = @()
                try {
                    $deviceStates = Invoke-MgGraphRequest -Method GET `
                        -Uri "https://graph.microsoft.com/beta/deviceManagement/windowsDriverUpdateProfiles/$($profile.id)/deviceUpdateStates" `
                        -OutputType PSObject

                    if ($deviceStates.value) {
                        $profileDeviceStates = @($deviceStates.value)
                        Add-DeviceUpdateStates -StateMap $deviceUpdateStateMap -States $profileDeviceStates -StatusPropertyNames @("driverUpdateState", "status", "state")
                    }
                }
                catch { }

                $deployedDevices = ($profileDeviceStates | Where-Object { $_.driverUpdateState -eq "installed" -or $_.driverUpdateState -eq "succeeded" }).Count
                $pendingDevices = ($profileDeviceStates | Where-Object { $_.driverUpdateState -eq "pending" -or $_.driverUpdateState -eq "downloading" }).Count
                $failedDevices = ($profileDeviceStates | Where-Object { $_.driverUpdateState -eq "failed" }).Count

                foreach ($driver in $inventoryResponse.value) {
                    # Flatten driver into driverUpdates array (dashboard expects this structure)
                    $updateData.driverUpdates += [PSCustomObject]@{
                        id              = $driver.id
                        displayName     = $driver.name
                        driverClass     = $driver.driverClass
                        manufacturer    = $driver.manufacturer
                        version         = $driver.version
                        releaseDateTime = Format-IsoDate -DateValue $driver.releaseDateTime
                        approvalStatus  = $driver.approvalStatus
                        applicableDeviceCount = $driver.applicableDeviceCount
                        profileId       = $profile.id
                        profileName     = $profile.displayName
                        deploymentState = @{
                            total     = $deployedDevices + $pendingDevices + $failedDevices
                            succeeded = $deployedDevices
                            pending   = $pendingDevices
                            failed    = $failedDevices
                        }
                        statusAvailable = (($deployedDevices + $pendingDevices + $failedDevices) -gt 0)
                        statusSource    = if (($deployedDevices + $pendingDevices + $failedDevices) -gt 0) { "deviceUpdateStates" } else { "unavailable" }
                        statusUnavailableReason = if (($deployedDevices + $pendingDevices + $failedDevices) -gt 0) {
                            $null
                        } else {
                            "Driver deployment status was not returned by Graph for this update profile."
                        }
                    }

                    $totalItems++
                }
            }
            catch { }
        }

        $updateData.summary.totalDriverUpdates = $updateData.driverUpdates.Count
        $updateData.summary.driversNeedingReview = ($updateData.driverUpdates | Where-Object { $_.approvalStatus -eq "needs_review" }).Count
        Write-Host "      Retrieved $($updateData.driverUpdates.Count) driver updates" -ForegroundColor Gray
    }
    catch {
        # Driver updates may not be available in all tenants
    }

    # ========================================
    # Collect Device Windows Update Compliance
    # ========================================
    try {
        # Reuse managed devices from SharedData (populated by Get-DeviceData) to avoid
        # a duplicate API call. Falls back to fetching directly if SharedData not available.
        $allDevices = @()
        if ($SharedData -and $SharedData.ContainsKey('ManagedDevices') -and $SharedData['ManagedDevices'].Count -gt 0) {
            # Reuse devices already fetched by Get-DeviceData - filter to Windows
            # and normalize property names for compatibility
            $allDevices = @($SharedData['ManagedDevices'] | Where-Object {
                $os = if ($_.OperatingSystem) { $_.OperatingSystem } else { $_.operatingSystem }
                $os -eq 'Windows'
            } | ForEach-Object {
                # Normalize to camelCase for consistency with rest of this collector
                [PSCustomObject]@{
                    id                = if ($_.Id) { $_.Id } else { $_.id }
                    deviceName        = if ($_.DeviceName) { $_.DeviceName } else { $_.deviceName }
                    osVersion         = if ($_.OsVersion) { $_.OsVersion } else { $_.osVersion }
                    lastSyncDateTime  = if ($_.LastSyncDateTime) { $_.LastSyncDateTime } else { $_.lastSyncDateTime }
                    complianceState   = if ($_.ComplianceState) { $_.ComplianceState } else { $_.complianceState }
                    userPrincipalName = if ($_.UserPrincipalName) { $_.UserPrincipalName } else { $_.userPrincipalName }
                    model             = if ($_.Model) { $_.Model } else { $_.model }
                }
            })
            Write-Host "      Reusing $($allDevices.Count) Windows devices from shared data (no extra API call)" -ForegroundColor Gray
        }
        else {
            # Fallback: fetch from API if shared data not available
            $windowsDevices = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$filter=operatingSystem eq 'Windows'&`$select=id,deviceName,osVersion,lastSyncDateTime,complianceState,userPrincipalName,model&`$top=500" `
                    -OutputType PSObject
            } -OperationName "Device compliance retrieval"

            $allDevices = @($windowsDevices.value)

            # Handle pagination
            while ($windowsDevices.'@odata.nextLink') {
                $windowsDevices = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method GET -Uri $windowsDevices.'@odata.nextLink' -OutputType PSObject
                } -OperationName "Device compliance pagination"
                $allDevices += $windowsDevices.value
            }
        }

        $upToDateCount = 0
        $pendingCount = 0
        $errorCount = 0
        $stalePatchCount = 0
        $currentPatchCount = 0
        $patchAgeThreshold = if ($Config.thresholds -and $Config.thresholds.patchAgeDays) {
            [int]$Config.thresholds.patchAgeDays
        } else {
            30
        }

        foreach ($device in $allDevices) {
            $updateStatus = "Unknown"
            $pendingUpdates = 0
            $failedUpdates = 0
            $errorDetails = $null
            $updateStatusSource = $null
            $qualityUpdateLastEvent = $null
            $qualityUpdateAgeDays = $null
            $qualityUpdateAgeSource = $null
            $qualityUpdateAgeStatus = "unknown"

            $deviceState = $deviceUpdateStateMap[$device.id]
            if ($deviceState) {
                $pendingUpdates = [int]$deviceState.pending
                $failedUpdates = [int]$deviceState.failed
                if ($failedUpdates -gt 0) {
                    $updateStatus = "error"
                    $errorDetails = "Failed updates detected"
                    $errorCount++
                }
                elseif ($pendingUpdates -gt 0) {
                    $updateStatus = "pendingUpdate"
                    $pendingCount++
                }
                elseif ([int]$deviceState.succeeded -gt 0) {
                    $updateStatus = "upToDate"
                    $upToDateCount++
                }
                $updateStatusSource = "PolicyState"

                if ($deviceState.lastEvent) {
                    $qualityUpdateLastEvent = $deviceState.lastEvent
                    $qualityUpdateAgeDays = Get-DaysSinceDate -DateValue $qualityUpdateLastEvent
                    $qualityUpdateAgeSource = "UpdateState"
                }
            }
            else {
                # Fallback to last sync when no update state data is available
                $lastSync = $device.lastSyncDateTime
                if ($lastSync) {
                    $daysSinceSync = ((Get-Date) - [DateTime]$lastSync).Days
                    if ($daysSinceSync -le 7) {
                        $updateStatus = "upToDate"
                        $upToDateCount++
                    }
                    elseif ($daysSinceSync -le 30) {
                        $updateStatus = "pendingUpdate"
                        $pendingUpdates = 1
                        $pendingCount++
                    }
                    else {
                        $updateStatus = "error"
                        $failedUpdates = 1
                        $errorDetails = "Device has not synced in over 30 days"
                        $errorCount++
                    }
                }
                $updateStatusSource = "LastSync"

                if ($device.lastSyncDateTime) {
                    $qualityUpdateLastEvent = $device.lastSyncDateTime
                    $qualityUpdateAgeDays = Get-DaysSinceDate -DateValue $device.lastSyncDateTime
                    $qualityUpdateAgeSource = "LastSync"
                }
            }

            if ($qualityUpdateAgeDays -ne $null) {
                if ($qualityUpdateAgeDays -gt $patchAgeThreshold) {
                    $qualityUpdateAgeStatus = "stale"
                    $stalePatchCount++
                }
                else {
                    $qualityUpdateAgeStatus = "current"
                    $currentPatchCount++
                }
            }
            if ($updateStatus -eq "error") {
                $qualityUpdateAgeStatus = "error"
            }

            # Determine feature update version from OS version using shared lifecycle mapping
            $featureUpdateVersion = "Unknown"
            $osVer = $device.osVersion
            $winLifecycle = Get-WindowsLifecycleInfo -OsVersion $osVer
            if ($winLifecycle.windowsType -and $winLifecycle.windowsRelease) {
                $featureUpdateVersion = "$($winLifecycle.windowsType), version $($winLifecycle.windowsRelease)"
            }

            # Determine update ring assignment from deviceStatuses (if available)
            $updateRing = $null
            $updateRingAssignments = $null
            if ($deviceRingAssignments.ContainsKey($device.id)) {
                $updateRingAssignments = $deviceRingAssignments[$device.id]
            }
            if ($updateRingAssignments -and $updateRingAssignments.Count -gt 0) {
                if ($updateRingAssignments.Count -eq 1) {
                    $updateRing = $updateRingAssignments[0]
                }
                else {
                    $updateRing = "Multiple ($($updateRingAssignments.Count))"
                }
            }

            $deviceEntry = [PSCustomObject]@{
                deviceId            = $device.id
                deviceName          = $device.deviceName
                userPrincipalName   = $device.userPrincipalName
                osVersion           = $osVer
                updateStatus        = $updateStatus
                lastSyncDateTime    = Format-IsoDate -DateValue $device.lastSyncDateTime
                complianceState     = $device.complianceState
                featureUpdateVersion = $featureUpdateVersion
                pendingUpdates      = $pendingUpdates
                failedUpdates       = $failedUpdates
                updateRing          = $updateRing
                updateRingAssignments = $updateRingAssignments
                updateStatusSource  = $updateStatusSource
                qualityUpdateLastEvent = if ($qualityUpdateLastEvent) { Format-IsoDate -DateValue $qualityUpdateLastEvent } else { $null }
                qualityUpdateAgeDays = $qualityUpdateAgeDays
                qualityUpdateAgeSource = $qualityUpdateAgeSource
                qualityUpdateAgeStatus = $qualityUpdateAgeStatus
            }

            # Add errorDetails only if there's an error
            if ($errorDetails) {
                $deviceEntry | Add-Member -NotePropertyName errorDetails -NotePropertyValue $errorDetails
            }

            $updateData.deviceCompliance += $deviceEntry
        }

        # Update summary with device compliance stats
        $updateData.summary.totalManagedDevices = $allDevices.Count
        if ($allDevices.Count -gt 0) {
            $updateData.summary.devicesUpToDate = $upToDateCount
            $updateData.summary.devicesPendingUpdate = $pendingCount
            $updateData.summary.devicesWithErrors = $errorCount
            $updateData.summary.complianceRate = [Math]::Round(($upToDateCount / $allDevices.Count) * 100, 1)
            $updateData.summary.devicesPatchStale = $stalePatchCount
            $updateData.summary.devicesPatchCurrent = $currentPatchCount
            $updateData.summary.patchAgeThresholdDays = $patchAgeThreshold
        }

        Write-Host "      Retrieved compliance for $($updateData.deviceCompliance.Count) devices" -ForegroundColor Gray
    }
    catch {
        $errors += "Device compliance: $($_.Exception.Message)"
    }

    # Add collection date
    $updateData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $updateData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $totalItems Windows Update items" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $totalItems -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Authorization") {
        Write-Host "    [!] Windows Update collection requires Intune license and DeviceManagementConfiguration.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        updateRings = @()
        featureUpdates = @()
        qualityUpdates = @()
        driverUpdates = @()
        deviceCompliance = @()
        summary = @{
            totalRings = 0
            totalFeaturePolicies = 0
            totalQualityPolicies = 0
            totalDriverUpdates = 0
            totalManagedDevices = 0
            devicesUpToDate = 0
            devicesPendingUpdate = 0
            devicesWithErrors = 0
            complianceRate = 0
            expeditedUpdatesActive = 0
            securityUpdates = 0
            pausedRings = 0
            driversNeedingReview = 0
            devicesPatchStale = 0
            devicesPatchCurrent = 0
            patchAgeThresholdDays = 30
        }
        collectionDate = (Get-Date).ToString("o")
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}

