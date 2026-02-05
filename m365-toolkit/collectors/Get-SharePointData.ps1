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
# HELPER FUNCTIONS
# ============================================================================

function Get-DaysSinceDate {
    <#
    .SYNOPSIS
        Calculates days between a given date and now.
    #>
    param(
        [Parameter()]
        [AllowNull()]
        $DateValue
    )

    if ($null -eq $DateValue) {
        return $null
    }

    try {
        $date = if ($DateValue -is [DateTime]) { $DateValue } else { [DateTime]::Parse($DateValue) }
        $days = ((Get-Date) - $date).Days
        return [Math]::Max(0, $days)
    }
    catch {
        return $null
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
    }

    if (-not (Test-Path $tempCsvPath)) {
        throw "SharePoint usage report was not downloaded"
    }

    $reportData = Import-Csv -Path $tempCsvPath
    Write-Host "      Report contains $($reportData.Count) sites" -ForegroundColor Gray

    # ========================================================================
    # Process each site from the report
    # ========================================================================

    $processedSites = @()

    foreach ($row in $reportData) {
        try {
            $siteUrl = $row.'Site URL'
            $siteId = $row.'Site Id'

            if ([string]::IsNullOrWhiteSpace($siteUrl)) { continue }

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

            $createdDate = $row.'Site Created Date'
            if ([string]::IsNullOrWhiteSpace($createdDate)) { $createdDate = $null }

            # Classify template and personal site status
            $rootWebTemplate = $row.'Root Web Template'
            $template = Get-SiteTemplate -RootWebTemplate $rootWebTemplate -SiteUrl $siteUrl
            $isPersonalSite = ($template -eq "OneDrive")

            # Determine group connection
            $groupId = $row.'Group Id'
            $isGroupConnected = (-not [string]::IsNullOrWhiteSpace($groupId))

            # Calculate activity status
            $daysSinceActivity = Get-DaysSinceDate -DateValue $lastActivityDate
            $isInactive = ($null -ne $daysSinceActivity -and $daysSinceActivity -ge $inactiveThreshold) -or
                          ($null -eq $lastActivityDate)

            # Owner info from report
            $ownerName = $row.'Owner Display Name'
            $ownerUpn = $row.'Owner Principal Name'
            $siteName = $row.'Site URL'.Split('/')[-1]

            # Use a display name from the report if available
            $displayName = if ($ownerName -and $template -eq "OneDrive") {
                "$ownerName - OneDrive"
            } else {
                $siteName
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
                groupId             = if ($isGroupConnected) { $groupId } else { $null }
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

    # Write results to JSON file
    $processedSites | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    Collected $siteCount SharePoint sites" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $siteCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|unauthorized") {
        Write-Host "    SharePoint collection requires Reports.Read.All and Sites.Read.All permissions" -ForegroundColor Yellow
    }

    Write-Host "    Failed: $errorMessage" -ForegroundColor Red

    # Clean up temp file if it exists
    if ($tempCsvPath -and (Test-Path $tempCsvPath)) {
        Remove-Item -Path $tempCsvPath -Force -ErrorAction SilentlyContinue
    }

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
