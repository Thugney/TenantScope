/**
 * TenantScope - Compliance Policies Page
 * Author: Robel (https://github.com/Thugney)
 */

const PageCompliancePolicies = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var policies = DataLoader.getData('compliancePolicies') || [];
        var filterConfig = {
            search: Filters.getValue('compliance-search'),
            searchFields: ['displayName', 'description', 'platform'],
            exact: {}
        };

        var platformFilter = Filters.getValue('compliance-platform');
        if (platformFilter && platformFilter \!== 'all') {
            filterConfig.exact.platform = platformFilter;
        }

        var filteredData = Filters.apply(policies, filterConfig);

        var assignmentFilter = Filters.getValue('compliance-assignment');
        if (assignmentFilter && assignmentFilter \!== 'all') {
            if (assignmentFilter === 'assigned') {
                filteredData = filteredData.filter(function(p) { return p.assignedCount > 0; });
            } else if (assignmentFilter === 'unassigned') {
                filteredData = filteredData.filter(function(p) { return p.assignedCount === 0; });
            }
        }

        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'platform', 'assignedCount', 'compliantCount', 'nonCompliantCount', 'complianceRate', 'lastModified'];

        var allDefs = [
            { key: 'displayName', label: 'Policy Name' },
            { key: 'description', label: 'Description', className: 'cell-truncate' },
            { key: 'platform', label: 'Platform', formatter: formatPlatform },
            { key: 'assignedCount', label: 'Assigned' },
            { key: 'compliantCount', label: 'Compliant', formatter: formatCompliant },
            { key: 'nonCompliantCount', label: 'Non-Compliant', formatter: formatNonCompliant },
            { key: 'complianceRate', label: 'Compliance %', formatter: formatComplianceRate },
            { key: 'lastModified', label: 'Last Modified', formatter: Tables.formatters.date }
        ];

        Tables.render({
            containerId: 'compliance-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) \!== -1; }),
            pageSize: 50,
            onRowClick: showPolicyDetails
        });
    }

    function formatPlatform(value) {
        var label = value || 'Unknown';
        if (label.startsWith('windows')) label = 'Windows';
        return '<span class="badge badge-info">' + label + '</span>';
    }

    function formatCompliant(value) {
        return value ? '<span class="text-success">' + value + '</span>' : '<span class="text-muted">0</span>';
    }

    function formatNonCompliant(value) {
        return value ? '<span class="text-critical font-bold">' + value + '</span>' : '<span class="text-muted">0</span>';
    }

    function formatComplianceRate(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var pct = Math.round(value);
        var cls = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + pct + '%</span>';
    }

    function showPolicyDetails(policy) {
        document.getElementById('modal-title').textContent = policy.displayName || 'Policy Details';
        var html = '<div class="detail-grid"><div class="detail-section"><h4>Policy Information</h4><dl class="detail-list">';
        html += '<dt>Name</dt><dd>' + (policy.displayName || '--') + '</dd>';
        html += '<dt>Platform</dt><dd>' + (policy.platform || '--') + '</dd>';
        html += '</dl></div><div class="detail-section"><h4>Compliance Status</h4><dl class="detail-list">';
        html += '<dt>Compliant</dt><dd class="text-success">' + (policy.compliantCount || 0) + '</dd>';
        html += '<dt>Non-Compliant</dt><dd class="text-critical">' + (policy.nonCompliantCount || 0) + '</dd>';
        html += '</dl></div></div>';
        document.getElementById('modal-body').innerHTML = html;
        document.getElementById('modal-overlay').classList.add('visible');
    }

    function render(container) {
        var policies = DataLoader.getData('compliancePolicies') || [];
        var totalPolicies = policies.length;
        var totalCompliant = policies.reduce(function(sum, p) { return sum + (p.compliantCount || 0); }, 0);
        var totalNonCompliant = policies.reduce(function(sum, p) { return sum + (p.nonCompliantCount || 0); }, 0);

        var platforms = {};
        policies.forEach(function(p) { platforms[p.platform || 'Unknown'] = (platforms[p.platform || 'Unknown'] || 0) + 1; });

        var html = '<div class="page-header"><h2>Compliance Policies</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + totalPolicies + '</div><div class="summary-label">Total Policies</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + totalCompliant + '</div><div class="summary-label">Compliant</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + totalNonCompliant + '</div><div class="summary-label">Non-Compliant</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="compliance-search" placeholder="Search policies...">';
        html += '<select class="filter-select" id="compliance-platform"><option value="all">All Platforms</option>';
        Object.keys(platforms).forEach(function(p) { html += '<option value="' + p + '">' + p + '</option>'; });
        html += '</select><select class="filter-select" id="compliance-assignment"><option value="all">All</option><option value="assigned">Assigned</option></select>';
        html += '<div id="compliance-colselector"></div></div>';
        html += '<div class="table-container" id="compliance-table"></div>';
        container.innerHTML = html;

        colSelector = new ColumnSelector({
            containerId: 'compliance-colselector',
            columns: [
                { key: 'displayName', label: 'Policy Name', default: true },
                { key: 'platform', label: 'Platform', default: true },
                { key: 'assignedCount', label: 'Assigned', default: true },
                { key: 'compliantCount', label: 'Compliant', default: true },
                { key: 'nonCompliantCount', label: 'Non-Compliant', default: true },
                { key: 'complianceRate', label: 'Compliance %', default: true }
            ],
            storageKey: 'tenantscope-compliance-cols',
            onChange: applyFilters
        });

        Filters.setup('compliance-search', applyFilters);
        Filters.setup('compliance-platform', applyFilters);
        Filters.setup('compliance-assignment', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
