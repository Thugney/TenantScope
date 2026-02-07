# Sign-In Logs Collector Review

**Collector**: `collectors/Get-SignInLogs.ps1`  
**Dashboard pages**: Sign-In Logs

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (Sign-In Logs)
`id`, `createdDateTime`, `userPrincipalName`, `userDisplayName`, `appDisplayName`,  
`status`, `errorCode`, `failureReason`,  
`conditionalAccessStatus`, `mfaDetail`,  
`city`, `country`, `ipAddress`,  
`riskLevel`, `riskState`,  
`clientAppUsed`, `deviceDetail`, `isInteractive`

## Collector Coverage
- All required fields above are produced.
- The UI derives `location` from `city` and `country`, and derives `mfaSatisfied` from `mfaDetail`.

## Graph Collection Details
- Endpoint: `GET /auditLogs/signIns` (direct Graph request).
- Required scopes: `AuditLog.Read.All` (plus directory read permissions).
- Uses paging with a hard cap of 4 pages (up to ~2000 records).
- Time window uses `collection.signInLogDays` with a 7-day default.

## Risks / Notes
- Sign-in log access requires Entra ID P1/P2; without it, the collector writes an empty structure.
- The 2000-record cap is intentional for performance, but will truncate large tenants (documented behavior).

## UI Notes
- Resolved (2026-02-07): donut segments now include Success/Failed/Interrupted; Risky is listed without a dot.
