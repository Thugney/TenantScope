# ============================================================================
# TenantScope - Dashboard Server with Usage Tracking
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Starts a local web server to host the TenantScope dashboard with usage tracking.

.DESCRIPTION
    This script creates a simple HTTP server that:
    1. Serves the dashboard files over HTTP (avoids file:// CORS issues)
    2. Logs who accesses the dashboard (username, timestamp, page)
    3. Provides a usage analytics endpoint

    Perfect for shared server deployments where multiple IT admins need access.

.PARAMETER Port
    The port to run the server on. Default: 8080

.PARAMETER LogPath
    Path to the usage log file. Default: ./data/usage-log.json

.PARAMETER OpenBrowser
    If specified, opens the dashboard in the default browser after starting.

.EXAMPLE
    .\scripts\Start-DashboardServer.ps1
    Starts server on port 8080

.EXAMPLE
    .\scripts\Start-DashboardServer.ps1 -Port 9000 -OpenBrowser
    Starts server on port 9000 and opens browser
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [int]$Port = 8080,

    [Parameter()]
    [string]$LogPath,

    [Parameter()]
    [switch]$OpenBrowser,

    [Parameter()]
    [switch]$NoTracking,

    [Parameter()]
    [switch]$PublicStats
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$scriptRoot = Split-Path $PSScriptRoot -Parent
$dashboardPath = Join-Path $scriptRoot "dashboard"
$dataPath = Join-Path $scriptRoot "data"
$configPath = Join-Path $scriptRoot "config.json"

if (-not $LogPath) {
    $LogPath = Join-Path $dataPath "usage-log.json"
}

# Load config for server settings
$serverConfig = @{
    usageTracking = @{
        enabled = $true
        showStatsToAllUsers = $false
        adminUsers = @()
    }
}

if (Test-Path $configPath) {
    try {
        $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
        if ($config.server -and $config.server.usageTracking) {
            $serverConfig.usageTracking.enabled = $config.server.usageTracking.enabled -ne $false
            $serverConfig.usageTracking.showStatsToAllUsers = $config.server.usageTracking.showStatsToAllUsers -eq $true
            $serverConfig.usageTracking.adminUsers = @($config.server.usageTracking.adminUsers)
        }
    }
    catch {
        Write-Warning "Could not load config.json: $($_.Exception.Message)"
    }
}

# Command-line switches override config
if ($NoTracking) {
    $serverConfig.usageTracking.enabled = $false
}
if ($PublicStats) {
    $serverConfig.usageTracking.showStatsToAllUsers = $true
}

# Ensure data directory exists
if (-not (Test-Path $dataPath)) {
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
}

# Initialize usage log if it doesn't exist
if (-not (Test-Path $LogPath)) {
    @{
        sessions = @()
        pageViews = @()
        summary = @{
            totalSessions = 0
            uniqueUsers = @()
            lastAccess = $null
        }
    } | ConvertTo-Json -Depth 10 | Set-Content -Path $LogPath -Encoding UTF8
}

# ============================================================================
# MIME TYPE MAPPING
# ============================================================================

$mimeTypes = @{
    ".html" = "text/html"
    ".htm"  = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
    ".ttf"  = "font/ttf"
}

# ============================================================================
# LOGGING FUNCTIONS
# ============================================================================

function Write-UsageLog {
    param(
        [string]$Username,
        [string]$Action,
        [string]$Page,
        [string]$Details
    )

    try {
        $log = Get-Content -Path $LogPath -Raw | ConvertFrom-Json

        $entry = @{
            timestamp = (Get-Date).ToString("o")
            username = $Username
            action = $Action
            page = $Page
            details = $Details
            ipAddress = "localhost"
        }

        # Add to page views
        $log.pageViews += $entry

        # Update session tracking
        $today = (Get-Date).ToString("yyyy-MM-dd")
        $existingSession = $log.sessions | Where-Object { $_.username -eq $Username -and $_.date -eq $today }

        if ($existingSession) {
            $existingSession.pageCount++
            $existingSession.lastActivity = (Get-Date).ToString("o")
        } else {
            $log.sessions += @{
                username = $Username
                date = $today
                startTime = (Get-Date).ToString("o")
                lastActivity = (Get-Date).ToString("o")
                pageCount = 1
            }
            $log.summary.totalSessions++
        }

        # Update unique users
        if ($Username -notin $log.summary.uniqueUsers) {
            $log.summary.uniqueUsers += $Username
        }

        $log.summary.lastAccess = (Get-Date).ToString("o")

        # Keep only last 1000 page views to prevent file bloat
        if ($log.pageViews.Count -gt 1000) {
            $log.pageViews = $log.pageViews | Select-Object -Last 1000
        }

        # Keep only last 90 days of sessions
        $cutoffDate = (Get-Date).AddDays(-90).ToString("yyyy-MM-dd")
        $log.sessions = $log.sessions | Where-Object { $_.date -ge $cutoffDate }

        $log | ConvertTo-Json -Depth 10 | Set-Content -Path $LogPath -Encoding UTF8
    }
    catch {
        Write-Warning "Failed to write usage log: $($_.Exception.Message)"
    }
}

function Get-UsageStats {
    try {
        $log = Get-Content -Path $LogPath -Raw | ConvertFrom-Json

        $today = (Get-Date).ToString("yyyy-MM-dd")
        $thisWeek = (Get-Date).AddDays(-7).ToString("yyyy-MM-dd")
        $thisMonth = (Get-Date).AddDays(-30).ToString("yyyy-MM-dd")

        $todaySessions = ($log.sessions | Where-Object { $_.date -eq $today }).Count
        $weekSessions = ($log.sessions | Where-Object { $_.date -ge $thisWeek }).Count
        $monthSessions = ($log.sessions | Where-Object { $_.date -ge $thisMonth }).Count

        $recentUsers = $log.sessions |
            Where-Object { $_.date -ge $thisWeek } |
            Group-Object -Property username |
            Sort-Object -Property Count -Descending |
            Select-Object -First 10 |
            ForEach-Object {
                @{
                    username = $_.Name
                    sessionCount = $_.Count
                    totalPageViews = ($_.Group | Measure-Object -Property pageCount -Sum).Sum
                }
            }

        $popularPages = $log.pageViews |
            Where-Object { $_.timestamp -ge (Get-Date).AddDays(-7).ToString("o") } |
            Group-Object -Property page |
            Sort-Object -Property Count -Descending |
            Select-Object -First 10 |
            ForEach-Object {
                @{
                    page = $_.Name
                    views = $_.Count
                }
            }

        return @{
            summary = @{
                totalSessions = $log.summary.totalSessions
                uniqueUsers = $log.summary.uniqueUsers.Count
                lastAccess = $log.summary.lastAccess
            }
            activity = @{
                today = $todaySessions
                thisWeek = $weekSessions
                thisMonth = $monthSessions
            }
            topUsers = $recentUsers
            popularPages = $popularPages
        }
    }
    catch {
        return @{ error = $_.Exception.Message }
    }
}

# ============================================================================
# HTTP SERVER
# ============================================================================

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
}
catch {
    Write-Host "Failed to start on port $Port. Trying localhost only..." -ForegroundColor Yellow
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TenantScope Dashboard Server" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL:        http://localhost:$Port" -ForegroundColor Green
Write-Host "  Dashboard:  $dashboardPath" -ForegroundColor Gray
Write-Host "  Usage Log:  $LogPath" -ForegroundColor Gray
Write-Host "  Started by: $currentUser" -ForegroundColor Gray
Write-Host ""
Write-Host "  Settings:" -ForegroundColor White
Write-Host "    Usage Tracking: $(if ($serverConfig.usageTracking.enabled) { 'ON' } else { 'OFF' })" -ForegroundColor $(if ($serverConfig.usageTracking.enabled) { 'Green' } else { 'Yellow' })
Write-Host "    Stats Visible:  $(if ($serverConfig.usageTracking.showStatsToAllUsers) { 'Everyone' } else { 'Admins Only' })" -ForegroundColor Gray
if ($serverConfig.usageTracking.adminUsers.Count -gt 0) {
    Write-Host "    Admin Users:    $($serverConfig.usageTracking.adminUsers -join ', ')" -ForegroundColor Gray
}
Write-Host ""
Write-Host "  Endpoints:" -ForegroundColor White
Write-Host "    /              - Dashboard" -ForegroundColor Gray
Write-Host "    /api/usage     - Usage statistics (JSON)" -ForegroundColor Gray
Write-Host "    /api/whoami    - Current user info" -ForegroundColor Gray
Write-Host "    /api/config    - Server config (JSON)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Log server start (only if tracking enabled)
if ($serverConfig.usageTracking.enabled) {
    Write-UsageLog -Username $currentUser -Action "server_start" -Page "/" -Details "Server started on port $Port"
}

if ($OpenBrowser) {
    Start-Process "http://localhost:$Port"
}

# Handle requests
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $requestPath = $request.Url.LocalPath
        $username = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

        # Handle API endpoints

        # Config endpoint - tells dashboard what features are enabled
        if ($requestPath -eq "/api/config") {
            $isAdmin = $serverConfig.usageTracking.adminUsers.Count -eq 0 -or $username -in $serverConfig.usageTracking.adminUsers
            $clientConfig = @{
                usageTracking = @{
                    enabled = $serverConfig.usageTracking.enabled
                    canViewStats = $serverConfig.usageTracking.showStatsToAllUsers -or $isAdmin
                    isAdmin = $isAdmin
                }
                username = $username
                server = $env:COMPUTERNAME
            } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($clientConfig)
            $response.ContentType = "application/json"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
            continue
        }

        # Usage stats endpoint - check permissions
        if ($requestPath -eq "/api/usage") {
            $isAdmin = $serverConfig.usageTracking.adminUsers.Count -eq 0 -or $username -in $serverConfig.usageTracking.adminUsers
            $canView = $serverConfig.usageTracking.showStatsToAllUsers -or $isAdmin

            if (-not $canView) {
                $denied = @{ error = "Access denied"; message = "Usage stats are only visible to admins" } | ConvertTo-Json
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($denied)
                $response.StatusCode = 403
                $response.ContentType = "application/json"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.OutputStream.Close()
                continue
            }

            $stats = Get-UsageStats | ConvertTo-Json -Depth 10
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($stats)
            $response.ContentType = "application/json"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
            continue
        }

        if ($requestPath -eq "/api/whoami") {
            $isAdmin = $serverConfig.usageTracking.adminUsers.Count -eq 0 -or $username -in $serverConfig.usageTracking.adminUsers
            $userInfo = @{
                username = $username
                timestamp = (Get-Date).ToString("o")
                server = $env:COMPUTERNAME
                isAdmin = $isAdmin
                canViewStats = $serverConfig.usageTracking.showStatsToAllUsers -or $isAdmin
            } | ConvertTo-Json
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($userInfo)
            $response.ContentType = "application/json"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
            continue
        }

        if ($requestPath -eq "/api/log") {
            # Only log if tracking is enabled
            if (-not $serverConfig.usageTracking.enabled) {
                $response.StatusCode = 200
                $response.OutputStream.Close()
                continue
            }

            # Allow dashboard to log page views
            if ($request.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                Write-UsageLog -Username $username -Action "page_view" -Page $body.page -Details $body.details
                $response.StatusCode = 200
                $response.OutputStream.Close()
                continue
            }
        }

        # Serve static files
        if ($requestPath -eq "/" -or $requestPath -eq "") {
            $requestPath = "/index.html"
        }

        $filePath = Join-Path $dashboardPath $requestPath.TrimStart("/")

        if (Test-Path $filePath -PathType Leaf) {
            $extension = [System.IO.Path]::GetExtension($filePath)
            $contentType = $mimeTypes[$extension]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $fileBytes.Length
            $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)

            # Log page view for HTML pages
            if ($extension -eq ".html") {
                Write-UsageLog -Username $username -Action "page_view" -Page $requestPath -Details "HTTP request"
            }

            Write-Host "$(Get-Date -Format 'HH:mm:ss') [$username] GET $requestPath" -ForegroundColor Gray
        }
        else {
            $response.StatusCode = 404
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 - Not Found: $requestPath")
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
            Write-Host "$(Get-Date -Format 'HH:mm:ss') [$username] 404 $requestPath" -ForegroundColor Red
        }

        $response.OutputStream.Close()
    }
}
finally {
    $listener.Stop()
    Write-Host "`nServer stopped." -ForegroundColor Yellow
}
