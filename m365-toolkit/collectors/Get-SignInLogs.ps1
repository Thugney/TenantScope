# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects detailed Azure AD sign-in logs for security analysis.

.DESCRIPTION
    Retrieves sign-in logs from Azure AD including successful and failed
    attempts, MFA challenges, conditional access evaluations, and location
    data. Enables security analysis beyond basic risk detections.

    Enhanced to include:
    - Applied Conditional Access policies with their results
    - CA policy enforcement statistics (success, failure, not applied)
    - MFA method used and authentication details
    - Per-policy breakdowns for security analysis

    Graph API endpoint:
    - GET /auditLogs/signIns

    Required scopes:
    - AuditLog.Read.All
    - Directory.Read.All

    Note: Requires Azure AD P1/P2 license for full sign-in log access.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes signin-logs.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-SignInLogs.ps1 -Config $config -OutputPath ".\data\signin-logs.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Reports

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
# (Using shared status mappers from CollectorBase.ps1)

function Get-SignInEvents {
    <#
    .SYNOPSIS
        Retrieves sign-in events with pagination.
    #>
    param(
        [string]$Filter,
        [string]$Label
    )

    $uri = "https://graph.microsoft.com/v1.0/auditLogs/signIns?`$filter=$Filter&`$top=500&`$orderby=createdDateTime desc"

    $signIns = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
    } -OperationName "Sign-in logs retrieval ($Label)"

    $allSignIns = @($signIns.value)

    # Handle pagination (limit to 2000 for performance)
    $pageCount = 1
    while ($signIns.'@odata.nextLink' -and $pageCount -lt 4) {
        $signIns = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $signIns.'@odata.nextLink' -OutputType PSObject
        } -OperationName "Sign-in logs pagination ($Label)"
        $allSignIns += $signIns.value
        $pageCount++
    }

    return $allSignIns
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$signInCount = 0

