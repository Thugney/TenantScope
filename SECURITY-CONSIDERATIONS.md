# TenantScope Security Considerations

## Overview

TenantScope collects and stores sensitive Microsoft 365 tenant data locally. This document outlines the security risks associated with this data and the countermeasures that should be implemented.

---

## Sensitive Data Collected

### Identity & Access Data
| Data File | Contents | Risk Level |
|-----------|----------|------------|
| `users.json` | UPNs, display names, job titles, departments, managers, account status, last sign-in | **HIGH** |
| `admin-roles.json` | Privileged role assignments, Global Admins, role members | **CRITICAL** |
| `mfa-status.json` | MFA enrollment status per user, authentication methods | **CRITICAL** |
| `guests.json` | External user accounts, invitation status, access permissions | **HIGH** |
| `groups.json` | Group memberships, owners, security group configurations | **HIGH** |
| `pim-activity.json` | Privileged role activations, justifications, timestamps | **HIGH** |

### Authentication & Security Data
| Data File | Contents | Risk Level |
|-----------|----------|------------|
| `signin-logs.json` | Sign-in events, IP addresses, locations, device info, success/failure | **CRITICAL** |
| `risky-signins.json` | Flagged authentication attempts, risk levels, compromise indicators | **CRITICAL** |
| `conditional-access.json` | Security policies, conditions, exclusions, bypass rules | **CRITICAL** |
| `oauth-consent-grants.json` | App permissions, delegated access, consent grants | **HIGH** |
| `identity-risk-data.json` | Risk detections, compromised users, leaked credentials | **CRITICAL** |

### Device & Endpoint Data
| Data File | Contents | Risk Level |
|-----------|----------|------------|
| `devices.json` | Device names, compliance status, OS versions, last sync | **HIGH** |
| `autopilot.json` | Serial numbers, hardware hashes, enrollment state | **HIGH** |
| `bitlocker-status.json` | Encryption status, recovery key IDs | **CRITICAL** |
| `laps-coverage.json` | Local admin password management status | **HIGH** |
| `vulnerabilities.json` | Known CVEs, affected devices, severity | **CRITICAL** |
| `defender-alerts.json` | Security incidents, malware detections, threat indicators | **CRITICAL** |

### Configuration & Compliance Data
| Data File | Contents | Risk Level |
|-----------|----------|------------|
| `configuration-profiles.json` | Intune policies, security settings, deployment status | **HIGH** |
| `compliance-policies.json` | Compliance rules, enforcement actions | **MEDIUM** |
| `enterprise-apps.json` | Third-party applications, permissions, owners | **MEDIUM** |
| `service-principal-secrets.json` | App credential expiry dates (not actual secrets) | **MEDIUM** |

---

## Potential Misuse Scenarios

### 1. Reconnaissance for Targeted Attacks
**Risk:** An attacker with access to this data can map your entire organization structure.

- Identify high-value targets (executives, IT admins, finance)
- Understand reporting relationships for impersonation attacks
- Map group memberships to find privilege escalation paths
- Identify inactive accounts for potential takeover

### 2. MFA Bypass Targeting
**Risk:** `mfa-status.json` reveals which users lack MFA protection.

- Target users without MFA for credential stuffing
- Focus phishing campaigns on unprotected accounts
- Identify accounts relying on weaker authentication methods

### 3. Privileged Account Targeting
**Risk:** `admin-roles.json` and `pim-activity.json` expose admin accounts.

- Identify Global Administrators and other high-privilege roles
- Track PIM activation patterns to predict access windows
- Target service accounts with elevated permissions

### 4. Conditional Access Evasion
**Risk:** `conditional-access.json` reveals security policy gaps.

- Identify excluded users/groups from security policies
- Find locations or devices not covered by policies
- Discover legacy authentication paths still permitted

### 5. Device Exploitation
**Risk:** Device data reveals vulnerable and non-compliant endpoints.

- Target devices with known vulnerabilities
- Focus on non-compliant devices lacking security controls
- Identify devices without BitLocker encryption for physical attacks

### 6. Social Engineering Enhancement
**Risk:** User and organizational data enables convincing attacks.

- Craft targeted phishing using real names, titles, and relationships
- Impersonate managers using accurate reporting chain data
- Reference real internal systems and policies

### 7. OAuth/Application Abuse
**Risk:** `oauth-consent-grants.json` shows app permissions.

- Identify overprivileged applications to target
- Find applications with broad consent that could be abused
- Discover shadow IT applications for exploitation

---

## Countermeasures Implemented

### Data Storage Security

1. **Local-Only Storage**
   - Data is stored only on the local machine
   - No cloud sync or transmission of collected data
   - `.gitignore` prevents accidental commit of data files

