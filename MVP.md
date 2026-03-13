# MVP.md
# TenantScope - Scope Definition

---

## What this document is for

TenantScope is already past its first public release, but agents still need a clear definition of the minimum supported product slice. This document captures the baseline that must keep working before new collectors, pages, or release automation are added.

---

## Phase 1 - MVP

**Goal:** Collect core Microsoft 365 tenant data locally and present it in a browser dashboard without sending tenant data to third-party services.

**Done when:** An admin can install prerequisites, configure the tenant locally, run collection or use sample data, build the dashboard, and review identity, security, endpoint, licensing, and collaboration data locally with no real tenant data committed to git.

### Features in Phase 1

- [x] Local prerequisite bootstrap - install Microsoft Graph dependencies and create the local data folder
- [x] Config-driven collection engine - `Invoke-DataCollection.ps1` loads config, authenticates, runs selected collectors, and writes JSON outputs
- [x] Broad workload coverage - identity, security, endpoint, licensing, collaboration, and governance collectors ship in the baseline
- [x] Local dashboard build - `Build-Dashboard.ps1` copies JSON into the dashboard and generates `data-bundle.js`
- [x] Dashboard exploration - pages, tables, filters, exports, search, and deep links work with sample or live data
- [x] Cross-entity context - users, devices, sign-ins, groups, roles, Teams, and SharePoint can be navigated together
- [x] Privacy-first operation - real tenant data stays local and sample data is the only repository-safe dataset

---

## Explicitly out of scope for Phase 1

These are good ideas. They are not part of the supported baseline.

- Hosted SaaS or multi-tenant cloud deployment
- Database-backed backend or public API
- Endpoint agent installation on managed devices
- Automatic write-back/remediation against Entra, Intune, Defender, or M365
- Real-time event streaming, webhooks, or always-on background services
- Mobile application
- Built-in secret management or storing credentials in the repository
- Expanding scope beyond Microsoft 365 administration and security visibility

---

## Phase 2+ ideas

Parking lot for work that becomes valuable after the baseline is protected.

- Automated Pester coverage for collectors and build scripts
- PSScriptAnalyzer and CI validation
- Schema contract validation between collector outputs and dashboard consumers
- Better release automation around `VERSION`, `CHANGELOG.md`, and validation evidence
- Additional workload coverage and richer cross-entity investigations

---

## Revision history

| Date | Change | Who |
|------|--------|-----|
| 2026-03-13 | Rewrote from existing repository context | project-init |
