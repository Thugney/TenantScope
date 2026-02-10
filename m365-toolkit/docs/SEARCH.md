# Search Guide

## Global Search (Ctrl+K)
TenantScope includes a global search modal that scans core datasets and jumps directly to the right page.

How to open:
- Press Ctrl+K (Windows) or Cmd+K (Mac)
- Start typing to see results immediately

What it searches:
- Users
- Guests
- Devices
- Teams
- SharePoint Sites
- Enterprise Apps
- Conditional Access Policies
- Admin Roles
- Licenses
- Configuration Profiles
- Compliance Policies

How to use:
1. Open the search modal with Ctrl+K.
2. Type part of a name, UPN, email, device name, or policy name.
3. Use arrow keys to highlight a result and press Enter.
4. The dashboard navigates you directly to the matching page.

Example queries:
- lex@contoso.com
- Finance
- Windows 11
- CA - Block Legacy Auth
- SharePoint HR

## User 360 Deep Links
The User 360 page provides a full, cross-entity view of a single user.

You can open it directly using a URL hash:
- #user-360?upn=alex@contoso.com
- #user-360?id=<user-guid>

## Users Page Smart Redirect
If you navigate to the Users page with a specific user UPN, it will automatically open User 360:
- #users?search=alex@contoso.com

To stay on the Users list instead (no redirect), add either:
- #users?search=alex@contoso.com&view=list
- #users?search=alex@contoso.com&no360=1
