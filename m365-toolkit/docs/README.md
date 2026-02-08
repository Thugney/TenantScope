# TenantScope

A PowerShell + HTML dashboard for monitoring and managing Microsoft 365 tenants. Collects data via Microsoft Graph API and presents it in a local, offline-capable dashboard.

## What It Does

- **Users** -- member accounts, activity status, MFA enrollment, domain classification
- **Licenses** -- SKU allocation, waste analysis (licenses on disabled/inactive accounts)
- **Guests** -- external users, stale guests, pending invitations
- **Security** -- risky sign-ins, admin role assignments, MFA gaps, Defender alerts
- **Devices** -- Intune managed devices, compliance, encryption, Autopilot enrollment
- **Lifecycle** -- offboarding issues, onboarding gaps, role hygiene, guest cleanup

## Quick Start

```powershell
# 1. Install prerequisites
cd m365-toolkit
.\Install-Prerequisites.ps1

# 2. Edit config.json with your tenant ID and domains

# 3. Collect data (interactive sign-in)
.\Invoke-DataCollection.ps1

# 4. Or test with sample data
.\scripts\Build-Dashboard.ps1 -UseSampleData
```

The dashboard opens automatically after data collection. It runs entirely local -- no external services, no cloud dependencies.

## Requirements

- PowerShell 7.0+
- Microsoft Graph PowerShell SDK
- Modern browser (Chrome, Edge, Firefox)
- Microsoft 365 tenant with appropriate admin permissions

See [m365-toolkit/README.md](m365-toolkit/README.md) for full setup instructions, required Graph permissions, and troubleshooting.

## Project Structure

```
m365-toolkit/
  config.json                 # Tenant configuration
  Invoke-DataCollection.ps1   # Main orchestrator
  collectors/                 # 9 PowerShell data collectors
  dashboard/                  # Static HTML/CSS/JS dashboard
  scripts/                    # Build and scheduling utilities
  data/                       # Collected JSON (gitignored)
  data/sample/                # Sample data for testing
```

## Tech Stack

- **Collection**: PowerShell 7, Microsoft Graph SDK
- **Dashboard**: Vanilla HTML/CSS/JS (no frameworks)
- **Data**: JSON files, bundled into JS for file:// access

## License

MIT
