# TenantScope Remediation MVP Roadmap

**Goal**: Transform TenantScope from read-only dashboard to actionable security tool

---

## Current State (v2.2.0)
- 36 collectors gathering comprehensive M365 data
- Cross-entity navigation and deep links to admin portals
- Problems page aggregating 35+ issue categories
- **100% read-only** - no remediation capabilities

## Target State (v3.0.0)
- Direct remediation actions from dashboard
- Bulk operations on findings
- PowerShell script generation for complex tasks
- Audit trail of remediation actions

---

## MVP Phase 1: Script Generation (2-3 days)

### Goal
Generate ready-to-run PowerShell commands for common remediation tasks.

### Implementation
Create `dashboard/js/remediation-scripts.js`:

```javascript
var RemediationScripts = (function() {
    'use strict';

    return {
        // Device remediation
        syncDevice: function(deviceId) {
            return 'Invoke-MgDeviceManagementManagedDeviceSyncDevice -ManagedDeviceId "' + deviceId + '"';
        },

        enableBitLocker: function(deviceId) {
            return 'Invoke-MgDeviceManagementManagedDeviceRotateBitLockerKey -ManagedDeviceId "' + deviceId + '"';
        },

        retireDevice: function(deviceId) {
            return 'Invoke-MgDeviceManagementManagedDeviceRetire -ManagedDeviceId "' + deviceId + '"';
        },

        wipeDevice: function(deviceId) {
            return 'Invoke-MgDeviceManagementManagedDeviceWipe -ManagedDeviceId "' + deviceId + '"';
        },

        // User remediation
        blockUser: function(userId) {
            return 'Update-MgUser -UserId "' + userId + '" -AccountEnabled:$false';
        },

        resetPassword: function(userId) {
            return 'Reset-MgUserAuthenticationMethodPassword -UserId "' + userId + '"';
        },

        revokeSessions: function(userId) {
            return 'Revoke-MgUserSignInSession -UserId "' + userId + '"';
        },

        requireMfaReregistration: function(userId) {
            return 'Reset-MgUserAuthenticationMethod -UserId "' + userId + '"';
        },

        // Bulk operations
        bulkSyncDevices: function(deviceIds) {
            return deviceIds.map(function(id) {
                return 'Invoke-MgDeviceManagementManagedDeviceSyncDevice -ManagedDeviceId "' + id + '"';
            }).join('\n');
        },

        bulkBlockUsers: function(userIds) {
            return '$userIds = @("' + userIds.join('","') + '")\n' +
                   '$userIds | ForEach-Object { Update-MgUser -UserId $_ -AccountEnabled:$false }';
        }
    };
})();
```

### UI Changes
Add "Copy Command" button next to Quick Actions in modals:
- Device modal: Sync, Rotate BitLocker, Retire
- User modal: Block, Reset Password, Revoke Sessions

---

## MVP Phase 2: Bulk Selection (3-4 days)

### Goal
Select multiple items from tables and generate bulk commands.

### Implementation
1. Add checkbox column to device/user tables
2. Add "Select All" header checkbox
3. Add floating action bar when items selected
4. Generate bulk PowerShell script

### UI Pattern
```
[ ] Select All | 47 devices selected
[Sync Selected] [Export CSV] [Generate Script]
```

### Files to Modify
- `dashboard/js/tables.js` - Add checkbox column support
- `dashboard/js/page-devices.js` - Add selection state
- `dashboard/js/page-users.js` - Add selection state
- `dashboard/css/style.css` - Floating action bar

---

## MVP Phase 3: Direct Graph API Actions (1-2 weeks)

### Goal
Execute remediation directly from dashboard (requires elevated permissions).

### Prerequisites
- App registration with write permissions
- Certificate-based authentication
- Secure token storage

### Implementation
Create `scripts/Invoke-Remediation.ps1`:

```powershell
param(
    [Parameter(Mandatory)]
    [ValidateSet('SyncDevice','RetireDevice','BlockUser','ResetPassword','RevokeSessions')]
    [string]$Action,

    [Parameter(Mandatory)]
    [string]$TargetId,

    [string]$TenantId,
    [string]$ClientId,
    [string]$CertificateThumbprint
)

# Connect with certificate auth
Connect-MgGraph -TenantId $TenantId -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint

switch ($Action) {
    'SyncDevice' {
        Invoke-MgDeviceManagementManagedDeviceSyncDevice -ManagedDeviceId $TargetId
    }
    'BlockUser' {
        Update-MgUser -UserId $TargetId -AccountEnabled:$false
    }
    # ... other actions
}

# Log action for audit
$auditEntry = @{
    timestamp = Get-Date -Format 'o'
    action = $Action
    targetId = $TargetId
    executedBy = $env:USERNAME
}
$auditEntry | ConvertTo-Json | Add-Content -Path "$PSScriptRoot/../data/remediation-audit.json"
```

