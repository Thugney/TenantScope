# TenantScope Usage Guide

## Table of Contents
1. [Quick Start](#quick-start)
2. [Installation & Setup](#installation--setup)
3. [Configuration](#configuration)
4. [Data Collection](#data-collection)
5. [Dashboard Usage](#dashboard-usage)
   - [Dashboard Server (Multi-User Deployment)](#dashboard-server-multi-user-deployment)
6. [Scheduled Collection](#scheduled-collection)
7. [Troubleshooting](#troubleshooting)
8. [Advanced Usage](#advanced-usage)
9. [Security Considerations](#security-considerations)
10. [FAQs](#faqs)

## Quick Start

### Minimum Viable Deployment
```powershell
# 1. Install prerequisites
.\Install-Prerequisites.ps1

# 2. Configure tenant settings
Copy config.sample.json to config.json and edit with your tenant ID

# 3. Collect data
.\Invoke-DataCollection.ps1

# 4. View dashboard
.\scripts\Build-Dashboard.ps1
```

### Testing with Sample Data
```powershell
# Skip collection, use sample data for testing
.\scripts\Build-Dashboard.ps1 -UseSampleData
```

## Installation & Setup

### Prerequisites

**Software Requirements:**
- PowerShell 7.0 or higher
- Windows 10/11, Windows Server 2016+ (for scheduled tasks)
- Modern web browser (Chrome, Edge, Firefox)

**Permissions Required:**
- Local administrator rights (for module installation)
- Microsoft 365 admin account with appropriate Graph permissions

### Step-by-Step Installation

1. **Download or Clone the Repository**
   ```powershell
   git clone https://github.com/Thugney/-M365-TENANT-TOOLKIT.git
   cd m365-toolkit
   ```

2. **Run the Setup Script**
   ```powershell
   .\Install-Prerequisites.ps1
   ```
   This script:
   - Installs Microsoft Graph PowerShell SDK modules
   - Creates required directories (`data/`, `dashboard/data/`)
   - Verifies PowerShell version compatibility

3. **Verify Installation**
   ```powershell
   # Check installed modules
   Get-Module -Name Microsoft.Graph.* -ListAvailable | Select-Object Name, Version

   # Test Graph connectivity (will prompt for sign-in)
   Connect-MgGraph -Scopes User.Read.All -NoWelcome
   Disconnect-MgGraph
   ```

## Configuration

### Configuration File Structure

Create `config.json` from the template `config.sample.json`:

```json
{
  "tenantId": "12345678-1234-1234-1234-123456789012",
  "domains": {
    "employees": "@contoso.com",
    "students": "@students.contoso.com"
  },
  "thresholds": {
    "inactiveDays": 90,
    "staleGuestDays": 60,
    "staleDeviceDays": 90,
    "inactiveTeamDays": 90,
    "inactiveSiteDays": 90,
    "highStorageThresholdGB": 20,
    "patchAgeDays": 30,
    "signatureAgeDays": 7,
    "asrNoiseThreshold": 20,
    "lapsRotationDays": 30,
    "sensorStaleDays": 7
  },
  "collection": {
    "signInLogDays": 30,
    "defenderAlertDays": 30,
    "auditLogDays": 30,
    "pimActivityDays": 30,
    "asrEventDays": 30,
    "defenderDeviceDetailLimit": 200,
    "localAdminLogonDays": 30
  },
  "dashboard": {
    "title": "Contoso Tenant Dashboard",
    "subtitle": "Microsoft 365 Management Portal"
  }
}
```

### Configuration Parameters

#### Required Settings
| Parameter | Description | Example |
|-----------|-------------|---------|
| `tenantId` | Your Microsoft 365 tenant ID (GUID) | `"12345678-1234-1234-1234-123456789012"` |
| `domains.employees` | Primary domain for employee accounts | `"@contoso.com"` |
| `domains.students` | Domain for student/learner accounts | `"@students.contoso.com"` |

#### Threshold Settings
| Threshold | Default | Description |
|-----------|---------|-------------|
| `inactiveDays` | 90 | Days since last sign-in to mark user as inactive |
| `staleGuestDays` | 60 | Days since last sign-in to mark guest as stale |
| `staleDeviceDays` | 90 | Days since last check-in to mark device as stale |
| `inactiveTeamDays` | 90 | Days since last activity to mark Team as inactive |
| `inactiveSiteDays` | 90 | Days since last activity to mark SharePoint site as inactive |
| `highStorageThresholdGB` | 20 | Storage usage threshold for highlighting sites |
| `patchAgeDays` | 30 | Days since last quality update to flag patch currency gaps |
| `signatureAgeDays` | 7 | Days since last AV signature update to flag stale signatures |
| `asrNoiseThreshold` | 20 | Minimum ASR audit events to flag noisy rules or devices |
| `lapsRotationDays` | 30 | Days since last LAPS rotation to flag stale credentials |
| `sensorStaleDays` | 7 | Days since Defender sensor last seen to flag stale onboarding |

#### Collection Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `signInLogDays` | 30 | Number of days of sign-in logs to collect |
| `defenderAlertDays` | 30 | Number of days of Defender alerts to collect |
| `auditLogDays` | 30 | Number of days of audit logs to collect |
| `pimActivityDays` | 30 | Number of days of PIM activity to collect |
| `asrEventDays` | 30 | Number of days of ASR audit/block telemetry to collect |
| `defenderDeviceDetailLimit` | 200 | Max devices to pull Defender health details for (safety throttle) |
| `localAdminLogonDays` | 30 | Number of days of local admin logon signal to collect |

#### Currency Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `currency.code` | "NOK" | ISO 4217 currency code for license cost calculations |
| `currency.symbol` | "kr" | Currency symbol displayed in dashboard |
| `currency.locale` | "nb-NO" | Locale for currency formatting |

#### License Pricing (NOK/month)
| SKU | Default Price | Description |
|-----|---------------|-------------|
| `SPE_E3` | 350 | Microsoft 365 E3 |
| `SPE_E5` | 580 | Microsoft 365 E5 |
| `M365EDU_A3_FACULTY` | 70 | Microsoft 365 A3 Faculty |
| `M365EDU_A1` | 0 | Microsoft 365 A1 (free) |
| `M365EDU_A3_STUUSEBNFT` | 30 | Microsoft 365 A3 Student Use Benefit |
| `ENTERPRISEPACK` | 270 | Office 365 E3 |
| `EXCHANGESTANDARD` | 55 | Exchange Online Plan 1 |
| `POWER_BI_PRO` | 105 | Power BI Pro |
| `INTUNE_A` | 90 | Intune Device |
| `AAD_PREMIUM` | 65 | Azure AD Premium P1 |
| `AAD_PREMIUM_P2` | 100 | Azure AD Premium P2 |
| `VISIOCLIENT` | 165 | Visio Plan 2 |
| `PROJECTPREMIUM` | 520 | Project Online Premium |
| `TEAMS_EXPLORATORY` | 0 | Teams Exploratory |
| `FLOW_FREE` | 0 | Power Automate Free |
| `POWERAPPS_VIRAL` | 0 | Power Apps Viral |
| `STREAM` | 0 | Microsoft Stream |
| `POWER_BI_STANDARD` | 0 | Power BI Standard |

#### License Overlap Rules
| Rule | Higher SKU | Lower SKU | Description |
|------|------------|-----------|-------------|
| E3 + E5 | `SPE_E5` | `SPE_E3` | E5 includes all E3 capabilities |
| A3 Faculty + E3 | `SPE_E3` | `M365EDU_A3_FACULTY` | E3 includes overlapping functionality |

#### Dashboard Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `dashboard.title` | "TenantScope" | Main title displayed in header |
| `dashboard.subtitle` | "M365 Tenant Dashboard" | Subtitle displayed in header |

### Finding Your Tenant ID

1. **Azure Portal Method:**
   - Navigate to Azure Active Directory → Properties
   - Copy the "Directory ID"

2. **PowerShell Method:**
   ```powershell
   Connect-MgGraph -Scopes Directory.Read.All
   (Get-MgOrganization).Id
   Disconnect-MgGraph
   ```

3. **Microsoft 365 Admin Center:**
   - Go to Settings → Org settings → Organization profile
   - Find "Tenant ID" under "Technical details"

## Data Collection

### Basic Collection

```powershell
# Collect all data types
.\Invoke-DataCollection.ps1
```

**Interactive Process:**
1. Script displays collection header and configuration
2. Prompts for Microsoft 365 admin sign-in (delegated permissions)
3. Runs all configured collectors sequentially
4. Displays progress and summary
5. Optionally opens dashboard when complete

### Selective Collection

```powershell
# Collect only specific data types
.\Invoke-DataCollection.ps1 -CollectorsToRun @("UserData", "LicenseData", "DeviceData")

# Collect only admin announcements (Message Center + Service Health)
.\Invoke-DataCollection.ps1 -CollectorsToRun @("ServiceAnnouncementData")

# Available collector names:
# UserData, LicenseData, GuestData, MFAData, AdminRoleData, DeletedUsers, GroupData,
# SignInData, SignInLogs, DeviceData, AutopilotData, DefenderData, DefenderDeviceHealth, DeviceHardening, VulnerabilityData,
# IdentityRiskData, SecureScoreData, ConditionalAccessData, NamedLocations, ASRRules, ASRAuditEvents,
# EnterpriseAppData, ServicePrincipalSecrets, OAuthConsentGrants, AppSignInData,
# CompliancePolicies, ConfigurationProfiles, EndpointSecurityStates, LapsCoverage,
# WindowsUpdateStatus, BitLockerStatus, AppDeployments, EndpointAnalytics,
# AuditLogData, PIMData, AccessReviewData,
# RetentionData, eDiscoveryData, SensitivityLabelsData,
# TeamsData, SharePointData, ServiceAnnouncementData
```

### Direct Collector Invocation (Advanced)

If you want to run a single collector without the full orchestrator, you can call it directly.
This requires you to connect to Microsoft Graph and pass a config hashtable.

```powershell
$config = Get-Content .\config.json -Raw | ConvertFrom-Json -AsHashtable
Connect-MgGraph -Scopes "ServiceMessage.Read.All","ServiceHealth.Read.All"

.\collectors\Get-ServiceAnnouncementData.ps1 -Config $config -OutputPath ".\data\service-announcements.json"
```

Note: `Invoke-DataCollection.ps1` expects collector names (for example `ServiceAnnouncementData`),
not script filenames (such as `Get-ServiceAnnouncementData.ps1`).

### Direct Collector Examples (All)

Use the same Microsoft Graph scopes as `Invoke-DataCollection.ps1` (recommended), or the
required scopes listed in each collector header.

```powershell
# One-time setup
$config = Get-Content .\config.json -Raw | ConvertFrom-Json -AsHashtable
$dataPath = Join-Path $PSScriptRoot "data"
# Connect-MgGraph -Scopes "<use scopes from Invoke-DataCollection.ps1>"

.\collectors\Get-UserData.ps1 -Config $config -OutputPath "$dataPath\users.json"
.\collectors\Get-LicenseData.ps1 -Config $config -OutputPath "$dataPath\license-skus.json"
.\collectors\Get-GuestData.ps1 -Config $config -OutputPath "$dataPath\guests.json"
.\collectors\Get-MFAData.ps1 -Config $config -OutputPath "$dataPath\mfa-status.json"
.\collectors\Get-AdminRoleData.ps1 -Config $config -OutputPath "$dataPath\admin-roles.json"
.\collectors\Get-DeletedUsers.ps1 -Config $config -OutputPath "$dataPath\deleted-users.json"
.\collectors\Get-SignInData.ps1 -Config $config -OutputPath "$dataPath\risky-signins.json"
.\collectors\Get-SignInLogs.ps1 -Config $config -OutputPath "$dataPath\signin-logs.json"
.\collectors\Get-DefenderData.ps1 -Config $config -OutputPath "$dataPath\defender-alerts.json"
.\collectors\Get-SecureScoreData.ps1 -Config $config -OutputPath "$dataPath\secure-score.json"
.\collectors\Get-ConditionalAccessData.ps1 -Config $config -OutputPath "$dataPath\conditional-access.json"
.\collectors\Get-ASRRules.ps1 -Config $config -OutputPath "$dataPath\asr-rules.json"
.\collectors\Get-OAuthConsentGrants.ps1 -Config $config -OutputPath "$dataPath\oauth-consent-grants.json"
.\collectors\Get-NamedLocations.ps1 -Config $config -OutputPath "$dataPath\named-locations.json"
.\collectors\Get-IdentityRiskData.ps1 -Config $config -OutputPath "$dataPath\identity-risk-data.json"
.\collectors\Get-DeviceData.ps1 -Config $config -OutputPath "$dataPath\devices.json"
.\collectors\Get-AutopilotData.ps1 -Config $config -OutputPath "$dataPath\autopilot.json"
.\collectors\Get-CompliancePolicies.ps1 -Config $config -OutputPath "$dataPath\compliance-policies.json"
.\collectors\Get-ConfigurationProfiles.ps1 -Config $config -OutputPath "$dataPath\configuration-profiles.json"
.\collectors\Get-WindowsUpdateStatus.ps1 -Config $config -OutputPath "$dataPath\windows-update-status.json"
.\collectors\Get-BitLockerStatus.ps1 -Config $config -OutputPath "$dataPath\bitlocker-status.json"
.\collectors\Get-AppDeployments.ps1 -Config $config -OutputPath "$dataPath\app-deployments.json"
.\collectors\Get-EndpointAnalytics.ps1 -Config $config -OutputPath "$dataPath\endpoint-analytics.json"
.\collectors\Get-EnterpriseAppData.ps1 -Config $config -OutputPath "$dataPath\enterprise-apps.json"
.\collectors\Get-ServicePrincipalSecrets.ps1 -Config $config -OutputPath "$dataPath\service-principal-secrets.json"
.\collectors\Get-AuditLogData.ps1 -Config $config -OutputPath "$dataPath\audit-logs.json"
.\collectors\Get-PIMData.ps1 -Config $config -OutputPath "$dataPath\pim-activity.json"
.\collectors\Get-AccessReviewData.ps1 -Config $config -OutputPath "$dataPath\access-review-data.json"
.\collectors\Get-RetentionData.ps1 -Config $config -OutputPath "$dataPath\retention-data.json"
.\collectors\Get-eDiscoveryData.ps1 -Config $config -OutputPath "$dataPath\ediscovery-data.json"
.\collectors\Get-SensitivityLabelsData.ps1 -Config $config -OutputPath "$dataPath\sensitivity-labels-data.json"
.\collectors\Get-TeamsData.ps1 -Config $config -OutputPath "$dataPath\teams.json"
.\collectors\Get-SharePointData.ps1 -Config $config -OutputPath "$dataPath\sharepoint-sites.json"
.\collectors\Get-ServiceAnnouncementData.ps1 -Config $config -OutputPath "$dataPath\service-announcements.json"
.\collectors\Get-AppSignInData.ps1 -Config $config -OutputPath "$dataPath\app-signins.json"
```

### Advanced Collection Options

```powershell
# Skip dashboard prompt after collection
.\Invoke-DataCollection.ps1 -SkipDashboard

# Use custom configuration file
.\Invoke-DataCollection.ps1 -ConfigPath "C:\Path\To\config-custom.json"

# Run in quiet mode (minimal output)
.\Invoke-DataCollection.ps1 2>$null
```

### Collection Output

**Data Location:** `data\` directory (gitignored)

**Generated Files:**
- `users.json` - User accounts with activity status
- `license-skus.json` - License allocation data
- `guests.json` - External user accounts
- `mfa-status.json` - MFA registration status
- `admin-roles.json` - Directory role assignments
- `risky-signins.json` - Risky sign-in events
- `devices.json` - Intune managed devices
- `autopilot.json` - Windows Autopilot devices
- `defender-alerts.json` - Microsoft Defender alerts
- `enterprise-apps.json` - Enterprise applications
- `audit-logs.json` - Directory audit logs
- `pim-activity.json` - PIM activation history
- `teams.json` - Microsoft Teams data
- `sharepoint-sites.json` - SharePoint site inventory
- `secure-score.json` - Microsoft Secure Score and improvement actions
- `app-signins.json` - Application sign-in data and usage analytics
- `conditional-access.json` - Conditional Access policies and security gaps
- `collection-metadata.json` - Collection metadata and summary

**Metadata File Example:**
```json
{
  "collectionId": "col-2026-02-05-143022",
  "startTime": "2026-02-05T14:30:22.1234567Z",
  "endTime": "2026-02-05T14:45:18.9876543Z",
  "durationSeconds": 896,
  "tenantId": "12345678-1234-1234-1234-123456789012",
  "collectedBy": "admin@contoso.com",
  "status": "completed",
  "collectors": [
    {
      "name": "Get-UserData",
      "success": true,
      "count": 142,
      "durationSeconds": 45,
      "errors": []
    }
  ],
  "summary": {
    "totalUsers": 142,
    "employeeCount": 125,
    "studentCount": 15,
    "otherCount": 2,
    "disabledUsers": 8,
    "inactiveUsers": 12,
    "noMfaUsers": 6,
    "adminCount": 5,
    "guestCount": 23,
    "staleGuests": 3,
    "totalDevices": 189,
    "compliantDevices": 167,
    "staleDevices": 7
  }
}
```

## Dashboard Usage

### Launching the Dashboard

```powershell
# Build and open dashboard with collected data
.\scripts\Build-Dashboard.ps1

# Use sample data for testing/demo
.\scripts\Build-Dashboard.ps1 -UseSampleData

# Build without opening browser
.\scripts\Build-Dashboard.ps1 -NoBrowser
```

### Dashboard Pages

#### 1. Overview
- Summary metrics across all areas
- Donut charts for key indicators
- Quick navigation to problem areas

#### 2. Problems
- Aggregated critical issues across domains
- Prioritized remediation queue
- Direct links to affected users, devices, and policies

#### 3. Coverage Gaps
- Security coverage gaps across Defender device health, ASR telemetry, endpoint security policies, LAPS coverage, patch currency, and device hardening
- Focused lists of devices or rules needing attention
- Threshold-driven flags using `config.json`

#### 4. Users
- Complete user directory with filtering
- **Filters**: Domain, account status, MFA, admin status
- **Columns**: Name, department, last sign-in, licenses, flags
- **Actions**: Export to CSV, view details

#### 5. Licenses
- SKU allocation and utilization
- Waste analysis (licenses assigned to inactive/disabled users)
- **Columns**: Product name, available, assigned, consumed %
- **Visualization**: Allocation bar charts

#### 6. Guests
- External user management
- **Filters**: Invitation status, activity status
- **Columns**: Name, inviting user, invite date, last sign-in
- **Actions**: Identify stale guests for cleanup

#### 7. Security
- Multi-section security dashboard
- **Risky Sign-ins**: High-risk events with details
- **Admin Roles**: Role assignments and members
- **MFA Gaps**: Users without MFA registration
- **Defender Alerts**: Active security alerts

#### 8. Devices
- Intune device compliance overview
- **Filters**: Compliance state, ownership, OS
- **Columns**: Device name, user, compliance, last check-in
- **Actions**: Export device list

#### 9. Enterprise Apps
- Application permissions and usage
- **Filters**: Permission level, publisher verification
- **Columns**: App name, publisher, permissions, user count
- **Details**: Permission descriptions and risk assessment

#### 10. Lifecycle
- Automated lifecycle management reports
- **Offboarding Issues**: Licenses still assigned to disabled users
- **Onboarding Gaps**: New users without required licenses
- **Role Hygiene**: Overprivileged accounts
- **Guest Cleanup**: Stale external users

#### 11. Teams
- Microsoft Teams inventory and activity
- **Filters**: Activity status, visibility, owner status
- **Columns**: Team name, visibility, member count, last activity
- **Details**: Guest access, channel count

#### 12. SharePoint
- Site collection management
- **Filters**: Activity status, storage usage, external sharing
- **Columns**: Site name, storage used, last activity, sensitivity label
- **Actions**: Identify high-storage sites

#### 13. Audit Logs
- Administrative activity monitoring
- **Filters**: Activity type, user, date range
- **Columns**: Timestamp, user, activity, target, result
- **Search**: Free-text search across all fields

#### 14. PIM
- Privileged Identity Management activity
- **Filters**: Role, activation status, user
- **Columns**: User, role, activation time, duration, status
- **Details**: Justification and approval information

#### 15. App Usage
- Application sign-in analytics and usage patterns
- **Filters**: Application, user, date range
- **Columns**: Application name, sign-in count, distinct users, last activity
- **Insights**: Identify rarely used applications

#### 16. Conditional Access
- Conditional Access policy analysis and security gap detection
- **Filters**: Policy state, included/excluded users, conditions
- **Columns**: Policy name, state, conditions, grant controls, coverage
- **Security Gaps**: Identify users without MFA enforcement

#### 17. Data Quality
- Data completeness and quality metrics across all collected data
- **Metrics**: Collection success rates, missing fields, data freshness
- **Visualization**: Quality score charts and gap analysis
- **Actions**: Identify areas needing improved collection

#### 18. License Analysis
- Advanced license utilization and overlap analysis
- **Features**: License waste detection, overlap identification, cost optimization
- **Visualization**: Allocation charts, cost breakdowns, overlap matrices
- **Insights**: Identify duplicate license assignments and optimization opportunities

#### 19. Organization
- Organizational hierarchy and department-level analytics
- **Features**: Department breakdowns, manager reporting chains, cost allocation
- **Filters**: Department, cost center, management level
- **Insights**: License distribution across organizational units

#### 20. Report
- Custom report generation and export capabilities
- **Features**: Pre-built report templates, custom filters, multi-format export
- **Formats**: PDF, HTML, CSV, Excel
- **Automation**: Schedule report generation and distribution

### Dashboard Features

#### Filtering & Search
- Column-specific filters for all tables
- Free-text search across multiple columns
- Combined filters (AND logic)
- Clear filters button

#### Data Export
- Export any table to CSV format
- Preserves current filters and sorting
- CSV includes all columns (not just visible)
- File naming: `TenantScope-{Page}-{Date}.csv`

#### Table Operations
- Column sorting (click headers)
- Column visibility toggle
- Row expansion for details
- Pagination for large datasets

#### Keyboard Shortcuts
- `Esc` - Close modal/details view
- `Ctrl+F` - Focus search filter (where available)
- `Tab` - Navigate between interactive elements

#### Responsive Design
- Collapsible sidebar for smaller screens
- Responsive table layouts
- Mobile-friendly navigation

### Dashboard Data Refresh

```powershell
# After new data collection, rebuild dashboard
.\scripts\Build-Dashboard.ps1

# Dashboard will automatically load the latest data
```

**Note:** The dashboard loads data from `dashboard/data/` directory. Running `Build-Dashboard.ps1` copies the latest collected data to this location.

### Dashboard Server (Multi-User Deployment)

For shared server deployments where multiple IT admins need access, use the built-in HTTP server with usage tracking.

```powershell
# Start server on default port 8080
.\scripts\Start-DashboardServer.ps1

# Start on custom port and open browser
.\scripts\Start-DashboardServer.ps1 -Port 9000 -OpenBrowser

# Disable usage tracking
.\scripts\Start-DashboardServer.ps1 -NoTracking

# Allow all users to see usage statistics (default: admin-only)
.\scripts\Start-DashboardServer.ps1 -PublicStats
```

**Server Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-Port` | HTTP port to listen on | `8080` |
| `-LogPath` | Path to usage log file | `./data/usage-log.json` |
| `-OpenBrowser` | Open dashboard in browser on start | `$false` |
| `-NoTracking` | Disable usage tracking entirely | `$false` |
| `-PublicStats` | Show usage stats to all users | `$false` |

**API Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `/` | Dashboard (serves index.html) |
| `/api/whoami` | Current user info (JSON) |
| `/api/usage` | Usage statistics (admin-only by default) |
| `/api/config` | Server configuration (JSON) |
| `/api/log` | Page view logging (POST) |

**Usage Tracking Configuration (config.json):**

```json
{
  "server": {
    "usageTracking": {
      "enabled": true,
      "showStatsToAllUsers": false,
      "adminUsers": ["DOMAIN\\AdminUser1", "DOMAIN\\AdminUser2"]
    }
  }
}
```

| Setting | Description |
|---------|-------------|
| `enabled` | Enable/disable usage tracking |
| `showStatsToAllUsers` | If `true`, all users can view usage stats. If `false`, only admins. |
| `adminUsers` | List of users who can view stats. Empty = everyone is admin. |

**What Gets Tracked:**
- Page views (which dashboard pages users visit)
- Session duration
- User identity (Windows username)
- Timestamps

**Viewing Usage Stats:**
When running in server mode, admins see a "Dashboard Usage" section in the Overview page showing:
- Total sessions and unique users
- Activity breakdown (today, this week, this month)
- Top users and most popular pages

## Scheduled Collection

### Automated Collection Setup

```powershell
# Create daily collection task at 6:00 AM
.\scripts\Schedule-Collection.ps1 -Schedule Daily -Time "06:00"

# Weekly collection on Mondays at 8:00 AM
.\scripts\Schedule-Collection.ps1 -Schedule Weekly -Time "08:00"

# Custom task name and description
.\scripts\Schedule-Collection.ps1 -Schedule Daily -Time "06:00" -TaskName "TenantScope-DataCollection"
```

### Scheduled Task Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-Schedule` | Collection frequency | `Daily` |
| `-Time` | Execution time (24h format) | `"06:00"` |
| `-TaskName` | Windows Task Scheduler name | `"TenantScope Data Collection"` |
| `-TaskDescription` | Task description | Auto-generated |
| `-Remove` | Remove existing scheduled task | `$false` |

### Task Configuration Details

**Created Task Properties:**
- Runs with highest privileges
- Configured for Windows 10/Windows Server 2016+
- Hidden task (doesn't show UI)
- Runs whether user is logged on or not
- Triggers on schedule with 30-minute retry on failure

**Task Actions:**
1. Sets working directory to script location
2. Executes `Invoke-DataCollection.ps1 -SkipDashboard`
3. Executes `Build-Dashboard.ps1 -NoBrowser`

### Managing Scheduled Tasks

```powershell
# View existing tasks
Get-ScheduledTask -TaskName "*TenantScope*" | Format-List

# Remove scheduled task
.\scripts\Schedule-Collection.ps1 -Remove

# Run task manually (for testing)
Start-ScheduledTask -TaskName "TenantScope Data Collection"
```

### App Registration for Unattended Execution

Scheduled tasks require app-only authentication since there's no user to sign in interactively. You must create an Azure AD App Registration with the required permissions.

#### Step 1: Create App Registration

1. Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
2. Click "New registration"
3. Name: `TenantScope Data Collector`
4. Supported account types: "Accounts in this organizational directory only"
5. Click "Register"
6. Note the **Application (client) ID** - you'll need this

#### Step 2: Add API Permissions

1. In your app registration, go to "API permissions"
2. Click "Add a permission" > "Microsoft Graph" > "Application permissions"
3. Add the following permissions:

| Permission | Purpose |
|------------|---------|
| `User.Read.All` | Read user profiles |
| `Directory.Read.All` | Read directory data |
| `AuditLog.Read.All` | Read audit logs |
| `Reports.Read.All` | Read reports |
| `ServiceMessage.Read.All` | Read service announcements |
| `ServiceHealth.Read.All` | Read service health |
| `DeviceManagementManagedDevices.Read.All` | Read Intune devices |
| `DeviceManagementConfiguration.Read.All` | Read device configuration and endpoint security policies |
| `DeviceManagementApps.Read.All` | Read app deployments |
| `SecurityEvents.Read.All` | Read Defender alerts |
| `IdentityRiskEvent.Read.All` | Read risk events |
| `IdentityRiskyUser.Read.All` | Read risky users |
| `RoleManagement.Read.Directory` | Read directory roles |
| `RoleAssignmentSchedule.Read.Directory` | Read PIM role assignments |
| `RoleEligibilitySchedule.Read.Directory` | Read PIM eligible roles |
| `Application.Read.All` | Read app registrations and service principals |
| `Policy.Read.All` | Read conditional access policies |
| `Team.ReadBasic.All` | Read Teams |
| `Channel.ReadBasic.All` | Read Teams channels |
| `TeamMember.Read.All` | Read Teams membership |
| `Sites.Read.All` | Read SharePoint sites |
| `BitLockerKey.Read.All` | Read BitLocker recovery keys |
| `DelegatedPermissionGrant.ReadWrite.All` | Read OAuth consent grants |
| `RecordsManagement.Read.All` | Read retention data |
| `eDiscovery.Read.All` | Read eDiscovery cases |
| `InformationProtectionPolicy.Read` | Read sensitivity labels |
| `AccessReview.Read.All` | Read access reviews |
| `AdvancedHunting.Read.All` | Run Defender Advanced Hunting queries |
| `Machine.Read.All` | Read Defender for Endpoint device health |

4. Click "Grant admin consent for [Your Tenant]"

#### Step 3a: Create Certificate (Recommended)

```powershell
# Create self-signed certificate (valid for 2 years)
$cert = New-SelfSignedCertificate `
    -Subject "CN=TenantScope Data Collector" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -KeySpec Signature `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(2)

# Export public key for Azure
Export-Certificate -Cert $cert -FilePath "TenantScope.cer"

# Note the thumbprint
$cert.Thumbprint
```

Then upload `TenantScope.cer` to your app registration:
1. Go to "Certificates & secrets" > "Certificates"
2. Click "Upload certificate" and select `TenantScope.cer`

#### Step 3b: Create Client Secret (Alternative)

If certificates are not feasible:
1. Go to "Certificates & secrets" > "Client secrets"
2. Click "New client secret"
3. Set description and expiration
4. Copy the secret value immediately (it won't be shown again)

**Note:** Secrets expire and must be rotated. Certificates are more secure.

#### Step 4: Schedule with Credentials

```powershell
# Using certificate (recommended)
.\scripts\Schedule-Collection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -CertificateThumbprint "ABC123DEF456..." `
    -Schedule Daily -Time "06:00"

# Using client secret (less secure)
.\scripts\Schedule-Collection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -ClientSecret "your-secret-value" `
    -Schedule Daily -Time "06:00"
```

#### Manual Testing

Before scheduling, test the connection manually:

```powershell
# Test with certificate
.\Invoke-DataCollection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -CertificateThumbprint "ABC123DEF456..."

# Test with client secret
.\Invoke-DataCollection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -ClientSecret "your-secret-value"
```

## Troubleshooting

### Common Issues and Solutions

#### Authentication Errors

**Problem:** `Connect-MgGraph: Access denied`
```powershell
# Error details may include:
# - Insufficient privileges
# - Invalid tenant ID
# - Consent required
```

**Solutions:**
1. Verify admin roles:
   ```powershell
   # Check your directory roles
   Get-MgDirectoryRole | Where-Object { (Get-MgDirectoryRoleMember -DirectoryRoleId $_.Id).Id -contains (Get-MgContext).UserId }
   ```

2. Required minimum roles:
   - Global Reader (for most data)
   - Intune Administrator (for device data)
   - Security Reader (for security data)

3. Consent to application permissions:
   - First-time sign-in may require admin consent
   - Grant consent for all requested permissions

#### Missing Data

**Problem:** Certain data types show as empty

**Licensing Requirements:**
| Data Type | Required License |
|-----------|------------------|
| Sign-in activity | Entra ID P1/P2 |
| Risk detections | Entra ID P2 |
| MFA registration | Entra ID P1 |
| Defender alerts | Microsoft Defender |
| ASR audit/block telemetry (Advanced Hunting) | Defender for Endpoint P2 |
| Defender device health / sensor status | Defender for Endpoint P2 |
| Vulnerability data | Defender for Endpoint P2 |
| Endpoint Analytics | Intune |
| Retention, eDiscovery, sensitivity labels | Microsoft Purview / E5 Compliance |
| PIM activity | Azure AD Premium P2 |

**Verification:**
```powershell
# Check if you can access the data manually
Connect-MgGraph -Scopes User.Read.All, AuditLog.Read.All
Get-MgAuditLogSignIn -Top 1  # Should return data if licensed
```

#### Throttling and Performance

**Problem:** Collection takes extremely long or fails with throttling errors

**Solutions:**
1. Automatic retry is built-in (5 attempts, exponential backoff)
2. For large tenants:
   ```powershell
   # Run during off-peak hours
   # Use selective collection for critical data only
   # Consider splitting collection across multiple runs
   ```

3. Monitor progress:
   - Collection summary shows duration per collector
   - Check `collection-metadata.json` for detailed timing

#### Dashboard Display Issues

**Problem:** Dashboard shows "No Data Available" or errors

**Solutions:**
1. Verify data collection completed successfully
2. Check browser console for JavaScript errors (F12)
3. Rebuild dashboard:
   ```powershell
   .\scripts\Build-Dashboard.ps1
   ```

4. Test with sample data:
   ```powershell
   .\scripts\Build-Dashboard.ps1 -UseSampleData
   ```

#### PowerShell Module Issues

**Problem:** `Required module Microsoft.Graph.* not installed`

**Solutions:**
1. Re-run prerequisites script:
   ```powershell
   .\Install-Prerequisites.ps1
   ```

2. Install modules manually:
   ```powershell
   Install-Module Microsoft.Graph.Authentication -Force
   Install-Module Microsoft.Graph.Users -Force
   # ... other required modules
   ```

3. Update modules:
   ```powershell
   Update-Module Microsoft.Graph.*
   ```

### Diagnostic Commands

```powershell
# Check PowerShell version
$PSVersionTable.PSVersion

# List installed Graph modules
Get-Module -Name Microsoft.Graph.* -ListAvailable | Select-Object Name, Version, Path

# Test Graph connectivity
Connect-MgGraph -Scopes User.Read.All -NoWelcome
Get-MgContext
Disconnect-MgGraph

# Verify configuration file
Test-Path config.json
Get-Content config.json | ConvertFrom-Json | Select-Object tenantId

# Check data directory
Get-ChildItem data\ -Filter *.json | Select-Object Name, Length, LastWriteTime
```

### Log Files

**PowerShell Transcript:**
```powershell
# Enable transcript logging
Start-Transcript -Path "C:\Logs\TenantScope-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Run collection
.\Invoke-DataCollection.ps1

# Stop transcript
Stop-Transcript
```

**Windows Event Logs:**
- Application logs for scheduled task execution
- PowerShell logs for script execution details

## Advanced Usage

### Custom Collectors

**Creating a New Collector:**

1. Template structure:
   ```powershell
   # ============================================================================
   # TenantScope
   # Author: Your Name
   # ============================================================================

   <#
   .SYNOPSIS
       Brief description in Norwegian.

   .DESCRIPTION
       Detailed description in English.
   #>

   param(
       [Parameter(Mandatory)]
       [hashtable]$Config,

       [Parameter(Mandatory)]
       [string]$OutputPath
   )

   # Helper functions
   function Invoke-GraphWithRetry { ... }

   # Main logic
   try {
       # Graph API calls
       # Data transformation
       # JSON output

       return @{
           Success = $true
           Count   = $count
           Errors  = @()
       }
   }
   catch {
       "[]" | Set-Content -Path $OutputPath -Encoding UTF8

       return @{
           Success = $false
           Count   = 0
           Errors  = @($_.Exception.Message)
       }
   }
   ```

2. Add to orchestrator:
   - Add collector definition to `$collectors` array in `Invoke-DataCollection.ps1`
   - Add to `ValidateSet` for `-CollectorsToRun` parameter

3. Add to dashboard:
   - Extend `DataLoader` module in `data-loader.js`
   - Create page module if needed

### Integration with Other Tools

**PowerShell Data Processing:**
```powershell
# Load collected data into PowerShell
$users = Get-Content .\data\users.json -Raw | ConvertFrom-Json
$devices = Get-Content .\data\devices.json -Raw | ConvertFrom-Json

# Generate custom reports
$users | Where-Object { $_.isInactive -and $_.licenseCount -gt 0 } |
    Select-Object displayName, userPrincipalName, daysSinceLastSignIn, licenseCount |
    Export-Csv -Path "inactive-users-with-licenses.csv" -NoTypeInformation
```

**Web Server Deployment:**
```powershell
# Copy dashboard to web server
Copy-Item -Path dashboard\* -Destination "C:\inetpub\wwwroot\tenantscope\" -Recurse

# Set appropriate permissions
icacls "C:\inetpub\wwwroot\tenantscope\data" /grant "IIS_IUSRS:(RX)"
```

**SIEM Integration:**
```powershell
# Convert security data to SIEM format
$alerts = Get-Content .\data\defender-alerts.json -Raw | ConvertFrom-Json
$alerts | ForEach-Object {
    @{
        timestamp = $_.createdDateTime
        severity = $_.severity
        title = $_.title
        category = $_.category
        status = $_.status
    }
} | ConvertTo-Json | Out-File "alerts-for-siem.json"
```

### Performance Optimization

**For Large Tenants (10,000+ users):**

1. **Memory Management:**
   ```powershell
   # Process users in batches
   $batchSize = 1000
   $processedUsers = @()

   for ($i = 0; $i -lt $graphUsers.Count; $i += $batchSize) {
       $batch = $graphUsers[$i..($i + $batchSize - 1)]
       # Process batch
   }
   ```

2. **Selective Collection:**
   ```powershell
   # Collect only high-priority data
   .\Invoke-DataCollection.ps1 -CollectorsToRun @("UserData", "DeviceData", "Security")
   ```

3. **Schedule Strategically:**
   - Run during off-peak hours
   - Split collection across multiple time slots

### Custom Reporting

**HTML Report Generation:**
```powershell
# Load data
$metadata = Get-Content .\data\collection-metadata.json -Raw | ConvertFrom-Json
$summary = $metadata.summary

# Generate HTML report
$html = @"
<!DOCTYPE html>
<html>
<head>
    <title>TenantScope Report - $(Get-Date -Format 'yyyy-MM-dd')</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .metric { margin: 20px 0; padding: 15px; background: #f5f5f5; }
    </style>
</head>
<body>
    <h1>TenantScope Report</h1>
    <p>Generated: $(Get-Date)</p>

    <div class="metric">
        <h3>Users: $($summary.totalUsers)</h3>
        <p>Active: $($summary.totalUsers - $summary.inactiveUsers)</p>
        <p>Inactive: $($summary.inactiveUsers)</p>
    </div>

    <!-- Add more metrics -->
</body>
</html>
"@

$html | Out-File "Custom-Report-$(Get-Date -Format 'yyyyMMdd').html"
```

## Security Considerations

### Data Protection

**Local Storage:**
- Data stored in `data/` directory (gitignored)
- Consider encrypting the directory for sensitive environments
- Regular cleanup of old data files

**Access Control:**
- Restrict access to the toolkit directory
- Use file system permissions to control read/write access
- Consider separate service account for scheduled tasks

### Authentication Security

**Delegated Permissions:**
- Uses your admin account credentials
- No persistent application secrets
- Permission scope limited to read operations

**Best Practices:**
1. Use dedicated monitoring account (not daily admin)
2. Enable MFA for the service account
3. Regularly review Graph API sign-in logs
4. Monitor for unusual collection patterns

### Network Security

**Data in Transit:**
- All Graph API calls use HTTPS
- Local data transfer is file-based (no network)
- Dashboard served locally or over HTTPS

**Firewall Considerations:**
- Ensure outbound HTTPS to Graph API endpoints
- No inbound ports required for local deployment

### Compliance Considerations

**Data Retention:**
- JSON files contain current state only
- No historical data unless archived manually
- Implement data retention policy for collected files

**Privacy:**
- User data stored locally
- Consider GDPR/Privacy implications for your region
- Anonymize data if sharing reports externally

## FAQs

### General Questions

**Q: Can I run this on macOS or Linux?**
A: The PowerShell scripts require PowerShell 7.0+, which is cross-platform. However, the scheduled task functionality (`Schedule-Collection.ps1`) is Windows-specific. Collection scripts should work on other platforms with manual scheduling.

**Q: Does this modify my tenant configuration?**
A: No. All operations are read-only. The toolkit only collects data via Graph API.

**Q: How often should I run data collection?**
A: For most organizations, daily collection is sufficient. For security monitoring, consider more frequent collection of security-related data.

### Technical Questions

**Q: Why does collection take so long?**
A: Collection time depends on tenant size and Graph API throttling. Large tenants may take 30+ minutes. Use selective collection for critical data.

**Q: Can I customize the dashboard appearance?**
A: Yes. Modify `dashboard/css/style.css` for branding. The CSS uses custom properties (variables) for easy customization.

**Q: How do I add new data types?**
A: See "Custom Collectors" section in Advanced Usage. Follow the existing patterns for consistency.

**Q: Is there an API for accessing the collected data?**
A: Not built-in, but you can read the JSON files directly from other tools. Consider the data format as a simple API.

### Licensing Questions

**Q: Do I need special licenses for all features?**
A: Some features require Entra ID P1/P2, Intune, or Defender licenses. The toolkit gracefully handles missing data when licenses aren't available.

**Q: Can I use this with GCC or GCC High tenants?**
A: The toolkit uses public Graph API endpoints. For government clouds, you may need to modify endpoints in collector scripts.

**Q: Is there a cost to use this toolkit?**
A: No. The toolkit itself is MIT licensed and free. You only need appropriate Microsoft 365 licenses for your tenant.

### Support Questions

**Q: Where can I get help with issues?**
A: Check the troubleshooting section first. For persistent issues, open an issue on the GitHub repository.

**Q: Can I contribute improvements?**
A: Yes! Contributions are welcome. Please ensure code follows existing patterns and includes proper documentation.

**Q: Is there commercial support available?**
A: This is a community project. For commercial support, consider engaging with Microsoft Partners or consultants familiar with Graph API.

---

## Additional Resources

### Documentation
- [Microsoft Graph API Documentation](https://docs.microsoft.com/graph/)
- [PowerShell Graph SDK Documentation](https://docs.microsoft.com/powershell/microsoftgraph/)
- [TenantScope GitHub Repository](https://github.com/Thugney/-M365-TENANT-TOOLKIT)

### Training
- [Microsoft Graph Fundamentals](https://learn.microsoft.com/graph/)
- [PowerShell for Graph API](https://learn.microsoft.com/powershell/module/microsoft.graph.authentication/)

### Community
- [Microsoft Tech Community](https://techcommunity.microsoft.com/)
- [PowerShell GitHub Discussions](https://github.com/PowerShell/PowerShell/discussions)

---

*Last Updated: February 2026*
*Usage Guide Version: 1.0*
