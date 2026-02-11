# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Microsoft Defender for Endpoint device health and sensor status.

.DESCRIPTION
    Retrieves device health signals from Defender for Endpoint (MDE) API:
    onboarding status, sensor health, tamper protection, AV mode,
    signature age, and EDR block mode status. Produces a gap-ready list
    for endpoint/security teams.

    API endpoints:
    - GET https://api.securitycenter.microsoft.com/api/machines
    - GET https://api.securitycenter.microsoft.com/api/machines/{id}

    Required permissions (MDE API):
    - Machine.Read.All

    Note: This collector requires Defender API authentication, which is separate
    from Microsoft Graph authentication.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes defender-device-health.json to the specified output path.
#>

#Requires -Version 7.0

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
. "$PSScriptRoot\..\lib\DefenderApi.ps1"

# ============================================================================
# LOCAL HELPERS
# ============================================================================

function Invoke-DefenderApiRequest {
    <#
    .SYNOPSIS
        Makes a REST request to the Defender API with proper authentication.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter()]
        [string]$Method = "GET",

        [Parameter()]
        [int]$MaxRetries = 3
    )

    $token = Get-DefenderApiToken
    if (-not $token) {
        throw "Not connected to Defender API"
    }

    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
        }
        catch {
            $statusCode = $_.Exception.Response.StatusCode.value__

            if ($statusCode -in @(429, 500, 502, 503, 504)) {
                $attempt++
                if ($attempt -gt $MaxRetries) {
                    throw "Max retries exceeded"
                }
                $waitSeconds = [Math]::Pow(2, $attempt) * 10
                Write-Host "      Defender API error ($statusCode). Waiting ${waitSeconds}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $waitSeconds
            }
            else {
                throw
            }
        }
    }
}

function Get-MdeAllPages {
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [string]$OperationName
    )

    $results = @()
    $response = Invoke-DefenderApiRequest -Uri $Uri

    if ($response.value) {
        $results += $response.value
    }

    while ($response.'@odata.nextLink') {
        $response = Invoke-DefenderApiRequest -Uri $response.'@odata.nextLink'

        if ($response.value) {
            $results += $response.value
        }
    }

    return $results
}

function Normalize-Status {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $null }
    return $Value.ToString().Trim()
}

function Is-HealthyState {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $false }
    $v = $Value.ToString().ToLowerInvariant()
    return $v -in @("active", "healthy", "good", "ok", "enabled")
}

function Is-Onboarded {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $false }
    $v = $Value.ToString().ToLowerInvariant()
    return ($v -match "onboard") -and ($v -notmatch "off")
}

function Is-EnabledFlag {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $false }
    if ($Value -is [bool]) { return [bool]$Value }
    $v = $Value.ToString().ToLowerInvariant()
    return $v -in @("true", "enabled", "on", "yes", "active")
}

function Is-AvActive {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $false }
    $v = $Value.ToString().ToLowerInvariant()
    return $v -in @("active", "normal", "enabled")
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$apiBase = "https://api.securitycenter.microsoft.com"
$signatureAgeThreshold = if ($Config.thresholds -and $Config.thresholds.signatureAgeDays) {
    [int]$Config.thresholds.signatureAgeDays
} else {
    7
}
$sensorStaleThreshold = if ($Config.thresholds -and $Config.thresholds.sensorStaleDays) {
    [int]$Config.thresholds.sensorStaleDays
} else {
    7
}
$detailLimit = if ($Config.collection -and $Config.collection.defenderDeviceDetailLimit) {
    [int]$Config.collection.defenderDeviceDetailLimit
} else {
    200
}

