# Changelog

All notable changes to TenantScope will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.2] - 2026-02-12

### Added
- **Devices page**: "Unmanaged" filter option to show Entra-only devices not enrolled in MDM (smartphones for MFA authenticator, etc.)
- **Devices page**: "Unmanaged" summary card showing count of unmanaged devices
- **Devices page**: "Grace Period" compliance filter option (when `gracePeriodAsNoncompliant` is false)
- **Autopilot tab**: Full filter system with dropdowns for Enrollment State, Profile Status, Manufacturer, and Group Tag
- **Autopilot tab**: Summary cards now update dynamically based on filtered results
- **Config option**: `gracePeriodAsNoncompliant` in thresholds section - set to `false` to show grace period devices separately from non-compliant

### Changed
- **Get-DeviceData.ps1**: Merged Autopilot device identity collection into device collector for accurate detection
- **Get-DeviceData.ps1**: Autopilot status now determined by cross-referencing device serial numbers with actual Autopilot registry
- **Get-DeviceData.ps1**: Device records now enriched with Autopilot data (Group Tag, Profile Status, Enrollment State, Last Contacted)
- **Get-AutopilotData.ps1**: Uses explicit `$select` to ensure all fields (deploymentProfileAssignmentStatus, groupTag, etc.) are returned from Graph API
- **Get-AutopilotData.ps1**: Added detailed debug logging showing profile status breakdown during collection
- **CollectorBase.ps1**: Devices with no activity date are now treated as stale (previously counted as active)
- **Devices page (All Devices tab)**: Added "AP Group Tag" and "AP Profile Status" columns for devices enrolled via Autopilot

### Fixed
- **Autopilot column**: Fixed devices showing "NO" when they are actually registered in Autopilot
- **Stale device counts**: Now includes devices with no LastSyncDateTime, aligning closer with Entra ID stale device reports
- **Devices page filters**: Added safety checks to prevent empty table rendering when column state is corrupted
- **Autopilot tab**: Profile Status column now displays actual status values (In Sync, Out of Sync, Pending, Not Assigned, Failed) instead of "Unknown"

### Security & Bug Fixes (Dashboard Property Rendering)
- **HIGH: XSS prevention** - Replaced unsafe inline `onclick` handlers with data attributes and event delegation in `page-app-deployments.js`
- **HIGH: Runtime crash fix** - Added type validation in `formatThreatSeverity()` to prevent `charAt()` crash on empty strings
- **HIGH: Null safety** - Added null/undefined checks in `focus-tables.js` `groupBy()` and `renderBreakdownTable()` to prevent TypeError on malformed data
- **HIGH: Memory leak fix** - Fixed event listener accumulation in device link handlers (`page-devices.js`) by removing old handlers before re-adding
- **HIGH: Memory leak fix** - Fixed tab event listener stacking in user modal (`page-users.js`) using event delegation with cleanup
- **HIGH: Race condition fix** - Added index invalidation, version tracking, and concurrent build prevention in `data-relationships.js`
- **MEDIUM: XSS prevention** - Added `escapeHtml()` function and applied to all user-facing data in `page-compliance-policies.js`
- **MEDIUM: XSS prevention** - Applied HTML escaping to configuration profiles, app deployments, compliance policies, and Defender alerts tables in device modal
- **MEDIUM: API typo handling** - Documented intentional handling of Graph API typo `assignedUnkownSyncState` in Autopilot profile status
- **MEDIUM: Data mutation fix** - Added `deepClone()` function in `page-data-quality.js` to prevent modifications to original DataStore objects
- **MEDIUM: CSV export fix** - Added formatter support to CSV export (`export.js`) - now applies column formatters and strips HTML for clean exports
- **MEDIUM: Type safety** - Added string type validation in `formatHealthStatus()` (`shared-formatters.js`) before calling `toLowerCase()`
- **MEDIUM: Stale context fix** - Improved copy button handler in user modal to use data attributes and check modal visibility before showing toasts
- **LOW: Null safety** - Added null check for `row` parameter in `primaryUserDisplayName` formatter
- **LOW: Performance** - Fixed duplicate property reads in `page-data-quality.js` by caching values in local variables
- **LOW: Documentation** - Added `sortable: false, filterable: false` flags to synthetic `_adminLinks` column with explanatory comments