try {
    Write-Host "    Collecting sign-in logs..." -ForegroundColor Gray

    # Get log retention days from config or default to 7
    $logDays = if ($Config.collection.signInLogDays) {
        $Config.collection.signInLogDays
    } else { 7 }

    $startDate = (Get-Date).AddDays(-$logDays).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $baseFilter = "createdDateTime ge $startDate"

    $signInData = @{
        signIns = @()
        summary = @{
            totalSignIns = 0
            successfulSignIns = 0
            failedSignIns = 0
            mfaChallenges = 0
            caBlocked = 0
            riskySignIns = 0
            interactiveSignIns = 0
            nonInteractiveSignIns = 0
            uniqueUsers = 0
            uniqueApps = 0
            uniqueLocations = 0
            topFailureReasons = @()
            signInsByHour = @{}
            signInsByCountry = @{}
            # Enhanced CA policy tracking
            caPolicy = @{
                totalEvaluations = 0
                policiesApplied = 0
                policiesSucceeded = 0
                policiesFailed = 0
                policiesNotApplied = 0
                policyBreakdown = @{}
            }
            # MFA method tracking
            mfaMethods = @{}
            authMethodsUsed = @{}
        }
    }

    Write-Host "      Retrieving interactive sign-ins..." -ForegroundColor Gray
    $interactiveSignIns = Get-SignInEvents -Filter "$baseFilter and signInEventTypes/any(t: t eq 'interactiveUser')" -Label "interactive"

    Write-Host "      Retrieving non-interactive sign-ins..." -ForegroundColor Gray
    $nonInteractiveSignIns = Get-SignInEvents -Filter "$baseFilter and signInEventTypes/any(t: t eq 'nonInteractiveUser')" -Label "non-interactive"

    $signInMap = @{}
    foreach ($signIn in @($interactiveSignIns + $nonInteractiveSignIns)) {
        if ($signIn.id -and -not $signInMap.ContainsKey($signIn.id)) {
            $signInMap[$signIn.id] = $signIn
        }
    }

    $allSignIns = @($signInMap.Values)

    Write-Host "      Retrieved $($allSignIns.Count) sign-in events (interactive: $($interactiveSignIns.Count), non-interactive: $($nonInteractiveSignIns.Count))" -ForegroundColor Gray

    $uniqueUsers = @{}
    $uniqueApps = @{}
    $uniqueLocations = @{}
    $failureReasons = @{}

    foreach ($signIn in $allSignIns) {
        $status = Get-SignInStatus -ErrorCode $signIn.status.errorCode -FailureReason $signIn.status.failureReason
        $riskLevel = Get-RiskLevel -Risk $signIn.riskLevelDuringSignIn

        # Extract location info
        $location = $signIn.location
        $country = if ($location.countryOrRegion) { $location.countryOrRegion } else { "Unknown" }
        $city = if ($location.city) { $location.city } else { "Unknown" }

        # Determine sign-in type
        $eventTypes = @()
        if ($signIn.signInEventTypes) { $eventTypes = @($signIn.signInEventTypes) }
        $signInType = if ($eventTypes -contains "nonInteractiveUser" -or $signIn.isInteractive -eq $false) { "nonInteractive" } else { "interactive" }

        # Process applied CA policies
        $appliedCaPolicies = @()
        if ($signIn.appliedConditionalAccessPolicies) {
            foreach ($caPolicy in $signIn.appliedConditionalAccessPolicies) {
                $policyResult = $caPolicy.result
                $policyName = $caPolicy.displayName
                $policyId = $caPolicy.id

                $appliedCaPolicies += @{
                    id = $policyId
                    displayName = $policyName
                    result = $policyResult
                    enforcedGrantControls = $caPolicy.enforcedGrantControls
                    enforcedSessionControls = $caPolicy.enforcedSessionControls
                    conditionsNotSatisfied = $caPolicy.conditionsNotSatisfied
                    conditionsSatisfied = $caPolicy.conditionsSatisfied
                }

                # Track CA policy statistics
                $signInData.summary.caPolicy.totalEvaluations++
                switch ($policyResult) {
                    "success" { $signInData.summary.caPolicy.policiesSucceeded++ }
                    "failure" { $signInData.summary.caPolicy.policiesFailed++ }
                    "notApplied" { $signInData.summary.caPolicy.policiesNotApplied++ }
                    "notEnabled" { $signInData.summary.caPolicy.policiesNotApplied++ }
                }
                if ($policyResult -in @("success", "failure")) {
                    $signInData.summary.caPolicy.policiesApplied++
                }

                # Track per-policy breakdown
                if ($policyName) {
                    if (-not $signInData.summary.caPolicy.policyBreakdown.ContainsKey($policyName)) {
                        $signInData.summary.caPolicy.policyBreakdown[$policyName] = @{
                            success = 0
                            failure = 0
                            notApplied = 0
                        }
                    }
                    switch ($policyResult) {
                        "success" { $signInData.summary.caPolicy.policyBreakdown[$policyName].success++ }
                        "failure" { $signInData.summary.caPolicy.policyBreakdown[$policyName].failure++ }
                        default { $signInData.summary.caPolicy.policyBreakdown[$policyName].notApplied++ }
                    }
                }
            }
        }

        # Process MFA details
        $mfaMethod = $null
        $authMethod = $null
        if ($signIn.mfaDetail) {
            $mfaMethod = $signIn.mfaDetail.authMethod
            $authMethod = $signIn.mfaDetail.authDetail
            if ($mfaMethod) {
                if (-not $signInData.summary.mfaMethods.ContainsKey($mfaMethod)) {
                    $signInData.summary.mfaMethods[$mfaMethod] = 0
                }
                $signInData.summary.mfaMethods[$mfaMethod]++
            }
        }

        # Track authentication methods from authenticationDetails
        if ($signIn.authenticationDetails) {
            foreach ($authDetail in $signIn.authenticationDetails) {
                $method = $authDetail.authenticationMethod
                if ($method) {
                    if (-not $signInData.summary.authMethodsUsed.ContainsKey($method)) {
                        $signInData.summary.authMethodsUsed[$method] = 0
                    }
                    $signInData.summary.authMethodsUsed[$method]++
                }
            }
        }

        $processedSignIn = [PSCustomObject]@{
            id                    = $signIn.id
            createdDateTime       = Format-IsoDate -DateValue $signIn.createdDateTime
            userDisplayName       = $signIn.userDisplayName
            userPrincipalName     = $signIn.userPrincipalName
            userId                = $signIn.userId
            appDisplayName        = $signIn.appDisplayName
            appId                 = $signIn.appId
            ipAddress             = $signIn.ipAddress
            clientAppUsed         = $signIn.clientAppUsed
            # Status
            status                = $status
            errorCode             = $signIn.status.errorCode
            failureReason         = $signIn.status.failureReason
            # Risk
            riskLevel             = $riskLevel
            riskState             = $signIn.riskState
            riskDetail            = $signIn.riskDetail
            # Location
            country               = $country
            city                  = $city
            # Device
            deviceDetail          = @{
                browser         = $signIn.deviceDetail.browser
                operatingSystem = $signIn.deviceDetail.operatingSystem
                isCompliant     = $signIn.deviceDetail.isCompliant
                isManaged       = $signIn.deviceDetail.isManaged
                trustType       = $signIn.deviceDetail.trustType
            }
            # MFA & CA - Enhanced
            mfaDetail             = $signIn.mfaDetail
            mfaMethod             = $mfaMethod
            conditionalAccessStatus = $signIn.conditionalAccessStatus
            appliedCaPolicies     = $appliedCaPolicies
            appliedCaPolicyCount  = $appliedCaPolicies.Count
            isInteractive         = $signIn.isInteractive
            signInEventTypes      = $eventTypes
            signInType            = $signInType
            # Authentication details
            authenticationRequirement = $signIn.authenticationRequirement
            authenticationProtocol = $signIn.authenticationProtocol
        }

        $signInData.signIns += $processedSignIn
        $signInCount++

        # Update summaries
        $signInData.summary.totalSignIns++
        if ($signInType -eq "nonInteractive") { $signInData.summary.nonInteractiveSignIns++ }
        else { $signInData.summary.interactiveSignIns++ }

        switch ($status) {
            "Success"     { $signInData.summary.successfulSignIns++ }
            "Interrupted" { $signInData.summary.mfaChallenges++ }
            "Failed"      {
                $signInData.summary.failedSignIns++
                # Track CA blocked separately (error code 53003)
                if ($signIn.status.errorCode -eq 53003) {
                    $signInData.summary.caBlocked++
                }
            }
        }

        if ($riskLevel -in @("High", "Medium")) {
            $signInData.summary.riskySignIns++
        }

        # Track unique values
        if ($signIn.userId) { $uniqueUsers[$signIn.userId] = $true }
        if ($signIn.appId) { $uniqueApps[$signIn.appId] = $true }
        if ($country -ne "Unknown") { $uniqueLocations[$country] = $true }

        # Track failure reasons
        if ($signIn.status.errorCode -ne 0 -and $signIn.status.failureReason) {
            $reason = $signIn.status.failureReason
            if (-not $failureReasons.ContainsKey($reason)) {
                $failureReasons[$reason] = 0
            }
            $failureReasons[$reason]++
        }

        # Track by hour
        $hour = ([DateTime]$signIn.createdDateTime).Hour.ToString("00")
        if (-not $signInData.summary.signInsByHour.ContainsKey($hour)) {
            $signInData.summary.signInsByHour[$hour] = 0
        }
        $signInData.summary.signInsByHour[$hour]++

        # Track by country
        if (-not $signInData.summary.signInsByCountry.ContainsKey($country)) {
            $signInData.summary.signInsByCountry[$country] = 0
        }
        $signInData.summary.signInsByCountry[$country]++
    }

    # Finalize summaries
    $signInData.summary.uniqueUsers = $uniqueUsers.Count
    $signInData.summary.uniqueApps = $uniqueApps.Count
    $signInData.summary.uniqueLocations = $uniqueLocations.Count

    # Top 5 failure reasons
    $signInData.summary.topFailureReasons = $failureReasons.GetEnumerator() |
        Sort-Object Value -Descending |
        Select-Object -First 5 |
        ForEach-Object {
            @{
                reason = $_.Key
                count = $_.Value
            }
        }

    # Convert CA policy breakdown to sorted array
    $signInData.summary.caPolicy.policyBreakdown = $signInData.summary.caPolicy.policyBreakdown.GetEnumerator() |
        Sort-Object { $_.Value.success + $_.Value.failure } -Descending |
        Select-Object -First 20 |
        ForEach-Object {
            @{
                policyName = $_.Key
                success = $_.Value.success
                failure = $_.Value.failure
                notApplied = $_.Value.notApplied
            }
        }

    # Convert MFA methods to sorted array
    $signInData.summary.mfaMethods = $signInData.summary.mfaMethods.GetEnumerator() |
        Sort-Object Value -Descending |
        ForEach-Object {
            @{
                method = $_.Key
                count = $_.Value
            }
        }

    # Convert auth methods to sorted array
    $signInData.summary.authMethodsUsed = $signInData.summary.authMethodsUsed.GetEnumerator() |
        Sort-Object Value -Descending |
        ForEach-Object {
            @{
                method = $_.Key
                count = $_.Value
            }
        }

    $signInData.collectionDate = (Get-Date).ToString("o")
    $signInData.logDays = $logDays

    # Save data
    Save-CollectorData -Data $signInData -OutputPath $OutputPath | Out-Null

    $successRate = if ($signInData.summary.totalSignIns -gt 0) {
        [Math]::Round(($signInData.summary.successfulSignIns / $signInData.summary.totalSignIns) * 100, 1)
    } else { 0 }

    Write-Host "    [OK] Collected $signInCount sign-in events (${successRate}% success rate)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $signInCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "license|P1|P2|Premium|permission|forbidden") {
        Write-Host "    [!] Sign-in logs require Azure AD P1/P2 license and AuditLog.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        signIns = @()
        summary = @{}
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
