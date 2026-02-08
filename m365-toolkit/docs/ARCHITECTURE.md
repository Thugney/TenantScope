# TenantScope Architecture

This document describes the technical architecture of TenantScope, a Microsoft 365 tenant dashboard that collects data via Microsoft Graph API and presents it in a browser-based dashboard.

## System Overview

```
+------------------+     +------------------+     +------------------+
|   Microsoft 365  |     |   PowerShell     |     |    Dashboard     |
|   Graph API      | --> |   Collectors     | --> |    (Browser)     |
+------------------+     +------------------+     +------------------+
        |                        |                        |
        v                        v                        v
  Authentication           JSON Files              Vanilla JS SPA
  (Interactive/App)        (data/*.json)           (Static HTML)
```

## Architecture Layers

### Layer 1: Data Collection (PowerShell)

The collection layer uses PowerShell 7+ with Microsoft Graph SDK modules to extract tenant data.

**Entry Point:** `Invoke-DataCollection.ps1`

This orchestrator script:
1. Loads and validates `config.json`
2. Connects to Microsoft Graph with required permissions
3. Runs all data collectors in sequence
4. Cross-references data (MFA and admin flags into users)
5. Generates collection metadata and trend history
6. Optionally triggers the build process

### Layer 2: Build Process (PowerShell)

**Entry Point:** `scripts/Build-Dashboard.ps1`

The build script:
1. Copies JSON files from `data/` to `dashboard/data/`
2. Generates `dashboard/js/data-bundle.js` - a JavaScript file that embeds all JSON data as a global `window.__M365_DATA` object
3. Optionally opens the dashboard in the default browser

The data bundle approach solves CORS issues when opening the dashboard directly via `file://` protocol (no web server required).

### Layer 3: Dashboard (Browser)

**Entry Point:** `dashboard/index.html`

A vanilla JavaScript single-page application with:
- No build step or framework dependencies
- Hash-based routing (`#overview`, `#users`, etc.)
- Modular page components
- Responsive design with mobile support

---

## Data Flow

```
DATA COLLECTION
===============

Invoke-DataCollection.ps1
       |
       +---> Connect-MgGraph (authenticate)
       |
       +---> collectors/Get-UserData.ps1    ---> data/users.json
       +---> collectors/Get-DeviceData.ps1  ---> data/devices.json
       +---> collectors/Get-MFAData.ps1     ---> data/mfa-status.json
       +---> collectors/Get-*.ps1           ---> data/*.json
       |
       +---> Cross-reference step:
       |      - Merge MFA flags into users.json
       |      - Merge admin role flags into users.json
       |
       +---> Generate collection-metadata.json


BUILD PROCESS
=============

scripts/Build-Dashboard.ps1
       |
       +---> Copy data/*.json to dashboard/data/
       |
       +---> Generate dashboard/js/data-bundle.js
              +---------------------------------------------+
              | window.__M365_DATA = {                      |
              |   users: [...],                             |
              |   devices: [...],                           |
              |   licenseSkus: [...],                       |
              |   ...                                       |
              | };                                          |
              +---------------------------------------------+


DASHBOARD RUNTIME
=================

Browser loads index.html
       |
       +---> data-bundle.js (embedded JSON data)
       +---> data-loader.js (DataLoader module)
       +---> data-relationships.js (cross-entity lookups)
       +---> app.js (routing, initialization)
       +---> page-*.js (page modules)

DataLoader.loadAll()
       |
       +---> Check window.__M365_DATA (bundled data)
       +---> Fallback: fetch JSON files via HTTP
       +---> Populate DataStore object

DataRelationships.buildIndexes()
       |
       +---> Build O(1) lookup maps:
            - userIndex[userId] -> user
            - deviceIndex[deviceId] -> device
            - teamIndex[teamId] -> team
            - etc.

app.js renders page based on URL hash
```

---

## File Structure

