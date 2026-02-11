# ============================================================================
# TenantScope - CollectorBase
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Shared utility functions for all TenantScope data collectors.

.DESCRIPTION
    This module contains common functions used across all collector scripts:
    - Graph API retry logic with exponential backoff
    - Date calculation utilities
    - Domain classification
    - Standardized error handling
    - Progress reporting

    Import this module at the start of each collector:
    . "$PSScriptRoot\..\lib\CollectorBase.ps1"

.NOTES
    Version: 1.0.0
    All collectors should use these shared functions to ensure
    consistent behavior and reduce code duplication.
#>

#Requires -Version 7.0

# ============================================================================
# GRAPH API UTILITIES
# ============================================================================

function Invoke-GraphWithRetry {
    <#
    .SYNOPSIS
        Executes a Graph API call with automatic retry on throttling and transient errors.

    .DESCRIPTION
        Wraps Graph API calls with exponential backoff retry logic.
        Automatically handles:
        - HTTP 429 (Too Many Requests) - throttling responses
        - HTTP 500 (Internal Server Error) - transient server errors
        - HTTP 502 (Bad Gateway) - transient proxy/gateway errors
        - HTTP 503 (Service Unavailable) - temporary service issues
        - HTTP 504 (Gateway Timeout) - transient timeout errors

        Per Microsoft Graph best practices, 5xx errors are often transient
        and should be retried with exponential backoff.

    .PARAMETER ScriptBlock
        The script block containing the Graph API call to execute.

    .PARAMETER MaxRetries
        Maximum number of retry attempts. Default is 5.

    .PARAMETER BaseBackoffSeconds
        Base wait time in seconds before first retry. Doubles each attempt.
        Default is 60 seconds.

    .PARAMETER OperationName
        Optional name of the operation for logging purposes.

    .OUTPUTS
        Returns the result of the Graph API call.

    .EXAMPLE
        $users = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgUser -All -Property "displayName,mail"
        }

    .EXAMPLE
        $devices = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgDeviceManagementManagedDevice -All
        } -MaxRetries 3 -OperationName "Device retrieval"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [ValidateRange(1, 10)]
        [int]$MaxRetries = 5,

        [Parameter()]
        [ValidateRange(10, 300)]
        [int]$BaseBackoffSeconds = 60,

        [Parameter()]
        [string]$OperationName = "Graph API call"
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            return & $ScriptBlock
        }
        catch {
            $errorMessage = $_.Exception.Message

            # Check if this is a throttling error (429)
            $isThrottling = $errorMessage -match "429|throttl|TooManyRequests|Too many retries|Rate limit"

            # Check if this is a transient server error (5xx) that should be retried
            # Microsoft Graph recommends retrying on 500, 502, 503, 504 errors with exponential backoff
            $isTransientServerError = $errorMessage -match "InternalServerError|500|502|503|504|BadGateway|ServiceUnavailable|GatewayTimeout"

            if ($isThrottling -or $isTransientServerError) {
                $attempt++
                if ($attempt -gt $MaxRetries) {
                    Write-Host "      Max retries ($MaxRetries) exceeded for: $OperationName" -ForegroundColor Red
                    throw
                }

                # Use shorter initial backoff for transient errors (they often recover quickly)
                $backoffBase = if ($isThrottling) { $BaseBackoffSeconds } else { [Math]::Max(10, $BaseBackoffSeconds / 6) }
                $waitSeconds = $backoffBase * [Math]::Pow(2, $attempt - 1)

                $errorType = if ($isThrottling) { "Throttled" } else { "Transient error" }
                Write-Host "      $errorType. Waiting ${waitSeconds}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $waitSeconds
            }
            else {
                # Not a retryable error, re-throw immediately
                throw
            }
        }
    }
}

# ============================================================================
# GRAPH HELPERS
# ============================================================================

