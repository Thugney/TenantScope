# ============================================================================
# TenantScope - DefenderApi
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/TenantScope
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Defender API authentication and helper functions for Advanced Hunting.

.DESCRIPTION
    The Microsoft Defender API (api.securitycenter.microsoft.com) requires
    separate authentication from Microsoft Graph. This module provides:
    - Device code authentication for Defender API
    - Token caching for the session
    - Helper function for Advanced Hunting queries

    API Endpoint: https://api.securitycenter.microsoft.com
    Required Permission: AdvancedQuery.Read (delegated) or AdvancedQuery.Read.All (app)

.NOTES
    Import this module in collectors that need Defender API access:
    . "$PSScriptRoot\..\lib\DefenderApi.ps1"
#>

#Requires -Version 7.0

# Script-level token cache
$script:DefenderToken = $null
$script:DefenderTokenExpiry = $null

# Defender API constants
$script:DefenderApiBase = "https://api.securitycenter.microsoft.com"
$script:DefenderResource = "https://api.securitycenter.microsoft.com"

# Microsoft's public client ID for device code flow (same as Azure CLI)
$script:PublicClientId = "1950a258-227b-4e31-a9cf-717495945fc2"

function Connect-DefenderApi {
    <#
    .SYNOPSIS
        Authenticates to the Microsoft Defender API using device code flow.

    .DESCRIPTION
        Obtains an access token for the Defender API using device code authentication.
        The token is cached for the session duration.

    .PARAMETER TenantId
        The Azure AD tenant ID.

    .PARAMETER Force
        Force re-authentication even if a valid token exists.

    .OUTPUTS
        Boolean indicating success.

    .EXAMPLE
        $connected = Connect-DefenderApi -TenantId "contoso.onmicrosoft.com"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter()]
        [switch]$Force
    )

    # Check if we have a valid cached token
    if (-not $Force -and $script:DefenderToken -and $script:DefenderTokenExpiry) {
        if ((Get-Date) -lt $script:DefenderTokenExpiry.AddMinutes(-5)) {
            Write-Host "    Using cached Defender API token" -ForegroundColor Gray
            return $true
        }
    }

    Write-Host "    Authenticating to Defender API..." -ForegroundColor Gray

    try {
        # Device code flow endpoint
        $deviceCodeUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode"
        $tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"

        # Request device code
        $deviceCodeBody = @{
            client_id = $script:PublicClientId
            scope     = "$script:DefenderResource/AdvancedQuery.Read offline_access"
        }

        $deviceCodeResponse = Invoke-RestMethod -Method POST -Uri $deviceCodeUrl -Body $deviceCodeBody -ContentType "application/x-www-form-urlencoded"

        # Display device code instructions
        Write-Host ""
        Write-Host "    ============================================" -ForegroundColor Yellow
        Write-Host "    Defender API Authentication Required" -ForegroundColor Yellow
        Write-Host "    ============================================" -ForegroundColor Yellow
        Write-Host "    $($deviceCodeResponse.message)" -ForegroundColor Cyan
        Write-Host "    ============================================" -ForegroundColor Yellow
        Write-Host ""

        # Poll for token
        $tokenBody = @{
            client_id   = $script:PublicClientId
            grant_type  = "urn:ietf:params:oauth:grant-type:device_code"
            device_code = $deviceCodeResponse.device_code
        }

        $timeout = [DateTime]::Now.AddSeconds($deviceCodeResponse.expires_in)
        $interval = $deviceCodeResponse.interval

        while ([DateTime]::Now -lt $timeout) {
            Start-Sleep -Seconds $interval

            try {
                $tokenResponse = Invoke-RestMethod -Method POST -Uri $tokenUrl -Body $tokenBody -ContentType "application/x-www-form-urlencoded"

                # Success - cache the token
                $script:DefenderToken = $tokenResponse.access_token
                $script:DefenderTokenExpiry = (Get-Date).AddSeconds($tokenResponse.expires_in)

                Write-Host "    [OK] Connected to Defender API" -ForegroundColor Green
                return $true
            }
            catch {
                $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue

                if ($errorResponse.error -eq "authorization_pending") {
                    # Still waiting for user to authenticate
                    continue
                }
                elseif ($errorResponse.error -eq "slow_down") {
                    $interval += 5
                    continue
                }
                elseif ($errorResponse.error -eq "expired_token") {
                    Write-Host "    [X] Device code expired. Please try again." -ForegroundColor Red
                    return $false
                }
                else {
                    throw
                }
            }
        }

        Write-Host "    [X] Authentication timed out" -ForegroundColor Red
        return $false
    }
    catch {
        Write-Host "    [X] Failed to authenticate to Defender API: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Get-DefenderApiToken {
    <#
    .SYNOPSIS
        Returns the cached Defender API token.

    .OUTPUTS
        The access token string, or $null if not authenticated.
    #>
    [CmdletBinding()]
    param()

    if ($script:DefenderToken -and $script:DefenderTokenExpiry) {
        if ((Get-Date) -lt $script:DefenderTokenExpiry.AddMinutes(-5)) {
            return $script:DefenderToken
        }
    }

    return $null
}

