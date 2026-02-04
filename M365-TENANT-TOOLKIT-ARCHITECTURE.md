# M365 Tenant Toolkit — Full Architecture Document

## CRITICAL INSTRUCTIONS FOR AI CODING ASSISTANT

**READ THIS BEFORE WRITING ANY CODE.**

1. **EVERY FILE MUST CONTAIN COMPLETE, WORKING, PRODUCTION-READY CODE.** Do NOT create empty files, placeholder files, stub functions, skeleton code, or files with TODO/FIXME comments. If a file exists, it must be fully implemented and functional. If you cannot complete a file in one pass, continue until it is done.

2. **EVERY FILE must start with this author header:**
```
# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================
```
For HTML/CSS/JS files use comment syntax `<!-- -->` or `/* */` or `//` accordingly.

3. **EVERY function must have detailed comments** explaining:
   - What the function does (purpose)
   - What parameters it accepts
   - What it returns
   - Any Graph API endpoints it calls
   - Any error handling behavior
   - Example usage where helpful

4. **Inline comments are mandatory** on any logic that is not immediately obvious: API calls, data transformations, filtering logic, error handling, pagination, retry logic, etc.

5. **DO NOT skip steps.** Build each file completely before moving to the next. When the build order says "Get-UserData.ps1", that means write the ENTIRE working collector with all Graph API calls, pagination, error handling, data transformation, and JSON output.

6. **Generate sample data files** in `data/sample/` with realistic test data (~50 records each) so the dashboard can be tested without a live tenant.

7. **Test your code mentally.** Before finishing a file, trace through the logic. Would this actually run? Would the Graph API calls work? Would the HTML render correctly? Would the JavaScript filter and sort properly?

---

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
├── data/sample/                         # Sample JSON data for testing dashboard
│   ├── users.json                       # ~50 sample users across both domains
│   ├── license-skus.json               # ~10 sample SKUs with realistic numbers
│   ├── guests.json                     # ~20 sample guests, mix of active/stale
│   ├── risky-signins.json             # ~15 sample risky sign-ins
│   ├── mfa-status.json                # MFA status matching sample users
│   ├── admin-roles.json               # ~5 roles with sample members
│   ├── devices.json                   # ~30 sample devices
│   ├── autopilot.json                 # ~15 sample Autopilot devices
│   ├── defender-alerts.json           # ~10 sample alerts across severities
│   └── collection-metadata.json       # Sample metadata with timestamp
│
├── dashboard/                           # Static HTML dashboard
│   ├── index.html                       # Main entry point + navigation shell
│   ├── css/
│   │   └── style.css                    # Single stylesheet — ALL styles here
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
│   └── data/                           # JSON files copied here by Build-Dashboard.ps1
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

**This collector MUST be fully implemented with working Graph API calls.**

**Graph endpoint:** `GET /users`

**Select properties:**
```
id, displayName, userPrincipalName, mail, accountEnabled, createdDateTime,
lastPasswordChangeDateTime, userType, department, jobTitle, companyName,
onPremisesSyncEnabled, assignedLicenses, signInActivity
```

**Important:** `signInActivity` requires `AuditLog.Read.All` scope and returns `lastSignInDateTime` and `lastNonInteractiveSignInDateTime`.

**Implementation requirements:**
- Use `Get-MgUser -All -Property $selectProperties` for pagination
- Handle null signInActivity gracefully (tenant may lack P1/P2)
- Classify each user by domain: check UPN suffix against config.json domains
- Calculate `daysSinceLastSignIn` from signInActivity.lastSignInDateTime
- Flag inactive based on config threshold
- Write progress to console: "Collecting users... [count] retrieved"
- Wrap in try/catch, return error details if failed
- Output clean JSON array to data/users.json

**PowerShell implementation pattern (follow this pattern for ALL collectors):**
```powershell
# ============================================================================
# M365 Tenant Toolkit
# Author: Robe (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects all user accounts from Microsoft Entra ID via Graph API.

.DESCRIPTION
    Retrieves every user in the tenant with key properties including sign-in
    activity, license assignments, and account status. Classifies users by
    domain (employee vs student) and flags inactive accounts.

    Graph API endpoint: GET /users
    Required scope: User.Read.All, AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json containing tenant
    settings, domain mappings, and threshold values.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes users.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of users collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-UserData.ps1 -Config $config -OutputPath ".\data\users.json"
#>
param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

# ... FULL IMPLEMENTATION HERE — not stubs, not placeholders ...
```

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

