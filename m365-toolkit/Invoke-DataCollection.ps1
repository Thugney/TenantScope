# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Main orchestrator script for TenantScope data collection.

.DESCRIPTION
    This script serves as the primary entry point for collecting Microsoft 365
    tenant data via Microsoft Graph API. It orchestrates all individual
    collectors, manages authentication, handles errors, and generates
    collection metadata.

    The script performs the following operations:
    1. Loads and validates configuration from config.json
    2. Connects to Microsoft Graph with required permissions
    3. Runs all data collectors in sequence
    4. Cross-references data (MFA and admin flags into users)
    5. Generates collection metadata
    6. Optionally opens the dashboard

    Authentication modes:
    - Interactive (default): Prompts for user sign-in via browser
    - Certificate: Uses app registration with certificate (for scheduled tasks)
    - Client Secret: Uses app registration with secret (less secure)

.PARAMETER ConfigPath
    Path to the configuration JSON file. Defaults to ./config.json.

.PARAMETER SkipDashboard
    If specified, skips the prompt to open the dashboard after collection.

.PARAMETER CollectorsToRun
    Optional array of specific collector names to run. If not specified,
    runs all collectors. Valid values include all items in the ValidateSet
    defined for this parameter.

.PARAMETER ClientId
    Application (client) ID for app-only authentication.
    Required for unattended/scheduled execution.

.PARAMETER CertificateThumbprint
    Certificate thumbprint for app-only authentication.
    The certificate must be installed in CurrentUser\My certificate store.
    Use with -ClientId for scheduled tasks.

.PARAMETER ClientSecret
    Client secret for app-only authentication.
    Less secure than certificate - use only if certificates are not possible.
    Use with -ClientId for scheduled tasks.

.OUTPUTS
    JSON files in the data/ directory containing collected tenant data.
    Returns a summary object with collection results.

.EXAMPLE
    .\Invoke-DataCollection.ps1
    Runs all collectors with interactive authentication.

.EXAMPLE
    .\Invoke-DataCollection.ps1 -SkipDashboard
    Runs all collectors and skips the dashboard prompt.

.EXAMPLE
    .\Invoke-DataCollection.ps1 -CollectorsToRun @("UserData", "LicenseData")
    Runs only the specified collectors.

.EXAMPLE
    .\Invoke-DataCollection.ps1 -ClientId "00000000-0000-0000-0000-000000000000" -CertificateThumbprint "ABC123..."
    Runs with certificate-based app-only authentication (for scheduled tasks).

.EXAMPLE
    .\Invoke-DataCollection.ps1 -ClientId "00000000-0000-0000-0000-000000000000" -ClientSecret "secret"
    Runs with client secret authentication (less secure).

.EXAMPLE
    .\Invoke-DataCollection.ps1 -UseDeviceCode
    Runs with device code authentication (more stable for long-running scripts).
    You'll enter a code at https://microsoft.com/devicelogin once, and the token
    will persist throughout the collection without re-prompting.

.NOTES
    If you experience repeated authentication prompts during collection, use:
    - -UseDeviceCode for interactive use (most stable)
    - Certificate authentication for scheduled/automated runs
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),

    [Parameter()]
    [switch]$SkipDashboard,

    [Parameter()]
    [ValidateSet("UserData", "LicenseData", "GuestData", "MFAData", "AdminRoleData",
                 "DeletedUsers", "GroupData", "SignInData", "DeviceData", "AutopilotData", "DefenderData", "EnterpriseAppData",
                 "AuditLogData", "PIMData", "TeamsData", "SharePointData", "SecureScoreData",
                 "AppSignInData", "ConditionalAccessData", "CompliancePolicies", "ConfigurationProfiles",
                 "WindowsUpdateStatus", "BitLockerStatus", "AppDeployments", "EndpointAnalytics",
                 "ServicePrincipalSecrets", "ASRRules", "SignInLogs", "ServiceAnnouncementData",
                 "OAuthConsentGrants", "NamedLocations", "IdentityRiskData", "VulnerabilityData",
                 "AccessReviewData", "RetentionData", "eDiscoveryData", "SensitivityLabelsData",
                 "DefenderDeviceHealth", "ASRAuditEvents", "EndpointSecurityStates", "LapsCoverage",
                 "DeviceHardening")]
    [string[]]$CollectorsToRun,

    # App-only authentication parameters (for scheduled/unattended execution)
    [Parameter()]
    [string]$ClientId,

    [Parameter()]
    [string]$CertificateThumbprint,

    [Parameter()]
    [string]$ClientSecret,

    # Use device code authentication (more stable for long-running scripts)
    [Parameter()]
    [switch]$UseDeviceCode
)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

. "$PSScriptRoot\lib\CollectorBase.ps1"

function Write-CollectionHeader {
    <#
    .SYNOPSIS
        Displays the collection header with toolkit branding.
    #>
    $header = @"

╔══════════════════════════════════════════════════════════════════════════════╗
║                         TENANTSCOPE                                  ║
║                         Data Collection Engine                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

"@
    Write-Host $header -ForegroundColor Cyan
}