function Get-GraphPropertyValue {
    <#
    .SYNOPSIS
        Safely retrieves a property value from Graph responses with mixed casing.

    .PARAMETER Object
        The Graph response object.

    .PARAMETER PropertyNames
        One or more property names to try (case-insensitive).

    .OUTPUTS
        The property value if found, otherwise $null.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Object,

        [Parameter(Mandatory)]
        [string[]]$PropertyNames
    )

    if ($null -eq $Object) { return $null }

    foreach ($name in $PropertyNames) {
        $prop = $Object.PSObject.Properties[$name]
        if ($prop) { return $prop.Value }
    }

    return $null
}

function Get-GraphAllPages {
    <#
    .SYNOPSIS
        Retrieves all pages for a Graph request that uses @odata.nextLink.

    .PARAMETER Uri
        The initial request URI.

    .PARAMETER OperationName
        Name used for logging/retry context.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [string]$OperationName
    )

    $results = @()
    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputType PSObject
    } -OperationName $OperationName

    if ($response.value) {
        $results += $response.value
    }

    while ($response.'@odata.nextLink') {
        $response = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET -Uri $response.'@odata.nextLink' -OutputType PSObject
        } -OperationName "$OperationName pagination"

        if ($response.value) {
            $results += $response.value
        }
    }

    return $results
}

function Invoke-AdvancedHuntingQuery {
    <#
    .SYNOPSIS
        Executes an Advanced Hunting query via Graph Security API.

    .DESCRIPTION
        Runs a KQL query using the Graph Security API endpoint:
        POST https://graph.microsoft.com/v1.0/security/runHuntingQuery

        This works with existing Graph authentication - no separate Defender API auth needed.
        Requires ThreatHunting.Read.All permission.

    .PARAMETER Query
        The KQL query to execute.

    .PARAMETER Timespan
        Optional ISO 8601 duration (e.g., "P30D" for 30 days). Default is 30 days.

    .OUTPUTS
        The query results object with Schema and Results arrays.

    .EXAMPLE
        $results = Invoke-AdvancedHuntingQuery -Query "DeviceEvents | take 10"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Query,

        [Parameter()]
        [string]$Timespan = "P30D"
    )

    $body = @{
        Query = $Query
        Timespan = $Timespan
    } | ConvertTo-Json -Depth 4

    $response = Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/security/runHuntingQuery" -Body $body -ContentType "application/json" -OutputType PSObject
    } -OperationName "Advanced Hunting query"

    return $response
}

function Get-GroupDisplayName {
    <#
    .SYNOPSIS
        Resolves group display name with optional caching.

    .PARAMETER GroupId
        Group object id.

    .PARAMETER Cache
        Hashtable cache for group id -> name.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$GroupId,

        [Parameter()]
        [hashtable]$Cache
    )

    if ($Cache -and $Cache.ContainsKey($GroupId)) {
        return $Cache[$GroupId]
    }

    $groupName = $GroupId
    try {
        $groupInfo = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/groups/$GroupId`?`$select=displayName" -OutputType PSObject
        if ($groupInfo.displayName) {
            $groupName = $groupInfo.displayName
        }
    }
    catch {
        # Keep fallback to GroupId
    }

    if ($Cache) {
        $Cache[$GroupId] = $groupName
    }

    return $groupName
}

