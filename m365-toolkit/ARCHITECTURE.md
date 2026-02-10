# TenantScope Architecture Documentation

## Overview

TenantScope is a PowerShell-based data collection and dashboard system for Microsoft 365 tenant security, governance, and lifecycle visibility. The architecture follows a modular, local-first approach: collectors pull data from Microsoft Graph, store it locally as JSON, and a static dashboard renders insights without any server-side dependencies.

Key characteristics:
- Local-first: data stays in `data/` and is never sent to external services.
- Read-only: collectors only query Microsoft Graph.
- Modular: each collector is independent and returns structured JSON.
- Resilient: failures are isolated per collector and do not halt the pipeline.

For detailed collector behavior, see `COLLECTOR_BREAKDOWN.md`. For dashboard
alignment and gap reviews, see the per-collector files in `reviews/`.

## System Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATA COLLECTION LAYER                           │
│  PowerShell Collectors (Microsoft Graph API)                             │
│                                                                          │
│  Invoke-DataCollection.ps1 (Orchestrator)                                │
│    ├─ Identity & Access: Users, Guests, MFA, Admin Roles, Deleted Users  │
│    ├─ Security & Risk: Sign-ins, Risk, Defender, Secure Score, CA, ASR   │
│    ├─ Device Mgmt: Devices, Autopilot, Compliance, Config, Updates, BL   │
│    ├─ Apps & Governance: Enterprise Apps, Secrets, App Deployments       │
│    └─ Collaboration: Teams, SharePoint                                  │
│                                                                          │
│  Output: JSON files in data/                                             │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATA PROCESSING LAYER                           │
│  Cross-referencing + Metadata                                            │
│                                                                          │
│  • MFA status merged into users                                          │
│  • Admin role flags added to users                                       │
│  • Summary statistics computed                                           │
│  • Trend history snapshot appended                                       │
│  • Collection metadata written                                           │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                              │
│  Static HTML Dashboard (Vanilla JS)                                      │
│                                                                          │
│  • Hash-based routing                                                    │
│  • Central data loader                                                   │
│  • Pure SVG charts (no external libs)                                    │
│  • CSV export, filters, and insights                                     │
│                                                                          │
│  Build: scripts/Build-Dashboard.ps1                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Orchestrator (`Invoke-DataCollection.ps1`)

Responsibilities:
- Loads and validates `config.json`
- Connects to Microsoft Graph with required scopes
- Runs collectors sequentially with a brief delay to avoid throttling
- Cross-references MFA and admin flags into `users.json`
- Generates `collection-metadata.json` and `trend-history.json`
- Builds the dashboard bundle

Notable behaviors:
- Collector failures do not halt execution.
- Empty JSON outputs are written on failure to avoid dashboard errors.
- Summary statistics are computed from collected JSON files.

### 2. Collector Library (`lib/CollectorBase.ps1`)

Shared utilities used by all collectors:
- `Invoke-GraphWithRetry` for throttling backoff
- Date helpers (`Get-DaysSinceDate`, `Get-DaysUntilDate`, `Format-IsoDate`)
- Domain classification (`Get-DomainClassification`, `Get-SourceDomain`)
- Status helpers (`Get-ActivityStatus`, `Get-CertificateStatus`)
- Standardized output helpers (`New-CollectorResult`, `Save-CollectorData`)

### 3. Collector Inventory (27 Scripts)

Each collector takes `-Config` and `-OutputPath`, calls Graph, normalizes data, and writes a JSON file. Some collectors use Microsoft Graph beta endpoints or report CSV downloads; these are called out in `COLLECTOR_BREAKDOWN.md`.

| Collector Script | Output File | Category | Notes |
|---|---|---|---|
| `Get-UserData.ps1` | `users.json` | Identity | Includes manager expansion and license assignments |
| `Get-LicenseData.ps1` | `license-skus.json` | Identity | Waste/overlap calculations from `users.json` |
| `Get-GuestData.ps1` | `guests.json` | Identity | Membership counts via `/memberOf` |
| `Get-MFAData.ps1` | `mfa-status.json` | Identity | Reports API with fallback to direct Graph |
| `Get-AdminRoleData.ps1` | `admin-roles.json` | Identity | Role membership analysis |
| `Get-DeletedUsers.ps1` | `deleted-users.json` | Identity | Recycle bin visibility |
| `Get-SignInData.ps1` | `risky-signins.json` | Security | Risk detections (P2) |
| `Get-SignInLogs.ps1` | `signin-logs.json` | Security | Detailed sign-ins with summaries |
| `Get-DefenderData.ps1` | `defender-alerts.json` | Security | Uses alerts_v2 with fallback |
| `Get-SecureScoreData.ps1` | `secure-score.json` | Security | Latest secure score + actions |
| `Get-ConditionalAccessData.ps1` | `conditional-access.json` | Security | Policy classification |
| `Get-ASRRules.ps1` | `asr-rules.json` | Security | Uses beta Intune endpoints |
| `Get-DeviceData.ps1` | `devices.json` | Device Mgmt | Detailed device inventory + insights |
| `Get-AutopilotData.ps1` | `autopilot.json` | Device Mgmt | Autopilot identities |
| `Get-CompliancePolicies.ps1` | `compliance-policies.json` | Device Mgmt | Compliance policy health |
| `Get-ConfigurationProfiles.ps1` | `configuration-profiles.json` | Device Mgmt | Legacy + settings catalog |
| `Get-WindowsUpdateStatus.ps1` | `windows-update-status.json` | Device Mgmt | Rings, policies, and compliance |
| `Get-BitLockerStatus.ps1` | `bitlocker-status.json` | Device Mgmt | Encryption + key escrow |
| `Get-AppDeployments.ps1` | `app-deployments.json` | Device Mgmt | App install status |
| `Get-EndpointAnalytics.ps1` | `endpoint-analytics.json` | Device Mgmt | Endpoint analytics (beta) |
| `Get-EnterpriseAppData.ps1` | `enterprise-apps.json` | Apps | Credential expiry + owners |
| `Get-ServicePrincipalSecrets.ps1` | `service-principal-secrets.json` | Apps | App registration credentials |
| `Get-AuditLogData.ps1` | `audit-logs.json` | Governance | Directory audit logs |
| `Get-PIMData.ps1` | `pim-activity.json` | Governance | PIM requests + eligibility |
| `Get-AppSignInData.ps1` | `app-signins.json` | Governance | App usage via sign-ins |
| `Get-TeamsData.ps1` | `teams.json` | Collaboration | Teams activity report |
| `Get-SharePointData.ps1` | `sharepoint-sites.json` | Collaboration | SharePoint usage report |

