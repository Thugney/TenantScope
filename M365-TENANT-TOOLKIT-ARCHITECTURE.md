# M365 Tenant Toolkit — Full Architecture Document

## Purpose

This document is the complete blueprint for building an internal IT admin toolkit for a Norwegian municipality (modum.kommune.no) running Microsoft 365 with thousands of users across two domains: `@modum.kommune.no` (employees) and `@skole.modum.kommune.no` (students/education). The toolkit collects data from Microsoft Graph API and presents it in a local HTML dashboard.

This document is intended to be read by an AI coding assistant (Claude CLI) and used as the sole reference for building the entire project from scratch.

---

## Project Overview

**Name:** m365-toolkit
**Runtime:** PowerShell 7 + Microsoft Graph PowerShell SDK
**Output:** Static HTML dashboard (vanilla HTML/CSS/JS, no frameworks)
**Data:** JSON files stored locally
**Auth:** Interactive login via Microsoft Graph (delegated permissions)
**Target user:** IT admin running this from their own workstation

---

## Project Structure

```
m365-toolkit/
├── README.md
├── config.json                          # Tenant-specific settings
├── Install-Prerequisites.ps1            # One-time setup script
├── Invoke-DataCollection.ps1            # Main entry point - runs all collectors
│
├── collectors/                          # PowerShell modules that fetch data from Graph
│   ├── Get-UserData.ps1                 # All user accounts + properties
│   ├── Get-LicenseData.ps1             # License assignments + SKU summary
│   ├── Get-GuestData.ps1               # Guest/external users
│   ├── Get-SignInData.ps1              # Sign-in logs + risky sign-ins
│   ├── Get-MFAData.ps1                 # MFA registration status
│   ├── Get-AdminRoleData.ps1           # Directory role assignments
│   ├── Get-DeviceData.ps1              # Intune managed devices
│   ├── Get-ComplianceData.ps1          # Device compliance status
│   ├── Get-AutopilotData.ps1           # Autopilot device info
│   ├── Get-DefenderData.ps1            # Defender alerts/incidents
│   └── Get-StaleAccountData.ps1        # Computed: inactive users + guests
│
├── data/                                # Collected JSON data (gitignored)
│   ├── users.json
│   ├── licenses.json
│   ├── license-skus.json
│   ├── guests.json
│   ├── signins.json
│   ├── risky-signins.json
│   ├── mfa-status.json
│   ├── admin-roles.json
│   ├── devices.json
│   ├── compliance.json
│   ├── autopilot.json
│   ├── defender-alerts.json
│   └── collection-metadata.json         # Timestamp, duration, errors
│
├── dashboard/                           # Static HTML dashboard
│   ├── index.html                       # Main entry point + navigation shell
│   ├── css/
│   │   └── style.css                    # Single stylesheet
│   ├── js/
│   │   ├── app.js                       # App init, navigation, shared state
│   │   ├── data-loader.js              # Loads JSON files into memory
│   │   ├── filters.js                  # Shared filter/search logic
│   │   ├── tables.js                   # Shared table rendering + sorting
│   │   ├── export.js                   # CSV export from any table
│   │   ├── page-overview.js            # Overview/summary page
│   │   ├── page-users.js              # Users page
│   │   ├── page-licenses.js           # Licenses page
│   │   ├── page-guests.js            # Guest accounts page
│   │   ├── page-security.js          # Security posture page
│   │   ├── page-devices.js           # Devices page
│   │   └── page-lifecycle.js          # Lifecycle management page
│   └── data/                           # Symlink or copy from ../data/
│
└── scripts/
    ├── Build-Dashboard.ps1             # Copies JSON to dashboard/data/ and opens browser
    └── Schedule-Collection.ps1          # Optional: sets up Windows Task Scheduler
```

---

## Configuration

### config.json

```json
{
  "tenantId": "your-tenant-id",
  "domains": {
    "employees": "@modum.kommune.no",
    "students": "@skole.modum.kommune.no"
  },
  "thresholds": {
    "inactiveDays": 90,
    "staleGuestDays": 60,
    "staleDeviceDays": 90
  },
  "collection": {
    "signInLogDays": 30,
    "defenderAlertDays": 30
  },
  "dashboard": {
    "title": "M365 Tenant Toolkit",
    "subtitle": "Modum Kommune"
  }
}
```

---

## Authentication & Graph Permissions

### Connection Method

