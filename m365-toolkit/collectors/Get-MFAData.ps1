# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects MFA registration status for all users from Microsoft Graph.

.DESCRIPTION
    Retrieves authentication method registration details for each user,
    including whether they have MFA registered, which methods they use,
    and their default authentication method.

    Graph API endpoint: GET /reports/authenticationMethods/userRegistrationDetails
    Required scope: Reports.Read.All, AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes mfa-status.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of MFA records collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-MFAData.ps1 -Config $config -OutputPath ".\data\mfa-status.json"
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
        [int]$MaxRetries = 3,

        [Parameter()]
        [int]$DefaultBackoffSeconds = 30
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            if ($_.Exception.Message -match "429|throttl|TooManyRequests") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $DefaultBackoffSeconds * $attempt
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
$mfaCount = 0

try {
    Write-Host "    Collecting MFA registration status..." -ForegroundColor Gray

    # Try to get MFA registration details from the reports endpoint
    # This endpoint provides comprehensive MFA status for all users
    $mfaDetails = $null

    try {
        # Use the authentication methods user registration details report
        $mfaDetails = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgReportAuthenticationMethodUserRegistrationDetail -All
        }
    }
    catch {
        # If the cmdlet fails, try the direct API call
        Write-Host "      Trying alternative method..." -ForegroundColor Gray

        try {
            $mfaDetails = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" -OutputType PSObject
            }

            # Handle paged results if necessary
            if ($mfaDetails.value) {
                $allDetails = $mfaDetails.value
                while ($mfaDetails.'@odata.nextLink') {
                    $mfaDetails = Invoke-MgGraphRequest -Method GET -Uri $mfaDetails.'@odata.nextLink' -OutputType PSObject
                    $allDetails += $mfaDetails.value
                }
                $mfaDetails = $allDetails
            }
        }
        catch {
            throw "Unable to retrieve MFA data: $($_.Exception.Message)"
        }
    }

    if ($null -eq $mfaDetails) {
        throw "No MFA data returned from Graph API"
    }

    Write-Host "      Retrieved $($mfaDetails.Count) MFA records from Graph API" -ForegroundColor Gray

    # Process each MFA record
    $processedMfa = @()

    foreach ($record in $mfaDetails) {
        # Extract methods registered
        $methods = @()
        if ($record.MethodsRegistered) {
            $methods = $record.MethodsRegistered
        }

        # Build output object matching our schema
        $mfaRecord = [PSCustomObject]@{
            userId              = $record.Id
            userPrincipalName   = $record.UserPrincipalName
            isMfaRegistered     = [bool]$record.IsMfaRegistered
            isMfaCapable        = [bool]$record.IsMfaCapable
            methods             = $methods
            defaultMethod       = $record.DefaultMfaMethod
        }

        $processedMfa += $mfaRecord
        $mfaCount++

        # Progress indicator
        if ($mfaCount % 100 -eq 0) {
            Write-Host "      Processed $mfaCount records..." -ForegroundColor Gray
        }
    }

    # Write results to JSON file
    $processedMfa | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

    Write-Host "    ✓ Collected $mfaCount MFA records" -ForegroundColor Green

    return @{
        Success = $true
        Count   = $mfaCount
        Errors  = $errors
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing issue (MFA reports require specific licenses)
    if ($errorMessage -match "license|subscription|feature|not available") {
        Write-Host "    ⚠ MFA reports may require Entra ID P1/P2 license" -ForegroundColor Yellow
    }

    Write-Host "    ✗ Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8

    return @{
        Success = $false
        Count   = 0
        Errors  = $errors
    }
}
