/**
 * TenantScope - Credential Expiry Page
 */

const PageCredentialExpiry = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var creds = DataLoader.getData('servicePrincipalSecrets') || [];
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
            { key: 'appDisplayName', label: 'Application' },
            { key: 'credentialType', label: 'Type', formatter: function(v) {
                return v === 'secret' ? '<span class="badge badge-warning">Secret</span>' : '<span class="badge badge-info">Certificate</span>';
            }},
            { key: 'status', label: 'Status', formatter: function(v) {
                var statuses = { 'expired': 'badge-critical', 'critical': 'badge-critical', 'warning': 'badge-warning', 'healthy': 'badge-success' };
                return '<span class="badge ' + (statuses[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'daysUntilExpiry', label: 'Days Left', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v < 0 ? 'text-critical font-bold' : v <= 30 ? 'text-critical' : v <= 60 ? 'text-warning' : 'text-success';
                return '<span class="' + cls + '">' + v + '</span>';
            }},
            { key: 'expiryDate', label: 'Expiry Date', formatter: Tables.formatters.date }
        ];
        Tables.render({ containerId: 'creds-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 50 });
    }

    function render(container) {
        var creds = DataLoader.getData('servicePrincipalSecrets') || [];
        var total = creds.length;
        var expired = creds.filter(function(c) { return c.status === 'expired'; }).length;
        var critical = creds.filter(function(c) { return c.status === 'critical'; }).length;
        var warning = creds.filter(function(c) { return c.status === 'warning'; }).length;
        var healthy = creds.filter(function(c) { return c.status === 'healthy'; }).length;

        var html = '<div class="page-header"><h2>Credential Expiry</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Credentials</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + expired + '</div><div class="summary-label">Expired</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + critical + '</div><div class="summary-label">Critical</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + warning + '</div><div class="summary-label">Warning</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + healthy + '</div><div class="summary-label">Healthy</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="creds-search" placeholder="Search applications...">';
        html += '<select class="filter-select" id="creds-type"><option value="all">All Types</option><option value="secret">Secrets</option><option value="certificate">Certificates</option></select>';
        html += '<select class="filter-select" id="creds-status"><option value="all">All Statuses</option><option value="expired">Expired</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>';
        html += '<div id="creds-colselector"></div></div>';
        html += '<div class="table-container" id="creds-table"></div>';
        container.innerHTML = html;

        colSelector = new ColumnSelector({ containerId: 'creds-colselector', columns: [
            { key: 'appDisplayName', label: 'Application', default: true },
            { key: 'credentialType', label: 'Type', default: true },
            { key: 'status', label: 'Status', default: true },
            { key: 'daysUntilExpiry', label: 'Days Left', default: true },
            { key: 'expiryDate', label: 'Expiry Date', default: true }
        ], storageKey: 'tenantscope-creds-cols', onChange: applyFilters });

        Filters.setup('creds-search', applyFilters);
        Filters.setup('creds-type', applyFilters);
        Filters.setup('creds-status', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