Use `Connect-MgGraph` with interactive sign-in. The admin running this tool signs in with their own account. No app registration required for initial use (uses the Microsoft Graph Command Line Tools enterprise app).

```powershell
Connect-MgGraph -Scopes $requiredScopes -TenantId $config.tenantId
```

### Required Graph Scopes (Delegated)

```
User.Read.All
Directory.Read.All
AuditLog.Read.All
Reports.Read.All
DeviceManagementManagedDevices.Read.All
DeviceManagementConfiguration.Read.All
SecurityEvents.Read.All
IdentityRiskyUser.Read.All
IdentityRiskEvent.Read.All
RoleManagement.Read.Directory
```

**Note:** The admin account needs at minimum Global Reader role in Entra ID. For Intune data, Intune Administrator or Intune Read-Only role is needed.

---

## Phase 1: Identity & License Insights

### Get-UserData.ps1

**Graph endpoint:** `GET /users`

**Select properties:**
```
id, displayName, userPrincipalName, mail, accountEnabled, createdDateTime,
lastPasswordChangeDateTime, userType, department, jobTitle, companyName,
onPremisesSyncEnabled, assignedLicenses, signInActivity
```

**Important:** `signInActivity` requires `AuditLog.Read.All` scope and returns `lastSignInDateTime` and `lastNonInteractiveSignInDateTime`.

**Processing:**
- Classify each user by domain: employee (`@modum.kommune.no`), student (`@skole`), or other
- Flag inactive: no sign-in within `thresholds.inactiveDays`
- Flag disabled: `accountEnabled == false`
- Compute account age from `createdDateTime`

**Pagination:** Use `-All` parameter on `Get-MgUser` to handle thousands of users. Process in batches if memory is a concern.

**Output schema (users.json):**
```json
[
  {
    "id": "guid",
    "displayName": "string",
    "userPrincipalName": "string",
    "mail": "string",
    "accountEnabled": true,
    "userType": "Member",
    "domain": "employee|student|other",
    "department": "string",
    "jobTitle": "string",
    "createdDateTime": "ISO8601",
    "lastSignIn": "ISO8601|null",
    "lastNonInteractiveSignIn": "ISO8601|null",
    "daysSinceLastSignIn": 45,
    "isInactive": false,
    "onPremSync": true,
    "licenseCount": 3,
    "mfaRegistered": true,
    "flags": ["inactive", "no-mfa", "disabled", "admin"]
  }
]
```

### Get-LicenseData.ps1

**Graph endpoints:**
- `GET /subscribedSkus` — all available SKUs in tenant
- User license data comes from Get-UserData (assignedLicenses property)

**Processing:**
- Map SKU GUIDs to friendly names (maintain a lookup table of common SKU IDs to names like "Microsoft 365 A3 for students", "Microsoft 365 E3", etc.)
- For each SKU: count total purchased, total assigned, assigned to disabled users, assigned to inactive users
- Calculate waste: licenses assigned to disabled + inactive users
- Calculate cost waste: multiply waste count by approximate monthly cost per license

**SKU name mapping — include at minimum:**
```
Microsoft 365 E3, E5, F1, F3
Microsoft 365 A1, A3, A5 (education)
Office 365 E1, E3, E5
Office 365 A1, A3 (education)
Exchange Online Plan 1, Plan 2
Power BI Pro, Power BI Premium Per User
Microsoft Teams Phone, Teams Rooms
Visio Plan 1, Plan 2
Project Plan 1, 3, 5
Windows 10/11 Enterprise E3, E5
Microsoft Defender for Endpoint P1, P2
Microsoft Defender for Office 365 P1, P2
Microsoft Intune Plan 1
Entra ID P1, P2
```

**Output schema (license-skus.json):**
```json
[
  {
    "skuId": "guid",
    "skuName": "Microsoft 365 A3 for students",
    "skuPartNumber": "M365EDU_A3_STUUSEBNFT",
    "totalPurchased": 5000,
    "totalAssigned": 4200,
    "assignedToEnabled": 3800,
    "assignedToDisabled": 250,
    "assignedToInactive": 150,
    "available": 800,
    "wasteCount": 400,
    "utilizationPercent": 84
  }
]
```

### Get-GuestData.ps1

**Graph endpoint:** `GET /users?$filter=userType eq 'Guest'`

**Select properties:**
```
id, displayName, mail, userPrincipalName, createdDateTime,
externalUserState, externalUserStateChangeDateTime, signInActivity
```