**Implementation requirements:**
- Call `Get-MgSubscribedSku -All` to get all SKUs
- Map SKU GUIDs to friendly names using a built-in lookup hashtable
- Cross-reference with users.json to count: assigned to enabled, assigned to disabled, assigned to inactive
- Calculate waste counts and utilization percentage
- The SKU name mapping hashtable MUST include at minimum these SKU part numbers with their friendly names:

```powershell
# SKU friendly name mapping — MUST be included in the script
$skuNameMap = @{
    "SPE_E3"                    = "Microsoft 365 E3"
    "SPE_E5"                    = "Microsoft 365 E5"
    "SPE_F1"                    = "Microsoft 365 F1"
    "ENTERPRISEPACK"            = "Office 365 E3"
    "ENTERPRISEPREMIUM"         = "Office 365 E5"
    "M365EDU_A1"                = "Microsoft 365 A1 for students"
    "M365EDU_A3_STUUSEBNFT"     = "Microsoft 365 A3 for students"
    "M365EDU_A3_FACULTY"        = "Microsoft 365 A3 for faculty"
    "M365EDU_A5_STUUSEBNFT"     = "Microsoft 365 A5 for students"
    "M365EDU_A5_FACULTY"        = "Microsoft 365 A5 for faculty"
    "STANDARDWOFFPACK_STUDENT"  = "Office 365 A1 for students"
    "STANDARDWOFFPACK_FACULTY"  = "Office 365 A1 for faculty"
    "OFFICESUBSCRIPTION_STUDENT"= "Office 365 ProPlus for students"
    "EXCHANGESTANDARD"          = "Exchange Online Plan 1"
    "EXCHANGEENTERPRISE"        = "Exchange Online Plan 2"
    "POWER_BI_PRO"              = "Power BI Pro"
    "POWER_BI_PREMIUM_PER_USER" = "Power BI Premium Per User"
    "TEAMS_EXPLORATORY"         = "Microsoft Teams Exploratory"
    "FLOW_FREE"                 = "Power Automate Free"
    "POWERAPPS_VIRAL"           = "Power Apps Trial"
    "PROJECTPREMIUM"            = "Project Plan 5"
    "PROJECTPROFESSIONAL"       = "Project Plan 3"
    "VISIOCLIENT"               = "Visio Plan 2"
    "WIN10_PRO_ENT_SUB"         = "Windows 10/11 Enterprise E3"
    "WIN10_VDA_E5"              = "Windows 10/11 Enterprise E5"
    "MDATP_XPLAT"               = "Microsoft Defender for Endpoint P2"
    "ATP_ENTERPRISE"            = "Microsoft Defender for Office 365 P1"
    "THREAT_INTELLIGENCE"       = "Microsoft Defender for Office 365 P2"
    "INTUNE_A"                  = "Microsoft Intune Plan 1"
    "AAD_PREMIUM"               = "Entra ID P1"
    "AAD_PREMIUM_P2"            = "Entra ID P2"
    "EMSPREMIUM"                = "Enterprise Mobility + Security E5"
    "EMS"                       = "Enterprise Mobility + Security E3"
    "DESKLESSPACK"              = "Office 365 F3"
    "SMB_BUSINESS_PREMIUM"      = "Microsoft 365 Business Premium"
    "SMB_BUSINESS"              = "Microsoft 365 Apps for Business"
    "O365_BUSINESS_ESSENTIALS"  = "Microsoft 365 Business Basic"
    "STREAM"                    = "Microsoft Stream"
    "MCOEV"                     = "Microsoft Teams Phone Standard"
    "PHONESYSTEM_VIRTUALUSER"   = "Microsoft Teams Phone Resource Account"
    "MEETING_ROOM"              = "Microsoft Teams Rooms Standard"
}
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

**Implementation requirements:**
- Use `Get-MgUser -Filter "userType eq 'Guest'" -All -Property $props`
- Calculate days since last sign-in
- Flag stale guests (no sign-in within `thresholds.staleGuestDays`)
- Flag guests who never accepted invitation (`externalUserState != 'Accepted'`)
- Extract source domain from mail address (split on @)
- Handle null signInActivity gracefully

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

**Implementation requirements:**
- Use `Get-MgReportAuthenticationMethodUserRegistrationDetail -All`
- For each user, extract: isMfaRegistered, isMfaCapable, methodsRegistered, defaultMfaMethod
- This endpoint may require Reports.Read.All scope
- Handle gracefully if endpoint is not available

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

**Implementation requirements:**
- Use `Get-MgDirectoryRole -All` to get active roles
- For each role, use `Get-MgDirectoryRoleMember -DirectoryRoleId $role.Id -All`
- Define high-privilege roles list in script
- Cross-reference members with user data for activity status

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
- `GET /identityProtection/riskyUsers` — users flagged as risky
- `GET /identityProtection/riskDetections` — individual risk events

**Implementation requirements:**
- Use `Get-MgRiskyUser -All` for risky users
- Use `Get-MgRiskDetection -All -Filter "detectedDateTime ge $startDate"` for risk events
- Categorize by risk level: high, medium, low
- Handle Entra ID P2 requirement gracefully
- Filter risk detections to configured date range

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

**Implementation requirements:**
- Use `Get-MgDeviceManagementManagedDevice -All`
- Calculate days since last sync, flag stale devices
- Categorize by OS, ownership, compliance
- Handle missing Intune data gracefully

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

### Get-AutopilotData.ps1

**Graph endpoint:** `GET /deviceManagement/windowsAutopilotDeviceIdentities`

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

**Graph endpoints:** `GET /security/alerts_v2`

**Implementation requirements:**
- Try `Get-MgSecurityAlert` first, fall back to `Invoke-MgGraphRequest`
- Categorize by severity and status
- Filter to configured date range
- Handle missing Defender license gracefully

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

---

## Phase 4: Lifecycle Management

Read-only reporting — computed in the dashboard from existing collected data. No additional collectors needed.

**Offboarding issues:** Disabled accounts with licenses, disabled with admin roles, inactive > 90 days still enabled.
**Onboarding gaps:** Created in last 30 days with no sign-in, no MFA, or no licenses.
**Role hygiene:** Inactive admins, admins without MFA.
**Guest cleanup:** Never accepted invitations, stale guests.

---

## Data Collection Flow

### Invoke-DataCollection.ps1

**MUST be fully implemented as the main orchestrator.**

```
1. Load config.json, validate required fields
2. Define all required Graph scopes
3. Connect-MgGraph with scopes and TenantId
4. Create data/ directory if not exists
5. Initialize metadata object with start timestamp
6. Run each collector in try/catch, track success/fail/count
7. Cross-reference: merge MFA flags into users.json
8. Cross-reference: merge admin role flags into users.json
9. Write collection-metadata.json
10. Disconnect-MgGraph
11. Print summary table to console
12. Offer to open dashboard
```

### Error Handling Pattern

```powershell
try {
    Write-Host "  Collecting [data type]..." -ForegroundColor Cyan
    # ... Graph API calls ...
    $results | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8
    Write-Host "  ✓ Collected $($results.Count) [items]" -ForegroundColor Green
    return @{ Success = $true; Count = $results.Count; Errors = @() }
}
catch {
    Write-Host "  ✗ Failed: $($_.Exception.Message)" -ForegroundColor Red
    "[]" | Set-Content -Path $OutputPath -Encoding UTF8
    return @{ Success = $false; Count = 0; Errors = @($_.Exception.Message) }
}
```

### Graph API Retry Logic (MUST be included)

```powershell
function Invoke-GraphWithRetry {
    param(
        [scriptblock]$ScriptBlock,
        [int]$MaxRetries = 3,
        [int]$DefaultBackoffSeconds = 30
    )
    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try { return & $ScriptBlock }
        catch {
            if ($_.Exception.Message -match "429|throttl") {
                $attempt++
                if ($attempt -gt $MaxRetries) { throw }
                $wait = $DefaultBackoffSeconds * $attempt
                Write-Host "    Throttled. Waiting ${wait}s (attempt $attempt/$MaxRetries)..." -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
            } else { throw }
        }
    }
}
```

---

## Dashboard Design

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  M365 Tenant Toolkit — Modum Kommune     Last run: date  │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  Overview  │   [Active Page Content]                     │
│  Users     │   ┌─ Filter Bar ─────────────────────────┐  │
│  Licenses  │   │ Search | Domain | Status | Flags     │  │
│  Guests    │   └──────────────────────────────────────┘  │
│  Security  │   ┌─ Summary Cards ──────────────────────┐  │
│  Devices   │   │ Card 1 │ Card 2 │ Card 3 │ Card 4   │  │
│  Lifecycle │   └──────────────────────────────────────┘  │
│            │   ┌─ Data Table ─────────────────────────┐  │
│            │   │ Sortable, paginated, expandable rows  │  │
│            │   │ CSV export button                     │  │
│            │   └──────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────┘
```

