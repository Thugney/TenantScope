# License Pricing Configuration

TenantScope calculates license costs based on pricing you configure in `config.json`. This guide explains how to set up accurate pricing for your organization.

## Why Manual Configuration?

Microsoft does not expose license pricing through Graph API. Your actual costs depend on:

- **Agreement type**: Enterprise Agreement (EA), CSP, Direct, etc.
- **Negotiated discounts**: Volume pricing, multi-year commitments
- **Regional pricing**: Varies by country/currency
- **Special pricing**: Nonprofit, education, government rates

The `licensePricing` section in config.json lets you enter your actual contract rates.

## Configuration Structure

In your `config.json`, configure these sections:

```json
{
  "currency": {
    "code": "NOK",
    "symbol": "kr",
    "locale": "nb-NO"
  },
  "licensePricing": {
    "SPE_E3": 350,
    "SPE_E5": 580,
    "ENTERPRISEPACK": 270
  }
}
```

### Currency Settings

| Field | Description | Example |
|-------|-------------|---------|
| `code` | ISO 4217 currency code | `"NOK"`, `"USD"`, `"EUR"` |
| `symbol` | Display symbol | `"kr"`, `"$"`, `"€"` |
| `locale` | Number formatting locale | `"nb-NO"`, `"en-US"`, `"de-DE"` |

### License Pricing

The `licensePricing` object maps **SKU Part Numbers** to **monthly cost per license**.

```json
"licensePricing": {
  "SKU_PART_NUMBER": monthly_cost_per_license
}
```

---

## Step-by-Step: Configure Pricing from Admin Portal

### Step 1: View Your Licenses

