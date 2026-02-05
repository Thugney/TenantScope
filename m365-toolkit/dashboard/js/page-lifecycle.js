/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: LIFECYCLE
 *
 * Renders the lifecycle management page with computed reports:
 * - Offboarding Issues (disabled accounts with licenses, admin roles)
 * - Onboarding Gaps (new users with missing setup)
 * - Role Hygiene (inactive admins, admins without MFA)
 * - Guest Cleanup (stale guests, pending invitations)
 * - Teams Governance (ownerless teams, inactive teams with guest access)
 * - SharePoint Governance (anonymous links, inactive external sites, missing labels)
 */

const PageLifecycle = (function() {
    'use strict';

    /**
     * Renders the lifecycle page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;
        const guests = DataLoader.getData('guests');
        const adminRoles = DataLoader.getData('adminRoles');
        const teams = DataLoader.getData('teams');
        const spSites = DataLoader.getData('sharepointSites');

        // Calculate offboarding issues
        const disabledWithLicenses = users.filter(u => !u.accountEnabled && u.licenseCount > 0);
        const inactiveStillEnabled = users.filter(u => u.isInactive && u.accountEnabled);

        // Find disabled users with admin roles
        const disabledAdmins = [];
        adminRoles.forEach(role => {
            role.members.forEach(member => {
                if (!member.accountEnabled) {
                    disabledAdmins.push({
                        ...member,
                        roleName: role.roleName
                    });
                }
            });
        });

        // Calculate onboarding gaps (created in last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const newUsers = users.filter(u => {
            if (!u.createdDateTime) return false;
            const created = new Date(u.createdDateTime);
            return created >= thirtyDaysAgo;
        });

        const newUsersNoSignIn = newUsers.filter(u => !u.lastSignIn);
        const newUsersNoMfa = newUsers.filter(u => !u.mfaRegistered);
        const newUsersNoLicense = newUsers.filter(u => u.licenseCount === 0);

        // Calculate role hygiene issues
        const inactiveAdmins = [];
        const adminsNoMfa = [];

        adminRoles.forEach(role => {
            role.members.forEach(member => {
                if (member.isInactive) {
                    inactiveAdmins.push({
                        ...member,
                        roleName: role.roleName
                    });
                }
                // Check MFA from users data
                const userData = users.find(u => u.id === member.userId);
                if (userData && !userData.mfaRegistered) {
                    adminsNoMfa.push({
                        ...member,
                        roleName: role.roleName
                    });
                }
            });
        });

        // Calculate guest cleanup
        const staleGuests = guests.filter(g => g.isStale);
        const pendingGuests = guests.filter(g => g.invitationState === 'PendingAcceptance');
        const neverSignedInGuests = guests.filter(g => g.neverSignedIn && g.invitationState === 'Accepted');

        // Calculate teams governance issues
        const ownerlessTeams = teams.filter(function(t) { return t.hasNoOwner; });
        const inactiveTeamsWithGuests = teams.filter(function(t) { return t.isInactive && t.hasGuests; });
        const teamsIssueCount = ownerlessTeams.length + inactiveTeamsWithGuests.length;

        // Calculate SharePoint governance issues (non-personal sites only)
        const spNonPersonal = spSites.filter(function(s) { return !s.isPersonalSite; });
        const sitesWithAnonymousLinks = spNonPersonal.filter(function(s) { return (s.anonymousLinkCount || 0) > 0; });
        const externalInactiveSites = spNonPersonal.filter(function(s) { return s.isInactive && s.hasExternalSharing; });
        const sitesWithoutLabels = spNonPersonal.filter(function(s) { return !s.sensitivityLabelId; });
        const spGovernanceCount = sitesWithAnonymousLinks.length + externalInactiveSites.length + sitesWithoutLabels.length;

        // Calculate total issues
        const totalIssues = disabledWithLicenses.length + disabledAdmins.length +
                           inactiveStillEnabled.length + newUsersNoSignIn.length +
                           inactiveAdmins.length + adminsNoMfa.length +
                           staleGuests.length + pendingGuests.length +
                           teamsIssueCount + spGovernanceCount;

        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">Lifecycle Management</h2>
                <p class="page-description">Account lifecycle issues requiring attention</p>
            </div>

            <!-- Summary Cards -->
            <div class="cards-grid">
                <div class="card ${totalIssues > 0 ? 'card-warning' : 'card-success'}">
                    <div class="card-label">Total Issues</div>
                    <div class="card-value ${totalIssues > 0 ? 'warning' : 'success'}">${totalIssues}</div>
                </div>
                <div class="card ${disabledWithLicenses.length > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Offboarding Issues</div>
                    <div class="card-value">${disabledWithLicenses.length + disabledAdmins.length}</div>
                </div>
                <div class="card ${inactiveAdmins.length > 0 ? 'card-critical' : ''}">
                    <div class="card-label">Role Hygiene</div>
                    <div class="card-value">${inactiveAdmins.length + adminsNoMfa.length}</div>
                </div>
                <div class="card ${staleGuests.length > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Guest Cleanup</div>
                    <div class="card-value">${staleGuests.length + pendingGuests.length}</div>
                </div>
                <div class="card ${teamsIssueCount > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Teams Governance</div>
                    <div class="card-value ${teamsIssueCount > 0 ? 'warning' : ''}">${teamsIssueCount}</div>
                </div>
                <div class="card ${spGovernanceCount > 0 ? 'card-warning' : ''}">
                    <div class="card-label">SharePoint Governance</div>
                    <div class="card-value ${spGovernanceCount > 0 ? 'warning' : ''}">${spGovernanceCount}</div>
                </div>
            </div>

            <!-- Charts -->
            <div class="charts-row" id="lifecycle-charts"></div>

            <!-- Offboarding Issues Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Offboarding Issues</h3>
                        <p class="section-subtitle">Disabled accounts that still have licenses or admin roles assigned</p>
                    </div>
                </div>

                <h4 class="mb-sm mt-md">Disabled Accounts with Licenses (${disabledWithLicenses.length})</h4>
                <div id="offboarding-licenses-table"></div>

                <h4 class="mb-sm mt-lg">Inactive Users Still Enabled (${inactiveStillEnabled.length})</h4>
                <div id="offboarding-inactive-table"></div>
            </div>

            <!-- Onboarding Gaps Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Onboarding Gaps</h3>
                        <p class="section-subtitle">New users (last 30 days) missing required setup</p>
                    </div>
                </div>

                <h4 class="mb-sm">New Users Never Signed In (${newUsersNoSignIn.length})</h4>
                <div id="onboarding-nosignin-table"></div>

                <h4 class="mb-sm mt-lg">New Users Without MFA (${newUsersNoMfa.length})</h4>
                <div id="onboarding-nomfa-table"></div>
            </div>

            <!-- Role Hygiene Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Role Hygiene</h3>
                        <p class="section-subtitle">Admin accounts with security concerns</p>
                    </div>
                </div>

                <h4 class="mb-sm">Inactive Admins (${inactiveAdmins.length})</h4>
                <div id="role-inactive-table"></div>

                <h4 class="mb-sm mt-lg">Admins Without MFA (${adminsNoMfa.length})</h4>
                <div id="role-nomfa-table"></div>
            </div>

            <!-- Guest Cleanup Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Guest Cleanup</h3>
                        <p class="section-subtitle">External users requiring review or removal</p>
                    </div>
                </div>

                <h4 class="mb-sm">Stale Guests (${staleGuests.length})</h4>
                <div id="guest-stale-table"></div>

                <h4 class="mb-sm mt-lg">Pending Invitations (${pendingGuests.length})</h4>
                <div id="guest-pending-table"></div>
            </div>

            <!-- Teams Governance Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Teams Governance</h3>
                        <p class="section-subtitle">Teams requiring ownership or access review</p>
                    </div>
                </div>

                <h4 class="mb-sm">Ownerless Teams (${ownerlessTeams.length})</h4>
                <div id="teams-ownerless-table"></div>

                <h4 class="mb-sm mt-lg">Inactive Teams with Guest Access (${inactiveTeamsWithGuests.length})</h4>
                <div id="teams-inactive-guests-table"></div>
            </div>

            <!-- SharePoint Governance Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">SharePoint Governance</h3>
                        <p class="section-subtitle">Sites with sharing exposure, missing labels, or inactive external access</p>
                    </div>
                </div>

                <h4 class="mb-sm">Sites with Anonymous Links (${sitesWithAnonymousLinks.length})</h4>
                <div id="sp-anon-links-table"></div>

                <h4 class="mb-sm mt-lg">Inactive Sites with External Sharing (${externalInactiveSites.length})</h4>
                <div id="sp-external-inactive-table"></div>

                <h4 class="mb-sm mt-lg">Sites Without Sensitivity Labels (${sitesWithoutLabels.length})</h4>
                <div id="sp-no-labels-table"></div>
            </div>
        `;

        // Render charts
        var chartsRow = document.getElementById('lifecycle-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Issue Categories',
                [
                    { value: disabledWithLicenses.length + disabledAdmins.length, label: 'Offboarding', color: C.orange },
                    { value: newUsersNoSignIn.length + newUsersNoMfa.length, label: 'Onboarding', color: C.blue },
                    { value: inactiveAdmins.length + adminsNoMfa.length, label: 'Role Hygiene', color: C.red },
                    { value: staleGuests.length + pendingGuests.length, label: 'Guest Cleanup', color: C.yellow },
                    { value: teamsIssueCount, label: 'Teams', color: C.purple },
                    { value: spGovernanceCount, label: 'SharePoint', color: C.teal }
                ],
                String(totalIssues), 'total issues'
            ));

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Guest Status',
                [
                    { value: guests.length - staleGuests.length - pendingGuests.length - neverSignedInGuests.length, label: 'Active', color: C.green },
                    { value: staleGuests.length, label: 'Stale', color: C.yellow },
                    { value: pendingGuests.length, label: 'Pending', color: C.orange },
                    { value: neverSignedInGuests.length, label: 'Never Signed In', color: C.red }
                ],
                String(guests.length), 'total guests'
            ));
        }

        // Render offboarding tables
        Tables.render({
            containerId: 'offboarding-licenses-table',
            data: disabledWithLicenses,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'department', label: 'Department' },
                { key: 'licenseCount', label: 'Licenses' },
                { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'offboarding-inactive-table',
            data: inactiveStillEnabled,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'department', label: 'Department' },
                { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
                { key: 'licenseCount', label: 'Licenses' }
            ],
            pageSize: 10
        });

        // Render onboarding tables
        Tables.render({
            containerId: 'onboarding-nosignin-table',
            data: newUsersNoSignIn,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
                { key: 'department', label: 'Department' }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'onboarding-nomfa-table',
            data: newUsersNoMfa,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
                { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date }
            ],
            pageSize: 10
        });

        // Render role hygiene tables
        Tables.render({
            containerId: 'role-inactive-table',
            data: inactiveAdmins,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'roleName', label: 'Role' },
                { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'role-nomfa-table',
            data: adminsNoMfa,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'roleName', label: 'Role' },
                { key: 'accountEnabled', label: 'Enabled' }
            ],
            pageSize: 10
        });

        // Render guest cleanup tables
        Tables.render({
            containerId: 'guest-stale-table',
            data: staleGuests,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'mail', label: 'Email', className: 'cell-truncate' },
                { key: 'sourceDomain', label: 'Source' },
                { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'guest-pending-table',
            data: pendingGuests,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'mail', label: 'Email', className: 'cell-truncate' },
                { key: 'sourceDomain', label: 'Source' },
                { key: 'createdDateTime', label: 'Invited', formatter: Tables.formatters.date }
            ],
            pageSize: 10
        });

        // Render teams governance tables
        Tables.render({
            containerId: 'teams-ownerless-table',
            data: ownerlessTeams,
            columns: [
                { key: 'displayName', label: 'Team Name' },
                { key: 'visibility', label: 'Visibility' },
                { key: 'memberCount', label: 'Members', className: 'cell-right' },
                { key: 'lastActivityDate', label: 'Last Activity', formatter: Tables.formatters.date },
                { key: 'daysSinceActivity', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'teams-inactive-guests-table',
            data: inactiveTeamsWithGuests,
            columns: [
                { key: 'displayName', label: 'Team Name' },
                { key: 'guestCount', label: 'Guests', className: 'cell-right' },
                { key: 'memberCount', label: 'Members', className: 'cell-right' },
                { key: 'lastActivityDate', label: 'Last Activity', formatter: Tables.formatters.date },
                { key: 'daysSinceActivity', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays }
            ],
            pageSize: 10
        });

        // Render SharePoint governance tables
        Tables.render({
            containerId: 'sp-anon-links-table',
            data: sitesWithAnonymousLinks,
            columns: [
                { key: 'displayName', label: 'Site Name' },
                { key: 'anonymousLinkCount', label: 'Anonymous Links', className: 'cell-right' },
                { key: 'guestLinkCount', label: 'Guest Links', className: 'cell-right' },
                { key: 'externalSharing', label: 'Sharing Policy' },
                { key: 'lastActivityDate', label: 'Last Activity', formatter: Tables.formatters.date }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'sp-external-inactive-table',
            data: externalInactiveSites,
            columns: [
                { key: 'displayName', label: 'Site Name' },
                { key: 'externalSharing', label: 'Sharing Policy' },
                { key: 'totalSharingLinks', label: 'Total Links', className: 'cell-right' },
                { key: 'daysSinceActivity', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
                { key: 'storageUsedGB', label: 'Storage (GB)', className: 'cell-right' }
            ],
            pageSize: 10
        });

        Tables.render({
            containerId: 'sp-no-labels-table',
            data: sitesWithoutLabels,
            columns: [
                { key: 'displayName', label: 'Site Name' },
                { key: 'template', label: 'Template' },
                { key: 'ownerDisplayName', label: 'Owner' },
                { key: 'externalSharing', label: 'Sharing Policy' },
                { key: 'fileCount', label: 'Files', className: 'cell-right' }
            ],
            pageSize: 10
        });
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageLifecycle = PageLifecycle;
