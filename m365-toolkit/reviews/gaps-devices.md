Devices Page Gap Report (2026-02-07)

Scope
- Page: `dashboard/js/page-devices.js`
- Collector: `collectors/Get-DeviceData.ps1`

Current Coverage (observed)
- Intune managed device inventory with compliance state, ownership, enrollment, encryption, autopilot, OS details, and last sync.
- Summary breakdowns by compliance, ownership, enrollment type, OS, and autopilot.
- Alerts for stale devices, unsupported OS, unknown compliance, and low autopilot coverage.

Status Update (2026-02-07)
- Resolved: Entra ID registered or hybrid joined devices (not Intune-managed) are now collected and merged into the inventory with `managementSource = "Entra"`.
- Resolved: Per-policy compliance failure details are collected for noncompliant/unknown Intune devices (`nonCompliantPolicyCount` + policy names) and surfaced in the UI.
- Resolved: Device risk posture is already represented via `partnerReportedThreatState` and `threatSeverity` in the collector and device UI.

Duplicate Code
- None observed specific to devices logic in this review. Global duplicates are tracked in `reviews/duplicates.md`.
