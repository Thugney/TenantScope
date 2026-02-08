# Changelog

All notable changes to TenantScope will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-02-08

### Added
- **Single-Pane-of-Glass Cross-Entity Navigation**:
  - New `data-relationships.js` module providing O(1) lookups across all entity types
  - Index maps for users, devices, MFA status, teams, and SharePoint sites
  - `getUserProfile()` - returns user with devices, signIns, risks, adminRoles, mfa, teams, licenses
  - `getDeviceProfile()` - returns device with primaryUser, vulnerabilities, bitlocker, windowsUpdate, signIns
  - `getTeamProfile()` - returns team with sharePointSite, owners, guestCount

- **Enhanced User Detail Modal**:
  - Tabbed layout: Overview, Licenses, Security, Devices, Activity
  - Full license names with SKU details and assignment source (Direct/Group)
  - MFA methods list from mfa-status.json
  - Sign-in logs filtered by user (most recent 20)
  - Identity risk level and recent risk detections
  - Admin roles with role names
  - Owned devices with clickable navigation
  - Teams owned by user

- **Enhanced Device Detail Modal**:
  - Tabbed layout: Overview, Security, Compliance, User, Activity
  - BitLocker status (encrypted, recovery key escrowed, encryption method)
  - Windows Update status (ring, feature/quality updates, last scan)
  - Vulnerabilities affecting device with CVE, severity, CVSS, exploit status
  - Sign-in history from device
  - Primary user details with clickable link to user profile

- **Teams/SharePoint Bidirectional Navigation**:
  - Teams page: SharePoint site now clickable with site name and URL
  - Teams page: Owner UPNs now clickable to view user profiles
  - SharePoint page: Linked Team now clickable
  - SharePoint page: Site owner now clickable to view user profile

- **Enhanced Vulnerability Page**:
  - Device names in affected devices modal now clickable
  - User names now clickable to view user profiles
  - Compliance state shown with badges
  - "Details" button shows full device modal inline

- **Problem Summary Dashboard** (`page-problems.js`):
  - New page aggregating all critical issues across the tenant
  - Severity-prioritized view: Critical, High, Medium, Low
  - Issue categories: Devices, Identity, Collaboration, SharePoint, Security
  - Issues detected:
    - Non-compliant devices, unencrypted devices, stale devices
    - Unsupported Windows versions, expired certificates
    - Users without MFA, high-risk users
    - Admins without phishing-resistant MFA
    - Ownerless Teams, Teams with guests, inactive Teams
    - Sites with anonymous links, externally shared sites
    - Actively exploited CVEs, critical vulnerabilities
    - High/Medium/Low severity Defender alerts (active, non-resolved)
  - Each issue card shows count, sample items, recommended action, and navigation link
  - Added to navigation sidebar after Overview

- **Defender Alerts Integration**:
  - `getDeviceAlerts()` - Defender alerts affecting a specific device
  - `getUserAlerts()` - Defender alerts affecting a specific user
  - Device modal Security tab: Defender alerts table with severity, status, date
  - User modal Security tab: Defender alerts table with severity, status, date

- **Admin Portal Deep Links**:
  - `getDeviceAdminUrls()` - returns Intune and Entra ID device URLs
  - `getUserAdminUrls()` - returns Entra ID and Defender user URLs
  - Device modal: "Open in Intune" and "Open in Entra ID" buttons
  - User modal: "Open in Entra ID" and "Open in Defender" buttons

- **Conditional Access Policy Visibility**:
  - `getUserConditionalAccessPolicies()` - CA policies applying to a user
  - User modal Security tab: CA policies table showing policy name, requirements, effect
  - Matches policies by: includesAllUsers, includedRoleIds, excludedUserIds

- **Deep Data Integration (Phase 10)**:
  - `getDeviceAsrPolicies()` - ASR policies and deployed rules for managed Windows devices
  - `getDeviceAutopilot()` - Autopilot enrollment info matched by device serial number
  - `getUserOAuthConsents()` - OAuth app consent grants (admin + user-specific)
  - `getUserAuditLogs()` - Audit log entries where user was initiator or target
  - Device modal Overview tab: Autopilot Details showing deployment profile, group tag, enrollment state
  - Device modal Security tab: ASR Rules section (Windows only) showing deployed policies and rule coverage
  - User modal Security tab: OAuth App Consents table showing app name, publisher (verified badge), consent type, risk level
  - User modal Activity tab: Audit Logs table showing timestamp, activity, result, category

