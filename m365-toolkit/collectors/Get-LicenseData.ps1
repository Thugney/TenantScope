# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/tenantscope
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects tenant license inventory from Microsoft Graph subscribedSkus.

.DESCRIPTION
    Retrieves live subscribed SKU capacity and service plan data from
    Microsoft Graph v1.0 /subscribedSkus using the Microsoft Graph PowerShell
    SDK. The collector writes a stable normalized object to license-skus.json
    and keeps legacy per-SKU fields inside each license row for dashboard
    compatibility.

    Required app permission: LicenseAssignment.Read.All.
    Existing app registrations that already use Organization.Read.All or
    Directory.Read.All can continue to use those broader permissions.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes license-skus.json to the specified output path. Returns a hashtable
    with Success, Count, and Errors for the main collector pipeline.
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.DirectoryManagement

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
)

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

function Write-LicenseLog {
    param(
        [Parameter(Mandatory)]
        [string]$Message,

        [Parameter()]
        [ValidateSet("Debug", "Info", "Warning", "Error")]
        [string]$Level = "Info"
    )

    if (Get-Command -Name Write-CollectionLog -ErrorAction SilentlyContinue) {
        Write-CollectionLog -Message "License collector: $Message" -Level $Level -NoConsole
    }

    $color = switch ($Level) {
        "Warning" { "Yellow" }
        "Error"   { "Red" }
        "Debug"   { "Gray" }
        default   { "Gray" }
    }
    Write-Host "      $Message" -ForegroundColor $color
}

