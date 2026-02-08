# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects sensitivity labels and information protection data from Microsoft Purview.

.DESCRIPTION
    Retrieves sensitivity labels, label policies, and protection settings.
    This is CRITICAL for data classification and protection - understanding
    how sensitive data is labeled and protected.

    Collects:
    - Sensitivity labels with their protection settings
    - Label policies and assignments
    - Auto-labeling configurations
    - Encryption and marking settings

    Graph API endpoints (beta):
    - GET /security/informationProtection/sensitivityLabels
    - GET /security/informationProtection/sensitivityLabels/{id}/sublabels

    Required scopes:
    - InformationProtectionPolicy.Read

    Note: Requires Microsoft 365 E5 or E5 Information Protection add-on.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes sensitivity-labels-data.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-SensitivityLabelsData.ps1 -Config $config -OutputPath ".\data\sensitivity-labels-data.json"
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
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$labelCount = 0

try {
    Write-Host "    Collecting sensitivity labels data..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Get all sensitivity labels
    # -----------------------------------------------------------------------
    $labels = @()
    try {
        Write-Host "      Fetching sensitivity labels..." -ForegroundColor Gray

        $labelsResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels" `
                -OutputType PSObject
        } -OperationName "Sensitivity labels retrieval"

        if ($labelsResponse.value) {
            $labels = @($labelsResponse.value)
        }

        # Handle pagination
        while ($labelsResponse.'@odata.nextLink') {
            $labelsResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $labelsResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Sensitivity labels pagination"
            if ($labelsResponse.value) {
                $labels += $labelsResponse.value
            }
        }

        Write-Host "      Retrieved $($labels.Count) sensitivity labels" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Could not retrieve sensitivity labels: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Sensitivity labels: $($_.Exception.Message)"
    }

    # -----------------------------------------------------------------------
    # 2. Process each label
    # -----------------------------------------------------------------------
    $processedLabels = @()
    $summary = @{
        totalLabels = 0
        parentLabels = 0
        subLabels = 0
        encryptionLabels = 0
        markingLabels = 0
        autoLabelingLabels = 0
        containerLabels = 0
        fileLabels = 0
        emailLabels = 0
        meetingLabels = 0
        protectionTiers = @{
            confidential = 0
            highlyConfidential = 0
            internal = 0
            public = 0
            other = 0
        }
    }

    foreach ($label in $labels) {
        $labelId = $label.id
        $displayName = $label.name
        $description = $label.description
        $tooltip = $label.tooltip
        $priority = $label.priority
        $isActive = $label.isActive
        $parent = $label.parent
        $color = $label.color

        # Determine if parent or sublabel
        $isParent = ($null -eq $parent -or $parent -eq "")
        if ($isParent) {
            $summary.parentLabels++
        }
        else {
            $summary.subLabels++
        }

        # Protection settings
        $hasEncryption = $false
        $hasMarking = $false
        $hasAutoLabeling = $false
        $encryptionSettings = $null
        $markingSettings = $null

        # Check content settings
        $contentFormats = @()
        if ($label.contentFormats) {
            $contentFormats = @($label.contentFormats)
            if ($contentFormats -contains "file") {
                $summary.fileLabels++
            }
            if ($contentFormats -contains "email") {
                $summary.emailLabels++
            }
        }

        # Check for scope settings
        $isFileLabel = $contentFormats -contains "file"
        $isEmailLabel = $contentFormats -contains "email"
        $isSiteLabel = $false
        $isGroupLabel = $false
        $isMeetingLabel = $false

        # Parse application mode and settings
        if ($label.siteAndGroupProtectionEnabled) {
            $isSiteLabel = $true
            $isGroupLabel = $true
            $summary.containerLabels++
        }
        if ($label.meetingsProtectionEnabled) {
            $isMeetingLabel = $true
            $summary.meetingLabels++
        }

        # Check protection settings from additional properties
        $settings = $label.settings
        if ($settings) {
            # Check for encryption
            if ($settings.encryptionEnabled -or $settings.protectionEnabled) {
                $hasEncryption = $true
                $summary.encryptionLabels++
                $encryptionSettings = @{
                    enabled = $true
                    contentExpires = $settings.contentExpires
                    offlineAccessDays = $settings.offlineAccessDays
                }
            }

            # Check for markings (headers, footers, watermarks)
            if ($settings.headerEnabled -or $settings.footerEnabled -or $settings.watermarkEnabled) {
                $hasMarking = $true
                $summary.markingLabels++
                $markingSettings = @{
                    headerEnabled = [bool]$settings.headerEnabled
                    headerText = $settings.headerText
                    footerEnabled = [bool]$settings.footerEnabled
                    footerText = $settings.footerText
                    watermarkEnabled = [bool]$settings.watermarkEnabled
                    watermarkText = $settings.watermarkText
                }
            }
        }

        # Auto-labeling check
        if ($label.autoLabeling -and $label.autoLabeling.sensitiveTypeIds) {
            $hasAutoLabeling = $true
            $summary.autoLabelingLabels++
        }

        # Categorize by protection tier
        $protectionTier = "other"
        $displayNameLower = $displayName.ToLower()
        if ($displayNameLower -match "highly.?confidential|restricted|secret") {
            $protectionTier = "highlyConfidential"
            $summary.protectionTiers.highlyConfidential++
        }
        elseif ($displayNameLower -match "confidential") {
            $protectionTier = "confidential"
            $summary.protectionTiers.confidential++
        }
        elseif ($displayNameLower -match "internal|general") {
            $protectionTier = "internal"
            $summary.protectionTiers.internal++
        }
        elseif ($displayNameLower -match "public|non.?business") {
            $protectionTier = "public"
            $summary.protectionTiers.public++
        }
        else {
            $summary.protectionTiers.other++
        }

        # Build flags
        $flags = @()
        if ($hasEncryption) { $flags += "encrypted" }
        if ($hasMarking) { $flags += "marked" }
        if ($hasAutoLabeling) { $flags += "auto-labeling" }
        if ($isSiteLabel) { $flags += "containers" }
        if ($isMeetingLabel) { $flags += "meetings" }
        if (-not $isActive) { $flags += "inactive" }
        if ($protectionTier -eq "highlyConfidential") { $flags += "high-protection" }

        $processedLabel = [PSCustomObject]@{
            id                  = $labelId
            displayName         = $displayName
            description         = $description
            tooltip             = $tooltip
            color               = $color
            priority            = $priority
            isActive            = [bool]$isActive
            isParent            = $isParent
            parentId            = $parent
            protectionTier      = $protectionTier
            # Scope
            contentFormats      = $contentFormats
            isFileLabel         = $isFileLabel
            isEmailLabel        = $isEmailLabel
            isSiteLabel         = $isSiteLabel
            isGroupLabel        = $isGroupLabel
            isMeetingLabel      = $isMeetingLabel
            # Protection
            hasEncryption       = $hasEncryption
            hasMarking          = $hasMarking
            hasAutoLabeling     = $hasAutoLabeling
            encryptionSettings  = $encryptionSettings
            markingSettings     = $markingSettings
            # Metadata
            flags               = $flags
        }

        $processedLabels += $processedLabel
        $labelCount++
        $summary.totalLabels++
    }

    # Sort labels by priority (lower = higher priority in hierarchy)
    $processedLabels = $processedLabels | Sort-Object -Property priority

    # -----------------------------------------------------------------------
    # 3. Get sublabels for parent labels
    # -----------------------------------------------------------------------
    $parentLabels = $processedLabels | Where-Object { $_.isParent }
    foreach ($parent in $parentLabels) {
        try {
            $sublabelsResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels/$($parent.id)/sublabels" `
                    -OutputType PSObject
            } -OperationName "Sublabels for $($parent.displayName)"

            if ($sublabelsResponse.value) {
                $parent | Add-Member -NotePropertyName "sublabelIds" -NotePropertyValue @($sublabelsResponse.value | ForEach-Object { $_.id }) -Force
                $parent | Add-Member -NotePropertyName "sublabelCount" -NotePropertyValue $sublabelsResponse.value.Count -Force
            }
            else {
                $parent | Add-Member -NotePropertyName "sublabelIds" -NotePropertyValue @() -Force
                $parent | Add-Member -NotePropertyName "sublabelCount" -NotePropertyValue 0 -Force
            }
        }
        catch {
            $parent | Add-Member -NotePropertyName "sublabelIds" -NotePropertyValue @() -Force
            $parent | Add-Member -NotePropertyName "sublabelCount" -NotePropertyValue 0 -Force
        }
    }

    # -----------------------------------------------------------------------
    # 4. Build insights
    # -----------------------------------------------------------------------
    $insights = @()

    if ($summary.totalLabels -eq 0) {
        $insights += @{
            id = "no-sensitivity-labels"
            title = "No Sensitivity Labels Configured"
            severity = "warning"
            count = 0
            description = "No sensitivity labels are configured in the tenant."
            recommendedAction = "Create sensitivity labels to classify and protect sensitive data across Microsoft 365."
        }
    }

    if ($summary.encryptionLabels -eq 0 -and $summary.totalLabels -gt 0) {
        $insights += @{
            id = "no-encryption-labels"
            title = "No Encryption-Protected Labels"
            severity = "warning"
            count = 0
            description = "No sensitivity labels are configured with encryption protection."
            recommendedAction = "Add encryption to high-sensitivity labels to protect confidential documents."
        }
    }

    if ($summary.autoLabelingLabels -gt 0) {
        $insights += @{
            id = "auto-labeling-configured"
            title = "Auto-Labeling Enabled"
            severity = "info"
            count = $summary.autoLabelingLabels
            description = "$($summary.autoLabelingLabels) labels have auto-labeling configured for automatic classification."
            recommendedAction = "Review auto-labeling rules to ensure accurate classification of sensitive content."
        }
    }

    $inactiveLabels = ($processedLabels | Where-Object { -not $_.isActive }).Count
    if ($inactiveLabels -gt 0) {
        $insights += @{
            id = "inactive-labels"
            title = "Inactive Sensitivity Labels"
            severity = "info"
            count = $inactiveLabels
            description = "$inactiveLabels sensitivity labels are inactive and not available for use."
            recommendedAction = "Review inactive labels - activate if needed or remove if obsolete."
        }
    }

    if ($summary.protectionTiers.highlyConfidential -eq 0 -and $summary.totalLabels -gt 3) {
        $insights += @{
            id = "no-high-protection-tier"
            title = "No High-Protection Labels"
            severity = "warning"
            count = 0
            description = "No labels are designated for highly confidential or restricted content."
            recommendedAction = "Create a highly confidential label tier with encryption for your most sensitive data."
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        labels = $processedLabels
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
        apiNote = "Sensitivity labels require Microsoft 365 E5 or Information Protection add-on."
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $labelCount sensitivity labels ($($summary.encryptionLabels) with encryption)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $labelCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|license|E5|Protection") {
        Write-Host "    [!] Sensitivity labels require E5 license and InformationProtectionPolicy.Read permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        labels = @()
        summary = @{
            totalLabels = 0
            encryptionLabels = 0
        }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