### Changed
- User and Device modals now use tabbed layouts for better organization
- Teams owners list now uses clickable links instead of plain text
- Vulnerability affected devices table enhanced with better formatting
- `PageDevices` now exports `showDeviceDetails` for cross-page device modal display

### Documentation
- Added `docs/REVIEW-FINDINGS-2026-02-08.md` - Original gap analysis from 5-agent review
- Added `docs/IMPLEMENTATION-LOG-2026-02-08.md` - Implementation checklist with all completed items

---

## [2.1.1] - 2026-02-08

### Added
- **Dashboard Server** (`Start-DashboardServer.ps1`):
  - Built-in HTTP server for multi-user shared deployments
  - Usage tracking: page views, sessions, user identity (Windows auth)
  - Admin-only usage statistics by default
  - Configurable via `-NoTracking`, `-PublicStats` switches
  - API endpoints: `/api/whoami`, `/api/usage`, `/api/config`, `/api/log`

- **Usage Tracker** (`usage-tracker.js`):
  - Frontend module for tracking dashboard usage in server mode
  - Permission-aware stats display (admin vs regular user)
  - Dashboard Usage section in Overview page (admin-only)

- **App-Only Authentication for Scheduled Tasks**:
  - Certificate-based authentication (`-CertificateThumbprint`) - recommended
  - Client secret authentication (`-ClientSecret`) - alternative
  - Full documentation for Azure AD app registration setup
  - Works with both `Invoke-DataCollection.ps1` and `Schedule-Collection.ps1`

### Changed
- Updated `config.sample.json` with `server.usageTracking` configuration section
- Updated `docs/USAGE.md` with Dashboard Server and App Registration documentation
- `Schedule-Collection.ps1` now warns if no credentials provided for unattended execution

---

## [2.1.0] - 2026-02-08

### Added
- **Vulnerability Management Page** (`page-vulnerabilities.js`):
  - Dedicated CVE tracking page with Overview, All CVEs, and Exploited tabs
  - Severity breakdown heatmap visualization
  - Priority vulnerabilities table for critical/exploited CVEs
  - Detailed vulnerability cards with CVSS scores, affected devices, patch status
  - Security insights with actionable remediation recommendations

- **Vulnerability Collector** (`Get-VulnerabilityData.ps1`):
  - Collects CVE data from Microsoft Defender for Endpoint TVM API
  - Supports Graph Security API and MDE API endpoints
  - Outputs severity, CVSS scores, exploit status, affected device counts
  - Requires Microsoft Defender for Endpoint P2 license

- **Security Cockpit** (Overview page):
  - Aggregated risk score from all security signals
  - Category cards showing health scores for Identity, OAuth, Devices, Compliance
  - Action items list with severity-sorted security issues
  - Quick navigation links to security-related pages
  - Vulnerability signals integrated into cockpit

- **Quick Access Tab** (Overview page):
  - Navigation shortcuts to key analysis views
  - Cards for Security, Cost, Compliance, Endpoint, Data Quality, Executive views
  - Quick links for common actions

- **Executive Summary Tab** (Overview page):
  - KPI grid with Secure Score, Compliance, MFA, Alerts, License Utilization, Risky Users
  - Tenant at-a-glance statistics
  - Status summary cards for Security, Compliance, Identity, Cost

- **New Security Pages**:
  - Identity Risk page (`page-identity-risk.js`) - risky users and sign-ins from Identity Protection
  - OAuth Consent page (`page-oauth-consent.js`) - app permissions and consent grants
  - Data Governance/Compliance page (`page-compliance.js`) - retention, eDiscovery, sensitivity labels, access reviews

- **New Collectors**:
  - `Get-IdentityRiskData.ps1` - Identity Protection risky users/detections
  - `Get-OAuthConsentGrants.ps1` - OAuth app permissions
  - `Get-AccessReviewData.ps1` - access review definitions and instances
  - `Get-RetentionData.ps1` - retention policies and labels
  - `Get-eDiscoveryData.ps1` - eDiscovery cases
  - `Get-SensitivityLabelsData.ps1` - sensitivity labels
  - `Get-NamedLocations.ps1` - named locations for CA policies
  - `Get-ServiceAnnouncementData.ps1` - Message Center and Service Health

- **Device Risk Scoring** (Devices page):
  - Composite risk score (0-100) based on compliance, encryption, OS, staleness
  - Risk Analysis tab with heatmap visualization
  - Risk tier classification (Critical, High, Medium, Low)

