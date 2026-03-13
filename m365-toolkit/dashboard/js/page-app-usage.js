/**
 * TenantScope - Application Usage Page
 *
 * App investigation surface that merges sign-in volume, consent exposure, and
 * credential health for each application.
 */

const PageAppUsage = (function() {
    'use strict';

    var AU = window.ActionUtils || {};
    var state = {
        apps: [],
        filtered: []
    };
    var colSelector = null;

    function escapeHtml(value) {
        return Tables.escapeHtml(value === null || value === undefined ? '' : String(value));
    }

    function normalizeText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function getUserHref(target) {
        if (AU.getUserProfileHash) return AU.getUserProfileHash(target);
        var value = typeof target === 'string'
            ? target
            : target && (target.userPrincipalName || target.mail || target.displayName || '');
        return value ? '#users?search=' + encodeURIComponent(value) : '#users';
    }

    function getAppHref(target) {
        var value = typeof target === 'string'
            ? target
            : target && (target.appDisplayName || target.displayName || target.name || '');
        return value ? '#enterprise-apps?search=' + encodeURIComponent(value) : '#enterprise-apps';
    }

    function getEnterpriseApps() {
        var raw = DataLoader.getData('enterpriseApps') || [];
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.apps)) return raw.apps;
        if (raw && Array.isArray(raw.servicePrincipals)) return raw.servicePrincipals;
        return [];
    }

    function getCredentialApps() {
        var raw = DataLoader.getData('servicePrincipalSecrets') || {};
        return Array.isArray(raw.applications) ? raw.applications : [];
    }

    function buildAppProfiles() {
        var profiles = {};
        var signIns = DataLoader.getData('appSignins') || [];
        var grants = (DataLoader.getData('oauthConsentGrants') || {}).grants || [];
        var enterpriseApps = getEnterpriseApps();
        var credentialApps = getCredentialApps();

        function ensureProfile(key, seed) {
            if (!profiles[key]) {
                profiles[key] = {
                    appKey: key,
                    appDisplayName: seed.appDisplayName || seed.displayName || '(unknown)',
                    appId: seed.appId || '',
                    publisher: seed.publisher || seed.appPublisher || '--',
                    isMicrosoft: seed.isMicrosoft === true,
                    accountEnabled: seed.accountEnabled !== false,
                    signInCount: 0,
                    failureCount: 0,
                    uniqueUserCount: 0,
                    interactiveCount: 0,
                    nonInteractiveCount: 0,
                    lastUsed: null,
                    topUsers: [],
                    signIns: [],
                    grantCount: 0,
                    highRiskGrantCount: 0,
                    grants: [],
                    credentialStatus: 'unknown',
                    nearestExpiry: null,
                    hasCredentials: false
                };
            }
            return profiles[key];
        }

        signIns.forEach(function(signIn) {
            var key = normalizeText(signIn.appId || signIn.appDisplayName || '(unknown)').toLowerCase();
            var profile = ensureProfile(key, signIn);
            var userKey = normalizeText(signIn.userPrincipalName).toLowerCase();
            profile.appDisplayName = signIn.appDisplayName || profile.appDisplayName;
            profile.appId = signIn.appId || profile.appId;
            profile.signInCount++;
            if (signIn.isInteractive) profile.interactiveCount++;
            else profile.nonInteractiveCount++;
            if (Number(signIn.statusCode) !== 0) profile.failureCount++;
            if (signIn.createdDateTime && (!profile.lastUsed || signIn.createdDateTime > profile.lastUsed)) {
                profile.lastUsed = signIn.createdDateTime;
            }
            profile.signIns.push(signIn);
            if (userKey) {
                var existing = profile.topUsers.find(function(user) { return user.key === userKey; });
                if (!existing) {
                    existing = { key: userKey, userPrincipalName: signIn.userPrincipalName, count: 0 };
                    profile.topUsers.push(existing);
                }
                existing.count++;
            }
        });

        grants.forEach(function(grant) {
            var key = normalizeText(grant.appId || grant.appDisplayName || '(unknown)').toLowerCase();
            var profile = ensureProfile(key, grant);
            profile.appDisplayName = grant.appDisplayName || profile.appDisplayName;
            profile.appId = grant.appId || profile.appId;
            profile.publisher = grant.appPublisher || profile.publisher;
            profile.grantCount++;
            if (normalizeText(grant.riskLevel).toLowerCase() === 'high') profile.highRiskGrantCount++;
            profile.grants.push(grant);
        });

        enterpriseApps.forEach(function(app) {
            var key = normalizeText(app.appId || app.displayName || '(unknown)').toLowerCase();
            var profile = ensureProfile(key, app);
            profile.appDisplayName = app.displayName || profile.appDisplayName;
            profile.appId = app.appId || profile.appId;
            profile.publisher = app.publisher || profile.publisher;
            profile.isMicrosoft = app.isMicrosoft === true;
            profile.accountEnabled = app.accountEnabled !== false;
            if (app.credentialStatus) profile.credentialStatus = app.credentialStatus;
            if (app.nearestExpiryDays !== undefined && app.nearestExpiryDays !== null) profile.nearestExpiry = app.nearestExpiryDays;
            profile.hasCredentials = app.hasCredentials === true || profile.hasCredentials;
        });

        credentialApps.forEach(function(app) {
            var key = normalizeText(app.appId || app.displayName || '(unknown)').toLowerCase();
            var profile = ensureProfile(key, app);
            profile.appDisplayName = app.displayName || profile.appDisplayName;
            profile.appId = app.appId || profile.appId;
            profile.hasCredentials = app.hasCredentials === true || profile.hasCredentials;
            if (app.credentialStatus) profile.credentialStatus = app.credentialStatus;
            if (app.nearestExpiry !== undefined && app.nearestExpiry !== null) profile.nearestExpiry = app.nearestExpiry;
        });

        return Object.keys(profiles).map(function(key) {
            var profile = profiles[key];
            profile.uniqueUserCount = profile.topUsers.length;
            profile.topUsers.sort(function(a, b) { return b.count - a.count; });
            profile.signIns.sort(function(a, b) { return new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime(); });
            return profile;
        }).sort(function(a, b) {
            if (b.highRiskGrantCount !== a.highRiskGrantCount) return b.highRiskGrantCount - a.highRiskGrantCount;
            if (b.failureCount !== a.failureCount) return b.failureCount - a.failureCount;
            return b.signInCount - a.signInCount;
        });
    }

    function formatConsentRisk(value, row) {
        if (!row.grantCount) return '<span class="text-muted">No grants</span>';
        var badge = row.highRiskGrantCount > 0 ? '<span class="badge badge-critical">' + row.highRiskGrantCount + ' high risk</span>' : '<span class="badge badge-success">No high-risk grants</span>';
        return '<strong>' + row.grantCount + '</strong> grants<br>' + badge;
    }

    function formatCredentialHealth(value, row) {
        var status = normalizeText(row.credentialStatus).toLowerCase();
        if (!row.hasCredentials || status === 'no-credentials') return '<span class="badge badge-neutral">No credentials</span>';
        if (status === 'expired') return '<span class="badge badge-critical">Expired</span>';
        if (status === 'critical') return '<span class="badge badge-critical">Critical</span>';
        if (status === 'warning') return '<span class="badge badge-warning">Warning</span>';
        return '<span class="badge badge-success">Healthy</span>';
    }

    function formatUsage(value, row) {
        if (!row.signInCount) return '<span class="text-muted">No sign-ins</span>';
        return '<strong>' + row.signInCount + '</strong> sign-ins<br><small>' + row.uniqueUserCount + ' users</small>';
    }

    function formatActivityMix(value, row) {
        if (!row.signInCount) return '<span class="text-muted">--</span>';
        return '<strong>' + row.interactiveCount + '</strong> interactive<br><small>' + row.nonInteractiveCount + ' non-interactive</small>';
    }

    function formatAppCell(value, row) {
        return '<a href="' + getAppHref(row) + '" class="entity-link" onclick="event.stopPropagation();"><strong>' + escapeHtml(value || '--') + '</strong></a>';
    }

    function formatActionCell(value, row) {
        var actions = [];
        actions.push('<a href="' + getAppHref(row) + '" class="admin-link" onclick="event.stopPropagation();" title="Open app context">App Context</a>');
        if (row.grantCount > 0) actions.push('<a href="#oauth-consent" class="admin-link" onclick="event.stopPropagation();" title="Open OAuth consent">Consent</a>');
        if (row.credentialStatus && row.credentialStatus !== 'no-credentials') actions.push('<a href="#credential-expiry" class="admin-link" onclick="event.stopPropagation();" title="Open credentials">Creds</a>');
        return actions.join(' ');
    }

    function renderSummaryCards() {
        var element = document.getElementById('app-usage-summary');
        if (!element) return;
        var totalSignIns = state.apps.reduce(function(total, item) { return total + item.signInCount; }, 0);
        var highRisk = state.apps.filter(function(item) { return item.highRiskGrantCount > 0; }).length;
        var expiring = state.apps.filter(function(item) { return normalizeText(item.credentialStatus).toLowerCase() === 'expired' || normalizeText(item.credentialStatus).toLowerCase() === 'critical'; }).length;
        var dormant = state.apps.filter(function(item) { return !item.signInCount && (item.grantCount > 0 || item.hasCredentials); }).length;

        element.innerHTML =
            '<div class="summary-card"><div class="summary-value">' + state.apps.length + '</div><div class="summary-label">Applications</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + totalSignIns + '</div><div class="summary-label">Sign-Ins</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + highRisk + '</div><div class="summary-label">High-Risk Consent Apps</div></div>' +
            '<div class="summary-card card-warning"><div class="summary-value">' + expiring + '</div><div class="summary-label">Expired/Critical Credentials</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + dormant + '</div><div class="summary-label">Dormant But Exposed</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + state.apps.filter(function(item) { return item.failureCount > 0; }).length + '</div><div class="summary-label">Apps With Failures</div></div>';
    }

    function buildQueueCard(title, count, filter, subtitle) {
        return (
            '<div class="signal-card signal-card--info">' +
                '<div class="signal-card-value">' + count + '</div>' +
                '<div class="signal-card-label">' + escapeHtml(title) + '</div>' +
                '<div class="signal-card-meta">' + escapeHtml(subtitle) + '</div>' +
                '<div class="signal-card-actions"><button class="btn btn-secondary btn-sm" data-app-filter="' + filter + '">View in Table</button></div>' +
            '</div>'
        );
    }

    function renderQueues() {
        var element = document.getElementById('app-usage-queues');
        if (!element) return;
        var highRisk = state.apps.filter(function(item) { return item.highRiskGrantCount > 0; }).length;
        var failures = state.apps.filter(function(item) { return item.failureCount > 0; }).length;
        var expiring = state.apps.filter(function(item) {
            var status = normalizeText(item.credentialStatus).toLowerCase();
            return status === 'expired' || status === 'critical';
        }).length;
        var dormant = state.apps.filter(function(item) { return !item.signInCount && (item.grantCount > 0 || item.hasCredentials); }).length;

        element.innerHTML =
            buildQueueCard('High-Risk Consent', highRisk, 'high-risk', 'apps with high-risk OAuth grants') +
            buildQueueCard('Failure Hotspots', failures, 'failures', 'apps with failed sign-ins') +
            buildQueueCard('Credential Risk', expiring, 'expiring', 'expired or critical app credentials') +
            buildQueueCard('Dormant Exposure', dormant, 'dormant', 'apps with no usage but active exposure');
    }

    function renderPriorityTable() {
        Tables.render({
            containerId: 'app-usage-priority-table',
            data: state.apps.slice(0, 15),
            columns: [
                { key: 'appDisplayName', label: 'Application', formatter: formatAppCell },
                { key: 'publisher', label: 'Publisher' },
                { key: 'signInCount', label: 'Usage', formatter: formatUsage },
                { key: 'highRiskGrantCount', label: 'Consent Risk', formatter: formatConsentRisk },
                { key: 'credentialStatus', label: 'Credential Health', formatter: formatCredentialHealth }
            ],
            pageSize: 15,
            onRowClick: showAppDetails
        });
    }

    function wireQueueButtons() {
        var buttons = document.querySelectorAll('[data-app-filter]');
        Array.prototype.forEach.call(buttons, function(button) {
            button.addEventListener('click', function() {
                var mode = button.getAttribute('data-app-filter');
                var consent = document.getElementById('app-usage-consent');
                var health = document.getElementById('app-usage-health');
                var activity = document.getElementById('app-usage-activity');
                if (consent) consent.value = 'all';
                if (health) health.value = 'all';
                if (activity) activity.value = 'all';
                if (mode === 'high-risk') consent.value = 'high-risk';
                else if (mode === 'failures') activity.value = 'failures';
                else if (mode === 'expiring') health.value = 'expiring';
                else if (mode === 'dormant') activity.value = 'dormant';
                applyFilters();
            });
        });
    }

    function applyFilters() {
        var filterConfig = {
            search: Filters.getValue('app-usage-search'),
            searchFields: ['appDisplayName', 'publisher']
        };
        var filtered = Filters.apply(state.apps, filterConfig);
        var consent = Filters.getValue('app-usage-consent');
        var health = Filters.getValue('app-usage-health');
        var activity = Filters.getValue('app-usage-activity');

        if (consent === 'high-risk') {
            filtered = filtered.filter(function(item) { return item.highRiskGrantCount > 0; });
        } else if (consent === 'has-grants') {
            filtered = filtered.filter(function(item) { return item.grantCount > 0; });
        }

        if (health === 'expiring') {
            filtered = filtered.filter(function(item) {
                var status = normalizeText(item.credentialStatus).toLowerCase();
                return status === 'expired' || status === 'critical';
            });
        } else if (health === 'warning') {
            filtered = filtered.filter(function(item) { return normalizeText(item.credentialStatus).toLowerCase() === 'warning'; });
        }

        if (activity === 'dormant') {
            filtered = filtered.filter(function(item) { return !item.signInCount; });
        } else if (activity === 'failures') {
            filtered = filtered.filter(function(item) { return item.failureCount > 0; });
        } else if (activity === 'noninteractive') {
            filtered = filtered.filter(function(item) { return item.nonInteractiveCount > item.interactiveCount; });
        }

        state.filtered = filtered;
        renderMainTable(filtered);
    }

    function renderMainTable(data) {
        var visible = colSelector ? colSelector.getVisible() : [
            'appDisplayName',
            'publisher',
            'signInCount',
            'activityMix',
            'highRiskGrantCount',
            'credentialStatus',
            '_actions'
        ];

        var defs = {
            appDisplayName: { key: 'appDisplayName', label: 'Application', formatter: formatAppCell },
            publisher: { key: 'publisher', label: 'Publisher' },
            signInCount: { key: 'signInCount', label: 'Usage', formatter: formatUsage },
            activityMix: { key: 'activityMix', label: 'Interactive Mix', formatter: formatActivityMix },
            highRiskGrantCount: { key: 'highRiskGrantCount', label: 'Consent Risk', formatter: formatConsentRisk },
            credentialStatus: { key: 'credentialStatus', label: 'Credential Health', formatter: formatCredentialHealth },
            lastUsed: { key: 'lastUsed', label: 'Last Used', formatter: Tables.formatters.datetime },
            _actions: { key: '_actions', label: 'Take Action', formatter: formatActionCell }
        };

        Tables.render({
            containerId: 'app-usage-table',
            data: data,
            columns: visible.map(function(key) { return defs[key]; }).filter(Boolean),
            pageSize: 50,
            onRowClick: showAppDetails
        });
    }

    function detailItem(label, value) {
        return '<div class="detail-item"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + value + '</span></div>';
    }

    function renderTopUsers(app) {
        if (!app.topUsers.length) return '<p class="text-muted">No user-level sign-in data collected for this app.</p>';
        var html = '<table class="data-table"><thead><tr><th>User</th><th>Sign-Ins</th></tr></thead><tbody>';
        app.topUsers.slice(0, 8).forEach(function(user) {
            html += '<tr>';
            html += '<td><a href="' + getUserHref(user.userPrincipalName) + '" class="entity-link">' + escapeHtml(user.userPrincipalName || '--') + '</a></td>';
            html += '<td>' + user.count + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function renderRecentSignIns(app) {
        if (!app.signIns.length) return '<p class="text-muted">No sign-ins found for this app.</p>';
        var html = '<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Status</th><th>Location</th></tr></thead><tbody>';
        app.signIns.slice(0, 8).forEach(function(signIn) {
            html += '<tr>';
            html += '<td>' + Tables.formatters.datetime(signIn.createdDateTime) + '</td>';
            html += '<td><a href="' + getUserHref(signIn.userPrincipalName) + '" class="entity-link">' + escapeHtml(signIn.userPrincipalName || '--') + '</a></td>';
            html += '<td>' + escapeHtml(signIn.statusReason || (Number(signIn.statusCode) === 0 ? 'Success' : 'Failure')) + '</td>';
            html += '<td>' + escapeHtml([signIn.city, signIn.country].filter(Boolean).join(', ') || '--') + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function renderGrants(app) {
        if (!app.grants.length) return '<p class="text-muted">No OAuth grants found for this app.</p>';
        var html = '<table class="data-table"><thead><tr><th>Consent Type</th><th>Risk</th><th>Principal</th><th>Scopes</th></tr></thead><tbody>';
        app.grants.slice(0, 8).forEach(function(grant) {
            html += '<tr>';
            html += '<td>' + escapeHtml(grant.consentType || (grant.isAdminConsent ? 'AllPrincipals' : 'Principal')) + '</td>';
            html += '<td>' + (normalizeText(grant.riskLevel).toLowerCase() === 'high' ? '<span class="badge badge-critical">High</span>' : '<span class="badge badge-info">' + escapeHtml(grant.riskLevel || 'low') + '</span>') + '</td>';
            html += '<td>' + escapeHtml(grant.principalDisplayName || 'All Users') + '</td>';
            html += '<td>' + escapeHtml((grant.highRiskScopes || grant.scopes || []).slice(0, 4).join(', ') || '--') + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function showAppDetails(app) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        title.textContent = app.appDisplayName || 'Application Details';
        body.innerHTML =
            '<div class="detail-grid">' +
                detailItem('Application', '<a href="' + getAppHref(app) + '" class="entity-link">' + escapeHtml(app.appDisplayName || '--') + '</a>') +
                detailItem('App Id', escapeHtml(app.appId || '--')) +
                detailItem('Publisher', escapeHtml(app.publisher || '--')) +
                detailItem('Account State', app.accountEnabled ? '<span class="text-success">Enabled</span>' : '<span class="text-warning">Disabled</span>') +
                detailItem('Usage', formatUsage('', app)) +
                detailItem('Interactive Mix', formatActivityMix('', app)) +
                detailItem('Consent Risk', formatConsentRisk('', app)) +
                detailItem('Credential Health', formatCredentialHealth('', app)) +
                detailItem('Last Used', app.lastUsed ? Tables.formatters.datetime(app.lastUsed) : '<span class="text-muted">--</span>') +
            '</div>' +
            '<div class="detail-section"><h4>Take Action</h4><div class="action-row">' +
                '<a href="' + getAppHref(app) + '" class="btn btn-primary btn-sm">Open App Context</a>' +
                (app.grantCount > 0 ? '<a href="#oauth-consent" class="btn btn-secondary btn-sm">Open Consent Review</a>' : '') +
                (app.credentialStatus && app.credentialStatus !== 'no-credentials' ? '<a href="#credential-expiry" class="btn btn-secondary btn-sm">Open Credential Risk</a>' : '') +
            '</div></div>' +
            '<div class="detail-section"><h4>Top Users</h4>' + renderTopUsers(app) + '</div>' +
            '<div class="detail-section"><h4>Recent Sign-Ins</h4>' + renderRecentSignIns(app) + '</div>' +
            '<div class="detail-section"><h4>OAuth Exposure</h4>' + renderGrants(app) + '</div>';

        modal.classList.add('visible');
    }

    function render(container) {
        state.apps = buildAppProfiles();
        state.filtered = state.apps.slice();

        container.innerHTML =
            '<div class="page-header">' +
                '<h2 class="page-title">Application Usage</h2>' +
                '<p class="page-description">Application activity correlated with OAuth exposure and credential health.</p>' +
            '</div>' +
            '<div class="summary-cards" id="app-usage-summary"></div>' +
            '<div class="analytics-section"><h3>Priority Queues</h3><div class="signal-cards" id="app-usage-queues"></div></div>' +
            '<div class="analytics-section"><h3>Priority Applications</h3><div id="app-usage-priority-table"></div></div>' +
            '<div class="analytics-section">' +
                '<h3>Application Inventory</h3>' +
                '<div id="app-usage-filters"></div>' +
                '<div id="app-usage-colselector" style="margin-bottom: 8px; text-align: right;"></div>' +
                '<div id="app-usage-table"></div>' +
            '</div>';

        renderSummaryCards();
        renderQueues();
        renderPriorityTable();

        Filters.createFilterBar({
            containerId: 'app-usage-filters',
            controls: [
                { type: 'search', id: 'app-usage-search', placeholder: 'Search applications or publishers...' },
                {
                    type: 'select',
                    id: 'app-usage-consent',
                    label: 'Consent',
                    options: [
                        { value: 'all', label: 'All Consent States' },
                        { value: 'high-risk', label: 'High-Risk Grants' },
                        { value: 'has-grants', label: 'Any Grants' }
                    ]
                },
                {
                    type: 'select',
                    id: 'app-usage-health',
                    label: 'Credential Health',
                    options: [
                        { value: 'all', label: 'All Health States' },
                        { value: 'expiring', label: 'Expired/Critical' },
                        { value: 'warning', label: 'Warning' }
                    ]
                },
                {
                    type: 'select',
                    id: 'app-usage-activity',
                    label: 'Activity',
                    options: [
                        { value: 'all', label: 'All Activity' },
                        { value: 'failures', label: 'Failures' },
                        { value: 'dormant', label: 'Dormant' },
                        { value: 'noninteractive', label: 'Mostly Non-Interactive' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        colSelector = ColumnSelector.create({
            containerId: 'app-usage-colselector',
            storageKey: 'tenantscope-app-usage-cols-v2',
            allColumns: [
                { key: 'appDisplayName', label: 'Application' },
                { key: 'publisher', label: 'Publisher' },
                { key: 'signInCount', label: 'Usage' },
                { key: 'activityMix', label: 'Interactive Mix' },
                { key: 'highRiskGrantCount', label: 'Consent Risk' },
                { key: 'credentialStatus', label: 'Credential Health' },
                { key: 'lastUsed', label: 'Last Used' },
                { key: '_actions', label: 'Take Action' }
            ],
            defaultVisible: ['appDisplayName', 'publisher', 'signInCount', 'activityMix', 'highRiskGrantCount', 'credentialStatus', '_actions'],
            onColumnsChanged: applyFilters
        });

        wireQueueButtons();
        applyFilters();
    }

    return {
        render: render
    };
})();

window.PageAppUsage = PageAppUsage;
