/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: SECURITY
 *
 * Renders the security posture page with multiple sections:
 * - Risky Sign-ins
 * - Admin Roles
 * - MFA Gaps
 * - Defender Alerts
 */

const PageSecurity = (function() {
    'use strict';

    var currentTab = 'overview';
    var securityState = null;

    function buildState() {
        const allRiskySignins = DataLoader.getData('riskySignins') || [];
        const adminRoles = DataLoader.getData('adminRoles') || [];
        const allUsers = DataLoader.getData('users') || [];
        const defenderAlerts = DataLoader.getData('defenderAlerts') || [];
        const secureScore = DataLoader.getData('secureScore') || null;

        // Apply department filter to user-centric data
        const users = (typeof DepartmentFilter !== 'undefined')
            ? DepartmentFilter.filterData(allUsers, 'department')
            : allUsers;
        const riskySignins = (typeof DepartmentFilter !== 'undefined')
            ? DepartmentFilter.filterByUPN(allRiskySignins, 'userPrincipalName')
            : allRiskySignins;

        // Calculate stats
        const highRiskCount = riskySignins.filter(r => r.riskLevel === 'high').length;
        const mediumRiskCount = riskySignins.filter(r => r.riskLevel === 'medium').length;
        const noMfaUsers = users.filter(u => !u.mfaRegistered && u.accountEnabled);
        const activeAlerts = defenderAlerts.filter(a => a.status !== 'resolved');
        const highAlerts = defenderAlerts.filter(a => a.severity === 'high' && a.status !== 'resolved');

        // Secure Score data
        const hasSecureScore = secureScore && secureScore.scorePct !== undefined;
        const scorePct = hasSecureScore ? secureScore.scorePct : null;
        const scoreTextClass = scorePct >= 70 ? 'text-success' : (scorePct >= 40 ? 'text-warning' : 'text-critical');
        const scoreCardClass = scorePct >= 70 ? 'card-success' : (scorePct >= 40 ? 'card-warning' : 'card-danger');

        // Total admins (unique) - user principals only
        const adminUserIds = new Set();
        adminRoles.forEach(role => {
            (role.members || []).forEach(m => {
                if (m && m.memberType && m.memberType !== 'User') return;
                if (m && m.userId) {
                    adminUserIds.add(m.userId);
                }
            });
        });

        return {
            users: users,
            riskySignins: riskySignins,
            adminRoles: adminRoles,
            defenderAlerts: defenderAlerts,
            secureScore: secureScore,
            highRiskCount: highRiskCount,
            mediumRiskCount: mediumRiskCount,
            noMfaUsers: noMfaUsers,
            activeAlerts: activeAlerts,
            highAlerts: highAlerts,
            adminCount: adminUserIds.size,
            hasSecureScore: hasSecureScore,
            scorePct: scorePct,
            scoreTextClass: scoreTextClass,
            scoreCardClass: scoreCardClass
        };
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('security-content');
        if (!container || !securityState) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, securityState);
                break;
            case 'risky-signins':
                renderRiskySignins(container, securityState);
                break;
            case 'admin-roles':
                renderAdminRoles(container, securityState);
                break;
            case 'mfa-gaps':
                renderMfaGaps(container, securityState);
                break;
            case 'defender-alerts':
                renderDefenderAlerts(container, securityState);
                break;
        }
    }

    function renderOverview(container, data) {
        var html = '';

        // Summary Tables
        var highRiskSignins = data.riskySignins.filter(function(r) { return r.riskLevel === 'high' || r.riskLevel === 'medium'; });
        if (highRiskSignins.length > 0) {
            html += '<div class="analytics-section"><h3>Risky Sign-ins (' + highRiskSignins.length + ')</h3>';
            html += '<div id="risky-signins-overview-table"></div></div>';
        } else {
            html += '<div class="empty-state"><div class="empty-state-title">No risky sign-ins</div><div class="empty-state-description">No high or medium risk sign-ins detected.</div></div>';
        }

        if (data.noMfaUsers.length > 0) {
            html += '<div class="analytics-section"><h3>Users Without MFA (' + data.noMfaUsers.length + ')</h3>';
            html += '<div id="mfa-gaps-overview-table"></div></div>';
        }

        if (data.hasSecureScore && data.secureScore.controlScores && data.secureScore.controlScores.length > 0) {
            html += '<div class="analytics-section"><h3>Secure Score Improvements</h3>';
            html += '<p class="section-description">Top actions to improve security posture</p>';
            html += '<div id="secure-score-actions-table"></div></div>';
        }

        container.innerHTML = html;

        // Render tables
        if (highRiskSignins.length > 0) {
            Tables.render({
                containerId: 'risky-signins-overview-table',
                data: highRiskSignins.slice(0, 10),
                columns: [
                    { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
                    { key: 'riskLevel', label: 'Risk Level', formatter: Tables.formatters.severity },
                    { key: 'riskState', label: 'State', formatter: formatRiskState },
                    { key: 'location.countryOrRegion', label: 'Location' },
                    { key: 'detectedDateTime', label: 'Detected', formatter: Tables.formatters.date }
                ],
                pageSize: 10
            });
        }

        if (data.noMfaUsers.length > 0) {
            Tables.render({
                containerId: 'mfa-gaps-overview-table',
                data: data.noMfaUsers.slice(0, 10),
                columns: [
                    { key: 'displayName', label: 'Name' },
                    { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                    { key: 'department', label: 'Department' },
                    { key: 'lastSignIn', label: 'Last Sign-in', formatter: Tables.formatters.date }
                ],
                pageSize: 10
            });
        }

        if (data.hasSecureScore && data.secureScore.controlScores && data.secureScore.controlScores.length > 0) {
            var incompleteControls = data.secureScore.controlScores.filter(function(c) { return !c.isComplete; });
            Tables.render({
                containerId: 'secure-score-actions-table',
                data: incompleteControls.slice(0, 10),
                columns: [
                    { key: 'name', label: 'Control Name' },
                    { key: 'description', label: 'Description', className: 'cell-truncate' },
                    { key: 'scoreInPercentage', label: 'Progress', formatter: function(v) {
                        var cls = v >= 80 ? 'text-success' : (v >= 50 ? 'text-warning' : 'text-critical');
                        return '<span class="' + cls + '">' + v + '%</span>';
                    }},
                    { key: 'potentialPoints', label: 'Potential', formatter: function(v) {
                        return '<span class="text-success">+' + (v || 0) + '</span>';
                    }}
                ],
                pageSize: 10
            });
        }
    }

    function renderSecurityCharts(data) {
        var chartsRow = document.getElementById('security-charts');
        if (!chartsRow || typeof DashboardCharts === 'undefined') return;

        chartsRow.textContent = '';
        var C = DashboardCharts.colors;

        // Secure Score chart
        if (data.hasSecureScore) {
            var scoreColor = data.scorePct >= 70 ? C.green : (data.scorePct >= 40 ? C.yellow : C.red);
            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Secure Score',
                [
                    { value: data.scorePct, label: 'Achieved', color: scoreColor },
                    { value: 100 - data.scorePct, label: 'Remaining', color: C.gray }
                ],
                data.scorePct + '%', 'of ' + data.secureScore.maxScore + ' points'
            ));
        }

        // MFA Coverage chart
        var mfaRegistered = data.users.filter(u => u.mfaRegistered && u.accountEnabled).length;
        var enabledUsers = data.users.filter(u => u.accountEnabled).length;
        var mfaPct = enabledUsers > 0 ? Math.round((mfaRegistered / enabledUsers) * 100) : 0;

        chartsRow.appendChild(DashboardCharts.createChartCard(
            'MFA Coverage (Enabled Users)',
            [
                { value: mfaRegistered, label: 'Registered', color: C.green },
                { value: data.noMfaUsers.length, label: 'Not Registered', color: C.red }
            ],
            mfaPct + '%', 'coverage'
        ));

        // Alert severity distribution
        var highCount = data.defenderAlerts.filter(a => a.severity === 'high').length;
        var medCount = data.defenderAlerts.filter(a => a.severity === 'medium').length;
        var lowCount = data.defenderAlerts.filter(a => a.severity === 'low').length;
        var infoCount = data.defenderAlerts.filter(a => a.severity === 'informational').length;

        chartsRow.appendChild(DashboardCharts.createChartCard(
            'Alert Severity Distribution',
            [
                { value: highCount, label: 'High', color: C.red },
                { value: medCount, label: 'Medium', color: C.yellow },
                { value: lowCount, label: 'Low', color: C.blue },
                { value: infoCount, label: 'Info', color: C.gray }
            ],
            String(data.defenderAlerts.length), 'total alerts'
        ));
    }

    function renderRiskySignins(container, data) {
        container.innerHTML = '<div class="table-container" id="risky-signins-table"></div>';

        Tables.render({
            containerId: 'risky-signins-table',
            data: data.riskySignins,
            columns: [
                { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
                { key: 'riskLevel', label: 'Risk Level', formatter: Tables.formatters.severity },
                { key: 'riskState', label: 'State', formatter: formatRiskState },
                { key: 'riskDetail', label: 'Detail' },
                { key: 'detectedDateTime', label: 'Detected', formatter: Tables.formatters.datetime },
                { key: 'location.countryOrRegion', label: 'Location' },
                { key: 'ipAddress', label: 'IP Address' }
            ],
            pageSize: 10,
            onRowClick: showRiskySigninDetails
        });
    }

    function renderAdminRoles(container, data) {
        container.innerHTML = '<div class="table-container" id="admin-roles-table"></div>';

        Tables.render({
            containerId: 'admin-roles-table',
            data: data.adminRoles,
            columns: [
                { key: 'roleName', label: 'Role' },
                { key: 'isHighPrivilege', label: 'High Privilege', formatter: formatHighPrivilege },
                { key: 'memberCount', label: 'Members', className: 'cell-center' },
                { key: 'members', label: 'Member List', formatter: formatMemberList }
            ],
            pageSize: 20,
            onRowClick: showRoleDetails
        });
    }

    function renderMfaGaps(container, data) {
        container.innerHTML = '<div class="table-container" id="mfa-gaps-table"></div>';

        Tables.render({
            containerId: 'mfa-gaps-table',
            data: data.noMfaUsers,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'domain', label: 'Domain' },
                { key: 'department', label: 'Department' },
                { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
                { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags }
            ],
            pageSize: 10
        });
    }

    function renderDefenderAlerts(container, data) {
        container.innerHTML = '<div class="table-container" id="defender-alerts-table"></div>';

        Tables.render({
            containerId: 'defender-alerts-table',
            data: data.defenderAlerts,
            columns: [
                { key: 'title', label: 'Alert', className: 'cell-truncate' },
                { key: 'severity', label: 'Severity', formatter: Tables.formatters.severity },
                { key: 'status', label: 'Status', formatter: formatAlertStatus },
                { key: 'category', label: 'Category' },
                { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.datetime },
                { key: 'affectedUser', label: 'User', formatter: formatClickableUser },
                { key: 'affectedDevice', label: 'Device', formatter: formatClickableDevice }
            ],
            pageSize: 10,
            onRowClick: showAlertDetails
        });
    }

    /**
     * Formats affected user as a clickable link.
     */
    function formatClickableUser(value) {
        if (!value) return '<span class="text-muted">--</span>';
        var escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<a href="#users?search=' + encodeURIComponent(value) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + escaped + '</a>';
    }

    /**
     * Formats affected device as a clickable link.
     */
    function formatClickableDevice(value) {
        if (!value) return '<span class="text-muted">--</span>';
        var escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<a href="#devices?search=' + encodeURIComponent(value) + '" class="entity-link" onclick="event.stopPropagation();" title="View device details">' + escaped + '</a>';
    }

    /**
     * Renders the security page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        securityState = buildState();
        var data = securityState;

        var scoreValue = data.hasSecureScore ? data.scorePct + '%' : '--';
        var scoreCardClass = data.hasSecureScore ? data.scoreCardClass : '';
        var scoreValueClass = data.hasSecureScore ? data.scoreTextClass : '';

        var html = '<div class="page-header"><h2>Security Posture</h2><p class="page-description">Security status and risk indicators</p></div>';

        html += '<div class="summary-cards">';
        html += '<div class="summary-card ' + scoreCardClass + '"><div class="summary-value ' + scoreValueClass + '">' + scoreValue + '</div><div class="summary-label">Secure Score</div></div>';
        html += '<div class="summary-card' + (data.highRiskCount > 0 ? ' card-danger' : '') + '"><div class="summary-value ' + (data.highRiskCount > 0 ? 'text-critical' : 'text-success') + '">' + data.highRiskCount + '</div><div class="summary-label">High Risk Sign-ins</div></div>';
        html += '<div class="summary-card' + (data.noMfaUsers.length > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value ' + (data.noMfaUsers.length > 0 ? 'text-critical' : 'text-success') + '">' + data.noMfaUsers.length + '</div><div class="summary-label">Users Without MFA</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + data.adminCount + '</div><div class="summary-label">Admin Accounts</div></div>';
        html += '<div class="summary-card' + (data.highAlerts.length > 0 ? ' card-danger' : '') + '"><div class="summary-value ' + (data.highAlerts.length > 0 ? 'text-critical' : 'text-success') + '">' + data.highAlerts.length + '</div><div class="summary-label">Active High Alerts</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="risky-signins">Risky Sign-ins (' + data.riskySignins.length + ')</button>';
        html += '<button class="tab-btn" data-tab="admin-roles">Admin Roles (' + data.adminRoles.length + ')</button>';
        html += '<button class="tab-btn" data-tab="mfa-gaps">MFA Gaps (' + data.noMfaUsers.length + ')</button>';
        html += '<button class="tab-btn" data-tab="defender-alerts">Defender Alerts (' + data.defenderAlerts.length + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="security-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    /**
     * Formats risk state with badge.
     */
    function formatRiskState(value) {
        const classes = {
            'atRisk': 'badge-critical',
            'confirmedCompromised': 'badge-critical',
            'remediated': 'badge-success',
            'dismissed': 'badge-neutral',
            'confirmedSafe': 'badge-success'
        };
        return `<span class="badge ${classes[value] || 'badge-neutral'}">${value || 'unknown'}</span>`;
    }

    /**
     * Formats high privilege indicator.
     */
    function formatHighPrivilege(value) {
        return value
            ? '<span class="badge badge-critical">Yes</span>'
            : '<span class="badge badge-neutral">No</span>';
    }

    /**
     * Formats member list as truncated text.
     */
    function formatMemberList(value) {
        if (!value || !Array.isArray(value) || value.length === 0) {
            return '<span class="text-muted">No members</span>';
        }
        const names = value.map(m => m.displayName || m.userPrincipalName).slice(0, 3);
        const more = value.length > 3 ? ` +${value.length - 3} more` : '';
        return names.join(', ') + more;
    }

    /**
     * Formats alert status.
     */
    function formatAlertStatus(value) {
        const classes = {
            'new': 'badge-critical',
            'inProgress': 'badge-warning',
            'resolved': 'badge-success'
        };
        return `<span class="badge ${classes[value] || 'badge-neutral'}">${value || 'unknown'}</span>`;
    }

    /**
     * Shows risky sign-in details.
     */
    function showRiskySigninDetails(item) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = 'Risk Detection Details';

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">User:</span>
                <span class="detail-value">${item.userPrincipalName}</span>

                <span class="detail-label">Risk Level:</span>
                <span class="detail-value">${item.riskLevel}</span>

                <span class="detail-label">Risk State:</span>
                <span class="detail-value">${item.riskState}</span>

                <span class="detail-label">Risk Detail:</span>
                <span class="detail-value">${item.riskDetail}</span>

                <span class="detail-label">Detected:</span>
                <span class="detail-value">${DataLoader.formatDate(item.detectedDateTime)}</span>

                <span class="detail-label">Location:</span>
                <span class="detail-value">${item.location?.city || '--'}, ${item.location?.countryOrRegion || '--'}</span>

                <span class="detail-label">IP Address:</span>
                <span class="detail-value">${item.ipAddress || '--'}</span>

                <span class="detail-label">Application:</span>
                <span class="detail-value">${item.appDisplayName || '--'}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    /**
     * Shows role details with member list.
     */
    function showRoleDetails(role) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = role.roleName;

        const memberHtml = role.members.map(m => `
            <tr>
                <td>${m.displayName}</td>
                <td>${m.userPrincipalName}</td>
                <td>${m.accountEnabled ? 'Yes' : 'No'}</td>
                <td>${m.daysSinceLastSignIn !== null ? m.daysSinceLastSignIn : '--'}</td>
            </tr>
        `).join('');

        body.innerHTML = `
            <div class="detail-list mb-lg">
                <span class="detail-label">Role ID:</span>
                <span class="detail-value" style="font-size: 0.8em;">${role.roleId}</span>

                <span class="detail-label">High Privilege:</span>
                <span class="detail-value">${role.isHighPrivilege ? 'Yes' : 'No'}</span>

                <span class="detail-label">Member Count:</span>
                <span class="detail-value">${role.memberCount}</span>
            </div>

            <h4 class="mb-sm">Members</h4>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>UPN</th>
                        <th>Enabled</th>
                        <th>Days Inactive</th>
                    </tr>
                </thead>
                <tbody>
                    ${memberHtml || '<tr><td colspan="4" class="text-muted">No members</td></tr>'}
                </tbody>
            </table>
        `;

        modal.classList.add('visible');
    }

    /**
     * Shows alert details.
     */
    function showAlertDetails(alert) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = alert.title;

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">Severity:</span>
                <span class="detail-value">${alert.severity}</span>

                <span class="detail-label">Status:</span>
                <span class="detail-value">${alert.status}</span>

                <span class="detail-label">Category:</span>
                <span class="detail-value">${alert.category || '--'}</span>

                <span class="detail-label">Created:</span>
                <span class="detail-value">${DataLoader.formatDate(alert.createdDateTime)}</span>

                <span class="detail-label">Resolved:</span>
                <span class="detail-value">${DataLoader.formatDate(alert.resolvedDateTime)}</span>

                <span class="detail-label">Affected User:</span>
                <span class="detail-value">${alert.affectedUser || '--'}</span>

                <span class="detail-label">Affected Device:</span>
                <span class="detail-value">${alert.affectedDevice || '--'}</span>

                <span class="detail-label">Description:</span>
                <span class="detail-value">${alert.description || '--'}</span>

                <span class="detail-label">Recommended Actions:</span>
                <span class="detail-value">${alert.recommendedActions || '--'}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageSecurity = PageSecurity;
