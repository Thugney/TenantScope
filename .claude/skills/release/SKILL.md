---
name: release
description: Prepare and validate a TenantScope release by checking versioning, changelog, sample-data build, and live-validation requirements before tagging.
---

# release

Use this when the user asks to cut a version, update `VERSION`, or prepare release notes.

## Steps

1. Confirm the target version and the set of changes included in the release.
2. Update `VERSION` and `CHANGELOG.md` together. Make sure release notes reflect user-visible collector, dashboard, or documentation changes.
3. Run release validation:
   - `Set-Location .\m365-toolkit; .\scripts\Build-Dashboard.ps1 -UseSampleData`
   - Any targeted script validation needed for changed collectors, auth flows, or build scripts
   - Live tenant validation on the designated machine when the change touches Graph collection or authentication
4. Review `git status` for generated outputs, real data, `CLAUDE.md`, and local settings before committing.
5. Prepare the release commit or tag only after the user approves.

## Rules

- Never release with untracked tenant data or secrets in the workspace.
- Do not bump the version without updating the changelog.
- Sample-data validation is the minimum gate, not the only gate.
- If live validation was skipped, record that explicitly in the release summary.
