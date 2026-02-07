Organization Page Gap Report (2026-02-07)

Scope
- Page: `dashboard/js/page-organization.js`
- Collector: `collectors/Get-UserData.ps1`

Current Coverage (observed)
- Builds manager to direct report lists and flags users without a manager.
- Reports span of control (wide manager spans) and basic department analysis.
- Highlights external managers not found in the tenant.

Status Update (2026-02-07)
- Resolved: Manager linking now uses managerId/managerUpn with displayName fallback to reduce hierarchy errors from duplicate names.
- Resolved: Location and organization attributes are surfaced in manager/orphan tables and exports (companyName, officeLocation, city, country).
- Remaining: Multi-level hierarchy view (chain of command beyond direct reports).
- Remaining: Administrative Units or group-based org structure visibility.

Duplicate Code
- None observed specific to organization logic in this review. Global duplicates are tracked in `reviews/duplicates.md`.
