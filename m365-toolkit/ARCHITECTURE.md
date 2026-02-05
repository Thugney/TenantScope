# TenantScope Architecture Documentation

## Overview

TenantScope is a PowerShell-based data collection and dashboard system for Microsoft 365 tenant security and lifecycle management. The architecture follows a modular, local-first approach with clear separation between data collection, processing, and presentation layers.

## System Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA COLLECTION LAYER                     │
│  PowerShell Scripts (Microsoft Graph API)                    │
│                                                              │
│  Invoke-DataCollection.ps1 (Orchestrator)                    │
│       │                                                     │
│       ├─ Get-UserData.ps1                                   │
│       ├─ Get-LicenseData.ps1                                │
│       ├─ Get-GuestData.ps1                                  │
│       ├─ Get-MFAData.ps1                                    │
│       ├─ Get-AdminRoleData.ps1                              │
│       ├─ Get-SignInData.ps1                                 │
│       ├─ Get-DeviceData.ps1                                 │
│       ├─ Get-AutopilotData.ps1                              │
│       ├─ Get-DefenderData.ps1                               │
│       ├─ Get-EnterpriseAppData.ps1                          │
│       ├─ Get-AuditLogData.ps1                               │
│       ├─ Get-PIMData.ps1                                    │
│       ├─ Get-TeamsData.ps1                                  │
│       └─ Get-SharePointData.ps1                             │
│                                                              │
│  Output: JSON files in data/ directory                       │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA PROCESSING LAYER                     │
│  Cross-referencing and Metadata Generation                   │
│                                                              │
│  • MFA status merged into user records                      │
│  • Admin role flags added to users                          │
│  • Collection metadata generated                            │
│  • Summary statistics computed                              │
│                                                              │
│  Output: Enhanced JSON files + collection-metadata.json      │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  Static HTML Dashboard (Vanilla JavaScript)                  │
│                                                              │
│  • Single-page application with hash routing                │
│  • Central data store (DataLoader module)                   │
│  • Page-based architecture (12 pages)                       │
│  • Pure SVG charts (no external dependencies)               │
│  • CSV export functionality                                 │
│  • Responsive design with CSS custom properties             │
│                                                              │
│  Build process: scripts/Build-Dashboard.ps1                  │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Orchestrator Script (`Invoke-DataCollection.ps1`)

**Purpose**: Main entry point that coordinates the entire data collection process.

**Key Functions**:
- Configuration loading and validation
- Microsoft Graph authentication with delegated permissions
- Collector script orchestration (sequential execution)
- Cross-referencing data (MFA → users, admin roles → users)
- Metadata generation and summary statistics
- Error handling and retry logic

**Authentication Flow**:
1. Loads `config.json` with tenant ID
2. Connects to Microsoft Graph with required scopes (delegated permissions)
3. Uses interactive sign-in for security
4. Validates connection and permissions

**Error Handling**:
- Individual collector failures don't break entire pipeline
- Exponential backoff retry for Graph API throttling (5 retries, 60s base)
- Graceful degradation when data sources unavailable

### 2. Collector Scripts (`collectors/*.ps1`)

**Common Pattern**: All collectors follow the same structure:
1. Accept `-Config` and `-OutputPath` parameters
2. Use `Invoke-GraphWithRetry` helper for API calls
3. Transform Graph API responses to standardized JSON schema
4. Return success/failure status with count and errors

**Data Types Collected**:

| Collector | Graph API Endpoints | Key Data Collected |
|-----------|-------------------|-------------------|
| Get-UserData | `/users` | User profiles, sign-in activity, licenses |
| Get-LicenseData | `/subscribedSkus` | SKU details, assigned counts |
| Get-GuestData | `/users` (filtered) | External users, invitation status |
| Get-MFAData | Reports API | MFA registration status |
| Get-AdminRoleData | `/directoryRoles` | Role definitions and members |
| Get-SignInData | `/auditLogs/signIns` | Risky sign-ins, risk detections |
| Get-DeviceData | `/deviceManagement/managedDevices` | Intune devices, compliance |
| Get-AutopilotData | `/deviceManagement/windowsAutopilotDeviceIdentities` | Autopilot enrollment |
| Get-DefenderData | Security API | Security alerts, incidents |
| Get-EnterpriseAppData | `/servicePrincipals` | Application permissions, usage |
| Get-AuditLogData | `/auditLogs/directoryAudits` | Administrative activity |
| Get-PIMData | `/roleManagement/directory` | PIM activations, assignments |
| Get-TeamsData | `/groups` (filtered) | Microsoft Teams, membership |
| Get-SharePointData | `/sites` | SharePoint sites, storage, activity |

### 3. Configuration System (`config.json`)

