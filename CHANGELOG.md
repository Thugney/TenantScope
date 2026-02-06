# TenantScope - Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.7] - 2026-02-06

### Fixed
- **App Usage column rendering**: Fixed Interactive and Status columns showing "[object HTMLSpanElement]" - formatters now return HTML strings

### Added
- **App Inventory table**: New table on App Usage page showing all applications with user counts, sign-in counts, interactive/non-interactive breakdown, and last used date

## [1.5.6] - 2026-02-06

### Fixed
- **License Overlap Analysis error**: Added `Array.isArray` check for `assignedSkuIds` to prevent "map is not a function" error

### Changed
- **Auto version display**: Sidebar version now automatically reads from VERSION file during build (no more hardcoded version in index.html)

## [1.5.5] - 2026-02-06

### Fixed
- **App Sign-In collector skip token error**: Replaced SDK cmdlet with direct REST API to handle pagination properly on large tenants
- **Graceful degradation**: If skip token expires mid-collection, collector now keeps partial data instead of failing completely

### Changed
- App Sign-In collector now uses manual pagination with 500 records per page
- Added page limit (20 pages / 10,000 records max) to prevent excessively long collection runs
- Uses `$select` parameter to reduce API response payload size

## [1.5.4] - 2026-02-06

### Changed
- **Teams collector rewrite**: Completely rewritten to focus on governance gaps only (inactive, ownerless, guest access)
- **Performance improvement**: Teams collector now uses Reports API and `$expand=owners` - no per-team API calls needed
- **Dashboard page**: Teams page renamed to "Teams Governance" with governance-focused charts and metrics
- **Data structure**: Teams data now uses nested format with metadata wrapper containing summary counts

### Removed
- `memberCount`, `channelCount`, `isArchived`, `classification` fields from Teams data (not needed for governance focus)
- "Archived" status filter on Teams page
- "Total members" stat card (replaced with "with guests" count)

## [1.5.3] - 2026-02-06

### Fixed
- **Teams collector throttling**: Reduced batch size from 20 to 10 teams, added 200ms delay between batches
- **Teams collector retry logic**: Added exponential backoff retry for batch requests (3 retries, 30s/60s/90s waits)
- **Teams member/owner fetching**: Now uses batch API instead of individual calls per team, dramatically faster for large tenants

### Changed
- Teams batch progress now shows every 50 teams instead of every 20
- Member fetch progress shows every 100 teams
- Removed per-team progress indicator in final processing phase (now instant with lookup data)

## [1.5.2] - 2026-02-06

### Fixed
- **Organization Structure page charts**: Refactored to use `DashboardCharts.createChartCard` with proper styling and larger chart size (200px)
- **License Overlap Analysis page charts**: Refactored to use `DashboardCharts.createChartCard` with proper styling and larger chart size (200px)

### Added
- CSS for `.summary-cards` grid layout with colored border variants for analysis pages
- CSS for `.summary-card` component with variant classes (primary, info, warning, success, danger)
- CSS for `.empty-state-small` for compact empty state messages within chart containers

## [1.5.1] - 2026-02-06

### Fixed
- **Autopilot profile assignment accuracy**: Fixed property name casing issue where Graph API returns camelCase but code expected PascalCase, causing all devices to show "Profile Assignment: No" incorrectly
- **Autopilot status matching**: Updated regex to correctly match Graph API status values (`assignedInSync`, `assignedOutOfSync`, `assignedUnkownSyncState`, `pending`)
- **MFA collector property casing**: Fixed fallback API path property handling (cmdlet returns PascalCase, direct API returns camelCase)
- **Department filter on SharePoint**: Sites now filter by owner's department when department filter is active
- **Department filter on Security**: Risky sign-ins and users now filter by department when filter is active

### Changed
- **Teams data collection performance**: Implemented batch API requests and `$expand` for members/owners, reducing API calls by ~80% and eliminating 1-second sleep delays
- Autopilot dashboard now shows detailed profile assignment status (In Sync, Out of Sync, Pending, Not Assigned, Failed)
- Added `profileAssignmentStatus` field to Autopilot data output for granular status visibility

