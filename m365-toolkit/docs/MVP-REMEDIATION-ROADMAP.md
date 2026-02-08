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

## Enterprise Grade: Multi-User Deployment (Future)

> **Note**: The sections above (Phases 1-4) are for single-user/personal use. This section documents what's needed to make TenantScope enterprise-ready for multi-user deployment.

---

### Enterprise Phase 1: Authentication & Authorization (2-3 weeks)

#### 1.1 Azure AD Authentication
Replace anonymous access with Azure AD OAuth2/OIDC.

**Implementation:**
- Register app in Azure AD with redirect URI
- Implement MSAL.js for browser-based auth
- Add token acquisition and refresh logic
- Store tokens securely (no localStorage for access tokens)

**Files to Create:**
- `dashboard/js/auth.js` - MSAL wrapper
- `dashboard/login.html` - Login page with redirect

**Code Pattern:**
```javascript
var msalConfig = {
    auth: {
        clientId: "{app-client-id}",
        authority: "https://login.microsoftonline.com/{tenant-id}",
        redirectUri: window.location.origin
    }
};
var msalInstance = new msal.PublicClientApplication(msalConfig);
```

#### 1.2 Role-Based Access Control (RBAC)
Restrict access based on Azure AD roles or group membership.

**Roles to Define:**
| Role | Permissions |
|------|-------------|
| TenantScope.Viewer | Read-only access to all data |
| TenantScope.Operator | View + execute remediation scripts |
| TenantScope.Admin | Full access + settings + user management |

**Implementation:**
- Check Azure AD groups/roles on login
- Filter UI elements based on role
- Validate permissions server-side for all actions

**Files to Modify:**
- `Start-DashboardServer.ps1` - Add role validation
- `dashboard/js/app.js` - Add permission checks
- `config.json` - Add role-to-group mappings

---

### Enterprise Phase 2: Secure Transport (1 week)

#### 2.1 HTTPS with TLS 1.2+
Replace HTTP with HTTPS.

**Implementation Options:**

**Option A: Self-Signed Certificate (Internal Only)**
```powershell
# Generate self-signed cert
$cert = New-SelfSignedCertificate -DnsName "tenantscope.contoso.com" -CertStoreLocation "Cert:\LocalMachine\My"

# Update Start-DashboardServer.ps1
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("https://+:8443/")
# Bind certificate to port
netsh http add sslcert ipport=0.0.0.0:8443 certhash=$($cert.Thumbprint) appid='{app-guid}'
```

**Option B: Trusted CA Certificate (Production)**
- Obtain certificate from internal CA or public CA
- Install in Windows certificate store
- Bind to HTTPS listener

#### 2.2 Security Headers
Add HTTP security headers to all responses.

```powershell
$response.Headers.Add("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
$response.Headers.Add("X-Content-Type-Options", "nosniff")
$response.Headers.Add("X-Frame-Options", "DENY")
$response.Headers.Add("X-XSS-Protection", "1; mode=block")
$response.Headers.Add("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'")
$response.Headers.Add("Referrer-Policy", "strict-origin-when-cross-origin")
```

---

### Enterprise Phase 3: Audit Logging (1-2 weeks)

#### 3.1 Comprehensive Audit Trail
Log all user actions for compliance.

**Events to Log:**
- User login/logout
- Page views (what data was accessed)
- Search queries
- Export operations (CSV downloads)
- Remediation actions (who did what to which entity)
- Failed access attempts

**Log Format (JSON Lines):**
```json
{
    "timestamp": "2026-02-08T10:30:00.000Z",
    "eventType": "PageView",
    "user": "admin@contoso.com",
    "userRoles": ["TenantScope.Operator"],
    "ipAddress": "10.0.0.50",
    "userAgent": "Mozilla/5.0...",
    "action": "ViewDevice",
    "targetId": "device-guid",
    "targetName": "DESKTOP-ABC123",
    "details": { "tab": "security" }
}
```

#### 3.2 Log Destinations
- Local file: `data/audit-logs/YYYY-MM-DD.jsonl`
- Windows Event Log: Application log with custom source
- SIEM integration: Forward to Azure Sentinel, Splunk, etc.

**Files to Create:**
- `scripts/Write-AuditLog.ps1` - Centralized logging function
- `dashboard/js/audit-client.js` - Client-side event capture

---

### Enterprise Phase 4: Data Protection (1-2 weeks)

#### 4.1 Encryption at Rest
Encrypt sensitive data files.

**Implementation:**
```powershell
# Use DPAPI for Windows (per-machine or per-user)
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    [System.Text.Encoding]::UTF8.GetBytes($jsonData),
    $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)

# Or use Azure Key Vault for enterprise key management
$secret = Get-AzKeyVaultSecret -VaultName "TenantScopeVault" -Name "DataEncryptionKey"
```

**Files to Encrypt:**
- `data/users.json` (contains PII)
- `data/signin-logs.json` (contains IP addresses)
- `data/remediation-audit.json` (contains action history)

#### 4.2 Data Minimization
Remove unnecessary PII from collection.

**Fields to Remove/Hash:**
- Phone numbers (remove entirely)
- Physical addresses (remove entirely)
- Manager email (keep ID only, resolve on display)

**Config Option:**
```json
{
    "dataMinimization": {
        "collectPhoneNumbers": false,
        "collectAddresses": false,
        "hashUserNames": false
    }
}
```

---

### Enterprise Phase 5: High Availability & Scalability (2-4 weeks)

#### 5.1 Database Backend
Replace JSON files with database for large tenants (10K+ users).

