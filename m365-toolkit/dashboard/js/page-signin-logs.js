/**
 * TenantScope - Sign-In Logs Page
 */

const PageSignInLogs = (function() {
    'use strict';

    var colSelector = null;
    var currentTab = 'overview';
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
        Tables.render({ containerId: 'signin-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 100 });
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('signin-content');
        if (!container || !signinState) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, signinState);
                break;
            case 'logs':
                renderLogsTab(container, signinState);
                break;
        }
    }

    function renderOverview(container, state) {
        var logs = state.logs;
        var total = state.total;

        // Calculate breakdowns
        var interrupted = logs.filter(function(l) { return l.status === 'interrupted'; }).length;
        var high = logs.filter(function(l) { return l.riskLevel === 'high'; }).length;
        var medium = logs.filter(function(l) { return l.riskLevel === 'medium'; }).length;
        var low = logs.filter(function(l) { return l.riskLevel === 'low'; }).length;
        var noRisk = total - high - medium - low;

        // App breakdown
        var appBreakdown = {};
        logs.forEach(function(l) {
            var app = l.appDisplayName || 'Unknown';
            if (!appBreakdown[app]) appBreakdown[app] = { total: 0, failed: 0 };
            appBreakdown[app].total++;
            if (l.status === 'failure') appBreakdown[app].failed++;
        });

        var successPct = total > 0 ? Math.round((state.success / total) * 100) : 0;
        var successClass = successPct >= 95 ? 'text-success' : successPct >= 80 ? 'text-warning' : 'text-critical';

        var html = '';

        // Sign-In Overview Section
        html += '<div class="analytics-section">';
        html += '<h3>Sign-In Overview</h3>';
        html += '<div class="compliance-overview">';

        // Donut chart for success rate
        var radius = 40;
        var circumference = 2 * Math.PI * radius;
        var totalForChart = state.success + state.failure + interrupted;
        var successDash = totalForChart > 0 ? (state.success / totalForChart) * circumference : 0;
        var failureDash = totalForChart > 0 ? (state.failure / totalForChart) * circumference : 0;
        var interruptedDash = totalForChart > 0 ? (interrupted / totalForChart) * circumference : 0;

        html += '<div class="compliance-chart">';
        html += '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        var offset = 0;
        if (state.success > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-success)" stroke-width="10" stroke-dasharray="' + successDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += successDash;
        }
        if (state.failure > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-critical)" stroke-width="10" stroke-dasharray="' + failureDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += failureDash;
        }
        if (interrupted > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-warning)" stroke-width="10" stroke-dasharray="' + interruptedDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value ' + successClass + '">' + successPct + '%</span><span class="donut-label">Success Rate</span></div>';
        html += '</div></div>';

        // Legend
        html += '<div class="compliance-legend">';
        html += '<div class="legend-item"><span class="legend-dot bg-success"></span> Successful: <strong>' + state.success + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Failed: <strong>' + state.failure + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Interrupted: <strong>' + interrupted + '</strong></div>';
        html += '<div class="legend-item">Risky: <strong>' + (high + medium) + '</strong></div>';
        html += '</div></div></div>';

        // Analytics Grid with platform-list pattern
        html += '<div class="analytics-grid">';

        // Sign-In Status with mini-bars
        html += '<div class="analytics-card"><h4>Sign-In Status</h4>';
        html += '<div class="platform-list">';
        var statuses = [
            { label: 'Successful', count: state.success, color: 'bg-success' },
            { label: 'Failed', count: state.failure, color: 'bg-critical' },
            { label: 'Interrupted', count: interrupted, color: 'bg-warning' }
        ];
        statuses.forEach(function(s) {
            var pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + s.label + '</span>';
            html += '<span class="platform-policies">' + s.count + '</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill ' + s.color + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Risk Distribution with mini-bars
        html += '<div class="analytics-card"><h4>Risk Levels</h4>';
        html += '<div class="platform-list">';
        var risks = [
            { label: 'High Risk', count: high, color: 'bg-critical' },
            { label: 'Medium Risk', count: medium, color: 'bg-warning' },
            { label: 'Low Risk', count: low, color: 'bg-info' },
            { label: 'No Risk', count: noRisk, color: 'bg-success' }
        ];
        risks.forEach(function(r) {
            var pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + r.label + '</span>';
            html += '<span class="platform-policies">' + r.count + '</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill ' + r.color + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // MFA Status
        var mfaPct = total > 0 ? Math.round((state.mfaCount / total) * 100) : 0;
        var noMfaCount = Math.max(total - state.mfaCount, 0);
        var noMfaPct = total > 0 ? Math.round((noMfaCount / total) * 100) : 0;
        html += '<div class="analytics-card"><h4>MFA Satisfaction</h4>';
        html += '<div class="platform-list">';
        html += '<div class="platform-row"><span class="platform-name">MFA Satisfied</span><span class="platform-policies">' + state.mfaCount + '</span>';
        html += '<div class="mini-bar"><div class="mini-bar-fill bg-success" style="width:' + mfaPct + '%"></div></div><span class="platform-rate">' + mfaPct + '%</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Not Satisfied</span><span class="platform-policies">' + noMfaCount + '</span>';
        html += '<div class="mini-bar"><div class="mini-bar-fill bg-critical" style="width:' + noMfaPct + '%"></div></div><span class="platform-rate">' + noMfaPct + '%</span></div>';
        html += '</div></div>';

        // Top Applications with mini-bars
        html += '<div class="analytics-card"><h4>Top Applications</h4>';
        html += '<div class="platform-list">';
        var appKeys = Object.keys(appBreakdown).sort(function(a, b) {
            return appBreakdown[b].total - appBreakdown[a].total;
        }).slice(0, 5);
        appKeys.forEach(function(app) {
            var a = appBreakdown[app];
            var pct = total > 0 ? Math.round((a.total / total) * 100) : 0;
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + app + '</span>';
            html += '<span class="platform-policies">' + a.total + '</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill bg-info" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        html += '</div>'; // end analytics-grid

        // Insight Cards for issues
        var hasIssues = high > 0 || state.failure > 5 || mfaPct < 80;
        if (hasIssues) {
            html += '<div class="analytics-section"><h3>Issues Needing Attention</h3>';
            html += '<div class="insights-list">';

            if (high > 0) {
                html += '<div class="insight-card insight-critical">';
                html += '<div class="insight-header"><span class="badge badge-critical">HIGH</span><span class="insight-category">Risky Sign-ins</span></div>';
                html += '<p class="insight-description">' + high + ' high risk sign-in' + (high > 1 ? 's' : '') + ' detected. These may indicate account compromise.</p>';
                html += '<p class="insight-action"><strong>Action:</strong> Review affected users, reset passwords, and investigate sign-in locations.</p>';
                html += '</div>';
            }

            if (state.failure > 5) {
                html += '<div class="insight-card insight-warning">';
                html += '<div class="insight-header"><span class="badge badge-warning">MEDIUM</span><span class="insight-category">Failed Sign-ins</span></div>';
                html += '<p class="insight-description">' + state.failure + ' failed sign-in' + (state.failure > 1 ? 's' : '') + ' in this period. High failure rates may indicate issues.</p>';
                html += '<p class="insight-action"><strong>Action:</strong> Check for password issues, lockouts, or Conditional Access blocks.</p>';
                html += '</div>';
            }

            if (mfaPct < 80) {
                html += '<div class="insight-card insight-info">';
                html += '<div class="insight-header"><span class="badge badge-info">INFO</span><span class="insight-category">MFA Coverage</span></div>';
                html += '<p class="insight-description">Only ' + mfaPct + '% of sign-ins had MFA satisfied. Consider strengthening MFA policies.</p>';
                html += '<p class="insight-action"><strong>Action:</strong> Review Conditional Access policies and MFA registration status.</p>';
                html += '</div>';
            }

            html += '</div></div>';
        }

        // Risky Sign-Ins Table
        var riskySignins = logs.filter(function(l) { return l.riskLevel === 'high' || l.riskLevel === 'medium'; });
        if (riskySignins.length > 0) {
            html += '<div class="analytics-section"><h3>Risky Sign-Ins (' + riskySignins.length + ')</h3>';
            html += '<div id="risky-signins-table"></div></div>';
        }

        container.innerHTML = html;

        // Render risky sign-ins table
        if (riskySignins.length > 0) {
            Tables.render({
                containerId: 'risky-signins-table',
                data: riskySignins.slice(0, 10),
                columns: [
                    { key: 'createdDateTime', label: 'Time', formatter: Tables.formatters.datetime },
                    { key: 'userPrincipalName', label: 'User', className: 'cell-truncate', formatter: function(v) {
                        if (!v) return '--';
                        return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link">' + v + '</a>';
                    }},
                    { key: 'appDisplayName', label: 'Application' },
                    { key: 'riskLevel', label: 'Risk', formatter: function(v) {
                        var cls = v === 'high' ? 'badge-critical' : 'badge-warning';
                        return '<span class="badge ' + cls + '">' + v + '</span>';
                    }},
                    { key: 'location', label: 'Location' }
                ],
                pageSize: 10
            });
        }

        renderSigninCharts(state);
    }

    function renderSigninCharts(state) {
        var chartsRow = document.getElementById('signin-charts');
        if (!chartsRow || typeof DashboardCharts === 'undefined') return;

        chartsRow.textContent = '';
        var C = DashboardCharts.colors;

        var interrupted = state.logs.filter(function(l) { return l.status === 'interrupted'; }).length;

        chartsRow.appendChild(DashboardCharts.createChartCard(
            'Sign-In Status',
            [
                { value: state.success, label: 'Success', color: C.green },
                { value: state.failure, label: 'Failure', color: C.red },
                { value: interrupted, label: 'Interrupted', color: C.yellow }
            ],
            String(state.total), 'total sign-ins'
        ));

        chartsRow.appendChild(DashboardCharts.createChartCard(
            'MFA Satisfaction',
            [
                { value: state.mfaCount, label: 'Satisfied', color: C.green },
                { value: Math.max(state.total - state.mfaCount, 0), label: 'Not Satisfied', color: C.red }
            ],
            state.total > 0 ? Math.round((state.mfaCount / state.total) * 100) + '%' : '0%',
            'coverage'
        ));

        var high = state.logs.filter(function(l) { return l.riskLevel === 'high'; }).length;
        var medium = state.logs.filter(function(l) { return l.riskLevel === 'medium'; }).length;
        var low = state.logs.filter(function(l) { return l.riskLevel === 'low'; }).length;
        var none = state.logs.filter(function(l) { return !l.riskLevel || l.riskLevel === 'none'; }).length;

        chartsRow.appendChild(DashboardCharts.createChartCard(
            'Risk Distribution',
            [
                { value: high, label: 'High', color: C.red },
                { value: medium, label: 'Medium', color: C.yellow },
                { value: low, label: 'Low', color: C.blue },
                { value: none, label: 'None', color: C.gray }
            ],
            String(state.risky), 'risky sign-ins'
        ));
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
                { key: 'riskLevel', label: 'Risk' }
            ],
            defaultVisible: ['createdDateTime', 'userPrincipalName', 'appDisplayName', 'status', 'mfaSatisfied', 'location', 'riskLevel'],
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

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="logs">Sign-In Logs (' + total + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="signin-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();
