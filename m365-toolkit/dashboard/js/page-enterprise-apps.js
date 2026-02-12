/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: ENTERPRISE APPS
 *
 * Renders the enterprise applications page showing service principals
 * with credential expiry tracking, status, owners, and publisher information.
 * Follows consistent patterns from Devices and Endpoint Analytics pages.
 *
 * SECURITY NOTE: All innerHTML assignments use data from trusted PowerShell
 * collector scripts. Values are either computed integers, pre-validated strings
 * from Microsoft Graph API, or sanitized through formatters. No raw user input
 * is rendered directly.
 */

const PageEnterpriseApps = (function() {
    'use strict';

    /**
     * Escapes HTML special characters to prevent XSS
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var currentTab = 'overview';
    var colSelector = null;

    // ========================================================================
    // DATA EXTRACTION FUNCTIONS
    // ========================================================================

    /**
     * Extracts apps from raw data, handling both array and object formats.
     */
    function extractApps(rawData) {
        var apps = normalizeApps(rawData);
        if (Array.isArray(rawData)) {
            return {
                apps: apps,
                summary: computeSummary(apps),
                insights: []
            };
        }
        var summary = (rawData && rawData.summary) ? rawData.summary : computeSummary(apps);
        var insights = (rawData && rawData.insights) ? rawData.insights : [];
        return {
            apps: apps,
            summary: summary,
            insights: insights
        };
    }

    /**
     * Normalizes apps list from legacy and current data shapes.
     */
    function normalizeApps(rawData) {
        if (Array.isArray(rawData)) return rawData;
        if (!rawData || typeof rawData !== 'object') return [];

        if (Array.isArray(rawData.apps)) return rawData.apps;
        if (Array.isArray(rawData.servicePrincipals)) return rawData.servicePrincipals;
        if (Array.isArray(rawData.items)) return rawData.items;
        if (Array.isArray(rawData.value)) return rawData.value;

        // Handle nested legacy shapes
        if (rawData.apps && Array.isArray(rawData.apps.apps)) return rawData.apps.apps;
        if (rawData.apps && Array.isArray(rawData.apps.value)) return rawData.apps.value;
        if (rawData.apps && Array.isArray(rawData.apps.items)) return rawData.apps.items;

        // Handle objects keyed by id
        if (rawData.apps && typeof rawData.apps === 'object') {
            return Object.values(rawData.apps);
        }
        if (rawData.servicePrincipals && typeof rawData.servicePrincipals === 'object') {
            return Object.values(rawData.servicePrincipals);
        }
        if (rawData.items && typeof rawData.items === 'object') {
            return Object.values(rawData.items);
        }

        return [];
    }
    /**
     * Computes summary statistics from apps array.
     */
    function computeSummary(apps) {
        var summary = {
            totalApps: apps.length,
            microsoftApps: 0,
            thirdPartyApps: 0,
            enabledApps: 0,
            disabledApps: 0,
            appsWithSecrets: 0,
            appsWithCertificates: 0,
            appsWithNoCredentials: 0,
            expiredCredentials: 0,
            criticalIn7Days: 0,
            warningIn30Days: 0,
            attentionIn90Days: 0,
            healthyCredentials: 0,
            appsWithOwners: 0,
            orphanedApps: 0,
            appsByType: {}
        };

        apps.forEach(function(app) {
            // Publisher
            if (app.isMicrosoft) {
                summary.microsoftApps++;
            } else {
                summary.thirdPartyApps++;
            }

            // Status
            if (app.accountEnabled) {
                summary.enabledApps++;
            } else {
                summary.disabledApps++;
            }

            // Credentials
            if (app.secretCount > 0) summary.appsWithSecrets++;
            if (app.certificateCount > 0) summary.appsWithCertificates++;
            if (!app.hasCredentials) summary.appsWithNoCredentials++;

            // Owners
            if (app.ownerCount > 0) {
                summary.appsWithOwners++;
            } else {
                summary.orphanedApps++;
            }

            // Credential status (third-party only)
            if (!app.isMicrosoft) {
                switch (app.credentialStatus) {
                    case 'expired': summary.expiredCredentials++; break;
                    case 'critical': summary.criticalIn7Days++; break;
                    case 'warning': summary.warningIn30Days++; break;
                    case 'attention': summary.attentionIn90Days++; break;
                    case 'healthy': summary.healthyCredentials++; break;
                }
            }

            // App type
            var appType = app.appType || 'other';
            if (!summary.appsByType[appType]) summary.appsByType[appType] = 0;
            summary.appsByType[appType]++;
        });

        return summary;
    }

    // ========================================================================
    // TAB MANAGEMENT
    // ========================================================================

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var rawData = DataLoader.getData('enterpriseApps') || [];
        var data = extractApps(rawData);
        var container = document.getElementById('apps-content');
        if (!container) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, data);
                break;
            case 'apps':
                renderAppsTab(container, data.apps);
                break;
            case 'credentials':
                renderCredentialsTab(container, data.apps);
                break;
            case 'thirdparty':
                renderThirdPartyTab(container, data.apps);
                break;
        }
    }

    // ========================================================================
    // FORMATTERS
    // ========================================================================

    function formatStatus(value) {
        // Safe: boolean to fixed string mapping
        return value
            ? '<span class="badge badge-success">Active</span>'
            : '<span class="badge badge-critical">Disabled</span>';
    }

    function formatCredStatus(value) {
        // Safe: enum to fixed string mapping
        var map = {
            'expired':        { cls: 'badge-critical', label: 'Expired' },
            'critical':       { cls: 'badge-critical', label: 'Critical (7d)' },
            'warning':        { cls: 'badge-warning',  label: 'Warning (30d)' },
            'attention':      { cls: 'badge-attention', label: 'Attention (90d)' },
            'healthy':        { cls: 'badge-success',  label: 'Healthy' },
            'no-credentials': { cls: 'badge-neutral',  label: 'No Creds' }
        };
        var info = map[value] || { cls: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + info.cls + '">' + info.label + '</span>';
    }

    function formatExpiryDays(value) {
        // Safe: numeric value formatting with type checking
        if (value === null || value === undefined || isNaN(Number(value))) {
            return '<span class="text-muted">--</span>';
        }
        var numVal = Number(value);
        var colorClass = '';
        if (numVal < 0) colorClass = 'text-critical font-bold';
        else if (numVal <= 7) colorClass = 'text-critical';
        else if (numVal <= 30) colorClass = 'text-warning';
        else if (numVal <= 90) colorClass = 'text-attention';
        return '<span class="' + colorClass + '">' + numVal + 'd</span>';
    }

    function formatAppType(value) {
        // Safe: enum to fixed string mapping
        var labels = {
            'application':      'App',
            'managed-identity': 'Managed ID',
            'legacy':           'Legacy',
            'social-idp':       'Social IdP',
            'other':            'Other'
        };
        return '<span class="badge badge-neutral">' + (labels[value] || value) + '</span>';
    }

    // ========================================================================
    // OVERVIEW TAB
    // ========================================================================

    function renderOverview(container, data) {
        var apps = data.apps;
        var needsAttention = apps.filter(function(a) {
            return !a.isMicrosoft && (a.credentialStatus === 'expired' || a.credentialStatus === 'critical');
        }).slice(0, 10);

        var html = '';
        if (needsAttention.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Credentials Needing Attention</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Application</th><th>Publisher</th><th>Status</th><th>Expiry</th><th>Secrets</th><th>Certs</th>';
            html += '</tr></thead><tbody>';
            needsAttention.forEach(function(app) {
                html += '<tr class="clickable-row" data-app-id="' + (app.id || '') + '">';
                html += '<td class="cell-truncate">' + (app.displayName || '--') + '</td>';
                html += '<td>' + (app.publisher || '--') + '</td>';
                html += '<td>' + formatCredStatus(app.credentialStatus) + '</td>';
                html += '<td>' + formatExpiryDays(app.nearestExpiryDays) + '</td>';
                html += '<td>' + (app.secretCount || 0) + '</td>';
                html += '<td>' + (app.certificateCount || 0) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        } else {
            html = '<div class="empty-state"><p>No credentials needing attention.</p></div>';
        }

        container.innerHTML = html;

        // Bind click events for attention table
        container.querySelectorAll('.clickable-row').forEach(function(row) {
            row.addEventListener('click', function() {
                var appId = this.dataset.appId;
                var app = apps.find(function(a) { return a.id === appId; });
                if (app) showAppDetails(app);
            });
        });
    }

    // ========================================================================
    // ALL APPS TAB
    // ========================================================================

    function renderAppsTab(container, apps) {
        apps = Array.isArray(apps) ? apps : normalizeApps(apps || {});
        container.innerHTML = '<div id="apps-filter"></div><div class="table-toolbar"><div id="apps-col-selector"></div></div><div id="apps-table"></div>';

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'apps-filter',
            controls: [
                {
                    type: 'search',
                    id: 'apps-search',
                    label: 'Search',
                    placeholder: 'Search apps...'
                },
                {
                    type: 'select',
                    id: 'apps-publisher',
                    label: 'Publisher',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'microsoft', label: 'Microsoft' },
                        { value: 'third-party', label: 'Third-party' }
                    ]
                },
                {
                    type: 'select',
                    id: 'apps-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'enabled', label: 'Active' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select',
                    id: 'apps-cred',
                    label: 'Credential Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'expired', label: 'Expired' },
                        { value: 'critical', label: 'Critical' },
                        { value: 'warning', label: 'Warning' },
                        { value: 'healthy', label: 'Healthy' },
                        { value: 'no-credentials', label: 'No Credentials' }
                    ]
                }
            ],
            onFilter: function() { renderAppsTable(apps); }
        });

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'apps-col-selector',
                storageKey: 'tenantscope-enterprise-apps-cols',
                allColumns: [
                    { key: 'displayName', label: 'Application' },
                    { key: 'publisher', label: 'Publisher' },
                    { key: 'accountEnabled', label: 'Status' },
                    { key: 'credentialStatus', label: 'Credentials' },
                    { key: 'nearestExpiryDays', label: 'Expiry' },
                    { key: 'secretCount', label: 'Secrets' },
                    { key: 'certificateCount', label: 'Certs' },
                    { key: 'appType', label: 'Type' },
                    { key: '_adminLinks', label: 'Admin' }
                ],
                defaultVisible: ['displayName', 'publisher', 'accountEnabled', 'credentialStatus', 'nearestExpiryDays', 'secretCount', 'appType', '_adminLinks'],
                onColumnsChanged: function() { renderAppsTable(apps); }
            });
        }

        // Bind export
        Export.bindExportButton('apps-table', 'enterprise-apps');

        // Initial render
        renderAppsTable(apps);
    }

    function renderAppsTable(apps) {
        var search = Filters.getValue('apps-search') || '';
        var publisherFilter = Filters.getValue('apps-publisher');
        var statusFilter = Filters.getValue('apps-status');
        var credFilter = Filters.getValue('apps-cred');

        var filteredData = apps.filter(function(a) {
            // Search filter
            if (search) {
                var searchLower = search.toLowerCase();
                var match = (a.displayName && a.displayName.toLowerCase().indexOf(searchLower) !== -1) ||
                           (a.publisher && a.publisher.toLowerCase().indexOf(searchLower) !== -1) ||
                           (a.appId && a.appId.toLowerCase().indexOf(searchLower) !== -1);
                if (!match) return false;
            }
            // Publisher filter
            if (publisherFilter === 'microsoft' && !a.isMicrosoft) return false;
            if (publisherFilter === 'third-party' && a.isMicrosoft) return false;
            // Status filter
            if (statusFilter === 'enabled' && !a.accountEnabled) return false;
            if (statusFilter === 'disabled' && a.accountEnabled) return false;
            // Credential status filter
            if (credFilter && credFilter !== 'all' && a.credentialStatus !== credFilter) return false;
            return true;
        });

        // Get visible columns from Column Selector
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'publisher', 'accountEnabled', 'credentialStatus', 'nearestExpiryDays', 'secretCount', 'appType', '_adminLinks'
        ];

        // All column definitions
        var allColumns = [
            { key: 'displayName', label: 'Application', className: 'cell-truncate', formatter: function(v, row) {
                if (!v) return '--';
                return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Filter by this app"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
            }},
            { key: 'publisher', label: 'Publisher', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Search by publisher">' + Tables.escapeHtml(v) + '</a>';
            }},
            { key: 'accountEnabled', label: 'Status', formatter: formatStatus },
            { key: 'credentialStatus', label: 'Credentials', formatter: formatCredStatus },
            { key: 'nearestExpiryDays', label: 'Expiry', formatter: function(v, row) {
                var display = formatExpiryDays(v, row);
                if (row.displayName && v !== null && v !== undefined) {
                    return '<a href="#credential-expiry?search=' + encodeURIComponent(row.displayName) + '" class="entity-link" onclick="event.stopPropagation();" title="View credential expiry">' + display + '</a>';
                }
                return display;
            }},
            { key: 'secretCount', label: 'Secrets' },
            { key: 'certificateCount', label: 'Certs' },
            { key: 'appType', label: 'Type', formatter: formatAppType },
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (row.appId) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/appId/' + encodeURIComponent(row.appId) + '/Overview" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>';
                }
                return '--';
            }}
        ];

        // Filter to visible columns only
        var columns = allColumns.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'apps-table',
            data: filteredData,
            columns: columns,
            pageSize: 50,
            onRowClick: showAppDetails
        });
    }

    // ========================================================================
    // CREDENTIALS TAB
    // ========================================================================

    function renderCredentialsTab(container, apps) {
        // Filter to third-party apps with credentials
        var appsWithCreds = apps.filter(function(a) { return a.hasCredentials && !a.isMicrosoft; });

        container.innerHTML = '<div id="creds-filter"></div><div id="creds-table"></div>';

        Filters.createFilterBar({
            containerId: 'creds-filter',
            controls: [
                {
                    type: 'search',
                    id: 'creds-search',
                    label: 'Search',
                    placeholder: 'Search apps...'
                },
                {
                    type: 'select',
                    id: 'creds-status',
                    label: 'Credential Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'expired', label: 'Expired' },
                        { value: 'critical', label: 'Critical' },
                        { value: 'warning', label: 'Warning' },
                        { value: 'healthy', label: 'Healthy' }
                    ]
                }
            ],
            onFilter: function() { renderCredsTable(appsWithCreds); }
        });

        // Initial render
        renderCredsTable(appsWithCreds);
    }

    function renderCredsTable(appsWithCreds) {
        var search = Filters.getValue('creds-search') || '';
        var status = Filters.getValue('creds-status');

        var filtered = appsWithCreds.filter(function(a) {
            if (search && (!a.displayName || typeof a.displayName !== 'string' || a.displayName.toLowerCase().indexOf(search.toLowerCase()) === -1)) return false;
            if (status && status !== 'all' && a.credentialStatus !== status) return false;
            return true;
        });

        Tables.render({
            containerId: 'creds-table',
            data: filtered,
            columns: [
                { key: 'displayName', label: 'Application', className: 'cell-truncate', formatter: function(v, row) {
                    if (!v) return '--';
                    return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Filter by this app"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
                }},
                { key: 'publisher', label: 'Publisher', formatter: function(v) {
                    if (!v) return '--';
                    return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Search by publisher">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'credentialStatus', label: 'Status', formatter: formatCredStatus },
                { key: 'nearestExpiryDays', label: 'Expiry', formatter: function(v, row) {
                    var display = formatExpiryDays(v, row);
                    if (row.displayName && v !== null && v !== undefined) {
                        return '<a href="#credential-expiry?search=' + encodeURIComponent(row.displayName) + '" class="entity-link" onclick="event.stopPropagation();" title="View credential expiry">' + display + '</a>';
                    }
                    return display;
                }},
                { key: 'secretCount', label: 'Secrets' },
                { key: 'certificateCount', label: 'Certs' },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    if (row.appId) {
                        return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/appId/' + encodeURIComponent(row.appId) + '/Overview" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>';
                    }
                    return '--';
                }}
            ],
            pageSize: 50,
            onRowClick: showAppDetails
        });
    }

    // ========================================================================
    // THIRD-PARTY TAB
    // ========================================================================

    function renderThirdPartyTab(container, apps) {
        var thirdPartyApps = apps.filter(function(a) { return !a.isMicrosoft; });

        container.innerHTML = '<div id="tp-filter"></div><div id="tp-table"></div>';

        Filters.createFilterBar({
            containerId: 'tp-filter',
            controls: [
                {
                    type: 'search',
                    id: 'tp-search',
                    label: 'Search',
                    placeholder: 'Search apps...'
                },
                {
                    type: 'select',
                    id: 'tp-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'enabled', label: 'Active' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select',
                    id: 'tp-creds',
                    label: 'Credentials',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'with-creds', label: 'With Credentials' },
                        { value: 'no-creds', label: 'No Credentials' }
                    ]
                }
            ],
            onFilter: function() { renderTpTable(thirdPartyApps); }
        });

        // Initial render
        renderTpTable(thirdPartyApps);
    }

    function renderTpTable(thirdPartyApps) {
        var search = Filters.getValue('tp-search') || '';
        var status = Filters.getValue('tp-status');
        var creds = Filters.getValue('tp-creds');

        var filtered = thirdPartyApps.filter(function(a) {
            if (search && (!a.displayName || typeof a.displayName !== 'string' || a.displayName.toLowerCase().indexOf(search.toLowerCase()) === -1)) return false;
            if (status === 'enabled' && !a.accountEnabled) return false;
            if (status === 'disabled' && a.accountEnabled) return false;
            if (creds === 'with-creds' && !a.hasCredentials) return false;
            if (creds === 'no-creds' && a.hasCredentials) return false;
            return true;
        });

        Tables.render({
            containerId: 'tp-table',
            data: filtered,
            columns: [
                { key: 'displayName', label: 'Application', className: 'cell-truncate', formatter: function(v, row) {
                    if (!v) return '--';
                    return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Filter by this app"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
                }},
                { key: 'publisher', label: 'Publisher', formatter: function(v) {
                    if (!v) return '--';
                    return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Search by publisher">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'accountEnabled', label: 'Status', formatter: formatStatus },
                { key: 'appType', label: 'Type', formatter: formatAppType },
                { key: 'credentialStatus', label: 'Credentials', formatter: formatCredStatus },
                { key: 'nearestExpiryDays', label: 'Expiry', formatter: function(v, row) {
                    var display = formatExpiryDays(v, row);
                    if (row.displayName && v !== null && v !== undefined) {
                        return '<a href="#credential-expiry?search=' + encodeURIComponent(row.displayName) + '" class="entity-link" onclick="event.stopPropagation();" title="View credential expiry">' + display + '</a>';
                    }
                    return display;
                }},
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    if (row.appId) {
                        return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/appId/' + encodeURIComponent(row.appId) + '/Overview" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>';
                    }
                    return '--';
                }}
            ],
            pageSize: 50,
            onRowClick: showAppDetails
        });
    }

    // ========================================================================
    // DETAIL MODAL
    // ========================================================================

    function showAppDetails(app) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = app.displayName || 'Application Details';

        // Safe: data is from trusted collector scripts
        var html = '<div class="detail-grid">';

        // App Information Section
        html += '<div class="detail-section">';
        html += '<h4>Application Information</h4>';
        html += '<div class="detail-list">';
        html += '<span class="detail-label">Display Name:</span><span class="detail-value">' + escapeHtml(app.displayName || '--') + '</span>';
        html += '<span class="detail-label">App ID:</span><span class="detail-value" style="font-size: 0.8em;">' + escapeHtml(app.appId || '--') + '</span>';
        html += '<span class="detail-label">Service Principal ID:</span><span class="detail-value" style="font-size: 0.8em;">' + escapeHtml(app.id || '--') + '</span>';
        html += '<span class="detail-label">Created:</span><span class="detail-value">' + DataLoader.formatDate(app.createdDateTime) + '</span>';
        html += '<span class="detail-label">Type:</span><span class="detail-value">' + formatAppType(app.appType) + '</span>';
        html += '</div></div>';

        // Publisher & Status Section
        html += '<div class="detail-section">';
        html += '<h4>Publisher &amp; Status</h4>';
        html += '<div class="detail-list">';
        html += '<span class="detail-label">Publisher:</span><span class="detail-value">' + escapeHtml(app.publisher || '--') + '</span>';
        html += '<span class="detail-label">Microsoft App:</span><span class="detail-value">' + (app.isMicrosoft ? 'Yes' : 'No') + '</span>';
        html += '<span class="detail-label">Verified Publisher:</span><span class="detail-value">' + (app.verifiedPublisher ? escapeHtml(app.verifiedPublisher) : '<span class="text-muted">Not verified</span>') + '</span>';
        html += '<span class="detail-label">Account Status:</span><span class="detail-value">' + formatStatus(app.accountEnabled) + '</span>';
        html += '<span class="detail-label">Assignment Required:</span><span class="detail-value">' + (app.appRoleAssignmentRequired ? 'Yes' : 'No') + '</span>';
        html += '</div></div>';

        // Owners Section (only if data is available)
        if (app.owners && app.owners.length > 0) {
            html += '<div class="detail-section">';
            html += '<h4>Owners (' + app.owners.length + ')</h4>';
            html += '<div class="detail-list">';
            app.owners.forEach(function(owner) {
                html += '<span class="detail-label">' + escapeHtml(owner.displayName || 'Unknown') + '</span>';
                html += '<span class="detail-value">' + escapeHtml(owner.userPrincipalName || owner.mail || '--') + '</span>';
            });
            html += '</div></div>';
        }

        // Credential Summary Section
        html += '<div class="detail-section">';
        html += '<h4>Credential Summary</h4>';
        html += '<div class="detail-list">';
        html += '<span class="detail-label">Status:</span><span class="detail-value">' + formatCredStatus(app.credentialStatus) + '</span>';
        html += '<span class="detail-label">Nearest Expiry:</span><span class="detail-value">' + formatExpiryDays(app.nearestExpiryDays) + '</span>';
        html += '<span class="detail-label">Total Secrets:</span><span class="detail-value">' + (app.secretCount || 0) + '</span>';
        html += '<span class="detail-label">Total Certificates:</span><span class="detail-value">' + (app.certificateCount || 0) + '</span>';
        html += '</div></div>';

        // Client Secrets Section
        html += '<div class="detail-section">';
        html += '<h4>Client Secrets (' + (app.secretCount || 0) + ')</h4>';
        if (app.secrets && app.secrets.length > 0) {
            html += '<table class="detail-table"><thead><tr><th>Name</th><th>Hint</th><th>Expires</th><th>Days</th></tr></thead><tbody>';
            app.secrets.forEach(function(secret) {
                var statusClass = '';
                if (secret.daysUntilExpiry !== null) {
                    if (secret.daysUntilExpiry < 0) statusClass = 'text-critical';
                    else if (secret.daysUntilExpiry <= 7) statusClass = 'text-critical';
                    else if (secret.daysUntilExpiry <= 30) statusClass = 'text-warning';
                    else if (secret.daysUntilExpiry <= 90) statusClass = 'text-attention';
                }
                html += '<tr>';
                html += '<td>' + escapeHtml(secret.displayName || 'Unnamed') + '</td>';
                html += '<td>' + (secret.hint ? '***' + escapeHtml(secret.hint) : '--') + '</td>';
                html += '<td>' + DataLoader.formatDate(secret.endDateTime) + '</td>';
                html += '<td class="' + statusClass + '">' + (secret.daysUntilExpiry !== null ? secret.daysUntilExpiry + 'd' : '--') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        } else {
            html += '<p class="text-muted">No client secrets configured</p>';
        }
        html += '</div>';

        // Certificates Section
        html += '<div class="detail-section">';
        html += '<h4>Certificates (' + (app.certificateCount || 0) + ')</h4>';
        if (app.certificates && app.certificates.length > 0) {
            html += '<table class="detail-table"><thead><tr><th>Name</th><th>Usage</th><th>Expires</th><th>Days</th></tr></thead><tbody>';
            app.certificates.forEach(function(cert) {
                var statusClass = '';
                if (cert.daysUntilExpiry !== null) {
                    if (cert.daysUntilExpiry < 0) statusClass = 'text-critical';
                    else if (cert.daysUntilExpiry <= 7) statusClass = 'text-critical';
                    else if (cert.daysUntilExpiry <= 30) statusClass = 'text-warning';
                    else if (cert.daysUntilExpiry <= 90) statusClass = 'text-attention';
                }
                html += '<tr>';
                html += '<td>' + escapeHtml(cert.displayName || 'Unnamed') + '</td>';
                html += '<td>' + escapeHtml(cert.usage || cert.type || '--') + '</td>';
                html += '<td>' + DataLoader.formatDate(cert.endDateTime) + '</td>';
                html += '<td class="' + statusClass + '">' + (cert.daysUntilExpiry !== null ? cert.daysUntilExpiry + 'd' : '--') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        } else {
            html += '<p class="text-muted">No certificates configured</p>';
        }
        html += '</div>';

        // Notes Section (if present)
        if (app.notes) {
            html += '<div class="detail-section">';
            html += '<h4>Notes</h4>';
            html += '<p>' + app.notes + '</p>';
            html += '</div>';
        }

        html += '</div>';

        body.innerHTML = html;
        modal.classList.add('visible');
    }

    // ========================================================================
    // MAIN RENDER
    // ========================================================================

    function render(container) {
        // Safe: static HTML structure only
        container.innerHTML = [
            '<div class="page-header">',
            '    <h2 class="page-title">Enterprise Applications</h2>',
            '    <p class="page-description">Service principals, credential expiry, ownership, and application governance</p>',
            '</div>',
            '<div class="tab-bar">',
            '    <button class="tab-btn active" data-tab="overview">Overview</button>',
            '    <button class="tab-btn" data-tab="apps">All Apps</button>',
            '    <button class="tab-btn" data-tab="credentials">Credentials</button>',
            '    <button class="tab-btn" data-tab="thirdparty">Third-Party</button>',
            '</div>',
            '<div id="apps-content"></div>'
        ].join('\n');

        // Bind tab events
        container.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        // Initial render
        currentTab = 'overview';
        renderContent();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageEnterpriseApps = PageEnterpriseApps;
