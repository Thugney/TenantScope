Windows Update Page Gap Report (2026-02-07)

Scope
- Page: `dashboard/js/page-windows-update.js`
- Collector: `collectors/Get-WindowsUpdateStatus.ps1`

Current Coverage (observed)
- Update ring inventory with basic device status overview counts.
- Feature update, quality update, and driver update profile summaries and assignments.
- Device compliance list built from managed devices.

Status Update (2026-02-07)
- Resolved: Per-device update status now uses feature/quality/driver policy state data when available, with a last-sync fallback.
- Resolved: Update ring assignment is mapped via ring `deviceStatuses` for accurate per-device ring display.
- Resolved: Feature update version now uses shared Windows lifecycle mapping rather than hard-coded build checks.
- Remaining: Authoritative Windows Update for Business report export (Intune reports API) is not yet used.

Duplicate Code
- None observed specific to Windows Update logic in this review. Global duplicates are tracked in `reviews/duplicates.md`.