Go to [admin.microsoft.com](https://admin.microsoft.com) > **Billing** > **Your products**

![Admin Center Licenses Page](admin-licenses-page.png)

This page shows your subscriptions with:
- Product name
- Assigned licenses
- Purchased quantity
- Available licenses
- Subscription status
- Purchase channel (Volume licensing, Commercial direct)

**Note**: This page does NOT show pricing. You need to go to Billing for that.

### Step 2: Map Product Names to SKU Part Numbers

Based on your licenses page, here's how to map them:

| Product Name (Admin Portal) | SKU Part Number | Notes |
|-----------------------------|-----------------|-------|
| Microsoft 365 E3 Existing Customer | `SPE_E3` | Standard M365 E3 |
| Microsoft 365 F1 | `SPE_F1` | Frontline workers |
| Microsoft Defender + Purview Suite Add-on for FLW | `MICROSOFT_DEFENDER_PURVIEW_ADDON_FLW` | Add-on for Frontline |
| Microsoft Defender Suite | `DEFENDER_ENDPOINT_P1` or `MDE_SMB` | Check your licenses.json |
| Microsoft Teams Rooms Basic | `MTR_PREM` | Meeting rooms |
| Office 365 A1 for faculty | `STANDARDWOFFPACK_FACULTY` | Education - Free |
| Office 365 A1 for students | `STANDARDWOFFPACK_STUDENT` | Education - Free |
| Office 365 F3 | `DESKLESSPACK` | Frontline F3 |

**To get the exact SKU Part Numbers for YOUR tenant:**

```powershell
# Run this after data collection
Get-Content ".\data\licenses.json" | ConvertFrom-Json |
    Select-Object skuName, skuPartNumber | Format-Table
```

Or query directly:
```powershell
Connect-MgGraph -Scopes "Organization.Read.All"
Get-MgSubscribedSku | Select-Object SkuPartNumber, ConsumedUnits | Format-Table
```

### Step 3: Find Your Contract Pricing

The "Your products" page does not show prices. To find actual costs:

#### Option A: Bills & Payments
1. Go to **Billing** > **Bills & payments**
2. Open a recent invoice
3. Find the line items with per-license pricing

#### Option B: Cost Management
1. Go to **Billing** > **Your products**
2. Click on a subscription name
3. Look for "Price" or "Cost" information in the details

#### Option C: Volume Licensing Service Center (VLSC)
If you have an Enterprise Agreement:
1. Go to [vlsc.microsoft.com](https://www.vlsc.microsoft.com)
2. Navigate to your agreement
3. View your price sheet

#### Option D: Ask Your Finance Team
Your procurement or finance team has the contract details with actual negotiated rates.

### Step 4: Calculate Monthly Costs

If you only have **annual pricing**, divide by 12:

```
Monthly cost = Annual cost per license / 12
```

**Example:**
- Annual E3 cost: 4,200 NOK
- Monthly cost: 4,200 / 12 = 350 NOK

### Step 5: Add to config.json

Based on your screenshot, here's an example configuration:

```json
{
  "currency": {
    "code": "NOK",
    "symbol": "kr",
    "locale": "nb-NO"
  },
  "licensePricing": {
    "SPE_E3": 350,
    "SPE_F1": 85,
    "MICROSOFT_DEFENDER_PURVIEW_ADDON_FLW": 45,
    "DEFENDER_ENDPOINT_P1": 30,
    "MTR_PREM": 150,
    "STANDARDWOFFPACK_FACULTY": 0,
    "STANDARDWOFFPACK_STUDENT": 0,
    "DESKLESSPACK": 95
  }
}
```

**Important**:
- Set free licenses (A1 for students/faculty) to `0`
- Use your actual contract prices, not list prices
- Prices should be **monthly per license**

---

## Adding New Licenses in the Future

When you purchase new licenses:

### 1. Run Data Collection
```powershell
.\Invoke-DataCollection.ps1
```

### 2. Check for Unknown SKUs
Open `data/licenses.json` and look for any licenses showing `0` cost:

```powershell
Get-Content ".\data\licenses.json" | ConvertFrom-Json |
    Where-Object { $_.monthlyCostPerLicense -eq 0 -and $_.totalAssigned -gt 0 } |
    Select-Object skuName, skuPartNumber, totalAssigned
```

### 3. Add Missing SKUs to Config
Add the new `skuPartNumber` with its monthly cost:

```json
"licensePricing": {
  "EXISTING_SKU": 350,
  "NEW_SKU_PART_NUMBER": 125
}
```

### 4. Rebuild Dashboard
```powershell
.\scripts\Build-Dashboard.ps1
```

---

## Common SKU Part Numbers Reference

| SKU Part Number | Product Name |
|-----------------|--------------|
| `SPE_E3` | Microsoft 365 E3 |
| `SPE_E5` | Microsoft 365 E5 |
| `SPE_F1` | Microsoft 365 F1 |
| `SPE_F3` | Microsoft 365 F3 |
| `ENTERPRISEPACK` | Office 365 E3 |
| `ENTERPRISEPREMIUM` | Office 365 E5 |
| `DESKLESSPACK` | Office 365 F3 |
| `SPB` | Microsoft 365 Business Premium |
| `O365_BUSINESS_ESSENTIALS` | Microsoft 365 Business Basic |
| `O365_BUSINESS_PREMIUM` | Microsoft 365 Business Standard |
| `EXCHANGESTANDARD` | Exchange Online (Plan 1) |
| `EXCHANGEENTERPRISE` | Exchange Online (Plan 2) |
| `POWER_BI_PRO` | Power BI Pro |
| `INTUNE_A` | Microsoft Intune |
| `AAD_PREMIUM` | Azure AD Premium P1 |
| `AAD_PREMIUM_P2` | Azure AD Premium P2 |
| `EMS` | Enterprise Mobility + Security E3 |
| `EMSPREMIUM` | Enterprise Mobility + Security E5 |
| `DEFENDER_ENDPOINT_P1` | Microsoft Defender for Endpoint P1 |
| `DEFENDER_ENDPOINT_P2` | Microsoft Defender for Endpoint P2 |
| `MTR_PREM` | Microsoft Teams Rooms Pro |
| `STANDARDWOFFPACK_FACULTY` | Office 365 A1 for Faculty |
| `STANDARDWOFFPACK_STUDENT` | Office 365 A1 for Students |
| `M365EDU_A3_FACULTY` | Microsoft 365 A3 for Faculty |
| `M365EDU_A3_STUDENT` | Microsoft 365 A3 for Students |
| `VISIOCLIENT` | Visio Plan 2 |
| `PROJECTPREMIUM` | Project Plan 5 |
| `TEAMS_EXPLORATORY` | Microsoft Teams Exploratory |
| `FLOW_FREE` | Power Automate Free |
| `POWERAPPS_VIRAL` | Power Apps Free |

For a complete list, see [Microsoft Product Names and SKU IDs](https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference).

---

## License Overlap Rules (Optional)

Identify users with redundant licenses (e.g., both E3 and E5):

```json
"licenseOverlapRules": [
  {
    "name": "E3 + E5",
    "higherSku": "SPE_E5",
    "lowerSku": "SPE_E3",
    "description": "E5 includes all E3 capabilities"
  },
  {
    "name": "AAD P1 + P2",
    "higherSku": "AAD_PREMIUM_P2",
    "lowerSku": "AAD_PREMIUM",
    "description": "P2 includes all P1 features"
  },
  {
    "name": "EMS E3 + E5",
    "higherSku": "EMSPREMIUM",
    "lowerSku": "EMS",
    "description": "EMS E5 includes all E3 features"
  },
  {
    "name": "F1 + F3",
    "higherSku": "SPE_F3",
    "lowerSku": "SPE_F1",
    "description": "F3 includes all F1 capabilities"
  }
]
```

The dashboard will flag users with both licenses and calculate potential savings.

---

## What the Dashboard Shows

Once configured, the Licenses page displays:

| Metric | Description |
|--------|-------------|
| **Monthly Cost** | `assigned_licenses x monthly_cost_per_license` |
| **Waste Cost** | `unused_licenses x monthly_cost_per_license` |
| **Overlap Count** | Users with redundant license combinations |
| **Potential Savings** | Cost of removing redundant lower-tier licenses |

The Overview page shows a **License Waste** callout if significant waste is detected.

---

## Troubleshooting

### Licenses Show 0 Cost

The SKU is not in your `licensePricing` config:

1. Run collection to see the exact `skuPartNumber` in `licenses.json`
2. Add that SKU to your config with the correct price

### SKU Not Recognized

If a license appears with its technical name instead of a friendly name:

1. The collector has a built-in mapping for common SKUs
2. Unknown SKUs display their `skuPartNumber` as the name
3. This doesn't affect cost calculations - just add the SKU to `licensePricing`

### Prices Seem Wrong

1. Verify you're using **monthly** costs (not annual)
2. Check your currency settings match your pricing
3. Ensure prices are numbers, not strings: `350` not `"350"`

---

## Quick Reference: Your Tenant

Based on the screenshot, here are your licenses to configure:

| Product | SKU (verify in licenses.json) | Assigned | Get Price From |
|---------|-------------------------------|----------|----------------|
| Microsoft 365 E3 Existing Customer | `SPE_E3` | 281 | Invoice/VLSC |
| Microsoft 365 F1 | `SPE_F1` | 758 | Invoice/VLSC |
| Microsoft Defender + Purview Add-on | Check licenses.json | 754 | Invoice/VLSC |
| Microsoft Defender Suite | Check licenses.json | 280 | Invoice/VLSC |
| Microsoft Teams Rooms Basic | `MTR_PREM` or similar | 3 | Invoice |
| Office 365 A1 for faculty | `STANDARDWOFFPACK_FACULTY` | 4 | Free (set to 0) |
| Office 365 A1 for students | `STANDARDWOFFPACK_STUDENT` | 1 | Free (set to 0) |
| Office 365 F3 | `DESKLESSPACK` | 11 | Invoice/VLSC |

Run data collection first, then check `licenses.json` for exact SKU part numbers before configuring pricing.
