# Devices Collector Review

**Collector**: `collectors/Get-DeviceData.ps1`  
**Dashboard pages**: Devices, Overview, Executive Report

## Status
PASS (expanded to include Entra-only devices)

## Required Dashboard Fields (Devices)
**Device rows**
`id`, `deviceName`, `managedDeviceName`, `userPrincipalName`, `primaryUserDisplayName`, `azureAdDeviceId`,  
`os`, `osVersion`, `windowsType`, `windowsRelease`, `windowsEOL`, `windowsSupported`, `androidSecurityPatchLevel`,  
`complianceState`, `inGracePeriod`, `complianceGraceDays`,  
`lastSync`, `daysSinceSync`, `isStale`,  
`ownership`, `enrollmentTypeDisplay`, `registrationStateDisplay`, `enrollmentProfileName`, `enrolledDateTime`, `autopilotEnrolled`,  
`manufacturer`, `model`, `serialNumber`, `chassisType`, `deviceCategory`, `physicalMemoryGB`,  
`isEncrypted`, `jailBroken`, `isSupervised`, `threatStateDisplay`, `threatSeverity`, `activationLockBypass`,  
`joinType`, `managementAgent`,  
`certStatus`, `daysUntilCertExpiry`, `certExpiryDate`,  
`exchangeAccessDisplay`, `exchangeAccessReason`, `easActivated`, `exchangeLastSync`,  
`totalStorageGB`, `freeStorageGB`, `storageUsedPct`,  
`wifiMacAddress`, `ethernetMacAddress`, `phoneNumber`, `subscriberCarrier`,  
`imei`, `meid`, `iccid`, `udid`, `notes`

**Summary fields expected by the Devices page**
`totalDevices`, `compliantDevices`, `noncompliantDevices`, `unknownDevices`, `complianceRate`,  
`encryptedDevices`, `notEncryptedDevices`, `staleDevices`,  
`certExpired`, `certCritical`, `certWarning`, `certHealthy`, `certUnknown`,  
`win10Count`, `win11Count`, `winSupportedCount`, `winUnsupportedCount`,  
`corporateDevices`, `personalDevices`,  
`osBreakdown` (object map), `manufacturerBreakdown` (object map)

## Collector Coverage
- All required **device row** fields are produced.
- Summary includes **both** collector-style and UI-style keys (`compliant` + `compliantDevices`, etc.).
- Breakdown shapes include **maps** (`osBreakdown`, `manufacturerBreakdown`) and **arrays** (`osBreakdownArray`, `manufacturerBreakdownArray`).
- `isEncrypted` preserves `$null` when unknown.
- Inventory now includes **Entra-only** devices (not Intune-managed) with `managementSource = "Entra"` and safe nulls for Intune-only fields.

## Sample Data Comparison
**Sample file**: `data/sample/devices.json`
- Sample **device rows** align with collector output (field names match).
- Sample **summary** uses the collector schema (`compliant`, `noncompliant`, `windows10`, etc.); collector emits both schemas and UI normalizes both.
- Sample **breakdowns** (`osBreakdown`, `manufacturerBreakdown`) are arrays of `{ name, count }`; collector emits both arrays and maps and UI accepts both.

## Gaps / Risks
- Entra-only devices do not include compliance policy or encryption detail (Graph does not expose that via the directory device resource). These devices are still valuable for inventory visibility.

## Graph Collection Details
- Endpoints: 
  - `GET /deviceManagement/managedDevices` (Intune)
  - `GET /devices` (Entra-only devices)
- Required scopes: `DeviceManagementManagedDevices.Read.All`, `Directory.Read.All`.
- Output file: `data/devices.json`.

## Duplicate Code Check
- No duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments include Compliant/Non-Compliant/Unknown; Stale and other priority signals moved to a dedicated card with colored dots.