- **License Optimization Tab** (License Analysis page):
  - Waste detection and cost savings analysis
  - Recommendations for license reclamation

- **Data Quality Tab** (Users page):
  - Stale account detection (90+ days inactive)
  - Duplicate account identification
  - Naming convention issue detection
  - Sync error tracking
  - Missing data completeness checks

- **Sample Data**:
  - Added sample data files for all new collectors
  - vulnerabilities.json, identity-risk-data.json, oauth-consent-grants.json
  - access-review-data.json, retention-data.json, ediscovery-data.json
  - sensitivity-labels-data.json, named-locations.json, service-announcements.json

### Changed
- Overview page tabs reorganized: Overview, Security Cockpit, Executive Summary, Quick Access, Quick Stats
- Quick Access tab renamed from "Analysis Agents" with clearer navigation-focused labels
- Vulnerability signals in Security Cockpit now link to dedicated Vulnerabilities page

### Fixed
- Agent/Quick Access buttons now properly navigate using window.location.hash
- Fixed navigation routing for compliance page (was incorrectly mapped to non-existent access-reviews)
- Data Quality navigation now correctly points to data-quality page

---

## [2.0.6] - 2026-02-07

### Added
- Shared collector helpers for Graph property normalization, assignment target parsing, report CSV retrieval, and credential status.
- Collection metadata now includes thresholds and license overlap rules for UI alignment.
- Internal per-collector review documentation under `reviews/`.

### Fixed
- Devices summary schema alignment and breakdown map support; preserve unknown encryption state.
- ASR rules summary now counts settings catalog policies.
- Windows Update summary now includes drivers needing review and uses device compliance counts.
- SharePoint UI thresholds now respect configured metadata values.
- License Analysis now uses config-driven overlap rules via metadata.
- App sign-ins failure status reason no longer shows "Success" when error code is non-zero.
- Sign-in logs UI no longer over-normalizes collector outputs.

---

## [2.0.5] - 2026-02-07

### Added
- **Dashboard UI Overhaul - Unified Analytics Pattern**:
  - All major pages now follow consistent tab-based navigation with Overview and Data tabs
  - Overview tabs feature donut charts, analytics grids with mini-bars, and actionable insights
  - Data tabs have unified filterable tables with column selectors and CSV export

- **Overview Page Redesign**:
  - Tab navigation: Overview, Quick Stats
  - Tenant Health donut chart showing composite score (MFA + Compliance + Alerts)
  - Analytics grid: User Composition, Security Status, Device Status, License Status
  - Actionable insights for MFA gaps, compliance issues, alerts, license waste, secure score
  - Clickable insights navigate to relevant pages
  - Quick Stats tab retains original charts, license utilization, and activity panels

- **Identity Pages Redesign** (Users, Guests, Organization, Lifecycle):
  - Tab navigation: Overview, Analysis, All Data
  - Donut charts showing account status, risk levels, activity
  - Analytics grids with platform cards for quick insights
  - Insights section with recommendations and action items

- **Security Pages Redesign** (Audit Logs, Credential Expiry, PIM, Conditional Access):
  - Tab navigation: Overview, All Data
  - Donut charts for security status visualization
  - Analytics grids showing risk breakdowns and policy coverage
  - Insights for security issues and recommendations

- **Lifecycle Issues Tab Redesign**:
  - Replaced 6+ scrollable sections with single unified filterable table
  - Combines: Offboarding, Onboarding, Role Hygiene, Guest Cleanup, Teams, SharePoint issues
  - Filter bar: search, category, severity, entity type
  - Column selector for customizable table view
  - Colored badges for category, severity, and entity type

- **Licenses Page Redesign**:
  - Tab navigation: Overview, All Licenses
  - Donut chart showing Active Use, Wasted, Available licenses
  - Analytics grid: Cost Analysis, Waste Breakdown, SKU Status, Top Wasted SKUs
  - Insights for waste detection, overlaps, and low utilization

- **License Overlap Analysis Page Redesign**:
  - Tab navigation: Overview, All Overlaps
  - Donut chart showing Clean Users vs Users with Overlaps
  - Analytics grid: Overlaps by Rule, Top Departments, Cost Impact, Rules Analysis
  - Insights for cost optimization opportunities
  - Filter by overlap rule and department

- **Devices Page Enhancements**:
  - Added comprehensive Intune properties display
  - Enhanced device detail modal with full property listing