**Processing:**
- Calculate days since last sign-in
- Flag stale guests (no sign-in within `thresholds.staleGuestDays`)
- Flag guests who never accepted invitation (`externalUserState != 'Accepted'`)
- Extract source domain from mail/UPN

**Output schema (guests.json):**
```json
[
  {
    "id": "guid",
    "displayName": "string",
    "mail": "string",
    "sourceDomain": "external-company.com",
    "createdDateTime": "ISO8601",
    "invitationState": "Accepted|PendingAcceptance",
    "lastSignIn": "ISO8601|null",
    "daysSinceLastSignIn": 120,
    "isStale": true,
    "neverSignedIn": false
  }
]
```

### Get-MFAData.ps1

**Graph endpoint:** `GET /reports/authenticationMethods/userRegistrationDetails`

**Processing:**
- For each user, determine if they have registered MFA methods
- Flag users with NO MFA registered
- Track which methods are registered (Authenticator app, phone, FIDO2, etc.)

**Output schema (mfa-status.json):**
```json
[
  {
    "userId": "guid",
    "userPrincipalName": "string",
    "isMfaRegistered": true,
    "isMfaCapable": true,
    "methods": ["microsoftAuthenticatorPush", "mobilePhone"],
    "defaultMethod": "microsoftAuthenticatorPush"
  }
]
```

### Get-AdminRoleData.ps1

**Graph endpoint:** `GET /directoryRoles` then for each role `GET /directoryRoles/{id}/members`

**Processing:**
- List all active admin role assignments
- Flag high-privilege roles: Global Admin, Privileged Role Admin, Exchange Admin, SharePoint Admin, Intune Admin, Security Admin
- Cross-reference with user activity data to find inactive admins (highest risk)

**Output schema (admin-roles.json):**
```json
[
  {
    "roleId": "guid",
    "roleName": "Global Administrator",
    "isHighPrivilege": true,
    "members": [
      {
        "userId": "guid",
        "displayName": "string",
        "userPrincipalName": "string",
        "accountEnabled": true,
        "isInactive": false,
        "daysSinceLastSignIn": 5
      }
    ],
    "memberCount": 3
  }
]
```

### Get-SignInData.ps1

**Graph endpoints:**
- `GET /auditLogs/signIns` — recent sign-in logs (filtered by date range)
- `GET /identityProtection/riskyUsers` — users flagged as risky
- `GET /identityProtection/riskDetections` — individual risk events

**Processing for sign-ins:**
- Filter to last N days (from config)
- Aggregate by user: count of sign-ins, unique locations, unique apps
- Flag failures with error codes

**Processing for risky sign-ins:**
- Categorize by risk level: high, medium, low
- Include risk detail/detection type (unfamiliar sign-in, impossible travel, etc.)
- Include location data (city, country) when available

**Output schema (risky-signins.json):**
```json
[
  {
    "id": "guid",
    "userId": "guid",
    "userPrincipalName": "string",
    "riskLevel": "high|medium|low",
    "riskState": "atRisk|confirmedCompromised|remediated|dismissed",
    "riskDetail": "unfamiliarFeatures",
    "detectedDateTime": "ISO8601",
    "location": {
      "city": "string",
      "countryOrRegion": "string"
    },
    "ipAddress": "string",
    "appDisplayName": "string"
  }
]
```

---

## Phase 2: Device Health

### Get-DeviceData.ps1

**Graph endpoint:** `GET /deviceManagement/managedDevices`

**Select properties:**
```
id, deviceName, managedDeviceOwnerType, operatingSystem, osVersion,
complianceState, lastSyncDateTime, enrolledDateTime, manufacturer,
model, serialNumber, userPrincipalName, managementAgent,
deviceEnrollmentType, isEncrypted, autopilotEnrolled
```

**Processing:**
- Calculate days since last sync
- Flag stale devices (no sync within `thresholds.staleDeviceDays`)
- Categorize by OS (Windows, iOS, Android, macOS)
- Categorize by ownership (corporate vs personal)
- Group by compliance state

