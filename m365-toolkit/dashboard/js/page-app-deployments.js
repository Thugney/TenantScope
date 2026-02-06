/**
 * TenantScope - App Deployments Page
 */

const PageAppDeployments = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var apps = DataLoader.getData('appDeployments') || [];
        var filterConfig = { search: Filters.getValue('apps-search'), searchFields: ['displayName', 'publisher', 'appType'], exact: {} };
        var typeFilter = Filters.getValue('apps-type');
        if (typeFilter && typeFilter \!== 'all') filterConfig.exact.appType = typeFilter;
        var filteredData = Filters.apply(apps, filterConfig);
        var statusFilter = Filters.getValue('apps-status');
        if (statusFilter === 'failing') filteredData = filteredData.filter(function(a) { return a.failedCount > 0; });
        else if (statusFilter === 'pending') filteredData = filteredData.filter(function(a) { return a.pendingCount > 0; });
        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'appType', 'publisher', 'assignedCount', 'installedCount', 'failedCount', 'installRate'];
        var allDefs = [
            { key: 'displayName', label: 'App Name' },
            { key: 'appType', label: 'Type', formatter: function(v) { return '<span class="badge badge-info">' + (v || 'Unknown') + '</span>'; }},
            { key: 'publisher', label: 'Publisher' },
            { key: 'assignedCount', label: 'Assigned' },
            { key: 'installedCount', label: 'Installed', formatter: function(v) { return '<span class="text-success">' + (v || 0) + '</span>'; }},
            { key: 'failedCount', label: 'Failed', formatter: function(v) { return v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>'; }},
            { key: 'installRate', label: 'Install Rate', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var pct = Math.round(v);
                var cls = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-critical';
                return '<span class="' + cls + '">' + pct + '%</span>';
            }}
        ];
        Tables.render({ containerId: 'apps-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) \!== -1; }), pageSize: 50 });
    }

    function render(container) {
        var apps = DataLoader.getData('appDeployments') || [];
        var totalApps = apps.length;
        var totalInstalled = apps.reduce(function(s, a) { return s + (a.installedCount || 0); }, 0);
        var totalFailed = apps.reduce(function(s, a) { return s + (a.failedCount || 0); }, 0);
        var appsWithFailures = apps.filter(function(a) { return a.failedCount > 0; }).length;

        var types = {};
        apps.forEach(function(a) { types[a.appType || 'Unknown'] = 1; });

        var html = '<div class="page-header"><h2>App Deployments</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + totalApps + '</div><div class="summary-label">Total Apps</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + totalInstalled + '</div><div class="summary-label">Installed</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + totalFailed + '</div><div class="summary-label">Failed</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + appsWithFailures + '</div><div class="summary-label">Apps with Failures</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="apps-search" placeholder="Search apps...">';
        html += '<select class="filter-select" id="apps-type"><option value="all">All Types</option>';
        Object.keys(types).forEach(function(t) { html += '<option value="' + t + '">' + t + '</option>'; });
        html += '</select><select class="filter-select" id="apps-status"><option value="all">All Status</option><option value="failing">With Failures</option><option value="pending">With Pending</option></select>';
        html += '<div id="apps-colselector"></div></div>';
        html += '<div class="table-container" id="apps-table"></div>';
        container.innerHTML = html;

        colSelector = new ColumnSelector({ containerId: 'apps-colselector', columns: [
            { key: 'displayName', label: 'App Name', default: true },
            { key: 'appType', label: 'Type', default: true },
            { key: 'publisher', label: 'Publisher', default: true },
            { key: 'assignedCount', label: 'Assigned', default: true },
            { key: 'installedCount', label: 'Installed', default: true },
            { key: 'failedCount', label: 'Failed', default: true },
            { key: 'installRate', label: 'Install Rate', default: true }
        ], storageKey: 'tenantscope-apps-cols', onChange: applyFilters });

        Filters.setup('apps-search', applyFilters);
        Filters.setup('apps-type', applyFilters);
        Filters.setup('apps-status', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
