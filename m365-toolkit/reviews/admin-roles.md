# Admin Roles Collector Review

**Collector**: `collectors/Get-AdminRoleData.ps1`  
**Dashboard pages**: Security, Lifecycle

## Status
PASS (dashboard alignment applied)

## Required Dashboard Fields (Admin Roles)
`roleId`, `roleName`, `isHighPrivilege`, `memberCount`,  
`members[].displayName`, `members[].userPrincipalName`,  
`members[].accountEnabled`, `members[].daysSinceLastSignIn`,  
`members[].userId` (used for admin counts and cross-reference)

## Collector Coverage
- All required fields above are produced.
- Fix applied: added `userId` to user members so `Security` page counts and MFA cross-reference align.

## Status Update (2026-02-07)
- Resolved: Security page admin counts now filter to user principals only (non-user members no longer inflate counts).

## Graph Collection Details
- Endpoints: `GET /directoryRoles`, `GET /directoryRoles/{id}/members`.
- Required scopes: `RoleManagement.Read.Directory`, `Directory.Read.All`.
- Enriches role members with data from `users.json` where available.

## Risks / Notes
- Role members may include **groups** or **service principals**; UI lists them but user-centric analytics should filter by `memberType`.
