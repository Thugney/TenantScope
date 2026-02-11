# TenantScope Authentication Guide

TenantScope supports three authentication methods for connecting to Microsoft Graph API.

---

## Authentication Methods Comparison

| Method | Best For | Unattended | LAPS Data | Setup Complexity |
|--------|----------|------------|-----------|------------------|
| **Interactive** | Testing, ad-hoc use | No | No* | Easy |
| **Client Secret** | Scheduled tasks, automation | Yes | Yes | Medium |
| **Certificate** | Production, high security | Yes | Yes | Advanced |

*LAPS requires `DeviceLocalCredential.Read.All` which is an Application-only permission.

---

## Option 1: Interactive Authentication (Default)

Uses browser sign-in with Microsoft Graph PowerShell SDK. Simplest to set up.

### config.json
```json
{
  "tenantId": "your-tenant-id"
}
```

### How It Works
1. Run `.\Invoke-DataCollection.ps1`
2. Browser opens for Microsoft sign-in
3. Sign in with your admin account
4. Consent to permissions when prompted

### Limitations
- Requires user interaction (can't be scheduled)
- Some Application-only permissions unavailable:
  - `DeviceLocalCredential.Read.All` (LAPS)
  - Some Defender ATP endpoints

---

## Option 2: App Registration with Client Secret

Enables unattended runs and access to Application-only permissions.

### Step 1: Register the App in Entra ID

1. Go to **[Azure Portal](https://portal.azure.com)** → **Microsoft Entra ID** → **App registrations**

2. Click **+ New registration**
   - Name: `TenantScope`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: Leave blank
   - Click **Register**

3. Note these values from the Overview page:
   - **Application (client) ID** → This is your `clientId`
   - **Directory (tenant) ID** → This is your `tenantId`

### Step 2: Create a Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Click **+ New client secret**
3. Description: `TenantScope`
4. Expires: Choose duration (recommend 12-24 months)
5. Click **Add**
6. **IMPORTANT:** Copy the secret **Value** immediately (shown only once)

### Step 3: Add API Permissions

1. Go to **API permissions** → **+ Add a permission**
2. Select **Microsoft Graph** → **Application permissions**
3. Add these permissions (check all that apply to your needs):

#### Core Permissions (Required)
```
User.Read.All
Group.Read.All
Directory.Read.All
AuditLog.Read.All
```

#### Device Management
```
DeviceManagementManagedDevices.Read.All
DeviceManagementConfiguration.Read.All
Device.Read.All
BitLockerKey.Read.All
```

#### Security & Compliance
```
SecurityEvents.Read.All
ThreatHunting.Read.All
Policy.Read.All
RoleManagement.Read.Directory
```

#### LAPS (Required for LAPS coverage data)
```
DeviceLocalCredential.Read.All
```

#### Teams & SharePoint
```
Sites.Read.All
Team.ReadBasic.All
Channel.ReadBasic.All
```

4. Click **Grant admin consent for [your tenant]**
5. Verify all permissions show **✓ Granted**

### Step 4: Update config.json

```json
{
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "clientSecret": "your-secret-value-here"
}
```

### Step 5: Test

```powershell
.\Invoke-DataCollection.ps1
```

No browser sign-in should be required.

---

## Option 3: Certificate Authentication (Recommended for Production)

Most secure option - uses X.509 certificate instead of secret.

### Step 1: Create a Self-Signed Certificate

```powershell
# Create certificate (valid 2 years)
$cert = New-SelfSignedCertificate `
    -Subject "CN=TenantScope" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -KeySpec Signature `
    -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(2)

# Export public key (.cer) for upload to Azure
Export-Certificate -Cert $cert -FilePath ".\TenantScope.cer"

# Note the thumbprint
$cert.Thumbprint
```

### Step 2: Upload Certificate to App Registration

1. Go to your app registration → **Certificates & secrets**
2. Click **Certificates** tab → **Upload certificate**
3. Select the `.cer` file you exported
4. Click **Add**

### Step 3: Update config.json

```json
{
  "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "certificateThumbprint": "ABC123DEF456..."
}
```

---

## Required Permissions by Collector

| Collector | Required Permissions |
|-----------|---------------------|
| Users, Groups, Guests | `User.Read.All`, `Group.Read.All` |
| Admin Roles | `RoleManagement.Read.Directory` |
| MFA Status | `UserAuthenticationMethod.Read.All`, `Policy.Read.All` |
| Sign-in Logs | `AuditLog.Read.All` |
| Devices | `DeviceManagementManagedDevices.Read.All` |
| Autopilot | `DeviceManagementServiceConfig.Read.All` |
| Compliance Policies | `DeviceManagementConfiguration.Read.All` |
| Configuration Profiles | `DeviceManagementConfiguration.Read.All` |
| BitLocker | `BitLockerKey.Read.All` |
| **LAPS Coverage** | `DeviceLocalCredential.Read.All` ⚠️ |
| Defender Alerts | `SecurityEvents.Read.All` |
| Defender Device Health | `Machine.Read.All` (Defender ATP) |
| Advanced Hunting | `ThreatHunting.Read.All` |
| Conditional Access | `Policy.Read.All` |
| PIM Activity | `RoleManagement.Read.Directory` |
| Teams | `Team.ReadBasic.All`, `Channel.ReadBasic.All` |
| SharePoint | `Sites.Read.All` |
| Enterprise Apps | `Application.Read.All` |

⚠️ = Application permission only (not available with interactive auth)

---

## Troubleshooting

### "Insufficient privileges" or "Authorization_RequestDenied"
- Permission not granted or admin consent not given
- Go to API permissions → Grant admin consent

### "AADSTS700016: Application not found"
- Wrong `clientId` in config.json
- Check the Application (client) ID in Azure Portal

### "AADSTS7000215: Invalid client secret"
- Secret expired or wrong value
- Create a new secret and update config.json

### "AADSTS700027: Client assertion contains an invalid signature"
- Certificate not uploaded to app registration
- Or wrong thumbprint in config.json

### LAPS shows "unknown" status for all devices
- `DeviceLocalCredential.Read.All` permission missing
- This is Application-only - requires app registration (not interactive auth)

---

## Security Best Practices

1. **Use certificate auth** for production/scheduled tasks
2. **Limit permissions** to only what you need
3. **Store secrets securely** - never commit config.json to git
4. **Set secret expiration** - rotate secrets annually
5. **Use Conditional Access** to restrict app sign-in locations
6. **Monitor sign-in logs** for the service principal
7. **Review permissions** periodically and remove unused ones

---

## Quick Reference

### Find Your Tenant ID
```powershell
(Get-MgContext).TenantId
# Or in Azure Portal: Microsoft Entra ID → Overview → Tenant ID
```

### Find Certificate Thumbprint
```powershell
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -match "TenantScope" }
```

### Test Connection
```powershell
# With app registration
Connect-MgGraph -TenantId $tenantId -ClientId $clientId -ClientSecretCredential $secret
Get-MgUser -Top 1

# Interactive
Connect-MgGraph -TenantId $tenantId -Scopes "User.Read.All"
Get-MgUser -Top 1
```
