# Secure Score Collector Review

**Collector**: `collectors/Get-SecureScoreData.ps1`  
**Dashboard pages**: Security, Overview, Executive Report

## Status
PASS

## Required Dashboard Fields (Secure Score)
`scorePct`, `maxScore`, `currentScore`,  
`controlScores[].name`, `controlScores[].description`,  
`controlScores[].scoreInPercentage`, `controlScores[].potentialPoints`,  
`controlScores[].isComplete`

## Collector Coverage
- All required fields above are produced.
- `scorePct` is computed from `currentScore / maxScore` and rounded to whole percent for the UI.
- `controlScores` includes both incomplete and complete controls; incomplete controls are sorted by potential points first.
- Uses live Graph data (no sample/static data paths).

## Status Update (2026-02-07)
- Resolved: Collector now requests the latest score using `orderby=createdDateTime desc` with a safe fallback if ordering is unsupported.

## Graph Collection Details
- Endpoint: `GET /security/secureScores?$top=1` (with orderby fallback).
- Required scopes: `SecurityEvents.Read.All`.
- Output file: `data/secure-score.json` (null if no data is returned).

## Risks / Notes
- If Secure Score is unavailable (licensing/permissions), collector writes `null` so the dashboard can render safely.
- Duplicate code check: no duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).
