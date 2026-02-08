# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects eDiscovery cases and legal holds from Microsoft Purview.

.DESCRIPTION
    Retrieves eDiscovery cases and custodian holds for compliance governance.
    This is CRITICAL for legal compliance - understanding what data is on hold
    prevents accidental deletion and ensures legal obligations are met.

    Collects:
    - eDiscovery cases (standard and premium)
    - Case custodians and data sources
    - Legal holds and their scope
    - Case status and statistics

    Graph API endpoints (beta):
    - GET /security/cases/ediscoveryCases
    - GET /security/cases/ediscoveryCases/{id}/custodians
    - GET /security/cases/ediscoveryCases/{id}/legalHolds

    Required scopes:
    - eDiscovery.Read.All

    Note: Requires Microsoft 365 E5 or E5 Compliance add-on.

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes ediscovery-data.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-eDiscoveryData.ps1 -Config $config -OutputPath ".\data\ediscovery-data.json"
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
$caseCount = 0

try {
    Write-Host "    Collecting eDiscovery data..." -ForegroundColor Gray

    # -----------------------------------------------------------------------
    # 1. Get all eDiscovery cases
    # -----------------------------------------------------------------------
    $cases = @()
    try {
        Write-Host "      Fetching eDiscovery cases..." -ForegroundColor Gray

        $casesResponse = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/security/cases/ediscoveryCases?`$top=100" `
                -OutputType PSObject
        } -OperationName "eDiscovery cases retrieval"

        if ($casesResponse.value) {
            $cases = @($casesResponse.value)
        }

        # Handle pagination
        while ($casesResponse.'@odata.nextLink') {
            $casesResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $casesResponse.'@odata.nextLink' -OutputType PSObject
            } -OperationName "eDiscovery cases pagination"
            if ($casesResponse.value) {
                $cases += $casesResponse.value
            }
        }

        Write-Host "      Retrieved $($cases.Count) eDiscovery cases" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Could not retrieve eDiscovery cases: $($_.Exception.Message)" -ForegroundColor Yellow
        $errors += "eDiscovery cases: $($_.Exception.Message)"
    }

    # -----------------------------------------------------------------------
    # 2. Process each case
    # -----------------------------------------------------------------------
    $processedCases = @()
    $summary = @{
        totalCases = 0
        activeCases = 0
        closedCases = 0
        totalCustodians = 0
        totalHolds = 0
        casesWithHolds = 0
        casesWithoutHolds = 0
        dataSourcesByType = @{
            mailbox = 0
            site = 0
            teams = 0
            other = 0
        }
    }

    foreach ($case in $cases) {
        $caseId = $case.id
        $displayName = $case.displayName
        $description = $case.description
        $status = $case.status
        $createdDateTime = $case.createdDateTime
        $lastModifiedDateTime = $case.lastModifiedDateTime
        $closedDateTime = $case.closedDateTime
        $externalId = $case.externalId
        $createdBy = $case.createdBy

        # Track status
        if ($status -eq "active") {
            $summary.activeCases++
        }
        else {
            $summary.closedCases++
        }

        # -----------------------------------------------------------------------
        # 2a. Get custodians for this case
        # -----------------------------------------------------------------------
        $custodians = @()
        try {
            $custodiansResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/security/cases/ediscoveryCases/$caseId/custodians" `
                    -OutputType PSObject
            } -OperationName "Custodians for case $displayName"

            if ($custodiansResponse.value) {
                $custodians = @($custodiansResponse.value)
            }
        }
        catch {
            # Custodian retrieval failed - not critical, continue
        }

        $processedCustodians = @()
        foreach ($custodian in $custodians) {
            $processedCustodian = [PSCustomObject]@{
                id                  = $custodian.id
                displayName         = $custodian.displayName
                email               = $custodian.email
                status              = $custodian.status
                holdStatus          = $custodian.holdStatus
                createdDateTime     = $custodian.createdDateTime
                acknowledgedDateTime = $custodian.acknowledgedDateTime
            }
            $processedCustodians += $processedCustodian
            $summary.totalCustodians++
        }

        # -----------------------------------------------------------------------
        # 2b. Get legal holds for this case
        # -----------------------------------------------------------------------
        $holds = @()
        try {
            $holdsResponse = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/security/cases/ediscoveryCases/$caseId/legalHolds" `
                    -OutputType PSObject
            } -OperationName "Legal holds for case $displayName"

            if ($holdsResponse.value) {
                $holds = @($holdsResponse.value)
            }
        }
        catch {
            # Hold retrieval failed - not critical, continue
        }

        $processedHolds = @()
        foreach ($hold in $holds) {
            $holdId = $hold.id
            $holdDisplayName = $hold.displayName
            $holdDescription = $hold.description
            $holdStatus = $hold.status
            $isEnabled = $hold.isEnabled
            $contentQuery = $hold.contentQuery
            $createdDateTime = $hold.createdDateTime

            # Track data sources
            $userSources = @()
            $siteSources = @()
            if ($hold.userSources) {
                $userSources = @($hold.userSources)
                $summary.dataSourcesByType.mailbox += $userSources.Count
            }
            if ($hold.siteSources) {
                $siteSources = @($hold.siteSources)
                $summary.dataSourcesByType.site += $siteSources.Count
            }

            $processedHold = [PSCustomObject]@{
                id              = $holdId
                displayName     = $holdDisplayName
                description     = $holdDescription
                status          = $holdStatus
                isEnabled       = [bool]$isEnabled
                contentQuery    = $contentQuery
                userSourceCount = $userSources.Count
                siteSourceCount = $siteSources.Count
                createdDateTime = $createdDateTime
            }
            $processedHolds += $processedHold
            $summary.totalHolds++
        }

        # Track holds status
        if ($processedHolds.Count -gt 0) {
            $summary.casesWithHolds++
        }
        else {
            $summary.casesWithoutHolds++
        }

        # Build flags
        $flags = @()
        if ($status -eq "active") { $flags += "active" }
        if ($status -eq "closed") { $flags += "closed" }
        if ($processedHolds.Count -gt 0) { $flags += "has-holds" }
        if ($processedCustodians.Count -gt 0) { $flags += "has-custodians" }
        if ($processedCustodians.Count -gt 10) { $flags += "large-case" }

        $processedCase = [PSCustomObject]@{
            id                    = $caseId
            displayName           = $displayName
            description           = $description
            status                = $status
            externalId            = $externalId
            createdDateTime       = $createdDateTime
            lastModifiedDateTime  = $lastModifiedDateTime
            closedDateTime        = $closedDateTime
            createdBy             = @{
                displayName = $createdBy.user.displayName
                email       = $createdBy.user.userPrincipalName
            }
            custodianCount        = $processedCustodians.Count
            custodians            = $processedCustodians
            holdCount             = $processedHolds.Count
            legalHolds            = $processedHolds
            flags                 = $flags
        }

        $processedCases += $processedCase
        $caseCount++
        $summary.totalCases++
    }

    # Sort cases: active first, then by last modified
    $processedCases = $processedCases | Sort-Object -Property @{
        Expression = { $_.status -eq "active" }; Descending = $true
    }, @{
        Expression = { $_.lastModifiedDateTime }; Descending = $true
    }

    # -----------------------------------------------------------------------
    # 3. Build insights
    # -----------------------------------------------------------------------
    $insights = @()

    if ($summary.totalCases -eq 0) {
        $insights += @{
            id = "no-ediscovery-cases"
            title = "No eDiscovery Cases"
            severity = "info"
            count = 0
            description = "No eDiscovery cases are configured. This is normal if there are no active legal matters."
            recommendedAction = "Create eDiscovery cases when needed for legal investigations or compliance audits."
        }
    }

    if ($summary.activeCases -gt 0) {
        $insights += @{
            id = "active-cases"
            title = "Active eDiscovery Cases"
            severity = "info"
            count = $summary.activeCases
            description = "$($summary.activeCases) eDiscovery cases are currently active with potential legal implications."
            recommendedAction = "Ensure data preservation for active cases. Do not delete data that may be under legal hold."
        }
    }

    if ($summary.casesWithoutHolds -gt 0 -and $summary.activeCases -gt 0) {
        $activeCasesNoHolds = ($processedCases | Where-Object { $_.status -eq "active" -and $_.holdCount -eq 0 }).Count
        if ($activeCasesNoHolds -gt 0) {
            $insights += @{
                id = "active-cases-no-holds"
                title = "Active Cases Without Holds"
                severity = "warning"
                count = $activeCasesNoHolds
                description = "$activeCasesNoHolds active cases have no legal holds configured."
                recommendedAction = "Review if legal holds should be placed to preserve relevant data."
            }
        }
    }

    # Build output
    $output = [PSCustomObject]@{
        cases = $processedCases
        summary = $summary
        insights = $insights
        collectionDate = (Get-Date).ToString("o")
        apiNote = "eDiscovery requires Microsoft 365 E5 or E5 Compliance add-on license."
    }

    # Save data
    Save-CollectorData -Data $output -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $caseCount eDiscovery cases ($($summary.totalHolds) holds, $($summary.totalCustodians) custodians)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $caseCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|license|E5|Compliance") {
        Write-Host "    [!] eDiscovery requires E5 license and eDiscovery.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    $emptyOutput = [PSCustomObject]@{
        cases = @()
        summary = @{
            totalCases = 0
            activeCases = 0
            totalHolds = 0
        }
        insights = @()
        collectionDate = (Get-Date).ToString("o")
    }
    Save-CollectorData -Data $emptyOutput -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