### Design Principles

- **No CSS frameworks, no JS frameworks** — vanilla everything
- **Light theme, high contrast** — work tool, not marketing
- **System font stack** — `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Colors:** Background `#f5f5f5`/`#ffffff`, Text `#1a1a1a`/`#666`, Sidebar `#1e293b`, Critical `#dc2626`, Warning `#f59e0b`, Good `#16a34a`, Neutral `#6b7280`, Accent `#2563eb`
- **No charts** — numbers, cards, tables
- **Every table:** sortable, paginated (50 rows), CSV export, expandable rows
- **Every page:** relevant filter bar
- **Desktop optimized**

### Pages — Full Specifications

**Overview:** Summary cards in 3 rows (users, risk, licenses/devices). Each card clickable to navigate to detail page.

**Users:** Filters: search, domain dropdown, status, flags checkboxes, department. Table: Name, UPN, Domain, Status, Dept, Last Sign-In, Days Inactive, MFA, Licenses, Flags. Row expansion shows full details.

**Licenses:** Filters: search, waste toggle. Summary cards: total SKUs, purchased, assigned, waste. Table: Name, Part Number, Purchased, Assigned, Available, Waste (disabled), Waste (inactive), Utilization %. Color-coded utilization. Row expansion shows assigned users.

**Guests:** Filters: search, status, source domain. Summary cards: total, active, stale, never signed in, pending. Table: Name, Email, Source Domain, Invited, Last Sign-In, Days Inactive, Status.

