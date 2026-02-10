# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Endpoint Analytics device health and performance data.

.DESCRIPTION
    Retrieves Endpoint Analytics scores and metrics including startup
    performance, application reliability, and device health scores.
    Enables proactive device health management.

    Graph API endpoints:
    - GET /deviceManagement/userExperienceAnalyticsDeviceScores
    - GET /deviceManagement/userExperienceAnalyticsDevicePerformance
    - GET /deviceManagement/userExperienceAnalyticsDeviceStartupHistory
    - GET /deviceManagement/userExperienceAnalyticsOverview

    Required scopes:
    - DeviceManagementManagedDevices.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes endpoint-analytics.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-EndpointAnalytics.ps1 -Config $config -OutputPath ".\data\endpoint-analytics.json"
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
# (Using shared status mappers from CollectorBase.ps1)

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$deviceCount = 0

try {
    Write-Host "    Collecting Endpoint Analytics data..." -ForegroundColor Gray

    $analyticsData = @{
        overview = $null
        deviceScores = @()
        devicePerformance = @()
        startupHistory = @()
        startupProcesses = @()
        appReliability = @()
        deviceAppHealth = @()
        batteryHealth = @()
        workFromAnywhere = @()
        modelInsights = @()
        insights = @()
        osDistribution = @{}
        summary = @{
            totalDevices = 0
            averageEndpointScore = 0
            averageStartupScore = 0
            averageAppReliabilityScore = 0
            averageWorkFromAnywhereScore = 0
            averageBatteryHealthScore = 0
            devicesNeedingAttention = 0
            excellentDevices = 0
            goodDevices = 0
            fairDevices = 0
            poorDevices = 0
            modelsWithIssues = 0
            problematicApps = 0
            topPerformingModel = ""
            worstPerformingModel = ""
            devicesWithBatteryIssues = 0
            devicesWithSlowLogin = 0
            gpBootOverheadAvgMs = 0
            gpLoginOverheadAvgMs = 0
        }
    }

    # ========================================
    # Get Overview/Baseline
    # ========================================
    try {
        $overview = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsOverview" `
                -OutputType PSObject
        } -OperationName "Endpoint Analytics overview"

        $analyticsData.overview = [PSCustomObject]@{
            overallScore                 = $overview.overallScore
            startupPerformanceScore      = $overview.startupPerformanceOverallScore
            appReliabilityScore          = $overview.appReliabilityOverallScore
            workFromAnywhereScore        = $overview.workFromAnywhereOverallScore
            batteryHealthScore           = $overview.batteryHealthOverallScore
            bestPracticesScore           = $overview.bestPracticesOverallScore
            resourcePerformanceScore     = $overview.resourcePerformanceOverallScore
            totalDevices                 = $overview.totalDeviceCount
            insightsCount                = if ($overview.insights) { $overview.insights.Count } else { 0 }
            baseline                     = [PSCustomObject]@{
                overallScore             = 50
                startupPerformanceScore  = 50
                appReliabilityScore      = 50
            }
        }

        Write-Host "      Overall Endpoint Score: $($overview.overallScore)" -ForegroundColor Gray
    }
    catch {
        $errors += "Overview: $($_.Exception.Message)"
    }

    # ========================================
    # Get Device Scores
    # ========================================
    try {
        # Use $top=100 as recommended for Graph API pagination
        $deviceScores = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsDeviceScores?`$top=100" `
                -OutputType PSObject
        } -OperationName "Device scores retrieval"

        $allScores = @($deviceScores.value)

        # Handle pagination
        while ($deviceScores.'@odata.nextLink') {
            $deviceScores = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $deviceScores.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Device scores pagination"
            $allScores += $deviceScores.value
        }

        foreach ($score in $allScores) {
            $endpointScore = [int]$score.endpointAnalyticsScore
            $healthStatus = Get-HealthStatus -Score $endpointScore

            $processedScore = [PSCustomObject]@{
                id                        = $score.id
                deviceName                = $score.deviceName
                manufacturer              = $score.manufacturer
                model                     = $score.model
                endpointAnalyticsScore    = $endpointScore
                startupPerformanceScore   = [int]$score.startupPerformanceScore
                appReliabilityScore       = [int]$score.appReliabilityScore
                workFromAnywhereScore     = [int]$score.workFromAnywhereScore
                batteryHealthScore        = if ($score.batteryHealthScore) { [int]$score.batteryHealthScore } else { $null }
                cloudManagementScore      = if ($score.cloudManagementScore) { [int]$score.cloudManagementScore } else { $null }
                healthStatus              = $healthStatus
                needsAttention            = ($endpointScore -lt 50)
            }

            $analyticsData.deviceScores += $processedScore
            $deviceCount++

            # Update summary
            $analyticsData.summary.totalDevices++
            switch ($healthStatus) {
                "Excellent" { $analyticsData.summary.excellentDevices++ }
                "Good"      { $analyticsData.summary.goodDevices++ }
                "Fair"      { $analyticsData.summary.fairDevices++ }
                "Poor"      { $analyticsData.summary.poorDevices++; $analyticsData.summary.devicesNeedingAttention++ }
                "Critical"  { $analyticsData.summary.devicesNeedingAttention++ }
            }
        }

        # Calculate averages
        if ($analyticsData.deviceScores.Count -gt 0) {
            $analyticsData.summary.averageEndpointScore = [Math]::Round(
                ($analyticsData.deviceScores | Measure-Object -Property endpointAnalyticsScore -Average).Average, 1
            )
            $analyticsData.summary.averageStartupScore = [Math]::Round(
                ($analyticsData.deviceScores | Measure-Object -Property startupPerformanceScore -Average).Average, 1
            )
            $analyticsData.summary.averageAppReliabilityScore = [Math]::Round(
                ($analyticsData.deviceScores | Measure-Object -Property appReliabilityScore -Average).Average, 1
            )
        }

        Write-Host "      Retrieved scores for $($analyticsData.deviceScores.Count) devices" -ForegroundColor Gray
    }
    catch {
        $errors += "Device scores: $($_.Exception.Message)"
    }

    # ========================================
    # Get Device Performance (Startup)
    # ========================================
    try {
        # Use $top=100 as recommended for Graph API pagination
        $performance = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsDevicePerformance?`$top=100" `
                -OutputType PSObject
        } -OperationName "Device performance retrieval"

        $allPerf = @($performance.value)

        while ($performance.'@odata.nextLink') {
            $performance = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $performance.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Device performance pagination"
            $allPerf += $performance.value
        }

        $totalGpBootOverhead = 0
        $totalGpLoginOverhead = 0
        $slowLoginCount = 0
        $perfCount = 0

        foreach ($perf in $allPerf) {
            $analyticsData.devicePerformance += [PSCustomObject]@{
                id                       = $perf.id
                deviceName               = $perf.deviceName
                manufacturer             = $perf.manufacturer
                model                    = $perf.model
                operatingSystemVersion   = $perf.operatingSystemVersion
                startupPerformanceScore  = $perf.startupPerformanceScore
                coreBootTimeInMs         = $perf.coreBootTimeInMs
                groupPolicyBootTimeInMs  = $perf.groupPolicyBootTimeInMs
                totalBootTimeInMs        = ($perf.coreBootTimeInMs + $perf.groupPolicyBootTimeInMs)
                healthStatus             = $perf.healthStatus
                loginTimeInMs            = $perf.loginTimeInMs
                coreLoginTimeInMs        = $perf.coreLoginTimeInMs
                groupPolicyLoginTimeInMs = $perf.groupPolicyLoginTimeInMs
                totalLoginTimeInMs       = ($perf.coreLoginTimeInMs + $perf.groupPolicyLoginTimeInMs)
                bootScore                = $perf.bootScore
                loginScore               = $perf.loginScore
                restartCount             = $perf.restartCount
                blueScreenCount          = $perf.blueScreenCount
                averageBlueScreens       = $perf.averageBlueScreens
                averageRestarts          = $perf.averageRestarts
            }

            # Track OS distribution
            $osVersion = $perf.operatingSystemVersion
            if ($osVersion) {
                if (-not $analyticsData.osDistribution[$osVersion]) {
                    $analyticsData.osDistribution[$osVersion] = 0
                }
                $analyticsData.osDistribution[$osVersion]++
            }

            # Calculate GP overhead
            if ($perf.groupPolicyBootTimeInMs) {
                $totalGpBootOverhead += [int]$perf.groupPolicyBootTimeInMs
            }
            if ($perf.groupPolicyLoginTimeInMs) {
                $totalGpLoginOverhead += [int]$perf.groupPolicyLoginTimeInMs
            }

            # Track slow login devices (login > 60 seconds)
            $totalLoginMs = [int]$perf.coreLoginTimeInMs + [int]$perf.groupPolicyLoginTimeInMs
            if ($totalLoginMs -gt 60000) {
                $slowLoginCount++
            }
            $perfCount++
        }

        # Calculate average GP overhead
        if ($perfCount -gt 0) {
            $analyticsData.summary.gpBootOverheadAvgMs = [Math]::Round($totalGpBootOverhead / $perfCount)
            $analyticsData.summary.gpLoginOverheadAvgMs = [Math]::Round($totalGpLoginOverhead / $perfCount)
            $analyticsData.summary.devicesWithSlowLogin = $slowLoginCount
        }

        Write-Host "      Retrieved performance data for $($analyticsData.devicePerformance.Count) devices" -ForegroundColor Gray
    }
    catch {
        $errors += "Device performance: $($_.Exception.Message)"
    }

    # ========================================
    # Get App Reliability Data (with pagination)
    # ========================================
    try {
        # Use $top=100 as recommended for Graph API pagination
        $appReliability = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsAppHealthApplicationPerformance?`$top=100" `
                -OutputType PSObject
        } -OperationName "App reliability retrieval"

        $allApps = @($appReliability.value)

        # Handle pagination for app reliability
        while ($appReliability.'@odata.nextLink') {
            $appReliability = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $appReliability.'@odata.nextLink' -OutputType PSObject
            } -OperationName "App reliability pagination"
            $allApps += $appReliability.value
        }

        foreach ($app in $allApps) {
            # Calculate trend based on health score and MTTF
            $healthScore = [int]$app.appHealthScore
            $mttf = [int]$app.meanTimeToFailureInMinutes
            $crashCount = [int]$app.appCrashCount

            # Determine trend - this would ideally use historical data
            # Using health score as a proxy: high score = stable/improving, low = degrading
            $trend = "Stable"
            if ($healthScore -ge 80 -and $crashCount -le 5) {
                $trend = "Improving"
            }
            elseif ($healthScore -lt 50 -or $crashCount -gt 20) {
                $trend = "Degrading"
            }

            $analyticsData.appReliability += [PSCustomObject]@{
                id                    = $app.id
                appName               = $app.appDisplayName
                appPublisher          = $app.appPublisher
                appVersion            = $app.appVersion
                appCrashCount         = $crashCount
                appHangCount          = [int]$app.appHangCount
                meanTimeToFailure     = $mttf
                healthScore           = $healthScore
                activeDeviceCount     = [int]$app.activeDeviceCount
                trend                 = $trend
            }
        }

        Write-Host "      Retrieved reliability data for $($analyticsData.appReliability.Count) apps" -ForegroundColor Gray
    }
    catch {
        $errors += "App reliability: $($_.Exception.Message)"
    }

    # ========================================
    # Get Battery Health Data
    # ========================================
    try {
        # Use $top=100 as recommended for Graph API pagination
        $batteryHealth = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsBatteryHealthDevicePerformance?`$top=100" `
                -OutputType PSObject
        } -OperationName "Battery health retrieval"

        $allBattery = @($batteryHealth.value)

        while ($batteryHealth.'@odata.nextLink') {
            $batteryHealth = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $batteryHealth.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Battery health pagination"
            $allBattery += $batteryHealth.value
        }

        $batteryIssueCount = 0
        foreach ($battery in $allBattery) {
            $healthPct = if ($battery.batteryHealthPercentage) { [int]$battery.batteryHealthPercentage } else { 100 }

            $analyticsData.batteryHealth += [PSCustomObject]@{
                id                       = $battery.id
                deviceName               = $battery.deviceName
                manufacturer             = $battery.manufacturer
                model                    = $battery.model
                batteryHealthPercentage  = $healthPct
                estimatedBatteryCapacity = $battery.estimatedBatteryCapacity
                fullBatteryDrainCount    = $battery.fullBatteryDrainCount
                maxCapacityPercentage    = $battery.maxCapacityPercentage
                batteryAgeInDays         = $battery.batteryAgeInDays
            }

            # Track devices with battery issues (below 60% health)
            if ($healthPct -lt 60) {
                $batteryIssueCount++
            }
        }

        $analyticsData.summary.devicesWithBatteryIssues = $batteryIssueCount

        # Calculate average battery health
        if ($allBattery.Count -gt 0) {
            $avgBatteryHealth = [Math]::Round(
                ($analyticsData.batteryHealth | Where-Object { $_.batteryHealthPercentage } |
                 Measure-Object -Property batteryHealthPercentage -Average).Average, 1
            )
            $analyticsData.summary.averageBatteryHealthScore = $avgBatteryHealth
        }

        Write-Host "      Retrieved battery health for $($analyticsData.batteryHealth.Count) devices" -ForegroundColor Gray
    }
    catch {
        # Battery health is optional - don't fail collection
        Write-Host "      Battery health data not available (requires Intune licensing)" -ForegroundColor DarkGray
    }

    # ========================================
    # Get Work From Anywhere Metrics
    # ========================================
    try {
        # Use the model performance endpoint for work from anywhere data
        # Use $top=100 as recommended for Graph API pagination
        $wfaMetrics = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsWorkFromAnywhereModelPerformance?`$top=100" `
                -OutputType PSObject
        } -OperationName "Work from anywhere retrieval"

        $allWfa = @($wfaMetrics.value)

        while ($wfaMetrics.'@odata.nextLink') {
            $wfaMetrics = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $wfaMetrics.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Work from anywhere pagination"
            $allWfa += $wfaMetrics.value
        }

        foreach ($wfa in $allWfa) {
            $analyticsData.workFromAnywhere += [PSCustomObject]@{
                id                        = $wfa.id
                model                     = $wfa.model
                manufacturer              = $wfa.manufacturer
                modelDeviceCount          = $wfa.modelDeviceCount
                cloudManagementScore      = $wfa.cloudManagementScore
                cloudIdentityScore        = $wfa.cloudIdentityScore
                cloudProvisioningScore    = $wfa.cloudProvisioningScore
                windowsScore              = $wfa.windowsScore
                workFromAnywhereScore     = $wfa.workFromAnywhereScore
                healthStatus              = $wfa.healthStatus
            }
        }

        # Calculate average WFA score
        if ($allWfa.Count -gt 0) {
            $avgWfaScore = [Math]::Round(
                ($analyticsData.workFromAnywhere | Where-Object { $_.workFromAnywhereScore } |
                 Measure-Object -Property workFromAnywhereScore -Average).Average, 1
            )
            $analyticsData.summary.averageWorkFromAnywhereScore = $avgWfaScore
        }

        Write-Host "      Retrieved work from anywhere metrics for $($analyticsData.workFromAnywhere.Count) models" -ForegroundColor Gray
    }
    catch {
        # WFA metrics is optional - don't fail collection
        Write-Host "      Work from anywhere data not available (requires Intune licensing)" -ForegroundColor DarkGray
    }

    # ========================================
    # Get Startup Process Impact
    # ========================================
    try {
        # Use $top=100 as recommended for Graph API pagination
        $startupProcs = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsDeviceStartupProcesses?`$top=100" `
                -OutputType PSObject
        } -OperationName "Startup processes retrieval"

        $allProcs = @($startupProcs.value)

        while ($startupProcs.'@odata.nextLink') {
            $startupProcs = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $startupProcs.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Startup processes pagination"
            $allProcs += $startupProcs.value
        }

        # Aggregate processes by name for summary
        $procSummary = @{}
        foreach ($proc in $allProcs) {
            $procName = $proc.processName
            if (-not $procSummary[$procName]) {
                $procSummary[$procName] = @{
                    totalStartupImpactMs = 0
                    deviceCount = 0
                    publisher = $proc.publisher
                }
            }
            $procSummary[$procName].totalStartupImpactMs += [int]$proc.startupImpactInMs
            $procSummary[$procName].deviceCount++
        }

        foreach ($procName in $procSummary.Keys) {
            $data = $procSummary[$procName]
            $analyticsData.startupProcesses += [PSCustomObject]@{
                processName          = $procName
                publisher            = $data.publisher
                deviceCount          = $data.deviceCount
                totalStartupImpactMs = $data.totalStartupImpactMs
                avgStartupImpactMs   = [Math]::Round($data.totalStartupImpactMs / $data.deviceCount)
            }
        }

        # Sort by impact (highest first)
        $analyticsData.startupProcesses = $analyticsData.startupProcesses | Sort-Object -Property avgStartupImpactMs -Descending

        Write-Host "      Retrieved startup impact for $($analyticsData.startupProcesses.Count) processes" -ForegroundColor Gray
    }
    catch {
        # Startup processes is optional - don't fail collection
        Write-Host "      Startup process data not available" -ForegroundColor DarkGray
    }

    # ========================================
    # Get Device-Level App Health
    # ========================================
    try {
        # Use $top=100 as recommended for Graph API pagination
        $deviceAppHealth = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/userExperienceAnalyticsAppHealthDevicePerformance?`$top=100" `
                -OutputType PSObject
        } -OperationName "Device app health retrieval"

        $allDeviceApp = @($deviceAppHealth.value)

        while ($deviceAppHealth.'@odata.nextLink') {
            $deviceAppHealth = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $deviceAppHealth.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Device app health pagination"
            $allDeviceApp += $deviceAppHealth.value
        }

        foreach ($dah in $allDeviceApp) {
            $analyticsData.deviceAppHealth += [PSCustomObject]@{
                id                    = $dah.id
                deviceName            = $dah.deviceName
                deviceDisplayName     = $dah.deviceDisplayName
                appCrashCount         = [int]$dah.appCrashCount
                appHangCount          = [int]$dah.appHangCount
                crashedAppCount       = [int]$dah.crashedAppCount
                meanTimeToFailure     = [int]$dah.meanTimeToFailureInMinutes
                deviceAppHealthScore  = if ($dah.deviceAppHealthScore) { [int]$dah.deviceAppHealthScore } else { $null }
                healthStatus          = $dah.healthStatus
            }
        }

        Write-Host "      Retrieved device app health for $($analyticsData.deviceAppHealth.Count) devices" -ForegroundColor Gray
    }
    catch {
        # Device app health is optional - don't fail collection
        Write-Host "      Device app health data not available" -ForegroundColor DarkGray
    }

    # ========================================
    # Compute Model Insights
    # ========================================
    if ($analyticsData.deviceScores.Count -gt 0) {
        $modelGroups = $analyticsData.deviceScores | Group-Object -Property model

        foreach ($group in $modelGroups) {
            $modelName = $group.Name
            if (-not $modelName -or $modelName -eq "") { continue }

            $devices = $group.Group
            $deviceCount = $devices.Count
            $avgHealth = [Math]::Round(($devices | Measure-Object -Property endpointAnalyticsScore -Average).Average, 1)
            $avgStartup = [Math]::Round(($devices | Measure-Object -Property startupPerformanceScore -Average).Average, 1)
            $avgAppReliability = [Math]::Round(($devices | Measure-Object -Property appReliabilityScore -Average).Average, 1)
            $poorCount = ($devices | Where-Object { $_.healthStatus -eq "Poor" -or $_.healthStatus -eq "Critical" }).Count
            $manufacturer = ($devices | Select-Object -First 1).manufacturer

            # Generate recommendation based on scores
            $recommendation = ""
            if ($avgHealth -lt 50) {
                $recommendation = "Hardware refresh recommended - multiple performance issues detected"
                $analyticsData.summary.modelsWithIssues++
            }
            elseif ($avgStartup -lt 40) {
                $recommendation = "Optimize startup - consider reviewing installed apps and startup items"
            }
            elseif ($avgAppReliability -lt 50) {
                $recommendation = "Investigate app crashes - may need application updates or reinstalls"
            }
            elseif ($avgHealth -ge 80) {
                $recommendation = "Performing well - no action needed"
            }
            else {
                $recommendation = "Monitor device health trends"
            }

            $analyticsData.modelInsights += [PSCustomObject]@{
                model               = $modelName
                manufacturer        = $manufacturer
                deviceCount         = $deviceCount
                avgHealthScore      = $avgHealth
                avgStartupScore     = $avgStartup
                avgAppReliabilityScore = $avgAppReliability
                poorDevices         = $poorCount
                recommendation      = $recommendation
            }
        }

        # Sort model insights by health score (worst first)
        $analyticsData.modelInsights = $analyticsData.modelInsights | Sort-Object -Property avgHealthScore

        # Set top and worst performing models
        if ($analyticsData.modelInsights.Count -gt 0) {
            $sortedByScore = $analyticsData.modelInsights | Sort-Object -Property avgHealthScore -Descending
            $analyticsData.summary.topPerformingModel = $sortedByScore[0].model
            $analyticsData.summary.worstPerformingModel = $sortedByScore[-1].model
        }

        Write-Host "      Computed insights for $($analyticsData.modelInsights.Count) device models" -ForegroundColor Gray
    }

    # ========================================
    # Extract Actionable Insights
    # ========================================
    try {
        # Generate insights from collected data
        $poorDevices = ($analyticsData.deviceScores | Where-Object { $_.healthStatus -eq "Poor" -or $_.healthStatus -eq "Critical" })
        if ($poorDevices.Count -gt 0) {
            $analyticsData.insights += [PSCustomObject]@{
                id = "poor-health-devices"
                title = "Devices with poor health scores"
                severity = "critical"
                description = "$($poorDevices.Count) devices have poor or critical health scores"
                impactedDevices = $poorDevices.Count
                recommendedAction = "Review device hardware and software configurations for affected devices"
                category = "Device Health"
            }
        }

        $slowStartupDevices = ($analyticsData.deviceScores | Where-Object { $_.startupPerformanceScore -lt 40 })
        if ($slowStartupDevices.Count -gt 0) {
            $analyticsData.insights += [PSCustomObject]@{
                id = "slow-startup"
                title = "Devices with slow startup times"
                severity = "high"
                description = "$($slowStartupDevices.Count) devices have slow startup times"
                impactedDevices = $slowStartupDevices.Count
                recommendedAction = "Review startup applications and consider SSD upgrades for HDD devices"
                category = "Startup Performance"
            }
        }

        $problemApps = ($analyticsData.appReliability | Where-Object { $_.appCrashCount -gt 10 -or $_.appHangCount -gt 10 })
        $analyticsData.summary.problematicApps = $problemApps.Count
        if ($problemApps.Count -gt 0) {
            $analyticsData.insights += [PSCustomObject]@{
                id = "problem-apps"
                title = "Applications with reliability issues"
                severity = "high"
                description = "$($problemApps.Count) applications have high crash or hang counts"
                impactedDevices = ($problemApps | Measure-Object -Property activeDeviceCount -Sum).Sum
                recommendedAction = "Update or reinstall problematic applications"
                category = "App Reliability"
            }
        }

        $blueScreenDevices = ($analyticsData.devicePerformance | Where-Object { $_.blueScreenCount -gt 0 })
        if ($blueScreenDevices.Count -gt 0) {
            $totalBSODs = ($blueScreenDevices | Measure-Object -Property blueScreenCount -Sum).Sum
            $analyticsData.insights += [PSCustomObject]@{
                id = "blue-screens"
                title = "Blue screen events detected"
                severity = "critical"
                description = "$totalBSODs blue screen events across $($blueScreenDevices.Count) devices"
                impactedDevices = $blueScreenDevices.Count
                recommendedAction = "Investigate driver issues and hardware health for affected devices"
                category = "System Stability"
            }
        }

        # Battery health insights
        if ($analyticsData.summary.devicesWithBatteryIssues -gt 0) {
            $analyticsData.insights += [PSCustomObject]@{
                id = "battery-health"
                title = "Devices with battery health issues"
                severity = "high"
                description = "$($analyticsData.summary.devicesWithBatteryIssues) devices have battery health below 60%"
                impactedDevices = $analyticsData.summary.devicesWithBatteryIssues
                recommendedAction = "Consider battery replacement for affected devices to maintain productivity"
                category = "Hardware Health"
            }
        }

        # Slow login insights
        if ($analyticsData.summary.devicesWithSlowLogin -gt 0) {
            $analyticsData.insights += [PSCustomObject]@{
                id = "slow-login"
                title = "Devices with slow login times"
                severity = "high"
                description = "$($analyticsData.summary.devicesWithSlowLogin) devices take over 60 seconds to complete login"
                impactedDevices = $analyticsData.summary.devicesWithSlowLogin
                recommendedAction = "Review Group Policy processing, startup applications, and profile sizes"
                category = "Login Performance"
            }
        }

        # Group Policy overhead insights
        if ($analyticsData.summary.gpLoginOverheadAvgMs -gt 15000) {
            $gpSeconds = [Math]::Round($analyticsData.summary.gpLoginOverheadAvgMs / 1000)
            $analyticsData.insights += [PSCustomObject]@{
                id = "gp-overhead"
                title = "High Group Policy overhead"
                severity = "medium"
                description = "Group Policy adds an average of $gpSeconds seconds to login time"
                impactedDevices = $analyticsData.summary.totalDevices
                recommendedAction = "Review GPO efficiency, consider GPO consolidation or Intune migration"
                category = "Login Performance"
            }
        }

        # Top startup process impact
        $highImpactProcs = $analyticsData.startupProcesses | Where-Object { $_.avgStartupImpactMs -gt 5000 }
        if ($highImpactProcs.Count -gt 0) {
            $topProcs = ($highImpactProcs | Select-Object -First 3 | ForEach-Object { $_.processName }) -join ", "
            $analyticsData.insights += [PSCustomObject]@{
                id = "startup-processes"
                title = "High-impact startup processes"
                severity = "medium"
                description = "$($highImpactProcs.Count) processes add more than 5 seconds to startup. Top: $topProcs"
                impactedDevices = ($highImpactProcs | Measure-Object -Property deviceCount -Sum).Sum
                recommendedAction = "Review startup application necessity, defer non-essential applications"
                category = "Startup Performance"
            }
        }

        Write-Host "      Generated $($analyticsData.insights.Count) actionable insights" -ForegroundColor Gray
    }
    catch {
        $errors += "Insights: $($_.Exception.Message)"
    }

    # Sort device scores by score (worst first)
    $analyticsData.deviceScores = $analyticsData.deviceScores | Sort-Object -Property endpointAnalyticsScore

    # Add collection date
    $analyticsData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $analyticsData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected Endpoint Analytics for $deviceCount devices" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $deviceCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "license|subscription|permission|forbidden|Authorization|Endpoint Analytics") {
        Write-Host "    [!] Endpoint Analytics requires appropriate licensing and DeviceManagementManagedDevices.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        overview = $null
        deviceScores = @()
        devicePerformance = @()
        appReliability = @()
        modelInsights = @()
        insights = @()
        summary = @{}
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
