# TenantScope

![TenantScope](docs/TenantSccope.png)

> A comprehensive IT admin toolkit for Microsoft 365 tenant management, security monitoring, and operational visibility.

**Author:** Robel ([GitHub](https://github.com/Thugney), [X](https://x.com/eriteach))
**Repository:** https://github.com/Thugney/TenantScope
**Version:** 2.1.1
**License:** MIT

## Overview

TenantScope is a PowerShell-based solution for collecting and visualizing Microsoft 365 tenant data. It provides IT administrators with a single-pane-of-glass view across identity, devices, security, licensing, and collaboration workloads.

The toolkit collects data via Microsoft Graph API and presents it in a local HTML dashboard - no cloud services, no external dependencies, all data stays on your machine.

## Key Features

### Dashboard Pages

The dashboard is organized into functional groups:

**Identity**
- **Overview** - Executive summary with security signals, risk scores, and actionable insights
- **Problems** - Aggregated critical issues across all data types with prioritized remediation guidance
- **Users** - Member accounts with activity status, MFA enrollment, admin flags, and license assignments
- **Organization** - Department-level analytics and organizational hierarchy
- **Guests** - External users with invitation status, activity tracking, and stale guest identification
- **Lifecycle** - Computed reports for offboarding issues, onboarding gaps, and role hygiene

**Licensing**
- **Licenses** - SKU allocation with waste analysis showing licenses assigned to disabled/inactive users
- **Overlap Analysis** - License overlap detection for cost optimization

**Security**
- **Security** - Admin roles, MFA gaps, and security posture overview
- **Sign-In Logs** - Authentication activity with risk levels and conditional access results
- **Conditional Access** - Policy analysis with coverage gaps and security recommendations
- **ASR Rules** - Attack Surface Reduction rules deployment status
- **Credential Expiry** - Service principal and app registration secret expiration tracking
- **PIM** - Privileged Identity Management activity and role activation tracking
- **Identity Risk** - Risky users and risk detections from Entra ID Protection
- **OAuth Consent** - Application consent grants with risk assessment
- **Vulnerabilities** - Defender for Endpoint vulnerability data

**Compliance**
- **Data Governance** - Retention policies, sensitivity labels, eDiscovery cases, and access reviews

**Endpoints**
- **Devices** - Intune managed devices with compliance status, encryption state, and sync recency
- **Compliance Policies** - Device compliance policy status and failures
- **Configuration Profiles** - Intune configuration profile deployment status
- **Windows Update** - Update ring assignments and compliance
- **BitLocker** - Encryption status and recovery key escrow
- **App Deployments** - Application installation status across devices
- **Endpoint Analytics** - Device performance scores and health metrics
- **Enterprise Apps** - Application permissions and usage analytics

**Collaboration**
- **Teams** - Team inventory, activity tracking, ownership, and guest access analysis
- **SharePoint** - Site collections with storage usage and external sharing monitoring

**Reports**
- **Executive Report** - Printable summary for leadership
- **App Usage** - Application sign-in analytics and usage patterns
- **Data Quality** - Data completeness and collection metrics

**Audit**
- **Audit Logs** - Administrative activity monitoring with search and filtering

### Data Relationships and Cross-Page Navigation

TenantScope links entities across data types for comprehensive context:

- Click a user to see their devices, sign-ins, admin roles, MFA status, Teams membership, and licenses
- Click a device to see its primary user, compliance status, BitLocker state, Windows Update status, and vulnerabilities
- Click a Team to see its linked SharePoint site, owners, and guest members
- Cross-reference vulnerabilities with affected devices
- View Defender alerts linked to specific users and devices

### Deep Links to Admin Portals

Each entity includes direct links to the corresponding admin portal for immediate action:

- **Users**: Entra ID user profile, authentication methods, devices, groups, directory roles
- **Devices**: Intune device blade, compliance state, BitLocker keys, Entra device details
- **Security**: Defender security portal, PIM activation
- **Teams/SharePoint**: Admin center links for management

### Problem Detection and Signal Cards

The **Problems** page aggregates critical issues with prioritized severity:

**Critical Issues**
- Non-compliant devices
- Users without MFA
- Expired certificates
- Confirmed compromised accounts

**High Priority**
- Unencrypted devices
- Unsupported Windows versions
- Risky users (high risk level)
- High-risk OAuth consent grants
- Expiring app credentials

**Medium Priority**
- Stale devices (90+ days)
- Ownerless Teams
- External sharing on SharePoint sites
- Configuration profile failures

The **Overview** page displays security signal cards with risk scoring and direct navigation to affected items.

## Requirements

### Software

- **PowerShell 7.0+** - Required for running collectors
- **Microsoft Graph PowerShell SDK** - For Graph API access
- **Modern Web Browser** - For viewing the dashboard (Chrome, Edge, Firefox, Safari)

### Installation

```powershell
# Run the setup script to install prerequisites
.\Install-Prerequisites.ps1
```

This installs the following Graph SDK modules:
- Microsoft.Graph.Authentication
- Microsoft.Graph.Users
- Microsoft.Graph.Identity.DirectoryManagement
- Microsoft.Graph.DeviceManagement
- Microsoft.Graph.Security
- Microsoft.Graph.Reports

### Permissions

The following Microsoft Graph permissions are required (delegated or application):

| Permission | Purpose |
|-----------|---------|
| User.Read.All | Read all user profiles |
| Directory.Read.All | Read directory data including roles |
| AuditLog.Read.All | Read sign-in activity and audit logs |
| Reports.Read.All | Read MFA registration reports |
| ServiceMessage.Read.All | Read service announcements |
| ServiceHealth.Read.All | Read service health |
| DeviceManagementManagedDevices.Read.All | Read Intune devices |
| DeviceManagementConfiguration.Read.All | Read compliance policies and config profiles |
| DeviceManagementApps.Read.All | Read app deployments |
| SecurityEvents.Read.All | Read security alerts |
| IdentityRiskyUser.Read.All | Read risky users |
| IdentityRiskEvent.Read.All | Read risk detections |
| RoleManagement.Read.Directory | Read directory roles |
| RoleAssignmentSchedule.Read.Directory | Read PIM role assignments |
| RoleEligibilitySchedule.Read.Directory | Read PIM eligible roles |
| Application.Read.All | Read app registrations and service principals |
| Policy.Read.All | Read conditional access policies |
| Team.ReadBasic.All | Read Teams |
| Channel.ReadBasic.All | Read Teams channels |
| TeamMember.Read.All | Read Teams membership |
| Sites.Read.All | Read SharePoint sites |
| BitLockerKey.Read.All | Read BitLocker recovery keys |

**Licensing Notes:**
- Sign-in activity requires Entra ID P1+
- Risk detections require Entra ID P2
- Defender alerts require Microsoft Defender licensing
- Endpoint Analytics requires Intune licensing

## Quick Start

### 1. Configure Tenant Settings

Edit `config.json` with your tenant information:

```json
{
  "tenantId": "your-tenant-id-here",
  "domains": {
    "employees": "@yourdomain.com",
    "students": "@students.yourdomain.com"
  },
  "thresholds": {
    "inactiveDays": 90,
    "staleGuestDays": 60,
    "staleDeviceDays": 90
  },
  "collection": {
    "signInLogDays": 30,
    "defenderAlertDays": 30,
    "auditLogDays": 30
  }
}
```

### 2. Collect Data

```powershell
# Run data collection with interactive sign-in
.\Invoke-DataCollection.ps1
```

You will be prompted to sign in with your admin account. The script runs all collectors, cross-references data, and builds the dashboard automatically.

### 3. View Dashboard

The dashboard opens automatically after collection. To rebuild manually:

```powershell
.\scripts\Build-Dashboard.ps1
```

## Usage

### Full Collection (Interactive Authentication)

```powershell
# Collect all data with interactive sign-in
.\Invoke-DataCollection.ps1

# Skip the dashboard prompt after collection
.\Invoke-DataCollection.ps1 -SkipDashboard
```

### Selective Collection

Run only specific collectors to reduce collection time:

```powershell
# Collect only user and license data
.\Invoke-DataCollection.ps1 -CollectorsToRun @("UserData", "LicenseData")

# Collect only device-related data
.\Invoke-DataCollection.ps1 -CollectorsToRun @("DeviceData", "CompliancePolicies", "BitLockerStatus")

# Collect only security data
.\Invoke-DataCollection.ps1 -CollectorsToRun @("SignInData", "DefenderData", "ConditionalAccessData")
```

**Available collector names:**
- UserData, LicenseData, GuestData, MFAData, AdminRoleData, DeletedUsers
- SignInData, SignInLogs, DeviceData, AutopilotData, DefenderData
- EnterpriseAppData, AuditLogData, PIMData, TeamsData, SharePointData
- SecureScoreData, AppSignInData, ConditionalAccessData
- CompliancePolicies, ConfigurationProfiles, WindowsUpdateStatus
- BitLockerStatus, AppDeployments, EndpointAnalytics
- ServicePrincipalSecrets, ASRRules, ServiceAnnouncementData

### App-Only Authentication (Scheduled/Unattended)

For scheduled or unattended execution, use certificate-based app authentication:

```powershell
# Using certificate thumbprint (recommended)
.\Invoke-DataCollection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -CertificateThumbprint "ABC123DEF456..."

# Using client secret (less secure)
.\Invoke-DataCollection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -ClientSecret "your-secret-here"
```

**Note:** App-only authentication requires an Azure AD app registration with application permissions (not delegated) granted with admin consent.

### Scheduled Collection

```powershell
# Set up daily collection at 6 AM
.\scripts\Schedule-Collection.ps1 -Schedule Daily -Time "06:00"

# Weekly collection
.\scripts\Schedule-Collection.ps1 -Schedule Weekly -Time "08:00"

# Remove scheduled task
.\scripts\Schedule-Collection.ps1 -Remove
```

### Dashboard Options

```powershell
# Build with live collected data
.\scripts\Build-Dashboard.ps1

# Build with sample data (for testing/demo)
.\scripts\Build-Dashboard.ps1 -UseSampleData

# Build without opening browser
.\scripts\Build-Dashboard.ps1 -NoBrowser

# Use custom data path
.\scripts\Build-Dashboard.ps1 -DataPath "C:\path\to\data"
```

## Project Structure

```
m365-toolkit/
├── config.json                    # Tenant configuration
├── Install-Prerequisites.ps1      # Setup script
├── Invoke-DataCollection.ps1      # Main collection orchestrator
│
├── collectors/                    # Data collection modules (37 scripts)
│   ├── Get-UserData.ps1
│   ├── Get-LicenseData.ps1
│   ├── Get-DeviceData.ps1
│   ├── Get-ConditionalAccessData.ps1
│   ├── Get-BitLockerStatus.ps1
│   ├── Get-EndpointAnalytics.ps1
│   ├── Get-VulnerabilityData.ps1
│   └── ... (see collectors/ for full list)
│
├── lib/
│   └── CollectorBase.ps1          # Shared collector utilities
│
├── data/                          # Collected JSON data (gitignored)
│   └── sample/                    # Sample data for testing
│
├── dashboard/                     # Static HTML dashboard
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js                 # Main application
│   │   ├── data-loader.js         # Data loading
│   │   ├── data-relationships.js  # Cross-entity lookups
│   │   ├── filters.js             # Filtering utilities
│   │   ├── tables.js              # Table rendering
│   │   ├── export.js              # CSV export
│   │   └── page-*.js              # Individual page modules
│   └── data/                      # Data files for dashboard
│
└── scripts/
    ├── Build-Dashboard.ps1        # Prepares dashboard for viewing
    └── Schedule-Collection.ps1    # Sets up automated collection
```

## Performance Considerations

TenantScope loads all collected JSON into memory on dashboard startup. For large tenants:

1. **Reduce collection windows** in `config.json`:
   - Lower `signInLogDays`, `auditLogDays`, `defenderAlertDays` values

2. **Use selective collection** when you only need specific datasets:
   ```powershell
   .\Invoke-DataCollection.ps1 -CollectorsToRun @("UserData", "DeviceData")
   ```

3. **Run collection during off-hours** to avoid Graph API throttling

4. **Monitor bundle size**: The generated `dashboard/js/data-bundle.js` contains all data. Large bundles may slow initial page load.

## Troubleshooting

### Repeated Authentication Prompts

If you're prompted to re-authenticate multiple times during collection:

**Option 1: Use Device Code Authentication (Recommended)**
```powershell
.\Invoke-DataCollection.ps1 -UseDeviceCode
```
This shows a code to enter at https://microsoft.com/devicelogin once, and the session persists.

**Option 2: Clear Token Cache**
```powershell
# Disconnect existing session
Disconnect-MgGraph -ErrorAction SilentlyContinue

# Clear the MSAL token cache
$cacheFolder = Join-Path $env:LOCALAPPDATA "Microsoft\Graph\.graph"
if (Test-Path $cacheFolder) { Remove-Item $cacheFolder -Recurse -Force }

# Run collection again
.\Invoke-DataCollection.ps1
```

**Option 3: Use App-Only Authentication (Best for Regular Use)**

Set up certificate-based authentication for unattended, stable collection. See [App-Only Authentication](#app-only-authentication-scheduledunattended).

### Authentication Errors

```
Error: Connect-MgGraph: Access denied
```

Ensure your account has the required admin roles:
- Global Reader (minimum for read-only access)
- Intune Administrator (for device data)
- Security Reader (for risk and security data)

### Graph API Property Errors (BadRequest)

```
Error: Could not find a property named 'X' on type 'microsoft.graph.Y'
```

This occurs when a collector requests a property that doesn't exist in your Graph API version or tenant. These are typically fixed in updates. If you encounter this:

1. **Pull the latest version**: `git pull`
2. **Report the issue**: Open an issue with the full error message

Common examples that have been fixed:
- `managedDeviceCertificateExpirationDate` - Removed (not a valid property)
- `autopilotEnrolled` - Removed (not a valid property on managedDevice)

### Missing Data

Some data types require specific licensing:
- Sign-in activity: Entra ID P1+
- Risk detections: Entra ID P2
- Defender alerts: Microsoft Defender license
- Endpoint Analytics: Intune license
- Vulnerability data: Microsoft Defender for Endpoint P2
- Retention labels: Microsoft Purview / E5 Compliance

The collectors handle missing data gracefully and create empty JSON files.

### Permission Errors (Forbidden)

```
Error: Response status code does not indicate success: Forbidden
```

This means the app/user lacks the required permission. Check:
1. The permission is granted in Azure AD (for app-only auth)
2. Admin consent was given (for app-only auth)
3. Your account has the appropriate admin role (for interactive auth)

Common permission requirements:
- SharePoint site details: `Sites.Read.All`
- BitLocker keys: `BitLockerKey.Read.All`
- Retention labels: `RecordsManagement.Read.All`

### Throttling

Graph API has rate limits. The collectors include automatic retry logic with exponential backoff. For large tenants, collection may take several minutes. Consider running during off-peak hours.

### Dashboard Won't Load

If the dashboard shows a blank page:
1. Ensure `Build-Dashboard.ps1` completed successfully
2. Check that `dashboard/js/data-bundle.js` was generated
3. Try opening in a different browser
4. Check browser console for JavaScript errors

## Security Notes

- All data is stored locally as JSON files
- No data is sent to external services
- The `data/` directory is gitignored by default
- Interactive authentication uses delegated permissions (your admin account)
- App-only authentication requires application permissions with admin consent
- All operations are read-only - no modifications to tenant data

## Contributing

Contributions are welcome! Please ensure:
1. All files include the author header
2. Functions have detailed comments
3. Code is complete and working (no stubs)
4. Test with sample data before submitting

## License

MIT License - see LICENSE file for details.
