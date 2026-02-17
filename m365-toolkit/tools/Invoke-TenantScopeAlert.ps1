# ============================================================================
# TenantScope - Alerting System
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Centralized alerting system for TenantScope that aggregates findings
    from all analysis tools and delivers alerts via Teams, email, or console.

.DESCRIPTION
    Scans all TenantScope analysis outputs (CIS benchmark, risk scores,
    sign-in anomalies, Defender alerts, identity risk, CA gap analysis,
    and trend drift) to build a unified alert feed. Supports multiple
    delivery channels:

    1. Microsoft Teams via Adaptive Card webhook
    2. Email via SMTP with HTML body
    3. Console output for scheduled task logging
    4. JSON feed for dashboard consumption

    Features:
    - Severity-based filtering (critical, high, medium, low)
    - 24-hour deduplication to avoid alert fatigue
    - Trend drift detection (e.g., MFA% dropped >5 points)
    - DryRun mode for testing without sending notifications
    - Persistent alert history for audit trail

    Data sources scanned:
    - cis-benchmark-results.json      (failed CIS controls)
    - risk-scores.json                (users in critical/high tier)
    - signin-anomaly-results.json     (sign-in anomalies)
    - ca-gap-analysis/ results        (CA policy gaps)
    - defender-alerts.json            (unresolved Defender alerts)
    - identity-risk-data.json         (high-risk users)
    - trend-history.json              (metric degradation)

.PARAMETER Config
    Configuration hashtable from config.json.

.PARAMETER OutputPath
    Path for alert output files. Defaults to ../data/alerts/.

.PARAMETER TeamsWebhookUrl
    Microsoft Teams incoming webhook URL for Adaptive Card delivery.

.PARAMETER SmtpServer
    SMTP server hostname for email delivery.

.PARAMETER SmtpFrom
    Sender email address for alert emails.

.PARAMETER SmtpTo
    One or more recipient email addresses.

.PARAMETER SmtpPort
    SMTP port number. Default: 587.

.PARAMETER UseSsl
    Use SSL/TLS for SMTP connection.

.PARAMETER SmtpCredential
    PSCredential for SMTP authentication.

.PARAMETER MinimumSeverity
    Minimum severity level to alert on. Default: high.
    Alerts below this severity are logged but not delivered.

.PARAMETER DryRun
    Preview mode - generates alert feed and logs what would be sent
    without actually delivering to Teams or email.

.EXAMPLE
    .\tools\Invoke-TenantScopeAlert.ps1 -MinimumSeverity "critical"

.EXAMPLE
    .\tools\Invoke-TenantScopeAlert.ps1 -TeamsWebhookUrl "https://outlook.office.com/webhook/..." -MinimumSeverity "high"

.EXAMPLE
    .\tools\Invoke-TenantScopeAlert.ps1 -SmtpServer "smtp.office365.com" -SmtpFrom "alerts@contoso.com" -SmtpTo "secops@contoso.com" -UseSsl -SmtpCredential $cred

.EXAMPLE
    .\tools\Invoke-TenantScopeAlert.ps1 -DryRun -MinimumSeverity "medium"

.NOTES
    Version: 1.0.0
    Designed to run on a schedule (e.g., daily via cron or Task Scheduler).
    All operations are read-only against data files - no Graph API calls required.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [hashtable]$Config,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [string]$TeamsWebhookUrl,

    [Parameter()]
    [string]$SmtpServer,

    [Parameter()]
    [string]$SmtpFrom,

    [Parameter()]
    [string[]]$SmtpTo,

    [Parameter()]
    [int]$SmtpPort = 587,

    [Parameter()]
    [switch]$UseSsl,

    [Parameter()]
    [PSCredential]$SmtpCredential,

    [Parameter()]
    [ValidateSet("critical","high","medium","low")]
    [string]$MinimumSeverity = "high",

    [Parameter()]
    [switch]$DryRun
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# CONFIGURATION
# ============================================================================

if (-not $OutputPath) {
    $OutputPath = Join-Path $PSScriptRoot "..\data\alerts"
}

if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

# Data source directories - check both dashboard/data and data/ locations
$dashboardDataPath = Join-Path $PSScriptRoot "..\dashboard\data"
$dataPath = Join-Path $PSScriptRoot "..\data"
$sampleDataPath = Join-Path $dataPath "sample"

$alertsFeedFile = Join-Path $OutputPath "alerts-feed.json"
$alertsHistoryFile = Join-Path $OutputPath "alerts-history.json"
$dashboardAlertsFeedFile = Join-Path $dashboardDataPath "alerts-feed.json"

# Severity ranking for comparison
$SeverityRank = @{
    "critical" = 4
    "high"     = 3
    "medium"   = 2
    "low"      = 1
}

$minimumRank = $SeverityRank[$MinimumSeverity]

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function New-AlertId {
    <#
    .SYNOPSIS
        Generates a new GUID for an alert.
    #>
    return [System.Guid]::NewGuid().ToString()
}

function New-Alert {
    <#
    .SYNOPSIS
        Creates a standardized alert object.
    #>
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Severity,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Description,
        [Parameter()][string]$AffectedEntity = "",
        [Parameter()][string]$ActionRequired = "",
        [Parameter()][string]$DashboardLink = ""
    )

    return [PSCustomObject]@{
        id              = New-AlertId
        timestamp       = (Get-Date).ToString("o")
        source          = $Source
        severity        = $Severity.ToLower()
        title           = $Title
        description     = $Description
        affectedEntity  = $AffectedEntity
        actionRequired  = $ActionRequired
        dashboardLink   = $DashboardLink
    }
}

function Test-SeverityMeetsThreshold {
    <#
    .SYNOPSIS
        Tests whether a severity level meets or exceeds the minimum threshold.
    #>
    param(
        [Parameter(Mandatory)][string]$Severity
    )

    $sevLower = $Severity.ToLower()
    if (-not $SeverityRank.ContainsKey($sevLower)) { return $false }
    return $SeverityRank[$sevLower] -ge $minimumRank
}

