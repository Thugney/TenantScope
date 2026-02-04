# M365 Tenant Toolkit

> An IT admin toolkit for Microsoft 365 tenant management and monitoring.

**Author:** Robe ([GitHub](https://github.com/Thugney))
**Repository:** https://github.com/Thugney/-M365-TENANT-TOOLKIT
**License:** MIT

## Overview

M365 Tenant Toolkit is a PowerShell-based solution for collecting and visualizing Microsoft 365 tenant data. It provides IT administrators with insights into:

- **User Management** - All users, activity status, MFA enrollment
- **License Optimization** - SKU allocation, waste analysis, utilization metrics
- **Guest Accounts** - External users, stale guests, pending invitations
- **Security Posture** - Risky sign-ins, admin roles, MFA gaps, Defender alerts
- **Device Health** - Intune devices, compliance status, Autopilot enrollment
- **Lifecycle Management** - Offboarding issues, onboarding gaps, role hygiene

The toolkit collects data via Microsoft Graph API and presents it in a local HTML dashboard - no cloud services, no external dependencies.

## Requirements

### Software

- **PowerShell 7.0+** - Required for running collectors
- **Microsoft Graph PowerShell SDK** - For Graph API access
- **Modern Web Browser** - For viewing the dashboard

### Permissions

The following Microsoft Graph delegated permissions are required:

| Permission | Purpose |
|-----------|---------|
| User.Read.All | Read all user profiles |
| Directory.Read.All | Read directory data |
| AuditLog.Read.All | Read sign-in activity |
| Reports.Read.All | Read MFA registration reports |
| DeviceManagementManagedDevices.Read.All | Read Intune devices |
| DeviceManagementConfiguration.Read.All | Read Autopilot data |
| SecurityEvents.Read.All | Read security alerts |
| IdentityRiskyUser.Read.All | Read risky users |
| IdentityRiskEvent.Read.All | Read risk detections |
| RoleManagement.Read.Directory | Read directory roles |

**Note:** Some features require Entra ID P1/P2 or Microsoft 365 E5 licensing:
- Sign-in activity requires P1+
- Risk detections require P2
- Defender alerts require Defender licensing

## Quick Start

### 1. Install Prerequisites

```powershell
# Run the setup script
.\Install-Prerequisites.ps1
```

This installs the Microsoft Graph PowerShell SDK and creates required directories.

### 2. Configure Tenant Settings

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
  }
}
```

### 3. Collect Data

```powershell
# Run data collection (interactive sign-in)
.\Invoke-DataCollection.ps1
```

You'll be prompted to sign in with your admin account. The script collects data from all configured sources.

### 4. View Dashboard

```powershell
# Build and open the dashboard
.\scripts\Build-Dashboard.ps1
```

Or test with sample data:

```powershell
.\scripts\Build-Dashboard.ps1 -UseSampleData
```

## Project Structure

```
m365-toolkit/
├── config.json                    # Tenant configuration
├── Install-Prerequisites.ps1      # Setup script
├── Invoke-DataCollection.ps1      # Main collection orchestrator
│
├── collectors/                    # Data collection modules
│   ├── Get-UserData.ps1
│   ├── Get-LicenseData.ps1
│   ├── Get-GuestData.ps1
│   ├── Get-MFAData.ps1
│   ├── Get-AdminRoleData.ps1
│   ├── Get-SignInData.ps1
│   ├── Get-DeviceData.ps1
│   ├── Get-AutopilotData.ps1
│   └── Get-DefenderData.ps1
│
├── data/                          # Collected JSON data (gitignored)
│   └── sample/                    # Sample data for testing
│
├── dashboard/                     # Static HTML dashboard
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── data-loader.js
│   │   ├── filters.js
│   │   ├── tables.js
│   │   ├── export.js
│   │   └── page-*.js
│   └── data/                      # Data files copied for dashboard
│
└── scripts/
    ├── Build-Dashboard.ps1        # Prepares dashboard for viewing
    └── Schedule-Collection.ps1    # Sets up automated collection
```

## Usage

### Manual Collection

```powershell
# Collect all data
.\Invoke-DataCollection.ps1

# Collect specific data types only
.\Invoke-DataCollection.ps1 -CollectorsToRun @("UserData", "LicenseData")

# Skip dashboard prompt
.\Invoke-DataCollection.ps1 -SkipDashboard
```

### Scheduled Collection

```powershell
# Set up daily collection at 6 AM (requires admin)
.\scripts\Schedule-Collection.ps1 -Schedule Daily -Time "06:00"

# Weekly collection
.\scripts\Schedule-Collection.ps1 -Schedule Weekly -Time "08:00"

# Remove scheduled task
.\scripts\Schedule-Collection.ps1 -Remove
```

### Dashboard

```powershell
# Use collected data
.\scripts\Build-Dashboard.ps1

# Use sample data (for testing)
.\scripts\Build-Dashboard.ps1 -UseSampleData

# Don't open browser
.\scripts\Build-Dashboard.ps1 -NoBrowser
```

## Dashboard Pages

### Overview
Summary dashboard with key metrics across all areas - user counts, security status, device compliance.

### Users
All member accounts with filtering by domain, status, and flags. Export to CSV supported.

### Licenses
SKU allocation table with waste analysis showing licenses assigned to disabled or inactive users.

### Guests
External user accounts with invitation status, activity tracking, and stale guest identification.

### Security
Multi-section view showing risky sign-ins, admin role assignments, MFA gaps, and Defender alerts.

### Devices
Intune managed devices with compliance status, encryption state, and sync recency.

### Lifecycle
Computed reports for lifecycle management - offboarding issues, onboarding gaps, role hygiene, guest cleanup.

## Troubleshooting

### Authentication Errors

```
Error: Connect-MgGraph: Access denied
```

Ensure your account has the required admin roles:
- Global Reader (minimum)
- Intune Administrator (for device data)
- Security Reader (for risk data)

### Missing Data

Some data types require specific licensing:
- Sign-in activity: Entra ID P1+
- Risk detections: Entra ID P2
- Defender alerts: Microsoft Defender license

The collectors handle missing data gracefully and create empty JSON files.

### Throttling

Graph API has rate limits. The collectors include automatic retry logic with exponential backoff. For large tenants, collection may take several minutes.

## Security Notes

- Data is stored locally as JSON files
- No data is sent to external services
- The `data/` directory is gitignored
- Authentication uses delegated permissions (your admin account)
- All operations are read-only

## Contributing

Contributions are welcome! Please ensure:
1. All files include the author header
2. Functions have detailed comments
3. Code is complete and working (no stubs)
4. Test with sample data before submitting

## License

MIT License - see LICENSE file for details.