function Resolve-AssignmentTarget {
    <#
    .SYNOPSIS
        Parses assignment target into a standard structure.

    .PARAMETER Assignment
        Assignment object from Graph API.

    .PARAMETER GroupNameCache
        Optional cache for group name lookup.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        $Assignment,

        [Parameter()]
        [hashtable]$GroupNameCache,

        [Parameter()]
        [string]$GroupPrefix = "",

        [Parameter()]
        [string]$ExcludePrefix = "",

        [Parameter()]
        [string]$ExcludeSuffix = ""
    )

    $targetType = $Assignment.target.'@odata.type'

    switch ($targetType) {
        "#microsoft.graph.allDevicesAssignmentTarget" {
            return @{ type = "AllDevices"; targetType = $targetType; name = "All Devices"; groupId = $null }
        }
        "#microsoft.graph.allLicensedUsersAssignmentTarget" {
            return @{ type = "AllUsers"; targetType = $targetType; name = "All Users"; groupId = $null }
        }
        "#microsoft.graph.groupAssignmentTarget" {
            $groupId = $Assignment.target.groupId
            $groupName = Get-GroupDisplayName -GroupId $groupId -Cache $GroupNameCache
            return @{ type = "Group"; targetType = $targetType; groupId = $groupId; name = "$GroupPrefix$groupName" }
        }
        "#microsoft.graph.exclusionGroupAssignmentTarget" {
            $groupId = $Assignment.target.groupId
            $groupName = Get-GroupDisplayName -GroupId $groupId -Cache $GroupNameCache
            return @{ type = "ExcludeGroup"; targetType = $targetType; groupId = $groupId; name = "$ExcludePrefix$groupName$ExcludeSuffix" }
        }
        default {
            return @{ type = "Unknown"; targetType = $targetType; name = "Unknown"; groupId = $null }
        }
    }
}

function Get-ReportCsvData {
    <#
    .SYNOPSIS
        Downloads a Graph report CSV to a temp file and returns parsed rows.

    .PARAMETER Uri
        Report endpoint URI.

    .PARAMETER OperationName
        Name used for logging.

    .PARAMETER TempPrefix
        Prefix for the temp CSV filename.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter()]
        [string]$OperationName = "Report download",

        [Parameter()]
        [string]$TempPrefix = "report"
    )

    $tempCsvPath = Join-Path ([System.IO.Path]::GetTempPath()) "$TempPrefix-$((Get-Date).ToString('yyyyMMddHHmmss')).csv"

    Invoke-GraphWithRetry -ScriptBlock {
        Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputFilePath $tempCsvPath
    } -OperationName $OperationName

    if (-not (Test-Path $tempCsvPath)) {
        throw "Report was not downloaded"
    }

    try {
        return Import-Csv -Path $tempCsvPath
    }
    finally {
        Remove-Item -Path $tempCsvPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-ReportPeriod {
    <#
    .SYNOPSIS
        Maps a day threshold to a supported report period (D7/D30/D90/D180).
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [int]$Days = 30
    )

    if ($Days -le 0) { $Days = 30 }

    if ($Days -le 7) { return "D7" }
    if ($Days -le 30) { return "D30" }
    if ($Days -le 90) { return "D90" }
    return "D180"
}

function Get-CredentialStatus {
    <#
    .SYNOPSIS
        Determines credential status based on expiry.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        $DaysUntilExpiry,

        [Parameter()]
        [string]$NullStatus = "no-credentials"
    )

    if ($null -eq $DaysUntilExpiry) { return $NullStatus }
    if ($DaysUntilExpiry -lt 0) { return "expired" }
    if ($DaysUntilExpiry -le 7) { return "critical" }
    if ($DaysUntilExpiry -le 30) { return "warning" }
    if ($DaysUntilExpiry -le 90) { return "attention" }
    return "healthy"
}

# ============================================================================
# DATE UTILITIES
# ============================================================================

function Get-DaysSinceDate {
    <#
    .SYNOPSIS
        Calculates the number of days between a given date and now.

    .DESCRIPTION
        Accepts various date formats including DateTime objects and
        ISO 8601 strings. Returns null for null/empty input.

    .PARAMETER DateValue
        The date to calculate days from. Can be DateTime or string.

    .OUTPUTS
        Integer number of days (minimum 0), or null if input is invalid.

    .EXAMPLE
        Get-DaysSinceDate -DateValue "2024-01-15T10:30:00Z"
        # Returns number of days since January 15, 2024

    .EXAMPLE
        Get-DaysSinceDate -DateValue $user.LastSignInDateTime
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        $DateValue
    )

    if ($null -eq $DateValue -or $DateValue -eq "") {
        return $null
    }

    try {
        $date = if ($DateValue -is [DateTime]) {
            $DateValue
        }
        else {
            [DateTime]::Parse($DateValue)
        }

        $days = ((Get-Date) - $date).Days
        return [Math]::Max(0, $days)
    }
    catch {
        return $null
    }
}

