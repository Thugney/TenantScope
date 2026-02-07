# Audit Logs Collector Review

**Collector**: `collectors/Get-AuditLogData.ps1`  
**Dashboard pages**: Audit Logs

## Status
PASS (no field gaps detected)

## Required Dashboard Fields (Audit Logs)
`id`, `activityDateTime`, `activityDisplayName`, `operationType`, `initiatedBy`, `initiatedByApp`,
`targetResource`, `targetResourceType`, `category`, `result`, `resultReason`,
`loggedByService`, `correlationId`

## Collector Coverage
- All fields required by the page are produced.
- Collector also emits `targetResourceId`, `targetResources`, and `modifiedProperties` (not used by the UI today).
- Uses live Graph data (no sample/static data paths).

## Sample Data Comparison
**Sample file**: `data/sample/audit-logs.json`
- Sample includes all dashboard-required fields and matches collector naming.
- Sample does **not** include `targetResourceId`, `targetResources`, or `modifiedProperties`, which are extra fields in the collector output.

## Status Update (2026-02-07)
- Resolved: UI now treats any non-success `result` as a failure in summaries and failure tables.

## Graph Collection Details
- Endpoint: `GET /auditLogs/directoryAudits`
- Filter: `activityDateTime ge {now - auditLogDays}`
- Required scopes: `AuditLog.Read.All`
- Output file: `data/audit-logs.json`

## Duplicate Code Check
- No duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): legend dots now only represent Success/Failure segments; totals are listed without dots.
