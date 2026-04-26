# TenantScope MVP Scope

## Purpose

This file defines the current Phase 1 product boundary. TenantScope is a read-only Microsoft 365 posture visibility tool. It collects data locally through Microsoft Graph and presents it in a local dashboard.

## Phase 1 MVP

**Goal:** Give an IT admin a reliable local view of Microsoft 365 tenant posture across identity, endpoint, security, licensing, applications, collaboration, and compliance.

**Done when:** A user can configure a tenant, run collectors, build the dashboard, inspect prioritized problems, and export or deep-link findings without sending tenant data to any external service.

## Features In Phase 1

- [x] PowerShell prerequisites installer for Microsoft Graph SDK modules.
- [x] Main collection orchestrator with interactive and app-only authentication.
- [x] Read-only collectors for users, groups, guests, licenses, MFA, roles, devices, Intune policies, Defender, sign-ins, apps, Teams, SharePoint, and compliance data.
- [x] Shared collector helper module for retry, pagination, dates, result objects, and JSON writing.
- [x] Local JSON output under `m365-toolkit\data`.
- [x] Static dashboard build process.
- [x] Dashboard pages for overview, problems, identity, devices, security, licensing, applications, collaboration, compliance, and data quality.
- [x] Cross-entity navigation between users, devices, sign-ins, groups, roles, apps, and vulnerabilities.
- [x] Direct admin portal links for follow-up remediation.
- [x] CSV-style export support from dashboard tables.

## Explicitly Out Of Scope For Phase 1

- Write-back remediation to Microsoft 365, Intune, Entra ID, Defender, or SharePoint.
- Hosted SaaS dashboard or external telemetry service.
- Multi-tenant hosted portal.
- Database backend.
- User accounts, roles, billing, or subscriptions for TenantScope itself.
- Storing client secrets in scheduled task command arguments.
- Mobile app.
- Real-time monitoring agent on endpoints.

## Phase 2+ Ideas

- Safer scheduled collection using certificate-first authentication.
- Stronger shared collector contract validation.
- Trend history with atomic retention and corruption recovery.
- Optional MSClaw integration for governed remediation workflows.
- Deeper accessibility improvements for dashboard charts and keyboard workflows.
- Standard collector schema enforcement and generated collector tests.

## Revision History

| Date | Change | Who |
|------|--------|-----|
| 2026-03-13 | Initial scaffold | project-init |
| 2026-04-26 | Replaced template placeholders with TenantScope MVP scope | Codex |
