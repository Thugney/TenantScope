Lifecycle Page Gap Report (2026-02-07)

Scope
- Page: `dashboard/js/page-lifecycle.js`
- Collectors: `collectors/Get-UserData.ps1`, `collectors/Get-GuestData.ps1`, `collectors/Get-AdminRoleData.ps1`, `collectors/Get-DeletedUsers.ps1`, `collectors/Get-TeamsData.ps1`, `collectors/Get-SharePointData.ps1`

Current Coverage (observed)
- Offboarding: disabled accounts with licenses, admin roles, inactive-but-enabled accounts, deleted users pending purge.
- Onboarding: users created in the last 30 days with no sign-in or no MFA.
- Role hygiene: inactive admins and admins without MFA.
- Guest cleanup: stale guests, pending invitations, never-signed-in guests.
- Collaboration governance: ownerless or inactive Teams, SharePoint sites with anonymous links, external sharing on inactive sites, and missing sensitivity labels.

Status Update (2026-02-07)
- Resolved: Admin role member evaluation now skips non-user principals (groups/service principals) in lifecycle checks.
- Resolved: HR leave dates are used to flag "Leave Date Passed" and "Leaving Soon" offboarding issues.
- Resolved: Onboarding gaps now include missing profile fields (manager/department/job title) for new users.
- Remaining: Lifecycle Workflows API integration (joiner/mover/leaver automation visibility).
- Remaining: Access Reviews integration for lifecycle compliance.

Duplicate Code
- None observed specific to lifecycle logic in this review. Global duplicates are tracked in `reviews/duplicates.md`.
