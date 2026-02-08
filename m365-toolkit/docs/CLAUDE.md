# TenantScope

PowerShell-based data collection and dashboard for Microsoft 365 tenant security and lifecycle management.

## Architecture

```
Invoke-DataCollection.ps1 (orchestrator)
  -> collectors/*.ps1 (9 scripts, each writes JSON to data/)
  -> scripts/Build-Dashboard.ps1 (copies JSON + generates JS bundle)
  -> dashboard/index.html (vanilla HTML/CSS/JS, reads from data-bundle.js)
```

## Tech Stack

- PowerShell 7.0+ with Microsoft Graph SDK
- Vanilla HTML/CSS/JS (no frameworks)
- Microsoft Graph API (delegated auth for collection)

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `m365-toolkit/collectors/` | 9 PowerShell data collectors (Graph API) |
| `m365-toolkit/data/` | Collected JSON (gitignored) |
| `m365-toolkit/data/sample/` | Sample data for testing |
| `m365-toolkit/dashboard/` | Static HTML dashboard |
| `m365-toolkit/scripts/` | Utility scripts (build, schedule) |
| `m365-toolkit/tools/` | Operational tools (future: helpdesk portals, remediation) |

## Development Standards

Invoke `/project:security-engineer` for full engineering standards. Key rules:

- **PowerShell**: Norwegian `.SYNOPSIS`, English `.DESCRIPTION`, `Write-Log` to `C:\MK-LogFiles\`, try/catch, exit 0/1
- **No emojis** in code or output
- **No special chars** (ae/oe/aa) in variables or paths
- **Config-driven**: behavior in `config.json`, not hardcoded
- **Graph API**: exponential backoff retry (5 retries, 60s base)

## Version Control

- **Branching**: Trunk-based. Short-lived feature branches off `main`.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` new feature
  - `fix:` bug fix
  - `refactor:` code restructuring
  - `docs:` documentation
  - `chore:` maintenance, dependencies
- **Versioning**: Semantic versioning in `VERSION` file. Update `CHANGELOG.md` with every release.
- **Tags**: `v1.0.0` format on release commits.

## Config

`m365-toolkit/config.json` controls tenant ID, domain classification, thresholds (inactive/stale days), and dashboard metadata.
