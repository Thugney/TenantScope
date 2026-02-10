# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects service principal and application credential expiry status.

.DESCRIPTION
    Retrieves all application registrations and service principals with
    their password credentials and certificate credentials. Identifies
    expiring or expired secrets that could cause service outages.

    This is CRITICAL for security - expired secrets cause outages,
    and unrotated secrets are a security risk.

    Graph API endpoints:
    - GET /applications (App registrations)
    - GET /servicePrincipals (Enterprise apps)

    Required scopes:
    - Application.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes service-principal-secrets.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-ServicePrincipalSecrets.ps1 -Config $config -OutputPath ".\data\service-principal-secrets.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Applications

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
$appCount = 0

try {
    Write-Host "    Collecting service principal credential status..." -ForegroundColor Gray

    $credentialData = @{
        applications = @()
        summary = @{
            totalApplications = 0
            appsWithSecrets = 0
            appsWithCertificates = 0
            expiredCredentials = 0
            expiringIn7Days = 0
            expiringIn30Days = 0
            expiringIn90Days = 0
            healthyCredentials = 0
            noCredentials = 0
        }
    }

    # Reuse app registrations from SharedData (populated by Get-EnterpriseAppData) to avoid
    # a duplicate API call. Falls back to fetching directly if SharedData not available.
    $allApps = @()
    if ($SharedData -and $SharedData.ContainsKey('AppRegistrations') -and $SharedData['AppRegistrations'].Count -gt 0) {
        $allApps = @($SharedData['AppRegistrations'])
        Write-Host "      Reusing $($allApps.Count) app registrations from shared data (no extra API call)" -ForegroundColor Gray
    }
    else {
        # Fallback: fetch from API if shared data not available
        $apps = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/applications?`$select=id,appId,displayName,createdDateTime,passwordCredentials,keyCredentials,signInAudience" `
                -OutputType PSObject
        } -OperationName "Application retrieval"

        $allApps = @($apps.value)

        # Handle pagination
        while ($apps.'@odata.nextLink') {
            $apps = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri $apps.'@odata.nextLink' -OutputType PSObject
            } -OperationName "Application pagination"
            $allApps += $apps.value
        }

        Write-Host "      Retrieved $($allApps.Count) applications" -ForegroundColor Gray
    }

    foreach ($app in $allApps) {
        $secrets = @()
        $certificates = @()
        $worstStatus = "healthy"
        $nearestExpiry = $null

        # Process password credentials (secrets)
        foreach ($secret in $app.passwordCredentials) {
            $daysUntilExpiry = Get-DaysUntilDate -DateValue $secret.endDateTime
            $status = Get-CredentialStatus -DaysUntilExpiry $daysUntilExpiry -NullStatus "unknown"

            $secrets += [PSCustomObject]@{
                keyId           = $secret.keyId
                displayName     = $secret.displayName
                hint            = $secret.hint
                startDateTime   = Format-IsoDate -DateValue $secret.startDateTime
                endDateTime     = Format-IsoDate -DateValue $secret.endDateTime
                daysUntilExpiry = $daysUntilExpiry
                status          = $status
            }

            # Track worst status
            if ($status -eq "expired") { $worstStatus = "expired" }
            elseif ($status -eq "critical" -and $worstStatus -ne "expired") { $worstStatus = "critical" }
            elseif ($status -eq "warning" -and $worstStatus -notin @("expired", "critical")) { $worstStatus = "warning" }

            # Track nearest expiry
            if ($null -ne $daysUntilExpiry -and ($null -eq $nearestExpiry -or $daysUntilExpiry -lt $nearestExpiry)) {
                $nearestExpiry = $daysUntilExpiry
            }

            # Update summary counts
            switch ($status) {
                "expired"   { $credentialData.summary.expiredCredentials++ }
                "critical"  { $credentialData.summary.expiringIn7Days++ }
                "warning"   { $credentialData.summary.expiringIn30Days++ }
                "attention" { $credentialData.summary.expiringIn90Days++ }
                "healthy"   { $credentialData.summary.healthyCredentials++ }
            }
        }

        # Process key credentials (certificates)
        foreach ($cert in $app.keyCredentials) {
            $daysUntilExpiry = Get-DaysUntilDate -DateValue $cert.endDateTime
            $status = Get-CredentialStatus -DaysUntilExpiry $daysUntilExpiry -NullStatus "unknown"

            $certificates += [PSCustomObject]@{
                keyId           = $cert.keyId
                displayName     = $cert.displayName
                type            = $cert.type
                usage           = $cert.usage
                startDateTime   = Format-IsoDate -DateValue $cert.startDateTime
                endDateTime     = Format-IsoDate -DateValue $cert.endDateTime
                daysUntilExpiry = $daysUntilExpiry
                status          = $status
            }

            # Track worst status
            if ($status -eq "expired") { $worstStatus = "expired" }
            elseif ($status -eq "critical" -and $worstStatus -ne "expired") { $worstStatus = "critical" }
            elseif ($status -eq "warning" -and $worstStatus -notin @("expired", "critical")) { $worstStatus = "warning" }

            # Track nearest expiry
            if ($null -ne $daysUntilExpiry -and ($null -eq $nearestExpiry -or $daysUntilExpiry -lt $nearestExpiry)) {
                $nearestExpiry = $daysUntilExpiry
            }

            # Update summary counts
            switch ($status) {
                "expired"   { $credentialData.summary.expiredCredentials++ }
                "critical"  { $credentialData.summary.expiringIn7Days++ }
                "warning"   { $credentialData.summary.expiringIn30Days++ }
                "attention" { $credentialData.summary.expiringIn90Days++ }
                "healthy"   { $credentialData.summary.healthyCredentials++ }
            }
        }

        $hasCredentials = ($secrets.Count -gt 0 -or $certificates.Count -gt 0)

        if (-not $hasCredentials) {
            $worstStatus = "none"
            $credentialData.summary.noCredentials++
        }

        $processedApp = [PSCustomObject]@{
            id                 = $app.id
            appId              = $app.appId
            displayName        = $app.displayName
            createdDateTime    = Format-IsoDate -DateValue $app.createdDateTime
            signInAudience     = $app.signInAudience
            # Credentials
            secrets            = $secrets
            secretCount        = $secrets.Count
            certificates       = $certificates
            certificateCount   = $certificates.Count
            hasCredentials     = $hasCredentials
            # Status
            credentialStatus   = $worstStatus
            nearestExpiry      = $nearestExpiry
            needsAttention     = ($worstStatus -in @("expired", "critical", "warning"))
            isExpired          = ($worstStatus -eq "expired")
        }

        $credentialData.applications += $processedApp
        $appCount++

        # Update summary
        $credentialData.summary.totalApplications++
        if ($secrets.Count -gt 0) { $credentialData.summary.appsWithSecrets++ }
        if ($certificates.Count -gt 0) { $credentialData.summary.appsWithCertificates++ }

        # Progress indicator
        if ($appCount % 50 -eq 0) {
            Write-Host "      Processed $appCount applications..." -ForegroundColor Gray
        }
    }

    # Sort by status severity and nearest expiry
    $credentialData.applications = $credentialData.applications | Sort-Object -Property @{
        Expression = {
            switch ($_.credentialStatus) {
                "expired"   { 0 }
                "critical"  { 1 }
                "warning"   { 2 }
                "attention" { 3 }
                "healthy"   { 4 }
                "none"      { 5 }
                default     { 6 }
            }
        }
    }, @{
        Expression = { if ($null -eq $_.nearestExpiry) { 9999 } else { $_.nearestExpiry } }
    }

    # Add collection date
    $credentialData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $credentialData -OutputPath $OutputPath | Out-Null

    $expiredCount = $credentialData.summary.expiredCredentials
    $criticalCount = $credentialData.summary.expiringIn7Days

    Write-Host "    [OK] Collected credentials for $appCount applications ($expiredCount expired, $criticalCount expiring in 7 days)" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $appCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Authorization") {
        Write-Host "    [!] Service principal collection requires Application.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        applications = @()
        summary = @{}
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
