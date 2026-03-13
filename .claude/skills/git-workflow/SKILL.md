---
name: git-workflow
description: Enforce TenantScope branch, validation, and commit hygiene before any git operation.
---

# git-workflow

Use this before committing, opening a PR, or preparing a release.

## Steps

1. Confirm you are not committing directly to `main`; create or switch to a topic branch first unless the user explicitly overrides.
2. Review `git status` for unrelated changes, generated data, `CLAUDE.md`, and local tool settings. Do not mix unrelated work.
3. Run the relevant validation for the changed area. Minimum expectation is a sample dashboard build for UI changes and targeted validation for PowerShell changes.
4. Prepare a Conventional Commit message that matches the change type.
5. Ask the user before `git commit`, and never push without explicit instruction.

## Rules

- Never commit `config.json`, collected tenant JSON, credentials, tokens, dashboard exports, duplicated `CLAUDE.md`, or local settings files.
- Keep `VERSION` and `CHANGELOG.md` aligned for user-facing releases.
- If live tenant validation is required but not run, call that out before the commit.
- Do not use force push or destructive git commands without explicit approval.
