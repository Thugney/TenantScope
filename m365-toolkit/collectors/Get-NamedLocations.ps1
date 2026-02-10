# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Named Locations from Conditional Access for network security analysis.

.DESCRIPTION
    Retrieves all named locations configured in Conditional Access policies.
    Named locations define trusted networks and geographic locations used
    for risk-based access decisions.

    Identifies:
    - Trusted IP ranges (corporate networks)
    - Trusted countries/regions
    - IPv4 and IPv6 ranges
    - MFA-trusted vs non-trusted locations

    Graph API endpoint: GET /identity/conditionalAccess/namedLocations
    Required scope: Policy.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes named-locations.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-NamedLocations.ps1 -Config $config -OutputPath ".\data\named-locations.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Identity.SignIns

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
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$locationCount = 0

try {
    Write-Host "    Collecting Named Locations..." -ForegroundColor Gray

    # Get all named locations
    $locations = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgIdentityConditionalAccessNamedLocation -All
    } -OperationName "Named locations retrieval"

    Write-Host "      Retrieved $($locations.Count) named locations" -ForegroundColor Gray

    # Reuse CA policies from SharedData (populated by Get-ConditionalAccessData) to avoid
    # a duplicate API call. Falls back to fetching directly if SharedData not available.
    $caPolicies = @()
    if ($SharedData -and $SharedData.ContainsKey('CAPolicies') -and $SharedData['CAPolicies'].Count -gt 0) {
        $caPolicies = @($SharedData['CAPolicies'])
        Write-Host "      Reusing $($caPolicies.Count) CA policies from shared data (no extra API call)" -ForegroundColor Gray
    }
    else {
        try {
            $caPolicies = Invoke-GraphWithRetry -ScriptBlock {
                Get-MgIdentityConditionalAccessPolicy -All
            } -OperationName "CA policies for location mapping"
        }
        catch {
            Write-Host "      Could not retrieve CA policies for mapping: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # Build location usage map from CA policies
    $locationUsage = @{}
    foreach ($policy in $caPolicies) {
        $policyName = $policy.DisplayName
        $policyState = $policy.State

        # Check included locations
        if ($policy.Conditions.Locations.IncludeLocations) {
            foreach ($locId in $policy.Conditions.Locations.IncludeLocations) {
                if ($locId -ne "All" -and $locId -ne "AllTrusted") {
                    if (-not $locationUsage.ContainsKey($locId)) {
                        $locationUsage[$locId] = @{ includedIn = @(); excludedFrom = @() }
                    }
                    $locationUsage[$locId].includedIn += @{
                        policyId = $policy.Id
                        policyName = $policyName
                        policyState = $policyState
                    }
                }
            }
        }

        # Check excluded locations
        if ($policy.Conditions.Locations.ExcludeLocations) {
            foreach ($locId in $policy.Conditions.Locations.ExcludeLocations) {
                if ($locId -ne "All" -and $locId -ne "AllTrusted") {
                    if (-not $locationUsage.ContainsKey($locId)) {
                        $locationUsage[$locId] = @{ includedIn = @(); excludedFrom = @() }
                    }
                    $locationUsage[$locId].excludedFrom += @{
                        policyId = $policy.Id
                        policyName = $policyName
                        policyState = $policyState
                    }
                }
            }
        }
    }

    # Process each location
    $processedLocations = @()
    $blockedCountriesList = @()
    $allowedCountriesList = @()
    $summary = @{
        totalLocations = 0
        ipRangeLocations = 0
        countryLocations = 0
        trustedLocations = 0
        untrustedLocations = 0
        usedLocations = 0
        unusedLocations = 0
        totalIpRanges = 0
        totalCountries = 0
        blockedCountries = 0
        allowedCountries = 0
    }

    foreach ($location in $locations) {
        $locationType = $location.AdditionalProperties.'@odata.type'
        $locationId = $location.Id
        $displayName = $location.DisplayName
        $createdDateTime = $location.CreatedDateTime
        $modifiedDateTime = $location.ModifiedDateTime

        $isTrusted = $false
        $ipRanges = @()
        $countriesAndRegions = @()
        $includeUnknownCountries = $false

        # IP-based location
        if ($locationType -eq "#microsoft.graph.ipNamedLocation") {
            $isTrusted = [bool]$location.AdditionalProperties.isTrusted
            $ranges = $location.AdditionalProperties.ipRanges
            if ($ranges) {
                foreach ($range in $ranges) {
                    $cidr = $range.cidrAddress
                    $ipRanges += @{
                        type = $range.'@odata.type'.Replace("#microsoft.graph.", "").Replace("Range", "")
                        cidrAddress = $cidr
                    }
                }
            }
            $summary.ipRangeLocations++
            $summary.totalIpRanges += $ipRanges.Count
        }
        # Country-based location
        elseif ($locationType -eq "#microsoft.graph.countryNamedLocation") {
            $countriesAndRegions = @($location.AdditionalProperties.countriesAndRegions)
            $includeUnknownCountries = [bool]$location.AdditionalProperties.includeUnknownCountriesAndRegions
            $summary.countryLocations++
            $summary.totalCountries += $countriesAndRegions.Count
        }

        if ($isTrusted) { $summary.trustedLocations++ } else { $summary.untrustedLocations++ }

        # Check usage
        $usage = $locationUsage[$locationId]
        $isUsed = ($null -ne $usage -and ($usage.includedIn.Count -gt 0 -or $usage.excludedFrom.Count -gt 0))
        $usedByPolicies = @()
        $isBlockedLocation = $false
        $isAllowedLocation = $false
        if ($usage) {
            $usedByPolicies = @($usage.includedIn + $usage.excludedFrom | ForEach-Object { $_.policyName } | Sort-Object -Unique)
            # If location is included in policies (targeted for blocking/restrictions), it's a "blocked" location
            # If location is excluded from policies (trusted/allowed), it's an "allowed" location
            if ($usage.includedIn.Count -gt 0) { $isBlockedLocation = $true }
            if ($usage.excludedFrom.Count -gt 0) { $isAllowedLocation = $true }
        }

        if ($isUsed) { $summary.usedLocations++ } else { $summary.unusedLocations++ }

        # Track country counts for blocked/allowed
        if ($countriesAndRegions.Count -gt 0) {
            if ($isBlockedLocation) {
                $blockedCountriesList += $countriesAndRegions
                $summary.blockedCountries += $countriesAndRegions.Count
            }
            if ($isAllowedLocation -or $isTrusted) {
                $allowedCountriesList += $countriesAndRegions
                $summary.allowedCountries += $countriesAndRegions.Count
            }
        }

        # Build flags
        $flags = @()
        if ($isTrusted) { $flags += "trusted" }
        if (-not $isUsed) { $flags += "unused" }
        if ($ipRanges.Count -gt 10) { $flags += "many-ranges" }
        if ($includeUnknownCountries) { $flags += "unknown-countries" }

        $processedLocation = [PSCustomObject]@{
            id                       = $locationId
            displayName              = $displayName
            locationType             = if ($locationType -eq "#microsoft.graph.ipNamedLocation") { "ipRange" } else { "country" }
            isTrusted                = $isTrusted
            createdDateTime          = if ($createdDateTime) { $createdDateTime.ToString("o") } else { $null }
            modifiedDateTime         = if ($modifiedDateTime) { $modifiedDateTime.ToString("o") } else { $null }
            # IP-based details
            ipRanges                 = $ipRanges
            ipRangeCount             = $ipRanges.Count
            # Country-based details
            countriesAndRegions      = $countriesAndRegions
            countryCount             = $countriesAndRegions.Count
            includeUnknownCountries  = $includeUnknownCountries
            # Usage
            isUsed                   = $isUsed
            usedByPolicies           = $usedByPolicies
            usedByPolicyCount        = $usedByPolicies.Count
            # Metadata
            flags                    = $flags
        }

        $processedLocations += $processedLocation
        $locationCount++
        $summary.totalLocations++
    }

    # Sort: trusted first, then by usage
    $processedLocations = $processedLocations | Sort-Object -Property @{
        Expression = { $_.isTrusted }; Descending = $true
    }, @{
        Expression = { $_.isUsed }; Descending = $true
    }, displayName

    # Build insights
    $insights = @()

    if ($summary.unusedLocations -gt 0) {
        $insights += @{
            id = "unused-locations"
            title = "Unused Named Locations"
            severity = "info"
            count = $summary.unusedLocations
            description = "$($summary.unusedLocations) named locations are defined but not used in any Conditional Access policy."
            recommendedAction = "Review unused locations and remove if no longer needed to simplify configuration."
        }
    }

    if ($summary.trustedLocations -eq 0 -and $summary.totalLocations -gt 0) {
        $insights += @{
            id = "no-trusted-locations"
            title = "No Trusted Locations Defined"
            severity = "warning"
            count = 0
            description = "No named locations are marked as trusted. This limits location-based security policies."
            recommendedAction = "Consider marking corporate network IP ranges as trusted for MFA bypass or risk-based policies."
        }
    }

    $unknownCountryLocations = ($processedLocations | Where-Object { $_.includeUnknownCountries }).Count
    if ($unknownCountryLocations -gt 0) {
        $insights += @{
            id = "unknown-countries-included"
            title = "Locations Including Unknown Countries"
            severity = "warning"
            count = $unknownCountryLocations
            description = "$unknownCountryLocations country-based locations include 'unknown countries', which may be risky."
            recommendedAction = "Review if including unknown countries is intentional and necessary."
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        locations = $processedLocations
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $locationCount named locations ($($summary.trustedLocations) trusted)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $locationCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Premium|P1|P2") {
        Write-Host "    [!] Named locations require Policy.Read.All permission and Entra ID P1/P2" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        locations = @()
        summary = @{ totalLocations = 0 }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
