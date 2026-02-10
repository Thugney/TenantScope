# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Intune device compliance policies and their status.

.DESCRIPTION
    Retrieves all device compliance policies from Microsoft Intune including
    policy settings, assignments, and device compliance status per policy.
    This enables visibility into which policies exist, their targets, and
    compliance rates.

    Graph API endpoints:
    - GET /deviceManagement/deviceCompliancePolicies
    - GET /deviceManagement/deviceCompliancePolicies/{id}/assignments
    - GET /deviceManagement/deviceCompliancePolicies/{id}/deviceStatuses

    Required scopes:
    - DeviceManagementConfiguration.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes compliance-policies.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of policies collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-CompliancePolicies.ps1 -Config $config -OutputPath ".\data\compliance-policies.json"
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

function Get-PolicyPlatform {
    <#
    .SYNOPSIS
        Extracts the platform from the policy @odata.type.
    #>
    param([string]$ODataType)

    switch -Regex ($ODataType) {
        "windows10"    { return "Windows 10/11" }
        "windows81"    { return "Windows 8.1" }
        "windowsPhone" { return "Windows Phone" }
        "android"      { return "Android" }
        "androidWork"  { return "Android Enterprise" }
        "ios"          { return "iOS/iPadOS" }
        "macOS"        { return "macOS" }
        default        { return "Unknown" }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$policyCount = 0

try {
    Write-Host "    Collecting device compliance policies..." -ForegroundColor Gray

    # Initialize data structure
    $complianceData = @{
        policies = @()
        nonCompliantDevices = @()
        settingFailures = @()
        insights = @()
        summary = @{
            totalPolicies = 0
            totalDevices = 0
            compliantDevices = 0
            nonCompliantDevices = 0
            errorDevices = 0
            overallComplianceRate = 0
            platformBreakdown = @{}
            criticalPolicies = 0
            policiesWithIssues = 0
        }
    }

    # Get all compliance policies
    $policies = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies" -OutputType PSObject
    } -OperationName "Compliance policy retrieval"

    $allPolicies = @($policies.value)

    # Handle pagination
    while ($policies.'@odata.nextLink') {
        $policies = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $policies.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Compliance policy pagination"
        $allPolicies += $policies.value
    }

    Write-Host "      Retrieved $($allPolicies.Count) compliance policies" -ForegroundColor Gray

    $processedPolicies = @()
    $groupNameCache = @{}
    $allNonCompliantDevices = @{}

    foreach ($policy in $allPolicies) {
        try {
            # Get assignments for this policy
            $assignments = @()
            try {
                $assignmentResponse = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies/$($policy.id)/assignments" `
                    -OutputType PSObject

                foreach ($assignment in $assignmentResponse.value) {
                    $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -GroupPrefix "Group: " -ExcludePrefix "Exclude: "
                    $assignments += $target
                }
            }
            catch {
                Write-Warning "      Failed to get assignments for policy $($policy.displayName): $($_.Exception.Message)"
            }

            # Get device status summary for this policy
            $compliantCount = 0
            $nonCompliantCount = 0
            $errorCount = 0
            $conflictCount = 0
            $notApplicableCount = 0

            try {
                $statusSummary = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies/$($policy.id)/deviceStatusOverview" `
                    -OutputType PSObject

                # Handle null values from Graph API
                $compliantCount = if ($null -ne $statusSummary.compliantDeviceCount) { $statusSummary.compliantDeviceCount } else { 0 }
                $nonCompliantCount = if ($null -ne $statusSummary.nonCompliantDeviceCount) { $statusSummary.nonCompliantDeviceCount } else { 0 }
                $errorCount = if ($null -ne $statusSummary.errorDeviceCount) { $statusSummary.errorDeviceCount } else { 0 }
                $conflictCount = if ($null -ne $statusSummary.conflictDeviceCount) { $statusSummary.conflictDeviceCount } else { 0 }
                $notApplicableCount = if ($null -ne $statusSummary.notApplicableDeviceCount) { $statusSummary.notApplicableDeviceCount } else { 0 }
            }
            catch {
                Write-Warning "      Failed to get status overview for policy $($policy.displayName): $($_.Exception.Message)"
            }

            # Get non-compliant device details
            $deviceStatuses = @()
            if ($nonCompliantCount -gt 0 -or $errorCount -gt 0) {
                try {
                    $deviceStatusResponse = Invoke-MgGraphRequest -Method GET `
                        -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies/$($policy.id)/deviceStatuses?`$filter=status ne 'compliant'&`$top=100" `
                        -OutputType PSObject

                    foreach ($status in $deviceStatusResponse.value) {
                        $deviceStatuses += [PSCustomObject]@{
                            # Note: The deviceId from this API is the status record ID, not the Intune device ID
                            # The dashboard will need to look up devices by name for linking
                            deviceName = $status.deviceDisplayName
                            userName = $status.userName
                            status = $status.status
                            lastReportedDateTime = Format-IsoDate -DateValue $status.lastReportedDateTime
                            complianceGracePeriodExpirationDateTime = Format-IsoDate -DateValue $status.complianceGracePeriodExpirationDateTime
                        }

                        # Track unique non-compliant devices
                        if (-not $allNonCompliantDevices.ContainsKey($status.deviceDisplayName)) {
                            $allNonCompliantDevices[$status.deviceDisplayName] = @{
                                deviceName = $status.deviceDisplayName
                                userName = $status.userName
                                failedPolicies = @()
                            }
                        }
                        $allNonCompliantDevices[$status.deviceDisplayName].failedPolicies += $policy.displayName
                    }
                }
                catch {
                    Write-Warning "      Failed to get device statuses for policy $($policy.displayName): $($_.Exception.Message)"
                }
            }

            # Get setting-level compliance status
            $settingStatuses = @()
            try {
                $settingResponse = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies/$($policy.id)/deviceSettingStateSummaries" `
                    -OutputType PSObject

                foreach ($setting in $settingResponse.value) {
                    if ($setting.nonCompliantDeviceCount -gt 0 -or $setting.errorDeviceCount -gt 0) {
                        $settingStatuses += [PSCustomObject]@{
                            settingName = $setting.settingName
                            compliantDeviceCount = $setting.compliantDeviceCount
                            nonCompliantDeviceCount = $setting.nonCompliantDeviceCount
                            errorDeviceCount = $setting.errorDeviceCount
                            notApplicableDeviceCount = $setting.notApplicableDeviceCount
                            conflictDeviceCount = $setting.conflictDeviceCount
                        }

                        # Track setting failures globally
                        $complianceData.settingFailures += [PSCustomObject]@{
                            policyId = $policy.id
                            policyName = $policy.displayName
                            platform = (Get-PolicyPlatform -ODataType $policy.'@odata.type')
                            settingName = $setting.settingName
                            nonCompliantCount = $setting.nonCompliantDeviceCount
                            errorCount = $setting.errorDeviceCount
                        }
                    }
                }
            }
            catch {
                Write-Warning "      Failed to get setting summaries for policy $($policy.displayName): $($_.Exception.Message)"
            }

            # Determine policy category based on name/type
            $category = "General"
            $displayName = $policy.displayName.ToLower()
            if ($displayName -match "password|pin|passcode") { $category = "Password" }
            elseif ($displayName -match "encrypt|bitlocker|filevault") { $category = "Encryption" }
            elseif ($displayName -match "defender|antivirus|firewall|security") { $category = "Security" }
            elseif ($displayName -match "os|version|update") { $category = "OS Version" }
            elseif ($displayName -match "jailbreak|root") { $category = "Device Health" }

            # Determine if this is a critical policy (security-related or assigned to all devices)
            $isCritical = ($category -eq "Security" -or $category -eq "Encryption" -or
                          ($assignments | Where-Object { $_.type -eq "AllDevices" }).Count -gt 0)

            $totalDevices = $compliantCount + $nonCompliantCount + $errorCount + $conflictCount
            $complianceRate = if ($totalDevices -gt 0) {
                [Math]::Round(($compliantCount / $totalDevices) * 100, 1)
            } else { $null }

            # Build processed policy object
            $platform = Get-PolicyPlatform -ODataType $policy.'@odata.type'
            $processedPolicy = [PSCustomObject]@{
                id                   = $policy.id
                displayName          = $policy.displayName
                description          = $policy.description
                platform             = $platform
                category             = $category
                isCritical           = $isCritical
                odataType            = $policy.'@odata.type'
                createdDateTime      = Format-IsoDate -DateValue $policy.createdDateTime
                lastModifiedDateTime = Format-IsoDate -DateValue $policy.lastModifiedDateTime
                version              = $policy.version
                assignments          = $assignments
                assignmentCount      = $assignments.Count
                # Device status
                compliantDevices     = $compliantCount
                nonCompliantDevices  = $nonCompliantCount
                errorDevices         = $errorCount
                conflictDevices      = $conflictCount
                notApplicableDevices = $notApplicableCount
                totalDevices         = $totalDevices
                complianceRate       = $complianceRate
                # Detailed status
                deviceStatuses       = $deviceStatuses
                settingStatuses      = $settingStatuses
                # Health status
                hasIssues            = ($nonCompliantCount -gt 0 -or $errorCount -gt 0 -or $conflictCount -gt 0)
            }

            $processedPolicies += $processedPolicy
            $policyCount++

            # Update summary
            $complianceData.summary.totalDevices += $totalDevices
            $complianceData.summary.compliantDevices += $compliantCount
            $complianceData.summary.nonCompliantDevices += $nonCompliantCount
            $complianceData.summary.errorDevices += $errorCount
            if ($isCritical) { $complianceData.summary.criticalPolicies++ }
            if ($processedPolicy.hasIssues) { $complianceData.summary.policiesWithIssues++ }

            # Update platform breakdown
            if (-not $complianceData.summary.platformBreakdown.ContainsKey($platform)) {
                $complianceData.summary.platformBreakdown[$platform] = @{
                    policies = 0
                    compliant = 0
                    nonCompliant = 0
                }
            }
            $complianceData.summary.platformBreakdown[$platform].policies++
            $complianceData.summary.platformBreakdown[$platform].compliant += $compliantCount
            $complianceData.summary.platformBreakdown[$platform].nonCompliant += $nonCompliantCount

        }
        catch {
            $errors += "Error processing policy $($policy.displayName): $($_.Exception.Message)"
        }
    }

    # Sort by compliance rate (worst first)
    $processedPolicies = $processedPolicies | Sort-Object -Property @{
        Expression = { if ($null -eq $_.complianceRate) { 101 } else { $_.complianceRate } }
    }

    # Finalize data structure
    $complianceData.policies = $processedPolicies
    $complianceData.summary.totalPolicies = $processedPolicies.Count

    # Convert non-compliant devices hashtable to array
    foreach ($device in $allNonCompliantDevices.Values) {
        $complianceData.nonCompliantDevices += [PSCustomObject]@{
            deviceName = $device.deviceName
            userName = $device.userName
            failedPolicies = $device.failedPolicies
            failedPolicyCount = $device.failedPolicies.Count
        }
    }

    # Sort non-compliant devices by failed policy count (worst first)
    $complianceData.nonCompliantDevices = $complianceData.nonCompliantDevices |
        Sort-Object -Property failedPolicyCount -Descending

    # Calculate overall compliance rate
    if ($complianceData.summary.totalDevices -gt 0) {
        $complianceData.summary.overallComplianceRate = [Math]::Round(
            ($complianceData.summary.compliantDevices / $complianceData.summary.totalDevices) * 100, 1
        )
    }

    # Sort setting failures by non-compliant count
    $complianceData.settingFailures = $complianceData.settingFailures |
        Sort-Object -Property nonCompliantCount -Descending |
        Select-Object -First 20

    # ========================================
    # Generate Insights
    # ========================================

    # Insight: Policies with low compliance
    $lowCompliancePolicies = $processedPolicies | Where-Object { $_.complianceRate -lt 80 -and $_.complianceRate -ne $null }
    if ($lowCompliancePolicies.Count -gt 0) {
        $complianceData.insights += [PSCustomObject]@{
            id = "low-compliance-policies"
            severity = "high"
            description = "$($lowCompliancePolicies.Count) policies have compliance rate below 80%"
            impactedPolicies = $lowCompliancePolicies.Count
            affectedDevices = ($lowCompliancePolicies | Measure-Object -Property nonCompliantDevices -Sum).Sum
            recommendedAction = "Review non-compliant devices and remediate or adjust policy settings"
            category = "Compliance"
        }
    }

    # Insight: Critical policies with issues
    $criticalWithIssues = $processedPolicies | Where-Object { $_.isCritical -and $_.hasIssues }
    if ($criticalWithIssues.Count -gt 0) {
        $complianceData.insights += [PSCustomObject]@{
            id = "critical-policy-issues"
            severity = "critical"
            description = "$($criticalWithIssues.Count) critical security policies have non-compliant devices"
            impactedPolicies = $criticalWithIssues.Count
            affectedDevices = ($criticalWithIssues | Measure-Object -Property nonCompliantDevices -Sum).Sum
            recommendedAction = "Prioritize remediation of security and encryption policy failures"
            category = "Security"
        }
    }

    # Insight: Devices failing multiple policies
    $multiFailDevices = $complianceData.nonCompliantDevices | Where-Object { $_.failedPolicyCount -gt 2 }
    if ($multiFailDevices.Count -gt 0) {
        $complianceData.insights += [PSCustomObject]@{
            id = "multi-policy-failures"
            severity = "high"
            description = "$($multiFailDevices.Count) devices are failing 3 or more compliance policies"
            impactedDevices = $multiFailDevices.Count
            recommendedAction = "Investigate these devices for systemic issues or consider device refresh"
            category = "Device Health"
        }
    }

    # Insight: Common setting failures
    $topFailingSetting = $complianceData.settingFailures | Select-Object -First 1
    if ($topFailingSetting -and $topFailingSetting.nonCompliantCount -gt 10) {
        $complianceData.insights += [PSCustomObject]@{
            id = "common-setting-failure"
            severity = "medium"
            description = "Setting '$($topFailingSetting.settingName)' is failing on $($topFailingSetting.nonCompliantCount) devices"
            impactedDevices = $topFailingSetting.nonCompliantCount
            recommendedAction = "Review if this setting requirement is appropriate or needs user communication"
            category = "Settings"
        }
    }

    # Insight: Policies with errors
    $policiesWithErrors = $processedPolicies | Where-Object { $_.errorDevices -gt 0 }
    if ($policiesWithErrors.Count -gt 0) {
        $totalErrors = ($policiesWithErrors | Measure-Object -Property errorDevices -Sum).Sum
        $complianceData.insights += [PSCustomObject]@{
            id = "policy-errors"
            severity = "medium"
            description = "$totalErrors devices have errors evaluating $($policiesWithErrors.Count) policies"
            impactedPolicies = $policiesWithErrors.Count
            impactedDevices = $totalErrors
            recommendedAction = "Check device connectivity and policy configuration for errors"
            category = "Errors"
        }
    }

    Write-Host "      Generated $($complianceData.insights.Count) compliance insights" -ForegroundColor Gray

    # Add collection date
    $complianceData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $complianceData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $policyCount compliance policies" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $policyCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "Intune|license|subscription|permission|forbidden|Authorization") {
        Write-Host "    [!] Compliance policy collection requires Intune license and DeviceManagementConfiguration.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        policies = @()
        nonCompliantDevices = @()
        settingFailures = @()
        insights = @()
        summary = @{}
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
