/**
 * TenantScope - Credential Expiry Page
 *
 * Correlates application credentials with tenant usage and OAuth exposure so
 * operators can rotate the right credentials first.
 */

const PageCredentialExpiry = (function() {
    'use strict';

    var AU = window.ActionUtils || {};
    var state = {
        records: [],
        appSummaries: [],
        filtered: []
    };
    var colSelector = null;

    function escapeHtml(value) {
        return Tables.escapeHtml(value === null || value === undefined ? '' : String(value));
    }

    function normalizeText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function getEnterpriseApps() {
        var raw = DataLoader.getData('enterpriseApps') || [];
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.apps)) return raw.apps;
        if (raw && Array.isArray(raw.servicePrincipals)) return raw.servicePrincipals;
        return [];
    }

    function buildAppIndexes() {
        var index = {
            enterpriseByAppId: {},
            enterpriseByName: {},
            grantsByAppId: {},
            grantsByName: {},
            signInsByAppId: {},
            signInsByName: {}
        };

        getEnterpriseApps().forEach(function(app) {
            if (app.appId) index.enterpriseByAppId[app.appId] = app;
            if (app.displayName) index.enterpriseByName[app.displayName.toLowerCase()] = app;
        });

        var consentData = DataLoader.getData('oauthConsentGrants') || {};
        (consentData.grants || []).forEach(function(grant) {
            var appId = normalizeText(grant.appId);
            var name = normalizeText(grant.appDisplayName).toLowerCase();
            if (appId) {
                if (!index.grantsByAppId[appId]) index.grantsByAppId[appId] = [];
                index.grantsByAppId[appId].push(grant);
            }
            if (name) {
                if (!index.grantsByName[name]) index.grantsByName[name] = [];
                index.grantsByName[name].push(grant);
            }
        });

        var signIns = DataLoader.getData('appSignins') || [];
        signIns.forEach(function(signIn) {
            var appId = normalizeText(signIn.appId);
            var name = normalizeText(signIn.appDisplayName).toLowerCase();
            if (appId) {
                if (!index.signInsByAppId[appId]) index.signInsByAppId[appId] = [];
                index.signInsByAppId[appId].push(signIn);
            }
            if (name) {
                if (!index.signInsByName[name]) index.signInsByName[name] = [];
                index.signInsByName[name].push(signIn);
            }
        });

        return index;
    }

    function getAppHref(target) {
        var value = typeof target === 'string'
            ? target
            : target && (target.displayName || target.appDisplayName || target.name || '');
        return value ? '#enterprise-apps?search=' + encodeURIComponent(value) : '#enterprise-apps';
    }

    function buildCredentialStatusLabel(status, daysUntilExpiry) {
        var value = normalizeText(status).toLowerCase();
        if (value === 'expired') return { cls: 'badge-critical', label: 'Expired' };
        if (value === 'critical' || (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry <= 7)) return { cls: 'badge-critical', label: 'Critical' };
        if (value === 'warning' || (daysUntilExpiry !== null && daysUntilExpiry !== undefined && daysUntilExpiry <= 30)) return { cls: 'badge-warning', label: 'Warning' };
        return { cls: 'badge-success', label: 'Healthy' };
    }

    function buildRotationCommand(record) {
        if (!record || !record.applicationObjectId || record.credentialType !== 'secret') return '';
        var safeObjectId = AU.escapeSingleQuotes ? AU.escapeSingleQuotes(record.applicationObjectId) : record.applicationObjectId;
        var safeLabel = AU.escapeSingleQuotes ? AU.escapeSingleQuotes((record.appDisplayName || 'Rotated secret') + ' rotation') : (record.appDisplayName || 'Rotated secret');
        return "Add-MgApplicationPassword -ApplicationId '" + safeObjectId + "' -PasswordCredential @{ displayName = '" + safeLabel + "' }";
    }

    function buildRecords() {
        var secretData = DataLoader.getData('servicePrincipalSecrets') || {};
        var apps = Array.isArray(secretData.applications) ? secretData.applications : [];
        var indexes = buildAppIndexes();
        var records = [];

        apps.forEach(function(app) {
            var enterprise = indexes.enterpriseByAppId[app.appId] || indexes.enterpriseByName[normalizeText(app.displayName).toLowerCase()] || {};
            var grants = indexes.grantsByAppId[app.appId] || indexes.grantsByName[normalizeText(app.displayName).toLowerCase()] || [];
            var signIns = indexes.signInsByAppId[app.appId] || indexes.signInsByName[normalizeText(app.displayName).toLowerCase()] || [];
            var uniqueUsers = {};
            var lastUsed = null;
            var failureCount = 0;

            signIns.forEach(function(signIn) {
                if (signIn.userPrincipalName) uniqueUsers[signIn.userPrincipalName.toLowerCase()] = true;
                if (signIn.statusCode && Number(signIn.statusCode) !== 0) failureCount++;
                if (signIn.createdDateTime && (!lastUsed || signIn.createdDateTime > lastUsed)) lastUsed = signIn.createdDateTime;
            });

            function pushRecord(item, credentialType) {
                var statusInfo = buildCredentialStatusLabel(item.status, item.daysUntilExpiry);
                records.push({
                    id: app.id + ':' + credentialType + ':' + (item.keyId || item.displayName || 'credential'),
                    applicationObjectId: app.id,
                    appDisplayName: app.displayName,
                    appId: app.appId,
                    publisher: enterprise.publisher || enterprise.appPublisher || '--',
                    accountEnabled: enterprise.accountEnabled !== false,
                    isMicrosoft: enterprise.isMicrosoft === true,
                    credentialType: credentialType,
                    credentialName: item.displayName || credentialType,
                    keyId: item.keyId || '',
                    usage: item.usage || item.type || '--',
                    status: item.status,
                    statusLabel: statusInfo.label,
                    statusClass: statusInfo.cls,
                    daysUntilExpiry: item.daysUntilExpiry,
                    expiryDate: item.endDateTime,
                    appCredentialStatus: app.credentialStatus,
                    nearestExpiry: app.nearestExpiry,
                    signInCount: signIns.length,
                    uniqueUserCount: Object.keys(uniqueUsers).length,
                    lastUsed: lastUsed,
                    failureCount: failureCount,
                    grantCount: grants.length,
                    highRiskGrantCount: grants.filter(function(grant) { return normalizeText(grant.riskLevel).toLowerCase() === 'high'; }).length,
                    grants: grants,
                    signIns: signIns.slice(0, 15),
                    needsAttention: app.needsAttention === true || statusInfo.label !== 'Healthy',
                    rotationCommand: ''
                });
            }

            (app.secrets || []).forEach(function(secret) { pushRecord(secret, 'secret'); });
            (app.certificates || []).forEach(function(cert) { pushRecord(cert, 'certificate'); });
        });

        records.forEach(function(record) {
            record.rotationCommand = buildRotationCommand(record);
        });

        return records.sort(function(a, b) {
            var aDays = a.daysUntilExpiry === null || a.daysUntilExpiry === undefined ? 99999 : a.daysUntilExpiry;
            var bDays = b.daysUntilExpiry === null || b.daysUntilExpiry === undefined ? 99999 : b.daysUntilExpiry;
            return aDays - bDays;
        });
    }

    function buildAppSummaries(records) {
        var map = {};
        records.forEach(function(record) {
            var key = record.appId || record.appDisplayName;
            if (!map[key]) {
                map[key] = {
                    appDisplayName: record.appDisplayName,
                    appId: record.appId,
                    publisher: record.publisher,
                    accountEnabled: record.accountEnabled,
                    signInCount: record.signInCount,
                    uniqueUserCount: record.uniqueUserCount,
                    lastUsed: record.lastUsed,
                    highRiskGrantCount: record.highRiskGrantCount,
                    grantCount: record.grantCount,
                    worstDays: record.daysUntilExpiry,
                    worstStatus: record.statusLabel,
                    recordCount: 0,
                    expiredCount: 0
                };
            }

            var summary = map[key];
            summary.recordCount++;
            if (record.daysUntilExpiry < summary.worstDays) summary.worstDays = record.daysUntilExpiry;
            if (record.statusLabel === 'Expired') summary.expiredCount++;
            if (record.statusLabel === 'Expired') summary.worstStatus = 'Expired';
            else if (record.statusLabel === 'Critical' && summary.worstStatus !== 'Expired') summary.worstStatus = 'Critical';
            else if (record.statusLabel === 'Warning' && summary.worstStatus === 'Healthy') summary.worstStatus = 'Warning';
        });

        return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
            return a.worstDays - b.worstDays;
        });
    }

    function formatStatusBadge(value, row) {
        var cls = row && row.statusClass ? row.statusClass : 'badge-neutral';
        return '<span class="badge ' + cls + '">' + escapeHtml(value || 'Unknown') + '</span>';
    }

    function formatTypeBadge(value) {
        return value === 'secret'
            ? '<span class="badge badge-warning">Secret</span>'
            : '<span class="badge badge-info">Certificate</span>';
    }

    function formatDaysLeft(value) {
        if (value === null || value === undefined || isNaN(Number(value))) return '<span class="text-muted">--</span>';
        var num = Number(value);
        if (num < 0) return '<span class="text-critical font-bold">' + num + '</span>';
        if (num <= 7) return '<span class="text-critical">' + num + '</span>';
        if (num <= 30) return '<span class="text-warning">' + num + '</span>';
        return '<span class="text-success">' + num + '</span>';
    }

    function formatAppCell(value, row) {
        return '<a href="' + getAppHref(row) + '" class="entity-link" onclick="event.stopPropagation();"><strong>' + escapeHtml(value || '--') + '</strong></a>';
    }

    function formatUsageCell(value, row) {
        if (!row.signInCount) return '<span class="text-muted">No sign-ins</span>';
        var parts = [];
        parts.push('<strong>' + row.signInCount + '</strong> sign-ins');
        parts.push('<small>' + row.uniqueUserCount + ' users</small>');
        if (row.lastUsed) parts.push('<small>' + Tables.formatters.datetime(row.lastUsed) + '</small>');
        return parts.join('<br>');
    }

    function formatExposureCell(value, row) {
        var parts = [];
        parts.push('<strong>' + row.grantCount + '</strong> grants');
        parts.push('<small>' + row.highRiskGrantCount + ' high risk</small>');
        if (row.failureCount > 0) parts.push('<small>' + row.failureCount + ' app failures</small>');
        return parts.join('<br>');
    }

    function formatActionCell(value, row) {
        var actions = [];
        actions.push('<a href="' + getAppHref(row) + '" class="admin-link" onclick="event.stopPropagation();" title="Open app context">App Context</a>');
        if (row.appId) {
            actions.push('<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/appId/' + encodeURIComponent(row.appId) + '/Credentials" target="_blank" rel="noopener" class="admin-link" onclick="event.stopPropagation();" title="Open in Entra">Entra</a>');
        }
        return actions.join(' ');
    }

    function renderSummaryCards() {
        var element = document.getElementById('credential-summary');
        if (!element) return;
        var expired = state.records.filter(function(record) { return record.statusLabel === 'Expired'; }).length;
        var critical = state.records.filter(function(record) { return record.statusLabel === 'Critical'; }).length;
        var warning = state.records.filter(function(record) { return record.statusLabel === 'Warning'; }).length;
        var dormant = state.appSummaries.filter(function(app) {
            return !app.signInCount && (app.grantCount > 0 || app.recordCount > 0);
        }).length;

        element.innerHTML =
            '<div class="summary-card"><div class="summary-value">' + state.records.length + '</div><div class="summary-label">Credentials</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + expired + '</div><div class="summary-label">Expired</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + critical + '</div><div class="summary-label">Critical (7d)</div></div>' +
            '<div class="summary-card card-warning"><div class="summary-value">' + warning + '</div><div class="summary-label">Warning (30d)</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + dormant + '</div><div class="summary-label">Dormant Apps</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + state.appSummaries.filter(function(app) { return app.highRiskGrantCount > 0; }).length + '</div><div class="summary-label">Apps With High-Risk Grants</div></div>';
    }

    function buildQueueCard(title, count, filter, subtitle) {
        return (
            '<div class="signal-card signal-card--info">' +
                '<div class="signal-card-value">' + count + '</div>' +
                '<div class="signal-card-label">' + escapeHtml(title) + '</div>' +
                '<div class="signal-card-meta">' + escapeHtml(subtitle) + '</div>' +
                '<div class="signal-card-actions"><button class="btn btn-secondary btn-sm" data-creds-filter="' + filter + '">View in Table</button></div>' +
            '</div>'
        );
    }

    function renderQueues() {
        var element = document.getElementById('credential-queues');
        if (!element) return;
        var expired = state.records.filter(function(record) { return record.statusLabel === 'Expired'; }).length;
        var critical = state.records.filter(function(record) { return record.daysUntilExpiry !== null && record.daysUntilExpiry !== undefined && record.daysUntilExpiry <= 7; }).length;
        var warning = state.records.filter(function(record) { return record.daysUntilExpiry > 7 && record.daysUntilExpiry <= 30; }).length;
        var dormant = state.records.filter(function(record) { return !record.signInCount; }).length;

        element.innerHTML =
            buildQueueCard('Rotate Now', expired, 'expired', 'credentials already expired') +
            buildQueueCard('Next 7 Days', critical, 'critical', 'rotation needed inside 7 days') +
            buildQueueCard('Next 30 Days', warning, 'warning', 'plan upcoming rotations') +
            buildQueueCard('Dormant Apps', dormant, 'dormant', 'apps with credentials but no usage');
    }

    function renderAttentionTable() {
        Tables.render({
            containerId: 'credential-attention-table',
            data: state.appSummaries.slice(0, 15),
            columns: [
                { key: 'appDisplayName', label: 'Application', formatter: function(v, row) { return '<a href="' + getAppHref(row) + '" class="entity-link" onclick="event.stopPropagation();"><strong>' + escapeHtml(v || '--') + '</strong></a>'; } },
                { key: 'publisher', label: 'Publisher' },
                { key: 'worstStatus', label: 'Worst Status', formatter: function(v, row) { return formatStatusBadge(v, { statusClass: v === 'Expired' || v === 'Critical' ? 'badge-critical' : v === 'Warning' ? 'badge-warning' : 'badge-success' }); } },
                { key: 'worstDays', label: 'Worst Days Left', formatter: formatDaysLeft },
                { key: 'grantCount', label: 'Exposure', formatter: function(v, row) { return '<strong>' + row.grantCount + '</strong> grants<br><small>' + row.highRiskGrantCount + ' high risk</small>'; } },
                { key: 'signInCount', label: 'Usage', formatter: function(v, row) { return row.signInCount ? '<strong>' + row.signInCount + '</strong> sign-ins<br><small>' + row.uniqueUserCount + ' users</small>' : '<span class="text-muted">No sign-ins</span>'; } }
            ],
            pageSize: 15
        });
    }

    function wireQueueButtons() {
        var buttons = document.querySelectorAll('[data-creds-filter]');
        Array.prototype.forEach.call(buttons, function(button) {
            button.addEventListener('click', function() {
                var mode = button.getAttribute('data-creds-filter');
                var status = document.getElementById('creds-status');
                var usage = document.getElementById('creds-usage');
                if (status) status.value = 'all';
                if (usage) usage.value = 'all';
                if (mode === 'expired') status.value = 'expired';
                else if (mode === 'critical') status.value = 'critical';
                else if (mode === 'warning') status.value = 'warning';
                else if (mode === 'dormant') usage.value = 'dormant';
                applyFilters();
            });
        });
    }

    function applyFilters() {
        var filterConfig = {
            search: Filters.getValue('creds-search'),
            searchFields: ['appDisplayName', 'credentialName', 'publisher', 'usage']
        };
        var filtered = Filters.apply(state.records, filterConfig);
        var type = Filters.getValue('creds-type');
        var status = Filters.getValue('creds-status');
        var usage = Filters.getValue('creds-usage');

        if (type && type !== 'all') {
            filtered = filtered.filter(function(record) { return record.credentialType === type; });
        }
        if (status && status !== 'all') {
            filtered = filtered.filter(function(record) {
                if (status === 'expired') return record.statusLabel === 'Expired';
                if (status === 'critical') return record.daysUntilExpiry !== null && record.daysUntilExpiry !== undefined && record.daysUntilExpiry <= 7;
                if (status === 'warning') return record.daysUntilExpiry > 7 && record.daysUntilExpiry <= 30;
                return true;
            });
        }
        if (usage && usage !== 'all') {
            filtered = filtered.filter(function(record) {
                if (usage === 'dormant') return !record.signInCount;
                if (usage === 'active') return record.signInCount > 0;
                if (usage === 'exposed') return record.highRiskGrantCount > 0;
                return true;
            });
        }

        state.filtered = filtered;
        renderMainTable(filtered);
    }

    function renderMainTable(data) {
        var visible = colSelector ? colSelector.getVisible() : [
            'appDisplayName',
            'credentialType',
            'statusLabel',
            'daysUntilExpiry',
            'usage',
            'exposure',
            '_actions'
        ];

        var defs = {
            appDisplayName: { key: 'appDisplayName', label: 'Application', formatter: formatAppCell },
            credentialType: { key: 'credentialType', label: 'Type', formatter: formatTypeBadge },
            credentialName: { key: 'credentialName', label: 'Credential' },
            statusLabel: { key: 'statusLabel', label: 'Status', formatter: formatStatusBadge },
            daysUntilExpiry: { key: 'daysUntilExpiry', label: 'Days Left', formatter: formatDaysLeft },
            expiryDate: { key: 'expiryDate', label: 'Expiry Date', formatter: Tables.formatters.date },
            usage: { key: 'usage', label: 'Usage', formatter: formatUsageCell },
            exposure: { key: 'exposure', label: 'Exposure', formatter: formatExposureCell },
            publisher: { key: 'publisher', label: 'Publisher' },
            _actions: { key: '_actions', label: 'Take Action', formatter: formatActionCell }
        };

        Tables.render({
            containerId: 'credential-table',
            data: data,
            columns: visible.map(function(key) { return defs[key]; }).filter(Boolean),
            pageSize: 50,
            onRowClick: showCredentialDetails
        });
    }

    function detailItem(label, value) {
        return '<div class="detail-item"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + value + '</span></div>';
    }

    function renderRecentSignIns(record) {
        if (!record.signIns.length) return '<p class="text-muted">No app sign-ins found in collected data.</p>';
        var html = '<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Status</th><th>Location</th></tr></thead><tbody>';
        record.signIns.slice(0, 8).forEach(function(item) {
            html += '<tr>';
            html += '<td>' + Tables.formatters.datetime(item.createdDateTime) + '</td>';
            html += '<td>' + escapeHtml(item.userPrincipalName || '--') + '</td>';
            html += '<td>' + escapeHtml(item.statusReason || (Number(item.statusCode) === 0 ? 'Success' : 'Failure')) + '</td>';
            html += '<td>' + escapeHtml([item.city, item.country].filter(Boolean).join(', ') || '--') + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function showCredentialDetails(record) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        title.textContent = record.appDisplayName || 'Credential Details';
        body.innerHTML =
            '<div class="detail-grid">' +
                detailItem('Application', '<a href="' + getAppHref(record) + '" class="entity-link">' + escapeHtml(record.appDisplayName || '--') + '</a>') +
                detailItem('App Id', escapeHtml(record.appId || '--')) +
                detailItem('Publisher', escapeHtml(record.publisher || '--')) +
                detailItem('Credential', escapeHtml(record.credentialName || '--')) +
                detailItem('Credential Type', formatTypeBadge(record.credentialType)) +
                detailItem('Status', formatStatusBadge(record.statusLabel, record)) +
                detailItem('Days Left', formatDaysLeft(record.daysUntilExpiry)) +
                detailItem('Expiry Date', Tables.formatters.date(record.expiryDate)) +
                detailItem('Usage', formatUsageCell('', record)) +
                detailItem('Exposure', formatExposureCell('', record)) +
                detailItem('Usage Hint', escapeHtml(record.usage || '--')) +
            '</div>' +
            '<div class="detail-section"><h4>Take Action</h4><div class="action-row">' +
                '<a href="' + getAppHref(record) + '" class="btn btn-primary btn-sm">Open App Context</a>' +
                (record.appId ? '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/appId/' + encodeURIComponent(record.appId) + '/Credentials" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open in Entra</a>' : '') +
            '</div>' +
            (record.rotationCommand ? '<div class="action-note" style="margin-top:8px;"><strong>Rotation Command:</strong><br><input type="text" class="filter-input action-input" id="credential-rotation-command" readonly value="' + escapeHtml(record.rotationCommand) + '"></div><div class="action-row"><button class="btn btn-secondary btn-sm" id="copy-credential-command">Copy Command</button></div>' : '<div class="action-note" style="margin-top:8px;">Certificate rotations should be handled in Entra using the app object shown above.</div>') +
            '</div>' +
            '<div class="detail-section"><h4>Recent App Sign-Ins</h4>' + renderRecentSignIns(record) + '</div>';

        if (record.rotationCommand) {
            var copyBtn = body.querySelector('#copy-credential-command');
            if (copyBtn) {
                copyBtn.addEventListener('click', function() {
                    if (!AU.copyText) return;
                    AU.copyText(record.rotationCommand);
                });
            }
        }

        modal.classList.add('visible');
    }

    function render(container) {
        state.records = buildRecords();
        state.appSummaries = buildAppSummaries(state.records);
        state.filtered = state.records.slice();

        container.innerHTML =
            '<div class="page-header">' +
                '<h2 class="page-title">Credential Expiry</h2>' +
                '<p class="page-description">Application credential hygiene with usage and consent exposure context.</p>' +
            '</div>' +
            '<div class="summary-cards" id="credential-summary"></div>' +
            '<div class="analytics-section"><h3>Rotation Queues</h3><div class="signal-cards" id="credential-queues"></div></div>' +
            '<div class="analytics-section"><h3>Apps Requiring Attention</h3><div id="credential-attention-table"></div></div>' +
            '<div class="analytics-section">' +
                '<h3>All Credentials</h3>' +
                '<div id="credential-filters"></div>' +
                '<div id="credential-colselector" style="margin-bottom: 8px; text-align: right;"></div>' +
                '<div id="credential-table"></div>' +
            '</div>';

        renderSummaryCards();
        renderQueues();
        renderAttentionTable();

        Filters.createFilterBar({
            containerId: 'credential-filters',
            controls: [
                { type: 'search', id: 'creds-search', placeholder: 'Search apps, publishers, credentials...' },
                {
                    type: 'select',
                    id: 'creds-type',
                    label: 'Type',
                    options: [
                        { value: 'all', label: 'All Types' },
                        { value: 'secret', label: 'Secrets' },
                        { value: 'certificate', label: 'Certificates' }
                    ]
                },
                {
                    type: 'select',
                    id: 'creds-status',
                    label: 'Urgency',
                    options: [
                        { value: 'all', label: 'All Windows' },
                        { value: 'expired', label: 'Expired' },
                        { value: 'critical', label: 'Next 7 Days' },
                        { value: 'warning', label: 'Next 30 Days' }
                    ]
                },
                {
                    type: 'select',
                    id: 'creds-usage',
                    label: 'Usage',
                    options: [
                        { value: 'all', label: 'All Usage' },
                        { value: 'active', label: 'Has Sign-Ins' },
                        { value: 'dormant', label: 'Dormant' },
                        { value: 'exposed', label: 'High-Risk Grants' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        colSelector = ColumnSelector.create({
            containerId: 'credential-colselector',
            storageKey: 'tenantscope-credential-cols-v2',
            allColumns: [
                { key: 'appDisplayName', label: 'Application' },
                { key: 'credentialType', label: 'Type' },
                { key: 'credentialName', label: 'Credential' },
                { key: 'statusLabel', label: 'Status' },
                { key: 'daysUntilExpiry', label: 'Days Left' },
                { key: 'expiryDate', label: 'Expiry Date' },
                { key: 'usage', label: 'Usage' },
                { key: 'exposure', label: 'Exposure' },
                { key: 'publisher', label: 'Publisher' },
                { key: '_actions', label: 'Take Action' }
            ],
            defaultVisible: ['appDisplayName', 'credentialType', 'statusLabel', 'daysUntilExpiry', 'usage', 'exposure', '_actions'],
            onColumnsChanged: applyFilters
        });

        wireQueueButtons();
        applyFilters();
    }

    return {
        render: render
    };
})();

window.PageCredentialExpiry = PageCredentialExpiry;