### Fixed
- Fixed CSS variable names (`var(--success)` → `var(--color-success)`) for donut chart colors
- Fixed "devices.filter is not a function" error with Array.isArray checks in getSummary
- Added missing bg-orange, bg-purple, bg-primary CSS classes for legend colors

---

## [2.0.4] - 2026-02-06

### Added
- **Compliance Policies Collector Enhancements**:
  - Per-device compliance status with failure details
  - Setting-level compliance status (which specific settings are failing)
  - Policy categorization (Security, Encryption, Password, OS Version, Device Health)
  - Critical policy identification (security policies or all-device assignments)
  - Generated insights: low compliance, critical policy issues, multi-policy failures, common settings
  - Platform breakdown summary
  - Nested data structure: `{policies, nonCompliantDevices, settingFailures, insights, summary}`

- **Compliance Policies Dashboard Enhancements**:
  - Tab-based navigation: Overview, Policies, Non-Compliant Devices, Setting Failures
  - Overview tab with compliance donut chart, platform breakdown, policy categories
  - Insights section showing compliance issues and recommendations
  - Critical policies needing attention section
  - Non-Compliant Devices tab showing devices failing multiple policies
  - Setting Failures tab showing which settings are commonly failing
  - Enhanced policy detail modal with failing settings table
  - Category filter added to policies tab

- **Configuration Profiles Collector Enhancements**:
  - Per-device deployment status with failure details
  - Setting-level failures (which specific settings are failing)
  - Profile categorization (Security, Network, General, Kiosk, etc.)
  - Assignment tracking (groups, all users, all devices)
  - Generated insights: low-success profiles, profile conflicts, multi-profile failures, security profile errors, pending deployments
  - Platform and type breakdown summary
  - Nested data structure: `{profiles, failedDevices, settingFailures, insights, summary}`

- **Configuration Profiles Dashboard Enhancements**:
  - Tab-based navigation: Overview, Profiles, Failed Devices, Setting Failures
  - Overview tab with deployment donut chart, platform breakdown, profile types
  - Insights section showing deployment issues and recommendations
  - Profiles needing attention section
  - Failed Devices tab showing devices failing multiple profiles
  - Setting Failures tab showing which settings are commonly failing
  - Enhanced profile detail modal with device issues and setting failures
  - Category filter added to profiles tab

---

## [2.0.3] - 2026-02-06

### Added
- **Windows Update Collector Enhancements**:
  - Quality updates now include classification (Security, Critical), expedited status, and deployment progress
  - Driver updates now pull full driver inventories with manufacturer, version, approval status
  - Added device compliance collection showing per-device update status
  - New summary fields: expeditedUpdates, securityUpdates, totalDriverPolicies

- **Endpoint Analytics Collector Enhancements**:
  - Added model insights computation (aggregates devices by model with avg scores and recommendations)
  - Added actionable insights generation (poor health, slow startup, problem apps, blue screens)
  - App reliability now includes trend indicators (Improving, Stable, Degrading)
  - New summary fields: modelsWithIssues, problemApps

- **Windows Update Page Enhancements**:
  - Added Driver Updates tab with approval status, manufacturer, version, and deployment progress
  - Enhanced Quality Updates display with classification badges (Security, Critical), progress percentage
  - Overview now shows Quality Updates and Driver Updates sections with summary statistics
  - Quality updates show expedited status for critical security patches

- **Endpoint Analytics Page Enhancements**:
  - Added Actionable Insights section showing critical issues and recommendations
  - Model Comparison now shows recommendations for each device model
  - App Reliability shows trend indicators (Improving, Stable, Degrading)
  - Enhanced problem apps section with health scores and MTTF data

- **Enhanced Sample Data**:
  - Windows Update: 5 update rings, 3 quality updates (2 expedited), 4 driver updates, device compliance records
  - Endpoint Analytics: 25 devices with multiple per model for meaningful comparison, 10 apps, 7 model insights, 4 actionable insights

---

## [2.0.2] - 2026-02-06

### Fixed
- **Comprehensive sample data rewrite** - All 9 new sample data files now match collector output:
  - All files use proper nested structure ({data: [], summary: {}, collectionDate})
  - Rich data with all fields collectors actually produce
  - Realistic sample values for testing/demo

- **Dashboard pages now handle field name differences**:
  - `page-compliance-policies.js`: Maps compliantDevices → compliantCount, etc.
  - `page-configuration-profiles.js`: Maps successDevices → successCount, etc.
  - `page-app-deployments.js`: Maps installedDevices → installedCount, successRate → installRate
  - `page-endpoint-analytics.js`: Enhanced to merge deviceScores with devicePerformance data
  - `page-signin-logs.js`: Normalizes status and builds location from city/country
  - `page-asr-rules.js`: Derives mode from blockCount/auditCount fields
  - `page-credential-expiry.js`: Already handled nested application structure