### Additional Security & Bug Fixes (Round 2)
- **HIGH: XSS prevention** - Added `escapeHtml()` and applied to modal HTML in `page-configuration-profiles.js` (profile type, platform, category, description, assignments, device statuses)
- **HIGH: XSS prevention** - Added `escapeHtml()` and applied to modal HTML in `page-groups.js` (display name, description, mail, visibility, membership rule, classification, on-prem fields)
- **HIGH: XSS prevention** - Added `escapeHtml()` and applied to modal HTML in `page-enterprise-apps.js` (app name, publisher, verified publisher, owners, secrets, certificates)
- **HIGH: XSS prevention** - Added `escapeHtml()` and applied to error devices table in `page-windows-update.js` (device name, user, update ring, error details)
- **HIGH: Memory leak fix** - Fixed tab event listener stacking in groups modal (`page-groups.js`) using event delegation with cleanup
- **MEDIUM: Null safety** - Added null checks for `directReports` array access in `page-organization.js` (lines 1089, 1473, 1488)
- **MEDIUM: Null safety** - Added null checks for `deviceName` and `settingName` in search filters (`page-compliance-policies.js`)
- **MEDIUM: Null safety** - Added null checks for `user` object access in overlap filters (`page-license-analysis.js`)
- **MEDIUM: Null safety** - Added null checks for `page.label` and `page.key` in global search (`global-search.js`)
- **MEDIUM: Null safety** - Added fallback values for `item.severity`, `item.category`, and `item.title` in action cards (`page-overview.js`)

---

## [2.4.1] - 2026-02-11

### Changed
- **Organization page**: Modern collapsible org chart tree with expand/collapse functionality, avatar initials, and stats badges showing manager/staff counts.
- **Data Quality page**: Visual redesign with circular progress rings, descriptive labels (e.g., "28% have mobile phone" with "X missing" counts), and clearer field explanations.
- Changed "ICs" label to "staff" for better clarity on Organization page.

### Fixed
- **Get-PIMData.ps1**: Handle missing `RoleAssignmentSchedule.ReadWrite.Directory` permission gracefully with try-catch instead of failing the entire collection.
- **Get-LapsCoverage.ps1**: Fixed structural bug where local admin hunting code was placed after return statements (unreachable code). Variables `$localAdminMap` and `$localAdminQueryFailed` now defined before use.
- **Get-ConfigurationProfiles.ps1**: Optimized to reduce API calls and avoid HTTP 429 throttling errors. Uses report API data for Settings Catalog policies, limits detailed calls to first 30 profiles.
- **Advanced Hunting collectors** (ASR, Device Hardening, LAPS): Graceful handling when M365 Defender license is not available - returns empty data with informative message instead of failing.

---

## [2.4.0] - 2026-02-10

### Added
- **Coverage Gaps page** highlighting endpoint security blind spots across Defender device health, ASR telemetry, endpoint security policy compliance, LAPS coverage, patch currency, and device hardening.
- **New collectors**: `Get-DefenderDeviceHealth.ps1`, `Get-ASRAuditEvents.ps1`, `Get-EndpointSecurityStates.ps1`, `Get-LapsCoverage.ps1`, `Get-DeviceHardening.ps1`.
- **Patch currency gap signals** in `Get-WindowsUpdateStatus.ps1` (quality update age).
- New config thresholds and collection windows for coverage gaps.

### Changed
- Dashboard data loader and build pipeline include the new datasets.
- Documentation updated with new permissions and configuration fields.

### Fixed
- Teams collector now casts owners/members to user objects to avoid Graph `BadRequest` responses.
- SharePoint collector falls back to the v1.0 usage report when beta fails.

## [2.3.1] - 2026-02-10

### Changed
- **Eliminated duplicate Graph API calls across all 37 collectors** via a new `SharedData` pattern:
  - Orchestrator now passes a shared hashtable between collectors so data fetched once is reused everywhere
  - **Managed Devices** (was fetched 4 times): `Get-DeviceData` now shares with `Get-UserData`, `Get-BitLockerStatus`, `Get-WindowsUpdateStatus`
  - **Risky Users & Risk Detections** (exact duplicate): `Get-IdentityRiskData` now shares with `Get-SignInData`
  - **Conditional Access Policies** (full re-fetch): `Get-ConditionalAccessData` now shares with `Get-NamedLocations`
  - **App Registrations** (near-identical query): `Get-EnterpriseAppData` now shares with `Get-ServicePrincipalSecrets`
  - **Service Principals** (duplicate lookup): `Get-EnterpriseAppData` now shares with `Get-OAuthConsentGrants`
  - **Sign-In Logs** (same data source): `Get-SignInLogs` now shares with `Get-AppSignInData`
  - **Groups** (superset/subset): `Get-GroupData` now shares with `Get-TeamsData`