**Output schema (devices.json):**
```json
[
  {
    "id": "guid",
    "deviceName": "string",
    "userPrincipalName": "string",
    "os": "Windows",
    "osVersion": "10.0.22631.4890",
    "complianceState": "compliant|noncompliant|unknown",
    "lastSync": "ISO8601",
    "daysSinceSync": 5,
    "isStale": false,
    "enrolledDateTime": "ISO8601",
    "ownership": "corporate|personal",
    "manufacturer": "Lenovo",
    "model": "ThinkPad T14",
    "serialNumber": "string",
    "isEncrypted": true,
    "managementAgent": "mdm|easMdm|configManager"
  }
]
```

### Get-ComplianceData.ps1

**Graph endpoint:** `GET /deviceManagement/deviceCompliancePolicyStates` or aggregate from device data

**Processing:**
- Summary counts: compliant, non-compliant, in-grace-period, not-evaluated
- Break down non-compliance by reason/policy
- Group by OS type

**Output:** Aggregated into devices.json and summary in compliance.json

### Get-AutopilotData.ps1

**Graph endpoint:** `GET /deviceManagement/windowsAutopilotDeviceIdentities`

**Select properties:**
```
id, serialNumber, model, manufacturer, groupTag,
enrollmentState, lastContactedDateTime, deploymentProfileAssignmentStatus,
purchaseOrderIdentifier
```

**Output schema (autopilot.json):**
```json
[
  {
    "id": "guid",
    "serialNumber": "string",
    "model": "string",
    "manufacturer": "string",
    "groupTag": "string",
    "enrollmentState": "enrolled|notContacted|failed",
    "lastContacted": "ISO8601",
    "profileAssigned": true,
    "purchaseOrder": "string"
  }
]
```

---

## Phase 3: Security Posture

### Get-DefenderData.ps1

**Graph endpoints:**
- `GET /security/alerts_v2` — Defender alerts
- Filter to last N days from config

**Processing:**
- Categorize by severity: high, medium, low, informational
- Group by category (malware, phishing, suspicious activity, etc.)
- Group by status (new, inProgress, resolved)
- Include affected entities (user, device, mailbox)

**Output schema (defender-alerts.json):**
```json
[
  {
    "id": "guid",
    "title": "string",
    "severity": "high|medium|low|informational",
    "status": "new|inProgress|resolved",
    "category": "string",
    "createdDateTime": "ISO8601",
    "resolvedDateTime": "ISO8601|null",
    "affectedUser": "string|null",
    "affectedDevice": "string|null",
    "description": "string",
    "recommendedActions": "string"
  }
]
```

### Security Summary (computed in dashboard)

The security page in the dashboard computes a summary from all collected data:

- **Identity risks:** Users with no MFA, inactive admins, risky sign-ins by severity
- **Device risks:** Non-compliant devices, stale devices, unencrypted devices
- **Guest risks:** Stale guests, guests who never signed in
- **License risks:** Licenses on disabled accounts (indicator of incomplete offboarding)
- **Defender:** Active alerts grouped by severity

---

## Phase 4: Lifecycle Management

This phase is **read-only reporting** — it identifies lifecycle issues but does not automate changes. The dashboard surfaces actionable lists the admin can act on manually or build runbooks for.

### Lifecycle Views (computed in dashboard from existing data)

**Potential offboarding issues:**
- Disabled accounts that still have licenses assigned
- Disabled accounts that still have admin roles
- Accounts inactive > 90 days that are still enabled

**Onboarding gaps:**
- Accounts created in last 30 days with no sign-in (never used)
- Accounts created in last 30 days with no MFA registered
- Accounts with no licenses assigned

**Role hygiene:**
- Admin accounts that are inactive
- Users with admin roles who don't need them (surfaced for review)
- Accounts with admin roles but no MFA

**Guest lifecycle:**
- Guests who never accepted invitation
- Guests with no sign-in in 60+ days
- Guests from domains with many stale accounts (pattern detection)

---

