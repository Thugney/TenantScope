# Guests Collector Review

**Collector**: `collectors/Get-GuestData.ps1`  
**Dashboard pages**: Guests, Lifecycle, Overview, Report

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (Guests)
`id`, `displayName`, `mail`, `sourceDomain`,  
`createdDateTime`, `invitationState`,  
`lastSignIn`, `daysSinceLastSignIn`,  
`isStale`, `neverSignedIn`

## Collector Coverage
- All required fields above are produced.
- Collector provides additional governance fields (group counts, directory roles) not used in UI.

## Graph Collection Details
- Endpoints: `GET /users?$filter=userType eq 'Guest'`, `GET /users/{id}/memberOf`.
- Required scopes: `User.Read.All`, `AuditLog.Read.All`, plus group membership visibility (`Directory.Read.All` or `GroupMember.Read.All`).
- Stale detection uses `thresholds.staleGuestDays`.

## Risks / Notes
- Per-guest `memberOf` lookups are N+1 and can be slow at scale.
- `signInActivity` requires Entra ID P1/P2; if missing, stale detection is less accurate.

## UI Notes
- Resolved (2026-02-07): donut segments match Active/Stale/Pending/Never; Total Guests is listed without a dot.
