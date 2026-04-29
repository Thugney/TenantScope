# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Samler Intune konfigurasjonsprofiler og utrullingsstatus.

.DESCRIPTION
    Retrieves all device configuration profiles from Microsoft Intune including
    endpoint security profiles, settings catalogs, and administrative templates.
    Shows assignment status and deployment success/failure rates.

    Graph API endpoints:
    - GET beta /deviceManagement/configurationPolicies (Settings Catalog and newer policies)
    - GET v1.0 /deviceManagement/deviceConfigurations (legacy/template profiles)
    - POST beta/v1.0 /deviceManagement/reports/getCachedReport
    - Fallback: GET /deviceManagement/deviceConfigurations/{id}/deviceStatusOverview

    Required scopes:
    - DeviceManagementConfiguration.Read.All
    - DeviceManagementManagedDevices.Read.All only when device correlation is needed
    - DeviceManagementEndpointSecurity.Read.All only when endpoint security report families are available

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

$script:LocalLogFile = Join-Path "C:\MK-LogFiles" "Get-ConfigurationProfiles.log"

function Write-Log {
    <#
    .SYNOPSIS
        Skriver logglinje for konfigurasjonsprofil-innsamling.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Message,

        [Parameter()]
        [ValidateSet("Info", "Warning", "Error", "Debug")]
        [string]$Level = "Info"
    )

    try {
        $logDir = Split-Path -Path $script:LocalLogFile -Parent
        if (-not (Test-Path -LiteralPath $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        $entry = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
        Add-Content -LiteralPath $script:LocalLogFile -Value $entry -Encoding UTF8
    }
    catch {
        # Logging must never break collection.
    }
}

function Get-ProfileType {
    <#
    .SYNOPSIS
        Determines the profile type from @odata.type.
    #>
    param([string]$ODataType)

    switch -Regex ($ODataType) {
        "windows10EndpointProtection"      { return "Endpoint Protections" }
        "windows10General"                 { return "Device Restriction" }
        "windows10Custom"                  { return "Custom Policies" }
        "windowsHealthMonitoring"          { return "Windows Health Monitoring" }
        "windowsIdentityProtection"        { return "Identity Protection" }
        "windowsKiosk"                     { return "Kiosk" }
        "windows10VpnConfiguration"        { return "VPN Policies" }
        "windowsWifiConfiguration"         { return "Wi-Fi" }
        "windows10Compliance"              { return "Compliance" }
        "windowsUpdateForBusiness"         { return "Windows Update" }
        "windowsDeliveryOptimization"      { return "Delivery Optimization" }
        "windows10SecureAssessment"        { return "Secure Assessment" }
        "windows10PkcsCertificate"         { return "PKCS Certificate" }
        "windows10ImportedPFX"             { return "PFX Certificate" }
        "windows10TrustedRoot"             { return "Trusted Certificate" }
        "windows10ScepCertificate"         { return "SCEP Certificate" }
        "deviceFirmwareConfiguration"      { return "Device firmware configurations" }
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

function ConvertTo-IntunePolicyCategory {
    <#
    .SYNOPSIS
        Normaliserer Intune profiltype til dashboard-kategori.
    #>
    param(
        [string]$Source,
        [string]$ODataType,
        [string]$TemplateFamily,
        [string]$TemplateDisplayName,
        [string]$FallbackType
    )

    $combined = "$ODataType $TemplateFamily $TemplateDisplayName $FallbackType"

    if ($Source -eq "configurationPolicies") {
        switch -Regex ($combined) {
            "endpointSecurityAntivirus|antivirus" { return "Endpoint Security - Antivirus" }
            "endpointSecurityFirewall|firewall" { return "Endpoint Security - Firewall" }
            "attackSurfaceReduction|asr" { return "Endpoint Security - Attack Surface Reduction" }
            "endpointDetection|edr" { return "Endpoint Security - Endpoint Detection and Response" }
            "appControl|applicationControl" { return "Endpoint Security - App Control" }
            "administrative|admx" { return "Administrative Templates" }
            default { return "Settings Catalog" }
        }
    }

    switch -Regex ($combined) {
        "windows10Custom|custom" { return "Custom Policies" }
        "EndpointProtection|endpointProtection" { return "Endpoint Protections" }
        "DeviceFeatures|iosDeviceFeatures|device.*feature" { return "Device Feature" }
        "windows10General|deviceRestriction|restriction" { return "Device Restriction" }
        "microsoftDefender|defenderForEndpoint|advancedThreatProtection" { return "Microsoft Defender for Endpoint" }
        "firmware" { return "Device firmware configurations" }
        "Vpn|vpn" { return "VPN Policies" }
        "Wi.?Fi|wifi" { return "Wi-Fi" }
        "TrustedRoot|trusted.*certificate" { return "Trusted Certificate" }
        "Scep|scep" { return "SCEP Certificate" }
        "HealthMonitoring|health.*monitoring" { return "Windows Health Monitoring" }
        "administrative|admx|groupPolicy" { return "Administrative Templates" }
        default {
            if ($FallbackType) { return $FallbackType }
            return "Unknown / Unclassified"
        }
    }
}

function ConvertTo-StatusBucket {
    <#
    .SYNOPSIS
        Mapper ra Intune-status til normalisert statusfelt.
    #>
    param($Status)

    if ($null -eq $Status) { return $null }
    $value = $Status.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }

    switch -Regex ($value) {
        "^(compliant|success|succeeded)$" { return "success" }
        "^(error|failed|noncompliant|nonCompliant)$" { return "errors" }
        "^conflict" { return "conflicts" }
        "^(pending|unknown|inProgress|in progress)$" { return "pending" }
        "^notApplicable$" { return "notApplicable" }
        "^notAssigned$" { return "notAssigned" }
        default { return $null }
    }
}

function New-StatusCounts {
    <#
    .SYNOPSIS
        Lager tom statusstruktur.
    #>
    return [ordered]@{
        success = 0
        errors = 0
        conflicts = 0
        pending = 0
        notApplicable = 0
        total = 0
        successRate = $null
    }
}

function Complete-StatusCounts {
    <#
    .SYNOPSIS
        Fullforer statusstruktur med total og suksessrate.
    #>
    param([System.Collections.IDictionary]$Status)

    $Status.total = [int]$Status.success + [int]$Status.errors + [int]$Status.conflicts + [int]$Status.pending + [int]$Status.notApplicable
    $Status.successRate = if ($Status.total -gt 0) {
        [Math]::Round(([double]$Status.success / [double]$Status.total) * 100, 1)
    } else { $null }
    return $Status
}

function Add-StatusCountsFromRow {
    <#
    .SYNOPSIS
        Legger en rapport-rad inn i normaliserte statustall.
    #>
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Status,
        [Parameter(Mandatory)]$Row
    )

    $knownCountColumns = $false
    $countColumnMap = @{
        success = @("NumberOfCompliantDevices", "CompliantDeviceCount", "compliantDeviceCount", "successDeviceCount", "successCount", "SuccessCount", "succeededCount")
        errors = @("NumberOfErrorDevices", "ErrorDeviceCount", "errorDeviceCount", "errorCount", "ErrorCount", "failedCount", "NonCompliantDeviceCount", "nonCompliantDeviceCount")
        conflicts = @("NumberOfConflictDevices", "ConflictDeviceCount", "conflictDeviceCount", "conflictCount", "ConflictCount")
        pending = @("NumberOfInProgressDevices", "PendingDeviceCount", "pendingDeviceCount", "pendingCount", "PendingCount", "unknownCount", "inProgressCount")
        notApplicable = @("NumberOfNotApplicableDevices", "NotApplicableDeviceCount", "notApplicableDeviceCount", "notApplicableCount", "NotApplicableCount")
    }

    foreach ($bucket in $countColumnMap.Keys) {
        $value = Get-ReportValue -Row $Row -Names $countColumnMap[$bucket]
        if ($null -ne $value -and $value -ne "") {
            $Status[$bucket] = [int]$Status[$bucket] + [int]$value
            $knownCountColumns = $true
        }
    }

    if ($knownCountColumns) { return }

    $rawStatus = Get-ReportValue -Row $Row -Names @("PolicyStatus", "AssignmentStatus", "Status", "status", "DeviceStatus", "ComplianceStatus")
    $bucketName = ConvertTo-StatusBucket -Status $rawStatus
    if ($bucketName -and $bucketName -ne "notAssigned") {
        $rowCount = Get-ReportValue -Row $Row -Names @("Count", "DeviceCount", "deviceCount", "Total", "total")
        if ($null -eq $rowCount -or $rowCount -eq "") { $rowCount = 1 }
        $Status[$bucketName] = [int]$Status[$bucketName] + [int]$rowCount
    }
}

function Invoke-IntuneCachedReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ReportId,

        [Parameter()]
        [string[]]$Select = @(),

        [Parameter()]
        [string]$Filter
    )

    $body = @{
        id = $ReportId
        skip = 0
        top = 5000
    }
    if ($Select -and $Select.Count -gt 0) { $body.select = $Select }
    if ($Filter) { $body.filter = $Filter }

    $bodyJson = $body | ConvertTo-Json -Depth 8
    $endpoints = @(
        "https://graph.microsoft.com/beta/deviceManagement/reports/getCachedReport",
        "https://graph.microsoft.com/v1.0/deviceManagement/reports/getCachedReport"
    )

    foreach ($endpoint in $endpoints) {
        try {
            $report = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method POST -Uri $endpoint -Body $bodyJson -ContentType "application/json" -OutputType PSObject
            } -OperationName "Cached Intune report ($ReportId)" -MaxRetries 2

            $rows = @(Convert-ReportRows -Report $report)
            if ($rows.Count -gt 0) {
                return [PSCustomObject]@{
                    reportId = $ReportId
                    endpoint = $endpoint
                    rows = $rows
                    rawSample = @($rows | Select-Object -First 3)
                }
            }
        }
        catch {
            Write-Log -Level Warning -Message "Cached report $ReportId failed at $endpoint`: $($_.Exception.Message)"
        }
    }

    return $null
}

