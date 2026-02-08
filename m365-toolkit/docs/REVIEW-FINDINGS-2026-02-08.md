# TenantScope Gap Analysis - Review Findings
**Date:** 2026-02-08
**Reviewers:** 5 Agent Specialists (Device, User, Data Architect, Devil's Advocate, Collaboration)

## Executive Summary

TenantScope collects comprehensive M365 data (30+ collectors) but fails to **connect** it into a true single-pane-of-glass experience. Data is siloed by page with minimal cross-referencing.

| Aspect | Score | Status |
|--------|-------|--------|
| Data Collection | 8/10 | Excellent |
| UI/Presentation | 7/10 | Good |
| Detail Drill-Downs | 3/10 | Poor |
| Cross-Referencing | 2/10 | Failing |
| Actionability | 1/10 | Failing (deferred) |

---

## Critical Finding: Data Collected But Not Displayed

### User Detail Modal - Missing Data (ALREADY COLLECTED)

| Data | Source File | Current Display | Gap |
|------|-------------|-----------------|-----|
| Assigned Licenses (full details) | users.json | Count only | Show SKU names, service plans |
| MFA Methods | mfa-status.json | Yes/No boolean | Show registered methods |
| Sign-In Logs | signin-logs.json | Not linked | Filter by userId, show recent |
| Risk Detections | identity-risk-data.json | Not linked | Show risk level, detections |
| Admin Roles | admin-roles.json | Flag only | Show role names, PIM status |
| Devices Owned | devices.json | Count + link | Show device names inline |
| Teams Membership | teams.json | Not linked | Show teams user owns/member of |
| Groups | Not collected | N/A | Need new collector |

### Device Detail Modal - Missing Data (ALREADY COLLECTED)

| Data | Source File | Current Display | Gap |
|------|-------------|-----------------|-----|
| Compliance Policies | devices.json | Count only | Show policy names, status |
| Configuration Profiles | configuration-profiles.json | Not linked | Filter by deviceId |
| BitLocker Status | bitlocker-status.json | Not linked | Show encryption, recovery key status |
| Windows Update | windows-update-status.json | Not linked | Show update ring, status |
| Vulnerabilities | vulnerabilities.json | Not linked | Filter by deviceName |
| Sign-In History | signin-logs.json | Not linked | Filter by deviceDetail |
| App Deployments | app-deployments.json | Not linked | Filter by device |
| Defender Alerts | defender-alerts.json | Not linked | Filter by device |
| ASR Rules | asr-rules.json | Not linked | Show per-device status |

### Teams/SharePoint - Missing Links

| From | To | Link Field | Gap |
|------|-----|------------|-----|
| Team | SharePoint Site | linkedSharePointSiteId | Shows ID only, no navigation |
| SharePoint | Team | groupId | No link back to team |
| Team | Guest Members | hasGuests flag | No guest details (email, access) |
| Team | Owners | ownerUpns array | Shows UPNs, not clickable |

---

## Architecture Gap: No Relationship Layer

Current: Each page loads its own data array, no cross-referencing.

```
users[] ─────────── devices[] ─────────── vulnerabilities[]
   │                    │                        │
   └── No link ──────── No link ──────────── No link
```

Needed: Relationship layer that connects entities by ID.

```javascript
// Proposed: data-relationships.js
getUserProfile(userId) {
  return {
    user: users.find(u => u.id === userId),
    devices: devices.filter(d => d.userId === userId),
    signIns: signinLogs.filter(s => s.userId === userId),
    risks: riskyUsers.filter(r => r.id === userId),
    roles: adminRoles.filter(r => r.principalId === userId),
    mfa: mfaStatus.find(m => m.id === userId)
  }
}
```

---

## Priority Fixes

### Phase 1: Quick Wins (Expand Detail Modals)
- [ ] User modal: Show license names, not just count
- [ ] User modal: Show MFA methods from mfa-status.json
- [ ] User modal: Link to sign-in logs (filtered)
- [ ] User modal: Show risk level from identity-risk
- [ ] User modal: Show admin roles from admin-roles.json
- [ ] Device modal: Show compliance policy names
- [ ] Device modal: Show BitLocker status
- [ ] Device modal: Show Windows Update status
- [ ] Device modal: Link to vulnerabilities
- [ ] Device modal: Link to sign-in history

### Phase 2: Bidirectional Navigation
- [ ] Teams → SharePoint: Click to see site details
- [ ] SharePoint → Teams: Click to see team details
- [ ] User → Devices: Show device cards inline
- [ ] Device → User: Show user card inline
- [ ] Vulnerability → Devices: Show affected devices

### Phase 3: Relationship Layer
- [ ] Create data-relationships.js module
- [ ] Build index maps for O(1) lookups
- [ ] getUserProfile() function
- [ ] getDeviceProfile() function
- [ ] getTeamProfile() function

### Phase 4: Enhanced UI
- [ ] Tabbed detail modals (Overview/Security/Compliance/Activity)
- [ ] Problem Summary dashboard page
- [ ] Cross-entity search improvements

### Phase 5: New Data Collection
- [ ] Team guest member details (GET /teams/{id}/members)
- [ ] User group memberships (GET /users/{id}/memberOf)
- [ ] Direct reports (reverse manager lookup)

### Deferred: Actionability
- [ ] Remediation workflows (future version)
- [ ] Bulk actions (future version)
- [ ] Integration with Graph for write operations (future version)

---

## Files to Modify

| File | Changes Needed |
|------|----------------|
| dashboard/js/page-users.js | Expand detail modal with related data |
| dashboard/js/page-devices.js | Expand detail modal with related data |
| dashboard/js/page-teams.js | Add SharePoint navigation, guest details |
| dashboard/js/page-sharepoint.js | Add Teams navigation |
| dashboard/js/page-vulnerabilities.js | Add affected devices drill-down |
| dashboard/js/data-loader.js | Add relationship building |
| NEW: dashboard/js/data-relationships.js | Cross-entity lookups |
| NEW: dashboard/js/page-problems.js | Problem summary dashboard |

---

## Success Criteria

When complete, an endpoint specialist should be able to:
1. Click any device → See owner, compliance policies, vulnerabilities, sign-ins, apps
2. Click any user → See licenses, devices, MFA methods, risks, admin roles, sign-ins
3. Click any team → See SharePoint site, owners, guests, activity
4. Click any vulnerability → See all affected devices
5. View a "Problems" summary → See all critical issues across all data types

---

*This document generated from 5-agent parallel analysis on 2026-02-08*

---

## Implementation Status

**See: [IMPLEMENTATION-LOG-2026-02-08.md](IMPLEMENTATION-LOG-2026-02-08.md) for completed implementation details.**

All items in Phases 1-4 have been implemented. Phase 5 (new collectors) and Actionability are deferred.