```
m365-toolkit/
|-- Invoke-DataCollection.ps1    # Main entry point for data collection
|-- config.json                  # Tenant configuration (thresholds, domains)
|-- Install-Prerequisites.ps1    # Module installation helper
|
|-- lib/
|   +-- CollectorBase.ps1        # Shared utilities for all collectors
|                                 # - Graph API retry logic
|                                 # - Date calculations
|                                 # - Domain classification
|                                 # - Standardized result objects
|
|-- collectors/                  # Individual data collectors
|   |-- Get-UserData.ps1         # Users from Entra ID
|   |-- Get-DeviceData.ps1       # Intune managed devices
|   |-- Get-MFAData.ps1          # MFA registration status
|   |-- Get-LicenseData.ps1      # License SKUs and assignments
|   |-- Get-GuestData.ps1        # Guest users
|   |-- Get-AdminRoleData.ps1    # Directory role memberships
|   |-- Get-SignInLogs.ps1       # Sign-in audit logs
|   |-- Get-DefenderData.ps1     # Defender alerts
|   |-- Get-TeamsData.ps1        # Teams with owners/members
|   |-- Get-SharePointData.ps1   # SharePoint sites
|   +-- ... (30+ collectors)
|
|-- scripts/
|   |-- Build-Dashboard.ps1      # Build dashboard data bundle
|   |-- Start-DashboardServer.ps1 # Optional HTTP server
|   +-- Schedule-Collection.ps1   # Task scheduler helper
|
|-- data/                        # Collected JSON data (gitignored)
|   |-- users.json
|   |-- devices.json
|   |-- collection-metadata.json
|   +-- ...
|
|-- dashboard/                   # Static dashboard files
|   |-- index.html               # SPA entry point
|   |-- css/
|   |   +-- style.css            # All styles (no preprocessor)
|   |-- data/                    # Copied from data/ by build
|   |   +-- ...
|   +-- js/
|       |-- data-bundle.js       # Generated: embedded JSON data
|       |-- data-loader.js       # Data loading and caching
|       |-- data-relationships.js # Cross-entity lookups
|       |-- app.js               # Main app controller, routing
|       |-- tables.js            # Reusable table component
|       |-- filters.js           # Search and filter utilities
|       |-- dashboard-charts.js  # Chart rendering (Chart.js)
|       |-- toast.js             # Notification system
|       |-- global-search.js     # Ctrl+K universal search
|       +-- page-*.js            # Page-specific modules
|
+-- docs/
    |-- ARCHITECTURE.md          # This file
    |-- USAGE.md                 # User guide
    +-- CLAUDE.md                # AI assistant context
```

---

## Collector Architecture

### CollectorBase.ps1

All collectors share common functionality via `lib/CollectorBase.ps1`:

```powershell
# Each collector imports the shared library
. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# Key shared functions:
Invoke-GraphWithRetry      # Exponential backoff for throttling (429)
Get-DaysSinceDate          # Calculate days since a date
Get-DomainClassification   # Classify user by UPN domain
New-CollectorResult        # Standardized return object
Save-CollectorData         # Write JSON with error handling
```

### Collector Pattern

Each collector follows this pattern:

```powershell
#Requires -Version 7.0
param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

try {
    # 1. Query Graph API with retry logic
    $data = Invoke-GraphWithRetry -ScriptBlock {
        Get-MgUser -All -Property "id,displayName,..."
    } -OperationName "User retrieval"

    # 2. Transform data into schema
    $processed = foreach ($item in $data) {
        [PSCustomObject]@{
            id = $item.Id
            displayName = $item.DisplayName
            # ... mapped properties
        }
    }

    # 3. Save to JSON
    Save-CollectorData -Data $processed -OutputPath $OutputPath

    # 4. Return standardized result
    return New-CollectorResult -Success $true -Count $processed.Count
}
catch {
    return New-CollectorResult -Success $false -Count 0 -Errors @($_.Exception.Message)
}
```

### Available Collectors

