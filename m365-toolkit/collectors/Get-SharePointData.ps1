# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter SharePoint-data fra Microsoft Graph.

.DESCRIPTION
    Collects SharePoint Online site usage data from the Microsoft Graph
    Reports API. Retrieves storage consumption, file activity, page views,
    and site metadata for all sites in the tenant.

    Uses the SharePoint site usage detail report which provides comprehensive
    data in a single API call without per-site N+1 queries.

    Graph API endpoint:
    - GET /beta/reports/getSharePointSiteUsageDetail(period='D30')

    Uses the beta endpoint which includes additional sharing/governance
    columns: External Sharing, Anonymous Link Count, Company Link Count,
    Secure Link For Guest Count, Secure Link For Member Count,
    Site Sensitivity Label Id, Unmanaged Device Policy, Visited Page Count.

    Required scopes:
    - Reports.Read.All
    - Sites.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes sharepoint-sites.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of sites collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-SharePointData.ps1 -Config $config -OutputPath ".\data\sharepoint-sites.json"
#>

#Requires -Version 7.0

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# LOCAL HELPER FUNCTIONS
# ============================================================================

function Get-SiteTemplate {
    <#
    .SYNOPSIS
        Classifies a SharePoint site by its root web template.

    .PARAMETER RootWebTemplate
        The Root Web Template value from the usage report.

    .PARAMETER SiteUrl
        The site URL used for additional classification.

    .OUTPUTS
        String: Group, Communication, OneDrive, or Other.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        [string]$RootWebTemplate,

        [Parameter()]
        [AllowNull()]
        [string]$SiteUrl
    )

    # OneDrive personal sites
    if ($SiteUrl -and $SiteUrl -match "-my\.sharepoint\.com/personal/") {
        return "OneDrive"
    }

    if ([string]::IsNullOrWhiteSpace($RootWebTemplate)) {
        return "Other"
    }

    $template = $RootWebTemplate.ToLower()

    if ($template -match "group") { return "Group" }
    if ($template -match "communication|sitepagepublishing") { return "Communication" }
    if ($template -match "onedrive|spspers|mysitehost") { return "OneDrive" }

    return "Other"
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$siteCount = 0

