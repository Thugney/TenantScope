# Tenant License Collection

TenantScope collects license inventory from Microsoft Graph v1.0 `/subscribedSkus`.
The PowerShell SDK equivalent is:

```powershell
Get-MgSubscribedSku -All
```

## Required Permission

Use the least-privilege Microsoft Graph application permission:

```text
LicenseAssignment.Read.All
```

If your existing TenantScope app registration already has `Organization.Read.All` or `Directory.Read.All`, Graph may also allow `/subscribedSkus` with those broader permissions. Prefer `LicenseAssignment.Read.All` for new app registrations.

## Config Switches

`config.json` supports:

```json
{
  "EnableLicenseCollection": true,
  "AllowStaticLicenseFallback": false
}
```

`EnableLicenseCollection=false` writes a disabled status object to `license-skus.json` and lets the rest of collection continue.

`AllowStaticLicenseFallback` is present for compatibility policy only. TenantScope does not currently reuse hard-coded SKU inventory as a fallback because live Graph data is the source of truth.

## Output

The collector writes `m365-toolkit\data\license-skus.json` with:

- `collectedAtUtc`
- `source`
- `status`
- `summary`
- `validation`
- `licenses`
- `errors`
- `warnings`

Each license includes SKU ID, SKU part number, capacity, consumed units, available units, suspended and warning units, and sorted service plans.

## Manual Validation

Run the collector:

```powershell
pwsh -File .\Invoke-DataCollection.ps1 -CollectorsToRun @("LicenseData") -SkipDashboard
```

Compare the SKU count against Graph:

```powershell
Get-MgSubscribedSku -All | Select-Object SkuId, SkuPartNumber, ConsumedUnits
```

Then inspect the normalized output:

```powershell
$licenses = Get-Content .\data\license-skus.json -Raw | ConvertFrom-Json
$licenses.summary
$licenses.licenses | Select-Object skuPartNumber, enabledUnits, consumedUnits, availableUnits
```

The dashboard reads the normalized `licenses` array. A newly subscribed SKU should appear without code changes after the next collection and dashboard build.