**Options:**
| Database | Use Case | Effort |
|----------|----------|--------|
| SQLite | Single server, <50K users | Low |
| SQL Server | Enterprise, multi-server | Medium |
| Azure Cosmos DB | Cloud-native, global scale | High |

**Schema Design:**
```sql
-- Users table
CREATE TABLE Users (
    Id NVARCHAR(36) PRIMARY KEY,
    DisplayName NVARCHAR(256),
    UserPrincipalName NVARCHAR(256),
    RiskLevel NVARCHAR(50),
    LastSignIn DATETIME2,
    CollectionDate DATETIME2
);

-- Create indexes for common queries
CREATE INDEX IX_Users_RiskLevel ON Users(RiskLevel);
CREATE INDEX IX_Users_CollectionDate ON Users(CollectionDate);
```

#### 5.2 Load Balancing
Deploy multiple dashboard instances behind load balancer.

**Architecture:**
```
                    ┌─────────────────┐
                    │  Azure AD Auth  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Load Balancer  │
                    │  (Azure/NGINX)  │
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼───────┐ ┌───▼───┐ ┌───────▼───────┐
      │ TenantScope 1 │ │  ...  │ │ TenantScope N │
      └───────┬───────┘ └───┬───┘ └───────┬───────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │  Shared DB/     │
                    │  File Storage   │
                    └─────────────────┘
```

#### 5.3 Collection Service
Separate data collection from dashboard serving.

**Components:**
- **Collection Worker**: Runs on schedule, writes to shared storage
- **Dashboard Server**: Serves UI, reads from shared storage
- **API Gateway**: Handles auth, rate limiting, routing

---

### Enterprise Phase 6: Monitoring & Operations (1-2 weeks)

#### 6.1 Health Checks
Add health check endpoints for monitoring.

**Endpoints:**
```
GET /health          → 200 OK if service is running
GET /health/detailed → JSON with component status
GET /health/ready    → 200 OK if data is fresh (<24h)
```

**Response:**
```json
{
    "status": "healthy",
    "timestamp": "2026-02-08T10:30:00Z",
    "components": {
        "dataFreshness": { "status": "ok", "lastCollection": "2026-02-08T06:00:00Z" },
        "diskSpace": { "status": "ok", "freeGB": 50 },
        "memoryUsage": { "status": "ok", "usedMB": 512 }
    }
}
```

#### 6.2 Metrics & Alerting
Export metrics for observability.

**Metrics to Track:**
- Collection duration per collector
- Collection success/failure rate
- Dashboard response times
- Active user sessions
- Data age (hours since last collection)

**Integration Options:**
- Prometheus endpoint (`/metrics`)
- Azure Monitor / Application Insights
- Custom webhook alerts

#### 6.3 Automated Collection
Schedule collection via enterprise scheduler.

**Options:**
- Windows Task Scheduler (current, single-server)
- Azure Automation Runbooks (cloud-native)
- GitHub Actions / Azure DevOps (CI/CD integrated)

---

### Enterprise Deployment Checklist

#### Pre-Deployment
- [ ] Azure AD app registration with appropriate permissions
- [ ] Certificate obtained and installed (HTTPS)
- [ ] RBAC roles defined and groups created
- [ ] Data retention policy defined
- [ ] Audit log destination configured

#### Infrastructure
- [ ] Server provisioned with PowerShell 7.0+
- [ ] Network access configured (firewall rules)
- [ ] Load balancer configured (if HA required)
- [ ] Shared storage configured (if multi-instance)
- [ ] Monitoring configured (health checks, alerts)

#### Security
- [ ] HTTPS enabled with TLS 1.2+
- [ ] Security headers configured
- [ ] Authentication enabled (Azure AD)
- [ ] Authorization enabled (RBAC)
- [ ] Audit logging enabled
- [ ] Data encryption enabled

#### Operations
- [ ] Collection schedule configured
- [ ] Backup procedure documented
- [ ] Runbook for common operations
- [ ] Incident response procedure
- [ ] User onboarding guide

---

### Enterprise Timeline Summary

| Phase | Effort | Priority | Dependencies |
|-------|--------|----------|--------------|
| **E1: Authentication/RBAC** | 2-3 weeks | CRITICAL | Azure AD app registration |
| **E2: HTTPS & Headers** | 1 week | CRITICAL | Certificate |
| **E3: Audit Logging** | 1-2 weeks | HIGH | E1 (need user identity) |
| **E4: Data Protection** | 1-2 weeks | HIGH | None |
| **E5: HA & Scalability** | 2-4 weeks | MEDIUM | Database expertise |
| **E6: Monitoring** | 1-2 weeks | MEDIUM | None |

**Minimum Enterprise MVP**: E1 + E2 = **3-4 weeks**
- Enables multi-user access
- Secure transport
- Basic access control

**Full Enterprise**: E1-E6 = **8-14 weeks**
- Production-grade deployment
- Compliance-ready
- Scalable architecture

---

### Permission Matrix: Enterprise Roles

| Action | Viewer | Operator | Admin |
|--------|--------|----------|-------|
| View dashboard | Yes | Yes | Yes |
| View user details | Yes | Yes | Yes |
| View device details | Yes | Yes | Yes |
| Export CSV | No | Yes | Yes |
| Copy remediation scripts | No | Yes | Yes |
| Execute remediation | No | Yes | Yes |
| Bulk operations | No | Yes | Yes |
| View audit logs | No | No | Yes |
| Manage settings | No | No | Yes |
| Manage users/roles | No | No | Yes |

---

*Created: 2026-02-08*
*Updated: 2026-02-08 - Added Enterprise Grade section*
