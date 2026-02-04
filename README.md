# M365 Tenant Toolkit

> A comprehensive IT admin toolkit for Microsoft 365 tenant management, monitoring, and reporting.

**Author:** Robe ([GitHub](https://github.com/Thugney))
**License:** MIT

## Overview

M365 Tenant Toolkit is a PowerShell-based solution for collecting and visualizing Microsoft 365 tenant data. It provides IT administrators with actionable insights into:

- **User Management** - All users, activity status, MFA enrollment, domain classification
- **License Optimization** - SKU allocation, waste analysis, utilization metrics
- **Guest Accounts** - External users, stale guests, pending invitations
- **Security Posture** - Risky sign-ins, admin roles, MFA gaps, Defender alerts
- **Device Health** - Intune devices, compliance status, Autopilot enrollment
- **Lifecycle Management** - Offboarding issues, onboarding gaps, role hygiene

The toolkit collects data via Microsoft Graph API and presents it in a local HTML dashboard — no cloud services, no external dependencies, all data stays local.

## Quick Start

```powershell
# 1. Navigate to the toolkit directory
cd m365-toolkit

# 2. Install prerequisites (Graph SDK)
.\Install-Prerequisites.ps1

# 3. Configure your tenant in config.json
# Edit config.json with your tenant ID and domain settings

# 4. Run data collection
.\Invoke-DataCollection.ps1

# 5. View the dashboard
.\scripts\Build-Dashboard.ps1
```

## Test with Sample Data

No tenant access? Test the dashboard with included sample data:

```powershell
cd m365-toolkit
.\scripts\Build-Dashboard.ps1 -UseSampleData
```

## Requirements

| Requirement | Details |
|-------------|---------|
| PowerShell | 7.0 or later |
| Graph SDK | Microsoft.Graph module (installed by setup script) |
| Browser | Modern browser for dashboard |
| Permissions | Global Reader role minimum |

## Repository Structure

```
├── README.md                              # This file
├── M365-TENANT-TOOLKIT-ARCHITECTURE.md   # Full architecture specification
│
└── m365-toolkit/                          # The toolkit
    ├── config.json                        # Tenant configuration
    ├── Install-Prerequisites.ps1          # Setup script
    ├── Invoke-DataCollection.ps1          # Main orchestrator
    ├── collectors/                        # Data collection modules
    ├── dashboard/                         # HTML dashboard
    ├── data/                              # Collected data (gitignored)
    │   └── sample/                        # Sample data for testing
    └── scripts/                           # Utility scripts
```

## Documentation

- **[Architecture Document](M365-TENANT-TOOLKIT-ARCHITECTURE.md)** - Complete technical specification
- **[Toolkit README](m365-toolkit/README.md)** - Detailed usage instructions

## Features

### Data Collectors

| Collector | Data Source | Graph Endpoint |
|-----------|-------------|----------------|
| Get-UserData | All users + sign-in activity | `/users` |
| Get-LicenseData | License SKUs + assignments | `/subscribedSkus` |
| Get-GuestData | External/guest users | `/users?$filter=userType eq 'Guest'` |
| Get-MFAData | MFA registration status | `/reports/authenticationMethods` |
| Get-AdminRoleData | Directory role assignments | `/directoryRoles` |
| Get-SignInData | Risky sign-ins + risk detections | `/identityProtection/riskDetections` |
| Get-DeviceData | Intune managed devices | `/deviceManagement/managedDevices` |
| Get-AutopilotData | Windows Autopilot devices | `/deviceManagement/windowsAutopilotDeviceIdentities` |
| Get-DefenderData | Security alerts | `/security/alerts_v2` |

### Dashboard Pages

- **Overview** - Summary cards with key metrics
- **Users** - Searchable, filterable user table with CSV export
- **Licenses** - SKU utilization and waste analysis
- **Guests** - External user management
- **Security** - Risk events, admin roles, MFA gaps, alerts
- **Devices** - Device compliance and health
- **Lifecycle** - Actionable reports for offboarding/onboarding

## Security

- All data is stored locally as JSON files
- No external services or cloud storage
- Data directory is gitignored by default
- Uses delegated permissions (your admin credentials)
- All operations are read-only

## Contributing

Contributions are welcome! Please follow the coding standards in the architecture document:

1. Include the author header in all files
2. Add detailed comments to all functions
3. Write complete, working code (no stubs)
4. Test with sample data before submitting

## License

MIT License - See [LICENSE](LICENSE) for details.