- **Dependency-ordered collector execution**: Orchestrator now runs primary collectors before downstream consumers
- All collectors retain API fallbacks for standalone execution (backward compatible)
- Updated `ValidateSet` in orchestrator to include all 37 collectors

---

## [2.3.0] - 2026-02-09

### Added
- **Groups Management Page** (`page-groups.js`):
  - Comprehensive Entra ID groups dashboard showing all group types
  - Group types: Security, Microsoft 365, Distribution, Mail-enabled Security
  - Filtering by type, source (cloud/on-prem), ownerless, with-guests, with-licenses
  - Summary cards: Total Groups, Security, Microsoft 365, License Groups
  - Donut charts: Group Types distribution, Source & Governance breakdown
  - Detail modal with 4 tabs: Overview, Members, Owners, Licenses
  - Dynamic group detection with membership rule display
  - On-premises sync status and age tracking
  - Admin portal deep links (Entra ID, Members, Licenses, Teams, SharePoint)

- **Groups Collector** (`Get-GroupData.ps1`):
  - Collects all Entra ID groups via Graph API
  - Full membership collection with pagination (up to 1000 members per group)
  - Owner retrieval for governance tracking
  - Group type classification based on mailEnabled, securityEnabled, groupTypes
  - Cross-references users.json to detect license assignments via groups
  - Generates insights: ownerless groups, stale sync, large license groups
  - Graph endpoints: /groups, /groups/{id}/members, /groups/{id}/owners
  - Required scopes: Group.Read.All, GroupMember.Read.All, Directory.Read.All

- **Groups Data Relationships**:
  - New indexes: `groupIndex`, `groupNameIndex`, `userGroupIndex`
  - `getGroup(groupId)` - Get group by ID
  - `getGroupByName(name)` - Get group by display name
  - `getUserGroups(userId)` - Get all groups a user belongs to
  - `getGroupProfile(groupId)` - Full group with members, owners, licenses, linked team/site
  - `getGroupLicenseAssignees(groupId, skuId)` - Users who got license via group
  - `getGroupAdminUrls(group)` - Entra portal URLs for group management

- **User Modal Groups Tab**:
  - New "Groups" tab in user detail modal
  - Shows all groups user is a member of
  - Displays group type, source, member count, license count
  - Clickable group names navigate to Groups page
  - Summary of license groups user belongs to

### Changed
- `getUserProfile()` now includes `groups` property with user's group memberships
- Navigation updated with Groups link under Identity section
- Orchestrator now includes GroupData in collector list (27 collectors total)

### Fixed
- **Graph API pagination limits** across all collectors:
  - Changed `$top` from 500/999 to 100 (Graph API recommended max for paginated endpoints)
  - Affected: `Get-EndpointAnalytics.ps1`, `Get-AppDeployments.ps1`

- **Get-ConfigurationProfiles.ps1**:
  - Fixed Settings Catalog policy status collection (no `deviceStatusOverview` endpoint for Settings Catalog)
  - Only calls status endpoint for legacy `deviceConfigurations`, not `configurationPolicies`

- **Get-WindowsUpdateStatus.ps1**:
  - Fixed feature update profile handling (no `deviceUpdateStates` endpoint for feature updates)
  - Silenced expected errors for quality update profiles that don't support device states

- **Get-AppDeployments.ps1**:
  - Added proper pagination loop for device statuses
  - Silenced expected errors for Store apps and web links (only managed apps have device statuses)

- **Get-EndpointAnalytics.ps1**:
  - Fixed Work From Anywhere endpoint (`userExperienceAnalyticsWorkFromAnywhereModelPerformance` instead of non-existent `userExperienceAnalyticsWorkFromAnywhereMetrics`)
  - Fixed `$top` parameter from 500 to 100 across all endpoints

---

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

- **Complete Device-Policy Integration (Phase 11)**:
  - `getDeviceConfigProfiles()` - Configuration profiles with per-device deployment status
  - `getDeviceAppDeployments()` - App deployments with per-device install state and error codes
  - `getDeviceCompliancePolicies()` - Compliance policies with per-device status and failed settings
  - `getUserDirectReports()` - Direct reports computed from manager relationships
  - `getUserManagerChain()` - Upward manager hierarchy traversal
  - Device modal Security tab: Configuration Profiles table showing profile name, type, category, status (error/conflict indicators)
  - Device modal Security tab: App Deployments table showing app name, version, type, install state, error code
  - Device modal Compliance tab: Enhanced policy table showing policy name, platform, category, status, failed settings per policy
  - User modal Overview tab: Org Hierarchy section with clickable manager chain and direct reports list