function Get-DaysUntilDate {
    <#
    .SYNOPSIS
        Calculates the number of days from now until a future date.

    .DESCRIPTION
        Returns positive values for future dates, negative for past dates.
        Useful for certificate expiry calculations.

    .PARAMETER DateValue
        The target date. Can be DateTime or string.

    .OUTPUTS
        Integer number of days (can be negative), or null if input is invalid.

    .EXAMPLE
        Get-DaysUntilDate -DateValue $cert.ExpirationDate
        # Returns days until certificate expires (negative if expired)
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        $DateValue
    )

    if ($null -eq $DateValue -or $DateValue -eq "") {
        return $null
    }

    try {
        $date = if ($DateValue -is [DateTime]) {
            $DateValue
        }
        else {
            [DateTime]::Parse($DateValue)
        }

        return ($date - (Get-Date)).Days
    }
    catch {
        return $null
    }
}

function Format-IsoDate {
    <#
    .SYNOPSIS
        Formats a DateTime value as ISO 8601 string.

    .PARAMETER DateValue
        The date to format.

    .OUTPUTS
        ISO 8601 formatted string, or null if input is null.

    .EXAMPLE
        Format-IsoDate -DateValue $user.CreatedDateTime
        # Returns "2024-01-15T10:30:00.0000000Z"
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        $DateValue
    )

    if ($null -eq $DateValue) {
        return $null
    }

    try {
        if ($DateValue -is [DateTime]) {
            return $DateValue.ToString("o")
        }
        else {
            return ([DateTime]::Parse($DateValue)).ToString("o")
        }
    }
    catch {
        return $null
    }
}

# ============================================================================
# DOMAIN UTILITIES
# ============================================================================

function Get-DomainClassification {
    <#
    .SYNOPSIS
        Classifies a user's domain based on their UPN suffix.

    .DESCRIPTION
        Compares the user's UPN against configured domain patterns
        to determine if they are an employee, student, or other.

    .PARAMETER UserPrincipalName
        The user's UPN to classify.

    .PARAMETER Config
        Configuration hashtable containing domain mappings.

    .OUTPUTS
        String: "employee", "student", or "other"

    .EXAMPLE
        $domain = Get-DomainClassification -UserPrincipalName "john@contoso.com" -Config $config
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$UserPrincipalName,

        [Parameter(Mandatory)]
        [hashtable]$Config
    )

    # Extract domain from UPN (everything after @)
    $upnDomain = "@" + ($UserPrincipalName -split "@")[-1]

    # Check against configured domains
    if ($Config.domains -and $upnDomain -eq $Config.domains.employees) {
        return "employee"
    }
    elseif ($Config.domains -and $upnDomain -eq $Config.domains.students) {
        return "student"
    }
    else {
        return "other"
    }
}

function Get-SourceDomain {
    <#
    .SYNOPSIS
        Extracts the domain portion from an email address.

    .PARAMETER Email
        The email address to parse.

    .OUTPUTS
        Domain string (lowercase), or "unknown" if parsing fails.

    .EXAMPLE
        Get-SourceDomain -Email "guest@external.com"
        # Returns "external.com"
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Email
    )

    if ([string]::IsNullOrWhiteSpace($Email)) {
        return "unknown"
    }

    try {
        $parts = $Email -split "@"
        if ($parts.Count -ge 2) {
            return $parts[-1].ToLower()
        }
        return "unknown"
    }
    catch {
        return "unknown"
    }
}

# ============================================================================
# STATUS UTILITIES
# ============================================================================

