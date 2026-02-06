# Changelog

All notable changes to TenantScope will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - Fixed `$filter=operatingSystem eq 'Windows'` (was failing because actual OS values are "Windows 10", "Windows 11")
  - Changed to client-side filtering with `-like "Windows*"`
  - Added required `User-Agent` header for BitLocker recovery keys API
  - Switched to v1.0 API endpoint for recovery keys
  - Added pagination for recovery keys
  - Dashboard page handles both sample data (array) and real collector output (object)
- **SharePoint collector resilience for concealed URLs:**
  - Fixed crash when `Sort-Object` returned `$null` on empty arrays
  - Sites no longer skipped when URLs are concealed - uses site ID as identifier
  - Added hint about Sites.Read.All permission for URL resolution
  - Improved messaging for admin privacy settings

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
| 2.0.0 | 2026-02-06 | 26 | Endpoint management, app deployments, analytics |
| 1.0.0 | 2026-02-05 | 17 | Initial release with core M365 data collection |
