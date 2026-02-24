# TenantScope - M365 Tenant Toolkit

[![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=flat&logo=github)](https://github.com/Thugney)
[![Blog](https://img.shields.io/badge/Blog-eriteach.com-0d9488?style=flat&logo=hugo)](https://blog.eriteach.com)
[![YouTube](https://img.shields.io/badge/YouTube-Eriteach-FF0000?style=flat&logo=youtube)](https://www.youtube.com/@eriteach)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Eriteach-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/eriteach/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![PowerShell](https://img.shields.io/badge/PowerShell-7.0%2B-5391FE?style=flat&logo=powershell&logoColor=white)](https://github.com/PowerShell/PowerShell)
[![Version](https://img.shields.io/badge/version-2.4.1-blue?style=flat)](https://github.com/Thugney/TenantScope/releases)

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

---

## Problems Solved

### For IT Administrators

| Problem | How TenantScope Helps |
|---------|----------------------|
| **"I need to check 5 different admin portals to get the full picture"** | Single dashboard aggregates data from Entra, Intune, Defender, and M365 admin centers |
| **"Which users still don't have MFA enabled?"** | MFA status page shows all users without strong authentication, sorted by risk |
| **"Our license costs are out of control"** | License analysis detects unused licenses, duplicate assignments, and overlap waste |
| **"I can't tell which devices are actually compliant"** | Device compliance view shows real-time status with drill-down to specific policy failures |
| **"Stale guest accounts are a security risk"** | Guest management identifies inactive external users who should be removed |
| **"Configuration profiles keep failing but I don't know why"** | Configuration Profiles page shows deployment errors, conflicts, and affected devices |
| **"I need to report on our security posture"** | Export any view to CSV/Excel for management reporting |

### For Security Specialists

| Problem | How TenantScope Helps |
|---------|----------------------|
| **"I need to find users without MFA before attackers do"** | Prioritized list of unprotected accounts with admin role highlighting |
| **"Which Conditional Access policies have gaps?"** | CA policy analysis shows coverage gaps, excluded users, and legacy auth exposure |
| **"Are there overprivileged apps in our tenant?"** | OAuth consent grants page reveals high-risk application permissions |
| **"Which devices have known vulnerabilities?"** | Vulnerability dashboard shows CVEs by severity with affected device counts |
| **"I need to investigate a risky sign-in"** | Sign-in logs with risk levels, locations, and device details for forensic analysis |
| **"Who activated privileged roles recently?"** | PIM activity tracking shows all role elevations with justifications |
| **"Are attack surface reduction rules actually working?"** | ASR rules page shows audit/block events and rule effectiveness |
| **"BitLocker encryption status across the fleet"** | BitLocker coverage report identifies unencrypted devices |

### Operational Benefits

- **Offline Analysis** - Data collected once, analyze without internet dependency
- **No Agent Required** - Uses existing Graph API, no software deployment needed
- **Privacy First** - All data stays on your local machine, never transmitted externally
- **Fast Answers** - Search across all entities instantly, no waiting for portal loads
- **Cross-Reference Everything** - Click a user to see their devices, sign-ins, groups, and roles
- **Direct Action Links** - Jump straight to Entra/Intune/Defender portals to fix issues

---

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
| [Authentication Guide](m365-toolkit/docs/AUTHENTICATION-GUIDE.md) | How to set up app registration in Entra ID |
| [Architecture](m365-toolkit/docs/ARCHITECTURE.md) | Technical architecture and data flow |
| [Security Considerations](SECURITY-CONSIDERATIONS.md) | Data sensitivity and countermeasures |
| [Changelog](CHANGELOG.md) | Version history and release notes |

## Authentication Options

| Method | Use Case | LAPS Support |
|--------|----------|--------------|
| **Interactive** (default) | Testing, ad-hoc runs | No* |
| **Client Secret** | Scheduled automation | Yes |
| **Certificate** | Production, high security | Yes |

*LAPS requires `DeviceLocalCredential.Read.All` which is Application-only.

See the [Authentication Guide](m365-toolkit/docs/AUTHENTICATION-GUIDE.md) for setup instructions.

## Requirements

- PowerShell 7.0+
- Microsoft Graph PowerShell SDK modules
- Microsoft 365 tenant with appropriate Graph API permissions
- See [full requirements](m365-toolkit/README.md#requirements) for detailed permissions

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Made with focus by [Robel][![GitHub](https://img.shields.io/badge/GitHub-Thugney-181717?style=flat&logo=github)](https://github.com/Thugney)** | [![Blog](https://img.shields.io/badge/Blog-eriteach.com-0d9488?style=flat&logo=hugo)](https://blog.eriteach.com) | [![YouTube](https://img.shields.io/badge/YouTube-Eriteach-FF0000?style=flat&logo=youtube)](https://www.youtube.com/@eriteach) | [![LinkedIn](https://img.shields.io/badge/LinkedIn-Eriteach-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/eriteach/)


[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

