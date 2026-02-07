# Conditional Access Collector Review

**Collector**: `collectors/Get-ConditionalAccessData.ps1`  
**Dashboard pages**: Conditional Access

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (Conditional Access)
`id`, `displayName`, `state`, `policyType`, `riskLevel`,  
`requiresMfa`, `requiresCompliantDevice`, `requiresHybridJoin`, `blockAccess`, `blocksLegacyAuth`,  
`includesAllUsers`, `includesAllGuests`, `includesAllApps`, `includesOffice365`,  
`excludedUserCount`, `excludedGroupCount`, `includedGroupCount`, `includedRoleCount`,  
`hasLocationCondition`, `hasRiskCondition`, `createdDateTime`, `modifiedDateTime`

## Collector Coverage
- All required fields above are produced.
- Policy classification is derived from grant controls and targets (`policyType`, `riskLevel`, `blocksLegacyAuth`).
- Exclusion counts (`excludedUserCount`, `excludedGroupCount`) are computed for gap detection and table warnings.
- Uses live Graph data (no sample/static data paths).

## Graph Collection Details
- Endpoint: `GET /identity/conditionalAccess/policies` via `Get-MgIdentityConditionalAccessPolicy -All`.
- Required scopes: `Policy.Read.All` (Entra ID P1/P2 required).
- Output file: `data/conditional-access.json` (empty array on failure).

## Risks / Notes
- If permissions/licensing are missing, collector returns an empty array and the dashboard will render zero policies.
- `riskLevel` is heuristic-based (grant controls + targets). Treat as internal classification, not a Graph-provided severity.
- Duplicate code check: no duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments now include Enabled/Report Only/Disabled; MFA Policies is listed without a dot.
