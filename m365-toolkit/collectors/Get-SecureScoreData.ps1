# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Henter Microsoft Secure Score fra Graph API.

.DESCRIPTION
    Retrieves the most recent Microsoft Secure Score for the tenant,
    including the top improvement actions with the highest potential impact.

    Graph API endpoint:
    - GET /security/secureScores?$top=1

    Required scopes:
    - SecurityEvents.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes secure-score.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] 1 if score retrieved, 0 otherwise
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-SecureScoreData.ps1 -Config $config -OutputPath ".\data\secure-score.json"
#>

#Requires -Version 7.0

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

try {
    Write-Host "    Collecting Microsoft Secure Score..." -ForegroundColor Gray

    # Fetch the most recent secure score
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/security/secureScores?`$top=1" `
            -OutputType PSObject
    }

    $scores = $response.value
    if (-not $scores -or $scores.Count -eq 0) {
        Write-Host "    No Secure Score data available" -ForegroundColor Yellow

        # Write null to prevent dashboard errors
        "null" | Set-Content -Path $OutputPath -Encoding UTF8

        return @{
            Success = $true
            Count   = 0
            Errors  = @("No Secure Score data available")
        }
    }

    $score = $scores[0]
    $currentScore = [Math]::Round($score.currentScore, 1)
    $maxScore = [Math]::Round($score.maxScore, 1)
    $scorePct = 0
    if ($maxScore -gt 0) {
        $scorePct = [Math]::Round(($currentScore / $maxScore) * 100)
    }

    # Extract top 5 improvement actions by potential score impact
    $controlScores = @()
    if ($score.controlScores) {
        $sorted = $score.controlScores |
            Where-Object { $_.scoreInPercentage -lt 100 } |
            Sort-Object -Property { $_.maxScore - ($_.maxScore * $_.scoreInPercentage / 100) } -Descending |
            Select-Object -First 5

        foreach ($ctrl in $sorted) {
            $controlScores += [PSCustomObject]@{
                name              = $ctrl.controlName
                description       = $ctrl.description
                scoreInPercentage = [Math]::Round($ctrl.scoreInPercentage, 0)
                maxScore          = [Math]::Round($ctrl.maxScore, 1)
            }
        }
    }

    # Build output object
    $result = [PSCustomObject]@{
        currentScore  = $currentScore
        maxScore      = $maxScore
        scorePct      = $scorePct
        controlScores = $controlScores
        collectedAt   = (Get-Date).ToString("o")
    }

    $result | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    Secure Score: $currentScore / $maxScore ($scorePct%)" -ForegroundColor Green

    return @{
        Success = $true
        Count   = 1
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|unauthorized") {
        Write-Host "    Secure Score collection requires SecurityEvents.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    Failed: $errorMessage" -ForegroundColor Red

    # Write null to prevent dashboard errors
    "null" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