2. **Data Directory Structure**
   ```
   data/           <- Excluded from git, contains real tenant data
   data/sample/    <- Sample data only, safe for repository
   ```

3. **No Credential Storage**
   - Authentication uses Microsoft Graph interactive/device code flow
   - No passwords or tokens stored in files
   - Session tokens managed by Microsoft.Graph module

### Access Control Recommendations

```powershell
# Recommended: Restrict data folder permissions (Windows)
$acl = Get-Acl ".\data"
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:USERDOMAIN\$env:USERNAME", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl ".\data" $acl
```

### Operational Security Practices

| Practice | Implementation |
|----------|----------------|
| **Least Privilege** | Run collectors with minimum required Graph permissions |
| **Just-In-Time Access** | Use PIM for admin roles when running collection |
| **Data Minimization** | Delete data files after analysis is complete |
| **Audit Trail** | Collection metadata logs who ran collection and when |
| **Secure Workstation** | Run only from hardened admin workstations |

---

## Required Graph API Permissions

The following permissions are requested - review if all are necessary for your use case:

### Read-Only Permissions (Delegated)
```
User.Read.All
Group.Read.All
Directory.Read.All
DeviceManagementManagedDevices.Read.All
DeviceManagementConfiguration.Read.All
SecurityEvents.Read.All
AuditLog.Read.All
Policy.Read.All
RoleManagement.Read.Directory
```

**Recommendation:** Only consent to permissions you actually need.

---

## Data Retention & Disposal

### Recommended Retention Policy

| Data Type | Retention Period | Disposal Method |
|-----------|------------------|-----------------|
| Sign-in logs | 7 days | Secure delete |
| User/device data | 30 days | Secure delete |
| Security alerts | 90 days | Secure delete |
| Trend history | 1 year | Archive encrypted |

### Secure Deletion Script

```powershell
# Securely delete data files (Windows)
function Remove-SecureData {
    param([string]$Path)

    if (Test-Path $Path) {
        # Overwrite with random data before deletion
        $files = Get-ChildItem $Path -Filter "*.json" -Recurse
        foreach ($file in $files) {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            [Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
            [System.IO.File]::WriteAllBytes($file.FullName, $bytes)
            Remove-Item $file.FullName -Force
        }
        Write-Host "Securely deleted $($files.Count) files"
    }
}

# Usage: Remove-SecureData -Path ".\data"
```

---

## Network Security

### Outbound Connections

TenantScope only connects to:
- `graph.microsoft.com` (Microsoft Graph API)
- `login.microsoftonline.com` (Authentication)

**No data is transmitted to third parties.**

### Firewall Recommendations

```
Allow outbound HTTPS (443) to:
- graph.microsoft.com
- login.microsoftonline.com
- *.microsoft.com (for authentication redirects)
```

---

## Incident Response

### If Data Is Compromised

1. **Assess Scope**
   - Determine which data files were accessed
   - Identify time period of exposure

2. **Immediate Actions**
   - Rotate credentials for any exposed admin accounts
   - Review sign-in logs for suspicious activity
   - Enable additional MFA requirements

3. **Notification**
   - Report to security team
   - Consider breach notification requirements (GDPR, etc.)

4. **Remediation**
   - Update Conditional Access policies to address revealed gaps
   - Prioritize MFA enrollment for exposed unprotected users
   - Patch vulnerable devices identified in the data

---

## Compliance Considerations

### Data Protection Regulations

| Regulation | Relevance |
|------------|-----------|
| **GDPR** | User data includes PII (names, emails, locations) |
| **HIPAA** | May contain healthcare worker information |
| **SOC 2** | Audit log data subject to retention requirements |
| **ISO 27001** | Access controls and data handling apply |

### Audit Requirements

Maintain records of:
- Who runs data collection
- When collections occur
- What data is collected
- How long data is retained
- When data is disposed

The `collection-metadata.json` file provides collection audit trail.

---

## Security Checklist

Before running TenantScope:

- [ ] Running from a hardened admin workstation
- [ ] Using a dedicated admin account with PIM
- [ ] Data folder has restricted permissions
- [ ] Endpoint protection is active
- [ ] Network connection is secure (no public WiFi)
- [ ] Collection is authorized by security team

After analysis:

- [ ] Exported reports stored securely
- [ ] Raw data files securely deleted
- [ ] Any findings reported through proper channels
- [ ] Access logs reviewed

---

## Contact

For security concerns or vulnerability reports related to TenantScope:
- Repository: https://github.com/Thugney/TenantScope
- Create a private security advisory for sensitive issues

---

*Last Updated: 2026-02-11*
