# TenantScope - Project Context

## What this project is

Local-first Microsoft 365 tenant visibility toolkit.
The real product lives under `m365-toolkit\` and combines PowerShell collectors,
shared helper modules, static dashboard code, and dashboard build scripts.
This repo also keeps release metadata and project-level agent docs at the root.

GitHub: https://github.com/Thugney/TenantScope

---

## Actual folder structure

```text
J:\workspace-full\projects\TenantScope\
|-- CONTEXT.md
|-- AGENTS.md
|-- CLAUDE.md
|-- MVP.md
|-- PLAN.md
|-- CHANGELOG.md
|-- SECURITY-CONSIDERATIONS.md
|-- VERSION
+-- m365-toolkit\
    |-- Install-Prerequisites.ps1
    |-- Invoke-DataCollection.ps1
    |-- TenantScope.psd1
    |-- TenantScope.psm1
    |-- collectors\
    |-- lib\
    |-- scripts\
    |-- dashboard\
    |-- docs\
    |-- data\
    |-- tools\
    +-- config.sample.json
```

---

## Routing table

| Task | Load | Skip |
|------|------|------|
| New collector or collector fix | this file + `m365-toolkit\collectors\` + `m365-toolkit\lib\` when needed | dashboard files |
| Dashboard UI or page logic | this file + `m365-toolkit\dashboard\` + relevant script in `m365-toolkit\scripts\` | collectors unless needed |
| Collection/build entry points | this file + `m365-toolkit\Install-Prerequisites.ps1`, `m365-toolkit\Invoke-DataCollection.ps1`, or `m365-toolkit\scripts\` | unrelated source |
| Auth, usage, or architecture docs | this file + `m365-toolkit\docs\` + `SECURITY-CONSIDERATIONS.md` | unrelated source |
| Release/version/planning work | this file + `VERSION`, `CHANGELOG.md`, `MVP.md`, `PLAN.md`, and `work\` when needed | runtime data |
| MSClaw integration | this file + `projects/Claw/CONTEXT.md` | unrelated repos |

---

## Tech stack

- PowerShell 7+ collectors and helper modules
- Microsoft Graph PowerShell SDK
- Static HTML, CSS, and JavaScript dashboard
- Local JSON data artifacts in `m365-toolkit\data\`
- Optional integration path into MSClaw collector-runner

---

## Rules

- Read-only collection only; do not add write-back behavior casually
- Treat `m365-toolkit\data\` and generated dashboard bundles as runtime/build output
- Keep live tenant data and secrets out of git
- Use `AGENTS.md` at the project root for deeper project-specific operational rules when working inside this repo
