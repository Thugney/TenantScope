/**
 * TenantScope - Sign-In Logs Page
 */

const PageSignInLogs = (function() {
    'use strict';

    var colSelector = null;
    var currentTab = 'logs';
    var signinState = null;

    // Extract and map sign-ins from nested structure
    function extractSignIns(rawData) {
        var signIns = [];
        if (Array.isArray(rawData)) {
            signIns = rawData;
        } else if (rawData && rawData.signIns) {
            signIns = rawData.signIns;
        }
        // Normalize to UI-friendly fields while trusting collector outputs
        return signIns.map(function(s) {
            // Normalize status to lowercase for filter matching
            var statusRaw = s.status || '';
            var status = statusRaw.toLowerCase();
            if (status === 'failed') status = 'failure';
            if (!status) {
                if (s.errorCode === 0) status = 'success';
                else if (s.errorCode > 0) status = 'failure';
            }
            if (status === 'failure' && s.errorCode === 0) status = 'success';

            // Build location string from city and country when missing
            var location = s.location;
            if (!location && (s.city || s.country)) {
                location = [s.city, s.country].filter(Boolean).join(', ');
            }

            // Determine MFA status
            var mfaSatisfied = s.mfaSatisfied;
            if (mfaSatisfied === undefined && s.mfaDetail) {
                mfaSatisfied = !!s.mfaDetail.authMethod;
            }

            // Map CA status
            var caStatus = s.caStatus || s.conditionalAccessStatus;

            // Normalize risk level
            var riskLevel = (s.riskLevel || 'none').toLowerCase();

            return {
                id: s.id,
                createdDateTime: s.createdDateTime,
                userPrincipalName: s.userPrincipalName,
                userDisplayName: s.userDisplayName,
                appDisplayName: s.appDisplayName,
                status: status,
                errorCode: s.errorCode,
                failureReason: s.failureReason,
                mfaSatisfied: mfaSatisfied,
                caStatus: caStatus,
                location: location,
                ipAddress: s.ipAddress,
                riskLevel: riskLevel,
                riskState: s.riskState,
                clientAppUsed: s.clientAppUsed,
                deviceDetail: s.deviceDetail,
                isInteractive: s.isInteractive
            };
        });
    }

    function applyFilters() {
        var logs = extractSignIns(DataLoader.getData('signinLogs'));
        var filterConfig = { search: Filters.getValue('signin-search'), searchFields: ['userPrincipalName', 'userDisplayName', 'appDisplayName', 'ipAddress', 'location'], exact: {} };
        var statusFilter = Filters.getValue('signin-status');
        if (statusFilter && statusFilter !== 'all') filterConfig.exact.status = statusFilter;
        var filteredData = Filters.apply(logs, filterConfig);
        var mfaFilter = Filters.getValue('signin-mfa');
        if (mfaFilter === 'satisfied') filteredData = filteredData.filter(function(l) { return l.mfaSatisfied === true; });
        else if (mfaFilter === 'notsatisfied') filteredData = filteredData.filter(function(l) { return l.mfaSatisfied === false; });
        var riskFilter = Filters.getValue('signin-risk');
        if (riskFilter && riskFilter !== 'all') filteredData = filteredData.filter(function(l) { return l.riskLevel === riskFilter; });

        // Update summary cards with filtered counts
        updateSigninSummaryCards(filteredData, logs.length);

        renderTable(filteredData);
    }

    function updateSigninSummaryCards(filteredData, totalLogs) {
        var total = filteredData.length;
        var success = filteredData.filter(function(l) { return l.status === 'success'; }).length;
        var failure = filteredData.filter(function(l) { return l.status === 'failure'; }).length;
        var mfaCount = filteredData.filter(function(l) { return l.mfaSatisfied === true; }).length;
        var risky = filteredData.filter(function(l) { return l.riskLevel && l.riskLevel !== 'none'; }).length;

        var totalEl = document.getElementById('signin-total-value');
        var successEl = document.getElementById('signin-success-value');
        var failureEl = document.getElementById('signin-failure-value');
        var mfaEl = document.getElementById('signin-mfa-value');
        var riskyEl = document.getElementById('signin-risky-value');

        if (totalEl) totalEl.textContent = total + (total !== totalLogs ? ' / ' + totalLogs : '');
        if (successEl) successEl.textContent = success;
        if (failureEl) failureEl.textContent = failure;
        if (mfaEl) mfaEl.textContent = mfaCount;
        if (riskyEl) riskyEl.textContent = risky;
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['createdDateTime', 'userPrincipalName', 'appDisplayName', 'status', 'mfaSatisfied', 'location', 'riskLevel'];
        var allDefs = [
            { key: 'createdDateTime', label: 'Time', formatter: Tables.formatters.datetime },
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link">' + v + '</a>';
            }},
            { key: 'appDisplayName', label: 'Application', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link">' + v + '</a>';
            }},
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
            }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                var links = [];
                if (row.userId) {
                    links.push('<a href="https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(row.userId) + '/SignInActivity" target="_blank" rel="noopener" class="admin-link" title="View sign-ins in Entra">Entra</a>');
                }
                return links.length > 0 ? links.join(' ') : '--';
            }}
        ];
        Tables.render({ containerId: 'signin-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 100 });
    }

    function renderContent() {
        var container = document.getElementById('signin-content');
        if (!container || !signinState) return;
        renderLogsTab(container, signinState);
    }

    function renderLogsTab(container, state) {
        var html = '<div class="filter-bar"><input type="text" class="filter-input" id="signin-search" placeholder="Search...">';
        html += '<select class="filter-select" id="signin-status"><option value="all">All Status</option><option value="success">Success</option><option value="failure">Failure</option></select>';
        html += '<select class="filter-select" id="signin-mfa"><option value="all">All MFA</option><option value="satisfied">MFA Satisfied</option><option value="notsatisfied">MFA Not Satisfied</option></select>';
        html += '<select class="filter-select" id="signin-risk"><option value="all">All Risk</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>';
        html += '<div id="signin-colselector"></div></div>';
        html += '<div class="table-container" id="signin-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'signin-colselector',
            storageKey: 'tenantscope-signin-cols',
            allColumns: [
                { key: 'createdDateTime', label: 'Time' },
                { key: 'userPrincipalName', label: 'User' },
                { key: 'appDisplayName', label: 'Application' },
                { key: 'status', label: 'Status' },
                { key: 'mfaSatisfied', label: 'MFA' },
                { key: 'location', label: 'Location' },
                { key: 'riskLevel', label: 'Risk' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['createdDateTime', 'userPrincipalName', 'appDisplayName', 'status', 'mfaSatisfied', 'location', 'riskLevel', '_adminLinks'],
            onColumnsChanged: function() { applyFilters(); }
        });

        Filters.setup('signin-search', applyFilters);
        Filters.setup('signin-status', applyFilters);
        Filters.setup('signin-mfa', applyFilters);
        Filters.setup('signin-risk', applyFilters);
        applyFilters();
    }

    function render(container) {
        var logs = extractSignIns(DataLoader.getData('signinLogs'));
        var total = logs.length;
        var success = logs.filter(function(l) { return l.status === 'success'; }).length;
        var failure = logs.filter(function(l) { return l.status === 'failure'; }).length;
        var mfaCount = logs.filter(function(l) { return l.mfaSatisfied === true; }).length;
        var risky = logs.filter(function(l) { return l.riskLevel && l.riskLevel !== 'none'; }).length;

        signinState = {
            logs: logs,
            total: total,
            success: success,
            failure: failure,
            mfaCount: mfaCount,
            risky: risky
        };

        var html = '<div class="page-header"><h2>Sign-In Logs</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value" id="signin-total-value">' + total + '</div><div class="summary-label">Total Sign-Ins</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value" id="signin-success-value">' + success + '</div><div class="summary-label">Successful</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value" id="signin-failure-value">' + failure + '</div><div class="summary-label">Failed</div></div>';
        html += '<div class="summary-card"><div class="summary-value" id="signin-mfa-value">' + mfaCount + '</div><div class="summary-label">With MFA</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value" id="signin-risky-value">' + risky + '</div><div class="summary-label">Risky</div></div>';
        html += '</div>';

        html += '<div class="content-area" id="signin-content"></div>';
        container.innerHTML = html;

        currentTab = 'logs';
        renderContent();
    }

    return { render: render };
})();