## Dashboard Design

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  M365 Tenant Toolkit — Modum Kommune     Last run: date  │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  Overview  │   [Active Page Content]                     │
│            │                                             │
│  Users     │   ┌─ Filter Bar ─────────────────────────┐  │
│            │   │ Search | Domain | Status | Flags     │  │
│  Licenses  │   └──────────────────────────────────────┘  │
│            │                                             │
│  Guests    │   ┌─ Summary Cards ──────────────────────┐  │
│            │   │ Card 1 │ Card 2 │ Card 3 │ Card 4   │  │
│  Security  │   └──────────────────────────────────────┘  │
│            │                                             │
│  Devices   │   ┌─ Data Table ─────────────────────────┐  │
│            │   │ Sortable columns, paginated           │  │
│  Lifecycle │   │ Click-to-expand row details           │  │
│            │   │ CSV export button                     │  │
│            │   └──────────────────────────────────────┘  │
│            │                                             │
└────────────┴─────────────────────────────────────────────┘
```

### Design Principles

- **No CSS frameworks, no JS frameworks** — vanilla everything
- **Light theme, high contrast** — this is a work tool, not a marketing site
- **System font stack** — `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Color palette:**
  - Background: `#f5f5f5` (page), `#ffffff` (cards/tables)
  - Text: `#1a1a1a` (primary), `#666666` (secondary)
  - Sidebar: `#1e293b` (dark), `#f8fafc` (text on dark)
  - Status colors: `#dc2626` (critical/high), `#f59e0b` (warning/medium), `#16a34a` (good/low), `#6b7280` (neutral)
  - Accent: `#2563eb` (links, active states)
- **No charts or graphs** — use numbers, cards, and tables. Data is the visualization.
- **Every table is sortable** by clicking column headers
- **Every table has CSV export**
- **Every page has a filter bar** relevant to that page's data
- **Pagination** on tables with 50 rows per page for performance with thousands of records
- **Responsive** enough to work on a laptop screen but optimized for desktop

### Page: Overview

Summary cards showing key numbers at a glance:

Row 1 — User counts:
- Total users (split employee/student)
- Enabled / Disabled
- Inactive (no sign-in > 90 days)
- No MFA registered

Row 2 — Risk indicators:
- Risky sign-ins (count by severity: high/medium/low)
- Stale guest accounts
- Admin accounts count
- Inactive admins (critical flag)

Row 3 — License & Devices:
- Total license spend vs waste
- Non-compliant devices
- Stale devices
- Active Defender alerts by severity

Each card is clickable — navigates to the relevant detail page with appropriate filter pre-applied.

### Page: Users

**Filter bar:**
- Text search (name, UPN, department)
- Domain dropdown: All | Employees | Students
- Status dropdown: All | Enabled | Disabled
- Flags multi-select: Inactive | No MFA | Has Admin Role | No Licenses
- Department dropdown (populated from data)

**Table columns:**
Display Name | UPN | Domain | Status | Department | Last Sign-In | Days Inactive | MFA | Licenses | Flags

**Row expansion:** Click a row to see full detail: all assigned licenses, admin roles, sign-in history summary, account created date, on-prem sync status.

### Page: Licenses

**Filter bar:**
- Text search (SKU name)
- Type dropdown: All | Employee SKUs | Student SKUs | Add-ons
- Show waste: checkbox to highlight SKUs with waste > 0

**Top section — Summary cards:**
- Total SKUs in tenant
- Total licenses purchased
- Total assigned
- Total waste (disabled + inactive)

**Table columns:**
License Name | Purchased | Assigned | Available | Waste (disabled) | Waste (inactive) | Utilization %

**Row expansion:** Click to see list of users assigned this license, grouped by status (active, inactive, disabled). Each user row links to the Users page.

### Page: Guests

**Filter bar:**
- Text search (name, email, source domain)
- Status: All | Active | Stale | Never Signed In | Pending Invitation
- Source domain dropdown (populated from data)

**Summary cards:**
- Total guests
- Active guests
- Stale guests (no sign-in > 60 days)
- Never signed in
- Pending invitations

**Table columns:**
Display Name | Email | Source Domain | Invited | Last Sign-In | Days Inactive | Status

### Page: Security

**Layout:** This page is divided into sections, not a single table.

**Section: Risky Sign-ins**
- Filter by severity: High | Medium | Low
- Filter by risk state: At Risk | Confirmed Compromised | Remediated | Dismissed
- Table: User | Risk Level | Risk Type | Date | Location | IP | App
- Sorted by severity (high first) then date (newest first)

**Section: Admin Roles**
- Table: Role Name | Members | Inactive Members | Members Without MFA
- Row expansion shows member list with their activity status
- Critical highlight on rows where inactive members > 0 or members without MFA > 0

**Section: MFA Gaps**
- Filter by domain: All | Employees | Students
- Table: User | Domain | Status | Account Created | Last Sign-In | MFA Methods
- Only shows users WITHOUT MFA registered
- Sorted by risk: enabled + active first (most urgent)

**Section: Defender Alerts**
- Filter by severity: High | Medium | Low | Informational
- Filter by status: New | In Progress | Resolved
- Table: Title | Severity | Status | Category | Date | Affected Entity
- Sorted by severity then date
- Color-coded severity badges