**Security:** Four sections each with own table: (1) Risky Sign-ins by severity, (2) Admin Roles with member counts, (3) MFA Gaps showing users without MFA, (4) Defender Alerts by severity.

**Devices:** Filters: search, OS, compliance, ownership, status. Summary cards: total, compliant/non-compliant, stale, unencrypted. Table: Device, User, OS, Version, Compliance, Last Sync, Days Since Sync, Ownership, Encrypted.

**Lifecycle:** Four sections: (1) Offboarding Issues, (2) Onboarding Gaps, (3) Role Hygiene, (4) Guest Cleanup. Each with explanatory subtitle and action-oriented table.

### Dashboard Technical Details

**data-loader.js:** Loads all JSON from dashboard/data/ via fetch. Stores in global state object. Shows loading spinner. Handles missing files gracefully.

**app.js:** Hash-based routing (#overview, #users, etc). Default #overview. Sidebar active state. Supports URL filter params.

**filters.js:** Generic engine. Text search (debounced 300ms), dropdowns, multi-select. AND logic. Filter state in URL.

**tables.js:** Generic renderer. Column definitions with formatters. Sort on header click. Pagination 50/page. Row expansion. Sticky header. Stripe rows.

**export.js:** CSV export of current filtered view. Proper escaping. Auto-filename with date.

---

## Known Limitations

1. Sign-in activity requires Entra ID P1/P2 — handle null gracefully
2. Risky sign-ins require P2 — show info message if unavailable
3. Sign-in logs retained 30 days only
4. Graph throttling — retry logic mandatory
5. Intune data only for managed devices
6. Read-only — no tenant modifications
7. Point-in-time snapshot — run regularly via scheduled task
8. Unknown SKUs fall back to part number display

---

## Build Order

**EVERY FILE = COMPLETE WORKING CODE. Author header + detailed comments on all.**

### Step 1: Scaffolding + sample data
- Directory structure, config.json, Install-Prerequisites.ps1, .gitignore
- ALL sample data files in data/sample/ with realistic Norwegian test data

### Step 2: PowerShell collectors
- Invoke-DataCollection.ps1 (full orchestrator)
- All collectors: Get-UserData, Get-LicenseData, Get-GuestData, Get-MFAData, Get-AdminRoleData, Get-SignInData, Get-DeviceData, Get-AutopilotData, Get-DefenderData

### Step 3: Dashboard shell
- index.html, style.css (ALL styles), app.js, data-loader.js, filters.js, tables.js, export.js

### Step 4: Dashboard pages
- page-overview.js, page-users.js, page-licenses.js, page-guests.js, page-security.js, page-devices.js, page-lifecycle.js

### Step 5: Finishing
- Build-Dashboard.ps1 (with -UseSampleData switch), Schedule-Collection.ps1, README.md

### Step 6: Verify
- Open dashboard with sample data, test every page, fix issues

---

## Sample Data Requirements

**users.json (~50 users):** 30 employees, 15 students, 5 other. Norwegian names. Mix of departments. 5 disabled, 8 inactive, 6 no MFA, 3 admins, 2 new accounts.

**guests.json (~20):** 5 active, 7 stale, 4 never signed in, 4 pending invitation.

**license-skus.json (~10):** Mix education + standard. 2+ with significant waste. Utilization 40%-95%.

**devices.json (~30):** 20 Windows, 5 iOS, 3 Android, 2 macOS. 22 compliant, 5 non-compliant, 3 unknown. 4 stale.

**defender-alerts.json (~10):** 2 high, 3 medium, 3 low, 2 informational. Mix of statuses.

All dates relative to today. Realistic data that produces meaningful dashboard views.