function Write-CollectionSummary {
    <#
    .SYNOPSIS
        Displays a formatted summary table of collection results.

    .PARAMETER Results
        Hashtable containing collector results with Success, Count, and Duration.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Results,

        [Parameter(Mandatory)]
        [datetime]$StartTime,

        [Parameter(Mandatory)]
        [datetime]$EndTime
    )

    $totalDuration = ($EndTime - $StartTime).TotalSeconds

    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "                    COLLECTION SUMMARY                          " -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Collector                  Status      Count    Duration" -ForegroundColor White
    Write-Host "  ─────────────────────────────────────────────────────────" -ForegroundColor Gray

    foreach ($collector in $Results.GetEnumerator() | Sort-Object Name) {
        $status = if ($collector.Value.Success) { "[OK] Success" } else { "[X] Failed" }
        $statusColor = if ($collector.Value.Success) { "Green" } else { "Red" }
        $count = $collector.Value.Count.ToString().PadLeft(6)
        $duration = "{0:N1}s" -f $collector.Value.Duration

        Write-Host "  $($collector.Name.PadRight(25))" -NoNewline
        Write-Host $status -ForegroundColor $statusColor -NoNewline
        Write-Host "   $count    $duration"
    }

    Write-Host "  ─────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  Total Duration: $("{0:N1}" -f $totalDuration) seconds" -ForegroundColor White
    Write-Host ""
}

function Get-ConfigValidation {
    <#
    .SYNOPSIS
        Validates the configuration object has all required fields.

    .PARAMETER Config
        The configuration hashtable to validate.

    .OUTPUTS
        Returns $true if valid, throws an error if invalid.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Config
    )

    $requiredFields = @(
        "tenantId",
        "domains",
        "thresholds",
        "collection"
    )

    foreach ($field in $requiredFields) {
        if (-not $Config.ContainsKey($field)) {
            throw "Configuration missing required field: $field"
        }
    }

    # Validate nested required fields
    if (-not $Config.domains.employees -or -not $Config.domains.students) {
        throw "Configuration missing required domain mappings (employees/students)"
    }

    if (-not $Config.thresholds.inactiveDays) {
        throw "Configuration missing required threshold: inactiveDays"
    }

    return $true
}