## [1.5.0] - 2026-02-05

### Added
- **Organization Hierarchy page**: Management hierarchy analysis with span of control metrics, orphan user detection, and department breakdown
- **License Overlap Analysis page**: Per-user license overlap detection identifying users with redundant license assignments (E3+E5, AAD P1+P2, etc.)
- **Collapsible navigation groups**: Sidebar reorganized into logical categories (Identity, Licensing, Security, Endpoints, Collaboration, Reports, Audit) with expand/collapse functionality
- Span of control analysis: buckets managers by direct report count (1-3, 4-7, 8-12, 13+)
- Orphan user detection: identifies users without managers who are not managers themselves
- License overlap rules: configurable detection for E3/E5, AAD P1/P2, Business Basic/Standard, and EMS E3/E5
- Department-level overlap breakdown: see which departments have the most redundant licenses
- Navigation state persistence: collapsed/expanded state saved to localStorage

### Changed
- Sidebar navigation restructured into 7 collapsible groups
- Sidebar footer now displays version number (v1.5.0)
- Sample user data now includes `assignedSkuIds` for overlap detection testing

### Fixed
- Mobile sidebar usability: added hamburger menu, overlay backdrop, and auto-close on navigation
- DashboardCharts API calls in Organization and License Analysis pages (renderDonut -> createDonutChart)
- FocusTables integration in Organization page manager focus table

## [1.4.0] - 2026-02-05

### Added
- **Conditional Access Analysis**: New dashboard page for CA policy inventory and security gap detection
- New collector: `Get-ConditionalAccessData.ps1` collecting from `/identity/conditionalAccess/policies` endpoint
- CA policy inventory with state, type, and security level classification
- Security gap detection: identifies missing MFA policies, legacy auth exposure, risk-based policy gaps
- Policy exclusion tracking: highlights users/groups excluded from security policies (blind spots)
- MFA Coverage analysis: visual breakdown of all-users vs partial vs no-MFA policies
- Focus/Breakdown tables on CA page for policy analysis by state, type, and security level
- New Graph scope: `Policy.Read.All` for Conditional Access policy data
- Sample data with 15 realistic CA policies demonstrating various configurations

### Changed
- Navigation updated with Conditional Access page under Security section
- Build pipeline now includes `conditional-access.json` in dashboard bundle

## [1.3.0] - 2026-02-05

### Added
- Focus/Breakdown Tables: BSURE-style analytical tables showing data grouped by dimensions with percentage breakdowns
- Column Selector: customizable column visibility on all detail tables with localStorage persistence
- Date Range Filters: created date and last sign-in date range filters on Users and Guests pages
- User Source filter: filter users by Cloud vs On-premises synced origin
- Windows Lifecycle tracking: automatic detection of Windows 10/11 version, release name, EOL date, and support status
- Devices per Person analysis: bucket distribution showing users with 1, 2, 3, or 4+ devices
- License Overlap Detection: configurable rules to identify users with redundant license assignments (e.g., E3 + E5)
- Data Quality Report page: profile completeness analysis showing field coverage percentages across users
- Application Usage page: sign-in analytics by app with user counts and department breakdown
- App Sign-In collector: `Get-AppSignInData.ps1` collecting from `/auditLogs/signIns` endpoint
- Enhanced user properties: companyName, officeLocation, city, country, mobilePhone, usageLocation, manager, userSource
- Windows lifecycle columns on Devices page: Windows Type, Release, Supported status
- Overlap, Savings %, Billed Users columns on Licenses page
- Sample data for app sign-ins

