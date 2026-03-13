# PLAN.md
# TenantScope - Execution Plan

---

## What this document is for

Ordered tasks for the current maintenance and hardening phase. The baseline product already exists; these tasks focus on making the repository safer to change, easier for agents to navigate, and more reliable to release.

---

## Phase 1 tasks

- [x] 1. Replace placeholder scaffold docs with repository-specific context
      AGENTS.md, MVP.md, PLAN.md, and starter skills should describe the real PowerShell toolkit and local dashboard.
- [ ] 2. Formalize validation commands
      Decide whether to adopt Pester and PSScriptAnalyzer or keep documented manual validation only, then update AGENTS.md and release guidance.
- [ ] 3. Add collector contract checks
      Protect shared JSON schemas consumed by the dashboard, especially users, devices, licenses, sign-ins, service principals, and governance data.
- [ ] 4. Add dashboard smoke validation
      Create a repeatable sample-data validation path that exercises the main pages, filters, tables, and cross-entity navigation after JS/CSS changes.
- [ ] 5. Harden configuration and secret handling
      Document `config.json` expectations, keep secret-bearing values out of git, and decide whether local secret storage needs a safer pattern.
- [ ] 6. Standardize release readiness
      Define the required checks for version bumps, changelog updates, sample-data builds, and live-tenant verification before a release is tagged.
- [ ] 7. Clarify the next active product milestone
      Decide whether the next investment area is broader M365 coverage, data quality/reliability, or packaging/distribution improvements.

---

## Decisions already made

- **Collection runtime**: PowerShell 7+ plus Microsoft Graph PowerShell SDK modules.
- **Architecture**: Local JSON files plus a static dashboard. No hosted backend or database by default.
- **Dashboard delivery**: `Build-Dashboard.ps1` generates a JS data bundle so the dashboard can run from `file://` or a simple local server.
- **Repository-safe data**: `data\sample\` is the safe development/demo dataset; live tenant data stays out of git.
- **Authentication**: Interactive, device code, certificate, and client-secret paths are all supported.
- **Front-end approach**: Vanilla HTML/CSS/JS with modular page scripts; do not introduce a framework without an explicit decision.

---

## Open questions

- [ ] Branch model - should agents always branch from `main`, or should this repo add and use `develop`?
- [ ] Validation stack - add Pester/PSScriptAnalyzer now, or continue with manual sample/live validation until a later milestone?
- [ ] Release gate - what must happen on every version bump besides updating `VERSION` and `CHANGELOG.md`?
- [ ] Priority - which work should come next: new coverage, quality hardening, or release automation?

---

## Architecture notes

- Single repository. Product code lives under `m365-toolkit\`; repo-level docs and release metadata live at the root.
- Main entry points: `Install-Prerequisites.ps1`, `Invoke-DataCollection.ps1`, `scripts\Build-Dashboard.ps1`, and `scripts\Start-DashboardServer.ps1`.
- Collectors share helper logic in `lib\CollectorBase.ps1` and write JSON outputs under `data\`.
- The dashboard is a modular SPA under `dashboard\` with hash routing, shared helper modules, and generated `js\data-bundle.js`.
- `dashboard\data\` and `data\` are generated/runtime artifacts; `data\sample\` is the stable sample dataset for development and demos.

---

## Revision history

| Date | Change | Who |
|------|--------|-----|
| 2026-03-13 | Rewrote from existing repository context | project-init |