function Get-SeverityName {
    <#
    .SYNOPSIS
        Normalizes severity value to our schema.

    .PARAMETER Severity
        The severity value from Graph API.

    .OUTPUTS
        Normalized severity: high, medium, low, or informational.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        $Severity
    )

    if ($null -eq $Severity) {
        return "informational"
    }

    $sev = $Severity.ToString().ToLower()

    switch -Wildcard ($sev) {
        "*high*"          { return "high" }
        "*medium*"        { return "medium" }
        "*low*"           { return "low" }
        "*informational*" { return "informational" }
        "*unknown*"       { return "informational" }
        default           { return "informational" }
    }
}

function Get-StatusName {
    <#
    .SYNOPSIS
        Normalizes status value to our schema.

    .PARAMETER Status
        The status value from Graph API.

    .OUTPUTS
        Normalized status: new, inProgress, or resolved.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        $Status
    )

    if ($null -eq $Status) {
        return "new"
    }

    $stat = $Status.ToString().ToLower()

    switch -Wildcard ($stat) {
        "*new*"        { return "new" }
        "*inprogress*" { return "inProgress" }
        "*progress*"   { return "inProgress" }
        "*resolved*"   { return "resolved" }
        "*dismissed*"  { return "resolved" }
        "*closed*"     { return "resolved" }
        default        { return "new" }
    }
}

function Get-HealthStatus {
    <#
    .SYNOPSIS
        Determines health status from score.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [int]$Score
    )

    if ($Score -ge 80) { return "Excellent" }
    if ($Score -ge 60) { return "Good" }
    if ($Score -ge 40) { return "Fair" }
    if ($Score -ge 20) { return "Poor" }
    return "Critical"
}

function Get-SignInStatus {
    <#
    .SYNOPSIS
        Determines sign-in status from error code.
        Returns: Success, Failed, or Interrupted.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [int]$ErrorCode,

        [Parameter()]
        [string]$FailureReason
    )

    if ($ErrorCode -eq 0) { return "Success" }
    if ($ErrorCode -in @(50140, 50074, 50076)) { return "Interrupted" }
    return "Failed"
}

function Get-RiskLevel {
    <#
    .SYNOPSIS
        Maps risk level to a normalized label.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$Risk
    )

    switch ($Risk) {
        "high"   { return "High" }
        "medium" { return "Medium" }
        "low"    { return "Low" }
        "none"   { return "None" }
        default  { return "Unknown" }
    }
}

function Get-ActivityStatus {
    <#
    .SYNOPSIS
        Determines activity status based on days since last activity.

    .PARAMETER DaysSinceActivity
        Number of days since last activity.

    .PARAMETER InactiveThreshold
        Number of days after which to consider inactive.

    .OUTPUTS
        Hashtable with isInactive (bool) and status (string).

    .EXAMPLE
        $status = Get-ActivityStatus -DaysSinceActivity 95 -InactiveThreshold 90
        # Returns @{ isInactive = $true; status = "inactive" }
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        $DaysSinceActivity,

        [Parameter()]
        [int]$InactiveThreshold = 90
    )

    if ($null -eq $DaysSinceActivity) {
        return @{
            isInactive = $false
            status     = "unknown"
        }
    }

    $isInactive = $DaysSinceActivity -ge $InactiveThreshold

    return @{
        isInactive = $isInactive
        status     = if ($isInactive) { "inactive" } else { "active" }
    }
}

function Get-CertificateStatus {
    <#
    .SYNOPSIS
        Returns a status string based on certificate expiry days.

    .PARAMETER DaysUntilExpiry
        Days until certificate expires (negative if expired).

    .OUTPUTS
        String: "expired", "critical", "warning", "healthy", or "unknown"

    .EXAMPLE
        Get-CertificateStatus -DaysUntilExpiry 15
        # Returns "critical"
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        $DaysUntilExpiry
    )

    if ($null -eq $DaysUntilExpiry) {
        return "unknown"
    }

    if ($DaysUntilExpiry -lt 0) { return "expired" }
    if ($DaysUntilExpiry -le 30) { return "critical" }
    if ($DaysUntilExpiry -le 60) { return "warning" }
    return "healthy"
}