### 4. Configuration (`config.json`)

Key configuration sections:
- `tenantId`: Target tenant GUID
- `domains`: Domain mappings for employee vs student classification
- `thresholds`: Inactivity thresholds used by multiple collectors
- `collection`: Time windows for logs and alerts
- `licensePricing` and `licenseOverlapRules`: Used by `Get-LicenseData.ps1`
- `dashboard`: Title/subtitle for the UI

Note: `pimActivityDays` exists in `config.sample.json` but is not currently used by the PIM collector.

### 5. Data Storage (`data/`)

Primary outputs (one per collector) plus metadata:
- `users.json`, `guests.json`, `deleted-users.json`
- `license-skus.json`, `mfa-status.json`, `admin-roles.json`
- `risky-signins.json`, `signin-logs.json`, `app-signins.json`
- `defender-alerts.json`, `secure-score.json`, `conditional-access.json`, `asr-rules.json`
- `devices.json`, `autopilot.json`, `compliance-policies.json`, `configuration-profiles.json`
- `windows-update-status.json`, `bitlocker-status.json`, `app-deployments.json`, `endpoint-analytics.json`
- `enterprise-apps.json`, `service-principal-secrets.json`
- `audit-logs.json`, `pim-activity.json`
- `teams.json`, `sharepoint-sites.json`
- `collection-metadata.json`, `trend-history.json`

### 6. Dashboard (`dashboard/`)

Technology:
- Static HTML + CSS + vanilla JS
- Hash-based routing (`#overview`, `#users`, ...)
- Central `DataLoader` with bundle or fetch fallback
- `DataLoader` unwraps nested structures where needed (e.g., `teams.json`)
- SVG charts, filters, and CSV export

Build flow:
- `scripts/Build-Dashboard.ps1` copies JSON files to `dashboard/data/`
- Generates `data-bundle.js` for CORS-safe local viewing

### 7. Dashboard Interaction Patterns

**Unified Filtering:**
Every data page follows a consistent filtering pattern using the `Filters` module:
- `Filters.createFilterBar()` or inline `<div class="filter-bar">` for the filter container
- `Filters.setup(elementId, callback)` to wire change/input events with debouncing
- `Filters.apply(data, config)` to filter data using search, exact, includes, boolean, range, and dateRange filter types
- `Filters.getValue(elementId)` / `Filters.setValue(elementId, value)` for programmatic access

**Column Selector:**
Each table provides a `ColumnSelector.create()` toggle button that lets users show/hide columns:
- Preferences persist to `localStorage` per page
- `onColumnsChanged` callback re-renders the table with visible columns only

**Cross-Page Entity Links:**
All entity references are rendered as clickable anchor elements with class `entity-link`:
- Pattern: `<a href="#page?search=<encoded>" class="entity-link">Name</a>`
- Pages parse the `search` query parameter on load to pre-filter results
- Supported entity types: users, devices, groups, teams, guests, sharepoint, vulnerabilities

**Admin Portal Deep Links:**
Where applicable, tables include an "Admin" column with links to Microsoft admin portals:
- Pattern: `<a href="https://entra.microsoft.com/..." target="_blank" rel="noopener" class="admin-link">Entra</a>`
- Supported portals: Entra ID, Intune, Defender, Teams Admin, SharePoint Admin
- URL generators in `data-relationships.js`: `getUserAdminUrls()`, `getDeviceAdminUrls()`, `getGroupAdminUrls()`

### 8. Utility Scripts

- `Install-Prerequisites.ps1`: Graph module setup and checks
- `scripts/Schedule-Collection.ps1`: Scheduled task creation
- `tools/Invoke-DeviceReport.ps1`: Per-device HTML report generation

## Design Principles

- Local-first and read-only
- Config-driven behavior
- Graceful degradation on partial failures
- Framework-free dashboard for portability
- Unified UX patterns across all pages (filtering, navigation, admin links)

## Error Handling and Resilience

- Collectors use retry logic and handle throttling
- Failures write empty JSON structures to keep UI stable
- Detailed errors stored in `collection-metadata.json`

## Performance Considerations

- Use of Graph `-All` and pagination handling
- 5-second pauses between collectors
- Report-based endpoints to avoid N+1 calls where possible
- Dashboard loads all data once and renders from memory
- O(1) cross-entity lookups via pre-built index maps

## Extension Points

To add a new collector:
1. Create `collectors/Get-*.ps1` using shared helpers.
2. Add it to the collector list in `Invoke-DataCollection.ps1`.
3. Add a new data type to the dashboard loader and page modules.

To add a new dashboard page:
1. Create `dashboard/js/page-newpage.js` following the page module pattern.
2. Add to `pages` registry in `app.js`.
3. Add navigation link in `index.html`.
4. Include filter bar, column selector, entity links, and admin links following established patterns.

## Last Updated

Architecture Version: 1.4
Last Updated: February 10, 2026
