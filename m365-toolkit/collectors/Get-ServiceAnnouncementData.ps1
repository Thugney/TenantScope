# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Microsoft 365 admin service announcements.

.DESCRIPTION
    Collects both Message Center communications and Service Health status
    from the Microsoft Graph serviceAnnouncement endpoints.

    Graph API endpoints:
    - GET /admin/serviceAnnouncement/messages
    - GET /admin/serviceAnnouncement/healthOverviews?$expand=issues

    Required scopes:
    - ServiceMessage.Read.All
    - ServiceHealth.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes service-announcements.json to the specified output path.
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

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$messageCount = 0
$serviceCount = 0
$issueCount = 0

try {
    Write-Host "    Collecting admin service announcements..." -ForegroundColor Gray

    $rawMessages = @()
    $rawHealth = @()

    try {
        $rawMessages = Get-GraphAllPages -Uri "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/messages?`$top=100" -OperationName "Message Center"
    }
    catch {
        Write-Host "      [!] Could not fetch Message Center: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Message Center unavailable: $($_.Exception.Message)"
    }

    try {
        $rawHealth = Get-GraphAllPages -Uri "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews?`$expand=issues" -OperationName "Service Health"
    }
    catch {
        Write-Host "      [!] Could not fetch Service Health: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Service Health unavailable: $($_.Exception.Message)"
    }

    $processedMessages = @()
    foreach ($msg in $rawMessages) {
        $services = Get-GraphPropertyValue -Object $msg -PropertyNames @("services", "Services")
        if ($services -and $services -isnot [System.Collections.IEnumerable]) {
            $services = @($services)
        }
        elseif ($services -is [string]) {
            $services = @($services)
        }

        $processedMessages += [PSCustomObject]@{
            id                       = Get-GraphPropertyValue -Object $msg -PropertyNames @("id", "Id")
            title                    = Get-GraphPropertyValue -Object $msg -PropertyNames @("title", "Title", "subject", "Subject")
            severity                 = Get-GraphPropertyValue -Object $msg -PropertyNames @("severity", "Severity")
            category                 = Get-GraphPropertyValue -Object $msg -PropertyNames @("category", "Category")
            services                 = $services
            status                   = Get-GraphPropertyValue -Object $msg -PropertyNames @("status", "Status")
            tags                     = Get-GraphPropertyValue -Object $msg -PropertyNames @("tags", "Tags")
            isMajorChange            = [bool](Get-GraphPropertyValue -Object $msg -PropertyNames @("isMajorChange", "IsMajorChange"))
            startDateTime            = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $msg -PropertyNames @("startDateTime", "StartDateTime"))
            endDateTime              = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $msg -PropertyNames @("endDateTime", "EndDateTime"))
            lastModifiedDateTime     = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $msg -PropertyNames @("lastModifiedDateTime", "LastModifiedDateTime"))
            actionRequiredByDateTime = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $msg -PropertyNames @("actionRequiredByDateTime", "ActionRequiredByDateTime"))
        }
    }

    $processedMessages = $processedMessages | Sort-Object -Property @{ Expression = { $_.lastModifiedDateTime }; Descending = $true }
    $messageCount = $processedMessages.Count

    $processedHealth = @()
    foreach ($health in $rawHealth) {
        $issuesRaw = Get-GraphPropertyValue -Object $health -PropertyNames @("issues", "Issues")
        $issues = @()
        if ($issuesRaw) {
            foreach ($issue in $issuesRaw) {
                $issues += [PSCustomObject]@{
                    id                  = Get-GraphPropertyValue -Object $issue -PropertyNames @("id", "Id")
                    title               = Get-GraphPropertyValue -Object $issue -PropertyNames @("title", "Title")
                    classification      = Get-GraphPropertyValue -Object $issue -PropertyNames @("classification", "Classification")
                    status              = Get-GraphPropertyValue -Object $issue -PropertyNames @("status", "Status")
                    feature             = Get-GraphPropertyValue -Object $issue -PropertyNames @("feature", "Feature")
                    impactDescription   = Get-GraphPropertyValue -Object $issue -PropertyNames @("impactDescription", "ImpactDescription")
                    startDateTime       = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $issue -PropertyNames @("startDateTime", "StartDateTime"))
                    endDateTime         = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $issue -PropertyNames @("endDateTime", "EndDateTime"))
                    lastModifiedDateTime = Format-IsoDate -DateValue (Get-GraphPropertyValue -Object $issue -PropertyNames @("lastModifiedDateTime", "LastModifiedDateTime"))
                }
            }
        }

        $processedHealth += [PSCustomObject]@{
            service = Get-GraphPropertyValue -Object $health -PropertyNames @("service", "Service")
            status  = Get-GraphPropertyValue -Object $health -PropertyNames @("status", "Status")
            issues  = $issues
        }
    }

    $serviceCount = $processedHealth.Count
    $issueCount = ($processedHealth | ForEach-Object { if ($_.issues) { $_.issues.Count } else { 0 } } | Measure-Object -Sum).Sum

    $output = [PSCustomObject]@{
        metadata = [PSCustomObject]@{
            collectedAt  = (Get-Date).ToString("o")
            messageCount = $messageCount
            serviceCount = $serviceCount
            issueCount   = $issueCount
        }
        messageCenter = $processedMessages
        serviceHealth = $processedHealth
    }

    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $messageCount message center items and $issueCount service health issues" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count ($messageCount + $issueCount) -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        metadata = [PSCustomObject]@{
            collectedAt = (Get-Date).ToString("o")
            error       = $errorMessage
        }
        messageCenter = @()
        serviceHealth = @()
    }

    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