### Page: Devices

**Filter bar:**
- Text search (device name, user, serial number)
- OS: All | Windows | iOS | Android | macOS
- Compliance: All | Compliant | Non-compliant | Unknown
- Ownership: All | Corporate | Personal
- Status: All | Active | Stale

**Summary cards:**
- Total managed devices
- Compliant / Non-compliant / Unknown
- Stale devices (no sync > 90 days)
- Unencrypted devices

**Table columns:**
Device Name | User | OS | Version | Compliance | Last Sync | Days Since Sync | Ownership | Encrypted

### Page: Lifecycle

**Layout:** Four sections with tables, each representing an action list.

**Section: Offboarding Issues**
Subtitle: "These accounts may not have been properly offboarded"
- Disabled accounts with licenses still assigned
- Disabled accounts with admin roles
- Accounts inactive > 90 days still enabled
- Table: User | Issue Type | Details | Last Sign-In | Days Inactive

**Section: Onboarding Gaps**
Subtitle: "Recently created accounts that may need attention"
- Created in last 30 days with no sign-in
- Created in last 30 days with no MFA
- Created with no licenses assigned
- Table: User | Issue Type | Created Date | Days Since Creation | Has Signed In | MFA Status

**Section: Role Hygiene**
Subtitle: "Admin role assignments that need review"
- Inactive admins
- Admins without MFA
- Table: User | Role | Last Sign-In | MFA Status | Risk Level

**Section: Guest Cleanup**
Subtitle: "Guest accounts that should be reviewed or removed"
- Never accepted invitation (> 14 days old)
- No sign-in in 60+ days
- Table: Guest | Source Domain | Invited | Last Sign-In | Status | Recommended Action

---

## Data Collection Flow

### Invoke-DataCollection.ps1 (Main Entry Point)

```
1. Load config.json
2. Connect-MgGraph with required scopes
3. Create data/ directory if not exists
4. Run each collector in sequence:
   a. Get-UserData          → data/users.json
   b. Get-LicenseData       → data/license-skus.json
   c. Get-GuestData         → data/guests.json
   d. Get-MFAData           → data/mfa-status.json
   e. Get-AdminRoleData     → data/admin-roles.json
   f. Get-SignInData         → data/risky-signins.json
   g. Get-DeviceData         → data/devices.json
   h. Get-ComplianceData     → data/compliance.json
   i. Get-AutopilotData      → data/autopilot.json
   j. Get-DefenderData       → data/defender-alerts.json
5. Cross-reference: Merge MFA status into users.json
6. Compute stale accounts data
7. Write collection-metadata.json with timestamp and stats
8. Disconnect-MgGraph
9. Run Build-Dashboard.ps1 to update dashboard
```

### Error Handling