try {
    Write-Host "    Collecting Defender for Endpoint device health..." -ForegroundColor Gray

    # Check if Defender API is connected
    if (-not (Test-DefenderApiConnection)) {
        Write-Host "    [!] Defender API not connected - skipping MDE device health collection" -ForegroundColor Yellow
        $emptyOutput = @{
            devices = @()
            summary = @{
                totalDevices = 0
                notOnboarded = 0
                sensorUnhealthy = 0
                healthUnhealthy = 0
                tamperDisabled = 0
                avNotActive = 0
                signatureStale = 0
                edrBlockModeDisabled = 0
                sensorStale = 0
                signatureAgeThresholdDays = $signatureAgeThreshold
                sensorStaleThresholdDays = $sensorStaleThreshold
            }
            collectionDate = (Get-Date).ToString("o")
            dataSource = "unavailable"
            reason = "Defender API authentication required"
        }
        Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null
        return New-CollectorResult -Success $true -Count 0 -Errors @("Defender API not connected")
    }

    $machines = @()
    try {
        $machines = Get-MdeAllPages -Uri "$apiBase/api/machines" -OperationName "MDE machines retrieval"
    }
    catch {
        throw "Unable to retrieve MDE machines: $($_.Exception.Message)"
    }

    $detailMap = @{}
    if ($detailLimit -gt 0 -and $machines.Count -gt 0) {
        $detailTargets = $machines | Select-Object -First $detailLimit
        foreach ($machine in $detailTargets) {
            $machineId = $machine.id
            if ([string]::IsNullOrWhiteSpace($machineId)) { continue }
            try {
                $detail = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method GET -Uri "$apiBase/api/machines/$machineId" -OutputType PSObject
                } -OperationName "MDE machine detail ($machineId)"

                if ($detail) {
                    $detailMap[$machineId] = $detail
                }
            }
            catch {
                # Best-effort detail fetch
            }
        }
    }

    $devices = @()
    $summary = @{
        totalDevices = 0
        notOnboarded = 0
        sensorUnhealthy = 0
        healthUnhealthy = 0
        tamperDisabled = 0
        avNotActive = 0
        signatureStale = 0
        edrBlockModeDisabled = 0
        sensorStale = 0
        signatureAgeThresholdDays = $signatureAgeThreshold
        sensorStaleThresholdDays = $sensorStaleThreshold
    }

    foreach ($machine in $machines) {
        $machineId = Get-GraphPropertyValue -Object $machine -PropertyNames @("id", "machineId")
        if ([string]::IsNullOrWhiteSpace($machineId)) { continue }

        $detail = if ($detailMap.ContainsKey($machineId)) { $detailMap[$machineId] } else { $null }

        $deviceName = Get-GraphPropertyValue -Object $machine -PropertyNames @("computerDnsName", "deviceName", "machineName")
        $aadDeviceId = Get-GraphPropertyValue -Object $machine -PropertyNames @("aadDeviceId", "azureAdDeviceId")
        if (-not $aadDeviceId -and $detail) {
            $aadDeviceId = Get-GraphPropertyValue -Object $detail -PropertyNames @("aadDeviceId", "azureAdDeviceId")
        }

        $onboardingStatus = Get-GraphPropertyValue -Object $machine -PropertyNames @("onboardingStatus", "onboardingState")
        if (-not $onboardingStatus -and $detail) {
            $onboardingStatus = Get-GraphPropertyValue -Object $detail -PropertyNames @("onboardingStatus", "onboardingState")
        }

        $osPlatform = Get-GraphPropertyValue -Object $machine -PropertyNames @("osPlatform")
        if (-not $osPlatform -and $detail) {
            $osPlatform = Get-GraphPropertyValue -Object $detail -PropertyNames @("osPlatform")
        }
        $osVersion = Get-GraphPropertyValue -Object $machine -PropertyNames @("osVersion", "osBuild")
        if (-not $osVersion -and $detail) {
            $osVersion = Get-GraphPropertyValue -Object $detail -PropertyNames @("osVersion", "osBuild")
        }

        $healthStatus = Get-GraphPropertyValue -Object $machine -PropertyNames @("healthStatus")
        if (-not $healthStatus -and $detail) {
            $healthStatus = Get-GraphPropertyValue -Object $detail -PropertyNames @("healthStatus")
        }

        $sensorHealth = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("sensorHealthState", "sensorHealthStatus") } else { $null }
        $tamperProtection = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("tamperProtection", "isTamperProtected", "tamperProtectionStatus") } else { $null }
        $edrBlockMode = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("edrBlockModeStatus", "isEdrBlockModeEnabled", "edrBlockMode") } else { $null }
        $avMode = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("avMode", "antivirusMode", "avStatus") } else { $null }
        $avEngineVersion = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("avEngineVersion", "antivirusEngineVersion") } else { $null }
        $avSignatureVersion = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("avSignatureVersion", "antivirusSignatureVersion") } else { $null }
        $avSignatureUpdateTime = if ($detail) { Get-GraphPropertyValue -Object $detail -PropertyNames @("avSignatureUpdateTime", "avSignatureUpdateDateTime", "antivirusSignatureUpdateDateTime", "avSignatureTimestamp") } else { $null }

        $signatureAgeDays = Get-DaysSinceDate -DateValue $avSignatureUpdateTime
        $lastSeenValue = Get-GraphPropertyValue -Object $machine -PropertyNames @("lastSeen", "lastSeenDateTime")
        if (-not $lastSeenValue -and $detail) {
            $lastSeenValue = Get-GraphPropertyValue -Object $detail -PropertyNames @("lastSeen", "lastSeenDateTime")
        }
        $sensorLastSeenAgeDays = Get-DaysSinceDate -DateValue $lastSeenValue

        $issues = @()
        if ($onboardingStatus -and -not (Is-Onboarded -Value $onboardingStatus)) {
            $issues += "NotOnboarded"
            $summary.notOnboarded++
        }
        if ($sensorHealth -and -not (Is-HealthyState -Value $sensorHealth)) {
            $issues += "SensorUnhealthy"
            $summary.sensorUnhealthy++
        }
        if ($healthStatus -and -not (Is-HealthyState -Value $healthStatus)) {
            $issues += "HealthUnhealthy"
            $summary.healthUnhealthy++
        }
        if ($tamperProtection -and -not (Is-EnabledFlag -Value $tamperProtection)) {
            $issues += "TamperProtectionDisabled"
            $summary.tamperDisabled++
        }
        if ($avMode -and -not (Is-AvActive -Value $avMode)) {
            $issues += "AvNotActive"
            $summary.avNotActive++
        }
        if ($signatureAgeDays -ne $null -and $signatureAgeDays -gt $signatureAgeThreshold) {
            $issues += "SignatureStale"
            $summary.signatureStale++
        }
        if ($sensorLastSeenAgeDays -ne $null -and $sensorLastSeenAgeDays -gt $sensorStaleThreshold) {
            $issues += "SensorStale"
            $summary.sensorStale++
        }
        if ($edrBlockMode -and -not (Is-EnabledFlag -Value $edrBlockMode)) {
            $issues += "EdrBlockModeDisabled"
            $summary.edrBlockModeDisabled++
        }

        $devices += [PSCustomObject]@{
            id                      = $machineId
            deviceName              = $deviceName
            aadDeviceId             = $aadDeviceId
            osPlatform              = $osPlatform
            osVersion               = $osVersion
            onboardingStatus        = Normalize-Status $onboardingStatus
            healthStatus            = Normalize-Status $healthStatus
            sensorHealthState       = Normalize-Status $sensorHealth
            tamperProtection        = $tamperProtection
            edrBlockModeStatus      = $edrBlockMode
            avMode                  = Normalize-Status $avMode
            avEngineVersion         = $avEngineVersion
            avSignatureVersion      = $avSignatureVersion
            avSignatureUpdateTime   = Format-IsoDate -DateValue $avSignatureUpdateTime
            avSignatureAgeDays      = $signatureAgeDays
            lastSeen                = Format-IsoDate -DateValue $lastSeenValue
            sensorLastSeenAgeDays   = $sensorLastSeenAgeDays
            riskScore               = Get-GraphPropertyValue -Object $machine -PropertyNames @("riskScore")
            exposureLevel           = Get-GraphPropertyValue -Object $machine -PropertyNames @("exposureLevel")
            issues                  = $issues
            hasIssues               = ($issues.Count -gt 0)
        }
    }

    $summary.totalDevices = $devices.Count

    $output = @{
        devices = $devices
        summary = $summary
        collectionDate = (Get-Date).ToString("o")
    }

    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null
    Write-Host "    [OK] Collected $($devices.Count) Defender device health records" -ForegroundColor Green
    return New-CollectorResult -Success $true -Count $devices.Count -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = @{
        devices = @()
        summary = @{
            totalDevices = 0
            notOnboarded = 0
            sensorUnhealthy = 0
            healthUnhealthy = 0
            tamperDisabled = 0
            avNotActive = 0
            signatureStale = 0
            edrBlockModeDisabled = 0
            sensorStale = 0
            signatureAgeThresholdDays = $signatureAgeThreshold
            sensorStaleThresholdDays = $sensorStaleThreshold
        }
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
