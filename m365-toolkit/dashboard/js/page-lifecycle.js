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
     * Creates an element with className and textContent.
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = el('div', 'analytics-card');
        card.appendChild(el('h4', null, title));
        var list = el('div', 'platform-list');
        rows.forEach(function(row) {
            var rowDiv = el('div', 'platform-row');
            rowDiv.appendChild(el('span', 'platform-name', row.name));
            rowDiv.appendChild(el('span', 'platform-policies', String(row.count)));
            var miniBar = el('div', 'mini-bar');
            var fill = el('div', 'mini-bar-fill ' + row.cls);
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            rowDiv.appendChild(el('span', 'platform-rate', row.showCount ? String(row.count) : (row.pct + '%')));
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = el('div', 'insight-card insight-' + type);
        var header = el('div', 'insight-header');
        header.appendChild(el('span', 'badge badge-' + type, badge));
        header.appendChild(el('span', 'insight-category', category));
        card.appendChild(header);
        card.appendChild(el('p', 'insight-description', description));
        if (action) {
            var actionP = el('p', 'insight-action');
            actionP.appendChild(el('strong', null, 'Action: '));
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    /**
     * Renders the lifecycle overview section with ASR Rules pattern.
     */
    function renderLifecycleOverview(container, stats) {
        container.textContent = '';

        // Calculate healthy percentage
        var healthyPct = stats.totalIssues === 0 ? 100 : Math.max(0, 100 - Math.round((stats.totalIssues / Math.max(stats.totalEntities, 1)) * 100));

        // Build analytics section with donut chart
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Lifecycle Health Overview'));

        var complianceOverview = el('div', 'compliance-overview');

        // Donut chart
        var chartContainer = el('div', 'compliance-chart');
        var donutDiv = el('div', 'donut-chart');

        var circumference = 2 * Math.PI * 40;
        var issuesPct = 100 - healthyPct;
        var healthyDash = (healthyPct / 100) * circumference;
        var issuesDash = (issuesPct / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (healthyPct > 0) {
            var healthyCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            healthyCircle.setAttribute('cx', '50');
            healthyCircle.setAttribute('cy', '50');
            healthyCircle.setAttribute('r', '40');
            healthyCircle.setAttribute('fill', 'none');
            healthyCircle.setAttribute('stroke', 'var(--success)');
            healthyCircle.setAttribute('stroke-width', '12');
            healthyCircle.setAttribute('stroke-dasharray', healthyDash + ' ' + circumference);
            healthyCircle.setAttribute('stroke-dashoffset', '0');
            healthyCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(healthyCircle);
        }
        if (issuesPct > 0) {
            var issuesCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            issuesCircle.setAttribute('cx', '50');
            issuesCircle.setAttribute('cy', '50');
            issuesCircle.setAttribute('r', '40');
            issuesCircle.setAttribute('fill', 'none');
            issuesCircle.setAttribute('stroke', 'var(--warning)');
            issuesCircle.setAttribute('stroke-width', '12');
            issuesCircle.setAttribute('stroke-dasharray', issuesDash + ' ' + circumference);
            issuesCircle.setAttribute('stroke-dashoffset', String(-healthyDash));
            issuesCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(issuesCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = el('div', 'donut-center');
        donutCenter.appendChild(el('span', 'donut-value', stats.totalIssues));
        donutCenter.appendChild(el('span', 'donut-label', 'Issues'));
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = el('div', 'compliance-legend');
        var legendItems = [
            { cls: 'bg-warning', label: 'Offboarding Issues', value: stats.offboardingCount },
            { cls: 'bg-info', label: 'Onboarding Gaps', value: stats.onboardingCount },
            { cls: 'bg-critical', label: 'Role Hygiene', value: stats.roleCount },
            { cls: 'bg-orange', label: 'Guest Cleanup', value: stats.guestCount },
            { cls: 'bg-purple', label: 'Teams Governance', value: stats.teamsCount },
            { cls: 'bg-primary', label: 'SharePoint', value: stats.spCount }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, String(item.value)));
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = el('div', 'analytics-grid');

        // Issue Categories card
        var maxIssue = Math.max(stats.offboardingCount, stats.onboardingCount, stats.roleCount, stats.guestCount, stats.teamsCount, stats.spCount, 1);
        analyticsGrid.appendChild(createPlatformCard('Issue Categories', [
            { name: 'Offboarding', count: stats.offboardingCount, pct: Math.round((stats.offboardingCount / maxIssue) * 100), cls: 'bg-warning', showCount: true },
            { name: 'Onboarding', count: stats.onboardingCount, pct: Math.round((stats.onboardingCount / maxIssue) * 100), cls: 'bg-info', showCount: true },
            { name: 'Role Hygiene', count: stats.roleCount, pct: Math.round((stats.roleCount / maxIssue) * 100), cls: 'bg-critical', showCount: true },
            { name: 'Guest Cleanup', count: stats.guestCount, pct: Math.round((stats.guestCount / maxIssue) * 100), cls: 'bg-orange', showCount: true }
        ]));

        // Offboarding Details card
        analyticsGrid.appendChild(createPlatformCard('Offboarding Details', [
            { name: 'Disabled w/ Licenses', count: stats.disabledWithLicenses, pct: stats.offboardingCount > 0 ? Math.round((stats.disabledWithLicenses / stats.offboardingCount) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'Disabled Admins', count: stats.disabledAdmins, pct: stats.offboardingCount > 0 ? Math.round((stats.disabledAdmins / stats.offboardingCount) * 100) : 0, cls: 'bg-critical', showCount: true },
            { name: 'Inactive Still Enabled', count: stats.inactiveEnabled, pct: stats.offboardingCount > 0 ? Math.round((stats.inactiveEnabled / stats.offboardingCount) * 100) : 0, cls: 'bg-info', showCount: true }
        ]));

        // Guest Status card
        analyticsGrid.appendChild(createPlatformCard('Guest Status', [
            { name: 'Stale Guests', count: stats.staleGuests, pct: stats.guestCount > 0 ? Math.round((stats.staleGuests / stats.guestCount) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'Pending Invites', count: stats.pendingGuests, pct: stats.guestCount > 0 ? Math.round((stats.pendingGuests / stats.guestCount) * 100) : 0, cls: 'bg-orange', showCount: true },
            { name: 'Never Signed In', count: stats.neverSignedIn, pct: stats.guestCount > 0 ? Math.round((stats.neverSignedIn / stats.guestCount) * 100) : 0, cls: 'bg-critical', showCount: true }
        ]));

        // Governance Issues card
        analyticsGrid.appendChild(createPlatformCard('Governance Issues', [
            { name: 'Ownerless Teams', count: stats.ownerlessTeams, pct: stats.teamsCount > 0 ? Math.round((stats.ownerlessTeams / stats.teamsCount) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'Sites w/ Anon Links', count: stats.anonLinkSites, pct: stats.spCount > 0 ? Math.round((stats.anonLinkSites / stats.spCount) * 100) : 0, cls: 'bg-critical', showCount: true },
            { name: 'Sites w/o Labels', count: stats.noLabelSites, pct: stats.spCount > 0 ? Math.round((stats.noLabelSites / stats.spCount) * 100) : 0, cls: 'bg-info', showCount: true }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = el('div', 'insights-list');

        // Offboarding insight
        if (stats.offboardingCount > 0) {
            insightsList.appendChild(createInsightCard('warning', 'CLEANUP', 'Offboarding Issues',
                stats.offboardingCount + ' offboarding issue' + (stats.offboardingCount !== 1 ? 's' : '') + ' detected. Disabled accounts with licenses or admin roles need attention.',
                'Remove licenses from disabled accounts and revoke admin roles to reduce costs and security exposure.'));
        }

        // Role hygiene insight
        if (stats.roleCount > 0) {
            insightsList.appendChild(createInsightCard('critical', 'SECURITY', 'Role Hygiene',
                stats.roleCount + ' admin account' + (stats.roleCount !== 1 ? 's' : '') + ' with security concerns. Inactive admins or admins without MFA pose significant risk.',
                'Review admin accounts and enforce MFA for all privileged roles.'));
        }

        // Guest cleanup insight
        if (stats.guestCount > 0) {
            insightsList.appendChild(createInsightCard('info', 'REVIEW', 'Guest Lifecycle',
                stats.guestCount + ' guest' + (stats.guestCount !== 1 ? 's' : '') + ' require review. Stale or pending guests increase external exposure.',
                'Run access reviews for external users and remove stale guest accounts.'));
        }

        // Teams/SP governance insight
        if (stats.teamsCount > 0 || stats.spCount > 0) {
            insightsList.appendChild(createInsightCard('info', 'GOVERNANCE', 'Collaboration Issues',
                (stats.teamsCount + stats.spCount) + ' Teams and SharePoint governance issue' + ((stats.teamsCount + stats.spCount) !== 1 ? 's' : '') + ' found.',
                'Assign owners to orphan teams and review sites with anonymous links.'));
        }

        // Healthy state
        if (stats.totalIssues === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Lifecycle Status',
                'No lifecycle issues detected. User, guest, and collaboration governance is healthy.',
                null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Creates a summary card for the header.
     */
    function createSummaryCard(label, value, valueClass, cardClass) {
        var card = el('div', 'card' + (cardClass ? ' ' + cardClass : ''));
        card.appendChild(el('div', 'card-label', label));
        card.appendChild(el('div', 'card-value' + (valueClass ? ' ' + valueClass : ''), String(value)));
        return card;
    }

    /**
     * Creates a section with header and table container.
     */
    function createSection(title, subtitle, subsections) {
        var section = el('div', 'section');
        var header = el('div', 'section-header');
        var headerInner = el('div');
        headerInner.appendChild(el('h3', 'section-title', title));
        headerInner.appendChild(el('p', 'section-subtitle', subtitle));
        header.appendChild(headerInner);
        section.appendChild(header);

        subsections.forEach(function(sub) {
            var h4 = el('h4', sub.isFirst ? 'mb-sm' : 'mb-sm mt-lg', sub.title + ' (' + sub.count + ')');
            section.appendChild(h4);
            var tableDiv = el('div');
            tableDiv.id = sub.tableId;
            section.appendChild(tableDiv);
        });

        return section;
    }

    /**
     * Renders the lifecycle page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        container.textContent = '';

        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;
        var guests = DataLoader.getData('guests');
        var adminRoles = DataLoader.getData('adminRoles');
        var teams = DataLoader.getData('teams');
        var spSites = DataLoader.getData('sharepointSites');

        // Calculate offboarding issues
        var disabledWithLicenses = users.filter(function(u) { return !u.accountEnabled && u.licenseCount > 0; });
        var inactiveStillEnabled = users.filter(function(u) { return u.isInactive && u.accountEnabled; });

        // Find disabled users with admin roles
        var disabledAdmins = [];
        adminRoles.forEach(function(role) {
            role.members.forEach(function(member) {
                if (!member.accountEnabled) {
                    disabledAdmins.push(Object.assign({}, member, { roleName: role.roleName }));
                }
            });
        });

        // Calculate onboarding gaps (created in last 30 days)
        var thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        var newUsers = users.filter(function(u) {
            if (!u.createdDateTime) return false;
            var created = new Date(u.createdDateTime);
            return created >= thirtyDaysAgo;
        });

        var newUsersNoSignIn = newUsers.filter(function(u) { return !u.lastSignIn; });
        var newUsersNoMfa = newUsers.filter(function(u) { return !u.mfaRegistered; });

        // Calculate role hygiene issues
        var inactiveAdmins = [];
        var adminsNoMfa = [];

        adminRoles.forEach(function(role) {
            role.members.forEach(function(member) {
                if (member.isInactive) {
                    inactiveAdmins.push(Object.assign({}, member, { roleName: role.roleName }));
                }
                // Check MFA from users data
                var userData = users.find(function(u) { return u.id === member.userId; });
                if (userData && !userData.mfaRegistered) {
                    adminsNoMfa.push(Object.assign({}, member, { roleName: role.roleName }));
                }
            });
        });

        // Calculate guest cleanup
        var staleGuests = guests.filter(function(g) { return g.isStale; });
        var pendingGuests = guests.filter(function(g) { return g.invitationState === 'PendingAcceptance'; });
        var neverSignedInGuests = guests.filter(function(g) { return g.neverSignedIn && g.invitationState === 'Accepted'; });

        // Calculate teams governance issues
        var ownerlessTeams = teams.filter(function(t) { return t.hasNoOwner; });
        var inactiveTeamsWithGuests = teams.filter(function(t) { return t.isInactive && t.hasGuests; });
        var teamsIssueCount = ownerlessTeams.length + inactiveTeamsWithGuests.length;

        // Calculate SharePoint governance issues (non-personal sites only)
        var spNonPersonal = spSites.filter(function(s) { return !s.isPersonalSite; });
        var sitesWithAnonymousLinks = spNonPersonal.filter(function(s) { return (s.anonymousLinkCount || 0) > 0; });
        var externalInactiveSites = spNonPersonal.filter(function(s) { return s.isInactive && s.hasExternalSharing; });
        var sitesWithoutLabels = spNonPersonal.filter(function(s) { return !s.sensitivityLabelId; });
        var spGovernanceCount = sitesWithAnonymousLinks.length + externalInactiveSites.length + sitesWithoutLabels.length;

        // Calculate total issues
        var offboardingCount = disabledWithLicenses.length + disabledAdmins.length + inactiveStillEnabled.length;
        var onboardingCount = newUsersNoSignIn.length + newUsersNoMfa.length;
        var roleCount = inactiveAdmins.length + adminsNoMfa.length;
        var guestCount = staleGuests.length + pendingGuests.length + neverSignedInGuests.length;
        var totalIssues = offboardingCount + onboardingCount + roleCount + guestCount + teamsIssueCount + spGovernanceCount;

        // Page header
        var pageHeader = el('div', 'page-header');
        pageHeader.appendChild(el('h2', 'page-title', 'Lifecycle Management'));
        pageHeader.appendChild(el('p', 'page-description', 'Account lifecycle issues requiring attention'));
        container.appendChild(pageHeader);

        // Summary cards
        var cardsGrid = el('div', 'cards-grid');
        cardsGrid.appendChild(createSummaryCard('Total Issues', totalIssues, totalIssues > 0 ? 'warning' : 'success', totalIssues > 0 ? 'card-warning' : 'card-success'));
        cardsGrid.appendChild(createSummaryCard('Offboarding Issues', offboardingCount, null, offboardingCount > 0 ? 'card-warning' : null));
        cardsGrid.appendChild(createSummaryCard('Role Hygiene', roleCount, null, roleCount > 0 ? 'card-critical' : null));
        cardsGrid.appendChild(createSummaryCard('Guest Cleanup', guestCount, null, guestCount > 0 ? 'card-warning' : null));
        cardsGrid.appendChild(createSummaryCard('Teams Governance', teamsIssueCount, teamsIssueCount > 0 ? 'warning' : null, teamsIssueCount > 0 ? 'card-warning' : null));
        cardsGrid.appendChild(createSummaryCard('SharePoint Governance', spGovernanceCount, spGovernanceCount > 0 ? 'warning' : null, spGovernanceCount > 0 ? 'card-warning' : null));
        container.appendChild(cardsGrid);

        // Lifecycle Overview section
        var overviewContainer = el('div');
        var stats = {
            totalIssues: totalIssues,
            totalEntities: users.length + guests.length + teams.length + spNonPersonal.length,
            offboardingCount: offboardingCount,
            onboardingCount: onboardingCount,
            roleCount: roleCount,
            guestCount: guestCount,
            teamsCount: teamsIssueCount,
            spCount: spGovernanceCount,
            disabledWithLicenses: disabledWithLicenses.length,
            disabledAdmins: disabledAdmins.length,
            inactiveEnabled: inactiveStillEnabled.length,
            staleGuests: staleGuests.length,
            pendingGuests: pendingGuests.length,
            neverSignedIn: neverSignedInGuests.length,
            ownerlessTeams: ownerlessTeams.length,
            anonLinkSites: sitesWithAnonymousLinks.length,
            noLabelSites: sitesWithoutLabels.length
        };
        renderLifecycleOverview(overviewContainer, stats);
        container.appendChild(overviewContainer);

        // Offboarding Issues Section
        container.appendChild(createSection('Offboarding Issues', 'Disabled accounts that still have licenses or admin roles assigned', [
            { title: 'Disabled Accounts with Licenses', count: disabledWithLicenses.length, tableId: 'offboarding-licenses-table', isFirst: true },
            { title: 'Inactive Users Still Enabled', count: inactiveStillEnabled.length, tableId: 'offboarding-inactive-table' }
        ]));

        // Onboarding Gaps Section
        container.appendChild(createSection('Onboarding Gaps', 'New users (last 30 days) missing required setup', [
            { title: 'New Users Never Signed In', count: newUsersNoSignIn.length, tableId: 'onboarding-nosignin-table', isFirst: true },
            { title: 'New Users Without MFA', count: newUsersNoMfa.length, tableId: 'onboarding-nomfa-table' }
        ]));

        // Role Hygiene Section
        container.appendChild(createSection('Role Hygiene', 'Admin accounts with security concerns', [
            { title: 'Inactive Admins', count: inactiveAdmins.length, tableId: 'role-inactive-table', isFirst: true },
            { title: 'Admins Without MFA', count: adminsNoMfa.length, tableId: 'role-nomfa-table' }
        ]));

        // Guest Cleanup Section
        container.appendChild(createSection('Guest Cleanup', 'External users requiring review or removal', [
            { title: 'Stale Guests', count: staleGuests.length, tableId: 'guest-stale-table', isFirst: true },
            { title: 'Pending Invitations', count: pendingGuests.length, tableId: 'guest-pending-table' }
        ]));

        // Teams Governance Section
        container.appendChild(createSection('Teams Governance', 'Teams requiring ownership or access review', [
            { title: 'Ownerless Teams', count: ownerlessTeams.length, tableId: 'teams-ownerless-table', isFirst: true },
            { title: 'Inactive Teams with Guest Access', count: inactiveTeamsWithGuests.length, tableId: 'teams-inactive-guests-table' }
        ]));

        // SharePoint Governance Section
        container.appendChild(createSection('SharePoint Governance', 'Sites with sharing exposure, missing labels, or inactive external access', [
            { title: 'Sites with Anonymous Links', count: sitesWithAnonymousLinks.length, tableId: 'sp-anon-links-table', isFirst: true },
            { title: 'Inactive Sites with External Sharing', count: externalInactiveSites.length, tableId: 'sp-external-inactive-table' },
            { title: 'Sites Without Sensitivity Labels', count: sitesWithoutLabels.length, tableId: 'sp-no-labels-table' }
        ]));

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
