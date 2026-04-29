# Intune Policy Status Collection

## Diagnosis From Existing Dashboard Data

The top-level `dashboard\data\configuration-profiles.json` sample contains 67 policies, all from `configurationPolicies`, all typed as `Settings Catalog`, and all persisted with zero status totals. There are no raw report rows or status evidence fields in that file, so the original all-zero dashboard symptom is collection-side. The dashboard also treated missing evidence as real zeroes, so the renderer now shows `--` with a warning marker when status evidence is unavailable.

## Endpoints Used

- `GET beta /deviceManagement/configurationPolicies`
- `GET v1.0 /deviceManagement/deviceConfigurations`
- `POST beta /deviceManagement/reports/getCachedReport`
- `POST v1.0 /deviceManagement/reports/getCachedReport`
- Fallback only: `GET /deviceManagement/deviceConfigurations/{id}/deviceStatusOverview`
- Fallback only: `GET /deviceManagement/deviceConfigurations/{id}/deviceStatuses`

The collector attempts these Intune report IDs when building policy status evidence:

- `ConfigurationPolicyAggregate`
- `ConfigurationPolicyAggregateV3`
- `ConfigurationPolicyDeviceAggregates`
- `ConfigurationPolicyDeviceAggregatesV3`
- `DeviceAssignmentStatusByConfigurationPolicy`
- `DeviceAssignmentStatusByConfigurationPolicyV3`
- `DeviceAssignmentStatusByConfigurationPolicyForASR`
- `DeviceAssignmentStatusByConfigurationPolicyForEDR`
- `DeviceAssignmentStatusByConfigurationPolicyForAC`
- `DeviceStatusesByConfigurationProfile`
- `DeviceStatusesByConfigurationProfileV3`
- `DeviceStatusesByConfigurationProfileForASR`
- `DeviceStatusesByConfigurationProfileForEDR`
- `DeviceStatusesByConfigurationProfileForAppControl`
- `DeviceStatusesByConfigurationProfileWithPF`
- `DeviceStatusesByConfigurationProfileWithPFV3`

## Required Graph Permissions

- `DeviceManagementConfiguration.Read.All`
- `DeviceManagementManagedDevices.Read.All` only when device-level report correlation is needed
- `DeviceManagementEndpointSecurity.Read.All` only when endpoint security report families are available in the tenant

## Status Mapping

- `success`: `compliant`, `success`, `succeeded`
- `errors`: `error`, `failed`, `nonCompliant`
- `conflicts`: `conflict`
- `pending`: `pending`, `unknown`, `inProgress`
- `notApplicable`: `notApplicable`
- `notAssigned` is ignored and is not counted as success.

`successRate` is calculated as `success / total * 100`. If `total` is zero or status evidence is missing, the dashboard renders `--`.

## Debug Evidence

Each collection writes `configuration-profiles-status-evidence.json` next to `configuration-profiles.json`. It records report IDs, row counts, small raw row samples, and warnings. Tokens and secrets are not written.

## Known Limitations

- Intune report schema columns vary by tenant and report version, so TenantScope maps multiple known column names.
- If Intune reporting APIs return no rows, the dashboard still shows inventory but marks policy status as missing instead of showing fake zeroes.
- Legacy per-policy `deviceStatuses` endpoints are fallback-only because they are deprecated and slower.

## Rollback

Set `collection.enableIntunePolicyStatusReports` to `false` in `m365-toolkit\config.json`, rerun collection, then rebuild the dashboard. The dashboard remains backward compatible with the old count fields.

---

## Windows Update Policy Status

### Endpoints Used

**Feature Update Policies:**
- `GET beta /deviceManagement/windowsFeatureUpdateProfiles` (inventory)
- `POST beta /deviceManagement/reports/exportJobs` with `reportName: FeatureUpdatePolicyStatusSummary` (status)

**Quality Update Policies:**
- `GET beta /deviceManagement/windowsQualityUpdateProfiles` (inventory)
- `GET beta /deviceManagement/windowsQualityUpdateProfiles/{id}/deviceUpdateStates` (status)

**Update Rings:**
- `GET beta /deviceManagement/deviceConfigurations?$filter=isof('microsoft.graph.windowsUpdateForBusinessConfiguration')` (inventory)
- `GET beta /deviceManagement/deviceConfigurations/{id}/deviceStatusOverview` (status)

**Driver Updates:**
- `GET beta /deviceManagement/windowsDriverUpdateProfiles` (inventory)
- `GET beta /deviceManagement/windowsDriverUpdateProfiles/{id}/driverInventories` (driver list)
- `GET beta /deviceManagement/windowsDriverUpdateProfiles/{id}/deviceUpdateStates` (status)

### Required Graph Permissions

- `DeviceManagementConfiguration.Read.All`

### Status Mapping for Feature Updates (FeatureUpdatePolicyStatusSummary)

- `succeeded` = `CountDevicesSuccessStatus`
- `pending` = `CountDevicesInProgressStatus`
- `failed` = `CountDevicesErrorStatus`
- `policyId` = `PolicyId`
- `policyName` = `PolicyName`
- `targetVersion` = `FeatureUpdateVersion`

### Status Mapping for Quality Updates (deviceUpdateStates)

- `succeeded` = status in `installed`, `succeeded`, `compliant`
- `pending` = status in `pending`, `downloading`, `installing`, `inProgress`
- `failed` = status in `failed`, `error`

### Rendering Rules

1. If `statusAvailable === true` (deploymentState has data): Render numeric values including real 0.
2. If `statusAvailable === false` (no deploymentState data): Render "--" for counts, "Not Collected" for progress.
3. Never convert missing/null status to 0.
4. Never convert collected 0 to "--".

### Known Limitations

- Quality update `deviceUpdateStates` endpoint may not be available for all policy types.
- Feature update status requires the Intune report export API, which can take several seconds to complete.
- If report export fails, inventory still renders but status shows "Not Collected".

### Fix History

**2026-04-29: Consistent status rendering for Feature and Quality updates**

Root cause: Quality updates rendered "0" when status was not collected, while Feature updates correctly rendered "--".

- Quality update table was not setting `statusAvailable` flag
- Quality update column formatters used direct value rendering instead of `formatDeploymentCount()`
- Collector did not include `statusAvailable`, `statusSource`, `statusUnavailableReason` for quality updates

Fix applied:
- Frontend: Added `statusAvailable = hasDeploymentStatus(u)` in `renderQualityTable`
- Frontend: Changed quality update columns to use `formatDeploymentCount()` with row context
- Frontend: Updated quality update detail modal to show "Not collected" state
- Collector: Added `statusAvailable`, `statusSource`, `statusUnavailableReason` to quality update output
- Sample data: Added status evidence fields for consistency
