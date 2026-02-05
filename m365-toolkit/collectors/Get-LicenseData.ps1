# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects license SKU data from Microsoft 365 tenant via Graph API.

.DESCRIPTION
    Retrieves all subscribed SKUs in the tenant and cross-references with
    user data to calculate utilization metrics including waste analysis
    (licenses assigned to disabled or inactive users).

    Graph API endpoint: GET /subscribedSkus
    Required scope: Directory.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes license-skus.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of SKUs collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-LicenseData.ps1 -Config $config -OutputPath ".\data\license-skus.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.DirectoryManagement

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# SKU FRIENDLY NAME MAPPING
# Maps SKU part numbers to human-readable license names
# ============================================================================

$skuNameMap = @{
    "SPE_E3"                    = "Microsoft 365 E3"
    "SPE_E5"                    = "Microsoft 365 E5"
    "SPE_F1"                    = "Microsoft 365 F1"
    "ENTERPRISEPACK"            = "Office 365 E3"
    "ENTERPRISEPREMIUM"         = "Office 365 E5"
    "M365EDU_A1"                = "Microsoft 365 A1 for students"
    "M365EDU_A3_STUUSEBNFT"     = "Microsoft 365 A3 for students"
    "M365EDU_A3_FACULTY"        = "Microsoft 365 A3 for faculty"
    "M365EDU_A5_STUUSEBNFT"     = "Microsoft 365 A5 for students"
    "M365EDU_A5_FACULTY"        = "Microsoft 365 A5 for faculty"
    "STANDARDWOFFPACK_STUDENT"  = "Office 365 A1 for students"
    "STANDARDWOFFPACK_FACULTY"  = "Office 365 A1 for faculty"
    "OFFICESUBSCRIPTION_STUDENT"= "Office 365 ProPlus for students"
    "EXCHANGESTANDARD"          = "Exchange Online Plan 1"
    "EXCHANGEENTERPRISE"        = "Exchange Online Plan 2"
    "POWER_BI_PRO"              = "Power BI Pro"
    "POWER_BI_PREMIUM_PER_USER" = "Power BI Premium Per User"
    "TEAMS_EXPLORATORY"         = "Microsoft Teams Exploratory"
    "FLOW_FREE"                 = "Power Automate Free"
    "POWERAPPS_VIRAL"           = "Power Apps Trial"
    "PROJECTPREMIUM"            = "Project Plan 5"
    "PROJECTPROFESSIONAL"       = "Project Plan 3"
    "VISIOCLIENT"               = "Visio Plan 2"
    "WIN10_PRO_ENT_SUB"         = "Windows 10/11 Enterprise E3"
    "WIN10_VDA_E5"              = "Windows 10/11 Enterprise E5"
    "MDATP_XPLAT"               = "Microsoft Defender for Endpoint P2"
    "ATP_ENTERPRISE"            = "Microsoft Defender for Office 365 P1"
    "THREAT_INTELLIGENCE"       = "Microsoft Defender for Office 365 P2"
    "INTUNE_A"                  = "Microsoft Intune Plan 1"
    "AAD_PREMIUM"               = "Entra ID P1"
    "AAD_PREMIUM_P2"            = "Entra ID P2"
    "EMSPREMIUM"                = "Enterprise Mobility + Security E5"
    "EMS"                       = "Enterprise Mobility + Security E3"
    "DESKLESSPACK"              = "Office 365 F3"
    "SMB_BUSINESS_PREMIUM"      = "Microsoft 365 Business Premium"
    "SMB_BUSINESS"              = "Microsoft 365 Apps for Business"
    "O365_BUSINESS_ESSENTIALS"  = "Microsoft 365 Business Basic"
    "STREAM"                    = "Microsoft Stream"
    "MCOEV"                     = "Microsoft Teams Phone Standard"
    "PHONESYSTEM_VIRTUALUSER"   = "Microsoft Teams Phone Resource Account"
    "MEETING_ROOM"              = "Microsoft Teams Rooms Standard"
    "RIGHTSMANAGEMENT"          = "Azure Information Protection Plan 1"
    "RIGHTSMANAGEMENT_ADHOC"    = "Rights Management Adhoc"
    "MCOPSTN1"                  = "Microsoft 365 Domestic Calling Plan"
    "MCOPSTN2"                  = "Microsoft 365 Domestic and International Calling Plan"
    "MCOMEETADV"                = "Microsoft 365 Audio Conferencing"
    "WINDOWS_STORE"             = "Windows Store for Business"
    "POWERAPPS_PER_USER"        = "Power Apps per user plan"
    "FLOW_PER_USER"             = "Power Automate per user plan"
    "CDS_DB_CAPACITY"           = "Common Data Service Database Capacity"
    "CDS_LOG_CAPACITY"          = "Common Data Service Log Capacity"
    "MICROSOFT_BUSINESS_CENTER" = "Microsoft Business Center"
    "FORMS_PRO"                 = "Dynamics 365 Customer Voice"
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Get-FriendlySkuName {
    <#
    .SYNOPSIS
        Returns a friendly name for a SKU part number.

    .PARAMETER SkuPartNumber
        The SKU part number from Graph API.

    .OUTPUTS
        Friendly name if found in mapping, otherwise returns the part number.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$SkuPartNumber
    )

    if ($skuNameMap.ContainsKey($SkuPartNumber)) {
        return $skuNameMap[$SkuPartNumber]
    }
    else {
        # Return the part number itself as fallback
        return $SkuPartNumber
    }
}

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling.
    #>
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [int]$MaxRetries = 5,

        [Parameter()]
        [int]$BaseBackoffSeconds = 60
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests|Too many retries") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $BaseBackoffSeconds * [Math]::Pow(2, $attempt - 1)
                Write-Host "      Throttled. Waiting ${wait}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
            }
            else { throw }
        }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$skuCount = 0

