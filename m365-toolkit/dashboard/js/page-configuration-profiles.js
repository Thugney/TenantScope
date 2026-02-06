/**
 * TenantScope - Configuration Profiles Page
 */

const PageConfigurationProfiles = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var profiles = DataLoader.getData('configurationProfiles') || [];
        var filterConfig = {
            search: Filters.getValue('profiles-search'),
            searchFields: ['displayName', 'description', 'platform', 'profileType'],
            exact: {}
        };
        var platformFilter = Filters.getValue('profiles-platform');
        if (platformFilter && platformFilter \!== 'all') filterConfig.exact.platform = platformFilter;
        var typeFilter = Filters.getValue('profiles-type');
        if (typeFilter && typeFilter \!== 'all') filterConfig.exact.profileType = typeFilter;
        renderTable(Filters.apply(profiles, filterConfig));
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'profileType', 'platform', 'assignedCount', 'successCount', 'errorCount', 'lastModified'];
        var allDefs = [
            { key: 'displayName', label: 'Profile Name' },
            { key: 'profileType', label: 'Type', formatter: function(v) { return '<span class="badge badge-info">' + (v || 'Unknown') + '</span>'; } },
            { key: 'platform', label: 'Platform', formatter: function(v) { return '<span class="badge badge-neutral">' + (v || 'Unknown') + '</span>'; } },
            { key: 'assignedCount', label: 'Assigned' },
            { key: 'successCount', label: 'Success', formatter: function(v) { return '<span class="text-success">' + (v || 0) + '</span>'; } },
            { key: 'errorCount', label: 'Errors', formatter: function(v) { return v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>'; } },
            { key: 'lastModified', label: 'Last Modified', formatter: Tables.formatters.date }
        ];
        Tables.render({ containerId: 'profiles-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) \!== -1; }), pageSize: 50 });
    }

    function render(container) {
        var profiles = DataLoader.getData('configurationProfiles') || [];
        var totalProfiles = profiles.length;
        var totalSuccess = profiles.reduce(function(s, p) { return s + (p.successCount || 0); }, 0);
        var totalErrors = profiles.reduce(function(s, p) { return s + (p.errorCount || 0); }, 0);

        var platforms = {}, types = {};
        profiles.forEach(function(p) { platforms[p.platform || 'Unknown'] = 1; types[p.profileType || 'Unknown'] = 1; });

        var html = '<div class="page-header"><h2>Configuration Profiles</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + totalProfiles + '</div><div class="summary-label">Total Profiles</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + totalSuccess + '</div><div class="summary-label">Success</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + totalErrors + '</div><div class="summary-label">Errors</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="profiles-search" placeholder="Search profiles...">';
        html += '<select class="filter-select" id="profiles-platform"><option value="all">All Platforms</option>';
        Object.keys(platforms).forEach(function(p) { html += '<option value="' + p + '">' + p + '</option>'; });
        html += '</select><select class="filter-select" id="profiles-type"><option value="all">All Types</option>';
        Object.keys(types).forEach(function(t) { html += '<option value="' + t + '">' + t + '</option>'; });
        html += '</select><div id="profiles-colselector"></div></div>';
        html += '<div class="table-container" id="profiles-table"></div>';
        container.innerHTML = html;

        colSelector = new ColumnSelector({ containerId: 'profiles-colselector', columns: [
            { key: 'displayName', label: 'Profile Name', default: true },
            { key: 'profileType', label: 'Type', default: true },
            { key: 'platform', label: 'Platform', default: true },
            { key: 'successCount', label: 'Success', default: true },
            { key: 'errorCount', label: 'Errors', default: true }
        ], storageKey: 'tenantscope-profiles-cols', onChange: applyFilters });

        Filters.setup('profiles-search', applyFilters);
        Filters.setup('profiles-platform', applyFilters);
        Filters.setup('profiles-type', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