Each collector should:
- Wrap in try/catch
- Log errors to collection-metadata.json (which collectors failed)
- Continue to next collector on failure (don't stop entire collection)
- Dashboard should show warning banner if any collector failed

### Performance Considerations

- Use `-All` pagination on Get-Mg* cmdlets for large result sets
- Use `-Select` to only request needed properties (reduces payload)
- Use `-Filter` server-side where possible instead of client-side Where-Object
- Sign-in logs can be large — filter by date server-side: `$filter=createdDateTime ge {date}`
- For thousands of users, the full collection may take 5-15 minutes — show progress in console
- Write progress to console: "Collecting users... 1500/4200" etc.

### Build-Dashboard.ps1

```
1. Copy all JSON files from data/ to dashboard/data/
2. Write a manifest.json listing available data files and collection timestamp
3. Open dashboard/index.html in default browser
```

---

## Dashboard Technical Details

### Data Loading (data-loader.js)

```javascript
// Load all JSON files listed in manifest
// Store in global state object
// Dashboard renders only after all data is loaded
// Show loading spinner during load

const state = {
  users: [],
  licenseSkus: [],
  guests: [],
  mfaStatus: [],
  adminRoles: [],
  riskySignins: [],
  devices: [],
  compliance: [],
  autopilot: [],
  defenderAlerts: [],
  metadata: {}
};
```

### Navigation (app.js)

- Sidebar links swap which page-*.js renders into the main content area
- Use hash-based routing: `#overview`, `#users`, `#licenses`, etc.
- Active sidebar item highlighted
- Support deep links: `#users?domain=employee&flags=inactive` to pre-apply filters

### Filter System (filters.js)

Generic filter engine that each page configures:
- Text search: filters across multiple fields (case-insensitive, substring match)
- Dropdown filters: exact match on a field value
- Multi-select filters: match any selected value
- All filters combine with AND logic
- Filter state preserved in URL hash for shareability
- Filter change triggers table re-render
- Show active filter count badge

### Table System (tables.js)

Generic table renderer:
- Accepts column definitions (label, field, sortable, formatter)
- Sorts by clicking column header (toggle asc/desc, show arrow indicator)
- Pagination: 50 rows per page, page controls at bottom
- Row click expands detail panel below the row
- Stripe alternate rows for readability
- Sticky header when scrolling

### Export (export.js)

- CSV export button on every table
- Exports current filtered/sorted view (not all data)
- Filename includes page name and date: `users-2026-02-04.csv`
- Handles commas and quotes in data properly

### Status Badges

Reusable CSS classes for status indicators:
```css
.badge { padding: 2px 8px; border-radius: 3px; font-size: 12px; font-weight: 600; }
.badge-critical { background: #fef2f2; color: #dc2626; }
.badge-warning { background: #fffbeb; color: #d97706; }
.badge-good { background: #f0fdf4; color: #16a34a; }
.badge-neutral { background: #f3f4f6; color: #6b7280; }
.badge-info { background: #eff6ff; color: #2563eb; }
```

---

## Known Limitations & Honest Notes

1. **Sign-in activity data** requires Entra ID P1 or P2 license. If the tenant doesn't have this, `signInActivity` on users will be null. The dashboard should handle this gracefully and show "N/A" instead of breaking.

2. **Risky sign-ins** require Entra ID P2. If not available, that section will be empty. Dashboard should show "Requires Entra ID P2" message.

3. **Sign-in logs** (`auditLogs/signIns`) are only retained for 30 days on P1 and 30 days on P2 (unless exported to Log Analytics). We can only see what Microsoft keeps.

4. **Graph API throttling** — Microsoft will throttle at ~2000 requests per 10 minutes. With thousands of users, batch where possible and add retry logic with exponential backoff on 429 responses.

5. **Device data** — Intune only reports on managed devices. BYOD devices not enrolled in Intune won't appear.

6. **This is read-only** — the toolkit collects and displays data. It does not modify anything in the tenant. This is intentional for safety. Action is taken by the admin in the portals.

7. **Data freshness** — this is a point-in-time snapshot, not a live dashboard. Run collection regularly (daily or weekly via scheduled task) for current data.

8. **Education SKUs** — student license names can be confusing. The SKU mapping table needs to cover A1/A3/A5 variants properly.

---

## Build Order for Claude CLI

Build in this order, testing each piece before moving on:

### Step 1: Project scaffolding
- Create directory structure
- Create config.json template
- Create Install-Prerequisites.ps1 (installs Microsoft.Graph PowerShell module)

### Step 2: Core collectors (Phase 1)
- Invoke-DataCollection.ps1 (main runner)
- Get-UserData.ps1
- Get-LicenseData.ps1
- Get-GuestData.ps1
- Get-MFAData.ps1
- Get-AdminRoleData.ps1
- Get-SignInData.ps1

### Step 3: Dashboard shell
- index.html with sidebar navigation
- style.css with full styling
- app.js with navigation routing
- data-loader.js
- filters.js (generic filter engine)
- tables.js (generic table renderer)
- export.js

### Step 4: Dashboard pages (Phase 1)
- page-overview.js
- page-users.js
- page-licenses.js
- page-guests.js
- page-security.js

### Step 5: Device collectors (Phase 2)
- Get-DeviceData.ps1
- Get-ComplianceData.ps1
- Get-AutopilotData.ps1

### Step 6: Dashboard pages (Phase 2+3+4)
- page-devices.js
- page-lifecycle.js

### Step 7: Defender + finishing
- Get-DefenderData.ps1
- Build-Dashboard.ps1
- Schedule-Collection.ps1
- README.md with full usage docs

---

## Testing Without Live Tenant

For development, create a `data/` folder with sample JSON files matching the schemas above. The dashboard should work entirely from static JSON files, so it can be developed and tested without any Graph API connection.

Claude CLI should generate realistic sample data files with ~50 records each for development. Include a mix of statuses, domains, and edge cases.
