# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Access Review definitions and instances from Microsoft Entra ID.

.DESCRIPTION
    Retrieves access review definitions, schedules, and their status.
    This is CRITICAL for governance - access reviews ensure users still
    need the access they've been granted.

    Collects:
    - Access review definitions (scope, reviewers, schedule)
    - Review instances and their status
    - Decisions and outcomes (aggregated)
    - Review schedules and recurrence

    Graph API endpoints:
    - GET /identityGovernance/accessReviews/definitions
    - GET /identityGovernance/accessReviews/definitions/{id}/instances

    Required scopes:
    - AccessReview.Read.All

    Note: Requires Entra ID P2 license.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes access-review-data.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-AccessReviewData.ps1 -Config $config -OutputPath ".\data\access-review-data.json"
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
$reviewCount = 0

try {
    Write-Host "    Collecting Access Review data..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Get all access review definitions
    # -----------------------------------------------------------------------
    $definitions = @()
    try {
        Write-Host "      Fetching access review definitions..." -ForegroundColor Gray

        $definitionsResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/identityGovernance/accessReviews/definitions?`$top=100" `
                -OutputType PSObject
        } -OperationName "Access review definitions retrieval"

        if ($definitionsResponse.value) {
            $definitions = @($definitionsResponse.value)
        }

        # Handle pagination
        while ($definitionsResponse.'@odata.nextLink') {
            $definitionsResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $definitionsResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Access review definitions pagination"
            if ($definitionsResponse.value) {
                $definitions += $definitionsResponse.value
            }
        }

        Write-Host "      Retrieved $($definitions.Count) access review definitions" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Could not retrieve access review definitions: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "Access review definitions: $($_.Exception.Message)"
    }

    # -----------------------------------------------------------------------
    # 2. Process each definition and get instances
    # -----------------------------------------------------------------------
    $processedReviews = @()
    $summary = @{
        totalDefinitions = 0
        activeReviews = 0
        completedReviews = 0
        inProgressReviews = 0
        notStartedReviews = 0
        recurringReviews = 0
        oneTimeReviews = 0
        groupReviews = 0
        appReviews = 0
        roleReviews = 0
        accessPackageReviews = 0
        totalInstances = 0
        overdueInstances = 0
    }

    foreach ($definition in $definitions) {
        $defId = $definition.id
        $displayName = $definition.displayName
        $descriptionForAdmins = $definition.descriptionForAdmins
        $descriptionForReviewers = $definition.descriptionForReviewers
        $status = $definition.status
        $createdBy = $definition.createdBy
        $createdDateTime = $definition.createdDateTime
        $lastModifiedDateTime = $definition.lastModifiedDateTime

        # Parse scope
        $scope = $definition.scope
        $scopeType = "unknown"
        $scopeResourceId = $null
        $scopeResourceName = $null

        if ($scope) {
            $odataType = $scope.'@odata.type'
            if ($odataType -match "group") {
                $scopeType = "group"
                $summary.groupReviews++
            }
            elseif ($odataType -match "accessPackage") {
                $scopeType = "accessPackage"
                $summary.accessPackageReviews++
            }
            elseif ($odataType -match "directoryRole" -or $odataType -match "privileged") {
                $scopeType = "role"
                $summary.roleReviews++
            }
            elseif ($odataType -match "servicePrincipal") {
                $scopeType = "application"
                $summary.appReviews++
            }

            if ($scope.resourceId) {
                $scopeResourceId = $scope.resourceId
            }
        }

        # Parse schedule/recurrence
        $settings = $definition.settings
        $recurrence = $settings.recurrence
        $isRecurring = $false
        $recurrencePattern = $null
        $recurrenceRange = $null

        if ($recurrence) {
            $pattern = $recurrence.pattern
            $range = $recurrence.range

            if ($pattern -and $pattern.type -ne "noRecurrence") {
                $isRecurring = $true
                $summary.recurringReviews++
                $recurrencePattern = @{
                    type = $pattern.type
                    interval = $pattern.interval
                }
            }
            else {
                $summary.oneTimeReviews++
            }

            if ($range) {
                $recurrenceRange = @{
                    type = $range.type
                    startDate = $range.startDate
                    endDate = $range.endDate
                }
            }
        }
        else {
            $summary.oneTimeReviews++
        }

        # Parse reviewers
        $reviewers = @()
        if ($definition.reviewers) {
            foreach ($reviewer in $definition.reviewers) {
                $reviewerType = $reviewer.query -replace ".*\/" , ""
                $reviewers += @{
                    query = $reviewer.query
                    queryType = $reviewer.queryType
                    queryRoot = $reviewer.queryRoot
                }
            }
        }

        # Parse settings
        $autoApplyDecisions = $settings.autoApplyDecisionsEnabled
        $defaultDecision = $settings.defaultDecision
        $justificationRequired = $settings.justificationRequiredOnApproval
        $mailNotificationsEnabled = $settings.mailNotificationsEnabled
        $reminderNotificationsEnabled = $settings.reminderNotificationsEnabled
        $instanceDurationInDays = $settings.instanceDurationInDays

        # -----------------------------------------------------------------------
        # 2a. Get instances for this definition
        # -----------------------------------------------------------------------
        $instances = @()
        try {
            $instancesResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/identityGovernance/accessReviews/definitions/$defId/instances?`$top=50&`$orderby=startDateTime desc" `
                    -OutputType PSObject
            } -OperationName "Instances for review $displayName"

            if ($instancesResponse.value) {
                $instances = @($instancesResponse.value)
            }
        }
        catch {
            # Instance retrieval failed - not critical, continue
        }

        $processedInstances = @()
        $now = Get-Date
        foreach ($instance in $instances) {
            $instanceId = $instance.id
            $instanceStatus = $instance.status
            $startDateTime = $instance.startDateTime
            $endDateTime = $instance.endDateTime

            # Check if overdue
            $isOverdue = $false
            if ($endDateTime -and $instanceStatus -eq "InProgress") {
                $endDate = [DateTime]$endDateTime
                if ($endDate -lt $now) {
                    $isOverdue = $true
                    $summary.overdueInstances++
                }
            }

            # Track status
            switch ($instanceStatus) {
                "InProgress" { $summary.inProgressReviews++ }
                "Completed" { $summary.completedReviews++ }
                "NotStarted" { $summary.notStartedReviews++ }
            }

            $processedInstance = [PSCustomObject]@{
                id              = $instanceId
                status          = $instanceStatus
                startDateTime   = $startDateTime
                endDateTime     = $endDateTime
                isOverdue       = $isOverdue
            }
            $processedInstances += $processedInstance
            $summary.totalInstances++
        }

        # Determine overall status
        if ($status -eq "InProgress" -or ($processedInstances | Where-Object { $_.status -eq "InProgress" })) {
            $summary.activeReviews++
        }

        # Build flags
        $flags = @()
        if ($status -eq "InProgress") { $flags += "active" }
        if ($isRecurring) { $flags += "recurring" }
        if ($autoApplyDecisions) { $flags += "auto-apply" }
        if ($processedInstances.Count -eq 0) { $flags += "no-instances" }
        if (($processedInstances | Where-Object { $_.isOverdue }).Count -gt 0) { $flags += "has-overdue" }
        if ($scopeType -eq "role") { $flags += "privileged-access" }

        $processedReview = [PSCustomObject]@{
            id                          = $defId
            displayName                 = $displayName
            descriptionForAdmins        = $descriptionForAdmins
            descriptionForReviewers     = $descriptionForReviewers
            status                      = $status
            scopeType                   = $scopeType
            scopeResourceId             = $scopeResourceId
            isRecurring                 = $isRecurring
            recurrencePattern           = $recurrencePattern
            recurrenceRange             = $recurrenceRange
            reviewerCount               = $reviewers.Count
            reviewers                   = $reviewers
            # Settings
            autoApplyDecisions          = [bool]$autoApplyDecisions
            defaultDecision             = $defaultDecision
            justificationRequired       = [bool]$justificationRequired
            instanceDurationInDays      = $instanceDurationInDays
            # Instances
            instanceCount               = $processedInstances.Count
            instances                   = $processedInstances
            overdueInstanceCount        = ($processedInstances | Where-Object { $_.isOverdue }).Count
            # Metadata
            createdDateTime             = $createdDateTime
            lastModifiedDateTime        = $lastModifiedDateTime
            createdBy                   = @{
                displayName = $createdBy.user.displayName
                email       = $createdBy.user.userPrincipalName
            }
            flags                       = $flags
        }

        $processedReviews += $processedReview
        $reviewCount++
        $summary.totalDefinitions++
    }

    # Sort: active first, then by scope type
    $processedReviews = $processedReviews | Sort-Object -Property @{
        Expression = { $_.status -eq "InProgress" }; Descending = $true
    }, @{
        Expression = { $_.scopeType -eq "role" }; Descending = $true
    }, displayName

    # -----------------------------------------------------------------------
    # 3. Build insights
    # -----------------------------------------------------------------------
    $insights = @()

    if ($summary.totalDefinitions -eq 0) {
        $insights += @{
            id = "no-access-reviews"
            title = "No Access Reviews Configured"
            severity = "warning"
            count = 0
            description = "No access reviews are configured in the tenant."
            recommendedAction = "Create access reviews for privileged roles, sensitive groups, and guest users to ensure proper access governance."
        }
    }

    if ($summary.overdueInstances -gt 0) {
        $insights += @{
            id = "overdue-reviews"
            title = "Overdue Access Reviews"
            severity = "critical"
            count = $summary.overdueInstances
            description = "$($summary.overdueInstances) access review instances are past their end date but not completed."
            recommendedAction = "Complete overdue reviews immediately to maintain compliance and access governance."
        }
    }

    if ($summary.roleReviews -eq 0 -and $summary.totalDefinitions -gt 0) {
        $insights += @{
            id = "no-role-reviews"
            title = "No Privileged Role Reviews"
            severity = "warning"
            count = 0
            description = "No access reviews are configured for privileged directory roles."
            recommendedAction = "Create access reviews for Global Administrators and other privileged roles."
        }
    }

    if ($summary.inProgressReviews -gt 0) {
        $insights += @{
            id = "active-reviews"
            title = "Active Access Reviews"
            severity = "info"
            count = $summary.inProgressReviews
            description = "$($summary.inProgressReviews) access review instances are currently in progress."
            recommendedAction = "Ensure reviewers complete their assigned reviews before the deadline."
        }
    }

    $noRecurrenceReviews = $summary.oneTimeReviews
    if ($noRecurrenceReviews -gt 0 -and $noRecurrenceReviews -eq $summary.totalDefinitions) {
        $insights += @{
            id = "no-recurring-reviews"
            title = "No Recurring Reviews"
            severity = "info"
            count = $noRecurrenceReviews
            description = "All access reviews are one-time. Recurring reviews ensure continuous governance."
            recommendedAction = "Consider converting critical reviews to recurring schedules (quarterly or semi-annually)."
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        definitions = $processedReviews
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
        apiNote = "Access reviews require Entra ID P2 license."
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $reviewCount access review definitions ($($summary.totalInstances) instances)" -ForegroundColor Green
    if ($summary.overdueInstances -gt 0) {
        Write-Host "    [!] $($summary.overdueInstances) overdue instances need attention" -ForegroundColor Yellow
    }

    return New-CollectorResult -Success $true -Count $reviewCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Premium|P2") {
        Write-Host "    [!] Access reviews require Entra ID P2 and AccessReview.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        definitions = @()
        summary = @{
            totalDefinitions = 0
            overdueInstances = 0
        }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