# ============================================================================
# COLLECTOR RESULT HELPERS
# ============================================================================

function New-CollectorResult {
    <#
    .SYNOPSIS
        Creates a standardized collector result object.

    .DESCRIPTION
        All collectors should return results in this format for
        consistent handling by the orchestrator.

    .PARAMETER Success
        Whether the collection completed successfully.

    .PARAMETER Count
        Number of items collected.

    .PARAMETER Errors
        Array of error messages encountered.

    .PARAMETER Data
        Optional: The collected data (if not written to file).

    .OUTPUTS
        Hashtable with Success, Count, Errors, and optionally Data.

    .EXAMPLE
        return New-CollectorResult -Success $true -Count $users.Count -Errors @()
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [bool]$Success,

        [Parameter()]
        [int]$Count = 0,

        [Parameter()]
        [array]$Errors = @(),

        [Parameter()]
        $Data = $null
    )

    $result = @{
        Success = $Success
        Count   = $Count
        Errors  = $Errors
    }

    if ($null -ne $Data) {
        $result.Data = $Data
    }

    return $result
}

function Write-CollectorProgress {
    <#
    .SYNOPSIS
        Writes a progress message for collector operations.

    .PARAMETER Message
        The message to display.

    .PARAMETER Count
        Current item count (optional).

    .PARAMETER Type
        Message type: "info", "success", "warning", "error"

    .EXAMPLE
        Write-CollectorProgress -Message "Collecting users" -Type "info"
        Write-CollectorProgress -Message "Processed 100 users" -Count 100 -Type "info"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Message,

        [Parameter()]
        [int]$Count = -1,

        [Parameter()]
        [ValidateSet("info", "success", "warning", "error")]
        [string]$Type = "info"
    )

    $prefix = "    "
    $color = switch ($Type) {
        "info"    { "Gray" }
        "success" { "Green" }
        "warning" { "Yellow" }
        "error"   { "Red" }
    }

    $symbol = switch ($Type) {
        "success" { "[OK]" }
        "warning" { "[!]" }
        "error"   { "[X]" }
        default   { "   " }
    }

    if ($Count -ge 0) {
        Write-Host "$prefix$symbol $Message ($Count items)" -ForegroundColor $color
    }
    else {
        Write-Host "$prefix$symbol $Message" -ForegroundColor $color
    }
}

function Save-CollectorData {
    <#
    .SYNOPSIS
        Saves collector data to a JSON file with error handling.

    .PARAMETER Data
        The data to save (array or object).

    .PARAMETER OutputPath
        Full path to the output JSON file.

    .PARAMETER EmptyOnError
        If true, writes empty array on error. Default is true.

    .OUTPUTS
        Boolean indicating success.

    .EXAMPLE
        $saved = Save-CollectorData -Data $users -OutputPath ".\data\users.json"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        $Data,

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter()]
        [bool]$EmptyOnError = $true
    )

    try {
        $Data | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8
        return $true
    }
    catch {
        Write-Host "    [X] Failed to save data: $($_.Exception.Message)" -ForegroundColor Red

        if ($EmptyOnError) {
            try {
                "[]" | Set-Content -Path $OutputPath -Encoding UTF8
            }
            catch {
                # Ignore secondary error
            }
        }

        return $false
    }
}

# ============================================================================
# OS UTILITIES
# ============================================================================