function Test-TenantIdFormat {
    <#
    .SYNOPSIS
        Validates that the tenant ID is a valid GUID and not a placeholder.

    .DESCRIPTION
        Checks that the provided tenant ID:
        1. Is a valid GUID format
        2. Is not the placeholder value (all zeros)
        Provides clear error messages with instructions for finding the tenant ID.

    .PARAMETER TenantId
        The tenant ID string to validate.

    .OUTPUTS
        Returns $true if valid, throws an error if invalid.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$TenantId
    )

    # Check if it's a valid GUID format
    try {
        [guid]::Parse($TenantId) | Out-Null
    }
    catch {
        throw "Invalid tenantId format: '$TenantId' is not a valid GUID. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }

    # Check if it's the placeholder value
    if ($TenantId -eq "00000000-0000-0000-0000-000000000000") {
        throw @"
Tenant ID not configured. Please update config.json with your actual tenant ID.

To find your tenant ID:
  1. Go to Azure Portal (https://portal.azure.com)
  2. Navigate to Azure Active Directory > Overview
  3. Copy the 'Tenant ID' value

Or use PowerShell:
  Connect-MgGraph
  (Get-MgContext).TenantId
"@
    }

    return $true
}

function Merge-MfaDataIntoUsers {
    <#
    .SYNOPSIS
        Merges MFA registration status into user data.

    .DESCRIPTION
        Cross-references MFA data with user data to add mfaRegistered flag
        and update user flags array.

    .PARAMETER UsersPath
        Path to the users.json file.

    .PARAMETER MfaPath
        Path to the mfa-status.json file.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UsersPath,

        [Parameter(Mandatory)]
        [string]$MfaPath
    )

    if (-not (Test-Path $UsersPath) -or -not (Test-Path $MfaPath)) {
        Write-Host "    [!] Cannot merge MFA data - files not found" -ForegroundColor Yellow
        return
    }

    try {
        $users = Get-Content $UsersPath -Raw | ConvertFrom-Json
        $mfaData = Get-Content $MfaPath -Raw | ConvertFrom-Json

        # Create lookup hashtable for MFA status by userId
        $mfaLookup = @{}
        foreach ($mfa in $mfaData) {
            $mfaLookup[$mfa.userId] = $mfa
        }

        # Update each user with MFA status
        foreach ($user in $users) {
            if ($mfaLookup.ContainsKey($user.id)) {
                $user.mfaRegistered = $mfaLookup[$user.id].isMfaRegistered

                # Update flags if MFA not registered
                if (-not $mfaLookup[$user.id].isMfaRegistered) {
                    if ($user.flags -notcontains "no-mfa") {
                        $user.flags += "no-mfa"
                    }
                }
            }
        }

        # Write updated users back to file
        $users | ConvertTo-Json -Depth 10 | Set-Content -Path $UsersPath -Encoding UTF8
        Write-Host "    [OK] Merged MFA data into users" -ForegroundColor Green
    }
    catch {
        Write-Host "    [!] Error merging MFA data: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Merge-AdminRolesIntoUsers {
    <#
    .SYNOPSIS
        Merges admin role membership into user data.

    .DESCRIPTION
        Cross-references admin role data with user data to add admin flag
        to users who are members of directory roles.

    .PARAMETER UsersPath
        Path to the users.json file.

    .PARAMETER AdminRolesPath
        Path to the admin-roles.json file.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$UsersPath,

        [Parameter(Mandatory)]
        [string]$AdminRolesPath
    )

    if (-not (Test-Path $UsersPath) -or -not (Test-Path $AdminRolesPath)) {
        Write-Host "    [!] Cannot merge admin role data - files not found" -ForegroundColor Yellow
        return
    }

    try {
        $users = Get-Content $UsersPath -Raw | ConvertFrom-Json
        $adminRoles = Get-Content $AdminRolesPath -Raw | ConvertFrom-Json

        # Build set of admin user IDs
        $adminUserIds = @{}
        foreach ($role in $adminRoles) {
            foreach ($member in $role.members) {
                # Use $member.id - the correct property name from admin-roles.json
                if ($member.id) {
                    $adminUserIds[$member.id] = $true
                }
            }
        }

        # Update each user with admin flag
        foreach ($user in $users) {
            if ($adminUserIds.ContainsKey($user.id)) {
                if ($user.flags -notcontains "admin") {
                    $user.flags += "admin"
                }
            }
        }

        # Write updated users back to file
        $users | ConvertTo-Json -Depth 10 | Set-Content -Path $UsersPath -Encoding UTF8
        Write-Host "    [OK] Merged admin role data into users" -ForegroundColor Green
    }
    catch {
        Write-Host "    [!] Error merging admin role data: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ============================================================================
# MAIN SCRIPT EXECUTION
# ============================================================================

# Display header
Write-CollectionHeader

# Initialize timing
$collectionStartTime = Get-Date
$collectionId = "col-{0:yyyy-MM-dd-HHmmss}" -f $collectionStartTime

Write-Host "  Collection ID: $collectionId" -ForegroundColor Gray
Write-Host "  Started: $($collectionStartTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

# ============================================================================
# STEP 1: Load and validate configuration
# ============================================================================

Write-Host "[1/6] Loading configuration..." -ForegroundColor Cyan

if (-not (Test-Path $ConfigPath)) {
    Write-Host "  [X] Configuration file not found: $ConfigPath" -ForegroundColor Red
    Write-Host "  Please create config.json with your tenant settings." -ForegroundColor Yellow
    exit 1
}

try {
    $configContent = Get-Content $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
    Get-ConfigValidation -Config $configContent | Out-Null
    Test-TenantIdFormat -TenantId $configContent.tenantId | Out-Null
    Write-Host "  [OK] Configuration loaded and validated" -ForegroundColor Green
}
catch {
    Write-Host "  [X] Configuration error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Store configuration in a script-wide variable for collectors
$script:Config = $configContent

# ============================================================================
# STEP 2: Define required Graph scopes and connect
# ============================================================================

Write-Host ""
Write-Host "[2/6] Connecting to Microsoft Graph..." -ForegroundColor Cyan

# Define all required scopes for the collectors
    $requiredScopes = @(
        "User.Read.All",
        "Directory.Read.All",
        "AuditLog.Read.All",
        "Reports.Read.All",
        "ServiceMessage.Read.All",
        "ServiceHealth.Read.All",
        "DeviceManagementManagedDevices.Read.All",
        "DeviceManagementConfiguration.Read.All",
        "DeviceManagementApps.Read.All",
        "SecurityEvents.Read.All",
        "IdentityRiskyUser.Read.All",
        "IdentityRiskEvent.Read.All",
        "RoleManagement.Read.Directory",
        "RoleAssignmentSchedule.Read.Directory",
        "RoleEligibilitySchedule.Read.Directory",
        "Application.Read.All",
        "Policy.Read.All",
        "Team.ReadBasic.All",
        "Channel.ReadBasic.All",
        "TeamMember.Read.All",
        "Sites.Read.All",
        "BitLockerKey.Read.All",
        # New scopes for enhanced collectors
        "DelegatedPermissionGrant.ReadWrite.All",
        "RecordsManagement.Read.All",
        "eDiscovery.Read.All",
        "InformationProtectionPolicy.Read",
        "AccessReview.Read.All",
        # Note: Defender Advanced Hunting (AdvancedHunting.Read.All, Machine.Read.All) requires
        # separate auth to api.securitycenter.microsoft.com - not available via Graph SDK.
        # Collectors using Defender API will use sample data when live data is unavailable.
        "Group.Read.All"
)

# Determine authentication mode
$authMode = "Interactive"
if ($ClientId -and $CertificateThumbprint) {
    $authMode = "Certificate"
}
elseif ($ClientId -and $ClientSecret) {
    $authMode = "ClientSecret"
}
elseif ($ClientId) {
    Write-Host "  [X] ClientId provided but missing CertificateThumbprint or ClientSecret" -ForegroundColor Red
    exit 1
}

Write-Host "  Authentication mode: $authMode" -ForegroundColor Gray

if ($authMode -eq "Interactive") {
    Write-Host "  Required scopes:" -ForegroundColor Gray
    foreach ($scope in $requiredScopes) {
        Write-Host "    - $scope" -ForegroundColor Gray
    }
}

try {
    # Disconnect any existing session to ensure clean state
    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

    switch ($authMode) {
        "Certificate" {
            # App-only authentication with certificate (recommended for scheduled tasks)
            Write-Host "  Connecting with certificate authentication..." -ForegroundColor Gray
            Connect-MgGraph -ClientId $ClientId -TenantId $configContent.tenantId -CertificateThumbprint $CertificateThumbprint -NoWelcome
        }
        "ClientSecret" {
            # App-only authentication with client secret (less secure)
            Write-Host "  Connecting with client secret authentication..." -ForegroundColor Gray
            $secureSecret = ConvertTo-SecureString -String $ClientSecret -AsPlainText -Force
            $credential = New-Object System.Management.Automation.PSCredential($ClientId, $secureSecret)
            Connect-MgGraph -TenantId $configContent.tenantId -ClientSecretCredential $credential -NoWelcome
        }
        default {
            # Interactive authentication (default)
            if ($UseDeviceCode) {
                Write-Host "  Using device code authentication (more stable for long scripts)..." -ForegroundColor Gray
                Write-Host "  You will see a code to enter at https://microsoft.com/devicelogin" -ForegroundColor Yellow
                try {
                    Connect-MgGraph -Scopes $requiredScopes -TenantId $configContent.tenantId -UseDeviceCode -NoWelcome
                }
                catch {
                    Write-Host "  Device code auth failed, falling back to browser auth..." -ForegroundColor Yellow
                    Connect-MgGraph -Scopes $requiredScopes -TenantId $configContent.tenantId -NoWelcome
                }
            }
            else {
                Connect-MgGraph -Scopes $requiredScopes -TenantId $configContent.tenantId -NoWelcome
            }
        }
    }

    # Verify connection
    $context = Get-MgContext
    if ($null -eq $context) {
        throw "Failed to establish Graph connection"
    }

    if ($authMode -eq "Interactive") {
        Write-Host "  [OK] Connected as: $($context.Account)" -ForegroundColor Green
        if (-not $UseDeviceCode) {
            Write-Host "  TIP: If you get re-authentication prompts, re-run with -UseDeviceCode" -ForegroundColor Gray
        }
    }
    else {
        Write-Host "  [OK] Connected as app: $($context.ClientId)" -ForegroundColor Green
    }
}
catch {
    Write-Host "  [X] Connection failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($authMode -eq "Interactive") {
        Write-Host "  Ensure you have the required permissions and try again." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Verify app registration has required API permissions (Application type)." -ForegroundColor Yellow
        Write-Host "  Required permissions: User.Read.All, Device.Read.All, etc. (as Application, not Delegated)" -ForegroundColor Yellow
    }
    exit 1
}

# ============================================================================
# STEP 3: Create data directory if needed
# ============================================================================

Write-Host ""
Write-Host "[3/6] Preparing data directory..." -ForegroundColor Cyan

$dataPath = Join-Path $PSScriptRoot "data"
if (-not (Test-Path $dataPath)) {
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
    Write-Host "  [OK] Created data directory: $dataPath" -ForegroundColor Green
}
else {
    Write-Host "  [OK] Data directory exists: $dataPath" -ForegroundColor Green
}

# ============================================================================
# STEP 4: Run collectors
# ============================================================================

Write-Host ""
Write-Host "[4/6] Running data collectors..." -ForegroundColor Cyan
Write-Host ""

# Define all collectors with their output files
# IMPORTANT: Order matters! Primary collectors that populate SharedData must run
# before downstream collectors that reuse that data. The dependency order is:
#   - DeviceData populates SharedData.ManagedDevices → BitLockerStatus, WindowsUpdateStatus, UserData reuse
#   - IdentityRiskData populates SharedData.RiskyUsers/RiskDetections → SignInData reuses
#   - ConditionalAccessData populates SharedData.CAPolicies → NamedLocations reuses
#   - EnterpriseAppData populates SharedData.AppRegistrations/ServicePrincipals → ServicePrincipalSecrets, OAuthConsentGrants reuse
#   - SignInLogs populates SharedData.SignInLogs → AppSignInData reuses
#   - GroupData populates SharedData.Groups → TeamsData reuses
$collectors = @(
    # ---- PRIMARY COLLECTORS (populate shared data) ----
    # Core identity & licensing
    @{ Name = "Get-LicenseData";   Script = "Get-LicenseData.ps1";   Output = "license-skus.json" },
    @{ Name = "Get-MFAData";       Script = "Get-MFAData.ps1";       Output = "mfa-status.json" },
    @{ Name = "Get-AdminRoleData"; Script = "Get-AdminRoleData.ps1"; Output = "admin-roles.json" },
    @{ Name = "Get-DeletedUsers";  Script = "Get-DeletedUsers.ps1";  Output = "deleted-users.json" },
    @{ Name = "Get-GroupData";     Script = "Get-GroupData.ps1";     Output = "groups.json" },
    # Device management (DeviceData first - populates SharedData.ManagedDevices)
    @{ Name = "Get-DeviceData";    Script = "Get-DeviceData.ps1";    Output = "devices.json" },
    # Identity now gets UserData after DeviceData (reuses SharedData.ManagedDevices)
    @{ Name = "Get-UserData";      Script = "Get-UserData.ps1";      Output = "users.json" },
    @{ Name = "Get-GuestData";     Script = "Get-GuestData.ps1";     Output = "guests.json" },
    # Endpoint security coverage (reuses ManagedDevices)
    @{ Name = "Get-EndpointSecurityStates"; Script = "Get-EndpointSecurityStates.ps1"; Output = "endpoint-security-states.json" },
    @{ Name = "Get-LapsCoverage"; Script = "Get-LapsCoverage.ps1"; Output = "laps-coverage.json" },
    # Security & risk (IdentityRiskData first - populates SharedData.RiskyUsers/RiskDetections)
    @{ Name = "Get-IdentityRiskData"; Script = "Get-IdentityRiskData.ps1"; Output = "identity-risk-data.json" },
    @{ Name = "Get-SignInData";    Script = "Get-SignInData.ps1";    Output = "risky-signins.json" },
    @{ Name = "Get-SignInLogs";    Script = "Get-SignInLogs.ps1";    Output = "signin-logs.json" },
    @{ Name = "Get-DefenderData";  Script = "Get-DefenderData.ps1";  Output = "defender-alerts.json" },
    @{ Name = "Get-DefenderDeviceHealth"; Script = "Get-DefenderDeviceHealth.ps1"; Output = "defender-device-health.json" },
    @{ Name = "Get-DeviceHardening"; Script = "Get-DeviceHardening.ps1"; Output = "device-hardening.json" },
    @{ Name = "Get-VulnerabilityData"; Script = "Get-VulnerabilityData.ps1"; Output = "vulnerabilities.json" },
    @{ Name = "Get-SecureScoreData"; Script = "Get-SecureScoreData.ps1"; Output = "secure-score.json" },
    # CA policies (ConditionalAccessData first - populates SharedData.CAPolicies)
    @{ Name = "Get-ConditionalAccessData"; Script = "Get-ConditionalAccessData.ps1"; Output = "conditional-access.json" },
    @{ Name = "Get-NamedLocations"; Script = "Get-NamedLocations.ps1"; Output = "named-locations.json" },
    @{ Name = "Get-ASRRules";      Script = "Get-ASRRules.ps1";      Output = "asr-rules.json" },
    @{ Name = "Get-ASRAuditEvents"; Script = "Get-ASRAuditEvents.ps1"; Output = "asr-audit-events.json" },
    # Applications (EnterpriseAppData first - populates SharedData.AppRegistrations/ServicePrincipals)
    @{ Name = "Get-EnterpriseAppData"; Script = "Get-EnterpriseAppData.ps1"; Output = "enterprise-apps.json" },
    @{ Name = "Get-ServicePrincipalSecrets"; Script = "Get-ServicePrincipalSecrets.ps1"; Output = "service-principal-secrets.json" },
    @{ Name = "Get-OAuthConsentGrants"; Script = "Get-OAuthConsentGrants.ps1"; Output = "oauth-consent-grants.json" },
    # ---- REMAINING COLLECTORS (independent or downstream) ----
    @{ Name = "Get-AutopilotData"; Script = "Get-AutopilotData.ps1"; Output = "autopilot.json" },
    @{ Name = "Get-CompliancePolicies"; Script = "Get-CompliancePolicies.ps1"; Output = "compliance-policies.json" },
    @{ Name = "Get-ConfigurationProfiles"; Script = "Get-ConfigurationProfiles.ps1"; Output = "configuration-profiles.json" },
    @{ Name = "Get-WindowsUpdateStatus"; Script = "Get-WindowsUpdateStatus.ps1"; Output = "windows-update-status.json" },
    @{ Name = "Get-BitLockerStatus"; Script = "Get-BitLockerStatus.ps1"; Output = "bitlocker-status.json" },
    @{ Name = "Get-AppDeployments"; Script = "Get-AppDeployments.ps1"; Output = "app-deployments.json" },
    @{ Name = "Get-EndpointAnalytics"; Script = "Get-EndpointAnalytics.ps1"; Output = "endpoint-analytics.json" },
    @{ Name = "Get-AuditLogData";     Script = "Get-AuditLogData.ps1";     Output = "audit-logs.json" },
    @{ Name = "Get-PIMData";          Script = "Get-PIMData.ps1";          Output = "pim-activity.json" },
    @{ Name = "Get-AccessReviewData"; Script = "Get-AccessReviewData.ps1"; Output = "access-review-data.json" },
    # Compliance & data protection
    @{ Name = "Get-RetentionData";   Script = "Get-RetentionData.ps1";   Output = "retention-data.json" },
    @{ Name = "Get-eDiscoveryData";  Script = "Get-eDiscoveryData.ps1";  Output = "ediscovery-data.json" },
    @{ Name = "Get-SensitivityLabelsData"; Script = "Get-SensitivityLabelsData.ps1"; Output = "sensitivity-labels-data.json" },
    # Collaboration (TeamsData reuses SharedData.Groups from GroupData)
    @{ Name = "Get-TeamsData";        Script = "Get-TeamsData.ps1";        Output = "teams.json" },
    @{ Name = "Get-SharePointData";   Script = "Get-SharePointData.ps1";   Output = "sharepoint-sites.json" },
    @{ Name = "Get-ServiceAnnouncementData"; Script = "Get-ServiceAnnouncementData.ps1"; Output = "service-announcements.json" },
    # AppSignInData reuses SharedData.SignInLogs from SignInLogs
    @{ Name = "Get-AppSignInData";  Script = "Get-AppSignInData.ps1";  Output = "app-signins.json" }
)

# Filter collectors if specific ones were requested
if ($CollectorsToRun) {
    $collectors = $collectors | Where-Object {
        $_.Name -replace "Get-", "" -replace "Data", "" -in ($CollectorsToRun -replace "Data", "")
    }
}

# Initialize results tracking
$collectorResults = @{}

# ============================================================================
# SHARED DATA CACHE
# ============================================================================
# To avoid duplicate Graph API calls across collectors, we pass a shared data
# hashtable that primary collectors populate and downstream collectors reuse.
# This eliminates redundant API calls for: managed devices, risky users/detections,
# CA policies, applications, service principals, groups, and sign-in logs.
$sharedData = @{}

# Run each collector
foreach ($collector in $collectors) {
    $collectorPath = Join-Path $PSScriptRoot "collectors" $collector.Script
    $outputPath = Join-Path $dataPath $collector.Output

    Write-Host "  ► $($collector.Name)" -ForegroundColor White

    $collectorStart = Get-Date

    if (-not (Test-Path $collectorPath)) {
        Write-Host "    [X] Collector script not found: $collectorPath" -ForegroundColor Red
        $collectorResults[$collector.Name] = @{
            Success = $false
            Count = 0
            Duration = 0
            Errors = @("Collector script not found")
        }
        # Create empty JSON file to prevent dashboard errors
        "[]" | Set-Content -Path $outputPath -Encoding UTF8
        continue
    }

    try {
        # Execute the collector script with shared data for deduplication
        $result = & $collectorPath -Config $configContent -OutputPath $outputPath -SharedData $sharedData

        $collectorEnd = Get-Date
        $duration = ($collectorEnd - $collectorStart).TotalSeconds

        $collectorResults[$collector.Name] = @{
            Success = $result.Success
            Count = $result.Count
            Duration = $duration
            Errors = $result.Errors
        }

        if ($result.Success) {
            Write-Host "    [OK] Collected $($result.Count) items ($("{0:N1}" -f $duration)s)" -ForegroundColor Green
        }
        else {
            Write-Host "    [X] Failed: $($result.Errors -join '; ')" -ForegroundColor Red
        }
    }
    catch {
        $collectorEnd = Get-Date
        $duration = ($collectorEnd - $collectorStart).TotalSeconds

        Write-Host "    [X] Error: $($_.Exception.Message)" -ForegroundColor Red

        $collectorResults[$collector.Name] = @{
            Success = $false
            Count = 0
            Duration = $duration
            Errors = @($_.Exception.Message)
        }

        # Create empty JSON file to prevent dashboard errors
        "[]" | Set-Content -Path $outputPath -Encoding UTF8
    }

    # Brief pause between collectors to avoid Graph API throttling
    if ($collector -ne $collectors[-1]) {
        Start-Sleep -Seconds 5
    }
}

# ============================================================================
# STEP 5: Cross-reference data
# ============================================================================

Write-Host ""
Write-Host "[5/6] Cross-referencing data..." -ForegroundColor Cyan

$usersPath = Join-Path $dataPath "users.json"
$mfaPath = Join-Path $dataPath "mfa-status.json"
$adminRolesPath = Join-Path $dataPath "admin-roles.json"

# Merge MFA flags into users
Merge-MfaDataIntoUsers -UsersPath $usersPath -MfaPath $mfaPath

# Merge admin role flags into users
Merge-AdminRolesIntoUsers -UsersPath $usersPath -AdminRolesPath $adminRolesPath

# ============================================================================
# STEP 6: Generate metadata and finalize
# ============================================================================

Write-Host ""
Write-Host "[6/6] Generating collection metadata..." -ForegroundColor Cyan

$collectionEndTime = Get-Date
$totalDuration = ($collectionEndTime - $collectionStartTime).TotalSeconds

# Calculate summary statistics from collected data
$summary = @{
    totalUsers = 0
    employeeCount = 0
    studentCount = 0
    otherCount = 0
    disabledUsers = 0
    inactiveUsers = 0
    noMfaUsers = 0
    adminCount = 0
    guestCount = 0
    staleGuests = 0
    deletedUsers = 0
    deletedUsersCritical = 0
    deletedUsersHigh = 0
    totalDevices = 0
    compliantDevices = 0
    noncompliantDevices = 0
    unknownDevices = 0
    staleDevices = 0
    activeAlerts = 0
    totalTeams = 0
    activeTeams = 0
    inactiveTeams = 0
    ownerlessTeams = 0
    totalSites = 0
    activeSites = 0
    inactiveSites = 0
    totalStorageGB = 0
}

# Try to read collected data for summary
try {
    if (Test-Path $usersPath) {
        $users = Get-Content $usersPath -Raw | ConvertFrom-Json
        $summary.totalUsers = $users.Count
        $summary.employeeCount = ($users | Where-Object { $_.domain -eq "employee" }).Count
        $summary.studentCount = ($users | Where-Object { $_.domain -eq "student" }).Count
        $summary.otherCount = ($users | Where-Object { $_.domain -eq "other" }).Count
        $summary.disabledUsers = ($users | Where-Object { -not $_.accountEnabled }).Count
        $summary.inactiveUsers = ($users | Where-Object { $_.isInactive }).Count
        $summary.noMfaUsers = ($users | Where-Object { -not $_.mfaRegistered }).Count
        $summary.adminCount = ($users | Where-Object { $_.flags -contains "admin" }).Count
    }

    $guestsPath = Join-Path $dataPath "guests.json"
    if (Test-Path $guestsPath) {
        $guests = Get-Content $guestsPath -Raw | ConvertFrom-Json
        $summary.guestCount = $guests.Count
        $summary.staleGuests = ($guests | Where-Object { $_.isStale }).Count
    }

    $deletedUsersPath = Join-Path $dataPath "deleted-users.json"
    if (Test-Path $deletedUsersPath) {
        $deletedUsers = Get-Content $deletedUsersPath -Raw | ConvertFrom-Json
        $summary.deletedUsers = $deletedUsers.Count
        $summary.deletedUsersCritical = ($deletedUsers | Where-Object { $_.urgency -eq "Critical" }).Count
        $summary.deletedUsersHigh = ($deletedUsers | Where-Object { $_.urgency -eq "High" }).Count
    }

    $devicesPath = Join-Path $dataPath "devices.json"
    if (Test-Path $devicesPath) {
        $devices = Get-Content $devicesPath -Raw | ConvertFrom-Json
        $summary.totalDevices = $devices.Count
        $summary.compliantDevices = ($devices | Where-Object { $_.complianceState -eq "compliant" }).Count
        $summary.noncompliantDevices = ($devices | Where-Object { $_.complianceState -eq "noncompliant" }).Count
        $summary.unknownDevices = ($devices | Where-Object { $_.complianceState -ne "compliant" -and $_.complianceState -ne "noncompliant" }).Count
        $summary.staleDevices = ($devices | Where-Object { $_.isStale }).Count
    }

    $alertsPath = Join-Path $dataPath "defender-alerts.json"
    if (Test-Path $alertsPath) {
        $alerts = Get-Content $alertsPath -Raw | ConvertFrom-Json
        $summary.activeAlerts = ($alerts | Where-Object { $_.status -ne "resolved" }).Count
    }

    $teamsPath = Join-Path $dataPath "teams.json"
    if (Test-Path $teamsPath) {
        $teamsData = Get-Content $teamsPath -Raw | ConvertFrom-Json
        $summary.totalTeams = $teamsData.Count
        $summary.activeTeams = ($teamsData | Where-Object { -not $_.isInactive -and -not $_.isArchived }).Count
        $summary.inactiveTeams = ($teamsData | Where-Object { $_.isInactive }).Count
        $summary.ownerlessTeams = ($teamsData | Where-Object { $_.hasNoOwner }).Count
    }

    $spPath = Join-Path $dataPath "sharepoint-sites.json"
    if (Test-Path $spPath) {
        $spData = Get-Content $spPath -Raw | ConvertFrom-Json
        $nonPersonal = $spData | Where-Object { -not $_.isPersonalSite }
        $summary.totalSites = ($nonPersonal).Count
        $summary.activeSites = ($nonPersonal | Where-Object { -not $_.isInactive }).Count
        $summary.inactiveSites = ($nonPersonal | Where-Object { $_.isInactive }).Count
        $summary.totalStorageGB = [Math]::Round(($nonPersonal | Measure-Object -Property storageUsedGB -Sum).Sum, 1)
        $summary.externalSharingSites = ($nonPersonal | Where-Object { $_.hasExternalSharing }).Count
        $summary.anonymousLinkSites = ($nonPersonal | Where-Object { $_.anonymousLinkCount -gt 0 }).Count
        $summary.noLabelSites = ($nonPersonal | Where-Object { -not $_.sensitivityLabelId }).Count
    }
}
catch {
    Write-Host "    [!] Could not calculate summary statistics" -ForegroundColor Yellow
}

# Build metadata object
$metadata = @{
    collectionId = $collectionId
    startTime = $collectionStartTime.ToString("o")
    endTime = $collectionEndTime.ToString("o")
    durationSeconds = [math]::Round($totalDuration, 0)
    tenantId = $configContent.tenantId
    collectedBy = (Get-MgContext).Account
    status = if ($collectorResults.Values | Where-Object { -not $_.Success }) { "partial" } else { "completed" }
    collectors = @()
    summary = $summary
    thresholds = $configContent.thresholds
    licenseOverlapRules = $configContent.licenseOverlapRules
    version = "1.0.0"
}

# Add collector results to metadata
$collectorLookup = @{}
foreach ($collectorDef in $collectors) {
    $collectorLookup[$collectorDef.Name] = $collectorDef
}

foreach ($collector in $collectorResults.GetEnumerator()) {
    $def = $collectorLookup[$collector.Name]
    $metadata.collectors += @{
        name = $collector.Name
        success = $collector.Value.Success
        count = $collector.Value.Count
        durationSeconds = [math]::Round($collector.Value.Duration, 0)
        errors = $collector.Value.Errors
        script = if ($def) { $def.Script } else { $null }
        output = if ($def) { $def.Output } else { $null }
    }
}

# Write metadata file
$metadataPath = Join-Path $dataPath "collection-metadata.json"
$metadata | ConvertTo-Json -Depth 10 | Set-Content -Path $metadataPath -Encoding UTF8
Write-Host "  [OK] Metadata written to: $metadataPath" -ForegroundColor Green

# ============================================================================
# Append trend history snapshot
# ============================================================================

try {
    $trendPath = Join-Path $dataPath "trend-history.json"
    $trendHistory = @()

    if (Test-Path $trendPath) {
        $existing = Get-Content $trendPath -Raw | ConvertFrom-Json
        if ($existing) { $trendHistory = @($existing) }
    }

    # Compute MFA and compliance percentages
    $mfaPct = 0
    $compliancePct = 0
    if ($summary.totalUsers -gt 0) {
        $mfaRegistered = $summary.totalUsers - $summary.noMfaUsers
        $mfaPct = [Math]::Round(($mfaRegistered / $summary.totalUsers) * 100)
    }
    if ($summary.totalDevices -gt 0) {
        $compliancePct = [Math]::Round(($summary.compliantDevices / $summary.totalDevices) * 100)
    }

    # Compute waste cost from license data
    $totalWasteMonthlyCost = 0
    $licensePath = Join-Path $dataPath "license-skus.json"
    if (Test-Path $licensePath) {
        $licenseData = Get-Content $licensePath -Raw | ConvertFrom-Json
        foreach ($sku in $licenseData) {
            $totalWasteMonthlyCost += ($sku.wasteMonthlyCost -as [int])
        }
    }

    # Read secure score if available
    $secureScoreVal = $null
    $secureScorePath = Join-Path $dataPath "secure-score.json"
    if (Test-Path $secureScorePath) {
        $ssData = Get-Content $secureScorePath -Raw | ConvertFrom-Json
        if ($ssData -and $ssData.scorePct) { $secureScoreVal = $ssData.scorePct }
    }

    $snapshot = [PSCustomObject]@{
        date                  = $collectionEndTime.ToString("o")
        totalUsers            = $summary.totalUsers
        mfaPct                = $mfaPct
        compliancePct         = $compliancePct
        totalDevices          = $summary.totalDevices
        compliantDevices      = $summary.compliantDevices
        noncompliantDevices   = $summary.noncompliantDevices
        unknownDevices        = $summary.unknownDevices
        activeAlerts          = $summary.activeAlerts
        totalWasteMonthlyCost = $totalWasteMonthlyCost
        secureScore           = $secureScoreVal
    }

    $trendHistory += $snapshot

    # Keep only the most recent 12 snapshots
    if ($trendHistory.Count -gt 12) {
        $trendHistory = $trendHistory[($trendHistory.Count - 12)..($trendHistory.Count - 1)]
    }

    $trendHistory | ConvertTo-Json -Depth 5 | Set-Content -Path $trendPath -Encoding UTF8
    Write-Host "  [OK] Trend snapshot appended ($($trendHistory.Count) entries)" -ForegroundColor Green
}
catch {
    Write-Host "  Could not update trend history: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ============================================================================
# Display summary and cleanup
# ============================================================================

Write-CollectionSummary -Results $collectorResults -StartTime $collectionStartTime -EndTime $collectionEndTime

# Disconnect from Graph
Write-Host "Disconnecting from Microsoft Graph..." -ForegroundColor Cyan
Disconnect-MgGraph | Out-Null
Write-Host "  [OK] Disconnected" -ForegroundColor Green

# Build dashboard automatically so data is ready to view
Write-Host ""
Write-Host "Building dashboard..." -ForegroundColor Cyan
$buildScript = Join-Path $PSScriptRoot "scripts" "Build-Dashboard.ps1"
if (Test-Path $buildScript) {
    if (-not $SkipDashboard) {
        & $buildScript
    }
    else {
        & $buildScript -NoBrowser
    }
}
else {
    Write-Host "Dashboard build script not found. Run Build-Dashboard.ps1 manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Collection complete!" -ForegroundColor Green
Write-Host ""

# Return summary for programmatic use
return @{
    CollectionId = $collectionId
    Status = $metadata.status
    Duration = $totalDuration
    Results = $collectorResults
    Summary = $summary
}