function Test-DefenderApiConnection {
    <#
    .SYNOPSIS
        Tests if we have a valid Defender API connection.

    .OUTPUTS
        Boolean indicating if connected.
    #>
    [CmdletBinding()]
    param()

    return ($null -ne (Get-DefenderApiToken))
}

function Invoke-DefenderAdvancedHunting {
    <#
    .SYNOPSIS
        Executes an Advanced Hunting query against the Defender API.

    .DESCRIPTION
        Runs a KQL query against the Defender Advanced Hunting API and returns results.
        Includes retry logic for transient errors.

    .PARAMETER Query
        The KQL query to execute.

    .PARAMETER TenantId
        Tenant ID for authentication (used if not already connected).

    .PARAMETER MaxRetries
        Maximum retry attempts for transient errors. Default is 3.

    .OUTPUTS
        The query results, or $null on failure.

    .EXAMPLE
        $results = Invoke-DefenderAdvancedHunting -Query "DeviceInfo | take 10" -TenantId $tenantId
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Query,

        [Parameter()]
        [string]$TenantId,

        [Parameter()]
        [int]$MaxRetries = 3
    )

    # Ensure we have a valid token
    $token = Get-DefenderApiToken
    if (-not $token) {
        if ($TenantId) {
            $connected = Connect-DefenderApi -TenantId $TenantId
            if (-not $connected) {
                throw "Failed to authenticate to Defender API"
            }
            $token = Get-DefenderApiToken
        }
        else {
            throw "Not connected to Defender API. Call Connect-DefenderApi first."
        }
    }

    $uri = "$script:DefenderApiBase/api/advancedqueries/run"
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }
    $body = @{ Query = $Query } | ConvertTo-Json -Depth 4

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            $response = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $body
            return $response
        }
        catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            $errorMessage = $_.Exception.Message

            # Retry on throttling or transient errors
            if ($statusCode -in @(429, 500, 502, 503, 504)) {
                $attempt++
                if ($attempt -gt $MaxRetries) {
                    throw "Max retries exceeded for Advanced Hunting query"
                }

                $waitSeconds = [Math]::Pow(2, $attempt) * 10
                Write-Host "      Defender API error ($statusCode). Waiting ${waitSeconds}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $waitSeconds
            }
            else {
                throw
            }
        }
    }
}

function Disconnect-DefenderApi {
    <#
    .SYNOPSIS
        Clears the cached Defender API token.
    #>
    [CmdletBinding()]
    param()

    $script:DefenderToken = $null
    $script:DefenderTokenExpiry = $null
    Write-Host "    Disconnected from Defender API" -ForegroundColor Gray
}

# ============================================================================
# NOTE: This file is designed to be dot-sourced:
#   . "$PSScriptRoot\..\lib\DefenderApi.ps1"
# ============================================================================
