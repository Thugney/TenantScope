# Windows Update Status Collector Review

**Collector**: `collectors/Get-WindowsUpdateStatus.ps1`  
**Dashboard pages**: Windows Update Status

## Status
PASS with partial risk (reports API not used)

## Required Dashboard Fields (Windows Update)
**Update Rings**
`id`, `displayName`, `description`, `createdDateTime`, `lastModifiedDateTime`,  
`qualityUpdatesDeferralDays`, `featureUpdatesDeferralDays`,  
`qualityUpdatesPaused`, `featureUpdatesPaused`,  
`deadlineForQualityUpdates`, `deadlineForFeatureUpdates`, `deadlineGracePeriod`,  
`automaticUpdateMode`, `microsoftUpdateServiceAllowed`, `driversExcluded`, `allowWindows11Upgrade`,  
`assignedGroups`, `successDevices`, `errorDevices`, `pendingDevices`, `totalDevices`

**Feature Updates**
`id`, `displayName`, `description`, `featureUpdateVersion`, `rolloutSettings`, `endOfSupportDate`,  
`createdDateTime`, `lastModifiedDateTime`, `assignedGroups`,  
`deploymentState.total`, `deploymentState.succeeded`, `deploymentState.pending`, `deploymentState.failed`, `deploymentState.notApplicable`

**Quality Updates**
`id`, `displayName`, `description`, `releaseDateDisplayName`, `qualityUpdateClassification`,  
`isExpedited`, `expeditedUpdateSettings`, `createdDateTime`, `lastModifiedDateTime`, `assignedGroups`,  
`deploymentState.total`, `deploymentState.succeeded`, `deploymentState.pending`, `deploymentState.failed`,  
`progressPercent`

**Driver Updates**
`id`, `displayName`, `driverClass`, `manufacturer`, `version`, `releaseDateTime`,  
`approvalStatus`, `applicableDeviceCount`, `profileName`,  
`deploymentState.total`, `deploymentState.succeeded`, `deploymentState.pending`, `deploymentState.failed`

**Device Compliance**
`deviceName`, `userPrincipalName`, `updateStatus`, `updateRing`, `errorDetails`, `lastSyncDateTime`

**Summary (used by page)**
`totalRings`, `totalFeaturePolicies`, `totalQualityPolicies`, `totalDriverUpdates`,  
`totalManagedDevices`, `devicesUpToDate`, `devicesPendingUpdate`, `devicesWithErrors`,  
`complianceRate`, `pausedRings`, `expeditedUpdatesActive`, `driversNeedingReview`

## Collector Coverage
- All required **ring/feature/quality/driver/deviceCompliance** fields are produced.
- Summary includes `driversNeedingReview` and reflects deviceCompliance counts when available.
- Uses live Graph data (no sample/static data paths).

## Status Update (2026-02-07)
- Resolved: Device compliance now prefers per-device update states from feature/quality/driver policies, with last-sync fallback.
- Resolved: `updateRing` is mapped via ring `deviceStatuses` instead of placeholder assignment.
- Resolved: Feature update version now uses shared Windows lifecycle mapping (no hard-coded build mapping).

## Gaps / Risks
- **Reports API not used**: Intune Windows Update compliance report exports are not yet pulled, so status is still derived from policy state endpoints. Consider adding reports export for authoritative compliance and ring reporting.

## Graph Collection Details
- Endpoints (beta-heavy):
  - `/beta/deviceManagement/deviceConfigurations` (update rings)
  - `/beta/deviceManagement/windowsFeatureUpdateProfiles`
  - `/beta/deviceManagement/windowsQualityUpdateProfiles`
  - `/beta/deviceManagement/windowsDriverUpdateProfiles`
  - `/beta/deviceManagement/managedDevices` (Windows only)
  - `/beta/deviceManagement/deviceConfigurations/{id}/deviceStatuses` (ring assignment)
- Required scopes: `DeviceManagementConfiguration.Read.All`.
- Output file: `data/windows-update-status.json`.

## Duplicate Code Check
- No new duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments now include Up-to-Date/Pending/Errors.