| Collector | Output File | Description |
|-----------|-------------|-------------|
| Get-UserData | users.json | All member users with activity |
| Get-DeviceData | devices.json | Intune managed devices |
| Get-LicenseData | license-skus.json | License SKUs with costs |
| Get-GuestData | guests.json | Guest users |
| Get-MFAData | mfa-status.json | MFA registration status |
| Get-AdminRoleData | admin-roles.json | Directory role members |
| Get-SignInLogs | signin-logs.json | Sign-in audit logs |
| Get-DefenderData | defender-alerts.json | Security alerts |
| Get-ConditionalAccessData | conditional-access.json | CA policies |
| Get-TeamsData | teams.json | Teams with ownership |
| Get-SharePointData | sharepoint-sites.json | SharePoint sites |
| Get-CompliancePolicies | compliance-policies.json | Intune compliance policies |
| Get-ConfigurationProfiles | configuration-profiles.json | Intune config profiles |
| Get-WindowsUpdateStatus | windows-update-status.json | WUfB status |
| Get-BitLockerStatus | bitlocker-status.json | Encryption status |
| Get-EndpointAnalytics | endpoint-analytics.json | Device health scores |
| Get-VulnerabilityData | vulnerabilities.json | Defender vulnerabilities |
| Get-IdentityRiskData | identity-risk-data.json | Risky users/detections |
| Get-OAuthConsentGrants | oauth-consent-grants.json | OAuth app consents |
| Get-PIMData | pim-activity.json | Privileged role activations |
| Get-SecureScoreData | secure-score.json | Microsoft Secure Score |
| Get-ASRRules | asr-rules.json | Attack Surface Reduction rules |
| Get-ServiceAnnouncementData | service-announcements.json | Message Center items |
| Get-RetentionData | retention-data.json | Retention policies |
| Get-eDiscoveryData | ediscovery-data.json | eDiscovery cases |
| Get-SensitivityLabelsData | sensitivity-labels-data.json | Sensitivity labels |
| Get-AccessReviewData | access-review-data.json | Access reviews |

---

## Dashboard Architecture

### Module Loading Order

Scripts are loaded in dependency order in `index.html`:

```
data-bundle.js          # 1. Embedded JSON data (generated)
data-loader.js          # 2. DataLoader: loads data into memory
data-relationships.js   # 3. DataRelationships: cross-entity lookups
toast.js                # 4. Notification system
dashboard-charts.js     # 5. Chart utilities
filters.js              # 6. Filter utilities
tables.js               # 7. Table component
page-*.js               # 8. Page modules
app.js                  # 9. Main app (runs last, initializes everything)
```

### DataLoader Module

Central data access layer:

```javascript
const DataLoader = {
    // Load all data from bundle or fetch
    loadAll: async function() {
        if (window.__M365_DATA) {
            // Use embedded data (file:// friendly)
            Object.keys(dataStore).forEach(key => {
                dataStore[key] = window.__M365_DATA[key];
            });
        } else {
            // Fetch JSON files (HTTP server required)
            await Promise.all(Object.entries(dataFiles).map(
                async ([key, path]) => dataStore[key] = await fetchJSON(path)
            ));
        }
    },

    // Get data by type
    getData: function(type) {
        return dataStore[type] || [];
    },

    // Get collection metadata
    getMetadata: function() {
        return dataStore.metadata;
    },

    // Get computed summary stats
    getSummary: function() {
        // Computes counts from raw data
    }
};
```

### DataRelationships Module

Provides O(1) cross-entity lookups using index maps:

```javascript
const DataRelationships = {
    // Index maps built on first access
    userIndex: {},          // userId -> user object
    userUpnIndex: {},       // userPrincipalName -> user
    deviceIndex: {},        // deviceId -> device
    deviceNameIndex: {},    // deviceName -> device
    teamIndex: {},          // teamId -> team
    siteIndex: {},          // siteId -> SharePoint site

    // Build indexes from DataStore
    buildIndexes: function() {
        users.forEach(u => {
            userIndex[u.id] = u;
            userUpnIndex[u.userPrincipalName.toLowerCase()] = u;
        });
        // ... similar for devices, teams, sites
    },

    // User profile with all related data
    getUserProfile: function(userId) {
        return {
            user: userIndex[userId],
            devices: getUserDevices(userId),
            signIns: getUserSignIns(userId),
            risks: getUserRisks(userId),
            adminRoles: getUserAdminRoles(userId),
            mfa: getUserMfaDetails(userId),
            teams: getUserTeams(userId),
            licenses: getUserLicenseDetails(userId)
        };
    },

    // Device profile with all related data
    getDeviceProfile: function(deviceId) {
        return {
            device: deviceIndex[deviceId],
            primaryUser: getDeviceUser(device),
            vulnerabilities: getDeviceVulnerabilities(device.deviceName),
            bitlocker: getDeviceBitLocker(device),
            windowsUpdate: getDeviceWindowsUpdate(device),
            configProfiles: getDeviceConfigProfiles(device),
            appDeployments: getDeviceApps(device)
        };
    },

    // Admin portal URL generators
    getUserAdminUrls: function(user) {
        return {
            entra: 'https://entra.microsoft.com/.../' + user.id,
            defender: 'https://security.microsoft.com/users/' + user.id,
            pim: 'https://entra.microsoft.com/...'
        };
    }
};
```