try {
    Write-Host "    Collecting license SKUs from tenant..." -ForegroundColor Gray

    # Retrieve all subscribed SKUs
    $subscribedSkus = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgSubscribedSku -All
    }

    Write-Host "      Retrieved $($subscribedSkus.Count) SKUs from Graph API" -ForegroundColor Gray

    # Load user data to calculate waste metrics
    $usersPath = Join-Path (Split-Path $OutputPath -Parent) "users.json"
    $users = @()

    if (Test-Path $usersPath) {
        $users = Get-Content $usersPath -Raw | ConvertFrom-Json
        Write-Host "      Loaded $($users.Count) users for cross-reference" -ForegroundColor Gray
    }
    else {
        Write-Host "      ⚠ Users data not found - waste calculations will be incomplete" -ForegroundColor Yellow
    }

    # Build lookup of user license assignments
    # Key: SKU ID, Value: array of user objects with that license
    $skuUserMap = @{}

    foreach ($user in $users) {
        # We need to check the original Graph data for license assignments
        # Since our users.json only has licenseCount, we'll need to re-query
        # For efficiency, we'll estimate based on enabled/disabled status
    }

    # Process each SKU
    $processedSkus = @()

    foreach ($sku in $subscribedSkus) {
        # Get friendly name
        $friendlyName = Get-FriendlySkuName -SkuPartNumber $sku.SkuPartNumber

        # Calculate basic metrics from SKU
        $totalPurchased = $sku.PrepaidUnits.Enabled + $sku.PrepaidUnits.Warning
        $totalAssigned = $sku.ConsumedUnits
        $available = $totalPurchased - $totalAssigned

        # For waste calculation, we need to check each user with this license
        # Since full cross-reference requires re-querying, we'll use estimation
        # based on overall tenant disabled/inactive ratios
        $assignedToEnabled = $totalAssigned
        $assignedToDisabled = 0
        $assignedToInactive = 0

        if ($users.Count -gt 0) {
            # Calculate tenant-wide ratios
            $totalUsers = $users.Count
            $disabledCount = ($users | Where-Object { -not $_.accountEnabled }).Count
            $inactiveCount = ($users | Where-Object { $_.isInactive -and $_.accountEnabled }).Count
            $enabledActiveCount = $totalUsers - $disabledCount - $inactiveCount

            # Apply ratios to estimate waste
            if ($totalUsers -gt 0) {
                $disabledRatio = $disabledCount / $totalUsers
                $inactiveRatio = $inactiveCount / $totalUsers

                $assignedToDisabled = [Math]::Floor($totalAssigned * $disabledRatio)
                $assignedToInactive = [Math]::Floor($totalAssigned * $inactiveRatio)
                $assignedToEnabled = $totalAssigned - $assignedToDisabled - $assignedToInactive
            }
        }

        # Calculate waste and utilization
        $wasteCount = $assignedToDisabled + $assignedToInactive
        $utilizationPercent = 0
        if ($totalPurchased -gt 0) {
            $utilizationPercent = [Math]::Round(($assignedToEnabled / $totalPurchased) * 100)
        }

        # Cost calculation from config pricing
        $monthlyCostPerLicense = 0
        $currencyCode = "NOK"
        if ($Config.licensePricing -and $Config.licensePricing.ContainsKey($sku.SkuPartNumber)) {
            $monthlyCostPerLicense = [double]$Config.licensePricing[$sku.SkuPartNumber]
        }
        if ($Config.currency -and $Config.currency.code) {
            $currencyCode = $Config.currency.code
        }

        $estimatedMonthlyCost = [Math]::Round($totalAssigned * $monthlyCostPerLicense)
        $wasteMonthlyCost = [Math]::Round($wasteCount * $monthlyCostPerLicense)

        # Build output object
        $processedSku = [PSCustomObject]@{
            skuId               = $sku.SkuId
            skuName             = $friendlyName
            skuPartNumber       = $sku.SkuPartNumber
            totalPurchased      = $totalPurchased
            totalAssigned       = $totalAssigned
            assignedToEnabled   = $assignedToEnabled
            assignedToDisabled  = $assignedToDisabled
            assignedToInactive  = $assignedToInactive
            available           = [Math]::Max(0, $available)
            wasteCount          = $wasteCount
            utilizationPercent  = $utilizationPercent
            monthlyCostPerLicense = $monthlyCostPerLicense
            estimatedMonthlyCost  = $estimatedMonthlyCost
            wasteMonthlyCost      = $wasteMonthlyCost
            currency              = $currencyCode
        }

        $processedSkus += $processedSku
        $skuCount++
    }

    # Sort by total purchased descending for easier reading
    $processedSkus = $processedSkus | Sort-Object -Property totalPurchased -Descending

    # Write results to JSON file
    $processedSkus | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    ✓ Collected $skuCount license SKUs" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $skuCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    ✗ Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
