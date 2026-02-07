# Configuration Profiles Collector Review

**Collector**: `collectors/Get-ConfigurationProfiles.ps1`  
**Dashboard pages**: Configuration Profiles

## Status
PASS (collector output matches dashboard usage and sample data)

## Required Dashboard Fields (Configuration Profiles)
**Profile rows**
`id`, `displayName`, `description`, `profileType`, `platform`, `category`, `source`,  
`assignmentCount`, `assignments[]`,  
`successDevices`, `errorDevices`, `conflictDevices`, `pendingDevices`, `notApplicableDevices`, `totalDevices`, `successRate`,  
`createdDateTime`, `lastModifiedDateTime`,  
`deviceStatuses[]`, `settingStatuses[]`,  
`hasErrors`, `hasConflicts`, `needsAttention`

**Summary**
`totalProfiles`, `totalDevices`, `successDevices`, `errorDevices`, `conflictDevices`, `pendingDevices`,  
`overallSuccessRate`, `profilesWithErrors`, `profilesWithConflicts`,  
`platformBreakdown`, `typeBreakdown`

**Other sections**
`failedDevices[]`, `settingFailures[]`, `insights[]`

## Collector Coverage
- All required fields above are produced in the nested `profileData` structure.
- `platformBreakdown` and `typeBreakdown` are maps matching the UI expectations.
- Uses live Graph data (no sample/static data paths).

## Sample Data Comparison
**Sample file**: `data/sample/configuration-profiles.json`
- Top-level keys match collector output: `profiles`, `failedDevices`, `settingFailures`, `insights`, `summary`, `collectionDate`.
- Profile item fields in sample match collector output and UI usage.
- Summary fields in sample align with UI expectations.

## Graph Collection Details
- Endpoints:
  - `GET /deviceManagement/deviceConfigurations`
  - `GET /deviceManagement/configurationPolicies` (beta)
  - `GET /deviceManagement/deviceConfigurations/{id}/deviceStatusOverview`
  - `GET /deviceManagement/configurationPolicies/{id}/deviceStatusOverview` (beta)
  - `GET /deviceManagement/*/{id}/assignments`
- Required scopes: `DeviceManagementConfiguration.Read.All`.
- Output file: `data/configuration-profiles.json`.

## Risks / Notes
- Settings catalog policies use beta endpoints; schema changes may affect parsing.
- Setting-level failures are only pulled for `deviceConfigurations`; settings catalog failures are not fully enumerated.

## Duplicate Code Check
- No duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments now include Success/Errors/Conflicts/Pending.