function Get-ConfigurationPolicyReportMap {
    <#
    .SYNOPSIS
        Henter Intune policy status fra rapport-API.
    #>
    param(
        [Parameter()]
        [string]$EvidencePath
    )

    $map = @{}
    $evidence = [ordered]@{
        collectedUtc = (Get-Date).ToUniversalTime().ToString("o")
        reports = @()
        warnings = @()
    }

    $reportIds = @(
        "ConfigurationPolicyAggregate",
        "ConfigurationPolicyAggregateV3",
        "ConfigurationPolicyDeviceAggregates",
        "ConfigurationPolicyDeviceAggregatesV3",
        "DeviceAssignmentStatusByConfigurationPolicy",
        "DeviceAssignmentStatusByConfigurationPolicyV3",
        "DeviceAssignmentStatusByConfigurationPolicyForASR",
        "DeviceAssignmentStatusByConfigurationPolicyForEDR",
        "DeviceAssignmentStatusByConfigurationPolicyForAC",
        "DeviceStatusesByConfigurationProfile",
        "DeviceStatusesByConfigurationProfileV3",
        "DeviceStatusesByConfigurationProfileForASR",
        "DeviceStatusesByConfigurationProfileForEDR",
        "DeviceStatusesByConfigurationProfileForAppControl",
        "DeviceStatusesByConfigurationProfileWithPF",
        "DeviceStatusesByConfigurationProfileWithPFV3"
    )

    $select = @(
        "PolicyId", "policyId", "Id", "id", "PolicyName", "policyName", "ProfileId", "profileId",
        "ProfileSource", "PolicyBaseTypeName", "UnifiedPolicyType", "PolicyPlatformType", "UnifiedPolicyPlatformType",
        "NumberOfCompliantDevices", "NumberOfErrorDevices", "NumberOfConflictDevices", "NumberOfInProgressDevices",
        "NumberOfNotApplicableDevices", "CompliantDeviceCount", "ErrorDeviceCount", "ConflictDeviceCount",
        "PendingDeviceCount", "NotApplicableDeviceCount", "PolicyStatus", "AssignmentStatus", "Status", "DeviceCount", "Count"
    )

    foreach ($reportId in $reportIds) {
        $report = Invoke-IntuneCachedReport -ReportId $reportId -Select $select
        if (-not $report) {
            $evidence.warnings += "Report $reportId returned no rows or was unavailable."
            continue
        }

        $rows = @($report.rows)
        $evidence.reports += [PSCustomObject]@{
            reportId = $report.reportId
            endpoint = $report.endpoint
            rawRows = $rows.Count
            rawSample = $report.rawSample
        }

        foreach ($row in $rows) {
            $id = Get-ReportValue -Row $row -Names @("PolicyId", "policyId", "ProfileId", "profileId", "Id", "id")
            if (-not $id) { continue }
            $key = [string]$id

            if (-not $map.ContainsKey($key)) {
                $map[$key] = [ordered]@{
                    status = New-StatusCounts
                    statusSource = "reports/getCachedReport"
                    reportId = $reportId
                    rawRows = 0
                    rawSamples = @()
                    policyBaseTypeName = Get-ReportValue -Row $row -Names @("PolicyBaseTypeName", "policyBaseTypeName", "ProfileSource")
                    unifiedPolicyType = Get-ReportValue -Row $row -Names @("UnifiedPolicyType", "unifiedPolicyType", "PolicyType")
                }
            }

            Add-StatusCountsFromRow -Status $map[$key].status -Row $row
            $map[$key].rawRows++
            if ($map[$key].rawSamples.Count -lt 5) {
                $map[$key].rawSamples += $row
            }
        }

        Write-Host "      Cached report $reportId returned $($rows.Count) rows" -ForegroundColor Gray
        Write-Log -Message "Cached report $reportId returned $($rows.Count) rows"
    }

    foreach ($key in @($map.Keys)) {
        $map[$key].status = Complete-StatusCounts -Status $map[$key].status
    }

    if ($EvidencePath) {
        try {
            $evidence.summary = [PSCustomObject]@{
                mappedPolicies = $map.Count
                reportCount = $evidence.reports.Count
            }
            $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
        }
        catch {
            Write-Log -Level Warning -Message "Could not write Intune policy evidence file: $($_.Exception.Message)"
        }
    }

    if ($map.Count -eq 0) {
        Write-Host "      Cached Intune reports returned no policy status rows - using limited fallback endpoints" -ForegroundColor Yellow
        Write-Log -Level Warning -Message "Cached Intune reports returned no policy status rows"
    }

    return $map
}

