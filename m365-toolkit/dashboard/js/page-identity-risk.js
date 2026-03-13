/**
 * TenantScope - Identity Risk Page
 *
 * Identity investigation page that prioritizes risky users and detections with
 * direct pivots into user context instead of a flat table-only view.
 */

const PageIdentityRisk = (function() {
    'use strict';

    var AU = window.ActionUtils || {};
    var state = {
        summary: {},
        riskyUsers: [],
        detections: [],
        insights: []
    };

    function escapeHtml(value) {
        return Tables.escapeHtml(value === null || value === undefined ? '' : String(value));
    }

    function normalizeText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function formatDateTime(value) {
        return Tables.formatters.datetime(value);
    }

    function getUserHref(target) {
        if (AU.getUserProfileHash) return AU.getUserProfileHash(target);
        var value = typeof target === 'string'
            ? target
            : target && (target.userPrincipalName || target.mail || target.displayName || '');
        return value ? '#users?search=' + encodeURIComponent(value) : '#users';
    }

    function formatSeverityBadge(value) {
        var sev = normalizeText(value).toLowerCase();
        var map = {
            high: 'badge-critical',
            medium: 'badge-warning',
            low: 'badge-info',
            none: 'badge-success'
        };
        return '<span class="badge ' + (map[sev] || 'badge-neutral') + '">' + escapeHtml(sev || 'none') + '</span>';
    }

    function formatRiskStateBadge(value) {
        var stateValue = normalizeText(value).toLowerCase();
        var map = {
            confirmedcompromised: 'badge-critical',
            atrisk: 'badge-warning',
            remediated: 'badge-success',
            dismissed: 'badge-neutral'
        };
        return '<span class="badge ' + (map[stateValue] || 'badge-neutral') + '">' + escapeHtml(value || 'unknown') + '</span>';
    }

    function getSignInLogs() {
        var raw = DataLoader.getData('signinLogs');
        var list = Array.isArray(raw) ? raw : ((raw && raw.signIns) || []);
        return list.slice().sort(function(a, b) {
            return new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime();
        });
    }

    function getLatestSignIn(upn, userId) {
        var logs = getSignInLogs();
        var upnLower = normalizeText(upn).toLowerCase();
        for (var i = 0; i < logs.length; i++) {
            var item = logs[i];
            if ((userId && item.userId === userId) || (upnLower && normalizeText(item.userPrincipalName).toLowerCase() === upnLower)) {
                return item;
            }
        }
        return null;
    }

    function getRecentDetectionsForUser(userId, upn, excludeId) {
        return state.detections.filter(function(item) {
            var sameUser = (userId && item.userId === userId) || (upn && normalizeText(item.userPrincipalName).toLowerCase() === normalizeText(upn).toLowerCase());
            return sameUser && item.id !== excludeId;
        }).slice(0, 6);
    }

    function buildSummary(riskyUsers, detections) {
        var summary = {
            totalRiskyUsers: riskyUsers.length,
            highRiskUsers: 0,
            mediumRiskUsers: 0,
            lowRiskUsers: 0,
            confirmedCompromised: 0,
            adminAccountsAtRisk: 0,
            recentDetections24h: 0,
            recentDetections7d: 0,
            totalDetections: detections.length
        };

        var now = Date.now();
        riskyUsers.forEach(function(user) {
            var level = normalizeText(user.riskLevel).toLowerCase();
            var flags = Array.isArray(user.flags) ? user.flags : [];
            if (level === 'high') summary.highRiskUsers++;
            else if (level === 'medium') summary.mediumRiskUsers++;
            else if (level === 'low') summary.lowRiskUsers++;
            if (normalizeText(user.riskState).toLowerCase() === 'confirmedcompromised') summary.confirmedCompromised++;
            if (flags.indexOf('admin-account') >= 0) summary.adminAccountsAtRisk++;
        });

        detections.forEach(function(item) {
            var detected = new Date(item.detectedDateTime).getTime();
            if (!isNaN(detected)) {
                var hours = Math.round((now - detected) / 3600000);
                if (hours <= 24) summary.recentDetections24h++;
                if (hours <= 24 * 7) summary.recentDetections7d++;
            }
        });

        return summary;
    }

    function computeInsights(summary, riskyUsers, detections, sourceInsights) {
        var insights = [];
        if (Array.isArray(sourceInsights)) {
            insights = sourceInsights.slice(0);
        }
        if (summary.confirmedCompromised > 0) {
            insights.unshift({
                severity: 'critical',
                title: 'Confirmed compromised accounts',
                description: summary.confirmedCompromised + ' user accounts are marked confirmed compromised.',
                recommendedAction: 'Review user timeline, recent sign-ins, sessions, and containment status immediately.'
            });
        }
        if (summary.adminAccountsAtRisk > 0) {
            insights.unshift({
                severity: 'high',
                title: 'Privileged accounts at risk',
                description: summary.adminAccountsAtRisk + ' risky users carry admin-account flags.',
                recommendedAction: 'Review privileged session exposure and force revalidation of access.'
            });
        }
        if (!insights.length && detections.length > 0) {
            insights.push({
                severity: 'info',
                title: 'Identity risk data present',
                description: 'Risk detections exist, but no collector-provided insights were included.',
                recommendedAction: 'Use the priority queues below to triage high-risk and recent activity.'
            });
        }
        return insights.slice(0, 6);
    }

    function enrichRiskyUsers(rawUsers, detections) {
        var detectionCounts = {};
        detections.forEach(function(item) {
            var key = item.userId || item.userPrincipalName || item.id;
            detectionCounts[key] = (detectionCounts[key] || 0) + 1;
        });

        return rawUsers.map(function(user) {
            var key = user.userId || user.userPrincipalName || user.id;
            var latestSignIn = getLatestSignIn(user.userPrincipalName, user.userId);
            return Object.assign({}, user, {
                detectionCount: user.detectionCount || detectionCounts[key] || 0,
                latestSignIn: latestSignIn
            });
        }).sort(function(a, b) {
            var rank = { high: 3, medium: 2, low: 1, none: 0 };
            var riskDiff = (rank[normalizeText(b.riskLevel).toLowerCase()] || 0) - (rank[normalizeText(a.riskLevel).toLowerCase()] || 0);
            if (riskDiff !== 0) return riskDiff;
            return new Date(b.riskLastUpdatedDateTime).getTime() - new Date(a.riskLastUpdatedDateTime).getTime();
        });
    }

    function enrichDetections(rawDetections) {
        return rawDetections.map(function(item) {
            return Object.assign({}, item, {
                latestSignIn: getLatestSignIn(item.userPrincipalName, item.userId)
            });
        }).sort(function(a, b) {
            return new Date(b.detectedDateTime).getTime() - new Date(a.detectedDateTime).getTime();
        });
    }

    function formatUserCell(value, row) {
        var primary = row.userDisplayName || row.userPrincipalName || 'Unknown';
        var secondary = row.userPrincipalName && row.userDisplayName !== row.userPrincipalName
            ? '<br><small>' + escapeHtml(row.userPrincipalName) + '</small>'
            : '';
        var linkValue = row.userPrincipalName || row.userId;
        if (!linkValue) return '<strong>' + escapeHtml(primary) + '</strong>' + secondary;
        return '<a href="' + getUserHref(linkValue) + '" class="entity-link" onclick="event.stopPropagation();"><strong>' + escapeHtml(primary) + '</strong>' + secondary + '</a>';
    }

    function formatLatestSignIn(value, row) {
        if (!row.latestSignIn) return '<span class="text-muted">--</span>';
        var signIn = row.latestSignIn;
        var bits = [];
        bits.push('<strong>' + escapeHtml(signIn.appDisplayName || '(unknown)') + '</strong>');
        bits.push('<small>' + Tables.formatters.datetime(signIn.createdDateTime) + '</small>');
        if (signIn.ipAddress) bits.push('<small>' + escapeHtml(signIn.ipAddress) + '</small>');
        return bits.join('<br>');
    }

    function formatFlags(value) {
        var list = Array.isArray(value) ? value : [];
        if (!list.length) return '<span class="text-muted">--</span>';
        return list.map(function(flag) {
            return '<span class="tag">' + escapeHtml(flag) + '</span>';
        }).join(' ');
    }

    function formatLocation(value, row) {
        if (!row.location) return '--';
        return escapeHtml([row.location.city, row.location.countryOrRegion].filter(Boolean).join(', ') || row.location.countryOrRegion || '--');
    }

    function formatActionCell(value, row) {
        var actions = [];
        if (row.userPrincipalName || row.userId) {
            actions.push('<a href="' + getUserHref(row.userPrincipalName || row.userId) + '" class="admin-link" onclick="event.stopPropagation();" title="Open user profile">User 360</a>');
        }
        actions.push('<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskyUsers" target="_blank" rel="noopener" class="admin-link" onclick="event.stopPropagation();" title="Open in Entra">Entra</a>');
        return actions.join(' ');
    }

    function renderSummaryCards() {
        var element = document.getElementById('identity-risk-summary');
        if (!element) return;
        var summary = state.summary;
        element.innerHTML =
            '<div class="summary-card"><div class="summary-value">' + summary.totalRiskyUsers + '</div><div class="summary-label">Risky Users</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + summary.highRiskUsers + '</div><div class="summary-label">High Risk</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + summary.confirmedCompromised + '</div><div class="summary-label">Confirmed Compromised</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + summary.adminAccountsAtRisk + '</div><div class="summary-label">Admin Accounts At Risk</div></div>' +
            '<div class="summary-card card-warning"><div class="summary-value">' + summary.recentDetections24h + '</div><div class="summary-label">Detections (24h)</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + summary.totalDetections + '</div><div class="summary-label">Total Detections</div></div>';
    }

    function renderInsights() {
        var container = document.getElementById('identity-risk-insights');
        if (!container) return;
        if (!state.insights.length) {
            container.innerHTML = '<p class="text-muted">No insights available.</p>';
            return;
        }

        var html = '<div class="insights-list">';
        state.insights.forEach(function(insight) {
            var severity = normalizeText(insight.severity).toLowerCase();
            var cls = severity === 'critical' ? 'insight-critical' :
                severity === 'high' ? 'insight-high' :
                severity === 'warning' ? 'insight-warning' :
                'insight-info';
            html += '<div class="insight-card ' + cls + '">';
            html += '<div class="insight-header"><strong>' + escapeHtml(insight.title || 'Insight') + '</strong></div>';
            html += '<p class="insight-description">' + escapeHtml(insight.description || '') + '</p>';
            if (insight.recommendedAction) {
                html += '<p class="insight-action"><strong>Action:</strong> ' + escapeHtml(insight.recommendedAction) + '</p>';
            }
            html += '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function buildQueueCard(title, count, filterTarget, subtitle) {
        return (
            '<div class="signal-card signal-card--info">' +
                '<div class="signal-card-value">' + count + '</div>' +
                '<div class="signal-card-label">' + escapeHtml(title) + '</div>' +
                '<div class="signal-card-meta">' + escapeHtml(subtitle) + '</div>' +
                '<div class="signal-card-actions"><button class="btn btn-secondary btn-sm" data-risk-filter="' + filterTarget + '">View</button></div>' +
            '</div>'
        );
    }

    function renderQueues() {
        var container = document.getElementById('identity-risk-queues');
        if (!container) return;
        var confirmed = state.riskyUsers.filter(function(item) {
            return normalizeText(item.riskState).toLowerCase() === 'confirmedcompromised';
        }).length;
        var adminAtRisk = state.riskyUsers.filter(function(item) {
            return Array.isArray(item.flags) && item.flags.indexOf('admin-account') >= 0;
        }).length;
        var high = state.riskyUsers.filter(function(item) {
            return normalizeText(item.riskLevel).toLowerCase() === 'high';
        }).length;
        var recent = state.detections.filter(function(item) {
            var detected = new Date(item.detectedDateTime).getTime();
            return !isNaN(detected) && (Date.now() - detected) <= 24 * 3600000;
        }).length;

        container.innerHTML =
            buildQueueCard('Confirmed Compromised', confirmed, 'confirmed', 'accounts needing immediate containment') +
            buildQueueCard('High Risk Users', high, 'high', 'identity protection risk is high') +
            buildQueueCard('Privileged Users At Risk', adminAtRisk, 'admin', 'admin-account exposure') +
            buildQueueCard('Recent Detections', recent, 'recent', 'detections within the last 24 hours');
    }

    function wireQueueButtons() {
        var buttons = document.querySelectorAll('[data-risk-filter]');
        Array.prototype.forEach.call(buttons, function(button) {
            button.addEventListener('click', function() {
                var target = button.getAttribute('data-risk-filter');
                if (target === 'confirmed') {
                    setUserFilter('risk-user-state', 'confirmedCompromised');
                } else if (target === 'high') {
                    setUserFilter('risk-user-level', 'high');
                } else if (target === 'admin') {
                    setUserFilter('risk-user-search', 'admin');
                } else if (target === 'recent') {
                    setDetectionFilter('risk-detection-search', '');
                    setDetectionFilter('risk-detection-severity', 'all');
                    setDetectionFilter('risk-detection-type', 'all');
                    setDetectionFilter('risk-detection-window', '24h');
                }
                applyUserFilters();
                applyDetectionFilters();
            });
        });
    }

    function setUserFilter(id, value) {
        var element = document.getElementById(id);
        if (element) element.value = value;
    }

    function setDetectionFilter(id, value) {
        var element = document.getElementById(id);
        if (element) element.value = value;
    }

    function renderUserTable(data) {
        Tables.render({
            containerId: 'identity-risk-users-table',
            data: data,
            columns: [
                { key: 'userPrincipalName', label: 'User', formatter: formatUserCell },
                { key: 'riskLevel', label: 'Risk Level', formatter: formatSeverityBadge },
                { key: 'riskState', label: 'Risk State', formatter: formatRiskStateBadge },
                { key: 'detectionCount', label: 'Detections' },
                { key: 'riskLastUpdatedDateTime', label: 'Last Updated', formatter: Tables.formatters.datetime },
                { key: 'latestSignIn', label: 'Latest Sign-In', formatter: formatLatestSignIn },
                { key: 'flags', label: 'Flags', formatter: formatFlags },
                { key: '_actions', label: 'Take Action', formatter: formatActionCell }
            ],
            pageSize: 50,
            onRowClick: showUserRiskDetails
        });
    }

    function renderDetectionTable(data) {
        Tables.render({
            containerId: 'identity-risk-detections-table',
            data: data,
            columns: [
                { key: 'detectedDateTime', label: 'Detected', formatter: Tables.formatters.datetime },
                { key: 'userPrincipalName', label: 'User', formatter: formatUserCell },
                { key: 'riskEventType', label: 'Risk Type', formatter: function(v) { return '<code>' + escapeHtml(v || 'unknown') + '</code>'; } },
                { key: 'riskLevel', label: 'Severity', formatter: formatSeverityBadge },
                { key: 'ipAddress', label: 'IP Address', formatter: function(v) { return v ? '<code>' + escapeHtml(v) + '</code>' : '--'; } },
                { key: 'location', label: 'Location', formatter: formatLocation },
                { key: 'latestSignIn', label: 'Latest Sign-In', formatter: formatLatestSignIn },
                { key: 'flags', label: 'Flags', formatter: formatFlags },
                { key: '_actions', label: 'Take Action', formatter: formatActionCell }
            ],
            pageSize: 100,
            onRowClick: showDetectionDetails
        });
    }

    function applyUserFilters() {
        var search = normalizeText(Filters.getValue('risk-user-search')).toLowerCase();
        var level = Filters.getValue('risk-user-level');
        var riskState = Filters.getValue('risk-user-state');

        var filtered = state.riskyUsers.filter(function(user) {
            if (search) {
                var haystack = [
                    user.userDisplayName,
                    user.userPrincipalName,
                    (user.flags || []).join(' '),
                    user.riskDetail
                ].join(' ').toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            if (level && level !== 'all' && normalizeText(user.riskLevel).toLowerCase() !== level) return false;
            if (riskState && riskState !== 'all' && normalizeText(user.riskState).toLowerCase() !== riskState.toLowerCase()) return false;
            return true;
        });

        renderUserTable(filtered);
    }

    function applyDetectionFilters() {
        var search = normalizeText(Filters.getValue('risk-detection-search')).toLowerCase();
        var severity = Filters.getValue('risk-detection-severity');
        var type = Filters.getValue('risk-detection-type');
        var windowValue = Filters.getValue('risk-detection-window');

        var filtered = state.detections.filter(function(item) {
            if (search) {
                var haystack = [
                    item.userDisplayName,
                    item.userPrincipalName,
                    item.riskEventType,
                    item.ipAddress,
                    item.additionalInfo,
                    (item.flags || []).join(' ')
                ].join(' ').toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            if (severity && severity !== 'all' && normalizeText(item.riskLevel).toLowerCase() !== severity) return false;
            if (type && type !== 'all' && normalizeText(item.riskEventType).toLowerCase() !== type.toLowerCase()) return false;
            if (windowValue && windowValue !== 'all') {
                var hours = windowValue === '24h' ? 24 : 24 * 7;
                var detected = new Date(item.detectedDateTime).getTime();
                if (isNaN(detected) || (Date.now() - detected) > hours * 3600000) return false;
            }
            return true;
        });

        renderDetectionTable(filtered);
    }

    function detailItem(label, value) {
        return '<div class="detail-item"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + value + '</span></div>';
    }

    function renderRelatedDetections(items) {
        if (!items.length) return '<p class="text-muted">No other detections for this user.</p>';
        var html = '<table class="data-table"><thead><tr><th>Detected</th><th>Risk Type</th><th>Severity</th><th>IP</th></tr></thead><tbody>';
        items.forEach(function(item) {
            html += '<tr>';
            html += '<td>' + formatDateTime(item.detectedDateTime) + '</td>';
            html += '<td><code>' + escapeHtml(item.riskEventType || 'unknown') + '</code></td>';
            html += '<td>' + formatSeverityBadge(item.riskLevel) + '</td>';
            html += '<td>' + (item.ipAddress ? '<code>' + escapeHtml(item.ipAddress) + '</code>' : '--') + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function showUserRiskDetails(user) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        var relatedDetections = getRecentDetectionsForUser(user.userId, user.userPrincipalName);
        var latestSignIn = user.latestSignIn;
        var userHref = getUserHref(user.userPrincipalName || user.userId);

        title.textContent = user.userDisplayName || user.userPrincipalName || 'Risky User';
        body.innerHTML =
            '<div class="detail-grid">' +
                detailItem('User', '<a href="' + userHref + '" class="entity-link">' + escapeHtml(user.userDisplayName || user.userPrincipalName || 'Unknown') + '</a>') +
                detailItem('UPN', escapeHtml(user.userPrincipalName || '--')) +
                detailItem('Risk Level', formatSeverityBadge(user.riskLevel)) +
                detailItem('Risk State', formatRiskStateBadge(user.riskState)) +
                detailItem('Risk Detail', escapeHtml(user.riskDetail || '--')) +
                detailItem('Detections', String(user.detectionCount || 0)) +
                detailItem('Last Updated', formatDateTime(user.riskLastUpdatedDateTime)) +
                detailItem('Latest Sign-In', latestSignIn ? '<strong>' + escapeHtml(latestSignIn.appDisplayName || '(unknown)') + '</strong><br><small>' + formatDateTime(latestSignIn.createdDateTime) + '</small>' : '<span class="text-muted">--</span>') +
                detailItem('Flags', formatFlags(user.flags)) +
            '</div>' +
            '<div class="detail-section"><h4>Take Action</h4><div class="action-row">' +
                '<a href="' + userHref + '" class="btn btn-primary btn-sm">Open User 360</a>' +
                '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskyUsers" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open in Entra</a>' +
            '</div></div>' +
            '<div class="detail-section"><h4>Other Detections For This User</h4>' + renderRelatedDetections(relatedDetections) + '</div>';

        modal.classList.add('visible');
    }

    function showDetectionDetails(item) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        var userHref = getUserHref(item.userPrincipalName || item.userId);
        var relatedDetections = getRecentDetectionsForUser(item.userId, item.userPrincipalName, item.id);
        var latestSignIn = item.latestSignIn;

        title.textContent = item.riskEventType || 'Risk Detection';
        body.innerHTML =
            '<div class="detail-grid">' +
                detailItem('User', '<a href="' + userHref + '" class="entity-link">' + escapeHtml(item.userDisplayName || item.userPrincipalName || 'Unknown') + '</a>') +
                detailItem('UPN', escapeHtml(item.userPrincipalName || '--')) +
                detailItem('Risk Type', '<code>' + escapeHtml(item.riskEventType || 'unknown') + '</code>') +
                detailItem('Risk Level', formatSeverityBadge(item.riskLevel)) +
                detailItem('Risk State', formatRiskStateBadge(item.riskState)) +
                detailItem('Detected', formatDateTime(item.detectedDateTime)) +
                detailItem('Last Updated', formatDateTime(item.lastUpdatedDateTime)) +
                detailItem('IP Address', item.ipAddress ? '<code>' + escapeHtml(item.ipAddress) + '</code>' : '--') +
                detailItem('Location', formatLocation('', item)) +
                detailItem('Additional Info', escapeHtml(item.additionalInfo || '--')) +
                detailItem('Latest Sign-In', latestSignIn ? '<strong>' + escapeHtml(latestSignIn.appDisplayName || '(unknown)') + '</strong><br><small>' + formatDateTime(latestSignIn.createdDateTime) + '</small>' : '<span class="text-muted">--</span>') +
                detailItem('Flags', formatFlags(item.flags)) +
            '</div>' +
            '<div class="detail-section"><h4>Take Action</h4><div class="action-row">' +
                '<a href="' + userHref + '" class="btn btn-primary btn-sm">Open User 360</a>' +
                '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/~/RiskyUsers" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open in Entra</a>' +
            '</div></div>' +
            '<div class="detail-section"><h4>Other Detections For This User</h4>' + renderRelatedDetections(relatedDetections) + '</div>';

        modal.classList.add('visible');
    }

    function render(container) {
        var data = DataLoader.getData('identityRisk');
        if (!data || (!Array.isArray(data.riskyUsers) || !data.riskyUsers.length) && (!Array.isArray(data.riskDetections) || !data.riskDetections.length)) {
            container.innerHTML =
                '<div class="empty-state">' +
                    '<div class="empty-state-title">No Identity Risk Data</div>' +
                    '<div class="empty-state-description">No risky users or risk detections were found. This requires Entra ID P2 and IdentityRiskEvent.Read.All.</div>' +
                '</div>';
            return;
        }

        var riskyUsers = Array.isArray(data.riskyUsers) ? data.riskyUsers : [];
        var detections = Array.isArray(data.riskDetections) ? data.riskDetections : [];

        state.riskyUsers = enrichRiskyUsers(riskyUsers, detections);
        state.detections = enrichDetections(detections);
        state.summary = buildSummary(state.riskyUsers, state.detections);
        state.insights = computeInsights(state.summary, state.riskyUsers, state.detections, data.insights);

        container.innerHTML =
            '<div class="page-header">' +
                '<h2 class="page-title">Identity Risk</h2>' +
                '<p class="page-description">Risky users and detections with direct pivots into user context and recent sign-in evidence.</p>' +
            '</div>' +
            '<div class="summary-cards" id="identity-risk-summary"></div>' +
            '<div class="analytics-section"><h3>Priority Queues</h3><div class="signal-cards" id="identity-risk-queues"></div></div>' +
            '<div class="analytics-section"><h3>Identity Risk Insights</h3><div id="identity-risk-insights"></div></div>' +
            '<div class="analytics-section">' +
                '<h3>Risky Users</h3>' +
                '<div id="identity-risk-users-filters"></div>' +
                '<div id="identity-risk-users-table"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Risk Detections</h3>' +
                '<div id="identity-risk-detections-filters"></div>' +
                '<div id="identity-risk-detections-table"></div>' +
            '</div>';

        renderSummaryCards();
        renderQueues();
        renderInsights();

        Filters.createFilterBar({
            containerId: 'identity-risk-users-filters',
            controls: [
                { type: 'search', id: 'risk-user-search', placeholder: 'Search users, flags, details...' },
                {
                    type: 'select',
                    id: 'risk-user-level',
                    label: 'Risk Level',
                    options: [
                        { value: 'all', label: 'All Levels' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' }
                    ]
                },
                {
                    type: 'select',
                    id: 'risk-user-state',
                    label: 'Risk State',
                    options: [
                        { value: 'all', label: 'All States' },
                        { value: 'atRisk', label: 'At Risk' },
                        { value: 'confirmedCompromised', label: 'Confirmed Compromised' },
                        { value: 'remediated', label: 'Remediated' },
                        { value: 'dismissed', label: 'Dismissed' }
                    ]
                }
            ],
            onFilter: applyUserFilters
        });

        var detectionTypes = [{ value: 'all', label: 'All Types' }];
        state.detections.forEach(function(item) {
            var value = normalizeText(item.riskEventType);
            if (!value) return;
            if (!detectionTypes.some(function(opt) { return opt.value === value; })) {
                detectionTypes.push({ value: value, label: value });
            }
        });

        Filters.createFilterBar({
            containerId: 'identity-risk-detections-filters',
            controls: [
                { type: 'search', id: 'risk-detection-search', placeholder: 'Search detections, users, IPs...' },
                {
                    type: 'select',
                    id: 'risk-detection-severity',
                    label: 'Severity',
                    options: [
                        { value: 'all', label: 'All Severities' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' }
                    ]
                },
                {
                    type: 'select',
                    id: 'risk-detection-type',
                    label: 'Detection Type',
                    options: detectionTypes
                },
                {
                    type: 'select',
                    id: 'risk-detection-window',
                    label: 'Time Window',
                    options: [
                        { value: 'all', label: 'All Time' },
                        { value: '24h', label: 'Last 24 Hours' },
                        { value: '7d', label: 'Last 7 Days' }
                    ]
                }
            ],
            onFilter: applyDetectionFilters
        });

        wireQueueButtons();
        applyUserFilters();
        applyDetectionFilters();
    }

    return {
        render: render
    };
})();

window.PageIdentityRisk = PageIdentityRisk;
