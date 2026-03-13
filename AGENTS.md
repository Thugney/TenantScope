# AGENTS.md
# TenantScope
# Project context derived from the existing repository on 2026-03-13

---

## Project overview

TenantScope is a local-first Microsoft 365 tenant visibility toolkit for IT administrators and security teams. It uses PowerShell 7 plus Microsoft Graph SDK collectors to write tenant data to local JSON files and renders that data in a static vanilla JavaScript dashboard. This repository is already in active v2.x maintenance and feature expansion, so agents should preserve the shipped baseline before widening scope.

---

## Commands

- Install prerequisites: `Set-Location .\m365-toolkit; .\Install-Prerequisites.ps1`
- Run full collection: `Set-Location .\m365-toolkit; .\Invoke-DataCollection.ps1`
- Run collection with device code: `Set-Location .\m365-toolkit; .\Invoke-DataCollection.ps1 -UseDeviceCode`
- Build dashboard with live data: `Set-Location .\m365-toolkit; .\scripts\Build-Dashboard.ps1`
- Build dashboard with sample data: `Set-Location .\m365-toolkit; .\scripts\Build-Dashboard.ps1 -UseSampleData`
- Start local dashboard server: `Set-Location .\m365-toolkit; .\scripts\Start-DashboardServer.ps1 -OpenBrowser`
- Test: Not yet determined. No committed automated test suite exists today; ask before adding or running one.
- Lint: Not yet determined. No committed linter command exists today; ask before adding or running one.

---

## Tech stack

- Language: PowerShell 7.x for collectors/build scripts; vanilla JavaScript, HTML, and CSS for the dashboard
- APIs: Microsoft Graph PowerShell SDK 2.x modules and Microsoft 365/Defender data sources
- Packaging: `TenantScope.psd1` and `TenantScope.psm1`
- Data storage: local JSON files in `m365-toolkit\data\`; sample JSON in `m365-toolkit\data\sample\`
- Dashboard architecture: static SPA with hash routing, generated `data-bundle.js`, and reusable page/helper modules
- Runtime: local admin workstation or optional internal shared server via `scripts\Start-DashboardServer.ps1`
- Release metadata: root `VERSION` and `CHANGELOG.md`

---

## Project structure

```text
.
|-- AGENTS.md
|-- MVP.md
|-- PLAN.md
|-- CHANGELOG.md
|-- VERSION
|-- m365-toolkit/
|   |-- Install-Prerequisites.ps1
|   |-- Invoke-DataCollection.ps1
|   |-- TenantScope.psd1
|   |-- TenantScope.psm1
|   |-- collectors/      # Graph/M365 workload collectors
|   |-- lib/             # Shared collector helpers and retry logic
|   |-- scripts/         # Dashboard build, server, scheduling
|   |-- dashboard/       # Static HTML/CSS/JS application
|   |-- data/            # Runtime data (gitignored except sample data)
|   |-- docs/            # Architecture, auth, usage, licensing docs
|   +-- config.sample.json
|-- .claude/skills/      # Canonical project skills
+-- .agents/skills/      # Agent-readable links to .claude skills
```

---

## Code style

- Keep PowerShell entry scripts and collectors compatible with PowerShell 7 and preserve `#Requires -Version 7.0` where already used.
- Prefer advanced scripts/functions with `[CmdletBinding()]`, explicit `param()` blocks, named parameters, and validated inputs.
- Fail loudly. Use `try/catch`, explicit validation, and standardized result objects instead of silent continuation.
- Preserve collector output contracts. If JSON field names or shapes change, update the matching dashboard consumers and sample data in the same change.
- Treat `m365-toolkit\data\`, `m365-toolkit\dashboard\data\`, and generated `dashboard\js\data-bundle.js` as build/runtime outputs, not hand-maintained source.
- In dashboard JavaScript, follow the existing vanilla module pattern (`page-*.js`, shared helpers, `window` globals) rather than introducing a framework or bundler.
- Keep the product local-first. Do not add cloud backends, telemetry, or external services without explicit approval.
- Comments should explain Graph quirks, retry logic, or data-shaping decisions, not simple assignments.
- Never hardcode tenant identifiers, credentials, tokens, or real customer data in tracked files.

---

## Git

- Main branch: `main` - never commit directly
- Preferred working branches: `feature/<name>`, `fix/<name>`, `chore/<name>`
- Current workspace branch may still be `main`; create or switch to a topic branch before committing
- Commit format: Conventional Commits

```text
<type>(<scope>): <description>

feat:     new feature
fix:      bug fix
chore:    tooling, deps, config
docs:     documentation only
refactor: no behavior change
test:     adding or fixing tests
```

Rules:
- Always ask before committing unless explicitly told to commit
- Run the relevant validation before every commit; minimum expectation is a sample dashboard build for UI changes
- Never commit: `config.json`, collected tenant JSON, secrets, duplicated `CLAUDE.md`, or local tool settings
- Keep `VERSION` and `CHANGELOG.md` aligned for user-facing releases
- Never push to main directly
- PR title = same format as commit message

---

## Testing

- No committed automated test harness exists yet.
- Minimum manual validation for dashboard or front-end changes: `Set-Location .\m365-toolkit; .\scripts\Build-Dashboard.ps1 -UseSampleData`
- For collector, authentication, or build-script changes, validate the affected PowerShell path directly and use live tenant testing on the designated validation machine when appropriate.
- Before any commit, confirm there are no new PowerShell errors or warnings and that the affected dashboard pages still load with the relevant data.
- If automated tests or linting are added later, update this file with the canonical commands immediately.

---

## Environment

- No required environment variables are documented today.
- Primary configuration file: `m365-toolkit\config.json`, typically created from `m365-toolkit\config.sample.json`
- Optional auth inputs are passed as script parameters: `-ClientId`, `-CertificateThumbprint`, `-ClientSecret`, `-UseDeviceCode`
- Keep live tenant data only under `m365-toolkit\data\` and keep it out of git

---

## Boundaries

- Do not build features outside the documented local-first M365 toolkit scope without asking
- Do not install new dependencies or PowerShell modules without asking
- Do not refactor working collectors or dashboard pages unless asked or required for the change
- Do not modify `config.json` or tenant-specific values unless the user explicitly requests it
- Do not commit collected tenant data, credentials, tokens, or exported reports
- Do not add hosted services, databases, or write-back remediation actions without approval
- Ask before changes that affect more than 3 files unless the user explicitly requested a scaffold or broad update
- Read `MVP.md` before starting a new feature

---

## Open questions

- [ ] Confirm the canonical branch strategy for agent work: topic branches off `main`, or a `develop` integration branch
- [ ] Decide whether to introduce Pester and PSScriptAnalyzer, or keep manual sample/live validation as the primary gate for now
- [ ] Confirm the next milestone priority: more collectors/pages, reliability hardening, or packaging/release automation

---

## Skills

Available agent skills for this project (in `.claude/skills/` and `.agents/skills/`):

- `code-review` - structured review of PowerShell and dashboard changes before commit
- `refactor` - safe behavior-preserving refactors for collectors, shared libraries, and dashboard modules
- `git-workflow` - branch, validation, and commit hygiene for this repository
- `release` - version, changelog, validation, and release preparation workflow
