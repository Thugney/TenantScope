# TenantScope - M365 Tenant Toolkit

[![Version](https://img.shields.io/badge/version-2.4.1-blue.svg)](https://github.com/Thugney/TenantScope/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PowerShell](https://img.shields.io/badge/PowerShell-7.0%2B-5391FE.svg?logo=powershell&logoColor=white)](https://github.com/PowerShell/PowerShell)
[![GitHub stars](https://img.shields.io/github/stars/Thugney/TenantScope?style=social)](https://github.com/Thugney/TenantScope/stargazers)

[![Author](https://img.shields.io/badge/Author-Robel-brightgreen.svg)](https://github.com/Thugney)
[![X (Twitter)](https://img.shields.io/badge/X-@eriteach-1DA1F2.svg?logo=x&logoColor=white)](https://x.com/eriteach)

---

> A comprehensive IT admin toolkit for Microsoft 365 tenant management, security monitoring, and operational visibility.

![TenantScope Dashboard](m365-toolkit/docs/TenantSccope.png)

## What is TenantScope?

TenantScope is a PowerShell-based solution that collects data from your Microsoft 365 tenant via Microsoft Graph API and presents it in a local HTML dashboard. It provides IT administrators and security specialists with a single-pane-of-glass view across:

- **Identity** - Users, guests, admin roles, MFA status, risky sign-ins
- **Security** - Conditional access, PIM, OAuth consents, vulnerabilities, ASR rules
- **Endpoints** - Devices, compliance, BitLocker, Windows Update, Defender alerts
- **Licensing** - SKU allocation, waste analysis, overlap detection
- **Collaboration** - Teams, SharePoint sites, external sharing

All data stays local. No cloud services. No external dependencies.

## Key Features

- **42 Data Collectors** - Comprehensive Graph API coverage across M365 workloads
- **Cross-Entity Navigation** - Click users to see devices, sign-ins, roles; click devices to see users, vulnerabilities
- **Deep Links** - Direct links to Entra, Intune, and Defender admin portals for immediate action
- **Problem Detection** - Aggregated critical issues with severity-based prioritization
- **Signal Cards** - Executive summary with risk scores and actionable insights
- **Selective Collection** - Run specific collectors when you need fresh data on just users or devices
- **Flexible Auth** - Interactive sign-in or app-only with certificate/secret

## Quick Start

```powershell
# Clone the repository
git clone https://github.com/Thugney/TenantScope.git
cd TenantScope/m365-toolkit

# Install prerequisites (Graph SDK modules)
.\Install-Prerequisites.ps1

# Run data collection (interactive auth)
.\Invoke-DataCollection.ps1

# Or run specific collectors only
.\Invoke-DataCollection.ps1 -CollectorsToRun @("DeviceData", "UserData", "SignInLogs")
```

## Documentation

| Document | Description |
|----------|-------------|
| [Full README](m365-toolkit/README.md) | Complete usage guide with all options |
| [Architecture](m365-toolkit/docs/ARCHITECTURE.md) | Technical architecture and data flow |
| [Changelog](CHANGELOG.md) | Version history and release notes |
| [Remediation Roadmap](m365-toolkit/docs/MVP-REMEDIATION-ROADMAP.md) | Future roadmap for write/remediation capabilities |

## Requirements

- PowerShell 7.0+
- Microsoft Graph PowerShell SDK modules
- Microsoft 365 tenant with appropriate Graph API permissions
- See [full requirements](m365-toolkit/README.md#requirements) for detailed permissions

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Made with focus by [Robel](https://github.com/Thugney)** | [Follow on X](https://x.com/eriteach)