### Added
- Sample data now includes comprehensive fields for endpoint admin visibility:
  - compliance-policies.json: Added errorDevices, conflictDevices, notApplicableDevices, assignments
  - configuration-profiles.json: Added conflictDevices, pendingDevices, successRate, hasConflicts
  - app-deployments.json: Added assignments, version, platform, notInstalledDevices, hasFailures
  - endpoint-analytics.json: Added devicePerformance, appReliability, overview sections
  - signin-logs.json: Added deviceDetail, mfaDetail, riskState, riskDetail, errorCode
  - asr-rules.json: Added policies array with detailed ASR rule configurations
  - service-principal-secrets.json: Added full application details with secrets/certificates arrays

---

## [2.0.1] - 2026-02-06

### Fixed
- Added missing `Filters.setup()` function - all new dashboard pages now work correctly
- Fixed `ColumnSelector.create()` API usage in new pages
- Fixed escaped characters (`\!==`) in JavaScript files from PowerShell heredocs
- Corrected sample data field names to match dashboard page expectations:
  - `configuration-profiles.json`: `successDevices` → `successCount`, `errorDevices` → `errorCount`
  - `bitlocker-status.json`: `hasRecoveryKey` → `recoveryKeyEscrowed`, added `tpmVersion`
  - `compliance-policies.json`: added `description` and `lastModified` fields