function Get-ConfigValue {
    param(
        [Parameter()]
        [AllowNull()]
        $Source,

        [Parameter(Mandatory)]
        [string[]]$Names
    )

    if ($null -eq $Source) { return $null }

    foreach ($name in $Names) {
        if ($Source -is [hashtable]) {
            foreach ($key in $Source.Keys) {
                if ([string]::Equals([string]$key, $name, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return $Source[$key]
                }
            }
        }
        else {
            $prop = $Source.PSObject.Properties[$name]
            if ($prop) { return $prop.Value }
        }
    }

    return $null
}

function Get-ConfigBool {
    param(
        [Parameter()]
        [AllowNull()]
        $Source,

        [Parameter(Mandatory)]
        [string[]]$Names,

        [Parameter()]
        [bool]$Default = $false
    )

    $value = Get-ConfigValue -Source $Source -Names $Names
    if ($null -eq $value) { return $Default }
    if ($value -is [bool]) { return $value }
    if ($value -is [string]) {
        return $value -match '^(?i:true|1|yes|on)$'
    }
    return [bool]$value
}

function ConvertTo-SafeInt {
    param([AllowNull()]$Value)

    if ($null -eq $Value) { return 0 }
    try { return [int]$Value } catch { return 0 }
}

function New-LicenseSummary {
    param([array]$Licenses)

    $enabled = 0
    $consumed = 0
    $available = 0
    $zeroAvailable = 0
    $warningOrSuspended = 0

    foreach ($license in @($Licenses)) {
        $enabled += ConvertTo-SafeInt $license.enabledUnits
        $consumed += ConvertTo-SafeInt $license.consumedUnits
        $available += ConvertTo-SafeInt $license.availableUnits
        if ((ConvertTo-SafeInt $license.availableUnits) -le 0) { $zeroAvailable++ }
        if ((ConvertTo-SafeInt $license.warningUnits) -gt 0 -or (ConvertTo-SafeInt $license.suspendedUnits) -gt 0) {
            $warningOrSuspended++
        }
    }

    return [PSCustomObject]@{
        skuCount                       = @($Licenses).Count
        totalEnabledUnits              = $enabled
        totalConsumedUnits             = $consumed
        totalAvailableUnits            = $available
        zeroAvailableSkuCount          = $zeroAvailable
        warningOrSuspendedSkuCount     = $warningOrSuspended
    }
}

function New-LicenseInventoryPayload {
    param(
        [Parameter(Mandatory)]
        [string]$Status,

        [Parameter()]
        [array]$Licenses = @(),

        [Parameter()]
        [array]$Errors = @(),

        [Parameter()]
        [array]$Warnings = @()
    )

    $summary = New-LicenseSummary -Licenses $Licenses

    return [PSCustomObject]@{
        collectedAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        source         = "MicrosoftGraph:/subscribedSkus"
        status         = $Status
        summary        = $summary
        validation     = [PSCustomObject]@{
            totalLicenseSkus             = $summary.skuCount
            totalEnabledSeats            = $summary.totalEnabledUnits
            totalConsumedSeats           = $summary.totalConsumedUnits
            totalAvailableSeats          = $summary.totalAvailableUnits
            zeroAvailableSkus            = @($Licenses | Where-Object { (ConvertTo-SafeInt $_.availableUnits) -le 0 } | Select-Object -ExpandProperty skuPartNumber)
            warningOrSuspendedSkus       = @($Licenses | Where-Object {
                (ConvertTo-SafeInt $_.warningUnits) -gt 0 -or (ConvertTo-SafeInt $_.suspendedUnits) -gt 0
            } | Select-Object -ExpandProperty skuPartNumber)
        }
        licenses       = @($Licenses)
        errors         = @($Errors)
        warnings       = @($Warnings)
    }
}

function Get-TenantLicenseInventory {
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config,

        [Parameter(Mandatory)]
        [string]$OutputPath
    )

    Write-LicenseLog -Message "collector start"

    $context = Get-MgContext
    if ($null -eq $context) {
        throw "No active Microsoft Graph context. Connect-MgGraph must run before license collection."
    }

    Write-LicenseLog -Message "calling Microsoft Graph v1.0 /subscribedSkus"
    $subscribedSkus = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgSubscribedSku -All -ErrorAction Stop
    } -OperationName "Tenant license subscribedSkus retrieval"

    $subscribedSkus = @($subscribedSkus)
    if ($subscribedSkus.Count -eq 0) {
        return New-LicenseInventoryPayload -Status "warning" -Warnings @([PSCustomObject]@{
            code    = "empty_subscribedSkus_response"
            message = "Microsoft Graph returned no subscribed SKUs for this tenant."
        })
    }

    $usersPath = Join-Path (Split-Path $OutputPath -Parent) "users.json"
    $users = @()
    if (Test-Path $usersPath) {
        try {
            $usersData = Get-Content $usersPath -Raw | ConvertFrom-Json
            if ($usersData -and $usersData.users) {
                $users = @($usersData.users)
            }
            else {
                $users = @($usersData)
            }
            Write-LicenseLog -Message "loaded $($users.Count) users for license waste cross-reference"
        }
        catch {
            Write-LicenseLog -Message "users.json could not be read for waste analysis: $($_.Exception.Message)" -Level Warning
        }
    }
    else {
        Write-LicenseLog -Message "users.json not found; waste analysis fields will be zero" -Level Warning
    }

    $skuUserMap = @{}
    foreach ($user in @($users)) {
        foreach ($skuId in @($user.assignedSkuIds)) {
            if ([string]::IsNullOrWhiteSpace([string]$skuId)) { continue }
            $key = [string]$skuId
            if (-not $skuUserMap.ContainsKey($key)) {
                $skuUserMap[$key] = @{
                    disabled = 0
                    inactive = 0
                    enabled  = 0
                    total    = 0
                }
            }

            $skuUserMap[$key].total++
            if ($user.accountEnabled -eq $false) {
                $skuUserMap[$key].disabled++
            }
            elseif ($user.isInactive -eq $true) {
                $skuUserMap[$key].inactive++
            }
            else {
                $skuUserMap[$key].enabled++
            }
        }
    }

    $currencyCode = "NOK"
    $currencyConfig = Get-ConfigValue -Source $Config -Names @("currency")
    $configuredCurrency = Get-ConfigValue -Source $currencyConfig -Names @("code")
    if (-not [string]::IsNullOrWhiteSpace([string]$configuredCurrency)) {
        $currencyCode = [string]$configuredCurrency
    }

    $licensePricing = Get-ConfigValue -Source $Config -Names @("licensePricing")
    $processedSkus = @()
    $warnings = @()

    foreach ($sku in ($subscribedSkus | Sort-Object -Property SkuPartNumber)) {
        $skuPartNumber = [string]$sku.SkuPartNumber
        $skuId = [string]$sku.SkuId
        $prepaidUnits = $sku.PrepaidUnits

        if ($null -eq $prepaidUnits) {
            $warnings += [PSCustomObject]@{
                code          = "missing_prepaidUnits"
                skuId         = $skuId
                skuPartNumber = $skuPartNumber
                message       = "Graph returned this subscribed SKU without a PrepaidUnits object; capacity fields were normalized to zero."
            }
        }

        $enabledUnits = ConvertTo-SafeInt $prepaidUnits.Enabled
        $suspendedUnits = ConvertTo-SafeInt $prepaidUnits.Suspended
        $warningUnits = ConvertTo-SafeInt $prepaidUnits.Warning
        $consumedUnits = ConvertTo-SafeInt $sku.ConsumedUnits
        $availableUnits = $enabledUnits - $consumedUnits

        $skuStats = if ($skuUserMap.ContainsKey($skuId)) { $skuUserMap[$skuId] } else { $null }
        $assignedToEnabled = if ($skuStats) { ConvertTo-SafeInt $skuStats.enabled } else { $consumedUnits }
        $assignedToDisabled = if ($skuStats) { ConvertTo-SafeInt $skuStats.disabled } else { 0 }
        $assignedToInactive = if ($skuStats) { ConvertTo-SafeInt $skuStats.inactive } else { 0 }
        $wasteCount = $assignedToDisabled + $assignedToInactive

        $monthlyCostPerLicense = 0
        if ($licensePricing) {
            $configuredPrice = Get-ConfigValue -Source $licensePricing -Names @($skuPartNumber)
            if ($null -ne $configuredPrice) {
                try { $monthlyCostPerLicense = [double]$configuredPrice } catch { $monthlyCostPerLicense = 0 }
            }
        }

        $estimatedMonthlyCost = [Math]::Round($consumedUnits * $monthlyCostPerLicense)
        $wasteMonthlyCost = [Math]::Round($wasteCount * $monthlyCostPerLicense)
        $billedUsers = if ($monthlyCostPerLicense -gt 0) { $consumedUnits } else { 0 }
        $averageCostPerUser = if ($billedUsers -gt 0) { [Math]::Round($estimatedMonthlyCost / $billedUsers) } else { 0 }
        $utilizationPercent = if ($enabledUnits -gt 0) { [Math]::Round(($consumedUnits / $enabledUnits) * 100) } else { 0 }

        $servicePlans = @($sku.ServicePlans | ForEach-Object {
            [PSCustomObject]@{
                servicePlanId      = [string]$_.ServicePlanId
                servicePlanName    = [string]$_.ServicePlanName
                provisioningStatus = [string]$_.ProvisioningStatus
                appliesTo          = [string]$_.AppliesTo
            }
        } | Sort-Object -Property servicePlanName)

        $processedSkus += [PSCustomObject]@{
            skuId                   = $skuId
            skuPartNumber           = $skuPartNumber
            appliesTo               = [string]$sku.AppliesTo
            capabilityStatus        = [string]$sku.CapabilityStatus
            consumedUnits           = $consumedUnits
            enabledUnits            = $enabledUnits
            suspendedUnits          = $suspendedUnits
            warningUnits            = $warningUnits
            availableUnits          = $availableUnits
            servicePlans            = $servicePlans

            # Backwards-compatible dashboard fields. These are derived from
            # live Graph inventory, not from a static SKU definition map.
            skuName                 = $skuPartNumber
            totalPurchased          = $enabledUnits
            totalAssigned           = $consumedUnits
            available               = $availableUnits
            prepaidEnabled          = $enabledUnits
            prepaidWarning          = $warningUnits
            prepaidSuspended        = $suspendedUnits
            prepaidLockedOut        = ConvertTo-SafeInt $prepaidUnits.LockedOut
            assignedToEnabled       = $assignedToEnabled
            assignedToDisabled      = $assignedToDisabled
            assignedToInactive      = $assignedToInactive
            wasteCount              = $wasteCount
            utilizationPercent      = $utilizationPercent
            monthlyCostPerLicense   = $monthlyCostPerLicense
            estimatedMonthlyCost    = $estimatedMonthlyCost
            estimatedAnnualCost     = $estimatedMonthlyCost * 12
            wasteMonthlyCost        = $wasteMonthlyCost
            wasteAnnualCost         = $wasteMonthlyCost * 12
            billedUsers             = $billedUsers
            averageCostPerUser      = $averageCostPerUser
            currency                = $currencyCode
            overlapCount            = 0
            overlapSkuName          = $null
            potentialSavingsPercent = 0
            servicePlanCount        = $servicePlans.Count
        }
    }

    $overlapRules = @(Get-ConfigValue -Source $Config -Names @("licenseOverlapRules"))
    if ($overlapRules.Count -gt 0 -and $users.Count -gt 0) {
        $partToId = @{}
        foreach ($license in $processedSkus) {
            $partToId[$license.skuPartNumber] = $license.skuId
        }

        foreach ($rule in $overlapRules) {
            $higherSku = Get-ConfigValue -Source $rule -Names @("higherSku")
            $lowerSku = Get-ConfigValue -Source $rule -Names @("lowerSku")
            if ([string]::IsNullOrWhiteSpace([string]$higherSku) -or [string]::IsNullOrWhiteSpace([string]$lowerSku)) { continue }

            $higherSkuId = $partToId[[string]$higherSku]
            $lowerSkuId = $partToId[[string]$lowerSku]
            if (-not $higherSkuId -or -not $lowerSkuId) { continue }

            $overlapCount = 0
            foreach ($user in $users) {
                $skuIds = @($user.assignedSkuIds)
                if (($skuIds -contains $higherSkuId) -and ($skuIds -contains $lowerSkuId)) {
                    $overlapCount++
                }
            }

            if ($overlapCount -gt 0) {
                foreach ($license in @($processedSkus | Where-Object { $_.skuPartNumber -eq [string]$lowerSku })) {
                    $license.overlapCount = $overlapCount
                    $license.overlapSkuName = [string]$higherSku
                    if ($license.estimatedMonthlyCost -gt 0) {
                        $license.potentialSavingsPercent = [Math]::Round(($overlapCount * $license.monthlyCostPerLicense) / $license.estimatedMonthlyCost * 100)
                    }
                }
                foreach ($license in @($processedSkus | Where-Object { $_.skuPartNumber -eq [string]$higherSku })) {
                    $license.overlapCount = $overlapCount
                    $license.overlapSkuName = [string]$lowerSku
                }
            }
        }
    }

    $processedSkus = @($processedSkus | Sort-Object -Property skuPartNumber)
    Write-LicenseLog -Message "number of SKUs collected: $($processedSkus.Count)"

    return New-LicenseInventoryPayload -Status "success" -Licenses $processedSkus -Warnings $warnings
}

