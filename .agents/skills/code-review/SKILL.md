---
name: code-review
description: Review TenantScope changes for regressions, schema mismatches, security issues, and missing validation before commit.
---

# code-review

Use this before committing or when the user asks for a review.

## Steps

1. Identify the files under review. Prefer staged changes; otherwise review the files the user named or the files touched in the task.
2. Check PowerShell changes for parameter handling, Graph query behavior, retry/error paths, JSON output schema changes, and secret exposure.
3. Check dashboard changes for broken script load order, global symbol assumptions, filter/table regressions, and mismatches with sample or live data files.
4. Verify validation evidence. At minimum, expect a sample dashboard build for UI changes and note when live tenant validation is still needed for collector or auth changes.
5. Report findings by severity: blocking, warning, suggestion. Do not auto-fix during the review unless the user explicitly asks.

## Rules

- Focus on bugs, regressions, security, and missing validation before style nits.
- Flag any JSON field or shape change that is not matched by dashboard and sample-data updates.
- Flag any real tenant data, credentials, tokens, or exports that appear in tracked files.
- Mention testing gaps explicitly when there is no automated coverage.
- If nothing material is wrong, say so and note any residual risk.