**Structure**:
```json
{
  "tenantId": "guid",
  "domains": {
    "employees": "@company.com",
    "students": "@students.company.com"
  },
  "thresholds": {
    "inactiveDays": 90,
    "staleGuestDays": 60,
    "staleDeviceDays": 90,
    "inactiveTeamDays": 90,
    "inactiveSiteDays": 90,
    "highStorageThresholdGB": 20
  },
  "collection": {
    "signInLogDays": 30,
    "defenderAlertDays": 30,
    "auditLogDays": 30,
    "pimActivityDays": 30
  },
  "dashboard": {
    "title": "TenantScope",
    "subtitle": "M365 Tenant Dashboard"
  }
}
```

**Validation**: All required fields are validated before collection begins.

### 4. Data Storage Format

**Location**: `data/` directory (gitignored for security)

**File Structure**:
- `users.json` - Array of user objects with standardized schema
- `license-skus.json` - SKU allocation data
- `guests.json` - External user accounts
- `mfa-status.json` - MFA registration status
- `admin-roles.json` - Directory role assignments
- `risky-signins.json` - Sign-in risk events
- `devices.json` - Intune device inventory
- `autopilot.json` - Windows Autopilot devices
- `defender-alerts.json` - Security alerts
- `enterprise-apps.json` - Service principal data
- `audit-logs.json` - Directory audit logs
- `pim-activity.json` - Privileged Identity Management activity
- `teams.json` - Microsoft Teams data
- `sharepoint-sites.json` - SharePoint site inventory
- `collection-metadata.json` - Collection metadata and summary

**Schema Consistency**: All data files use consistent field naming (camelCase) and ISO 8601 date formatting.

### 5. Dashboard Architecture (`dashboard/`)

**Technology Stack**:
- **HTML5**: Semantic markup, accessibility features
- **CSS3**: CSS Custom Properties (design tokens), responsive grid
- **Vanilla JavaScript**: No frameworks, module pattern with IIFE
- **SVG**: Pure SVG charts (no external charting libraries)
- **System Font Stack**: No external font dependencies

**Module Structure**:

| File | Purpose |
|------|---------|
| `index.html` | Main HTML with navigation structure |
| `css/style.css` | Single stylesheet with design tokens |
| `js/app.js` | Application controller, routing |
| `js/data-loader.js` | Central data store, loading logic |
| `js/dashboard-charts.js` | SVG donut chart renderer |
| `js/filters.js` | Table filtering utilities |
| `js/tables.js` | Table rendering and sorting |
| `js/export.js` | CSV export functionality |
| `js/page-*.js` | Page-specific rendering (12 pages) |

**Data Loading Strategy**:
1. **Bundled Data**: `data-bundle.js` generated by `Build-Dashboard.ps1` (bypasses CORS)
2. **HTTP Fallback**: Individual JSON file fetching for HTTP servers
3. **Central Store**: `DataLoader` module provides unified data access

**Routing**: Hash-based routing (`#overview`, `#users`, etc.) with page registry system.

### 6. Build System (`scripts/Build-Dashboard.ps1`)

**Functions**:
1. Copies JSON data files to `dashboard/data/`
2. Generates `data-bundle.js` with all data embedded
3. Optionally opens dashboard in browser
4. Supports sample data mode for testing

**Data Bundle Generation**:
```javascript
// data-bundle.js
window.__M365_DATA = {
  users: [...],
  devices: [...],
  // ... all data types
};
```

### 7. Utility Scripts

**`Install-Prerequisites.ps1`**:
- Installs Microsoft Graph PowerShell SDK modules
- Creates required directories
- Verifies PowerShell version (7.0+)

**`Schedule-Collection.ps1`**:
- Creates Windows Scheduled Tasks for automated collection
- Supports daily/weekly schedules
- Configurable execution time

**`tools/Invoke-DeviceReport.ps1`**:
- Generates per-device HTML reports
- Operational tool for helpdesk scenarios

## Design Principles

### 1. Local-First Architecture
- All data stored locally as JSON files
- No cloud dependencies for dashboard
- No external services or APIs required

### 2. Security by Design
- Delegated permissions only (no application permissions)
- Data stays on-premises (`data/` gitignored)
- All operations are read-only
- No secrets in configuration

### 3. Graceful Degradation
- Individual collector failures don't break pipeline
- Missing licensing features handled gracefully
- Empty JSON files created for failed collectors
- Dashboard works with partial data

### 4. Config-Driven Behavior
- All tenant-specific settings in `config.json`
- No hardcoded values in collector scripts
- Thresholds configurable per deployment

### 5. Framework-Free Dashboard
- No npm/node_modules dependencies
- Pure vanilla JavaScript
- System font stack for performance
- SVG charts instead of charting libraries

## Data Flow Details

### Collection Phase
1. **Configuration**: Load and validate `config.json`
2. **Authentication**: Connect to Microsoft Graph with delegated permissions
3. **Parallel Collection**: Run collectors sequentially (with 5s pauses)
4. **Data Transformation**: Convert Graph API responses to standardized JSON
5. **Cross-Referencing**: Merge MFA and admin flags into user records
6. **Metadata Generation**: Create `collection-metadata.json` with summary stats