### Page Module Pattern

Each page follows this pattern:

```javascript
const PageUsers = {
    render: function(container) {
        // 1. Create page structure using DOM methods
        var header = document.createElement('div');
        header.className = 'page-header';
        // ... build DOM structure

        // 2. Get data
        const users = DataLoader.getData('users');

        // 3. Render stats cards
        this.renderStats(users);

        // 4. Render table with filters
        this.renderTable(users);
    },

    renderStats: function(users) {
        // Compute and display summary stats
    },

    renderTable: function(users) {
        // Use Tables module for consistent UI
        Tables.render({
            containerId: 'users-table-container',
            data: users,
            columns: [...],
            searchable: true,
            exportable: true
        });
    }
};
```

### Routing

Hash-based routing handled by `app.js`:

```javascript
const pages = {
    'overview': PageOverview,
    'users': PageUsers,
    'devices': PageDevices,
    // ... all page modules
};

function renderCurrentPage() {
    const pageName = window.location.hash.slice(1) || 'overview';
    const page = pages[pageName];
    page.render(document.getElementById('page-container'));
}

window.addEventListener('hashchange', renderCurrentPage);
```

---

## Authentication

### Interactive Mode (Default)

Used for manual execution:

```powershell
.\Invoke-DataCollection.ps1
```

1. Prompts user to sign in via browser
2. Uses delegated permissions
3. Requires user with appropriate Graph API permissions

### App-Only with Certificate (Recommended for Automation)

Used for scheduled tasks:

```powershell
.\Invoke-DataCollection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -CertificateThumbprint "ABC123..."
```

1. Uses app registration with certificate
2. Uses application permissions (not delegated)
3. Requires admin consent for app permissions

### App-Only with Client Secret

Less secure alternative:

```powershell
.\Invoke-DataCollection.ps1 `
    -ClientId "00000000-0000-0000-0000-000000000000" `
    -ClientSecret "your-secret"
```

### Required Graph API Permissions

Interactive (Delegated):
- User.Read.All
- Directory.Read.All
- AuditLog.Read.All
- Reports.Read.All
- ServiceMessage.Read.All
- ServiceHealth.Read.All
- DeviceManagementManagedDevices.Read.All
- DeviceManagementConfiguration.Read.All
- DeviceManagementApps.Read.All
- SecurityEvents.Read.All
- IdentityRiskyUser.Read.All
- IdentityRiskEvent.Read.All
- RoleManagement.Read.Directory
- RoleAssignmentSchedule.Read.Directory
- RoleEligibilitySchedule.Read.Directory
- Application.Read.All
- Policy.Read.All
- Team.ReadBasic.All
- Channel.ReadBasic.All
- TeamMember.Read.All
- Sites.Read.All
- BitLockerKey.Read.All
- DelegatedPermissionGrant.ReadWrite.All
- RecordsManagement.Read.All
- eDiscovery.Read.All
- InformationProtectionPolicy.Read
- AccessReview.Read.All

App-Only (Application):
- Same scopes but as Application type
- Requires admin consent

---

## Configuration

### config.json

```json
{
  "tenantId": "00000000-0000-0000-0000-000000000000",
  "domains": {
    "employees": "@contoso.com",
    "students": "@students.contoso.com"
  },
  "thresholds": {
    "inactiveDays": 90,
    "staleGuestDays": 60,
    "staleDeviceDays": 90
  },
  "collection": {
    "signInLogDays": 30,
    "defenderAlertDays": 30,
    "auditLogDays": 30,
    "pimActivityDays": 30,
    "riskDetectionDays": 30
  },
  "dashboard": {
    "title": "TenantScope",
    "subtitle": "M365 Tenant Dashboard"
  }
}
```

| Field | Purpose |
|-------|---------|
| `tenantId` | Azure AD tenant GUID (required) |
| `domains.employees` | UPN suffix for employee classification |
| `domains.students` | UPN suffix for student classification |
| `thresholds.inactiveDays` | Days without sign-in to flag inactive |
| `thresholds.staleGuestDays` | Days to flag stale guests |
| `thresholds.staleDeviceDays` | Days to flag stale devices |
| `collection.*Days` | Lookback period for time-series data |

