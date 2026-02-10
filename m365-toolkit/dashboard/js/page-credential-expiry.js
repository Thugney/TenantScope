/**
 * TenantScope - Credential Expiry Page
 */

const PageCredentialExpiry = (function() {
    'use strict';

    var colSelector = null;
    var currentTab = 'credentials';
    var credState = null;

    // Extract flat credentials from nested structure
    function extractCredentials(rawData) {
        if (Array.isArray(rawData)) return rawData;
        if (!rawData || !rawData.applications) return [];
        var creds = [];
        rawData.applications.forEach(function(app) {
            (app.secrets || []).forEach(function(s) {
                creds.push({
                    appDisplayName: app.displayName,
                    appId: app.appId || app.id,
                    credentialType: 'secret',
                    status: s.status,
                    daysUntilExpiry: s.daysUntilExpiry,
                    expiryDate: s.endDateTime
                });
            });
            (app.certificates || []).forEach(function(c) {
                creds.push({
                    appDisplayName: app.displayName,
                    appId: app.appId || app.id,
                    credentialType: 'certificate',
                    status: c.status,
                    daysUntilExpiry: c.daysUntilExpiry,
                    expiryDate: c.endDateTime
                });
            });
        });
        return creds;
    }

    function applyFilters() {
        var creds = extractCredentials(DataLoader.getData('servicePrincipalSecrets'));
        var filterConfig = { search: Filters.getValue('creds-search'), searchFields: ['appDisplayName', 'credentialType'], exact: {} };
        var typeFilter = Filters.getValue('creds-type');
        if (typeFilter && typeFilter !== 'all') filterConfig.exact.credentialType = typeFilter;
        var filteredData = Filters.apply(creds, filterConfig);
        var statusFilter = Filters.getValue('creds-status');
        if (statusFilter && statusFilter !== 'all') filteredData = filteredData.filter(function(c) { return c.status === statusFilter; });
        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['appDisplayName', 'credentialType', 'status', 'daysUntilExpiry', 'expiryDate'];
        var allDefs = [
            { key: 'appDisplayName', label: 'Application', formatter: function(v, row) {
                var name = v || 'Unknown';
                return '<a href="#enterprise-apps?search=' + encodeURIComponent(name) + '" class="entity-link"><strong>' + name + '</strong></a>';
            }},
            { key: 'credentialType', label: 'Type', formatter: function(v) {
                return v === 'secret' ? '<span class="badge badge-warning">Secret</span>' : '<span class="badge badge-info">Certificate</span>';
            }},
            { key: 'status', label: 'Status', formatter: function(v) {
                var statuses = { 'expired': 'badge-critical', 'critical': 'badge-critical', 'warning': 'badge-warning', 'healthy': 'badge-success' };
                return '<span class="badge ' + (statuses[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'daysUntilExpiry', label: 'Days Left', formatter: function(v) {
                if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
                var numVal = Number(v);
                var cls = numVal < 0 ? 'text-critical font-bold' : numVal <= 30 ? 'text-critical' : numVal <= 60 ? 'text-warning' : 'text-success';
                return '<span class="' + cls + '">' + numVal + '</span>';
            }},
            { key: 'expiryDate', label: 'Expiry Date', formatter: Tables.formatters.date },
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (row.appId) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/appId/' + encodeURIComponent(row.appId) + '/Credentials" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>';
                }
                return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade/~/All" target="_blank" rel="noopener" class="admin-link" title="Open App Registrations">Entra</a>';
            }}
        ];
        Tables.render({ containerId: 'creds-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 50 });
    }

    function renderContent() {
        var container = document.getElementById('creds-content');
        if (!container || !credState) return;
        renderCredentialsTab(container, credState);
    }


    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = document.createElement('div');
        card.className = 'analytics-card';
        var h4 = document.createElement('h4');
        h4.textContent = title;
        card.appendChild(h4);
        var list = document.createElement('div');
        list.className = 'platform-list';
        rows.forEach(function(row) {
            var rowDiv = document.createElement('div');
            rowDiv.className = 'platform-row';
            var name = document.createElement('span');
            name.className = 'platform-name';
            name.textContent = row.name;
            rowDiv.appendChild(name);
            var policies = document.createElement('span');
            policies.className = 'platform-policies';
            policies.textContent = row.count;
            rowDiv.appendChild(policies);
            var miniBar = document.createElement('div');
            miniBar.className = 'mini-bar';
            var fill = document.createElement('div');
            fill.className = 'mini-bar-fill ' + row.cls;
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            var rate = document.createElement('span');
            rate.className = 'platform-rate';
            rate.textContent = row.showCount ? row.count : (row.pct + '%');
            rowDiv.appendChild(rate);
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = document.createElement('div');
        card.className = 'insight-card insight-' + type;
        var header = document.createElement('div');
        header.className = 'insight-header';
        var badgeSpan = document.createElement('span');
        badgeSpan.className = 'badge badge-' + type;
        badgeSpan.textContent = badge;
        header.appendChild(badgeSpan);
        var catSpan = document.createElement('span');
        catSpan.className = 'insight-category';
        catSpan.textContent = category;
        header.appendChild(catSpan);
        card.appendChild(header);
        var descP = document.createElement('p');
        descP.className = 'insight-description';
        descP.textContent = description;
        card.appendChild(descP);
        if (action) {
            var actionP = document.createElement('p');
            actionP.className = 'insight-action';
            var strong = document.createElement('strong');
            strong.textContent = 'Action: ';
            actionP.appendChild(strong);
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    function renderCredentialsTab(container, state) {
        var html = '<div class="filter-bar"><input type="text" class="filter-input" id="creds-search" placeholder="Search applications...">';
        html += '<select class="filter-select" id="creds-type"><option value="all">All Types</option><option value="secret">Secrets</option><option value="certificate">Certificates</option></select>';
        html += '<select class="filter-select" id="creds-status"><option value="all">All Statuses</option><option value="expired">Expired</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>';
        html += '<div id="creds-colselector"></div></div>';
        html += '<div class="table-container" id="creds-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'creds-colselector',
            storageKey: 'tenantscope-creds-cols',
            allColumns: [
                { key: 'appDisplayName', label: 'Application' },
                { key: 'credentialType', label: 'Type' },
                { key: 'status', label: 'Status' },
                { key: 'daysUntilExpiry', label: 'Days Left' },
                { key: 'expiryDate', label: 'Expiry Date' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['appDisplayName', 'credentialType', 'status', 'daysUntilExpiry', 'expiryDate', '_adminLinks'],
            onColumnsChanged: function() { applyFilters(); }
        });

        Filters.setup('creds-search', applyFilters);
        Filters.setup('creds-type', applyFilters);
        Filters.setup('creds-status', applyFilters);
        applyFilters();
    }

    function render(container) {
        var creds = extractCredentials(DataLoader.getData('servicePrincipalSecrets'));
        var total = creds.length;
        var expired = creds.filter(function(c) { return c.status === 'expired'; }).length;
        var critical = creds.filter(function(c) { return c.status === 'critical'; }).length;
        var warning = creds.filter(function(c) { return c.status === 'warning'; }).length;
        var healthy = creds.filter(function(c) { return c.status === 'healthy'; }).length;

        credState = {
            creds: creds,
            total: total,
            expired: expired,
            critical: critical,
            warning: warning,
            healthy: healthy
        };

        var html = '<div class="page-header"><h2>Credential Expiry</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Credentials</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + expired + '</div><div class="summary-label">Expired</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + critical + '</div><div class="summary-label">Critical</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + warning + '</div><div class="summary-label">Warning</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + healthy + '</div><div class="summary-label">Healthy</div></div>';
        html += '</div>';

        html += '<div class="content-area" id="creds-content"></div>';
        container.innerHTML = html;

        currentTab = 'credentials';
        renderContent();
    }

    return { render: render };
})();
