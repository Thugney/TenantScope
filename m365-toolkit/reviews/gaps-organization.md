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

Gap Findings (2026-02-08)
- No multi-level hierarchy metrics: only direct reports are modeled, so there is no chain depth, root manager count, average layers, or longest chain.
- No hierarchical integrity checks: cycles/self-managed loops and missing manager references are not flagged; displayName fallback can still mis-link when IDs/UPNs are missing.
- Grouping is limited to span-of-control and department; there is no segmentation by location (officeLocation, city, country, usageLocation), company, or user source (onPremSync, userSource) even though data exists.
- Manager coverage and orphan rates are not reported by site/business unit, which makes remediation targeting harder for endpoint teams.
- Collected properties unused in org insights: usageLocation, employeeType, employeeHireDate, employeeLeaveDateTime, managerMail, onPremDomainName, onPremSyncAge.
- Department analysis computes inactive/disabled counts but does not surface them in the Organization page tables or insights.
- No administrative unit or group-based org structure view; manager relationships are the only structure used.
- No explicit top-level manager metric; managers without managers are excluded from orphan counts but are not reported as roots.

Duplicate Code
- None observed specific to organization logic in this review. Global duplicates are tracked in `reviews/duplicates.md`.

