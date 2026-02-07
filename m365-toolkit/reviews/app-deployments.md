# App Deployments Collector Review

**Collector**: `collectors/Get-AppDeployments.ps1`  
**Dashboard pages**: App Deployments

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (App Deployments)
**App rows**
`id`, `displayName`, `description`, `publisher`, `appType`, `platform`, `version`,  
`isFeatured`, `createdDateTime`, `lastModifiedDateTime`,  
`privacyInformationUrl`, `informationUrl`,  
`assignmentCount`, `assignments[]`, `hasRequiredAssignment`,  
`installedDevices`, `failedDevices`, `pendingDevices`, `notInstalledDevices`, `notApplicableDevices`, `totalDevices`, `successRate`,  
`deviceStatuses[]`, `hasFailures`, `needsAttention`

**Summary**
`totalApps`, `totalInstalled`, `totalFailed`, `totalPending`, `appsWithFailures`,  
`overallInstallRate`, `platformBreakdown`, `typeBreakdown`

**Failed Devices**
`deviceName`, `userName`, `failedApps`, `failedAppCount`

## Collector Coverage
- All required fields above are produced in the nested `appData` structure.
- Assignment targets are resolved to display names (group ID → display name when possible).
- Uses live Graph data (no sample/static data paths).

## Graph Collection Details
- Endpoints:
  - `GET /deviceAppManagement/mobileApps` (beta, `isAssigned eq true`)
  - `GET /deviceAppManagement/mobileApps/{id}/assignments`
  - `GET /deviceAppManagement/mobileApps/{id}/deviceStatuses`
- Required scopes: `DeviceManagementApps.Read.All`.
- Output file: `data/app-deployments.json`.

## Risks / Notes
- Beta endpoint usage for mobile apps can be subject to schema changes.
- Device status data only captures failed devices (by design for the dashboard detail table).

## Duplicate Code Check
- Assignment target parsing now uses shared `Resolve-AssignmentTarget` (duplicate removed).

## UI Notes
- Resolved (2026-02-07): donut segments align with Installed/Failed/Pending legend items.