### Changed
- Users page now includes Focus/Breakdown panel, Column Selector, User Source filter, and date range filters
- Guests page now includes Focus/Breakdown panel, Column Selector, and date range filters
- Devices page now includes Column Selector, Windows Support filter, and Devices per Person section
- Licenses page now includes Column Selector, Overlap filter, and enhanced cost metrics
- User collector now outputs `assignedSkuIds` for license overlap cross-referencing
- License collector now calculates overlap counts, potential savings, and average cost per user

## [1.2.0] - 2026-02-05

### Added
- SVG donut charts across all dashboard pages (Overview, Users, Licenses, Guests, Security, Devices, Enterprise Apps, Lifecycle, PIM, Audit Logs)
- License Cost Calculator: configurable currency pricing in `config.sample.json`, waste cost cards on Licenses page, cost columns in table, cost breakdown in detail modal, waste callout on Overview
- Trend Tracking: `trend-history.json` snapshots appended after each collection (capped at 12), `trend-helper.js` utility, delta arrows on Overview metric cards
- Secure Score: new collector `Get-SecureScoreData.ps1` (Graph `/security/secureScores`), donut chart on Overview with top improvement actions
- Department Filter: global header dropdown filtering Users, Devices, Overview, and Lifecycle pages by department context
- Executive Report page: composite health score donut (MFA/Compliance/SecureScore/GuestHygiene/LicenseEfficiency), auto-ranked top 5 risks, license waste table, key metrics grid, governance summary, browser print support
- Teams collector (`Get-TeamsData.ps1`) and Teams dashboard page with activity, ownership, and guest access tracking
- SharePoint collector (`Get-SharePointData.ps1`) and SharePoint Governance dashboard page with sharing links, sensitivity labels, and storage analysis
- Sample data for Teams, SharePoint, Secure Score, and trend history
- Print CSS (`@media print`) for clean A4 output from Report page
- `ARCHITECTURE.md` and `USAGE.md` documentation

### Changed
- `getSummary()` in data-loader now always computes from raw data instead of relying on metadata summary
- Overview charts grid changed from fixed 2-column to `auto-fit` to accommodate Secure Score chart
- `Build-Dashboard.ps1` now copies `trend-history.json` and `secure-score.json` into dashboard bundle
- `Invoke-DataCollection.ps1` appends trend snapshot after each collection run and includes SecureScore/Teams/SharePoint collectors

## [1.1.0] - 2026-02-05

### Added
- Enterprise Applications dashboard page with credential expiry tracking, status filters, and publisher classification
- New collector: `Get-EnterpriseAppData.ps1` - collects service principals and app registrations with secret/certificate expiry
- New Graph scope: `Application.Read.All` for enterprise app and app registration data
- Enterprise Apps sample data (20 apps: Microsoft first-party, third-party integrations, managed identities)
- Device certificate renewal tracking: `certExpiryDate`, `daysUntilCertExpiry`, `certStatus` fields in device collector
- Certificate Renewal summary cards on Devices page (Expired, Expiring 30d, Expiring 60d, Healthy)
- Certificate status filter and table columns on Devices page
- Certificate expiry details in device detail modal
- Features.md for tracking planned and implemented features

## [1.0.0] - 2026-02-05

### Added
- 9 data collectors: Users, Licenses, Guests, MFA, Admin Roles, Sign-In Risk, Devices, Autopilot, Defender Alerts
- Interactive dashboard with 7 pages: Overview, Users, Licenses, Guests, Security, Devices, Lifecycle
- Data bundling via `Build-Dashboard.ps1` for local file:// access (bypasses CORS)
- Sample data set for testing without live tenant
- Exponential backoff retry logic for Graph API throttling (5 retries, 60s base)
- 5-second cooldown between collectors to reduce throttling
- Cross-referencing: MFA status and admin roles merged into user records
- CSV export from any dashboard table
- Scheduled collection via Windows Task Scheduler
- Automatic dashboard build after data collection

### Fixed
- Dashboard showing empty when opened via file:// protocol (CORS bypass via JS data bundle)
- Graph API throttling failures on `Get-MgRiskyUser` endpoint (exponential backoff + cooldown)
