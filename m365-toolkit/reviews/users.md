# Users Collector Review

**Collector**: `collectors/Get-UserData.ps1`  
**Dashboard pages**: Users, Data Quality, Organization, Security, Lifecycle, App Usage, License Analysis, Overview

## Status
PASS with risks (sign-in licensing + MFA cross-reference dependency)

## Required Dashboard Fields (Users)
`id`, `displayName`, `userPrincipalName`, `mail`, `domain`, `accountEnabled`, `userSource`,
`department`, `jobTitle`, `companyName`, `officeLocation`, `city`, `country`, `usageLocation`,
`manager`, `createdDateTime`, `lastSignIn`, `daysSinceLastSignIn`,
`mfaRegistered`, `licenseCount`, `assignedSkuIds`, `flags`, `isInactive`, `onPremSync`

## Collector Coverage
- All required fields above are produced.
- Additional fields produced for Data Quality and Org analysis: `mobilePhone`, `managerId`, `managerUpn`, `managerMail`, `jobTitle`, `companyName`, `officeLocation`, `city`, `country`, `usageLocation`.
- `mfaRegistered` defaults to `true` and is corrected by MFA cross‑reference in the pipeline.
- `flags` includes `disabled` and `inactive`; `admin` is added later by cross‑reference.

## Sample Data Comparison
**Sample file**: `data/sample/users.json`
- Sample includes all dashboard-required fields and matches collector naming.
- Sample includes `flags: ["admin"]`, which the collector does **not** set directly; this relies on the admin-role cross‑reference step.

## Status Update (2026-02-07)
- Resolved: Inactive threshold now defaults to `90` days when config is missing or invalid.
- Resolved: Direct/group license counts now fall back to direct counts when `licenseAssignmentStates` is missing.
- Resolved: Manager fields now fallback to typed properties when `AdditionalProperties` are missing.

## Gaps / Risks
- **Sign‑in licensing**: `signInActivity` requires Entra ID P1/P2. If unavailable, `lastSignIn` is null and `Get-ActivityStatus` marks activity as `unknown`, resulting in `isInactive = false` for all users. Inactive user counts will be under‑reported.
- **MFA cross‑reference dependency**: if MFA collection fails, all users remain `mfaRegistered = true`, and security/MFA insights will be inaccurate.

## Graph Collection Details
- Endpoint: `GET /users` with `$select` and `$expand=manager`.
- Required scopes: `User.Read.All`, `AuditLog.Read.All` (for `signInActivity`).
- Output file: `data/users.json`.

## Duplicate Code Check
- No duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments match MFA Enrolled/Without MFA; Enabled/Disabled/Inactive are listed without dots.
