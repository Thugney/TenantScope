---
name: refactor
description: Safely refactor TenantScope PowerShell or dashboard code without changing observable behavior.
---

# refactor

Use this when simplifying collectors, shared libraries, or dashboard modules without changing product behavior.

## Steps

1. Define the exact behavior that must remain unchanged and the files that prove it.
2. Run the cheapest relevant validation first: sample dashboard build for UI changes, targeted script execution or help inspection for PowerShell changes, and broader validation if shared auth or collector code is affected.
3. Make one refactor at a time. Keep public script parameters, generated file names, and JSON shapes stable.
4. Re-run the relevant validation after each change.
5. Stop and restore behavior if validation fails or a schema change leaks into the dashboard.

## Rules

- Do not mix refactors with new features or intentional data-model changes.
- Preserve documented entry points and commands unless the user asked to redesign them.
- Treat `data\`, `dashboard\data\`, and generated `dashboard\js\data-bundle.js` as outputs, not refactor targets.
- If the repo lacks automated tests for the affected area, state the manual validation used.