function Test-AlertIsDuplicate {
    <#
    .SYNOPSIS
        Checks if an alert has already been sent within the last 24 hours
        by comparing source + affectedEntity + title against alert history.
    #>
    param(
        [Parameter(Mandatory)][PSCustomObject]$Alert,
        [Parameter(Mandatory)][array]$History
    )

    $cutoff = (Get-Date).AddHours(-24)

    foreach ($existing in $History) {
        # Skip entries older than 24 hours
        if ($existing.timestamp) {
            try {
                $existingTime = [DateTime]::Parse($existing.timestamp)
                if ($existingTime -lt $cutoff) { continue }
            }
            catch { continue }
        }
        else {
            continue
        }

        # Match on source + affectedEntity + title
        if ($existing.source -eq $Alert.source -and
            $existing.affectedEntity -eq $Alert.affectedEntity -and
            $existing.title -eq $Alert.title) {
            return $true
        }
    }

    return $false
}

function Resolve-DataFile {
    <#
    .SYNOPSIS
        Finds a data file by checking multiple locations in priority order:
        dashboard/data, data/, data/sample/.
    #>
    param(
        [Parameter(Mandatory)][string]$FileName
    )

    $candidates = @(
        (Join-Path $dashboardDataPath $FileName),
        (Join-Path $dataPath $FileName),
        (Join-Path $sampleDataPath $FileName)
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    return $null
}

function Resolve-DataDirectory {
    <#
    .SYNOPSIS
        Finds a data directory by checking multiple locations.
    #>
    param(
        [Parameter(Mandatory)][string]$DirName
    )

    $candidates = @(
        (Join-Path $dashboardDataPath $DirName),
        (Join-Path $dataPath $DirName)
    )

    foreach ($path in $candidates) {
        if (Test-Path $path -PathType Container) {
            return $path
        }
    }

    return $null
}

function Get-SeverityBadgeColor {
    <#
    .SYNOPSIS
        Returns a hex color for an Adaptive Card severity badge.
    #>
    param([string]$Severity)

    switch ($Severity.ToLower()) {
        "critical" { return "Attention" }
        "high"     { return "Warning" }
        "medium"   { return "Accent" }
        "low"      { return "Good" }
        default    { return "Default" }
    }
}

function Get-SeverityHtmlColor {
    <#
    .SYNOPSIS
        Returns a hex color for HTML email severity styling.
    #>
    param([string]$Severity)

    switch ($Severity.ToLower()) {
        "critical" { return "#dc2626" }
        "high"     { return "#ea580c" }
        "medium"   { return "#d97706" }
        "low"      { return "#65a30d" }
        default    { return "#6b7280" }
    }
}

# ============================================================================
# DELIVERY FUNCTIONS
# ============================================================================

function Send-TeamsAlert {
    <#
    .SYNOPSIS
        Sends an alert to Microsoft Teams via incoming webhook as an Adaptive Card.

    .DESCRIPTION
        Constructs an Adaptive Card payload with the alert title, severity badge,
        description, affected entity, and action link, then POSTs it to the
        configured Teams webhook URL.

    .PARAMETER Alert
        The alert object to deliver.

    .PARAMETER WebhookUrl
        The Teams incoming webhook URL.
    #>
    param(
        [Parameter(Mandatory)][PSCustomObject]$Alert,
        [Parameter(Mandatory)][string]$WebhookUrl
    )

    $severityColor = Get-SeverityBadgeColor -Severity $Alert.severity
    $severityUpper = $Alert.severity.ToUpper()

    $card = @{
        type        = "message"
        attachments = @(
            @{
                contentType = "application/vnd.microsoft.card.adaptive"
                contentUrl  = $null
                content     = @{
                    '$schema' = "http://adaptivecards.io/schemas/adaptive-card.json"
                    type      = "AdaptiveCard"
                    version   = "1.4"
                    body      = @(
                        @{
                            type   = "TextBlock"
                            size   = "Medium"
                            weight = "Bolder"
                            text   = "TenantScope Alert"
                            color  = $severityColor
                        },
                        @{
                            type    = "ColumnSet"
                            columns = @(
                                @{
                                    type  = "Column"
                                    width = "auto"
                                    items = @(
                                        @{
                                            type   = "TextBlock"
                                            text   = $severityUpper
                                            weight = "Bolder"
                                            color  = $severityColor
                                            size   = "Small"
                                        }
                                    )
                                },
                                @{
                                    type  = "Column"
                                    width = "stretch"
                                    items = @(
                                        @{
                                            type   = "TextBlock"
                                            text   = $Alert.title
                                            weight = "Bolder"
                                            wrap   = $true
                                        }
                                    )
                                }
                            )
                        },
                        @{
                            type      = "TextBlock"
                            text      = $Alert.description
                            wrap      = $true
                            spacing   = "Small"
                        },
                        @{
                            type  = "FactSet"
                            facts = @(
                                @{ title = "Source"; value = $Alert.source },
                                @{ title = "Affected Entity"; value = if ($Alert.affectedEntity) { $Alert.affectedEntity } else { "N/A" } },
                                @{ title = "Timestamp"; value = $Alert.timestamp }
                            )
                        },
                        @{
                            type      = "TextBlock"
                            text      = "**Action:** $($Alert.actionRequired)"
                            wrap      = $true
                            spacing   = "Small"
                            isSubtle  = $false
                        }
                    )
                    actions = @()
                }
            }
        )
    }

    # Add dashboard link action if present
    if ($Alert.dashboardLink) {
        $card.attachments[0].content.actions += @{
            type  = "Action.OpenUrl"
            title = "Open in Dashboard"
            url   = $Alert.dashboardLink
        }
    }

    $cardJson = $card | ConvertTo-Json -Depth 20 -Compress

    try {
        Invoke-RestMethod -Method Post -Uri $WebhookUrl -Body $cardJson -ContentType "application/json" -ErrorAction Stop
        return $true
    }
    catch {
        Write-Host "    [X] Teams delivery failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Send-EmailAlert {
    <#
    .SYNOPSIS
        Sends an alert via email with HTML-formatted body.

    .DESCRIPTION
        Constructs an HTML email with alert details and severity styling,
        then sends via SMTP. Uses System.Net.Mail.SmtpClient for PowerShell 7
        compatibility since Send-MailMessage is marked as obsolete.

    .PARAMETER Alerts
        Array of alert objects to include in the email.

    .PARAMETER Server
        SMTP server hostname.

    .PARAMETER From
        Sender email address.

    .PARAMETER To
        Recipient email address(es).

    .PARAMETER Port
        SMTP port number.

    .PARAMETER UseSsl
        Whether to use SSL/TLS.

    .PARAMETER Credential
        PSCredential for SMTP authentication.
    #>
    param(
        [Parameter(Mandatory)][array]$Alerts,
        [Parameter(Mandatory)][string]$Server,
        [Parameter(Mandatory)][string]$From,
        [Parameter(Mandatory)][string[]]$To,
        [Parameter()][int]$Port = 587,
        [Parameter()][switch]$UseSsl,
        [Parameter()][PSCredential]$Credential
    )

    $critCount = ($Alerts | Where-Object { $_.severity -eq "critical" }).Count
    $highCount = ($Alerts | Where-Object { $_.severity -eq "high" }).Count

    $subject = "TenantScope Alert: $($Alerts.Count) new alert(s)"
    if ($critCount -gt 0) {
        $subject = "TenantScope CRITICAL: $critCount critical, $highCount high alert(s)"
    }
    elseif ($highCount -gt 0) {
        $subject = "TenantScope Alert: $highCount high-severity alert(s)"
    }

    # Build HTML body
    $alertRows = ""
    foreach ($alert in ($Alerts | Sort-Object { $SeverityRank[$_.severity] } -Descending)) {
        $color = Get-SeverityHtmlColor -Severity $alert.severity
        $alertRows += @"
        <tr>
            <td style="padding:10px 12px; border-bottom:1px solid #f1f5f9;">
                <span style="background:$color; color:white; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700;">$($alert.severity.ToUpper())</span>
            </td>
            <td style="padding:10px 12px; border-bottom:1px solid #f1f5f9; font-weight:600;">$([System.Web.HttpUtility]::HtmlEncode($alert.title))</td>
            <td style="padding:10px 12px; border-bottom:1px solid #f1f5f9;">$([System.Web.HttpUtility]::HtmlEncode($alert.source))</td>
            <td style="padding:10px 12px; border-bottom:1px solid #f1f5f9;">$([System.Web.HttpUtility]::HtmlEncode($alert.affectedEntity))</td>
            <td style="padding:10px 12px; border-bottom:1px solid #f1f5f9;">$([System.Web.HttpUtility]::HtmlEncode($alert.description))</td>
            <td style="padding:10px 12px; border-bottom:1px solid #f1f5f9; color:#059669;">$([System.Web.HttpUtility]::HtmlEncode($alert.actionRequired))</td>
        </tr>
"@
    }

    $htmlBody = @"
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; margin:0; padding:20px; background:#f5f5f5;">
    <div style="max-width:900px; margin:0 auto;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e); color:white; padding:24px 30px; border-radius:12px 12px 0 0;">
            <h1 style="margin:0; font-size:22px;">TenantScope Alerting System</h1>
            <p style="margin:6px 0 0 0; opacity:0.8;">$($Alerts.Count) new alert(s) generated at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')</p>
        </div>
        <div style="background:white; padding:24px 30px; border-radius:0 0 12px 12px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <table style="width:100%; border-collapse:collapse;">
                <tr>
                    <th style="text-align:left; padding:10px 12px; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; color:#64748b; text-transform:uppercase;">Severity</th>
                    <th style="text-align:left; padding:10px 12px; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; color:#64748b; text-transform:uppercase;">Title</th>
                    <th style="text-align:left; padding:10px 12px; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; color:#64748b; text-transform:uppercase;">Source</th>
                    <th style="text-align:left; padding:10px 12px; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; color:#64748b; text-transform:uppercase;">Affected</th>
                    <th style="text-align:left; padding:10px 12px; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; color:#64748b; text-transform:uppercase;">Description</th>
                    <th style="text-align:left; padding:10px 12px; background:#f8fafc; border-bottom:2px solid #e2e8f0; font-size:12px; color:#64748b; text-transform:uppercase;">Action</th>
                </tr>
                $alertRows
            </table>
        </div>
        <p style="text-align:center; color:#94a3b8; font-size:12px; margin-top:16px;">
            This is an automated message from TenantScope Alerting System. Do not reply.
        </p>
    </div>
</body>
</html>
"@

    try {
        # Use System.Net.Mail for PowerShell 7 compatibility
        $mailMessage = [System.Net.Mail.MailMessage]::new()
        $mailMessage.From = [System.Net.Mail.MailAddress]::new($From)
        foreach ($recipient in $To) {
            $mailMessage.To.Add($recipient)
        }
        $mailMessage.Subject = $subject
        $mailMessage.Body = $htmlBody
        $mailMessage.IsBodyHtml = $true

        $smtpClient = [System.Net.Mail.SmtpClient]::new($Server, $Port)
        $smtpClient.EnableSsl = [bool]$UseSsl

        if ($Credential) {
            $smtpClient.Credentials = [System.Net.NetworkCredential]::new(
                $Credential.UserName,
                $Credential.GetNetworkCredential().Password
            )
        }

        $smtpClient.Send($mailMessage)

        $mailMessage.Dispose()
        $smtpClient.Dispose()

        return $true
    }
    catch {
        Write-Host "    [X] Email delivery failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# ============================================================================
# DATA SOURCE SCANNERS
# ============================================================================

function Get-CisBenchmarkAlerts {
    <#
    .SYNOPSIS
        Scans CIS benchmark results for failed controls at or above minimum severity.
    #>
    $filePath = Resolve-DataFile -FileName "cis-benchmark-results.json"
    if (-not $filePath) {
        Write-Host "    [--] cis-benchmark-results.json not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    $alerts = @()
    try {
        $data = Get-Content $filePath -Raw | ConvertFrom-Json

        # Handle both array and object with results property
        $controls = if ($data -is [array]) { $data } elseif ($data.results) { $data.results } elseif ($data.controls) { $data.controls } else { @() }

        foreach ($control in $controls) {
            $status = if ($control.status) { $control.status } elseif ($control.result) { $control.result } else { "" }
            $severity = if ($control.severity) { $control.severity.ToLower() } else { "medium" }

            # Only include failed controls at or above minimum severity
            if ($status -match "fail|non-compliant|noncompliant" -and (Test-SeverityMeetsThreshold -Severity $severity)) {
                $controlId = if ($control.controlId) { $control.controlId } elseif ($control.id) { $control.id } else { "Unknown" }
                $title = if ($control.title) { $control.title } elseif ($control.name) { $control.name } else { "CIS Control Failed" }
                $desc = if ($control.description) { $control.description } else { "CIS benchmark control did not pass assessment." }
                $remediation = if ($control.remediation) { $control.remediation } elseif ($control.recommendedActions) { $control.recommendedActions } else { "Review and remediate the failed CIS control." }

                $alerts += New-Alert `
                    -Source "cis-benchmark" `
                    -Severity $severity `
                    -Title "CIS Control Failed: $controlId" `
                    -Description "$title - $desc" `
                    -AffectedEntity $controlId `
                    -ActionRequired $remediation `
                    -DashboardLink "#security?filter=cis-$controlId"
            }
        }

        Write-Host "    [OK] CIS benchmark: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] CIS benchmark scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

function Get-RiskScoreAlerts {
    <#
    .SYNOPSIS
        Scans risk score data for users in critical or high risk tiers.
    #>
    $filePath = Resolve-DataFile -FileName "risk-scores.json"
    if (-not $filePath) {
        Write-Host "    [--] risk-scores.json not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    $alerts = @()
    try {
        $data = Get-Content $filePath -Raw | ConvertFrom-Json

        # Handle both array and object with users/scores property
        $users = if ($data -is [array]) { $data } elseif ($data.users) { $data.users } elseif ($data.scores) { $data.scores } else { @() }

        foreach ($user in $users) {
            $tier = if ($user.riskTier) { $user.riskTier.ToLower() } elseif ($user.tier) { $user.tier.ToLower() } elseif ($user.riskLevel) { $user.riskLevel.ToLower() } else { "" }

            # Map tier names to severities
            $severity = switch -Wildcard ($tier) {
                "*critical*" { "critical" }
                "*high*"     { "high" }
                "*medium*"   { "medium" }
                "*low*"      { "low" }
                default      { "" }
            }

            if ($severity -and (Test-SeverityMeetsThreshold -Severity $severity)) {
                $upn = if ($user.userPrincipalName) { $user.userPrincipalName } elseif ($user.upn) { $user.upn } else { "Unknown user" }
                $displayName = if ($user.displayName) { $user.displayName } elseif ($user.userDisplayName) { $user.userDisplayName } else { $upn }
                $score = if ($null -ne $user.riskScore) { $user.riskScore } elseif ($null -ne $user.score) { $user.score } else { "N/A" }

                $alerts += New-Alert `
                    -Source "risk-score" `
                    -Severity $severity `
                    -Title "User at $($severity) risk: $displayName" `
                    -Description "User $displayName ($upn) is in the $tier risk tier with a risk score of $score." `
                    -AffectedEntity $upn `
                    -ActionRequired "Review the user's risk factors and apply appropriate remediation (password reset, MFA enforcement, session revocation)." `
                    -DashboardLink "#users?filter=risk-$tier"
            }
        }

        Write-Host "    [OK] Risk scores: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] Risk score scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

function Get-SigninAnomalyAlerts {
    <#
    .SYNOPSIS
        Scans sign-in anomaly results for anomalies at or above minimum severity.
    #>
    $filePath = Resolve-DataFile -FileName "signin-anomaly-results.json"
    if (-not $filePath) {
        Write-Host "    [--] signin-anomaly-results.json not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    $alerts = @()
    try {
        $data = Get-Content $filePath -Raw | ConvertFrom-Json

        # Handle both array and object with anomalies property
        $anomalies = if ($data -is [array]) { $data } elseif ($data.anomalies) { $data.anomalies } elseif ($data.results) { $data.results } else { @() }

        foreach ($anomaly in $anomalies) {
            $severity = if ($anomaly.severity) { $anomaly.severity.ToLower() } elseif ($anomaly.riskLevel) { $anomaly.riskLevel.ToLower() } else { "medium" }

            if (Test-SeverityMeetsThreshold -Severity $severity) {
                $upn = if ($anomaly.userPrincipalName) { $anomaly.userPrincipalName } elseif ($anomaly.upn) { $anomaly.upn } else { "Unknown" }
                $title = if ($anomaly.title) { $anomaly.title } elseif ($anomaly.anomalyType) { $anomaly.anomalyType } elseif ($anomaly.type) { $anomaly.type } else { "Sign-in anomaly detected" }
                $desc = if ($anomaly.description) { $anomaly.description } elseif ($anomaly.detail) { $anomaly.detail } else { "Anomalous sign-in activity detected for user." }
                $action = if ($anomaly.recommendedAction) { $anomaly.recommendedAction } elseif ($anomaly.actionRequired) { $anomaly.actionRequired } else { "Investigate the sign-in activity and verify with the user." }

                $alerts += New-Alert `
                    -Source "signin-anomaly" `
                    -Severity $severity `
                    -Title "Sign-in anomaly: $title" `
                    -Description "$desc (User: $upn)" `
                    -AffectedEntity $upn `
                    -ActionRequired $action `
                    -DashboardLink "#signin-logs?filter=anomaly&user=$upn"
            }
        }

        Write-Host "    [OK] Sign-in anomalies: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] Sign-in anomaly scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

function Get-DefenderAlerts {
    <#
    .SYNOPSIS
        Scans Defender alerts for unresolved high/critical alerts.
    #>
    $filePath = Resolve-DataFile -FileName "defender-alerts.json"
    if (-not $filePath) {
        Write-Host "    [--] defender-alerts.json not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    $alerts = @()
    try {
        $data = Get-Content $filePath -Raw | ConvertFrom-Json

        # Handle both array and object with alerts/value property
        $defenderAlerts = if ($data -is [array]) { $data } elseif ($data.alerts) { $data.alerts } elseif ($data.value) { $data.value } else { @() }

        foreach ($da in $defenderAlerts) {
            $status = if ($da.status) { $da.status.ToLower() } else { "new" }
            $severity = if ($da.severity) { $da.severity.ToLower() } else { "medium" }

            # Only include unresolved alerts at or above minimum severity
            $isUnresolved = $status -notin @("resolved", "dismissed", "closed")

            if ($isUnresolved -and (Test-SeverityMeetsThreshold -Severity $severity)) {
                $title = if ($da.title) { $da.title } else { "Defender Alert" }
                $desc = if ($da.description) { $da.description } else { "Unresolved Defender alert requires attention." }
                $affectedUser = if ($da.affectedUser) { $da.affectedUser } elseif ($da.userPrincipalName) { $da.userPrincipalName } else { "" }
                $affectedDevice = if ($da.affectedDevice) { $da.affectedDevice } else { "" }
                $affected = if ($affectedUser -and $affectedDevice) { "$affectedUser ($affectedDevice)" } elseif ($affectedUser) { $affectedUser } elseif ($affectedDevice) { $affectedDevice } else { "N/A" }
                $action = if ($da.recommendedActions) { $da.recommendedActions } else { "Investigate and resolve the Defender alert." }

                $alerts += New-Alert `
                    -Source "defender" `
                    -Severity $severity `
                    -Title "Defender: $title" `
                    -Description $desc `
                    -AffectedEntity $affected `
                    -ActionRequired $action `
                    -DashboardLink "#security?filter=defender-alerts"
            }
        }

        Write-Host "    [OK] Defender alerts: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] Defender alert scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

function Get-IdentityRiskAlerts {
    <#
    .SYNOPSIS
        Scans identity risk data for high-risk users and critical detections.
    #>
    $filePath = Resolve-DataFile -FileName "identity-risk-data.json"
    if (-not $filePath) {
        Write-Host "    [--] identity-risk-data.json not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    $alerts = @()
    try {
        $data = Get-Content $filePath -Raw | ConvertFrom-Json

        # Process risky users
        $riskyUsers = if ($data.riskyUsers) { $data.riskyUsers } else { @() }

        foreach ($user in $riskyUsers) {
            $riskLevel = if ($user.riskLevel) { $user.riskLevel.ToLower() } else { "" }
            $riskState = if ($user.riskState) { $user.riskState } else { "" }

            # Map risk levels to alert severities
            $severity = switch ($riskLevel) {
                "high"   { "high" }
                "medium" { "medium" }
                "low"    { "low" }
                default  { "" }
            }

            # Escalate confirmed compromised to critical
            if ($riskState -eq "confirmedCompromised") {
                $severity = "critical"
            }

            if ($severity -and (Test-SeverityMeetsThreshold -Severity $severity)) {
                # Skip if already remediated or dismissed
                if ($riskState -in @("remediated", "dismissed")) { continue }

                $upn = if ($user.userPrincipalName) { $user.userPrincipalName } else { "Unknown" }
                $displayName = if ($user.userDisplayName) { $user.userDisplayName } else { $upn }
                $detail = if ($user.riskDetail) { $user.riskDetail } else { "No detail available" }

                $actionText = switch ($riskState) {
                    "confirmedCompromised" { "URGENT: Revoke all sessions, reset password, review audit logs, and investigate data access immediately." }
                    "atRisk"              { "Investigate the risk indicators. Reset password and require MFA re-registration if compromise is suspected." }
                    default               { "Review the user's risk indicators and take appropriate remediation action." }
                }

                $alerts += New-Alert `
                    -Source "identity-risk" `
                    -Severity $severity `
                    -Title "Identity risk: $displayName ($riskLevel)" `
                    -Description "User $displayName ($upn) has risk level '$riskLevel' with state '$riskState'. Detail: $detail" `
                    -AffectedEntity $upn `
                    -ActionRequired $actionText `
                    -DashboardLink "#identity-risk?filter=user&upn=$upn"
            }
        }

        # Process critical insights if available
        $insights = if ($data.insights) { $data.insights } else { @() }

        foreach ($insight in $insights) {
            $insightSeverity = if ($insight.severity -eq "critical") { "critical" } elseif ($insight.severity -eq "warning") { "high" } else { "medium" }

            if (Test-SeverityMeetsThreshold -Severity $insightSeverity) {
                $title = if ($insight.title) { $insight.title } else { "Identity Risk Insight" }
                $desc = if ($insight.description) { $insight.description } else { "" }
                $action = if ($insight.recommendedAction) { $insight.recommendedAction } else { "Review identity risk insights in the dashboard." }

                $alerts += New-Alert `
                    -Source "identity-risk" `
                    -Severity $insightSeverity `
                    -Title "Identity insight: $title" `
                    -Description $desc `
                    -AffectedEntity "Tenant-wide" `
                    -ActionRequired $action `
                    -DashboardLink "#identity-risk?filter=insights"
            }
        }

        Write-Host "    [OK] Identity risk: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] Identity risk scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

function Get-CAGapAlerts {
    <#
    .SYNOPSIS
        Scans CA gap analysis results for critical/high findings.
    #>
    $alerts = @()

    # Try to find the ca-gap-analysis directory
    $caDir = Resolve-DataDirectory -DirName "ca-gap-analysis"

    if (-not $caDir) {
        Write-Host "    [--] ca-gap-analysis/ directory not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    try {
        # Find the most recent JSON report in the directory
        $caFiles = Get-ChildItem -Path $caDir -Filter "*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
        if ($caFiles.Count -eq 0) {
            Write-Host "    [--] No CA gap analysis JSON files found, skipping" -ForegroundColor DarkGray
            return @()
        }

        $latestFile = $caFiles[0].FullName
        $data = Get-Content $latestFile -Raw | ConvertFrom-Json

        $findings = if ($data.findings) { $data.findings } else { @() }

        foreach ($finding in $findings) {
            $severity = if ($finding.severity) { $finding.severity.ToLower() } else { "medium" }

            if (Test-SeverityMeetsThreshold -Severity $severity) {
                $title = if ($finding.finding) { $finding.finding } elseif ($finding.title) { $finding.title } else { "CA Gap Finding" }
                $desc = if ($finding.description) { $finding.description } else { "Conditional Access gap identified." }
                $detail = if ($finding.detail) { $finding.detail } else { "" }
                $remediation = if ($finding.remediation) { $finding.remediation } else { "Review and remediate the Conditional Access gap." }
                $category = if ($finding.category) { $finding.category } else { "CA Gap" }

                $fullDesc = if ($detail) { "$desc Detail: $detail" } else { $desc }

                $alerts += New-Alert `
                    -Source "ca-gap-analysis" `
                    -Severity $severity `
                    -Title "CA Gap: $title" `
                    -Description $fullDesc `
                    -AffectedEntity $category `
                    -ActionRequired $remediation `
                    -DashboardLink "#conditional-access?filter=gaps"
            }
        }

        Write-Host "    [OK] CA gap analysis: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] CA gap analysis scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

function Get-TrendDriftAlerts {
    <#
    .SYNOPSIS
        Scans trend history for significant metric degradation.

    .DESCRIPTION
        Compares the two most recent trend entries to detect:
        - MFA coverage dropped more than 5 percentage points
        - Compliance rate dropped more than 5 percentage points
        - Active alerts increased significantly
        - Secure Score dropped more than 5 points
    #>
    $filePath = Resolve-DataFile -FileName "trend-history.json"
    if (-not $filePath) {
        Write-Host "    [--] trend-history.json not found, skipping" -ForegroundColor DarkGray
        return @()
    }

    $alerts = @()
    try {
        $data = Get-Content $filePath -Raw | ConvertFrom-Json

        if ($data -isnot [array] -or $data.Count -lt 2) {
            Write-Host "    [--] Trend history: insufficient data points for drift detection" -ForegroundColor DarkGray
            return @()
        }

        # Sort by date descending, compare the two most recent entries
        $sorted = $data | Sort-Object { [DateTime]$_.date } -Descending
        $current = $sorted[0]
        $previous = $sorted[1]

        # MFA percentage drift
        if ($null -ne $current.mfaPct -and $null -ne $previous.mfaPct) {
            $mfaDrop = $previous.mfaPct - $current.mfaPct
            if ($mfaDrop -gt 5) {
                $severity = if ($mfaDrop -gt 15) { "critical" } elseif ($mfaDrop -gt 10) { "high" } else { "high" }

                if (Test-SeverityMeetsThreshold -Severity $severity) {
                    $alerts += New-Alert `
                        -Source "trend-drift" `
                        -Severity $severity `
                        -Title "MFA coverage dropped $($mfaDrop) points" `
                        -Description "MFA coverage decreased from $($previous.mfaPct)% to $($current.mfaPct)% between $($previous.date) and $($current.date). This indicates users may have been excluded from MFA policies or new users lack MFA." `
                        -AffectedEntity "Tenant MFA Coverage" `
                        -ActionRequired "Investigate MFA policy changes. Identify users without MFA and enforce registration." `
                        -DashboardLink "#overview?filter=mfa-trend"
                }
            }
        }

        # Compliance percentage drift
        if ($null -ne $current.compliancePct -and $null -ne $previous.compliancePct) {
            $complianceDrop = $previous.compliancePct - $current.compliancePct
            if ($complianceDrop -gt 5) {
                $severity = if ($complianceDrop -gt 15) { "critical" } elseif ($complianceDrop -gt 10) { "high" } else { "high" }

                if (Test-SeverityMeetsThreshold -Severity $severity) {
                    $alerts += New-Alert `
                        -Source "trend-drift" `
                        -Severity $severity `
                        -Title "Device compliance dropped $($complianceDrop) points" `
                        -Description "Device compliance decreased from $($previous.compliancePct)% to $($current.compliancePct)% between $($previous.date) and $($current.date). Devices may have fallen out of compliance with policies." `
                        -AffectedEntity "Tenant Device Compliance" `
                        -ActionRequired "Review compliance policy changes and identify noncompliant devices. Check for policy deployment issues." `
                        -DashboardLink "#compliance?filter=drift"
                }
            }
        }

        # Active alerts spike
        if ($null -ne $current.activeAlerts -and $null -ne $previous.activeAlerts) {
            $alertIncrease = $current.activeAlerts - $previous.activeAlerts
            if ($alertIncrease -gt 5 -and $current.activeAlerts -gt 10) {
                $severity = "high"

                if (Test-SeverityMeetsThreshold -Severity $severity) {
                    $alerts += New-Alert `
                        -Source "trend-drift" `
                        -Severity $severity `
                        -Title "Active alerts increased by $alertIncrease" `
                        -Description "Active alerts rose from $($previous.activeAlerts) to $($current.activeAlerts) between $($previous.date) and $($current.date). A spike in alerts may indicate a security incident or policy change." `
                        -AffectedEntity "Tenant Security Alerts" `
                        -ActionRequired "Triage the new alerts and investigate for potential security incidents." `
                        -DashboardLink "#security?filter=active-alerts"
                }
            }
        }

        # Secure Score drift
        if ($null -ne $current.secureScore -and $null -ne $previous.secureScore) {
            $scoreDrop = $previous.secureScore - $current.secureScore
            if ($scoreDrop -gt 5) {
                $severity = if ($scoreDrop -gt 15) { "critical" } elseif ($scoreDrop -gt 10) { "high" } else { "medium" }

                if (Test-SeverityMeetsThreshold -Severity $severity) {
                    $alerts += New-Alert `
                        -Source "trend-drift" `
                        -Severity $severity `
                        -Title "Secure Score dropped $scoreDrop points" `
                        -Description "Microsoft Secure Score decreased from $($previous.secureScore) to $($current.secureScore) between $($previous.date) and $($current.date)." `
                        -AffectedEntity "Tenant Secure Score" `
                        -ActionRequired "Review Secure Score recommendations and identify which controls regressed." `
                        -DashboardLink "#overview?filter=secure-score"
                }
            }
        }

        Write-Host "    [OK] Trend drift: $($alerts.Count) alert(s)" -ForegroundColor $(if ($alerts.Count -gt 0) { "Yellow" } else { "Green" })
    }
    catch {
        Write-Host "    [X] Trend drift scan error: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $alerts
}

# ============================================================================
# MAIN ALERTING PIPELINE
# ============================================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  TenantScope - Alerting System" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Minimum severity: $MinimumSeverity" -ForegroundColor Gray
Write-Host "  Output path:      $OutputPath" -ForegroundColor Gray
if ($DryRun) {
    Write-Host "  Mode:             DRY RUN (no notifications will be sent)" -ForegroundColor Yellow
}
else {
    $channels = @()
    if ($TeamsWebhookUrl) { $channels += "Teams" }
    if ($SmtpServer -and $SmtpFrom -and $SmtpTo) { $channels += "Email" }
    if ($channels.Count -eq 0) { $channels += "Console only" }
    Write-Host "  Delivery:         $($channels -join ', ')" -ForegroundColor Gray
}
Write-Host ""

# -----------------------------------------------------------------------
# 1. Load alert history for deduplication
# -----------------------------------------------------------------------
Write-Host "  Loading alert history..." -ForegroundColor Gray

$alertHistory = @()
if (Test-Path $alertsHistoryFile) {
    try {
        $historyData = Get-Content $alertsHistoryFile -Raw | ConvertFrom-Json
        if ($historyData -is [array]) {
            $alertHistory = @($historyData)
        }
        elseif ($historyData.alerts) {
            $alertHistory = @($historyData.alerts)
        }
        Write-Host "    Loaded $($alertHistory.Count) historical alerts" -ForegroundColor Gray
    }
    catch {
        Write-Host "    Could not load alert history, starting fresh" -ForegroundColor Yellow
    }
}
else {
    Write-Host "    No previous history file found, starting fresh" -ForegroundColor Gray
}

# -----------------------------------------------------------------------
# 2. Scan all data sources for alerts
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Scanning data sources..." -ForegroundColor Gray

$allAlerts = @()

$allAlerts += @(Get-CisBenchmarkAlerts)
$allAlerts += @(Get-RiskScoreAlerts)
$allAlerts += @(Get-SigninAnomalyAlerts)
$allAlerts += @(Get-DefenderAlerts)
$allAlerts += @(Get-IdentityRiskAlerts)
$allAlerts += @(Get-CAGapAlerts)
$allAlerts += @(Get-TrendDriftAlerts)

Write-Host ""
Write-Host "  Total raw alerts: $($allAlerts.Count)" -ForegroundColor Gray

# -----------------------------------------------------------------------
# 3. Deduplicate against history (24-hour window)
# -----------------------------------------------------------------------
Write-Host "  Deduplicating against 24-hour history..." -ForegroundColor Gray

$newAlerts = @()
$duplicateCount = 0

foreach ($alert in $allAlerts) {
    if (Test-AlertIsDuplicate -Alert $alert -History $alertHistory) {
        $duplicateCount++
    }
    else {
        $newAlerts += $alert
    }
}

Write-Host "    Suppressed $duplicateCount duplicate(s)" -ForegroundColor Gray
Write-Host "    New alerts: $($newAlerts.Count)" -ForegroundColor $(if ($newAlerts.Count -gt 0) { "Yellow" } else { "Green" })

# -----------------------------------------------------------------------
# 4. Classify alert counts by severity
# -----------------------------------------------------------------------
$criticalAlerts = @($newAlerts | Where-Object { $_.severity -eq "critical" })
$highAlerts     = @($newAlerts | Where-Object { $_.severity -eq "high" })
$mediumAlerts   = @($newAlerts | Where-Object { $_.severity -eq "medium" })
$lowAlerts      = @($newAlerts | Where-Object { $_.severity -eq "low" })

# -----------------------------------------------------------------------
# 5. Deliver alerts
# -----------------------------------------------------------------------
$deliveryTargets = @()

if ($newAlerts.Count -gt 0) {
    Write-Host ""
    Write-Host "  Delivering alerts..." -ForegroundColor Gray

    # --- Teams delivery ---
    if ($TeamsWebhookUrl) {
        if ($DryRun) {
            Write-Host "    [DryRun] Would send $($newAlerts.Count) alert(s) to Teams webhook" -ForegroundColor Yellow
            $deliveryTargets += "Teams (DryRun)"
        }
        else {
            $teamsSent = 0
            $teamsFailed = 0

            foreach ($alert in $newAlerts) {
                $result = Send-TeamsAlert -Alert $alert -WebhookUrl $TeamsWebhookUrl
                if ($result) { $teamsSent++ } else { $teamsFailed++ }

                # Brief pause to avoid webhook throttling
                Start-Sleep -Milliseconds 500
            }

            Write-Host "    [OK] Teams: $teamsSent sent, $teamsFailed failed" -ForegroundColor $(if ($teamsFailed -gt 0) { "Yellow" } else { "Green" })
            $deliveryTargets += "Teams ($teamsSent sent)"
        }
    }

    # --- Email delivery ---
    if ($SmtpServer -and $SmtpFrom -and $SmtpTo) {
        if ($DryRun) {
            Write-Host "    [DryRun] Would send email digest with $($newAlerts.Count) alert(s) to: $($SmtpTo -join ', ')" -ForegroundColor Yellow
            $deliveryTargets += "Email (DryRun)"
        }
        else {
            $emailParams = @{
                Alerts = $newAlerts
                Server = $SmtpServer
                From   = $SmtpFrom
                To     = $SmtpTo
                Port   = $SmtpPort
            }
            if ($UseSsl) { $emailParams.UseSsl = $true }
            if ($SmtpCredential) { $emailParams.Credential = $SmtpCredential }

            $emailResult = Send-EmailAlert @emailParams

            if ($emailResult) {
                Write-Host "    [OK] Email sent to: $($SmtpTo -join ', ')" -ForegroundColor Green
                $deliveryTargets += "Email ($($SmtpTo -join ', '))"
            }
            else {
                $deliveryTargets += "Email (failed)"
            }
        }
    }

    # --- Console-only fallback ---
    if (-not $TeamsWebhookUrl -and -not ($SmtpServer -and $SmtpFrom -and $SmtpTo)) {
        if ($DryRun) {
            $deliveryTargets += "DryRun"
        }
        else {
            $deliveryTargets += "Console"
        }
    }
}
else {
    $deliveryTargets += "None (no new alerts)"
}

# -----------------------------------------------------------------------
# 6. Save alert feed and update history
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  Saving alert data..." -ForegroundColor Gray

# Build the complete alert feed (all alerts including raw)
$alertFeed = [PSCustomObject]@{
    generated        = (Get-Date).ToString("o")
    minimumSeverity  = $MinimumSeverity
    totalAlerts      = $allAlerts.Count
    newAlerts        = $newAlerts.Count
    duplicatesSuppressed = $duplicateCount
    summary          = [PSCustomObject]@{
        critical = $criticalAlerts.Count
        high     = $highAlerts.Count
        medium   = $mediumAlerts.Count
        low      = $lowAlerts.Count
    }
    deliveredTo      = $deliveryTargets
    alerts           = $allAlerts
}

# Save alerts-feed.json
$alertFeed | ConvertTo-Json -Depth 10 | Set-Content -Path $alertsFeedFile -Encoding UTF8
Write-Host "    Saved: $alertsFeedFile" -ForegroundColor Gray

# Append new alerts to history
$updatedHistory = @($alertHistory) + @($newAlerts)

# Prune history older than 30 days to prevent unbounded growth
$pruneCutoff = (Get-Date).AddDays(-30)
$prunedHistory = @()
foreach ($entry in $updatedHistory) {
    if ($entry.timestamp) {
        try {
            $entryTime = [DateTime]::Parse($entry.timestamp)
            if ($entryTime -ge $pruneCutoff) {
                $prunedHistory += $entry
            }
        }
        catch {
            $prunedHistory += $entry
        }
    }
    else {
        $prunedHistory += $entry
    }
}

$prunedHistory | ConvertTo-Json -Depth 10 | Set-Content -Path $alertsHistoryFile -Encoding UTF8
Write-Host "    Saved: $alertsHistoryFile ($($prunedHistory.Count) entries, 30-day retention)" -ForegroundColor Gray

# Write to dashboard data directory for dashboard consumption
if (Test-Path (Split-Path $dashboardAlertsFeedFile -Parent)) {
    $alertFeed | ConvertTo-Json -Depth 10 | Set-Content -Path $dashboardAlertsFeedFile -Encoding UTF8
    Write-Host "    Saved: $dashboardAlertsFeedFile" -ForegroundColor Gray
}
else {
    # Create dashboard/data if it does not exist yet
    try {
        New-Item -ItemType Directory -Path (Split-Path $dashboardAlertsFeedFile -Parent) -Force | Out-Null
        $alertFeed | ConvertTo-Json -Depth 10 | Set-Content -Path $dashboardAlertsFeedFile -Encoding UTF8
        Write-Host "    Saved: $dashboardAlertsFeedFile" -ForegroundColor Gray
    }
    catch {
        Write-Host "    [!] Could not write dashboard feed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------
# 7. Console summary
# -----------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  Alert Summary" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

$summaryColor = if ($criticalAlerts.Count -gt 0) { "Red" } elseif ($highAlerts.Count -gt 0) { "Yellow" } else { "Green" }

Write-Host "  $($newAlerts.Count) new alerts ($($criticalAlerts.Count) critical, $($highAlerts.Count) high). Sent to: $($deliveryTargets -join ', ')" -ForegroundColor $summaryColor

if ($newAlerts.Count -gt 0) {
    Write-Host ""
    Write-Host "  Breakdown:" -ForegroundColor Gray
    if ($criticalAlerts.Count -gt 0) {
        Write-Host "    Critical: $($criticalAlerts.Count)" -ForegroundColor Red
        foreach ($a in $criticalAlerts) {
            Write-Host "      - $($a.title)" -ForegroundColor Red
        }
    }
    if ($highAlerts.Count -gt 0) {
        Write-Host "    High:     $($highAlerts.Count)" -ForegroundColor DarkYellow
        foreach ($a in $highAlerts) {
            Write-Host "      - $($a.title)" -ForegroundColor DarkYellow
        }
    }
    if ($mediumAlerts.Count -gt 0) {
        Write-Host "    Medium:   $($mediumAlerts.Count)" -ForegroundColor Yellow
    }
    if ($lowAlerts.Count -gt 0) {
        Write-Host "    Low:      $($lowAlerts.Count)" -ForegroundColor Gray
    }
}
else {
    Write-Host ""
    Write-Host "  No new alerts at '$MinimumSeverity' severity or above. All clear." -ForegroundColor Green
}

Write-Host ""
Write-Host "  Alerting complete." -ForegroundColor Cyan
Write-Host ""

# Return the alert feed for programmatic consumption
return $alertFeed