$errors = @()

try {
    $collectionConfig = Get-ConfigValue -Source $Config -Names @("collection")
    $enableCollection = Get-ConfigBool -Source $Config -Names @("EnableLicenseCollection", "enableLicenseCollection") -Default $true
    if ($collectionConfig) {
        $enableCollection = Get-ConfigBool -Source $collectionConfig -Names @("EnableLicenseCollection", "enableLicenseCollection") -Default $enableCollection
    }

    if (-not $enableCollection) {
        $payload = New-LicenseInventoryPayload -Status "disabled" -Warnings @([PSCustomObject]@{
            code    = "license_collection_disabled"
            message = "License collection is disabled by EnableLicenseCollection=false."
        })
        Save-CollectorData -Data $payload -OutputPath $OutputPath | Out-Null
        Write-LicenseLog -Message "output file path: $OutputPath"
        return New-CollectorResult -Success $true -Count 0 -Errors @("License collection disabled by configuration.")
    }

    $payload = Get-TenantLicenseInventory -Config $Config -OutputPath $OutputPath
    Save-CollectorData -Data $payload -OutputPath $OutputPath | Out-Null
    Write-LicenseLog -Message "output file path: $OutputPath"

    foreach ($warning in @($payload.warnings)) {
        if ($warning.message) { $errors += [string]$warning.message }
    }

    Write-Host "    [OK] Collected $($payload.summary.skuCount) license SKUs" -ForegroundColor Green
    return New-CollectorResult -Success $true -Count $payload.summary.skuCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errorCode = if (Test-GraphAccessError -Value $_) {
        "permission_or_auth_failure"
    }
    elseif ($errorMessage -match "429|throttl|TooManyRequests|500|502|503|504|ServiceUnavailable|GatewayTimeout|BadGateway|InternalServerError") {
        "graph_retryable_failure"
    }
    else {
        "license_collection_failed"
    }

    $errors += $errorMessage

    if ($errorCode -eq "permission_or_auth_failure") {
        Write-LicenseLog -Message "permission/auth failure: $errorMessage" -Level Error
    }
    else {
        Write-LicenseLog -Message "live Graph license collection failed: $errorMessage" -Level Warning
    }

    $payload = New-LicenseInventoryPayload -Status "warning" -Errors @([PSCustomObject]@{
        code    = $errorCode
        message = $errorMessage
        hint    = "Grant LicenseAssignment.Read.All application permission, or use existing Organization.Read.All/Directory.Read.All consent if already approved."
    }) -Warnings @([PSCustomObject]@{
        code    = "static_fallback_not_used"
        message = "Static hard-coded SKU inventory was not reused. Configure AllowStaticLicenseFallback only if a future static fallback source is explicitly added."
    })

    Save-CollectorData -Data $payload -OutputPath $OutputPath | Out-Null
    Write-LicenseLog -Message "output file path: $OutputPath"

    return New-CollectorResult -Success $true -Count 0 -Errors $errors
}