function Get-SimplifiedOS {
    <#
    .SYNOPSIS
        Returns a simplified OS name from the full operating system string.

    .PARAMETER OperatingSystem
        The full operating system name.

    .OUTPUTS
        Simplified OS name: Windows, macOS, iOS, Android, Linux, ChromeOS, or the original value.

    .EXAMPLE
        Get-SimplifiedOS -OperatingSystem "Windows 10 Enterprise"
        # Returns "Windows"
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$OperatingSystem
    )

    if ([string]::IsNullOrWhiteSpace($OperatingSystem)) {
        return "Unknown"
    }

    $os = $OperatingSystem.ToLower()

    if ($os -match "windows") { return "Windows" }
    if ($os -match "macos|mac os") { return "macOS" }
    if ($os -match "ios|iphone|ipad") { return "iOS" }
    if ($os -match "android") { return "Android" }
    if ($os -match "linux") { return "Linux" }
    if ($os -match "chrome") { return "ChromeOS" }

    return $OperatingSystem
}

function Get-WindowsLifecycleInfo {
    <#
    .SYNOPSIS
        Returns Windows version lifecycle information from OS version string.

    .DESCRIPTION
        Parses Windows build number and returns release name, type (10/11),
        end-of-support date, and supported status based on Microsoft lifecycle data.

    .PARAMETER OsVersion
        The OS version string (e.g., "10.0.22631.4890").

    .OUTPUTS
        Hashtable with: windowsRelease, windowsBuild, windowsType, windowsEOL, windowsSupported

    .EXAMPLE
        $lifecycle = Get-WindowsLifecycleInfo -OsVersion "10.0.22631.4890"
        # Returns info for Windows 11 23H2
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$OsVersion
    )

    $result = @{
        windowsRelease   = $null
        windowsBuild     = $null
        windowsType      = $null
        windowsEOL       = $null
        windowsSupported = $null
    }

    if ([string]::IsNullOrWhiteSpace($OsVersion)) {
        return $result
    }

    # Extract build number from version string (e.g., "10.0.22631.4890" -> 22631)
    $match = [regex]::Match($OsVersion, "10\.0\.(\d{5})")
    if (-not $match.Success) {
        return $result
    }

    $buildNumber = [int]$match.Groups[1].Value
    $result.windowsBuild = $buildNumber

    # Lifecycle data based on Microsoft support policy
    $lifecycleData = @{
        # Windows 11
        22631 = @{ Release = "23H2"; Type = "Windows 11"; EOL = "2026-11-10"; Supported = $true }
        22621 = @{ Release = "22H2"; Type = "Windows 11"; EOL = "2025-10-14"; Supported = $true }
        22000 = @{ Release = "21H2"; Type = "Windows 11"; EOL = "2024-10-08"; Supported = $false }
        # Windows 10
        19045 = @{ Release = "22H2"; Type = "Windows 10"; EOL = "2025-10-14"; Supported = $true }
        19044 = @{ Release = "21H2"; Type = "Windows 10"; EOL = "2024-06-11"; Supported = $false }
        19043 = @{ Release = "21H1"; Type = "Windows 10"; EOL = "2022-12-13"; Supported = $false }
        19042 = @{ Release = "20H2"; Type = "Windows 10"; EOL = "2023-05-09"; Supported = $false }
        19041 = @{ Release = "2004"; Type = "Windows 10"; EOL = "2021-12-14"; Supported = $false }
    }

    if ($lifecycleData.ContainsKey($buildNumber)) {
        $info = $lifecycleData[$buildNumber]
        $result.windowsRelease = $info.Release
        $result.windowsType = $info.Type
        $result.windowsEOL = $info.EOL
        $result.windowsSupported = $info.Supported
    }
    else {
        # Unknown build - determine type by build range
        if ($buildNumber -ge 22000) {
            $result.windowsType = "Windows 11"
        }
        elseif ($buildNumber -ge 19041) {
            $result.windowsType = "Windows 10"
        }
        else {
            $result.windowsType = "Windows"
        }
        $result.windowsRelease = "Unknown"
        $result.windowsSupported = $null
    }

    return $result
}

# ============================================================================
# NOTE: This file is designed to be dot-sourced, not imported as a module.
# All functions are automatically available when dot-sourced:
#   . "$PSScriptRoot\..\lib\CollectorBase.ps1"
# ============================================================================
