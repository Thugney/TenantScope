# ============================================================================
# TenantScope
# Author: Robe (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter revisjonslogg-data fra Microsoft Entra ID.

.DESCRIPTION
    Retrieves directory audit log entries from Microsoft Graph API.
    Captures administrative actions such as user creation, role changes,
    app consent, policy modifications, and other directory operations.

    Graph API endpoint:
    - GET /auditLogs/directoryAudits

    Required scope: AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes audit-logs.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of audit log entries collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-AuditLogData.ps1 -Config $config -OutputPath ".\data\audit-logs.json"
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
# HELPER FUNCTIONS
# ============================================================================

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
$entryCount = 0

try {
    Write-Host "    Collecting directory audit logs..." -ForegroundColor Gray

    # Determine date filter
    $auditLogDays = 30
    if ($Config.collection -and $Config.collection.auditLogDays) {
        $auditLogDays = $Config.collection.auditLogDays
    }

    $filterDate = (Get-Date).AddDays(-$auditLogDays).ToString("yyyy-MM-ddTHH:mm:ssZ")
    Write-Host "      Retrieving audit logs from last $auditLogDays days..." -ForegroundColor Gray

    # Fetch audit logs from Graph API
    $auditLogs = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgAuditLogDirectoryAudit -All -Filter "activityDateTime ge $filterDate" -Top 999
    }

    Write-Host "      Retrieved $($auditLogs.Count) audit log entries" -ForegroundColor Gray

    # Process each entry
    $processedEntries = @()

    foreach ($entry in $auditLogs) {
        # Extract initiated by user or app
        $initiatedByUser = ""
        $initiatedByApp = ""

        if ($entry.InitiatedBy.User) {
            $initiatedByUser = if ($entry.InitiatedBy.User.UserPrincipalName) {
                $entry.InitiatedBy.User.UserPrincipalName
            } elseif ($entry.InitiatedBy.User.DisplayName) {
                $entry.InitiatedBy.User.DisplayName
            } else {
                $entry.InitiatedBy.User.Id
            }
        }

        if ($entry.InitiatedBy.App) {
            $initiatedByApp = if ($entry.InitiatedBy.App.DisplayName) {
                $entry.InitiatedBy.App.DisplayName
            } elseif ($entry.InitiatedBy.App.ServicePrincipalName) {
                $entry.InitiatedBy.App.ServicePrincipalName
            } else {
                $entry.InitiatedBy.App.AppId
            }
        }

        # Extract target resource info
        $targetResource = ""
        $targetResourceType = ""

        if ($entry.TargetResources -and $entry.TargetResources.Count -gt 0) {
            $firstTarget = $entry.TargetResources[0]
            $targetResource = $firstTarget.DisplayName
            $targetResourceType = $firstTarget.Type
        }

        $processedEntry = [PSCustomObject]@{
            id                  = $entry.Id
            activityDateTime    = $entry.ActivityDateTime.ToString("o")
            activityDisplayName = $entry.ActivityDisplayName
            operationType       = $entry.OperationType
            initiatedBy         = $initiatedByUser
            initiatedByApp      = $initiatedByApp
            targetResource      = $targetResource
            targetResourceType  = $targetResourceType
            category            = $entry.Category
            result              = $entry.Result
            resultReason        = $entry.ResultReason
            loggedByService     = $entry.LoggedByService
            correlationId       = $entry.CorrelationId
        }

        $processedEntries += $processedEntry
        $entryCount++
    }

    # Sort by date descending (most recent first)
    $processedEntries = $processedEntries | Sort-Object -Property activityDateTime -Descending

    # Write results to JSON file
    $processedEntries | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    + Collected $entryCount audit log entries" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $entryCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage
    Write-Host "    x Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