### Processing Phase
1. **Data Copying**: `Build-Dashboard.ps1` copies JSON files to dashboard directory
2. **Bundle Generation**: Create `data-bundle.js` with embedded data
3. **CORS Bypass**: Bundle approach avoids file:// CORS restrictions

### Presentation Phase
1. **Initialization**: `DataLoader.loadAll()` loads data from bundle or HTTP
2. **Routing**: Hash change detection loads appropriate page module
3. **Rendering**: Page module renders tables, charts, metrics
4. **Interactivity**: Filtering, sorting, export functionality

## Error Handling Strategy

### PowerShell Layer
- `try/catch` blocks around all Graph API calls
- `Invoke-GraphWithRetry` with exponential backoff
- Collector status tracking in metadata
- Empty JSON files created on failure

### JavaScript Layer
- `try/catch` around data loading
- Graceful fallback messages
- Data validation before rendering
- Console logging for debugging

### User Experience
- Loading overlay during data fetch
- Error states with recovery instructions
- Partial data rendering when possible

## Performance Considerations

### Collection Optimization
- Graph API property selection (only needed fields)
- Pagination handling with `-All` parameter
- 5-second pauses between collectors
- Exponential backoff for throttling

### Dashboard Performance
- Central data store (single load)
- Virtual DOM pattern for table updates
- Debounced filtering
- SVG charts (lightweight, no dependencies)

### Memory Management
- JSON streaming for large datasets
- Progressive rendering for tables
- Cleanup of event listeners

## Extension Points

### Adding New Collectors
1. Create new `.ps1` file in `collectors/` directory
2. Follow established pattern (parameters, return format)
3. Add to collector list in `Invoke-DataCollection.ps1`
4. Add data type to `DataLoader` module
5. Create page module if new dashboard page needed

### Customizing Dashboard
1. Modify `config.json` for tenant-specific settings
2. Update `css/style.css` for branding
3. Add new page modules following established pattern
4. Extend `DataLoader` for new data types

### Integration Opportunities
1. **Web Server**: Host dashboard on IIS/Apache
2. **Data Pipeline**: Process JSON files with other tools
3. **Monitoring**: Integrate with SIEM/SOAR platforms
4. **Reporting**: Generate PDF reports from data

## Deployment Scenarios

### Single Administrator
- Local execution on admin workstation
- Manual or scheduled collection
- Dashboard opened locally

### Team Deployment
- Central data collection server
- Shared dashboard via web server
- Role-based access control at web server level

### Enterprise Integration
- Data exported to data warehouse
- Integration with existing monitoring tools
- Automated alerting based on thresholds

## Security Considerations

### Authentication & Authorization
- Delegated permissions (user context)
- Requires admin account with appropriate roles
- No persistent credentials stored

### Data Protection
- Data stored locally only
- `data/` directory excluded from version control
- No sensitive data in dashboard (only metadata)

### Operational Security
- All operations are read-only
- No modification of tenant configuration
- Audit logging of collection activities

## Licensing Requirements

### Microsoft 365 Licenses
- **Entra ID P1/P2**: Required for sign-in activity and risk detections
- **Microsoft Defender**: Required for security alerts
- **Intune**: Required for device management data
- **Azure AD Premium**: Required for PIM activity

### Feature Availability
| Feature | Minimum License |
|---------|----------------|
| User sign-in activity | Entra ID P1 |
| Risk detections | Entra ID P2 |
| MFA registration reports | Entra ID P1 |
| Device compliance | Intune |
| Security alerts | Microsoft Defender |
| PIM activity | Azure AD Premium P2 |

## Troubleshooting Architecture

### Common Issues
1. **Authentication Failures**: Verify admin roles and permissions
2. **Missing Data**: Check licensing requirements
3. **Throttling**: Automatic retry handles most cases
4. **Dashboard Errors**: Check browser console for details

### Diagnostic Tools
- `collection-metadata.json`: Detailed collection results
- Console logs: JavaScript debugging information
- PowerShell transcript: Enable with `Start-Transcript`

### Recovery Procedures
1. **Partial Failure**: Individual collectors can be re-run
2. **Data Corruption**: Delete `data/` directory and re-collect
3. **Dashboard Issues**: Re-run `Build-Dashboard.ps1`

## Future Architecture Considerations

### Scalability
- Support for multi-tenant collection
- Database backend for large datasets
- API-based data access

### Enhanced Features
- Real-time data updates via Graph webhooks
- Advanced analytics and machine learning
- Integration with ITSM platforms

### Platform Expansion
- macOS/Linux support for collection
- Mobile-responsive dashboard enhancements
- Progressive Web App capabilities

---

*Last Updated: February 2026*
*Architecture Version: 1.0*