### Dashboard Integration
Add API endpoint in `Start-DashboardServer.ps1`:
```
POST /api/remediate
{
    "action": "SyncDevice",
    "targetId": "device-guid-here"
}
```

---

## MVP Phase 4: Remediation Tracking (1 week)

### Goal
Track remediation actions and verify completion.

### Implementation
1. Create `data/remediation-queue.json` for pending actions
2. Create `data/remediation-history.json` for completed actions
3. Add "Pending Remediations" widget to Overview page
4. Add verification check (re-query Graph after action)

### Data Structure
```json
{
    "id": "rem-001",
    "action": "SyncDevice",
    "targetId": "device-guid",
    "targetName": "DESKTOP-ABC123",
    "requestedBy": "admin@contoso.com",
    "requestedAt": "2026-02-08T10:30:00Z",
    "status": "pending|completed|failed",
    "completedAt": null,
    "verificationResult": null
}
```

---

## Remediation Actions by Entity

### Device Actions
| Action | Graph API | Risk Level |
|--------|-----------|------------|
| Sync Device | `POST /deviceManagement/managedDevices/{id}/syncDevice` | Low |
| Rotate BitLocker | `POST /deviceManagement/managedDevices/{id}/rotateBitLockerKeys` | Low |
| Restart Device | `POST /deviceManagement/managedDevices/{id}/rebootNow` | Medium |
| Retire Device | `POST /deviceManagement/managedDevices/{id}/retire` | High |
| Wipe Device | `POST /deviceManagement/managedDevices/{id}/wipe` | Critical |

### User Actions
| Action | Graph API | Risk Level |
|--------|-----------|------------|
| Block Sign-In | `PATCH /users/{id}` (accountEnabled: false) | Medium |
| Reset Password | `POST /users/{id}/authentication/methods/{id}/resetPassword` | Medium |
| Revoke Sessions | `POST /users/{id}/revokeSignInSessions` | Low |
| Require MFA Re-reg | `DELETE /users/{id}/authentication/methods/{methodId}` | Medium |
| Disable User | `PATCH /users/{id}` (accountEnabled: false) | High |

### Team/SharePoint Actions
| Action | Graph API | Risk Level |
|--------|-----------|------------|
| Archive Team | `POST /teams/{id}/archive` | Medium |
| Remove Guest | `DELETE /groups/{id}/members/{userId}/$ref` | Low |
| Disable External Sharing | SharePoint Admin API | Medium |

---

## Permission Requirements

### Read-Only (Current)
```
DeviceManagementManagedDevices.Read.All
User.Read.All
Directory.Read.All
SecurityEvents.Read.All
```

### With Remediation (MVP Phase 3+)
```
DeviceManagementManagedDevices.ReadWrite.All
User.ReadWrite.All
Directory.ReadWrite.All
SecurityActions.ReadWrite.All
```

---

## Timeline Summary

| Phase | Effort | Value | Prerequisites |
|-------|--------|-------|---------------|
| **Phase 1: Script Generation** | 2-3 days | Copy commands, paste to run | None |
| **Phase 2: Bulk Selection** | 3-4 days | Handle 50+ items at once | Phase 1 |
| **Phase 3: Direct Actions** | 1-2 weeks | One-click remediation | Write permissions |
| **Phase 4: Tracking** | 1 week | Audit trail, verification | Phase 3 |

**Recommended MVP**: Phase 1 + Phase 2 = **1 week of development**
- Provides immediate value
- No permission changes needed
- Safe (scripts reviewed before execution)

---

## Quick Win: Phase 1 Implementation Checklist

- [ ] Create `remediation-scripts.js` module
- [ ] Add "Copy Command" buttons to device modal
- [ ] Add "Copy Command" buttons to user modal
- [ ] Add command preview modal with syntax highlighting
- [ ] Add bulk script generation from Problems page
- [ ] Update CHANGELOG

---

*Created: 2026-02-08*