- **BitLocker collector now works on real tenants:**
  - Removed invalid `encryptionState` from $select (was causing BadRequest - property doesn't exist)
  - Fixed `$filter=operatingSystem eq 'Windows'` (was failing because actual OS values are "Windows 10", "Windows 11")
  - Changed to client-side filtering with `-like "Windows*"`
  - Uses `isEncrypted` boolean only to determine encryption state
  - Added required `User-Agent` header for BitLocker recovery keys API
  - Switched to v1.0 API endpoint for recovery keys
  - Added pagination for recovery keys
  - Added `recoveryKeyEscrowed` field for dashboard compatibility
  - Dashboard page handles both sample data (array) and real collector output (object)
- **SharePoint collector resilience for concealed URLs:**
  - Fixed crash when `Sort-Object` returned `$null` on empty arrays
  - Sites no longer skipped when URLs are concealed - uses site ID as identifier
  - Added hint about Sites.Read.All permission for URL resolution
  - Improved messaging for admin privacy settings
- **Dashboard pages now handle nested collector data structures:**
  - page-credential-expiry.js: Flattens credentials from nested applications
  - page-signin-logs.js: Extracts signIns array from collector output
  - page-asr-rules.js: Extracts rulesArray from collector output
  - page-app-deployments.js: Extracts apps array from collector output
  - page-endpoint-analytics.js: Extracts and normalizes deviceScores with field mapping
  - page-pim.js: Adds null check to prevent "filter is not a function" error

### Added
- Secure Score now displayed on Security page with:
  - Summary card showing score percentage
  - Donut chart visualization
  - Improvement actions table with progress tracking
- Sample data files for all 9 new collectors (for testing/demo)

---

## [2.0.0] - 2026-02-06

### Added

#### New Collectors (9 total)

**Phase 1 - Endpoint Management Core:**
- `Get-CompliancePolicies.ps1` - Device compliance policies with assignment and status tracking
- `Get-ConfigurationProfiles.ps1` - Configuration profiles from Intune and Settings Catalog
- `Get-WindowsUpdateStatus.ps1` - Windows Update rings, feature updates, quality updates, driver updates
- `Get-BitLockerStatus.ps1` - BitLocker encryption status and recovery key metadata

**Phase 2 - Application & Analytics:**
- `Get-AppDeployments.ps1` - Win32, LOB, Store app deployment status with failure tracking
- `Get-EndpointAnalytics.ps1` - Device health scores, startup performance, app reliability
- `Get-ServicePrincipalSecrets.ps1` - Application credential expiry tracking (security critical)

**Phase 3 - Advanced Security:**
- `Get-ASRRules.ps1` - Attack Surface Reduction rule configuration and deployment
- `Get-SignInLogs.ps1` - Detailed sign-in analytics with MFA/CA evaluation

#### PowerShell Module Structure
- `TenantScope.psd1` - Module manifest with metadata and dependencies
- `TenantScope.psm1` - Module entry point with public functions
- Can now use `Import-Module .\TenantScope.psd1` for cleaner usage

#### New API Scopes
- `Policy.Read.All` - For Conditional Access policy reading
- `DeviceManagementApps.Read.All` - For app deployment data
- `BitLockerKey.Read.All` - For BitLocker recovery key metadata

#### New Dashboard Pages (9 total)

**Endpoint Management:**
- Compliance Policies - Device compliance policies with compliance rates
- Configuration Profiles - Intune device configuration profiles
- Windows Update - Update rings, feature updates, quality updates
- BitLocker Status - Encryption status and recovery key tracking
- App Deployments - Application deployment status with failure tracking
- Endpoint Analytics - Device health scores and startup performance

**Security:**
- Sign-In Logs - Detailed sign-in logs with MFA/CA evaluation
- ASR Rules - Attack Surface Reduction rule configuration
- Credential Expiry - Service principal secret and certificate expiry tracking

### Changed
- Dashboard now has 27 pages (up from 18)
- Orchestrator now runs 26 collectors (up from 17)
- Collectors organized by category in orchestrator (Identity, Security, Device, Apps, Collaboration)
- Dashboard data-loader updated to handle all new data types
- Improved collector comments and organization
- Navigation reorganized with expanded Endpoints and Security sections

### Fixed
- Removed `Export-ModuleMember` from `CollectorBase.ps1` (caused errors when dot-sourced)
- Added missing `Policy.Read.All` scope that was used but not declared

---

## [1.0.0] - 2026-02-05

### Added

#### Initial Release - Core Collectors (17)
- `Get-UserData.ps1` - User accounts with activity tracking
- `Get-LicenseData.ps1` - License SKUs with waste analysis
- `Get-GuestData.ps1` - Guest/external users
- `Get-MFAData.ps1` - MFA registration status
- `Get-AdminRoleData.ps1` - Directory role assignments
- `Get-SignInData.ps1` - Risky sign-in detections
- `Get-DeviceData.ps1` - Intune managed devices
- `Get-AutopilotData.ps1` - Windows Autopilot devices
- `Get-DefenderData.ps1` - Defender security alerts
- `Get-EnterpriseAppData.ps1` - Enterprise applications
- `Get-AuditLogData.ps1` - Directory audit logs
- `Get-PIMData.ps1` - Privileged Identity Management activity
- `Get-TeamsData.ps1` - Microsoft Teams with governance flags
- `Get-SharePointData.ps1` - SharePoint sites with sharing analysis
- `Get-SecureScoreData.ps1` - Microsoft Secure Score
- `Get-AppSignInData.ps1` - Application sign-in activity
- `Get-ConditionalAccessData.ps1` - Conditional Access policies

#### Shared Utilities
- `lib/CollectorBase.ps1` - Common functions for all collectors
  - Graph API retry with exponential backoff
  - Date calculation utilities
  - Domain classification
  - Activity status helpers
  - Windows lifecycle information

#### Dashboard
- Static HTML/JS dashboard with 18 pages
- Hash-based routing
- Real-time filtering and search
- CSV export for all tables
- Print-friendly executive report
- Trend history tracking

#### Configuration
- `config.json` - Tenant configuration with thresholds
- Configurable inactive days, stale thresholds
- Domain classification for employees/students

---

## Version History Summary

| Version | Date | Collectors | Major Features |
|---------|------|------------|----------------|
| 2.2.0 | 2026-02-08 | 26 | Single-pane-of-glass: cross-entity navigation, Problem Summary page |
| 2.1.1 | 2026-02-08 | 26 | Dashboard Server with usage tracking, app-only authentication |
| 2.1.0 | 2026-02-08 | 26 | Vulnerability Management, Security Cockpit, Executive Summary |
| 2.0.5 | 2026-02-07 | 26 | Dashboard UI overhaul with unified analytics pattern |
| 2.0.4 | 2026-02-06 | 26 | Compliance and Configuration profile enhancements |
| 2.0.3 | 2026-02-06 | 26 | Windows Update and Endpoint Analytics enhancements |
| 2.0.2 | 2026-02-06 | 26 | Sample data rewrite, dashboard field mapping |
| 2.0.1 | 2026-02-06 | 26 | Bug fixes, Secure Score display |
| 2.0.0 | 2026-02-06 | 26 | Endpoint management, app deployments, analytics |
| 1.0.0 | 2026-02-05 | 17 | Initial release with core M365 data collection |
