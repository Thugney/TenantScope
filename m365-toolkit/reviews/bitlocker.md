# BitLocker Collector Review

**Collector**: `collectors/Get-BitLockerStatus.ps1`  
**Dashboard pages**: BitLocker Status

## Status
PASS

## Required Dashboard Fields (BitLocker)
**Device rows**
`id`, `deviceName`, `userPrincipalName`, `manufacturer`, `model`, `serialNumber`, `osVersion`,  
`complianceState`, `lastSyncDateTime`, `daysSinceSync`,  
`isEncrypted`, `encryptionState`, `needsEncryption`,  
`recoveryKeyEscrowed`, `recoveryKeyCount`, `recoveryKeys[]`,  
`hasRecoveryKey`

**Summary**
`totalDevices`, `encryptedDevices`, `notEncryptedDevices`, `unknownDevices`,  
`devicesWithRecoveryKeys`, `encryptionRate`, `manufacturerBreakdown`, `osBreakdown`

## Collector Coverage
- All required fields above are produced.
- `recoveryKeyEscrowed` is derived from recovery key presence for UI compatibility.
- Uses live Graph data (no sample/static data paths).

## Status Update (2026-02-07)
- Resolved: `isEncrypted` now preserves `$null` when Graph returns `null` instead of coercing to `false`.

## Risks / Notes
- Recovery keys retrieval needs `BitLockerKey.ReadBasic.All` or `BitLockerKey.Read.All`; without it, `recoveryKeyEscrowed` will be false for all devices.

## Graph Collection Details
- Endpoints:
  - `GET /deviceManagement/managedDevices` (Windows devices; no `$select`)
  - `GET /informationProtection/bitlocker/recoveryKeys`
- Required scopes: `DeviceManagementManagedDevices.Read.All` and `BitLockerKey.Read.All` (for keys).
- Output file: `data/bitlocker-status.json`.

## Duplicate Code Check
- No new duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments now include Encrypted/Not Encrypted/Unknown; Keys Escrowed is listed without a dot.
