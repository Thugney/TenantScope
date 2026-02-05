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

    /**
     * Renders the security page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        const riskySignins = DataLoader.getData('riskySignins');
        const adminRoles = DataLoader.getData('adminRoles');
        const users = DataLoader.getData('users');
        const defenderAlerts = DataLoader.getData('defenderAlerts');

        // Calculate stats
        const highRiskCount = riskySignins.filter(r => r.riskLevel === 'high').length;
        const mediumRiskCount = riskySignins.filter(r => r.riskLevel === 'medium').length;
        const noMfaUsers = users.filter(u => !u.mfaRegistered && u.accountEnabled);
        const activeAlerts = defenderAlerts.filter(a => a.status !== 'resolved');
        const highAlerts = defenderAlerts.filter(a => a.severity === 'high' && a.status !== 'resolved');

        // Total admins (unique)
        const adminUserIds = new Set();
        adminRoles.forEach(role => {
            role.members.forEach(m => adminUserIds.add(m.userId));
        });

        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">Security Posture</h2>
                <p class="page-description">Security status and risk indicators</p>
            </div>

            <!-- Summary Cards -->
            <div class="cards-grid">
                <div class="card ${highRiskCount > 0 ? 'card-critical' : ''}">
                    <div class="card-label">High Risk Sign-ins</div>
                    <div class="card-value ${highRiskCount > 0 ? 'critical' : 'success'}">${highRiskCount}</div>
                </div>
                <div class="card ${noMfaUsers.length > 0 ? 'card-critical' : 'card-success'}">
                    <div class="card-label">Users Without MFA</div>
                    <div class="card-value ${noMfaUsers.length > 0 ? 'critical' : 'success'}">${noMfaUsers.length}</div>
                </div>
                <div class="card">
                    <div class="card-label">Admin Accounts</div>
                    <div class="card-value">${adminUserIds.size}</div>
                </div>
                <div class="card ${highAlerts.length > 0 ? 'card-critical' : ''}">
                    <div class="card-label">Active High Alerts</div>
                    <div class="card-value ${highAlerts.length > 0 ? 'critical' : 'success'}">${highAlerts.length}</div>
                </div>
            </div>

            <!-- MFA Chart -->
            <div class="charts-row" id="security-charts"></div>

            <!-- Risky Sign-ins Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Risky Sign-ins</h3>
                        <p class="section-subtitle">Identity Protection risk detections</p>
                    </div>
                </div>
                <div id="risky-signins-table"></div>
            </div>

            <!-- Admin Roles Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Admin Roles</h3>
                        <p class="section-subtitle">Directory role assignments (high-privilege roles highlighted)</p>
                    </div>
                </div>
                <div id="admin-roles-table"></div>
            </div>

            <!-- MFA Gaps Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">MFA Gaps</h3>
                        <p class="section-subtitle">Enabled users without MFA registration</p>
                    </div>
                </div>
                <div id="mfa-gaps-table"></div>
            </div>

            <!-- Defender Alerts Section -->
            <div class="section">
                <div class="section-header">
                    <div>
                        <h3 class="section-title">Defender Alerts</h3>
                        <p class="section-subtitle">Security alerts from Microsoft Defender</p>
                    </div>
                </div>
                <div id="defender-alerts-table"></div>
            </div>
        `;

        // Render risky sign-ins table
        Tables.render({
            containerId: 'risky-signins-table',
            data: riskySignins,
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

        // Render admin roles table
        Tables.render({
            containerId: 'admin-roles-table',
            data: adminRoles,
            columns: [
                { key: 'roleName', label: 'Role' },
                { key: 'isHighPrivilege', label: 'High Privilege', formatter: formatHighPrivilege },
                { key: 'memberCount', label: 'Members', className: 'cell-center' },
                { key: 'members', label: 'Member List', formatter: formatMemberList }
            ],
            pageSize: 20,
            onRowClick: showRoleDetails
        });

        // Render MFA gaps table
        Tables.render({
            containerId: 'mfa-gaps-table',
            data: noMfaUsers,
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

        // Render MFA chart
        var chartsRow = document.getElementById('security-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;
            var mfaRegistered = users.filter(u => u.mfaRegistered && u.accountEnabled).length;
            var enabledUsers = users.filter(u => u.accountEnabled).length;
            var mfaPct = enabledUsers > 0 ? Math.round((mfaRegistered / enabledUsers) * 100) : 0;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'MFA Coverage (Enabled Users)',
                [
                    { value: mfaRegistered, label: 'Registered', color: C.green },
                    { value: noMfaUsers.length, label: 'Not Registered', color: C.red }
                ],
                mfaPct + '%', 'coverage'
            ));

            // Alert severity distribution
            var highCount = defenderAlerts.filter(a => a.severity === 'high').length;
            var medCount = defenderAlerts.filter(a => a.severity === 'medium').length;
            var lowCount = defenderAlerts.filter(a => a.severity === 'low').length;
            var infoCount = defenderAlerts.filter(a => a.severity === 'informational').length;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Alert Severity Distribution',
                [
                    { value: highCount, label: 'High', color: C.red },
                    { value: medCount, label: 'Medium', color: C.yellow },
                    { value: lowCount, label: 'Low', color: C.blue },
                    { value: infoCount, label: 'Info', color: C.gray }
                ],
                String(defenderAlerts.length), 'total alerts'
            ));
        }

        // Render Defender alerts table
        Tables.render({
            containerId: 'defender-alerts-table',
            data: defenderAlerts,
            columns: [
                { key: 'title', label: 'Alert', className: 'cell-truncate' },
                { key: 'severity', label: 'Severity', formatter: Tables.formatters.severity },
                { key: 'status', label: 'Status', formatter: formatAlertStatus },
                { key: 'category', label: 'Category' },
                { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.datetime },
                { key: 'affectedUser', label: 'User' },
                { key: 'affectedDevice', label: 'Device' }
            ],
            pageSize: 10,
            onRowClick: showAlertDetails
        });
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
