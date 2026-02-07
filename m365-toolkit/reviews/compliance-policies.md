# Compliance Policies Collector Review

**Collector**: `collectors/Get-CompliancePolicies.ps1`  
**Dashboard pages**: Compliance Policies

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (Compliance Policies)
**Policy rows**
`id`, `displayName`, `description`, `platform`, `category`, `isCritical`, `odataType`,  
`createdDateTime`, `lastModifiedDateTime`, `version`,  
`assignmentCount`, `assignments[]`,  
`compliantDevices`, `nonCompliantDevices`, `errorDevices`, `conflictDevices`, `notApplicableDevices`, `totalDevices`, `complianceRate`,  
`hasIssues`, `deviceStatuses[]`, `settingStatuses[]`

**Summary**
`totalPolicies`, `totalDevices`, `compliantDevices`, `nonCompliantDevices`, `errorDevices`,  
`overallComplianceRate`, `platformBreakdown`, `criticalPolicies`, `policiesWithIssues`

**Other sections**
`nonCompliantDevices[]` (for device table), `settingFailures[]` (for settings table), `insights[]`

## Collector Coverage
- All required fields above are produced in the nested `complianceData` structure.
- `platformBreakdown` is already a map matching the UI expectation.
- Uses live Graph data (no sample/static data paths).

## Graph Collection Details
- Endpoints:
  - `GET /deviceManagement/deviceCompliancePolicies`
  - `GET /deviceManagement/deviceCompliancePolicies/{id}/assignments`
  - `GET /deviceManagement/deviceCompliancePolicies/{id}/deviceStatusOverview`
  - `GET /deviceManagement/deviceCompliancePolicies/{id}/deviceStatuses`
  - `GET /deviceManagement/deviceCompliancePolicies/{id}/deviceSettingStateSummaries`
- Required scopes: `DeviceManagementConfiguration.Read.All`.
- Output file: `data/compliance-policies.json`.

## Risks / Notes
- Non‑compliant device list uses `deviceDisplayName` for `deviceId`; if a true ID is required later, switch to `deviceId` when available.
- Some sub‑calls can fail silently (assignments/status/settings), which may reduce detail but still allows the page to render.

## Duplicate Code Check
- No duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments now include Compliant/Non-Compliant/Errors.
