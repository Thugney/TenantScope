# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Microsoft Defender security alerts from Microsoft Graph.

.DESCRIPTION
    Retrieves security alerts from Microsoft Defender for Endpoint,
    Microsoft Defender for Office 365, and other integrated security
    products. Categorizes alerts by severity and status.

    Graph API endpoint: GET /security/alerts_v2
    Required scope: SecurityEvents.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes defender-alerts.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of alerts collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-DefenderData.ps1 -Config $config -OutputPath ".\data\defender-alerts.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Security

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

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$alertCount = 0

try {
    Write-Host "    Collecting security alerts..." -ForegroundColor Gray

    # Calculate date filter based on config
    $daysBack = $Config.collection.defenderAlertDays
    if ($null -eq $daysBack -or $daysBack -le 0) {
        $daysBack = 30
    }
    $filterDate = (Get-Date).AddDays(-$daysBack).ToString("yyyy-MM-ddTHH:mm:ssZ")

    Write-Host "      Filtering to last $daysBack days" -ForegroundColor Gray

    # Try multiple methods to get alerts
    $alerts = @()

    # Method 1: Try Get-MgSecurityAlert (v2 alerts)
    try {
        $alerts = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgSecurityAlert -Filter "createdDateTime ge $filterDate" -All
        } -OperationName "Security alert retrieval"
        Write-Host "      Retrieved $($alerts.Count) alerts via Get-MgSecurityAlert" -ForegroundColor Gray
    }
    catch {
        Write-Host "      Get-MgSecurityAlert not available, trying alternative..." -ForegroundColor Gray

        # Method 2: Try direct API call to alerts_v2
        try {
            $response = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/security/alerts_v2?`$filter=createdDateTime ge $filterDate" -OutputType PSObject
            } -OperationName "Security alert retrieval (v2 API)"

            if ($response.value) {
                $alerts = $response.value
                # Handle pagination
                while ($response.'@odata.nextLink') {
                    $response = Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
                    if ($response.value) {
                        $alerts += $response.value
                    }
                }
            }
            Write-Host "      Retrieved $($alerts.Count) alerts via alerts_v2 API" -ForegroundColor Gray
        }
        catch {
            # Method 3: Try legacy alerts endpoint
            try {
                $response = Invoke-GraphWithRetry -ScriptBlock {
                    Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/security/alerts?`$filter=createdDateTime ge $filterDate" -OutputType PSObject
                } -OperationName "Security alert retrieval (legacy API)"

                if ($response.value) {
                    $alerts = $response.value
                }
                Write-Host "      Retrieved $($alerts.Count) alerts via legacy API" -ForegroundColor Gray
            }
            catch {
                throw "Unable to retrieve security alerts: $($_.Exception.Message)"
            }
        }
    }

    # Process each alert
    $processedAlerts = @()

    foreach ($alert in $alerts) {
        # Extract affected user from various possible locations
        $affectedUser = $null
        if ($alert.UserStates -and $alert.UserStates.Count -gt 0) {
            $affectedUser = $alert.UserStates[0].UserPrincipalName
        }
        elseif ($alert.AdditionalProperties.userPrincipalName) {
            $affectedUser = $alert.AdditionalProperties.userPrincipalName
        }

        # Extract affected device
        $affectedDevice = $null
        if ($alert.HostStates -and $alert.HostStates.Count -gt 0) {
            $affectedDevice = $alert.HostStates[0].NetBiosName
            if ([string]::IsNullOrEmpty($affectedDevice)) {
                $affectedDevice = $alert.HostStates[0].Fqdn
            }
        }

        # Get recommended actions
        $recommendedActions = $null
        if ($alert.RecommendedActions) {
            if ($alert.RecommendedActions -is [array]) {
                $recommendedActions = $alert.RecommendedActions -join "; "
            }
            else {
                $recommendedActions = $alert.RecommendedActions
            }
        }

        # Extract MITRE ATT&CK techniques if available
        $mitreTechniques = @()
        if ($alert.MitreTechniques -and $alert.MitreTechniques.Count -gt 0) {
            $mitreTechniques = $alert.MitreTechniques
        }
        elseif ($alert.AdditionalProperties.mitreTechniques) {
            $mitreTechniques = $alert.AdditionalProperties.mitreTechniques
        }

        # Extract evidence/indicators
        $evidence = @()
        if ($alert.Evidence -and $alert.Evidence.Count -gt 0) {
            foreach ($ev in $alert.Evidence) {
                $evidence += @{
                    type = $ev.'@odata.type'
                    createdDateTime = if ($ev.CreatedDateTime) { $ev.CreatedDateTime.ToString("o") } else { $null }
                    remediationStatus = $ev.RemediationStatus
                    verdict = $ev.Verdict
                }
            }
        }

        # Get detection source
        $detectionSource = $null
        if ($alert.DetectionSource) {
            $detectionSource = $alert.DetectionSource.ToString()
        }
        elseif ($alert.AdditionalProperties.detectionSource) {
            $detectionSource = $alert.AdditionalProperties.detectionSource
        }

        # Get service source
        $serviceSource = $null
        if ($alert.ServiceSource) {
            $serviceSource = $alert.ServiceSource.ToString()
        }
        elseif ($alert.AdditionalProperties.serviceSource) {
            $serviceSource = $alert.AdditionalProperties.serviceSource
        }

        # Get threat name/family if available
        $threatName = $null
        if ($alert.ThreatFamilyName) {
            $threatName = $alert.ThreatFamilyName
        }
        elseif ($alert.AdditionalProperties.threatFamilyName) {
            $threatName = $alert.AdditionalProperties.threatFamilyName
        }

        # Get classification
        $classification = $null
        if ($alert.Classification) {
            $classification = $alert.Classification.ToString()
        }

        # Build output object matching our schema
        $processedAlert = [PSCustomObject]@{
            id                  = $alert.Id
            title               = $alert.Title
            severity            = Get-SeverityName -Severity $alert.Severity
            status              = Get-StatusName -Status $alert.Status
            category            = $alert.Category
            createdDateTime     = if ($alert.CreatedDateTime) { $alert.CreatedDateTime.ToString("o") } else { $null }
            resolvedDateTime    = if ($alert.ResolvedDateTime) { $alert.ResolvedDateTime.ToString("o") } else { $null }
            affectedUser        = $affectedUser
            affectedDevice      = $affectedDevice
            description         = $alert.Description
            recommendedActions  = $recommendedActions
            mitreTechniques     = $mitreTechniques
            evidence            = $evidence
            detectionSource     = $detectionSource
            serviceSource       = $serviceSource
            threatName          = $threatName
            classification      = $classification
            incidentId          = $alert.IncidentId
        }

        $processedAlerts += $processedAlert
        $alertCount++
    }

    # Sort by severity (high first) then by created date (newest first)
    $processedAlerts = $processedAlerts | Sort-Object -Property @{Expression = {
        switch ($_.severity) {
            "high"          { 0 }
            "medium"        { 1 }
            "low"           { 2 }
            "informational" { 3 }
            default         { 4 }
        }
    }}, @{Expression = "createdDateTime"; Descending = $true}

    # Save data using shared utility
    Save-CollectorData -Data $processedAlerts -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $alertCount security alerts" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $alertCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing/permission issue
    if ($errorMessage -match "Defender|license|subscription|permission|forbidden|security") {
        Write-Host "    [!] Security alerts may require Microsoft Defender license" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
