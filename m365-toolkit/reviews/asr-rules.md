# ASR Rules Collector Review

**Collector**: `collectors/Get-ASRRules.ps1`  
**Dashboard pages**: ASR Rules

## Status
PASS with clarified semantics (policy counts)

## Required Dashboard Fields (ASR Rules)
**Rules summary (rulesArray)**
`ruleId`, `ruleName`, `blockCount`, `auditCount`, `warnCount`, `disabledCount`, `isDeployed`

**Policies list**
`displayName`, `description`, `templateId`, `isAssigned`, `ruleCount`,  
`createdDateTime`, `lastModifiedDateTime`, `asrRules[].ruleName`, `asrRules[].mode`

## Collector Coverage
- All required fields above are produced for **intent-based** ASR policies.
- Settings catalog policies populate `policies[]` with rule lists and **now update** `rulesSummary`/`rulesArray` counters.
- Uses live Graph data (no sample/static data paths).

## Status Update (2026-02-07)
- Resolved: UI labels now describe `blockCount/auditCount/warnCount` as **policy counts**, not device counts.

## Gaps / Risks
- Uses beta endpoints (`/beta/deviceManagement/*`); schema changes can break parsing.

## Graph Collection Details
- Endpoints: `/beta/deviceManagement/templates`, `/beta/deviceManagement/intents`, `/beta/deviceManagement/configurationPolicies` (+ `/settings` per policy).
- Required scopes: `DeviceManagementConfiguration.Read.All`.
- Output file: `data/asr-rules.json`.

## Duplicate Code Check
- No duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): donut segments now reflect Block/Audit/Warn/Not Configured distribution; deployed % remains in the center label.
