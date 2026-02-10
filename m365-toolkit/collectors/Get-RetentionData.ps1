# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects retention policies and labels from Microsoft Purview Compliance.

.DESCRIPTION
    Retrieves retention policies and retention labels for compliance governance.
    This is CRITICAL for regulatory compliance - GDPR, HIPAA, SOX all require
    documented retention policies.

    Collects:
    - Retention policies (locations, duration, actions)
    - Retention labels (for manual/auto-labeling)
    - Policy assignments

    Graph API endpoints (beta):
    - GET /security/labels/retentionLabels
    - GET /security/triggerTypes/retentionEventTypes

    Note: Full retention policy details require Security & Compliance PowerShell
    or Purview Compliance APIs which have limited Graph support.

    Required scopes:
    - RecordsManagement.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes retention-data.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-RetentionData.ps1 -Config $config -OutputPath ".\data\retention-data.json"
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
$itemCount = 0

try {
    Write-Host "    Collecting retention data..." -ForegroundColor Gray

    $retentionLabels = @()
    $retentionEventTypes = @()

    # -----------------------------------------------------------------------
    # 1. Get retention labels (beta endpoint)
    # -----------------------------------------------------------------------
    try {
        Write-Host "      Fetching retention labels..." -ForegroundColor Gray

        $labelsResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/security/labels/retentionLabels" `
                -OutputType PSObject
        } -OperationName "Retention labels retrieval"

        if ($labelsResponse.value) {
            $retentionLabels = @($labelsResponse.value)
        }

        # Handle pagination
        while ($labelsResponse.'@odata.nextLink') {
            $labelsResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $labelsResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Retention labels pagination"
            if ($labelsResponse.value) {
                $retentionLabels += $labelsResponse.value
            }
        }

        Write-Host "      Retrieved $($retentionLabels.Count) retention labels" -ForegroundColor Gray
    }
    catch {
        if ($_.Exception.Message -match "InternalServerError|500") {
            Write-Host "      [!] Retention labels API unavailable - requires M365 E5 Compliance or Purview license" -ForegroundColor Yellow
            $errors += "Retention labels require Microsoft Purview/E5 Compliance license"
        }
        elseif ($_.Exception.Message -match "Forbidden|403|Authorization") {
            Write-Host "      [!] Retention labels require RecordsManagement.Read.All permission" -ForegroundColor Yellow
            $errors += "Retention labels require RecordsManagement.Read.All permission"
        }
        else {
            Write-Host "      Could not retrieve retention labels: $($_.Exception.Message)" -ForegroundColor Yellow
            $errors += "Retention labels: $($_.Exception.Message)"
        }
    }

    # -----------------------------------------------------------------------
    # 2. Get retention event types (for event-based retention)
    # -----------------------------------------------------------------------
    try {
        Write-Host "      Fetching retention event types..." -ForegroundColor Gray

        $eventTypesResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/security/triggerTypes/retentionEventTypes" `
                -OutputType PSObject
        } -OperationName "Retention event types retrieval"

        if ($eventTypesResponse.value) {
            $retentionEventTypes = @($eventTypesResponse.value)
        }

        Write-Host "      Retrieved $($retentionEventTypes.Count) retention event types" -ForegroundColor Gray
    }
    catch {
        if ($_.Exception.Message -match "InternalServerError|500|Forbidden|403") {
            Write-Host "      [!] Event types unavailable (requires M365 E5 Compliance license)" -ForegroundColor Yellow
        }
        else {
            Write-Host "      Could not retrieve event types: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        # Not critical, continue
    }

    # -----------------------------------------------------------------------
    # 3. Process retention labels
    # -----------------------------------------------------------------------
    $processedLabels = @()
    $summary = @{
        totalLabels = 0
        recordLabels = 0
        retentionLabels = 0
        regulatoryLabels = 0
        eventBasedLabels = 0
        deletionLabels = 0
        permanentLabels = 0
        avgRetentionDays = 0
    }

    $totalRetentionDays = 0
    $retentionCount = 0

    foreach ($label in $retentionLabels) {
        $labelId = $label.id
        $displayName = $label.displayName
        $description = $label.descriptionForUsers
        $isInUse = $label.isInUse
        $createdDateTime = $label.createdDateTime
        $lastModifiedDateTime = $label.lastModifiedDateTime

        # Behavior during retention
        $behaviorDuringRetention = $label.behaviorDuringRetentionPeriod
        $actionAfterRetention = $label.actionAfterRetentionPeriod
        $retentionDuration = $label.retentionDuration
        $retentionTrigger = $label.retentionTrigger

        # Parse retention duration
        $retentionDays = $null
        $retentionYears = $null
        $isUnlimited = $false
        if ($retentionDuration) {
            if ($retentionDuration -eq "unlimited") {
                $isUnlimited = $true
            }
            elseif ($retentionDuration -match "P(\d+)D") {
                $retentionDays = [int]$Matches[1]
                $retentionYears = [Math]::Round($retentionDays / 365, 1)
                $totalRetentionDays += $retentionDays
                $retentionCount++
            }
            elseif ($retentionDuration -match "P(\d+)Y") {
                $retentionYears = [int]$Matches[1]
                $retentionDays = $retentionYears * 365
                $totalRetentionDays += $retentionDays
                $retentionCount++
            }
        }

        # Label type detection
        $labelType = "retention"
        $isRecordLabel = $false
        $isRegulatoryRecord = $false

        if ($label.labelToBeApplied -match "record" -or $behaviorDuringRetention -eq "retainAsRecord") {
            $isRecordLabel = $true
            $labelType = "record"
            $summary.recordLabels++
        }
        if ($label.isRecordLocked -or $behaviorDuringRetention -eq "retainAsRegulatoryRecord") {
            $isRegulatoryRecord = $true
            $labelType = "regulatory-record"
            $summary.regulatoryLabels++
        }

        # Event-based detection
        $isEventBased = ($null -ne $retentionTrigger -and $retentionTrigger -ne "dateLabeled" -and $retentionTrigger -ne "dateCreated")
        if ($isEventBased) { $summary.eventBasedLabels++ }

        # Action after retention
        if ($actionAfterRetention -eq "delete") { $summary.deletionLabels++ }
        if ($isUnlimited) { $summary.permanentLabels++ }

        # Build flags
        $flags = @()
        if ($isRecordLabel) { $flags += "record" }
        if ($isRegulatoryRecord) { $flags += "regulatory" }
        if ($isEventBased) { $flags += "event-based" }
        if ($isInUse) { $flags += "in-use" }
        if ($isUnlimited) { $flags += "permanent" }

        $processedLabel = [PSCustomObject]@{
            id                        = $labelId
            displayName               = $displayName
            description               = $description
            labelType                 = $labelType
            isRecordLabel             = $isRecordLabel
            isRegulatoryRecord        = $isRegulatoryRecord
            isEventBased              = $isEventBased
            isInUse                   = [bool]$isInUse
            # Retention settings
            behaviorDuringRetention   = $behaviorDuringRetention
            actionAfterRetention      = $actionAfterRetention
            retentionDuration         = $retentionDuration
            retentionDays             = $retentionDays
            retentionYears            = $retentionYears
            isUnlimited               = $isUnlimited
            retentionTrigger          = $retentionTrigger
            # Metadata
            createdDateTime           = $createdDateTime
            lastModifiedDateTime      = $lastModifiedDateTime
            flags                     = $flags
        }

        $processedLabels += $processedLabel
        $itemCount++
        $summary.totalLabels++
    }

    # Calculate average retention
    if ($retentionCount -gt 0) {
        $summary.avgRetentionDays = [Math]::Round($totalRetentionDays / $retentionCount, 0)
    }

    # Process event types
    $processedEventTypes = @()
    foreach ($eventType in $retentionEventTypes) {
        $processedEventTypes += [PSCustomObject]@{
            id          = $eventType.id
            displayName = $eventType.displayName
            description = $eventType.description
            createdDateTime = $eventType.createdDateTime
        }
    }

    # Sort labels by usage and type
    $processedLabels = $processedLabels | Sort-Object -Property @{
        Expression = { $_.isInUse }; Descending = $true
    }, @{
        Expression = { $_.isRegulatoryRecord }; Descending = $true
    }, displayName

    # Build insights
    $insights = @()

    if ($summary.totalLabels -eq 0) {
        $insights += @{
            id = "no-retention-labels"
            title = "No Retention Labels Defined"
            severity = "warning"
            count = 0
            description = "No retention labels are configured. This may indicate compliance gaps."
            recommendedAction = "Create retention labels for regulatory compliance (GDPR, HIPAA, SOX, etc.)"
        }
    }

    $unusedLabels = ($processedLabels | Where-Object { -not $_.isInUse }).Count
    if ($unusedLabels -gt 0 -and $summary.totalLabels -gt 0) {
        $insights += @{
            id = "unused-labels"
            title = "Unused Retention Labels"
            severity = "info"
            count = $unusedLabels
            description = "$unusedLabels retention labels are defined but not in use."
            recommendedAction = "Apply labels to content or remove if no longer needed."
        }
    }

    if ($summary.regulatoryLabels -gt 0) {
        $insights += @{
            id = "regulatory-labels"
            title = "Regulatory Record Labels"
            severity = "info"
            count = $summary.regulatoryLabels
            description = "$($summary.regulatoryLabels) labels enforce regulatory records management."
            recommendedAction = "Ensure regulatory labels are applied to required content."
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        labels = $processedLabels
        eventTypes = $processedEventTypes
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
        apiNote = "Full retention policy details require Security & Compliance PowerShell. Graph API provides label definitions only."
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $itemCount retention labels" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $itemCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|license|E5|Compliance") {
        Write-Host "    [!] Retention data requires Microsoft 365 E5/Compliance license and RecordsManagement.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        labels = @()
        eventTypes = @()
        summary = @{ totalLabels = 0 }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