---

## Data Schema Examples

### User Object (users.json)

```json
{
  "id": "user-guid",
  "displayName": "John Doe",
  "userPrincipalName": "john@contoso.com",
  "mail": "john@contoso.com",
  "accountEnabled": true,
  "domain": "employee",
  "department": "Engineering",
  "jobTitle": "Developer",
  "manager": "Jane Smith",
  "managerId": "manager-guid",
  "lastSignIn": "2024-01-15T10:30:00Z",
  "daysSinceLastSignIn": 5,
  "isInactive": false,
  "mfaRegistered": true,
  "licenseCount": 2,
  "assignedSkuIds": ["sku-guid-1", "sku-guid-2"],
  "flags": ["admin"],
  "enrolledDevices": [
    {
      "deviceId": "device-guid",
      "deviceName": "LAPTOP-001",
      "operatingSystem": "Windows",
      "complianceState": "compliant"
    }
  ]
}
```

### Device Object (devices.json)

```json
{
  "id": "device-guid",
  "deviceName": "LAPTOP-001",
  "operatingSystem": "Windows",
  "osVersion": "10.0.22631.4890",
  "windowsType": "Windows 11",
  "windowsRelease": "23H2",
  "complianceState": "compliant",
  "enrolledDateTime": "2023-06-15T08:00:00Z",
  "lastSyncDateTime": "2024-01-20T14:30:00Z",
  "daysSinceLastSync": 2,
  "isStale": false,
  "userId": "user-guid",
  "userPrincipalName": "john@contoso.com",
  "isEncrypted": true,
  "autopilotEnrolled": true,
  "manufacturer": "Dell Inc.",
  "model": "Latitude 5520"
}
```

### Collection Metadata (collection-metadata.json)

```json
{
  "collectionId": "col-2024-01-22-143052",
  "startTime": "2024-01-22T14:30:52Z",
  "endTime": "2024-01-22T14:45:23Z",
  "durationSeconds": 871,
  "tenantId": "tenant-guid",
  "status": "completed",
  "collectors": [
    {
      "name": "Get-UserData",
      "success": true,
      "count": 1523,
      "durationSeconds": 45,
      "errors": []
    }
  ],
  "summary": {
    "totalUsers": 1523,
    "totalDevices": 892,
    "activeAlerts": 3
  },
  "thresholds": {
    "inactiveDays": 90
  }
}
```

---

## Performance Considerations

### Collection Layer

- **Throttling Handling:** All Graph calls use `Invoke-GraphWithRetry` with exponential backoff (60s base, doubles per retry)
- **Pagination:** Large result sets are automatically paginated
- **Delay Between Collectors:** 5-second pause between collectors to avoid throttling
- **Parallel Lookups:** User-device mapping is built once, not per-user

### Dashboard Layer

- **O(1) Lookups:** DataRelationships builds index maps for instant cross-entity lookups
- **Lazy Loading:** Indexes built on first access, not at load time
- **No Framework Overhead:** Vanilla JS with no virtual DOM or state management
- **Bundled Data:** All JSON embedded in single JS file, avoiding multiple HTTP requests

---

## Security Notes

- **No Secrets in Config:** Tenant ID is not sensitive; secrets should be passed as parameters
- **Certificate Preferred:** For automation, certificates are more secure than client secrets
- **Read-Only Access:** All Graph permissions are read-only
- **Local Dashboard:** Dashboard runs entirely in browser with no backend server
- **No Data Transmission:** Collected data stays local; no telemetry or cloud services

---

## Extension Points

### Adding a New Collector

1. Create `collectors/Get-NewData.ps1` following the collector pattern
2. Add to collector array in `Invoke-DataCollection.ps1`
3. Add data type to `dataFiles` map in `data-loader.js`
4. Add to `bundleMap` in `Build-Dashboard.ps1`

### Adding a New Dashboard Page

1. Create `dashboard/js/page-newpage.js` following page module pattern
2. Add to `pages` registry in `app.js`
3. Add navigation link in `index.html`
4. Add script tag in `index.html` (before `app.js`)

### Adding Cross-Entity Relationships

1. Add index map in `data-relationships.js` (e.g., `newIndex = {}`)
2. Populate in `buildIndexes()` function
3. Add lookup function (e.g., `getNewEntityProfile()`)
4. Export in public API