try {
    Write-Host "    Collecting SharePoint site usage data..." -ForegroundColor Gray

    # Get thresholds from config
    $inactiveThreshold = $Config.thresholds.inactiveSiteDays
    if ($null -eq $inactiveThreshold -or $inactiveThreshold -le 0) {
        $inactiveThreshold = 90
    }

    $highStorageThreshold = $Config.thresholds.highStorageThresholdGB
    if ($null -eq $highStorageThreshold -or $highStorageThreshold -le 0) {
        $highStorageThreshold = 20
    }

    # ========================================================================
    # Fetch SharePoint site usage detail report
    # ========================================================================

    Write-Host "      Fetching SharePoint site usage report..." -ForegroundColor Gray

    $tempCsvPath = Join-Path ([System.IO.Path]::GetTempPath()) "sp-usage-$((Get-Date).ToString('yyyyMMddHHmmss')).csv"

    Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/beta/reports/getSharePointSiteUsageDetail(period='D30')" `
            -OutputFilePath $tempCsvPath
    } -OperationName "SharePoint usage report"

    if (-not (Test-Path $tempCsvPath)) {
        throw "SharePoint usage report was not downloaded"
    }

    $reportData = Import-Csv -Path $tempCsvPath
    Write-Host "      Report contains $($reportData.Count) sites" -ForegroundColor Gray

    # ========================================================================
    # Check if URLs are concealed (privacy settings enabled)
    # ========================================================================

    $urlsConcealed = $false
    if ($reportData.Count -gt 0) {
        $firstRow = $reportData[0]
        if ([string]::IsNullOrWhiteSpace($firstRow.'Site URL') -and -not [string]::IsNullOrWhiteSpace($firstRow.'Site Id')) {
            $urlsConcealed = $true
            Write-Host "      Site URLs are concealed - fetching from Sites API..." -ForegroundColor Yellow
        }
    }

    # Build site lookup from Sites API if URLs are concealed
    $siteLookup = @{}
    if ($urlsConcealed) {
        Write-Host "      Fetching site details from Graph Sites API..." -ForegroundColor Gray
        try {
            $allSites = @()
            # Use beta getAllSites endpoint for full enumeration
            $sitesUri = "https://graph.microsoft.com/beta/sites/getAllSites?`$top=500"

            while ($sitesUri) {
                $response = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method GET -Uri $sitesUri
                } -OperationName "SharePoint sites enumeration"
                if ($response.value) {
                    $allSites += $response.value
                }
                $sitesUri = $response.'@odata.nextLink'

                if ($allSites.Count % 500 -eq 0 -and $allSites.Count -gt 0) {
                    Write-Host "      Fetched $($allSites.Count) sites from API..." -ForegroundColor Gray
                }
            }

            Write-Host "      Retrieved $($allSites.Count) sites from Sites API" -ForegroundColor Gray

            # Build lookup by site ID (extract GUID from composite ID)
            foreach ($site in $allSites) {
                # Site ID format from Sites API: "contoso.sharepoint.com,guid1,guid2"
                # Site ID format from Reports: just the GUID
                $siteIdParts = $site.id -split ','
                if ($siteIdParts.Count -ge 2) {
                    $siteGuid = $siteIdParts[1]
                    $siteLookup[$siteGuid] = @{
                        url = $site.webUrl
                        displayName = $site.displayName
                        createdDateTime = $site.createdDateTime
                    }
                }
            }
        }
        catch {
            Write-Host "      Warning: Could not fetch sites from API: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # ========================================================================
    # Process each site from the report
    # ========================================================================

    $processedSites = @()

    $skippedCount = 0
    foreach ($row in $reportData) {
        try {
            $siteUrl = $row.'Site URL'
            $siteId = $row.'Site Id'

            # If URLs are concealed, try to get URL from lookup
            if ($urlsConcealed -and [string]::IsNullOrWhiteSpace($siteUrl) -and $siteLookup.ContainsKey($siteId)) {
                $siteUrl = $siteLookup[$siteId].url
            }

            if ([string]::IsNullOrWhiteSpace($siteUrl)) {
                $skippedCount++
                continue
            }

            # Parse storage values (report gives bytes)
            $storageUsedBytes = 0
            if ($row.'Storage Used (Byte)') {
                $storageUsedBytes = [long]$row.'Storage Used (Byte)'
            }
            $storageUsedGB = [Math]::Round($storageUsedBytes / 1GB, 2)

            $storageAllocatedBytes = 0
            if ($row.'Storage Allocated (Byte)') {
                $storageAllocatedBytes = [long]$row.'Storage Allocated (Byte)'
            }
            $storageAllocatedGB = [Math]::Round($storageAllocatedBytes / 1GB, 2)

            $storagePct = 0
            if ($storageAllocatedGB -gt 0) {
                $storagePct = [Math]::Round(($storageUsedGB / $storageAllocatedGB) * 100, 1)
            }

            # Parse counts
            $fileCount = if ($row.'File Count') { [int]$row.'File Count' } else { 0 }
            $activeFileCount = if ($row.'Active File Count') { [int]$row.'Active File Count' } else { 0 }
            $pageViewCount = if ($row.'Page View Count') { [int]$row.'Page View Count' } else { 0 }
            $visitedPageCount = if ($row.'Visited Page Count') { [int]$row.'Visited Page Count' } else { 0 }

            # Parse sharing/governance columns (beta endpoint)
            $externalSharing = if ($row.'External Sharing') { $row.'External Sharing' } else { $null }
            $anonymousLinkCount = if ($row.'Anonymous Link Count') { [int]$row.'Anonymous Link Count' } else { 0 }
            $companyLinkCount = if ($row.'Company Link Count') { [int]$row.'Company Link Count' } else { 0 }
            $guestLinkCount = if ($row.'Secure Link For Guest Count') { [int]$row.'Secure Link For Guest Count' } else { 0 }
            $memberLinkCount = if ($row.'Secure Link For Member Count') { [int]$row.'Secure Link For Member Count' } else { 0 }
            $sensitivityLabelId = if ($row.'Site Sensitivity Label Id' -and $row.'Site Sensitivity Label Id'.Trim()) { $row.'Site Sensitivity Label Id'.Trim() } else { $null }
            $unmanagedDevicePolicy = if ($row.'Unmanaged Device Policy' -and $row.'Unmanaged Device Policy'.Trim()) { $row.'Unmanaged Device Policy'.Trim() } else { $null }

            # Computed sharing fields
            $totalSharingLinks = $anonymousLinkCount + $companyLinkCount + $guestLinkCount + $memberLinkCount
            $hasExternalSharing = ($externalSharing -and $externalSharing -ne "Disabled" -and $externalSharing -ne "None")

            # Parse dates
            $lastActivityDate = $row.'Last Activity Date'
            if ([string]::IsNullOrWhiteSpace($lastActivityDate)) { $lastActivityDate = $null }

            # Get created date from lookup if available (report doesn't include it)
            $createdDate = $null
            if ($urlsConcealed -and $siteLookup.ContainsKey($siteId)) {
                $createdDate = $siteLookup[$siteId].createdDateTime
            }

            # Classify template and personal site status
            $rootWebTemplate = $row.'Root Web Template'
            $template = Get-SiteTemplate -RootWebTemplate $rootWebTemplate -SiteUrl $siteUrl
            $isPersonalSite = ($template -eq "OneDrive")

            # Determine group connection from template (Group Id not in report)
            $isGroupConnected = ($template -eq "Group")

            # Calculate activity status
            $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
            $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or
                          ($null -eq $lastActivityDate)

            # Owner info from report (may be concealed)
            $ownerName = $row.'Owner Display Name'
            $ownerUpn = $row.'Owner Principal Name'
            $siteName = if ($siteUrl) { $siteUrl.Split('/')[-1] } else { $siteId }

            # Use display name from lookup if available, else fall back to site name
            $displayName = $null
            if ($urlsConcealed -and $siteLookup.ContainsKey($siteId) -and $siteLookup[$siteId].displayName) {
                $displayName = $siteLookup[$siteId].displayName
            }
            if (-not $displayName) {
                $displayName = if ($ownerName -and $template -eq "OneDrive") {
                    "$ownerName - OneDrive"
                } else {
                    $siteName
                }
            }

            # Build flags array
            $flags = @()
            if ($isInactive) { $flags += "inactive" }
            if ($storageUsedGB -ge $highStorageThreshold) { $flags += "high-storage" }
            if ($isPersonalSite) { $flags += "personal" }
            if ($hasExternalSharing) { $flags += "external-sharing" }
            if ($anonymousLinkCount -gt 0) { $flags += "anonymous-links" }
            if (-not $isPersonalSite -and $null -eq $sensitivityLabelId) { $flags += "no-sensitivity-label" }

            # Build output object
            $processedSite = [PSCustomObject]@{
                id                  = $siteId
                url                 = $siteUrl
                displayName         = $displayName
                ownerPrincipalName  = $ownerUpn
                ownerDisplayName    = $ownerName
                storageUsedBytes    = $storageUsedBytes
                storageUsedGB       = $storageUsedGB
                storageAllocatedGB  = $storageAllocatedGB
                storagePct          = $storagePct
                fileCount           = $fileCount
                activeFileCount     = $activeFileCount
                pageViewCount       = $pageViewCount
                lastActivityDate    = $lastActivityDate
                daysSinceActivity   = $daysSinceActivity
                isInactive          = $isInactive
                createdDateTime     = $createdDate
                isGroupConnected    = $isGroupConnected
                template            = $template
                isPersonalSite      = $isPersonalSite
                # Sharing & governance fields (beta endpoint)
                externalSharing     = $externalSharing
                anonymousLinkCount  = $anonymousLinkCount
                companyLinkCount    = $companyLinkCount
                guestLinkCount      = $guestLinkCount
                memberLinkCount     = $memberLinkCount
                totalSharingLinks   = $totalSharingLinks
                hasExternalSharing  = [bool]$hasExternalSharing
                sensitivityLabelId  = $sensitivityLabelId
                unmanagedDevicePolicy = $unmanagedDevicePolicy
                visitedPageCount    = $visitedPageCount
                flags               = $flags
            }

            $processedSites += $processedSite
            $siteCount++

            # Progress indicator every 50 sites
            if ($siteCount % 50 -eq 0) {
                Write-Host "      Processed $siteCount sites..." -ForegroundColor Gray
            }
        }
        catch {
            $errors += "Error processing site $($row.'Site URL'): $($_.Exception.Message)"
        }
    }

    # Clean up temp file
    Remove-Item -Path $tempCsvPath -Force -ErrorAction SilentlyContinue

    # Sort by: high storage first, then inactive, then by storage descending
    $processedSites = $processedSites | Sort-Object -Property @{
        Expression = {
            if ($_.flags -contains "high-storage") { 0 }
            elseif ($_.isInactive) { 1 }
            else { 2 }
        }
    }, @{Expression = "storageUsedGB"; Descending = $true}

    # Save data using shared utility
    Save-CollectorData -Data $processedSites -OutputPath $OutputPath | Out-Null

    Write-Host "      Skipped $skippedCount sites with empty URL" -ForegroundColor Gray
    Write-Host "    [OK] Collected $siteCount SharePoint sites" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $siteCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|unauthorized") {
        Write-Host "    [!] SharePoint collection requires Reports.Read.All and Sites.Read.All permissions" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Clean up temp file if it exists
    if ($tempCsvPath -and (Test-Path $tempCsvPath)) {
        Remove-Item -Path $tempCsvPath -Force -ErrorAction SilentlyContinue
    }

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
