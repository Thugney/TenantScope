# Enterprise Apps Collector Review

**Collector**: `collectors/Get-EnterpriseAppData.ps1`  
**Dashboard pages**: Enterprise Apps

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (Enterprise Apps)
**App rows**
`id`, `appId`, `displayName`, `accountEnabled`, `publisher`, `isMicrosoft`, `appType`,  
`createdDateTime`, `hasCredentials`, `secretCount`, `certificateCount`,  
`nearestExpiryDays`, `credentialStatus`, `secrets[]`, `certificates[]`,  
`owners[]`, `ownerCount`, `tags`, `replyUrls`, `loginUrl`, `notes`,  
`appRoleAssignmentRequired`, `verifiedPublisher`, `verifiedPublisherDate`

**Summary**
`totalApps`, `microsoftApps`, `thirdPartyApps`, `enabledApps`, `disabledApps`,  
`appsWithSecrets`, `appsWithCertificates`, `appsWithNoCredentials`,  
`expiredCredentials`, `criticalIn7Days`, `warningIn30Days`, `attentionIn90Days`, `healthyCredentials`,  
`appsWithOwners`, `orphanedApps`, `appsByType`

## Collector Coverage
- All required fields above are produced.
- Credential status and `nearestExpiryDays` are computed from app registration secrets/certs.
- Uses live Graph data (no sample/static data paths).

## Graph Collection Details
- Endpoints:
  - `GET /applications` (app registrations; credentials)
  - `GET /servicePrincipals` (enterprise apps + owners)
- Required scopes: `Application.Read.All`, `Directory.Read.All`.
- Output file: `data/enterprise-apps.json`.

## Risks / Notes
- Credential expiry logic now uses shared `Get-CredentialStatus` (duplicate removed).
- Publisher classification is heuristic (Microsoft org ID or publisher name).
- Owner expansion can be restricted; owners may be empty without breaking UI.

## Duplicate Code Check
- Credential expiry status logic now uses shared `Get-CredentialStatus` (duplicate removed).

## UI Notes
- Resolved (2026-02-07): donut segments now include Expired/Critical/Warning/Attention/Healthy; No Creds is listed without a dot.