- **Expanded Problems Detection (Phase 12)**:
  - App deployment failures detection from `appDeployments.failedDevices`
  - Configuration profile errors detection from `configurationProfiles.failedDevices`
  - Expired app credentials detection from `servicePrincipalSecrets` (expired + critical within 7 days)
  - High-risk OAuth consent grants detection based on `riskLevel`
  - Windows Update failures detection from `windowsUpdateStatus.deviceCompliance`
  - PIM pending approvals detection from `pimActivity`
  - Overdue access reviews detection from `accessReviewData.instances`
  - Poor endpoint health devices detection from `endpointAnalytics.deviceScores`
  - Problematic applications detection from `endpointAnalytics.appReliability`

- **Security Page Navigation Enhancement (Phase 12)**:
  - Defender alerts table now has clickable user and device columns
  - Users in alerts navigate to user profile with search filter
  - Devices in alerts navigate to device details with search filter
  - Proper HTML escaping for XSS prevention

- **CVE External Links (Phase 12)**:
  - CVE IDs in vulnerability tables now link to NVD (National Vulnerability Database)
  - Links open in new tab with `rel="noopener noreferrer"` for security
  - Applied to Overview tab priority table, All CVEs tab, Exploited tab cards, and affected devices modal

- **Endpoint Analytics Integration (Phase 12)**:
  - `getDeviceEndpointAnalytics()` - health scores and performance metrics for devices
  - Device modal Overview tab: Endpoint Analytics section showing health status, overall score, startup performance, app reliability, work from anywhere scores
  - Additional metrics: boot score, login score, blue screen count, restart count
  - Health status color-coded (Excellent/Good = green, Fair = yellow, Poor = red)

- **PIM Activity Integration (Phase 12)**:
  - `getUserPimActivity()` - eligible roles, activations, and pending approvals for users
  - User modal Security tab: Privileged Identity Management section
  - Eligible roles table showing role name, status, and expiry date
  - Recent activations table showing role, activation date, and justification
  - Pending approval alerts badge for visibility

- **Deep Integration & Cross-Page Navigation (Phase 13)**:
  - Identity Risk page: Clickable users in risky users and detections tables
  - Windows Update page: Clickable devices/users in error devices table
  - BitLocker page: Clickable devices/users in devices needing attention table
  - Sign-In Logs page: Clickable users in main table and risky sign-ins overview

- **Problems Page Expansion (Phase 13)**:
  - Risky Sign-Ins detection (high/medium risk sign-ins)
  - Failed Sign-In Attempts detection (brute force - 5+ failures per user)
  - Stale Guest Users detection (90+ days inactive)
  - Disabled Conditional Access Policies detection
  - Wasted/Unused Licenses detection (unused > 10% or 5+)
  - Service Health Issues detection (active incidents)

- **User Modal Enhancements (Phase 13)**:
  - `getUserRiskySignins()` - returns risky sign-ins (high/medium risk) for a user
  - Risky Sign-Ins section in Security tab showing time, app, risk level, state, location
  - Expanded On-Premises Sync details: domain, SAM account, last sync, sync age, distinguished name
  - Password Policy details: last change, password age, expiration status, strong password status

- **Device Modal Enhancements (Phase 13)**:
  - Enhanced `getDeviceWindowsUpdate()` with pending/failed updates, feature version, error details, status source
  - Enhanced Windows Update section with status badges, pending/failed counts, error details
  - Enhanced `getDeviceBitLocker()` with recovery key count, volume types, needs encryption flag
  - Enhanced BitLocker section with recovery key count, volume types, action required indicator

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
| 2.4.1 | 2026-02-11 | 42 | Org chart tree, Data Quality redesign, collector permission handling fixes |
| 2.4.0 | 2026-02-10 | 42 | Coverage Gaps page, endpoint security coverage collectors, patch currency gaps |
| 2.3.1 | 2026-02-10 | 37 | SharedData collection deduplication and dependency-ordered collectors |
| 2.3.0 | 2026-02-09 | 27 | Groups Management: full Entra ID group inventory with membership, licenses |
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
