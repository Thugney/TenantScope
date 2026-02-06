/**
 * TenantScope - Sign-In Logs Page
 */

const PageSignInLogs = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var logs = DataLoader.getData('signinLogs') || [];
        var filterConfig = { search: Filters.getValue('signin-search'), searchFields: ['userPrincipalName', 'userDisplayName', 'appDisplayName', 'ipAddress', 'location'], exact: {} };
        var statusFilter = Filters.getValue('signin-status');
        if (statusFilter && statusFilter \!== 'all') filterConfig.exact.status = statusFilter;
        var filteredData = Filters.apply(logs, filterConfig);
        var mfaFilter = Filters.getValue('signin-mfa');
        if (mfaFilter === 'satisfied') filteredData = filteredData.filter(function(l) { return l.mfaSatisfied === true; });
        else if (mfaFilter === 'notsatisfied') filteredData = filteredData.filter(function(l) { return l.mfaSatisfied === false; });
        var riskFilter = Filters.getValue('signin-risk');
        if (riskFilter && riskFilter \!== 'all') filteredData = filteredData.filter(function(l) { return l.riskLevel === riskFilter; });
        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['createdDateTime', 'userPrincipalName', 'appDisplayName', 'status', 'mfaSatisfied', 'location', 'riskLevel'];
        var allDefs = [
            { key: 'createdDateTime', label: 'Time', formatter: Tables.formatters.datetime },
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            { key: 'appDisplayName', label: 'Application' },
            { key: 'status', label: 'Status', formatter: function(v) {
                var statuses = { 'success': 'badge-success', 'failure': 'badge-critical', 'interrupted': 'badge-warning' };
                return '<span class="badge ' + (statuses[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'mfaSatisfied', label: 'MFA', formatter: function(v) {
                return v === true ? '<span class="text-success">Yes</span>' : '<span class="text-critical">No</span>';
            }},
            { key: 'caStatus', label: 'CA Result', formatter: function(v) {
                var statuses = { 'success': 'badge-success', 'failure': 'badge-critical', 'notApplied': 'badge-neutral' };
                return '<span class="badge ' + (statuses[v] || 'badge-neutral') + '">' + (v || '--') + '</span>';
            }},
            { key: 'location', label: 'Location' },
            { key: 'ipAddress', label: 'IP Address' },
            { key: 'riskLevel', label: 'Risk', formatter: function(v) {
                var risks = { 'high': 'badge-critical', 'medium': 'badge-warning', 'low': 'badge-info', 'none': 'badge-success' };
                return '<span class="badge ' + (risks[v] || 'badge-neutral') + '">' + (v || 'None') + '</span>';
            }}
        ];
        Tables.render({ containerId: 'signin-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) \!== -1; }), pageSize: 100 });
    }

    function render(container) {
        var logs = DataLoader.getData('signinLogs') || [];
        var total = logs.length;
        var success = logs.filter(function(l) { return l.status === 'success'; }).length;
        var failure = logs.filter(function(l) { return l.status === 'failure'; }).length;
        var mfaCount = logs.filter(function(l) { return l.mfaSatisfied === true; }).length;
        var risky = logs.filter(function(l) { return l.riskLevel && l.riskLevel \!== 'none'; }).length;

        var html = '<div class="page-header"><h2>Sign-In Logs</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Sign-Ins</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + success + '</div><div class="summary-label">Successful</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + failure + '</div><div class="summary-label">Failed</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + mfaCount + '</div><div class="summary-label">With MFA</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + risky + '</div><div class="summary-label">Risky</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="signin-search" placeholder="Search...">';
        html += '<select class="filter-select" id="signin-status"><option value="all">All Status</option><option value="success">Success</option><option value="failure">Failure</option></select>';
        html += '<select class="filter-select" id="signin-mfa"><option value="all">All MFA</option><option value="satisfied">MFA Satisfied</option><option value="notsatisfied">MFA Not Satisfied</option></select>';
        html += '<select class="filter-select" id="signin-risk"><option value="all">All Risk</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>';
        html += '<div id="signin-colselector"></div></div>';
        html += '<div class="table-container" id="signin-table"></div>';
        container.innerHTML = html;

        colSelector = new ColumnSelector({ containerId: 'signin-colselector', columns: [
            { key: 'createdDateTime', label: 'Time', default: true },
            { key: 'userPrincipalName', label: 'User', default: true },
            { key: 'appDisplayName', label: 'Application', default: true },
            { key: 'status', label: 'Status', default: true },
            { key: 'mfaSatisfied', label: 'MFA', default: true },
            { key: 'location', label: 'Location', default: true },
            { key: 'riskLevel', label: 'Risk', default: true }
        ], storageKey: 'tenantscope-signin-cols', onChange: applyFilters });

        Filters.setup('signin-search', applyFilters);
        Filters.setup('signin-status', applyFilters);
        Filters.setup('signin-mfa', applyFilters);
        Filters.setup('signin-risk', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
