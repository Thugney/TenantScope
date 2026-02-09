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

    /** Current tab */
    var currentTab = 'overview';

    /** Cached page state */
    var lifecycleState = null;

    /** All issues combined for unified table */
    var allIssues = [];

    /** Column selector instance */
    var colSelector = null;

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
        bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (healthyPct > 0) {
            var healthyCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            healthyCircle.setAttribute('cx', '50');
            healthyCircle.setAttribute('cy', '50');
            healthyCircle.setAttribute('r', '40');
            healthyCircle.setAttribute('fill', 'none');
            healthyCircle.setAttribute('stroke', 'var(--color-success)');
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
            issuesCircle.setAttribute('stroke', 'var(--color-warning)');
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
        var healthyCount = Math.max((stats.totalEntities || 0) - (stats.totalIssues || 0), 0);
        var legendItems = [
            { cls: 'bg-success', label: 'Healthy', value: healthyCount },
            { cls: 'bg-warning', label: 'Issues', value: stats.totalIssues }
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
            { name: 'Inactive Still Enabled', count: stats.inactiveEnabled, pct: stats.offboardingCount > 0 ? Math.round((stats.inactiveEnabled / stats.offboardingCount) * 100) : 0, cls: 'bg-info', showCount: true },
            { name: 'Leave Date Passed', count: stats.overdueLeavers || 0, pct: stats.offboardingCount > 0 ? Math.round(((stats.overdueLeavers || 0) / stats.offboardingCount) * 100) : 0, cls: 'bg-critical', showCount: true },
            { name: 'Leaving in 30d', count: stats.upcomingLeavers || 0, pct: stats.offboardingCount > 0 ? Math.round(((stats.upcomingLeavers || 0) / stats.offboardingCount) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'Deleted Pending Purge', count: stats.deletedUsers, pct: stats.offboardingCount > 0 ? Math.round((stats.deletedUsers / stats.offboardingCount) * 100) : 0, cls: 'bg-orange', showCount: true }
        ]));

        // Onboarding Details card
        analyticsGrid.appendChild(createPlatformCard('Onboarding Details', [
            { name: 'Never Signed In', count: stats.newUsersNoSignIn || 0, pct: stats.onboardingCount > 0 ? Math.round(((stats.newUsersNoSignIn || 0) / stats.onboardingCount) * 100) : 0, cls: 'bg-info', showCount: true },
            { name: 'No MFA Registered', count: stats.newUsersNoMfa || 0, pct: stats.onboardingCount > 0 ? Math.round(((stats.newUsersNoMfa || 0) / stats.onboardingCount) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'Missing Profile', count: stats.newUsersMissingProfile || 0, pct: stats.onboardingCount > 0 ? Math.round(((stats.newUsersMissingProfile || 0) / stats.onboardingCount) * 100) : 0, cls: 'bg-orange', showCount: true }
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
                stats.offboardingCount + ' offboarding issue' + (stats.offboardingCount !== 1 ? 's' : '') + ' detected. Disabled accounts, risky admin roles, and pending deletions need attention.',
                'Remove licenses from disabled accounts, revoke admin roles, and review deleted users before permanent purge.'));
        }

        // Leave date insight
        if (stats.overdueLeavers > 0) {
            insightsList.appendChild(createInsightCard('critical', 'OFFBOARD', 'Leave Date Passed',
                stats.overdueLeavers + ' account' + (stats.overdueLeavers !== 1 ? 's have' : ' has') + ' a leave date in the past but remain enabled.',
                'Disable accounts and complete offboarding for past leave dates.'));
        } else if (stats.upcomingLeavers > 0) {
            insightsList.appendChild(createInsightCard('info', 'PLANNING', 'Leaving Soon',
                stats.upcomingLeavers + ' account' + (stats.upcomingLeavers !== 1 ? 's are' : ' is') + ' scheduled to leave within 30 days.',
                'Begin offboarding preparation and access reviews.'));
        }

        // Deleted users insight (purge window)
        if (stats.deletedCritical > 0 || stats.deletedHigh > 0) {
            var urgencyCount = stats.deletedCritical + stats.deletedHigh;
            insightsList.appendChild(createInsightCard('critical', 'URGENT', 'Deleted Users',
                urgencyCount + ' deleted user' + (urgencyCount !== 1 ? 's' : '') + ' will be permanently removed within 7 days.',
                'Review and restore any accounts that should not be permanently deleted.'));
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
     * Switches to a different tab.
     */
    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    /**
     * Renders the content for the current tab.
     */
    function renderContent() {
        var container = document.getElementById('lifecycle-content');
        if (!container || !lifecycleState) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'issues':
                renderIssuesTab(container);
                break;
        }
    }

    /**
     * Renders the Overview tab.
     */
    function renderOverviewTab(container) {
        container.textContent = '';
        renderLifecycleOverview(container, lifecycleState.stats);
    }

    /**
     * Builds the unified issues list from all issue types.
     */
    function buildIssuesList(data) {
        var issues = [];

        // Offboarding - Disabled with Licenses
        data.disabledWithLicenses.forEach(function(u) {
            issues.push({
                category: 'Offboarding',
                issueType: 'Disabled with Licenses',
                severity: 'warning',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: u.licenseCount + ' licenses',
                detail2: '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: u.createdDateTime,
                _original: u
            });
        });

        // Offboarding - Inactive Still Enabled
        data.inactiveStillEnabled.forEach(function(u) {
            issues.push({
                category: 'Offboarding',
                issueType: 'Inactive Still Enabled',
                severity: 'warning',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: u.licenseCount + ' licenses',
                detail2: '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: u.createdDateTime,
                _original: u
            });
        });

        // Offboarding - Leave Date Passed
        (data.overdueLeavers || []).forEach(function(u) {
            issues.push({
                category: 'Offboarding',
                issueType: 'Leave Date Passed',
                severity: 'critical',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: u.employeeLeaveDateTime ? ('Leave date: ' + u.employeeLeaveDateTime) : 'Leave date passed',
                detail2: (u.daysUntilLeave !== null && u.daysUntilLeave !== undefined) ? ('Days overdue: ' + Math.abs(u.daysUntilLeave)) : '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: u.employeeLeaveDateTime,
                _original: u
            });
        });

        // Offboarding - Leaving Soon
        (data.upcomingLeavers || []).forEach(function(u) {
            issues.push({
                category: 'Offboarding',
                issueType: 'Leaving Soon',
                severity: 'warning',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: u.employeeLeaveDateTime ? ('Leave date: ' + u.employeeLeaveDateTime) : 'Leave date soon',
                detail2: (u.daysUntilLeave !== null && u.daysUntilLeave !== undefined) ? ('Days until leave: ' + u.daysUntilLeave) : '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: u.employeeLeaveDateTime,
                _original: u
            });
        });

        // Offboarding - Deleted Users Pending Purge
        data.deletedUsers.forEach(function(u) {
            var severity = 'info';
            if (u.urgency === 'Critical') severity = 'critical';
            else if (u.urgency === 'High' || u.urgency === 'Medium') severity = 'warning';

            var purgeDetail = (u.daysUntilPermanentDeletion !== null && u.daysUntilPermanentDeletion !== undefined)
                ? ('Purge in ' + u.daysUntilPermanentDeletion + ' days')
                : 'Purge date unknown';

            issues.push({
                category: 'Offboarding',
                issueType: 'Deleted User Pending Purge',
                severity: severity,
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: purgeDetail,
                detail2: 'Urgency: ' + (u.urgency || 'Normal'),
                daysInactive: u.daysSinceDeletion || 0,
                lastActivity: u.deletedDateTime,
                createdDate: u.permanentDeletionDate,
                _original: u
            });
        });

        // Onboarding - Never Signed In
        data.newUsersNoSignIn.forEach(function(u) {
            issues.push({
                category: 'Onboarding',
                issueType: 'Never Signed In',
                severity: 'info',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: 'New user',
                detail2: '',
                daysInactive: 0,
                lastActivity: null,
                createdDate: u.createdDateTime,
                _original: u
            });
        });

        // Onboarding - No MFA
        data.newUsersNoMfa.forEach(function(u) {
            issues.push({
                category: 'Onboarding',
                issueType: 'No MFA Registered',
                severity: 'warning',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: 'MFA not set up',
                detail2: '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: u.createdDateTime,
                _original: u
            });
        });

        // Onboarding - Missing Profile
        (data.newUsersMissingProfile || []).forEach(function(u) {
            var missing = u.missingProfileFields ? u.missingProfileFields.join(', ') : 'Profile incomplete';
            issues.push({
                category: 'Onboarding',
                issueType: 'Missing Profile',
                severity: 'info',
                entityType: 'User',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.department || '',
                detail1: missing,
                detail2: '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: u.createdDateTime,
                _original: u
            });
        });

        // Role Hygiene - Inactive Admins
        data.inactiveAdmins.forEach(function(u) {
            issues.push({
                category: 'Role Hygiene',
                issueType: 'Inactive Admin',
                severity: 'critical',
                entityType: 'Admin',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.roleName || '',
                detail1: u.roleName || '',
                detail2: '',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: null,
                _original: u
            });
        });

        // Role Hygiene - Admins No MFA
        data.adminsNoMfa.forEach(function(u) {
            issues.push({
                category: 'Role Hygiene',
                issueType: 'Admin Without MFA',
                severity: 'critical',
                entityType: 'Admin',
                displayName: u.displayName,
                identifier: u.userPrincipalName,
                department: u.roleName || '',
                detail1: u.roleName || '',
                detail2: 'No MFA',
                daysInactive: u.daysSinceLastSignIn || 0,
                lastActivity: u.lastSignIn,
                createdDate: null,
                _original: u
            });
        });

        // Guest Cleanup - Stale Guests
        data.staleGuests.forEach(function(g) {
            issues.push({
                category: 'Guest Cleanup',
                issueType: 'Stale Guest',
                severity: 'warning',
                entityType: 'Guest',
                displayName: g.displayName,
                identifier: g.mail || g.userPrincipalName,
                department: g.sourceDomain || '',
                detail1: g.sourceDomain || '',
                detail2: '',
                daysInactive: g.daysSinceLastSignIn || 0,
                lastActivity: g.lastSignIn,
                createdDate: g.createdDateTime,
                _original: g
            });
        });

        // Guest Cleanup - Pending Invites
        data.pendingGuests.forEach(function(g) {
            issues.push({
                category: 'Guest Cleanup',
                issueType: 'Pending Invitation',
                severity: 'info',
                entityType: 'Guest',
                displayName: g.displayName,
                identifier: g.mail || g.userPrincipalName,
                department: g.sourceDomain || '',
                detail1: g.sourceDomain || '',
                detail2: 'Pending',
                daysInactive: 0,
                lastActivity: null,
                createdDate: g.createdDateTime,
                _original: g
            });
        });

        // Teams - Ownerless
        data.ownerlessTeams.forEach(function(t) {
            issues.push({
                category: 'Teams',
                issueType: 'Ownerless Team',
                severity: 'warning',
                entityType: 'Team',
                displayName: t.displayName,
                identifier: t.mail || '',
                department: t.visibility || '',
                detail1: t.memberCount + ' members',
                detail2: t.visibility,
                daysInactive: t.daysSinceActivity || 0,
                lastActivity: t.lastActivityDate,
                createdDate: t.createdDateTime,
                _original: t
            });
        });

        // Teams - Inactive with Guests
        data.inactiveTeamsWithGuests.forEach(function(t) {
            issues.push({
                category: 'Teams',
                issueType: 'Inactive with Guests',
                severity: 'warning',
                entityType: 'Team',
                displayName: t.displayName,
                identifier: t.mail || '',
                department: t.visibility || '',
                detail1: t.guestCount + ' guests',
                detail2: t.memberCount + ' members',
                daysInactive: t.daysSinceActivity || 0,
                lastActivity: t.lastActivityDate,
                createdDate: t.createdDateTime,
                _original: t
            });
        });

        // SharePoint - Anonymous Links
        data.sitesWithAnonymousLinks.forEach(function(s) {
            issues.push({
                category: 'SharePoint',
                issueType: 'Anonymous Links',
                severity: 'critical',
                entityType: 'Site',
                displayName: s.displayName,
                identifier: s.webUrl || '',
                department: s.ownerDisplayName || '',
                detail1: s.anonymousLinkCount + ' anon links',
                detail2: s.guestLinkCount + ' guest links',
                daysInactive: s.daysSinceActivity || 0,
                lastActivity: s.lastActivityDate,
                createdDate: s.createdDateTime,
                _original: s
            });
        });

        // SharePoint - Inactive External
        data.externalInactiveSites.forEach(function(s) {
            issues.push({
                category: 'SharePoint',
                issueType: 'Inactive External Sharing',
                severity: 'warning',
                entityType: 'Site',
                displayName: s.displayName,
                identifier: s.webUrl || '',
                department: s.ownerDisplayName || '',
                detail1: s.externalSharing,
                detail2: s.totalSharingLinks + ' links',
                daysInactive: s.daysSinceActivity || 0,
                lastActivity: s.lastActivityDate,
                createdDate: s.createdDateTime,
                _original: s
            });
        });

        // SharePoint - No Labels
        data.sitesWithoutLabels.forEach(function(s) {
            issues.push({
                category: 'SharePoint',
                issueType: 'No Sensitivity Label',
                severity: 'info',
                entityType: 'Site',
                displayName: s.displayName,
                identifier: s.webUrl || '',
                department: s.ownerDisplayName || '',
                detail1: s.template || '',
                detail2: s.fileCount + ' files',
                daysInactive: s.daysSinceActivity || 0,
                lastActivity: s.lastActivityDate,
                createdDate: s.createdDateTime,
                _original: s
            });
        });

        return issues;
    }

    /**
     * Applies filters and renders the issues table.
     */
    function applyIssuesFilters() {
        var filtered = allIssues.slice();

        // Search filter
        var search = Filters.getValue('lifecycle-search');
        if (search) {
            var term = search.toLowerCase();
            filtered = filtered.filter(function(i) {
                return (i.displayName && i.displayName.toLowerCase().indexOf(term) !== -1) ||
                       (i.identifier && i.identifier.toLowerCase().indexOf(term) !== -1) ||
                       (i.department && i.department.toLowerCase().indexOf(term) !== -1);
            });
        }

        // Category filter
        var category = Filters.getValue('lifecycle-category');
        if (category && category !== 'all') {
            filtered = filtered.filter(function(i) { return i.category === category; });
        }

        // Severity filter
        var severity = Filters.getValue('lifecycle-severity');
        if (severity && severity !== 'all') {
            filtered = filtered.filter(function(i) { return i.severity === severity; });
        }

        // Entity type filter
        var entityType = Filters.getValue('lifecycle-entity');
        if (entityType && entityType !== 'all') {
            filtered = filtered.filter(function(i) { return i.entityType === entityType; });
        }

        // Update count display
        var countDiv = document.getElementById('lifecycle-count');
        if (countDiv) {
            countDiv.textContent = filtered.length + ' issues found' + (filtered.length !== allIssues.length ? ' (filtered from ' + allIssues.length + ')' : '');
        }

        // Update summary cards based on filtered data
        updateFilteredSummaryCards(filtered);

        renderIssuesTable(filtered);
    }

    /**
     * Updates summary cards based on filtered issues data.
     */
    function updateFilteredSummaryCards(filteredIssues) {
        // Calculate counts from filtered data
        var totalCount = filteredIssues.length;
        var criticalCount = filteredIssues.filter(function(i) { return i.severity === 'critical'; }).length;
        var warningCount = filteredIssues.filter(function(i) { return i.severity === 'warning'; }).length;
        var infoCount = filteredIssues.filter(function(i) { return i.severity === 'info'; }).length;

        // Update summary card values if they exist
        var totalEl = document.getElementById('lifecycle-total-value');
        var criticalEl = document.getElementById('lifecycle-critical-value');
        var warningEl = document.getElementById('lifecycle-warning-value');
        var infoEl = document.getElementById('lifecycle-info-value');

        if (totalEl) totalEl.textContent = totalCount;
        if (criticalEl) criticalEl.textContent = criticalCount;
        if (warningEl) warningEl.textContent = warningCount;
        if (infoEl) infoEl.textContent = infoCount;
    }

    /**
     * Renders the unified issues table.
     */
    function renderIssuesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : [
            'category', 'issueType', 'severity', 'displayName', 'identifier', 'detail1', 'daysInactive'
        ];

        var allDefs = [
            { key: 'category', label: 'Category', formatter: formatCategory },
            { key: 'issueType', label: 'Issue Type' },
            { key: 'severity', label: 'Severity', formatter: formatSeverity },
            { key: 'entityType', label: 'Entity Type', formatter: formatEntityType },
            { key: 'displayName', label: 'Name' },
            { key: 'identifier', label: 'Identifier', className: 'cell-truncate' },
            { key: 'department', label: 'Dept/Role/Owner' },
            { key: 'detail1', label: 'Detail' },
            { key: 'detail2', label: 'Additional' },
            { key: 'daysInactive', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays, className: 'cell-right' },
            { key: 'lastActivity', label: 'Last Activity', formatter: Tables.formatters.date },
            { key: 'createdDate', label: 'Created', formatter: Tables.formatters.date }
        ];

        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'lifecycle-issues-table',
            data: data,
            columns: columns,
            pageSize: 25,
            getRowClass: function(row) {
                if (row.severity === 'critical') return 'row-critical';
                if (row.severity === 'warning') return 'row-warning';
                return '';
            }
        });
    }

    function formatCategory(value) {
        var colors = {
            'Offboarding': 'badge-warning',
            'Onboarding': 'badge-info',
            'Role Hygiene': 'badge-critical',
            'Guest Cleanup': 'badge-warning',
            'Teams': 'badge-purple',
            'SharePoint': 'badge-neutral'
        };
        return '<span class="badge ' + (colors[value] || 'badge-neutral') + '">' + value + '</span>';
    }

    function formatSeverity(value) {
        var badges = {
            'critical': 'badge-critical',
            'warning': 'badge-warning',
            'info': 'badge-info'
        };
        return '<span class="badge ' + (badges[value] || 'badge-neutral') + '">' + value.charAt(0).toUpperCase() + value.slice(1) + '</span>';
    }

    function formatEntityType(value) {
        var badges = {
            'User': 'badge-info',
            'Admin': 'badge-critical',
            'Guest': 'badge-warning',
            'Team': 'badge-purple',
            'Site': 'badge-neutral'
        };
        return '<span class="badge ' + (badges[value] || 'badge-neutral') + '">' + value + '</span>';
    }

    /**
     * Renders the Issues tab with unified filterable table.
     */
    function renderIssuesTab(container) {
        container.textContent = '';

        // Build unified issues list
        allIssues = buildIssuesList(lifecycleState);

        // Update summary cards with initial counts
        updateFilteredSummaryCards(allIssues);

        // Get unique categories for filter
        var categories = ['Offboarding', 'Onboarding', 'Role Hygiene', 'Guest Cleanup', 'Teams', 'SharePoint'];

        // Filters
        var filterDiv = el('div');
        filterDiv.id = 'lifecycle-filter';
        container.appendChild(filterDiv);

        // Table toolbar with proper flex layout
        var toolbar = el('div', 'table-toolbar');
        toolbar.style.cssText = 'display:flex;align-items:center;gap:1rem;margin-bottom:1rem;';
        var colSelectorDiv = el('div');
        colSelectorDiv.id = 'lifecycle-col-selector';
        toolbar.appendChild(colSelectorDiv);
        var exportBtn = el('button', 'btn btn-secondary btn-sm', 'Export CSV');
        exportBtn.id = 'export-lifecycle-table';
        toolbar.appendChild(exportBtn);
        container.appendChild(toolbar);

        // Issues count
        var countDiv = el('div', 'table-count');
        countDiv.id = 'lifecycle-count';
        countDiv.textContent = allIssues.length + ' issues found';
        container.appendChild(countDiv);

        // Data table
        var tableDiv = el('div');
        tableDiv.id = 'lifecycle-issues-table';
        container.appendChild(tableDiv);

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'lifecycle-filter',
            controls: [
                { type: 'search', id: 'lifecycle-search', label: 'Search', placeholder: 'Search issues...' },
                { type: 'select', id: 'lifecycle-category', label: 'Category', options: [
                    { value: 'all', label: 'All Categories' }
                ].concat(categories.map(function(c) { return { value: c, label: c }; })) },
                { type: 'select', id: 'lifecycle-severity', label: 'Severity', options: [
                    { value: 'all', label: 'All Severities' },
                    { value: 'critical', label: 'Critical' },
                    { value: 'warning', label: 'Warning' },
                    { value: 'info', label: 'Info' }
                ]},
                { type: 'select', id: 'lifecycle-entity', label: 'Entity', options: [
                    { value: 'all', label: 'All Entities' },
                    { value: 'User', label: 'Users' },
                    { value: 'Admin', label: 'Admins' },
                    { value: 'Guest', label: 'Guests' },
                    { value: 'Team', label: 'Teams' },
                    { value: 'Site', label: 'Sites' }
                ]}
            ],
            onFilter: applyIssuesFilters
        });

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'lifecycle-col-selector',
                storageKey: 'lifecycle-columns',
                allColumns: [
                    { key: 'category', label: 'Category' },
                    { key: 'issueType', label: 'Issue Type' },
                    { key: 'severity', label: 'Severity' },
                    { key: 'entityType', label: 'Entity Type' },
                    { key: 'displayName', label: 'Name' },
                    { key: 'identifier', label: 'Identifier' },
                    { key: 'department', label: 'Dept/Role/Owner' },
                    { key: 'detail1', label: 'Detail' },
                    { key: 'detail2', label: 'Additional' },
                    { key: 'daysInactive', label: 'Days Inactive' },
                    { key: 'lastActivity', label: 'Last Activity' },
                    { key: 'createdDate', label: 'Created' }
                ],
                defaultVisible: [
                    'category', 'issueType', 'severity', 'displayName', 'identifier', 'detail1', 'daysInactive'
                ],
                onColumnsChanged: applyIssuesFilters
            });
        }

        // Bind export button
        Export.bindExportButton('lifecycle-issues-table', 'lifecycle-issues');

        // Initial render
        applyIssuesFilters();
    }

    /**
     * Creates a summary card for the header.
     */
    function createSummaryCard(label, value, valueClass, cardClass, valueId) {
        var card = el('div', 'card' + (cardClass ? ' ' + cardClass : ''));
        card.appendChild(el('div', 'card-label', label));
        var valueEl = el('div', 'card-value' + (valueClass ? ' ' + valueClass : ''), String(value));
        if (valueId) valueEl.id = valueId;
        card.appendChild(valueEl);
        return card;
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
        var deletedUsers = DataLoader.getData('deletedUsers');

        function isUserMember(member) {
            if (!member) return false;
            if (member.memberType === 'User') return true;
            if (!member.memberType) {
                return !!(member.userId || member.userPrincipalName || member.accountEnabled !== undefined);
            }
            return false;
        }

        function getLeaveDays(user) {
            if (!user) return null;
            if (typeof user.daysUntilLeave === 'number') return user.daysUntilLeave;
            if (typeof user.daysUntilLeave === 'string' && user.daysUntilLeave.trim() !== '') {
                var parsed = parseInt(user.daysUntilLeave, 10);
                if (!isNaN(parsed)) return parsed;
            }
            if (!user.employeeLeaveDateTime) return null;
            var leaveDate = new Date(user.employeeLeaveDateTime);
            if (isNaN(leaveDate)) return null;
            return Math.floor((leaveDate - new Date()) / 86400000);
        }

        function getMissingProfileFields(user) {
            var missing = [];
            if (!user) return missing;
            if (!user.manager && !user.managerId && !user.managerUpn) missing.push('Manager');
            if (!user.department) missing.push('Department');
            if (!user.jobTitle) missing.push('Job Title');
            return missing;
        }

        // Calculate offboarding issues
        var disabledWithLicenses = users.filter(function(u) { return !u.accountEnabled && u.licenseCount > 0; });
        var inactiveStillEnabled = users.filter(function(u) { return u.isInactive && u.accountEnabled; });

        var upcomingLeavers = [];
        var overdueLeavers = [];
        users.forEach(function(u) {
            if (!u.accountEnabled) return;
            var daysUntilLeave = getLeaveDays(u);
            if (daysUntilLeave === null || daysUntilLeave === undefined || isNaN(daysUntilLeave)) return;
            var enriched = Object.assign({}, u, { daysUntilLeave: daysUntilLeave });
            if (daysUntilLeave < 0) {
                overdueLeavers.push(enriched);
            } else if (daysUntilLeave <= 30) {
                upcomingLeavers.push(enriched);
            }
        });

        // Find disabled users with admin roles
        var disabledAdmins = [];
        adminRoles.forEach(function(role) {
            role.members.forEach(function(member) {
                if (!isUserMember(member)) return;
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
        var newUsersMissingProfile = [];
        newUsers.forEach(function(u) {
            var missing = getMissingProfileFields(u);
            if (missing.length > 0) {
                newUsersMissingProfile.push(Object.assign({}, u, { missingProfileFields: missing }));
            }
        });

        // Calculate role hygiene issues
        var inactiveAdmins = [];
        var adminsNoMfa = [];

        adminRoles.forEach(function(role) {
            role.members.forEach(function(member) {
                if (!isUserMember(member)) return;
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

        // Calculate deleted user risk
        var deletedCritical = deletedUsers.filter(function(u) { return u.urgency === 'Critical'; });
        var deletedHigh = deletedUsers.filter(function(u) { return u.urgency === 'High'; });
        var deletedMedium = deletedUsers.filter(function(u) { return u.urgency === 'Medium'; });
        var deletedNormal = deletedUsers.filter(function(u) { return u.urgency === 'Normal'; });

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
        var offboardingCount = disabledWithLicenses.length + disabledAdmins.length + inactiveStillEnabled.length + deletedUsers.length + upcomingLeavers.length + overdueLeavers.length;
        var onboardingCount = newUsersNoSignIn.length + newUsersNoMfa.length + newUsersMissingProfile.length;
        var roleCount = inactiveAdmins.length + adminsNoMfa.length;
        var guestCount = staleGuests.length + pendingGuests.length + neverSignedInGuests.length;
        var totalIssues = offboardingCount + onboardingCount + roleCount + guestCount + teamsIssueCount + spGovernanceCount;

        // Page header
        var pageHeader = el('div', 'page-header');
        pageHeader.appendChild(el('h2', 'page-title', 'Lifecycle Management'));
        pageHeader.appendChild(el('p', 'page-description', 'Account lifecycle issues requiring attention'));
        container.appendChild(pageHeader);

        // Summary cards with IDs for filter updates
        var cardsGrid = el('div', 'summary-cards');
        cardsGrid.id = 'lifecycle-summary-cards';
        cardsGrid.appendChild(createSummaryCard('Total Issues', totalIssues, totalIssues > 0 ? 'warning' : 'success', totalIssues > 0 ? 'card-warning' : 'card-success', 'lifecycle-total-value'));
        // Count by severity for filtered updates
        var criticalCount = 0, warningCount = 0, infoCount = 0;
        // These will be calculated when issues are built
        cardsGrid.appendChild(createSummaryCard('Critical', criticalCount, null, criticalCount > 0 ? 'card-critical' : null, 'lifecycle-critical-value'));
        cardsGrid.appendChild(createSummaryCard('Warning', warningCount, null, warningCount > 0 ? 'card-warning' : null, 'lifecycle-warning-value'));
        cardsGrid.appendChild(createSummaryCard('Info', infoCount, null, null, 'lifecycle-info-value'));
        container.appendChild(cardsGrid);

        // Cache state for tab rendering
        lifecycleState = {
            stats: {
            totalIssues: totalIssues,
            totalEntities: users.length + guests.length + teams.length + spNonPersonal.length + deletedUsers.length,
            offboardingCount: offboardingCount,
            onboardingCount: onboardingCount,
            roleCount: roleCount,
            guestCount: guestCount,
            teamsCount: teamsIssueCount,
            spCount: spGovernanceCount,
            disabledWithLicenses: disabledWithLicenses.length,
            disabledAdmins: disabledAdmins.length,
            inactiveEnabled: inactiveStillEnabled.length,
            deletedUsers: deletedUsers.length,
            overdueLeavers: overdueLeavers.length,
            upcomingLeavers: upcomingLeavers.length,
            newUsersNoSignIn: newUsersNoSignIn.length,
            newUsersNoMfa: newUsersNoMfa.length,
            newUsersMissingProfile: newUsersMissingProfile.length,
            deletedCritical: deletedCritical.length,
            deletedHigh: deletedHigh.length,
            deletedMedium: deletedMedium.length,
            staleGuests: staleGuests.length,
            pendingGuests: pendingGuests.length,
            neverSignedIn: neverSignedInGuests.length,
            ownerlessTeams: ownerlessTeams.length,
            anonLinkSites: sitesWithAnonymousLinks.length,
            noLabelSites: sitesWithoutLabels.length
            },
            disabledWithLicenses: disabledWithLicenses,
            inactiveStillEnabled: inactiveStillEnabled,
            overdueLeavers: overdueLeavers,
            upcomingLeavers: upcomingLeavers,
            deletedUsers: deletedUsers,
            deletedCritical: deletedCritical,
            deletedHigh: deletedHigh,
            deletedMedium: deletedMedium,
            deletedNormal: deletedNormal,
            newUsersNoSignIn: newUsersNoSignIn,
            newUsersNoMfa: newUsersNoMfa,
            newUsersMissingProfile: newUsersMissingProfile,
            inactiveAdmins: inactiveAdmins,
            adminsNoMfa: adminsNoMfa,
            staleGuests: staleGuests,
            pendingGuests: pendingGuests,
            ownerlessTeams: ownerlessTeams,
            inactiveTeamsWithGuests: inactiveTeamsWithGuests,
            sitesWithAnonymousLinks: sitesWithAnonymousLinks,
            externalInactiveSites: externalInactiveSites,
            sitesWithoutLabels: sitesWithoutLabels
        };

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'issues', label: 'All Issues (' + totalIssues + ')' }
        ];
        tabs.forEach(function(t) {
            var btn = el('button', 'tab-btn' + (t.id === 'overview' ? ' active' : ''));
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            tabBar.appendChild(btn);
        });
        container.appendChild(tabBar);

        // Content area
        var contentArea = el('div', 'content-area');
        contentArea.id = 'lifecycle-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageLifecycle = PageLifecycle;
