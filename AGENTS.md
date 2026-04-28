# TenantScope Agent Guide

## Project Overview

TenantScope is a local-first Microsoft 365 tenant posture collector. It uses PowerShell collectors and Microsoft Graph to produce local JSON data, then renders a static dashboard for identity, security, device, application, licensing, collaboration, and compliance visibility.

The product code lives under `m365-toolkit`. Root-level files hold project context, release metadata, and planning docs.

## Commands

- Install prerequisites: `pwsh -File .\m365-toolkit\Install-Prerequisites.ps1`
- Collect tenant data: `pwsh -File .\m365-toolkit\Invoke-DataCollection.ps1`
- Collect selected data: `pwsh -File .\m365-toolkit\Invoke-DataCollection.ps1 -CollectorsToRun @("DeviceData","UserData")`
- Build dashboard: `pwsh -File .\m365-toolkit\scripts\Build-Dashboard.ps1`
- Build dashboard with sample data: `pwsh -File .\m365-toolkit\scripts\Build-Dashboard.ps1 -UseSampleData`
- Test syntax: parse changed `.ps1` files with the PowerShell AST parser before committing.

## Tech Stack

- PowerShell 7+ collectors and orchestration scripts
- Microsoft Graph PowerShell SDK
- Static HTML, CSS, and vanilla JavaScript dashboard
- Local JSON artifacts under `m365-toolkit\data`
- No backend service and no cloud data storage

## Project Structure

```text
TenantScope\
|-- AGENTS.md
|-- CHANGELOG.md
|-- CONTEXT.md
|-- MVP.md
|-- PLAN.md
|-- VERSION
+-- m365-toolkit\
    |-- Invoke-DataCollection.ps1
    |-- Install-Prerequisites.ps1
    |-- TenantScope.psd1
    |-- TenantScope.psm1
    |-- collectors\
    |-- dashboard\
    |-- data\
    |-- docs\
    |-- lib\
    |-- scripts\
    +-- tools\
```

## Code Style

- Use PowerShell 7 syntax and Windows paths.
- Keep collectors read-only. Do not add tenant write-back behavior without explicit approval.
- Reuse `m365-toolkit\lib\CollectorBase.ps1` helpers for Graph retry, pagination, date handling, result creation, and JSON writes.
- Use `Invoke-GraphWithRetry` or `Get-GraphAllPages` for Graph calls unless there is a documented reason not to.
- Collector outputs should be consistent JSON objects with data arrays, `summary`, `insights`, and a timestamp field where practical.
- Dashboard code is vanilla JavaScript. Escape tenant-provided values before rendering HTML.
- Keep generated data, secrets, `.env` files, and tenant exports out of git.

## Git

- Main branch: `main` - never commit directly.
- Working branch: `develop`.
- Feature branches: `feature/<name>`.
- Fix branches: `fix/<name>`.
- Chore branches: `chore/<name>`.
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Ask before committing or pushing unless the user explicitly says to commit or push.

## Testing

- Parse changed PowerShell files with the AST parser.
- Build the dashboard after dashboard JavaScript or CSS changes.
- Run targeted collectors only when tenant access is available and the user expects live Graph calls.
- Do not run full tenant collection casually; it can take time and requires Graph permissions.

## Environment

Required local configuration is `m365-toolkit\config.json`, usually created from `m365-toolkit\config.sample.json`.

Expected values include:

- `tenantId`
- `domains.employees`
- `domains.students`
- `thresholds.inactiveDays`
- Optional authentication inputs passed as parameters: `ClientId`, `CertificateThumbprint`, or `ClientSecret`

Never commit real tenant IDs if they are sensitive, secrets, certificates, exported tenant data, or generated dashboard data.

## Boundaries

- Do not build write-back remediation into TenantScope without explicit product approval.
- Do not modify `.env`, secrets, certificates, or live tenant exports.
- Do not add dependencies that duplicate existing PowerShell or dashboard helpers.
- Treat `m365-toolkit\data` and built dashboard bundles as runtime output.
- Read `MVP.md` before starting new feature work.

## Skills

- Use `project-init` only when starting or retrofitting a separate project scaffold.
- Use `internal-security-tools-engineer` guidance when changes touch internal Microsoft security or endpoint admin workflows.
