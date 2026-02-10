/**
 * ============================================================================
 * TenantScope - Identity Risk Page
 * ============================================================================
 * Displays Identity Protection risk data including risky users and detections.
 * Data sourced from trusted Graph API collectors - not user input.
 */

const PageIdentityRisk = (function() {
    'use strict';

    var SF = window.SharedFormatters || {};
    var currentTab = 'risky-users';
    var state = {
        summary: {},
        riskyUsers: [],
        detections: [],
        insights: []
    };

    function render(container) {
        const data = DataLoader.getData('identityRisk');

        if (!data || (!data.riskyUsers?.length && !data.riskDetections?.length)) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-title">No Identity Risk Data</div>
                    <div class="empty-state-description">
                        No risky users or risk detections found.<br>
                        This requires Entra ID P2 license and IdentityRiskEvent.Read.All permission.
                    </div>
                </div>
            `;
            return;
        }

        const riskyUsersRaw = Array.isArray(data.riskyUsers) ? data.riskyUsers : [];
        const detectionsRaw = Array.isArray(data.riskDetections) ? data.riskDetections : [];

        const summary = buildSummary(data, riskyUsersRaw, detectionsRaw);
        const detectionCounts = buildDetectionCountMap(detectionsRaw);

        state = {
            summary: summary,
            riskyUsers: riskyUsersRaw.map(user => {
                const key = user.userId || user.userPrincipalName || user.id;
                const count = detectionCounts[key] || 0;
                return Object.assign({}, user, { detectionCount: user.detectionCount || count });
            }),
            detections: detectionsRaw,
            insights: Array.isArray(data.insights) ? data.insights : []
        };

        let html = `
            <div class="page-header">
                <h2 class="page-title">Identity Risk</h2>
                <p class="page-description">Risky users and detections from Entra ID Identity Protection</p>
            </div>
        `;

        const totalRisky = summary.totalRiskyUsers || 0;
        const highRisk = summary.highRiskUsers || 0;
        const confirmed = summary.confirmedCompromised || 0;
        const recent24 = summary.recentDetections24h || 0;
        const totalDetections = summary.totalDetections || 0;

        const highCardClass = highRisk > 0 ? ' card-danger' : ' card-success';
        const compromisedClass = confirmed > 0 ? ' card-danger' : ' card-success';
        const recentClass = recent24 > 0 ? ' card-warning' : '';

        html += '<div class="summary-cards">';
        html += '<div class="summary-card card-info"><div class="summary-value">' + totalRisky + '</div><div class="summary-label">Risky Users</div></div>';
        html += '<div class="summary-card' + highCardClass + '"><div class="summary-value text-critical">' + highRisk + '</div><div class="summary-label">High Risk</div></div>';
        html += '<div class="summary-card' + compromisedClass + '"><div class="summary-value text-critical">' + confirmed + '</div><div class="summary-label">Confirmed Compromised</div></div>';
        html += '<div class="summary-card' + recentClass + '"><div class="summary-value">' + recent24 + '</div><div class="summary-label">Detections (24h)</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + totalDetections + '</div><div class="summary-label">Total Detections</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="risky-users">Risky Users (' + state.riskyUsers.length + ')</button>';
        html += '<button class="tab-btn" data-tab="detections">Detections (' + state.detections.length + ')</button>';
        html += '</div>';
        html += '<div class="content-area" id="identity-risk-content"></div>';

        container.innerHTML = html;

        const tabButtons = container.querySelectorAll('.tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab;
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderTabContent();
            });
        });

        currentTab = 'risky-users';
        renderTabContent();
    }

    function renderTabContent() {
        const container = document.getElementById('identity-risk-content');
        if (!container) return;

        if (currentTab === 'risky-users') {
            renderRiskyUsersTab(container);
        } else if (currentTab === 'detections') {
            renderDetectionsTab(container);
        }
    }

    function renderRiskyUsersTab(container) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="risk-search" placeholder="Search users...">';
        html += '<select class="filter-select" id="risk-level"><option value="all">All Risk Levels</option>';
        html += '<option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">None</option></select>';
        html += '<select class="filter-select" id="risk-state"><option value="all">All States</option>';
        html += '<option value="atRisk">At Risk</option><option value="confirmedCompromised">Confirmed Compromised</option>';
        html += '<option value="remediated">Remediated</option><option value="dismissed">Dismissed</option></select>';
        html += '</div>';
        html += '<div id="risky-users-table"></div>';
        container.innerHTML = html;

        Filters.setup('risk-search', applyRiskyUsersFilter);
        Filters.setup('risk-level', applyRiskyUsersFilter);
        Filters.setup('risk-state', applyRiskyUsersFilter);
        applyRiskyUsersFilter();
    }

    function applyRiskyUsersFilter() {
        var users = state.riskyUsers;
        var search = (Filters.getValue('risk-search') || '').toLowerCase();
        var level = Filters.getValue('risk-level');
        var riskState = Filters.getValue('risk-state');

        var filtered = users.filter(function(user) {
            if (search && (user.userDisplayName || '').toLowerCase().indexOf(search) === -1 &&
                (user.userPrincipalName || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            if (level && level !== 'all' && (user.riskLevel || '').toLowerCase() !== level) return false;
            if (riskState && riskState !== 'all' && (user.riskState || '').toLowerCase() !== riskState.toLowerCase()) return false;
            return true;
        });

        var tableContainer = document.getElementById('risky-users-table');
        if (tableContainer) tableContainer.innerHTML = renderRiskyUsersTable(filtered);
    }

    function renderDetectionsTab(container) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="detect-search" placeholder="Search detections...">';
        html += '<select class="filter-select" id="detect-severity"><option value="all">All Severities</option>';
        html += '<option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>';
        html += '</div>';
        html += '<div id="detections-table"></div>';
        container.innerHTML = html;

        Filters.setup('detect-search', applyDetectionsFilter);
        Filters.setup('detect-severity', applyDetectionsFilter);
        applyDetectionsFilter();
    }

    function applyDetectionsFilter() {
        var detections = state.detections;
        var search = (Filters.getValue('detect-search') || '').toLowerCase();
        var severity = Filters.getValue('detect-severity');

        var filtered = detections.filter(function(det) {
            if (search && (det.userDisplayName || '').toLowerCase().indexOf(search) === -1 &&
                (det.userPrincipalName || '').toLowerCase().indexOf(search) === -1 &&
                (det.riskEventType || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            var detSev = (det.severity || det.riskLevel || '').toLowerCase();
            if (severity && severity !== 'all' && detSev !== severity) return false;
            return true;
        });

        var tableContainer = document.getElementById('detections-table');
        if (tableContainer) tableContainer.innerHTML = renderDetectionsTable(filtered);
    }

    function renderRiskyUsersTable(users) {
        if (!users.length) {
            return '<div class="empty-state"><p>No risky users found</p></div>';
        }

        return `
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Risk Level</th>
                            <th>Risk State</th>
                            <th>Detections</th>
                            <th>Last Updated</th>
                            <th>Flags</th>
                            <th>Admin</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(user => `
                            <tr class="${user.riskLevel === 'high' ? 'row-critical' : user.riskLevel === 'medium' ? 'row-warning' : ''}">
                                <td>
                                    <div class="user-cell">
                                        <a href="#users?search=${encodeURIComponent(user.userPrincipalName || '')}" class="entity-link">
                                            <strong>${escapeHtml(user.userDisplayName || 'Unknown')}</strong>
                                        </a>
                                        <small>${escapeHtml(user.userPrincipalName || '')}</small>
                                    </div>
                                </td>
                                <td>${formatSeverityBadge(user.riskLevel)}</td>
                                <td>${formatRiskStateBadge(user.riskState)}</td>
                                <td>${user.detectionCount || 0}</td>
                                <td>${formatDate(user.riskLastUpdatedDateTime)}</td>
                                <td>${(user.flags || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join(' ')}</td>
                                <td>${user.id ? '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskyUsers" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>' : '--'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderDetectionsTable(detections) {
        if (!detections.length) {
            return '<div class="empty-state"><p>No risk detections found</p></div>';
        }

        const displayDetections = detections.slice(0, 100);

        return `
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Risk Type</th>
                            <th>Severity</th>
                            <th>IP Address</th>
                            <th>Location</th>
                            <th>Detected</th>
                            <th>Admin</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayDetections.map(det => {
                            const severity = det.severity || det.riskLevel || 'low';
                            const rowClass = severity === 'critical' || severity === 'high' ? 'row-warning' : '';
                            return `
                            <tr class="${rowClass}">
                                <td>
                                    <div class="user-cell">
                                        <a href="#users?search=${encodeURIComponent(det.userPrincipalName || '')}" class="entity-link">
                                            <strong>${escapeHtml(det.userDisplayName || 'Unknown')}</strong>
                                        </a>
                                        <small>${escapeHtml(det.userPrincipalName || '')}</small>
                                    </div>
                                </td>
                                <td><code>${escapeHtml(det.riskEventType || 'unknown')}</code></td>
                                <td>${formatSeverityBadge(severity)}</td>
                                <td><code>${escapeHtml(det.ipAddress || '--')}</code></td>
                                <td>${escapeHtml(det.location?.countryOrRegion || '--')}</td>
                                <td>${formatDate(det.detectedDateTime)}</td>
                                <td>${det.id ? '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskyUsers" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>' : '--'}</td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${detections.length > 100 ? `<p class="text-muted">Showing first 100 of ${detections.length} detections</p>` : ''}
        `;
    }

    function buildSummary(data, riskyUsers, detections) {
        var useSummary = !(window.TimeRangeFilter && TimeRangeFilter.isActive && TimeRangeFilter.isActive());
        const summary = useSummary ? (data.summary || {}) : {};
        const computed = computeSummary(riskyUsers, detections);

        return {
            totalRiskyUsers: valueOr(summary.totalRiskyUsers, computed.totalRiskyUsers),
            highRiskUsers: valueOr(summary.highRiskUsers, computed.highRiskUsers),
            mediumRiskUsers: valueOr(summary.mediumRiskUsers, computed.mediumRiskUsers),
            lowRiskUsers: valueOr(summary.lowRiskUsers, computed.lowRiskUsers),
            atRiskUsers: valueOr(summary.atRiskUsers, computed.atRiskUsers),
            confirmedCompromised: valueOr(summary.confirmedCompromised, computed.confirmedCompromised),
            dismissedUsers: valueOr(summary.dismissedUsers, computed.dismissedUsers),
            remediatedUsers: valueOr(summary.remediatedUsers, computed.remediatedUsers),
            totalDetections: valueOr(summary.totalDetections, computed.totalDetections),
            detectionsByType: (summary.detectionsByType && summary.detectionsByType.length) ? summary.detectionsByType : computed.detectionsByType,
            detectionsByLocation: (summary.detectionsByLocation && summary.detectionsByLocation.length) ? summary.detectionsByLocation : computed.detectionsByLocation,
            recentDetections24h: valueOr(summary.recentDetections24h, computed.recentDetections24h),
            recentDetections7d: valueOr(summary.recentDetections7d, computed.recentDetections7d)
        };
    }

    function computeSummary(riskyUsers, detections) {
        let high = 0;
        let medium = 0;
        let low = 0;
        let atRisk = 0;
        let confirmed = 0;
        let dismissed = 0;
        let remediated = 0;

        riskyUsers.forEach(user => {
            const level = (user.riskLevel || '').toLowerCase();
            if (level === 'high') high++;
            else if (level === 'medium') medium++;
            else if (level === 'low') low++;

            const state = (user.riskState || '').toLowerCase();
            if (state === 'atrisk') atRisk++;
            else if (state === 'confirmedcompromised') confirmed++;
            else if (state === 'dismissed') dismissed++;
            else if (state === 'remediated') remediated++;
        });

        const detectionsByType = buildDetectionsByType(detections);
        const detectionsByLocation = buildDetectionsByLocation(detections);
        const recentCounts = buildRecentDetectionCounts(detections);

        return {
            totalRiskyUsers: riskyUsers.length,
            highRiskUsers: high,
            mediumRiskUsers: medium,
            lowRiskUsers: low,
            atRiskUsers: atRisk,
            confirmedCompromised: confirmed,
            dismissedUsers: dismissed,
            remediatedUsers: remediated,
            totalDetections: detections.length,
            detectionsByType: detectionsByType,
            detectionsByLocation: detectionsByLocation,
            recentDetections24h: recentCounts.last24h,
            recentDetections7d: recentCounts.last7d
        };
    }

    function buildDetectionCountMap(detections) {
        const map = {};
        detections.forEach(det => {
            const key = det.userId || det.userPrincipalName || det.id;
            if (!key) return;
            map[key] = (map[key] || 0) + 1;
        });
        return map;
    }

    function buildDetectionsByType(detections) {
        const map = {};
        detections.forEach(det => {
            const type = det.riskEventType || 'unknown';
            const severity = det.severity || det.riskLevel || 'low';
            if (!map[type]) {
                map[type] = { type: type, count: 0, severity: severity };
            }
            map[type].count++;
            if (severityRank(severity) > severityRank(map[type].severity)) {
                map[type].severity = severity;
            }
        });
        return Object.values(map).sort((a, b) => (b.count || 0) - (a.count || 0));
    }

    function buildDetectionsByLocation(detections) {
        const map = {};
        detections.forEach(det => {
            const country = det.location?.countryOrRegion || 'Unknown';
            map[country] = (map[country] || 0) + 1;
        });
        return Object.keys(map).map(key => ({ country: key, count: map[key] }))
            .sort((a, b) => (b.count || 0) - (a.count || 0));
    }

    function buildRecentDetectionCounts(detections) {
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        let last24h = 0;
        let last7d = 0;

        detections.forEach(det => {
            const ts = Date.parse(det.detectedDateTime || det.lastUpdatedDateTime || '');
            if (!ts) return;
            if (ts >= now - dayMs) last24h++;
            if (ts >= now - (7 * dayMs)) last7d++;
        });

        return { last24h: last24h, last7d: last7d };
    }

    function buildDonutChart(segments, total, label) {
        const radius = 40;
        const circumference = 2 * Math.PI * radius;
        let offset = 0;

        let html = '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';

        segments.forEach(seg => {
            if (!seg.value || seg.value <= 0) return;
            const dash = (seg.value / total) * circumference;
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="' + seg.color + '" stroke-width="10" stroke-dasharray="' + dash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round" transform="rotate(-90 50 50)"/>';
            offset += dash;
        });

        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value">' + total + '</span><span class="donut-label">' + escapeHtml(label || '') + '</span></div>';
        html += '</div>';
        return html;
    }

    function severityRank(value) {
        const map = { critical: 4, high: 3, medium: 2, low: 1 };
        return map[value] || 0;
    }

    function valueOr(value, fallback) {
        return (value === null || value === undefined) ? fallback : value;
    }

    function formatSeverityBadge(value) {
        const sev = (value || '').toLowerCase();
        return SF.formatSeverity ? SF.formatSeverity(sev) : '<span class="badge badge-neutral">' + escapeHtml(sev || 'Unknown') + '</span>';
    }

    function formatRiskStateBadge(state) {
        const value = (state || '').toLowerCase();
        const cls = value === 'confirmedcompromised' ? 'badge-critical' :
            value === 'atrisk' ? 'badge-warning' :
            value === 'remediated' ? 'badge-success' :
            value === 'dismissed' ? 'badge-neutral' : 'badge-neutral';
        return '<span class="badge ' + cls + '">' + escapeHtml(state || 'Unknown') + '</span>';
    }

    function insightClass(severity) {
        if (severity === 'critical') return 'insight-critical';
        if (severity === 'high') return 'insight-high';
        if (severity === 'warning') return 'insight-warning';
        if (severity === 'info') return 'insight-info';
        return 'insight-info';
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        try {
            return new Date(dateStr).toLocaleDateString('en-GB', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch { return '--'; }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    return { render };
})();

window.PageIdentityRisk = PageIdentityRisk;
