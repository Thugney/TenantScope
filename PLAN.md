# TenantScope Execution Plan

## Purpose

This plan tracks practical Phase 1 hardening work for TenantScope. New items should stay inside the read-only collection and local dashboard boundary unless `MVP.md` is updated first.

## Phase 1 Tasks

- [x] 1. Establish project structure and root context files.
- [x] 2. Implement Graph collection orchestrator.
- [x] 3. Implement core identity and licensing collectors.
- [x] 4. Implement endpoint and Intune collectors.
- [x] 5. Implement security, risk, and compliance collectors.
- [x] 6. Implement static dashboard shell and page modules.
- [x] 7. Add cross-entity relationships and dashboard deep links.
- [x] 8. Add data quality and problem summary views.
- [x] 9. Align release version metadata to `VERSION`.
- [ ] 10. Standardize collector output schemas around `summary`, `insights`, `collectionDate` or `collectedAt`, and source tracking.
- [ ] 11. Add focused parser or smoke tests for critical collectors.
- [ ] 12. Improve dashboard accessibility for charts and keyboard navigation.
- [ ] 13. Replace any scheduled-task secret usage with safer certificate guidance.
- [ ] 14. Document collector shared-data contract in developer docs.

## Decisions Already Made

- **Local-first architecture:** Tenant data stays on the operator machine.
- **Read-only Graph access:** TenantScope reports posture and links to admin portals; it does not remediate directly.
- **PowerShell collectors:** PowerShell 7 and Microsoft Graph SDK are the collector runtime.
- **Static dashboard:** The dashboard is vanilla HTML, CSS, and JavaScript built from local JSON.
- **Git workflow:** Use `main`, `develop`, and feature/fix branches with Conventional Commits.

## Open Questions

- [ ] Should Phase 2 add a formal JSON schema per collector output?
- [ ] Should scheduled collection support only certificate auth and deprecate client secret arguments?
- [ ] Should MSClaw integration be a separate package boundary or stay as optional scripts?

## Architecture Notes

- `m365-toolkit\Invoke-DataCollection.ps1` owns configuration, authentication, collector ordering, shared data, metadata, and dashboard handoff.
- `m365-toolkit\collectors` contains one collector per data domain.
- `m365-toolkit\lib\CollectorBase.ps1` is the shared utility layer for retry, pagination, data normalization, result objects, and JSON writes.
- `m365-toolkit\dashboard` is a static dashboard and must not require a backend server for normal use.
- Generated data belongs under `m365-toolkit\data` and should not be committed.

## Revision History

| Date | Change | Who |
|------|--------|-----|
| 2026-03-13 | Initial scaffold | project-init |
| 2026-04-26 | Replaced template placeholders with TenantScope execution plan | Codex |
