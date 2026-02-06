/**
 * TenantScope - Endpoint Analytics Page
 */

const PageEndpointAnalytics = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var devices = DataLoader.getData('endpointAnalytics') || [];
        var filterConfig = { search: Filters.getValue('analytics-search'), searchFields: ['deviceName', 'userPrincipalName', 'model'], exact: {} };
        var filteredData = Filters.apply(devices, filterConfig);
        var healthFilter = Filters.getValue('analytics-health');
        if (healthFilter === 'poor') filteredData = filteredData.filter(function(d) { return d.healthScore < 50; });
        else if (healthFilter === 'fair') filteredData = filteredData.filter(function(d) { return d.healthScore >= 50 && d.healthScore < 70; });
        else if (healthFilter === 'good') filteredData = filteredData.filter(function(d) { return d.healthScore >= 70; });
        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'userPrincipalName', 'healthScore', 'startupScore', 'bootTimeSeconds', 'model'];
        var allDefs = [
            { key: 'deviceName', label: 'Device' },
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            { key: 'healthScore', label: 'Health Score', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v >= 70 ? 'badge-success' : v >= 50 ? 'badge-warning' : 'badge-critical';
                return '<span class="badge ' + cls + '">' + Math.round(v) + '</span>';
            }},
            { key: 'startupScore', label: 'Startup Score', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v >= 70 ? 'text-success' : v >= 50 ? 'text-warning' : 'text-critical';
                return '<span class="' + cls + '">' + Math.round(v) + '</span>';
            }},
            { key: 'bootTimeSeconds', label: 'Boot Time', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v <= 60 ? 'text-success' : v <= 120 ? 'text-warning' : 'text-critical';
                return '<span class="' + cls + '">' + Math.round(v) + 's</span>';
            }},
            { key: 'model', label: 'Model' }
        ];
        Tables.render({ containerId: 'analytics-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 50 });
    }

    function render(container) {
        var devices = DataLoader.getData('endpointAnalytics') || [];
        var total = devices.length;
        var avgHealth = total > 0 ? Math.round(devices.reduce(function(s, d) { return s + (d.healthScore || 0); }, 0) / total) : 0;
        var avgBoot = total > 0 ? Math.round(devices.reduce(function(s, d) { return s + (d.bootTimeSeconds || 0); }, 0) / total) : 0;
        var poorHealth = devices.filter(function(d) { return d.healthScore < 50; }).length;
        var slowBoot = devices.filter(function(d) { return d.bootTimeSeconds > 120; }).length;

        var html = '<div class="page-header"><h2>Endpoint Analytics</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + avgHealth + '</div><div class="summary-label">Avg Health Score</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + avgBoot + 's</div><div class="summary-label">Avg Boot Time</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + poorHealth + '</div><div class="summary-label">Poor Health</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + slowBoot + '</div><div class="summary-label">Slow Boot</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="analytics-search" placeholder="Search devices...">';
        html += '<select class="filter-select" id="analytics-health"><option value="all">All Health</option><option value="good">Good (70+)</option><option value="fair">Fair (50-69)</option><option value="poor">Poor (&lt;50)</option></select>';
        html += '<div id="analytics-colselector"></div></div>';
        html += '<div class="table-container" id="analytics-table"></div>';
        container.innerHTML = html;

        colSelector = new ColumnSelector({ containerId: 'analytics-colselector', columns: [
            { key: 'deviceName', label: 'Device', default: true },
            { key: 'userPrincipalName', label: 'User', default: true },
            { key: 'healthScore', label: 'Health Score', default: true },
            { key: 'startupScore', label: 'Startup Score', default: true },
            { key: 'bootTimeSeconds', label: 'Boot Time', default: true },
            { key: 'model', label: 'Model', default: true }
        ], storageKey: 'tenantscope-analytics-cols', onChange: applyFilters });

        Filters.setup('analytics-search', applyFilters);
        Filters.setup('analytics-health', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