function Get-ConfigurationPolicyAssignmentFailures {
    <#
    .SYNOPSIS
        Retrieves device-level configuration policy assignment rows from Intune reports.
    #>
    $reportNames = @(
        "ConfigurationPolicyDevices",
        "ConfigurationPolicyDeviceStatus",
        "ConfigurationPolicyDeviceStatusV3",
        "ConfigurationPolicyNonComplianceReport"
    )

    $select = @(
        "PolicyId", "PolicyName", "DeviceName", "IntuneDeviceId", "DeviceId",
        "UPN", "UserPrincipalName", "UserName", "AssignmentStatus", "PolicyStatus", "Status"
    )

    foreach ($reportName in $reportNames) {
        $rows = Invoke-IntuneExportReport -ReportName $reportName -Select $select
        if ($rows -and $rows.Count -gt 0) {
            Write-Host "      Assignment failure fallback returned $($rows.Count) rows (source: $reportName)" -ForegroundColor Gray
            return @($rows)
        }
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
    $maxAttempts = 10
    $delaySeconds = 2

    for ($i = 0; $i -lt $maxAttempts; $i++) {
        try {
            $statusResp = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $statusUri -OutputType PSObject
            } -OperationName "Export report status ($ReportName)" -MaxRetries 1

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
    Write-Log -Message "Starting configuration profile collection"

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
            notApplicableDevices = 0
            overallSuccessRate = 0
            profilesWithErrors = 0
            profilesWithConflicts = 0
            platformBreakdown = @{}
            typeBreakdown = @{}
            policiesWithStatusData = 0
            policiesMissingStatusData = 0
            policiesWithWarnings = 0
        }
    }

    $allProfiles = New-Object System.Collections.ArrayList
    $allFailedDevices = @{}
    $evidencePath = Join-Path (Split-Path -Path $OutputPath -Parent) "configuration-profiles-status-evidence.json"

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

        foreach ($legacyConfig in $legacyConfigs) {
            try {
                $wrapper = [PSCustomObject]@{
                    source = "deviceConfigurations"
                    data = $legacyConfig
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
    $enableStatusReports = -not ($Config.collection -is [hashtable] -and $Config.collection.ContainsKey("enableIntunePolicyStatusReports") -and $Config.collection.enableIntunePolicyStatusReports -eq $false)
    $policyReportMap = if ($enableStatusReports) {
        Get-ConfigurationPolicyReportMap -EvidencePath $evidencePath
    } else {
        Write-Host "      Intune policy status report collection disabled by config." -ForegroundColor Yellow
        Write-Log -Level Warning -Message "Intune policy status report collection disabled by config"
        @{}
    }

    # Build a cache for group names
    $groupNameCache = @{}

    # Throttle control: limit detailed API calls to avoid 429s
    $deepCollection = ($Config.collection -is [hashtable] -and $Config.collection.deepCollection -eq $true)
    $overviewFetchLimit = if ($deepCollection) { 150 } else { 50 }
    $detailedStatusLimit = if ($deepCollection) { 30 } else { 10 }  # Fetch detailed status for first N profiles with errors/conflicts
    $detailedStatusCount = 0
    $assignmentFetchLimit = if ($deepCollection) { 60 } else { 25 }
    $assignmentFetchCount = 0
    $apiCallCount = 0
    $throttleDelay = 200  # ms between API-heavy operations (increased to prevent throttling)
    if ($Config.thresholds -is [hashtable]) {
        if ($Config.thresholds.ContainsKey('maxConfigurationProfileOverviews')) { $overviewFetchLimit = [int]$Config.thresholds.maxConfigurationProfileOverviews }
        if ($Config.thresholds.ContainsKey('maxConfigurationProfileDetails')) { $detailedStatusLimit = [int]$Config.thresholds.maxConfigurationProfileDetails }
        if ($Config.thresholds.ContainsKey('maxConfigurationProfileAssignments')) { $assignmentFetchLimit = [int]$Config.thresholds.maxConfigurationProfileAssignments }
    }
    $overviewBatchMap = @{}
    $assignmentBatchMap = @{}
    $overviewBatchResults = @{}
    $assignmentBatchResults = @{}

    $overviewTargets = @($allProfiles | Where-Object { $_.source -eq "deviceConfigurations" } | Select-Object -First $overviewFetchLimit)
    $overviewRequests = @()
    $requestIndex = 0
    foreach ($overviewItem in $overviewTargets) {
        if (-not $overviewItem.data.id) { continue }
        $requestIndex++
        $requestId = "profileOverview$requestIndex"
        $overviewBatchMap[[string]$overviewItem.data.id] = $requestId
        $overviewRequests += [PSCustomObject]@{
            id  = $requestId
            uri = "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($overviewItem.data.id)/deviceStatusOverview"
        }
    }

    if ($overviewRequests.Count -gt 0) {
        Write-Host "      Fetching configuration overview data in Graph batches ($($overviewRequests.Count) profiles)..." -ForegroundColor Gray
        $overviewBatchResults = Invoke-GraphBatchGet -Requests $overviewRequests -OperationName "Configuration profile overview batch"
    }

    $assignmentTargets = @($allProfiles | Select-Object -First $assignmentFetchLimit)
    $assignmentRequests = @()
    $requestIndex = 0
    foreach ($assignmentItem in $assignmentTargets) {
        if (-not $assignmentItem.data.id) { continue }
        $requestIndex++
        $requestId = "profileAssignments$requestIndex"
        $assignmentBatchMap[[string]$assignmentItem.data.id] = $requestId
        $assignmentUri = if ($assignmentItem.source -eq "deviceConfigurations") {
            "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($assignmentItem.data.id)/assignments"
        } else {
            "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($assignmentItem.data.id)/assignments"
        }

        $assignmentRequests += [PSCustomObject]@{
            id  = $requestId
            uri = $assignmentUri
        }
    }

    if ($assignmentRequests.Count -gt 0) {
        Write-Host "      Fetching configuration assignments in Graph batches ($($assignmentRequests.Count) profiles)..." -ForegroundColor Gray
        $assignmentBatchResults = Invoke-GraphBatchGet -Requests $assignmentRequests -OperationName "Configuration profile assignments batch"
        $assignmentFetchCount = $assignmentRequests.Count
    }

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
            $statusAvailable = $false
            $statusSource = $null
            $statusEvidence = [ordered]@{
                reportId = $null
                rawRows = 0
                lastCollectedUtc = (Get-Date).ToUniversalTime().ToString("o")
            }
            $collectionWarnings = @()
            $policyBaseTypeName = $profile.'@odata.type'
            $unifiedPolicyType = $null
            $deviceStatusList = @()
            $hasIssues = $false

            # For Settings Catalog, prefer report data to avoid extra API calls
            if ($profile.id -and $policyReportMap.ContainsKey([string]$profile.id)) {
                $reportStatus = $policyReportMap[[string]$profile.id]
                $successCount = [int]$reportStatus.status.success
                $errorCount = [int]$reportStatus.status.errors
                $conflictCount = [int]$reportStatus.status.conflicts
                $pendingCount = [int]$reportStatus.status.pending
                $notApplicableCount = [int]$reportStatus.status.notApplicable
                $usedStatusFallback = $true
                $statusAvailable = $true
                $statusSource = $reportStatus.statusSource
                $statusEvidence.reportId = $reportStatus.reportId
                $statusEvidence.rawRows = $reportStatus.rawRows
                if ($reportStatus.policyBaseTypeName) { $policyBaseTypeName = $reportStatus.policyBaseTypeName }
                if ($reportStatus.unifiedPolicyType) { $unifiedPolicyType = $reportStatus.unifiedPolicyType }
            }
            elseif ($profileCount -lt $overviewFetchLimit) {
                # Only fetch status overview if we don't have report data and haven't hit limit
                try {
                    $apiCallCount++
                    if ($apiCallCount % 10 -eq 0) {
                        Start-Sleep -Milliseconds $throttleDelay
                    }

                    if ($source -eq "deviceConfigurations") {
                        $statusOverview = $null
                        $overviewRequestId = $overviewBatchMap[[string]$profile.id]
                        if ($overviewRequestId -and $overviewBatchResults.ContainsKey($overviewRequestId) -and $overviewBatchResults[$overviewRequestId].status -ge 200 -and $overviewBatchResults[$overviewRequestId].status -lt 300) {
                            $statusOverview = $overviewBatchResults[$overviewRequestId].body
                        }
                        elseif ($deepCollection) {
                            $statusOverview = Invoke-MgGraphRequest -Method GET `
                                -Uri "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/$($profile.id)/deviceStatusOverview" `
                                -OutputType PSObject
                        }

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
                        if ($statusOverview) {
                            $statusAvailable = $true
                            $statusSource = "deviceStatusOverview"
                        }
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
                                    switch (ConvertTo-StatusBucket -Status $statusVal) {
                                        "success" { $successCount++ }
                                        "errors" { $errorCount++ }
                                        "conflicts" { $conflictCount++ }
                                        "pending" { $pendingCount++ }
                                        "notApplicable" { $notApplicableCount++ }
                                    }
                                }
                                $statusAvailable = $true
                                $statusSource = "getConfigurationPolicyDevicesReport"
                                $statusEvidence.reportId = "DeviceAssignment"
                                $statusEvidence.rawRows = @($policyReport.Values).Count
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
                                        switch (ConvertTo-StatusBucket -Status $s.status) {
                                            "success" { $successCount++ }
                                            "errors" { $errorCount++ }
                                            "conflicts" { $conflictCount++ }
                                            "pending" { $pendingCount++ }
                                            "notApplicable" { $notApplicableCount++ }
                                        }
                                    }
                                    $statusAvailable = $true
                                    $statusSource = "deviceStatuses"
                                    $statusEvidence.rawRows = @($statuses.value).Count
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

            $hasIssues = ($errorCount -gt 0 -or $conflictCount -gt 0)
            $canFetchAssignments = ($assignmentFetchCount -lt $assignmentFetchLimit)
            $canFetchDetails = ($detailedStatusCount -lt $detailedStatusLimit)
            $didFetchDetails = $false

            if (-not $statusAvailable) {
                $statusSource = "missing"
                $collectionWarnings += "No Intune policy status report or fallback status data was returned for this policy."
            }

            # Get assignments for this profile (only for first N profiles to reduce API calls)
            $assignments = @()
            $assignmentRequestId = $assignmentBatchMap[[string]$profile.id]
            if ($assignmentRequestId -and $assignmentBatchResults.ContainsKey($assignmentRequestId)) {
                $assignmentResult = $assignmentBatchResults[$assignmentRequestId]
                if ($assignmentResult.status -ge 200 -and $assignmentResult.status -lt 300) {
                    foreach ($assignment in @($assignmentResult.body.value)) {
                        $target = Resolve-AssignmentTarget -Assignment $assignment -GroupNameCache $groupNameCache -ExcludeSuffix " (Excluded)"
                        $assignments += $target
                    }
                }
            }
            elseif ($canFetchAssignments -and $deepCollection) {
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

            if ($hasIssues -and $canFetchDetails) {
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
                    $didFetchDetails = $true
                }
                catch {
                    # Silently continue
                }
            }

            # Get setting-level failures for this profile (only for deviceConfigurations within limit)
            $settingStatuses = @()
            $profileDisplayName = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unknown" }

            if ($source -eq "deviceConfigurations" -and $hasIssues -and $canFetchDetails) {
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
                    $didFetchDetails = $true
                }
                catch {
                    # Silently continue
                }
            }

            if ($didFetchDetails) {
                $detailedStatusCount++
            }

            $totalDevices = $successCount + $errorCount + $conflictCount + $pendingCount + $notApplicableCount
            $successRate = if ($totalDevices -gt 0) {
                [Math]::Round(($successCount / $totalDevices) * 100, 1)
            } else { $null }

            $templateFamily = $null
            $templateDisplayName = $null
            $templateDisplayVersion = $null
            if ($profile.templateReference) {
                $templateFamily = $profile.templateReference.templateFamily
                $templateDisplayName = $profile.templateReference.templateDisplayName
                $templateDisplayVersion = $profile.templateReference.templateDisplayVersion
            }

            $category = ConvertTo-IntunePolicyCategory `
                -Source $source `
                -ODataType $profile.'@odata.type' `
                -TemplateFamily $templateFamily `
                -TemplateDisplayName $templateDisplayName `
                -FallbackType $profileType

            # Get display name (Settings Catalog uses 'name', legacy uses 'displayName')
            $displayName = if ($profile.displayName) { $profile.displayName } elseif ($profile.name) { $profile.name } else { "Unnamed Profile" }
            $isAssigned = if ($null -ne $profile.isAssigned) { [bool]$profile.isAssigned } else { $assignments.Count -gt 0 }
            $normalizedStatus = [ordered]@{
                success = $successCount
                errors = $errorCount
                conflicts = $conflictCount
                pending = $pendingCount
                notApplicable = $notApplicableCount
                total = $totalDevices
                successRate = $successRate
            }
            $legacySuccess = if ($statusAvailable) { $successCount } else { $null }
            $legacyErrors = if ($statusAvailable) { $errorCount } else { $null }
            $legacyConflicts = if ($statusAvailable) { $conflictCount } else { $null }
            $legacyPending = if ($statusAvailable) { $pendingCount } else { $null }
            $legacyNotApplicable = if ($statusAvailable) { $notApplicableCount } else { $null }
            $legacyTotal = if ($statusAvailable) { $totalDevices } else { $null }

            # Build processed profile object
            $processedProfile = [PSCustomObject]@{
                id                   = $profile.id
                displayName          = $displayName
                type                 = $profileType
                description          = $profile.description
                profileType          = $profileType
                platform             = $platform
                category             = $category
                source               = $source
                policyBaseTypeName   = $policyBaseTypeName
                unifiedPolicyType    = $unifiedPolicyType
                templateFamily       = $templateFamily
                templateDisplayName  = $templateDisplayName
                templateDisplayVersion = $templateDisplayVersion
                settingCount         = $profile.settingCount
                technologies         = $profile.technologies
                roleScopeTagIds      = $profile.roleScopeTagIds
                isAssigned           = $isAssigned
                createdDateTime      = Format-IsoDate -DateValue $profile.createdDateTime
                lastModifiedDateTime = Format-IsoDate -DateValue $profile.lastModifiedDateTime
                version              = $profile.version
                # Assignments
                assignments          = $assignments
                assignmentCount      = $assignments.Count
                # Deployment status
                successDevices       = $legacySuccess
                errorDevices         = $legacyErrors
                conflictDevices      = $legacyConflicts
                pendingDevices       = $legacyPending
                notApplicableDevices = $legacyNotApplicable
                totalDevices         = $legacyTotal
                successRate          = $successRate
                statusSource         = $statusSource
                statusAvailable      = $statusAvailable
                status               = $normalizedStatus
                rawStatusEvidence    = $statusEvidence
                collectionWarnings   = $collectionWarnings
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
            $profileData.summary.notApplicableDevices += $notApplicableCount
            if ($errorCount -gt 0) { $profileData.summary.profilesWithErrors++ }
            if ($conflictCount -gt 0) { $profileData.summary.profilesWithConflicts++ }
            if ($statusAvailable) { $profileData.summary.policiesWithStatusData++ } else { $profileData.summary.policiesMissingStatusData++ }
            if ($collectionWarnings.Count -gt 0) { $profileData.summary.policiesWithWarnings++ }

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

    # If we have errors/conflicts but no failed device details, use assignment status report export
    if (($profileData.summary.errorDevices -gt 0 -or $profileData.summary.conflictDevices -gt 0) -and $allFailedDevices.Count -eq 0) {
        Write-Host "      No failed device details collected - using assignment status report export..." -ForegroundColor Yellow
        $assignmentFailures = Get-ConfigurationPolicyAssignmentFailures
        foreach ($row in $assignmentFailures) {
            $deviceName = Get-ReportValue -Row $row -Names @("DeviceName","deviceName")
            $upn = Get-ReportValue -Row $row -Names @("UPN","UserPrincipalName","userPrincipalName","UserName","userName")
            $policyName = Get-ReportValue -Row $row -Names @("PolicyName","policyName")
            $status = Get-ReportValue -Row $row -Names @("AssignmentStatus","PolicyStatus","Status","status")
            $deviceId = Get-ReportValue -Row $row -Names @("IntuneDeviceId","DeviceId","deviceId")

            $statusText = if ($status) { $status.ToString().ToLowerInvariant() } else { "" }
            if ($statusText -notmatch "error|conflict") { continue }

            $deviceKey = if ($deviceName) { $deviceName } elseif ($deviceId) { $deviceId } else { continue }

            if (-not $allFailedDevices.ContainsKey($deviceKey)) {
                $allFailedDevices[$deviceKey] = @{
                    deviceName = $deviceName
                    userName = $upn
                    failedProfiles = @()
                    errorCount = 0
                    conflictCount = 0
                }
            }

            if ($policyName -and ($allFailedDevices[$deviceKey].failedProfiles -notcontains $policyName)) {
                $allFailedDevices[$deviceKey].failedProfiles += $policyName
            }
            if ($statusText -match "error") { $allFailedDevices[$deviceKey].errorCount++ }
            if ($statusText -match "conflict") { $allFailedDevices[$deviceKey].conflictCount++ }
        }
    }

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

