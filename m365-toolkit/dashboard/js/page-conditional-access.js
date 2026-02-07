/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: CONDITIONAL ACCESS
 *
 * Renders the Conditional Access policies page showing policy inventory,
 * security gaps, and coverage analysis. Identifies users excluded from
 * MFA policies and other security blind spots.
 */

const PageConditionalAccess = (function() {
    'use strict';

    /** Column selector instance */
    var colSelector = null;

    /** Current tab */
    var currentTab = 'overview';

    /** Current breakdown dimension */
    var currentBreakdown = 'policyType';

    /** Cached page state */
    var caState = null;

    /**
     * Applies current filters and re-renders.
     */
    function applyFilters() {
        var policies = DataLoader.getData('conditionalAccess') || [];

        // Build filter configuration
        var filterConfig = {
            search: Filters.getValue('ca-search'),
            searchFields: ['displayName']
        };

        // Apply search filter
        var filteredData = Filters.apply(policies, filterConfig);

        // State filter
        var stateFilter = Filters.getValue('ca-state');
        if (stateFilter && stateFilter !== 'all') {
            filteredData = filteredData.filter(function(p) {
                return p.state === stateFilter;
            });
        }

        // Policy type filter
        var typeFilter = Filters.getValue('ca-type');
        if (typeFilter && typeFilter !== 'all') {
            filteredData = filteredData.filter(function(p) {
                return p.policyType === typeFilter;
            });
        }

        // Security gaps filter
        var gapsCheckbox = document.getElementById('ca-gaps');
        if (gapsCheckbox && gapsCheckbox.checked) {
            filteredData = filteredData.filter(function(p) {
                return p.excludedUserCount > 0 || p.excludedGroupCount > 0 || p.state === 'disabled';
            });
        }

        // Render Focus/Breakdown
        renderFocusBreakdown(filteredData);

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the policies table.
     */
    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'state', 'policyType', 'requiresMfa', 'blockAccess',
            'includesAllUsers', 'excludedUserCount', 'riskLevel'
        ];

        var allDefs = [
            { key: 'displayName', label: 'Policy Name' },
            { key: 'state', label: 'State', formatter: formatState },
            { key: 'policyType', label: 'Type', formatter: formatPolicyType },
            { key: 'riskLevel', label: 'Security Level', formatter: formatRiskLevel },
            { key: 'requiresMfa', label: 'Requires MFA', formatter: formatBoolean },
            { key: 'requiresCompliantDevice', label: 'Compliant Device', formatter: formatBoolean },
            { key: 'blockAccess', label: 'Blocks Access', formatter: formatBoolean },
            { key: 'blocksLegacyAuth', label: 'Blocks Legacy', formatter: formatBoolean },
            { key: 'includesAllUsers', label: 'All Users', formatter: formatBoolean },
            { key: 'includesAllApps', label: 'All Apps', formatter: formatBoolean },
            { key: 'excludedUserCount', label: 'Excluded Users', className: 'cell-right', formatter: formatExcludedCount },
            { key: 'excludedGroupCount', label: 'Excluded Groups', className: 'cell-right', formatter: formatExcludedCount },
            { key: 'hasLocationCondition', label: 'Location', formatter: formatBoolean },
            { key: 'hasRiskCondition', label: 'Risk-Based', formatter: formatBoolean },
            { key: 'modifiedDateTime', label: 'Modified', formatter: Tables.formatters.date }
        ];

        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'ca-table',
            data: data,
            columns: columns,
            pageSize: 50,
            onRowClick: showPolicyDetails,
            getRowClass: function(row) {
                if (row.state === 'disabled') return 'row-muted';
                if (row.excludedUserCount > 0 || row.excludedGroupCount > 0) return 'row-warning';
                return '';
            }
        });
    }

    function formatState(value) {
        if (value === 'enabled') {
            return '<span class="badge badge-success">Enabled</span>';
        }
        if (value === 'enabledForReportingButNotEnforced') {
            return '<span class="badge badge-warning">Report Only</span>';
        }
        return '<span class="badge badge-neutral">Disabled</span>';
    }

    function formatPolicyType(value) {
        var types = {
            'mfa': { label: 'MFA', class: 'badge-info' },
            'block': { label: 'Block', class: 'badge-critical' },
            'device-compliance': { label: 'Device', class: 'badge-neutral' },
            'hybrid-join': { label: 'Hybrid Join', class: 'badge-neutral' },
            'other': { label: 'Other', class: 'badge-neutral' }
        };
        var t = types[value] || { label: value, class: 'badge-neutral' };
        return '<span class="badge ' + t.class + '">' + t.label + '</span>';
    }

    function formatRiskLevel(value) {
        var levels = {
            'high-security': { label: 'High Security', class: 'badge-success' },
            'standard': { label: 'Standard', class: 'badge-info' },
            'weak': { label: 'Weak', class: 'badge-warning' },
            'report-only': { label: 'Report Only', class: 'badge-warning' },
            'disabled': { label: 'Disabled', class: 'badge-neutral' }
        };
        var l = levels[value] || { label: value, class: 'badge-neutral' };
        return '<span class="badge ' + l.class + '">' + l.label + '</span>';
    }

    function formatBoolean(value) {
        return value ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>';
    }

    function formatExcludedCount(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return '<span class="text-warning font-bold">' + value + '</span>';
    }

    function renderFocusBreakdown(policies) {
        var focusContainer = document.getElementById('ca-focus-table');
        var breakdownContainer = document.getElementById('ca-breakdown-table');
        var breakdownFilterContainer = document.getElementById('ca-breakdown-filter');

        if (!focusContainer || !breakdownContainer) return;

        var breakdownDimensions = [
            { key: 'policyType', label: 'Policy Type' },
            { key: 'riskLevel', label: 'Security Level' },
            { key: 'state', label: 'State' }
        ];

        if (breakdownFilterContainer && typeof FocusTables !== 'undefined') {
            FocusTables.renderBreakdownFilter({
                containerId: 'ca-breakdown-filter',
                dimensions: breakdownDimensions,
                selected: currentBreakdown,
                onChange: function(newDim) {
                    currentBreakdown = newDim;
                    renderFocusBreakdown(policies);
                }
            });
        }

        if (typeof FocusTables !== 'undefined') {
            FocusTables.renderFocusTable({
                containerId: 'ca-focus-table',
                data: policies,
                groupByKey: 'state',
                groupByLabel: 'State',
                countLabel: 'Policies'
            });

            FocusTables.renderBreakdownTable({
                containerId: 'ca-breakdown-table',
                data: policies,
                primaryKey: 'state',
                breakdownKey: currentBreakdown,
                primaryLabel: 'State',
                breakdownLabel: breakdownDimensions.find(function(d) { return d.key === currentBreakdown; }).label
            });
        }
    }

    function showPolicyDetails(policy) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = policy.displayName;

        // Build details using DOM methods for safety
        body.textContent = '';

        // Add exclusions warning if any
        if (policy.excludedUserCount > 0 || policy.excludedGroupCount > 0) {
            var alertDiv = document.createElement('div');
            alertDiv.className = 'alert alert-warning';
            alertDiv.style.cssText = 'margin-bottom: 1rem; padding: 0.75rem; background: var(--warning-bg); border-radius: 4px;';

            var strong = document.createElement('strong');
            strong.textContent = 'Security Gap: ';
            alertDiv.appendChild(strong);

            var alertText = document.createTextNode('This policy has exclusions that may create blind spots. Excluded Users: ' + policy.excludedUserCount + ', Excluded Groups: ' + policy.excludedGroupCount);
            alertDiv.appendChild(alertText);
            body.appendChild(alertDiv);
        }

        var detailList = document.createElement('div');
        detailList.className = 'detail-list';

        var details = [
            ['State', policy.state],
            ['Policy Type', policy.policyType],
            ['Security Level', policy.riskLevel],
            ['Requires MFA', policy.requiresMfa ? 'Yes' : 'No'],
            ['Requires Compliant Device', policy.requiresCompliantDevice ? 'Yes' : 'No'],
            ['Requires Hybrid Join', policy.requiresHybridJoin ? 'Yes' : 'No'],
            ['Blocks Access', policy.blockAccess ? 'Yes' : 'No'],
            ['Blocks Legacy Auth', policy.blocksLegacyAuth ? 'Yes' : 'No'],
            ['Includes All Users', policy.includesAllUsers ? 'Yes' : 'No'],
            ['Includes All Guests', policy.includesAllGuests ? 'Yes' : 'No'],
            ['Includes All Apps', policy.includesAllApps ? 'Yes' : 'No'],
            ['Includes Office 365', policy.includesOffice365 ? 'Yes' : 'No'],
            ['Excluded Users', String(policy.excludedUserCount)],
            ['Excluded Groups', String(policy.excludedGroupCount)],
            ['Included Groups', String(policy.includedGroupCount)],
            ['Included Roles', String(policy.includedRoleCount)],
            ['Has Location Condition', policy.hasLocationCondition ? 'Yes' : 'No'],
            ['Has Risk Condition', policy.hasRiskCondition ? 'Yes' : 'No'],
            ['Created', DataLoader.formatDate(policy.createdDateTime)],
            ['Modified', DataLoader.formatDate(policy.modifiedDateTime)],
            ['Policy ID', policy.id]
        ];

        details.forEach(function(d) {
            var label = document.createElement('span');
            label.className = 'detail-label';
            label.textContent = d[0] + ':';
            detailList.appendChild(label);

            var value = document.createElement('span');
            value.className = 'detail-value';
            if (d[0] === 'Policy ID') {
                value.style.fontSize = '0.8em';
            }
            value.textContent = d[1];
            detailList.appendChild(value);
        });

        body.appendChild(detailList);
        modal.classList.add('visible');
    }

    function analyzeSecurityGaps(policies) {
        var gaps = {
            noMfaPolicies: 0,
            disabledPolicies: 0,
            reportOnlyPolicies: 0,
            policiesWithExclusions: 0,
            totalExcludedUsers: 0,
            totalExcludedGroups: 0,
            noLegacyAuthBlock: true,
            noRiskBasedPolicies: true
        };

        var enabledMfaPolicies = 0;
        var hasLegacyBlock = false;
        var hasRiskBased = false;

        policies.forEach(function(p) {
            if (p.state === 'disabled') {
                gaps.disabledPolicies++;
            } else if (p.state === 'enabledForReportingButNotEnforced') {
                gaps.reportOnlyPolicies++;
            }

            if (p.state === 'enabled' && p.requiresMfa) {
                enabledMfaPolicies++;
            }

            if (p.excludedUserCount > 0 || p.excludedGroupCount > 0) {
                gaps.policiesWithExclusions++;
                gaps.totalExcludedUsers += p.excludedUserCount || 0;
                gaps.totalExcludedGroups += p.excludedGroupCount || 0;
            }

            if (p.state === 'enabled' && p.blocksLegacyAuth) {
                hasLegacyBlock = true;
            }

            if (p.state === 'enabled' && p.hasRiskCondition) {
                hasRiskBased = true;
            }
        });

        gaps.noLegacyAuthBlock = !hasLegacyBlock;
        gaps.noRiskBasedPolicies = !hasRiskBased;
        gaps.noMfaPolicies = enabledMfaPolicies === 0;

        return gaps;
    }

    function renderLegacy(container) {
        var policies = DataLoader.getData('conditionalAccess') || [];

        var enabledCount = policies.filter(function(p) { return p.state === 'enabled'; }).length;
        var reportOnlyCount = policies.filter(function(p) { return p.state === 'enabledForReportingButNotEnforced'; }).length;
        var disabledCount = policies.filter(function(p) { return p.state === 'disabled'; }).length;
        var mfaPolicies = policies.filter(function(p) { return p.state === 'enabled' && p.requiresMfa; }).length;
        var blockPolicies = policies.filter(function(p) { return p.state === 'enabled' && p.blockAccess; }).length;
        var policiesWithExclusions = policies.filter(function(p) { return p.excludedUserCount > 0 || p.excludedGroupCount > 0; }).length;

        var gaps = analyzeSecurityGaps(policies);

        // Build page using DOM methods
        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Conditional Access';
        header.appendChild(h2);
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'Policy inventory, coverage analysis, and security gap detection';
        header.appendChild(desc);
        container.appendChild(header);

        // Security gaps alert
        var gapsList = [];
        if (gaps.noMfaPolicies) gapsList.push('No enabled MFA policies found');
        if (gaps.noLegacyAuthBlock) gapsList.push('Legacy authentication is not blocked');
        if (gaps.noRiskBasedPolicies) gapsList.push('No risk-based policies enabled');
        if (gaps.policiesWithExclusions > 0) {
            gapsList.push(gaps.policiesWithExclusions + ' policies have user/group exclusions (' + gaps.totalExcludedUsers + ' users, ' + gaps.totalExcludedGroups + ' groups excluded)');
        }
        if (gaps.reportOnlyPolicies > 0) {
            gapsList.push(gaps.reportOnlyPolicies + ' policies in report-only mode (not enforcing)');
        }

        if (gapsList.length > 0) {
            var alertDiv = document.createElement('div');
            alertDiv.className = 'alert alert-critical';
            alertDiv.style.cssText = 'margin-bottom: 1.5rem; padding: 1rem; background: var(--critical-bg); border-radius: 6px; border-left: 4px solid var(--color-critical);';

            var alertTitle = document.createElement('h4');
            alertTitle.style.cssText = 'margin: 0 0 0.5rem 0; color: var(--color-critical);';
            alertTitle.textContent = 'Security Gaps Detected';
            alertDiv.appendChild(alertTitle);

            var ul = document.createElement('ul');
            ul.style.cssText = 'margin: 0; padding-left: 1.25rem;';
            gapsList.forEach(function(g) {
                var li = document.createElement('li');
                li.textContent = g;
                ul.appendChild(li);
            });
            alertDiv.appendChild(ul);
            container.appendChild(alertDiv);
        }

        // Summary cards
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';

        var cardData = [
            { label: 'Total Policies', value: policies.length, cardClass: '', valueClass: '' },
            { label: 'Enabled', value: enabledCount, cardClass: 'card-success', valueClass: 'success' },
            { label: 'MFA Policies', value: mfaPolicies, cardClass: '', valueClass: '' },
            { label: 'Block Policies', value: blockPolicies, cardClass: '', valueClass: '' },
            { label: 'Report Only', value: reportOnlyCount, cardClass: reportOnlyCount > 0 ? 'card-warning' : '', valueClass: reportOnlyCount > 0 ? 'warning' : '' },
            { label: 'With Exclusions', value: policiesWithExclusions, cardClass: policiesWithExclusions > 0 ? 'card-warning' : '', valueClass: policiesWithExclusions > 0 ? 'warning' : '', change: 'Potential gaps' }
        ];

        cardData.forEach(function(cd) {
            var card = document.createElement('div');
            card.className = 'card ' + cd.cardClass;

            var cardLabel = document.createElement('div');
            cardLabel.className = 'card-label';
            cardLabel.textContent = cd.label;
            card.appendChild(cardLabel);

            var cardValue = document.createElement('div');
            cardValue.className = 'card-value ' + cd.valueClass;
            cardValue.textContent = cd.value;
            card.appendChild(cardValue);

            if (cd.change) {
                var cardChange = document.createElement('div');
                cardChange.className = 'card-change';
                cardChange.textContent = cd.change;
                card.appendChild(cardChange);
            }

            cardsGrid.appendChild(card);
        });
        container.appendChild(cardsGrid);

        // Charts row
        var chartsRow = document.createElement('div');
        chartsRow.className = 'charts-row';
        chartsRow.id = 'ca-charts';
        container.appendChild(chartsRow);

        // Focus/Breakdown section
        var sectionHeader = document.createElement('div');
        sectionHeader.className = 'section-header';
        var h3 = document.createElement('h3');
        h3.textContent = 'Policy Analysis';
        sectionHeader.appendChild(h3);
        var breakdownFilter = document.createElement('div');
        breakdownFilter.id = 'ca-breakdown-filter';
        sectionHeader.appendChild(breakdownFilter);
        container.appendChild(sectionHeader);

        var focusRow = document.createElement('div');
        focusRow.className = 'focus-breakdown-row';
        var focusTable = document.createElement('div');
        focusTable.id = 'ca-focus-table';
        focusRow.appendChild(focusTable);
        var breakdownTable = document.createElement('div');
        breakdownTable.id = 'ca-breakdown-table';
        focusRow.appendChild(breakdownTable);
        container.appendChild(focusRow);

        // Filters
        var filterDiv = document.createElement('div');
        filterDiv.id = 'ca-filter';
        container.appendChild(filterDiv);

        // Table toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'table-toolbar';
        var colSelectorDiv = document.createElement('div');
        colSelectorDiv.id = 'ca-col-selector';
        toolbar.appendChild(colSelectorDiv);
        var exportBtn = document.createElement('button');
        exportBtn.className = 'btn btn-secondary btn-sm';
        exportBtn.id = 'export-ca-table';
        exportBtn.textContent = 'Export CSV';
        toolbar.appendChild(exportBtn);
        container.appendChild(toolbar);

        // Data table
        var tableDiv = document.createElement('div');
        tableDiv.id = 'ca-table';
        container.appendChild(tableDiv);

        // Render charts
        if (typeof DashboardCharts !== 'undefined') {
            var C = DashboardCharts.colors;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Policy State',
                [
                    { value: enabledCount, label: 'Enabled', color: C.green },
                    { value: reportOnlyCount, label: 'Report Only', color: C.yellow },
                    { value: disabledCount, label: 'Disabled', color: C.gray }
                ],
                String(enabledCount), 'enforcing'
            ));

            var mfaAllUsers = policies.filter(function(p) {
                return p.state === 'enabled' && p.requiresMfa && p.includesAllUsers;
            }).length;
            var mfaPartial = mfaPolicies - mfaAllUsers;
            var noMfa = enabledCount - mfaPolicies;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'MFA Coverage',
                [
                    { value: mfaAllUsers, label: 'All Users', color: C.green },
                    { value: mfaPartial, label: 'Partial', color: C.blue },
                    { value: noMfa, label: 'No MFA', color: C.red }
                ],
                mfaPolicies > 0 ? String(mfaPolicies) : '0', 'MFA policies'
            ));
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'ca-filter',
            controls: [
                {
                    type: 'search',
                    id: 'ca-search',
                    label: 'Search',
                    placeholder: 'Search policies...'
                },
                {
                    type: 'select',
                    id: 'ca-state',
                    label: 'State',
                    options: [
                        { value: 'all', label: 'All States' },
                        { value: 'enabled', label: 'Enabled' },
                        { value: 'enabledForReportingButNotEnforced', label: 'Report Only' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select',
                    id: 'ca-type',
                    label: 'Type',
                    options: [
                        { value: 'all', label: 'All Types' },
                        { value: 'mfa', label: 'MFA' },
                        { value: 'block', label: 'Block' },
                        { value: 'device-compliance', label: 'Device Compliance' },
                        { value: 'hybrid-join', label: 'Hybrid Join' },
                        { value: 'other', label: 'Other' }
                    ]
                },
                {
                    type: 'checkbox',
                    id: 'ca-gaps',
                    label: 'Show only policies with gaps'
                }
            ],
            onFilter: applyFilters
        });

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'ca-col-selector',
                storageKey: 'ca-columns',
                allColumns: [
                    { key: 'displayName', label: 'Policy Name' },
                    { key: 'state', label: 'State' },
                    { key: 'policyType', label: 'Type' },
                    { key: 'riskLevel', label: 'Security Level' },
                    { key: 'requiresMfa', label: 'Requires MFA' },
                    { key: 'requiresCompliantDevice', label: 'Compliant Device' },
                    { key: 'blockAccess', label: 'Blocks Access' },
                    { key: 'blocksLegacyAuth', label: 'Blocks Legacy' },
                    { key: 'includesAllUsers', label: 'All Users' },
                    { key: 'includesAllApps', label: 'All Apps' },
                    { key: 'excludedUserCount', label: 'Excluded Users' },
                    { key: 'excludedGroupCount', label: 'Excluded Groups' },
                    { key: 'hasLocationCondition', label: 'Location' },
                    { key: 'hasRiskCondition', label: 'Risk-Based' },
                    { key: 'modifiedDateTime', label: 'Modified' }
                ],
                defaultVisible: [
                    'displayName', 'state', 'policyType', 'requiresMfa', 'blockAccess',
                    'includesAllUsers', 'excludedUserCount', 'riskLevel'
                ],
                onColumnsChanged: applyFilters
            });
        }

        // Bind export button
        Export.bindExportButton('ca-table', 'conditional-access');

        // Initial render
        applyFilters();
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('ca-content');
        if (!container || !caState) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container);
                break;
            case 'policies':
                renderPoliciesTab(container);
                break;
        }
    }

    function renderOverview(container) {
        var policies = caState.policies;
        var total = policies.length;
        var enabledPct = total > 0 ? Math.round((caState.enabledCount / total) * 100) : 0;
        var enabledClass = enabledPct >= 80 ? 'text-success' : enabledPct >= 50 ? 'text-warning' : 'text-critical';

        var mfaCount = policies.filter(function(p) { return p.policyType === 'mfa' && p.state === 'enabled'; }).length;
        var blockCount = policies.filter(function(p) { return p.policyType === 'block' && p.state === 'enabled'; }).length;
        var deviceCount = policies.filter(function(p) { return p.policyType === 'device-compliance' && p.state === 'enabled'; }).length;
        var legacyBlock = policies.filter(function(p) { return p.state === 'enabled' && p.blocksLegacyAuth; }).length;
        var riskBased = policies.filter(function(p) { return p.state === 'enabled' && p.hasRiskCondition; }).length;
        var locationBased = policies.filter(function(p) { return p.state === 'enabled' && p.hasLocationCondition; }).length;

        var html = '';

        // Policy Overview Section
        html += '<div class="analytics-section">';
        html += '<h3>Conditional Access Overview</h3>';
        html += '<div class="compliance-overview">';

        // Donut chart for enabled policies
        var radius = 40;
        var circumference = 2 * Math.PI * radius;
        var totalForChart = caState.enabledCount + caState.reportOnlyCount + caState.disabledCount;
        var enabledDash = totalForChart > 0 ? (caState.enabledCount / totalForChart) * circumference : 0;
        var reportDash = totalForChart > 0 ? (caState.reportOnlyCount / totalForChart) * circumference : 0;
        var disabledDash = totalForChart > 0 ? (caState.disabledCount / totalForChart) * circumference : 0;

        html += '<div class="compliance-chart">';
        html += '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        var offset = 0;
        if (caState.enabledCount > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-success)" stroke-width="10" stroke-dasharray="' + enabledDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += enabledDash;
        }
        if (caState.reportOnlyCount > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-warning)" stroke-width="10" stroke-dasharray="' + reportDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += reportDash;
        }
        if (caState.disabledCount > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-neutral)" stroke-width="10" stroke-dasharray="' + disabledDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value ' + enabledClass + '">' + enabledPct + '%</span><span class="donut-label">Enabled</span></div>';
        html += '</div></div>';

        // Legend
        html += '<div class="compliance-legend">';
        html += '<div class="legend-item"><span class="legend-dot bg-success"></span> Enabled: <strong>' + caState.enabledCount + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Report Only: <strong>' + caState.reportOnlyCount + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-neutral"></span> Disabled: <strong>' + caState.disabledCount + '</strong></div>';
        html += '<div class="legend-item">MFA Policies: <strong>' + caState.mfaPolicies + '</strong></div>';
        html += '</div></div></div>';

        // Analytics Grid with platform-list pattern
        html += '<div class="analytics-grid">';

        // Policy State with mini-bars
        html += '<div class="analytics-card"><h4>Policy State</h4>';
        html += '<div class="platform-list">';
        var states = [
            { label: 'Enabled', count: caState.enabledCount, color: 'bg-success' },
            { label: 'Report Only', count: caState.reportOnlyCount, color: 'bg-warning' },
            { label: 'Disabled', count: caState.disabledCount, color: 'bg-neutral' }
        ];
        states.forEach(function(s) {
            var pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + s.label + '</span>';
            html += '<span class="platform-policies">' + s.count + ' policies</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill ' + s.color + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Policy Types with mini-bars
        html += '<div class="analytics-card"><h4>Enabled Policy Types</h4>';
        html += '<div class="platform-list">';
        var types = [
            { label: 'MFA Policies', count: mfaCount, color: 'bg-success' },
            { label: 'Block Policies', count: blockCount, color: 'bg-critical' },
            { label: 'Device Compliance', count: deviceCount, color: 'bg-info' }
        ];
        var enabledTotal = caState.enabledCount || 1;
        types.forEach(function(t) {
            var pct = Math.round((t.count / enabledTotal) * 100);
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + t.label + '</span>';
            html += '<span class="platform-policies">' + t.count + '</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill ' + t.color + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Security Controls with mini-bars
        html += '<div class="analytics-card"><h4>Security Controls</h4>';
        html += '<div class="platform-list">';
        var controls = [
            { label: 'Legacy Auth Block', count: legacyBlock, color: legacyBlock > 0 ? 'bg-success' : 'bg-warning' },
            { label: 'Risk-Based', count: riskBased, color: riskBased > 0 ? 'bg-success' : 'bg-warning' },
            { label: 'Location-Based', count: locationBased, color: 'bg-info' }
        ];
        controls.forEach(function(c) {
            var pct = Math.round((c.count / enabledTotal) * 100);
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + c.label + '</span>';
            html += '<span class="platform-policies">' + c.count + '</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill ' + c.color + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Policy Exclusions
        var totalExclUsers = 0;
        var totalExclGroups = 0;
        policies.forEach(function(p) {
            totalExclUsers += p.excludedUserCount || 0;
            totalExclGroups += p.excludedGroupCount || 0;
        });
        html += '<div class="analytics-card"><h4>Policy Exclusions</h4>';
        html += '<div class="platform-list">';
        html += '<div class="platform-row"><span class="platform-name">Policies With Exclusions</span><span class="platform-policies ' + (caState.policiesWithExclusions > 0 ? 'text-warning' : 'text-success') + '">' + caState.policiesWithExclusions + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Total Excluded Users</span><span class="platform-policies ' + (totalExclUsers > 0 ? 'text-warning' : '') + '">' + totalExclUsers + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Total Excluded Groups</span><span class="platform-policies ' + (totalExclGroups > 0 ? 'text-warning' : '') + '">' + totalExclGroups + '</span></div>';
        html += '</div></div>';

        html += '</div>'; // end analytics-grid

        // Insight Cards for issues
        var hasIssues = caState.gapsList.length > 0 || legacyBlock === 0 || caState.reportOnlyCount > caState.enabledCount;
        if (hasIssues) {
            html += '<div class="analytics-section"><h3>Issues Needing Attention</h3>';
            html += '<div class="insights-list">';

            if (caState.gapsList.length > 0) {
                caState.gapsList.forEach(function(gap) {
                    html += '<div class="insight-card insight-critical">';
                    html += '<div class="insight-header"><span class="badge badge-critical">HIGH</span><span class="insight-category">Security Gap</span></div>';
                    html += '<p class="insight-description">' + gap + '</p>';
                    html += '<p class="insight-action"><strong>Action:</strong> Create or enable a Conditional Access policy to address this gap.</p>';
                    html += '</div>';
                });
            }

            if (legacyBlock === 0) {
                html += '<div class="insight-card insight-warning">';
                html += '<div class="insight-header"><span class="badge badge-warning">MEDIUM</span><span class="insight-category">Legacy Authentication</span></div>';
                html += '<p class="insight-description">No policies blocking legacy authentication. Legacy auth bypasses MFA and is a common attack vector.</p>';
                html += '<p class="insight-action"><strong>Action:</strong> Create a policy to block legacy authentication protocols.</p>';
                html += '</div>';
            }

            if (caState.reportOnlyCount > caState.enabledCount) {
                html += '<div class="insight-card insight-info">';
                html += '<div class="insight-header"><span class="badge badge-info">INFO</span><span class="insight-category">Report Only Mode</span></div>';
                html += '<p class="insight-description">' + caState.reportOnlyCount + ' policies in report-only mode. Review impact and promote to enabled when ready.</p>';
                html += '<p class="insight-action"><strong>Action:</strong> Analyze report-only logs and transition tested policies to enforcement.</p>';
                html += '</div>';
            }

            html += '</div></div>';
        }

        // Policy Analysis section
        html += '<div class="section-header"><h3>Policy Analysis</h3><div id="ca-breakdown-filter"></div></div>';
        html += '<div class="focus-breakdown-row">';
        html += '<div class="table-container" id="ca-focus-table"></div>';
        html += '<div class="table-container" id="ca-breakdown-table"></div>';
        html += '</div>';

        html += '<div class="charts-row" id="ca-charts"></div>';

        container.innerHTML = html;

        // Render charts
        if (typeof DashboardCharts !== 'undefined') {
            var chartsRow = document.getElementById('ca-charts');
            var C = DashboardCharts.colors;

            var mfaAllUsers = policies.filter(function(p) {
                return p.state === 'enabled' && p.requiresMfa && p.includesAllUsers;
            }).length;
            var mfaPartial = caState.mfaPolicies - mfaAllUsers;
            var noMfa = caState.enabledCount - caState.mfaPolicies;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Policy State',
                [
                    { value: caState.enabledCount, label: 'Enabled', color: C.green },
                    { value: caState.reportOnlyCount, label: 'Report Only', color: C.yellow },
                    { value: caState.disabledCount, label: 'Disabled', color: C.gray }
                ],
                String(caState.enabledCount), 'enforcing'
            ));

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'MFA Coverage',
                [
                    { value: mfaAllUsers, label: 'All Users', color: C.green },
                    { value: mfaPartial, label: 'Partial', color: C.blue },
                    { value: noMfa, label: 'No MFA', color: C.red }
                ],
                caState.mfaPolicies > 0 ? String(caState.mfaPolicies) : '0', 'MFA policies'
            ));
        }

        renderFocusBreakdown(caState.policies);
    }

    function renderPoliciesTab(container) {
        var html = '<div id="ca-filter"></div>';
        html += '<div class="table-toolbar">';
        html += '<div id="ca-col-selector"></div>';
        html += '<button class="btn btn-secondary btn-sm" id="export-ca-table">Export CSV</button>';
        html += '</div>';
        html += '<div class="table-container" id="ca-table"></div>';
        container.innerHTML = html;

        Filters.createFilterBar({
            containerId: 'ca-filter',
            controls: [
                {
                    type: 'search',
                    id: 'ca-search',
                    label: 'Search',
                    placeholder: 'Search policies...'
                },
                {
                    type: 'select',
                    id: 'ca-state',
                    label: 'State',
                    options: [
                        { value: 'all', label: 'All States' },
                        { value: 'enabled', label: 'Enabled' },
                        { value: 'enabledForReportingButNotEnforced', label: 'Report Only' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select',
                    id: 'ca-type',
                    label: 'Type',
                    options: [
                        { value: 'all', label: 'All Types' },
                        { value: 'mfa', label: 'MFA' },
                        { value: 'block', label: 'Block' },
                        { value: 'device-compliance', label: 'Device Compliance' },
                        { value: 'hybrid-join', label: 'Hybrid Join' },
                        { value: 'other', label: 'Other' }
                    ]
                },
                {
                    type: 'checkbox',
                    id: 'ca-gaps',
                    label: 'Show only policies with gaps'
                }
            ],
            onFilter: applyFilters
        });

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'ca-col-selector',
                storageKey: 'ca-columns',
                allColumns: [
                    { key: 'displayName', label: 'Policy Name' },
                    { key: 'state', label: 'State' },
                    { key: 'policyType', label: 'Type' },
                    { key: 'riskLevel', label: 'Security Level' },
                    { key: 'requiresMfa', label: 'Requires MFA' },
                    { key: 'requiresCompliantDevice', label: 'Compliant Device' },
                    { key: 'blockAccess', label: 'Blocks Access' },
                    { key: 'blocksLegacyAuth', label: 'Blocks Legacy' },
                    { key: 'includesAllUsers', label: 'All Users' },
                    { key: 'includesAllApps', label: 'All Apps' },
                    { key: 'excludedUserCount', label: 'Excluded Users' },
                    { key: 'excludedGroupCount', label: 'Excluded Groups' },
                    { key: 'hasLocationCondition', label: 'Location' },
                    { key: 'hasRiskCondition', label: 'Risk-Based' },
                    { key: 'modifiedDateTime', label: 'Modified' }
                ],
                defaultVisible: [
                    'displayName', 'state', 'policyType', 'requiresMfa', 'blockAccess',
                    'includesAllUsers', 'excludedUserCount', 'riskLevel'
                ],
                onColumnsChanged: applyFilters
            });
        }

        Export.bindExportButton('ca-table', 'conditional-access');
        applyFilters();
    }

    function render(container) {
        var policies = DataLoader.getData('conditionalAccess') || [];

        var enabledCount = policies.filter(function(p) { return p.state === 'enabled'; }).length;
        var reportOnlyCount = policies.filter(function(p) { return p.state === 'enabledForReportingButNotEnforced'; }).length;
        var disabledCount = policies.filter(function(p) { return p.state === 'disabled'; }).length;
        var mfaPolicies = policies.filter(function(p) { return p.state === 'enabled' && p.requiresMfa; }).length;
        var blockPolicies = policies.filter(function(p) { return p.state === 'enabled' && p.blockAccess; }).length;
        var policiesWithExclusions = policies.filter(function(p) { return p.excludedUserCount > 0 || p.excludedGroupCount > 0; }).length;

        var gaps = analyzeSecurityGaps(policies);
        var gapsList = [];
        if (gaps.noMfaPolicies) gapsList.push('No enabled MFA policies found');
        if (gaps.noLegacyAuthBlock) gapsList.push('Legacy authentication is not blocked');
        if (gaps.noRiskBasedPolicies) gapsList.push('No risk-based policies enabled');
        if (gaps.policiesWithExclusions > 0) {
            gapsList.push(gaps.policiesWithExclusions + ' policies have user/group exclusions (' + gaps.totalExcludedUsers + ' users, ' + gaps.totalExcludedGroups + ' groups excluded)');
        }
        if (gaps.reportOnlyPolicies > 0) {
            gapsList.push(gaps.reportOnlyPolicies + ' policies in report-only mode (not enforcing)');
        }

        caState = {
            policies: policies,
            enabledCount: enabledCount,
            reportOnlyCount: reportOnlyCount,
            disabledCount: disabledCount,
            mfaPolicies: mfaPolicies,
            blockPolicies: blockPolicies,
            policiesWithExclusions: policiesWithExclusions,
            gapsList: gapsList
        };

        var html = '<div class="page-header"><h2>Conditional Access</h2><p class="page-description">Policy inventory, coverage analysis, and security gap detection</p></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + policies.length + '</div><div class="summary-label">Total Policies</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + enabledCount + '</div><div class="summary-label">Enabled</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + mfaPolicies + '</div><div class="summary-label">MFA Policies</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + blockPolicies + '</div><div class="summary-label">Block Policies</div></div>';
        html += '<div class="summary-card' + (reportOnlyCount > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + reportOnlyCount + '</div><div class="summary-label">Report Only</div></div>';
        html += '<div class="summary-card' + (policiesWithExclusions > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + policiesWithExclusions + '</div><div class="summary-label">With Exclusions</div><div class="card-change">Potential gaps</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="policies">Policies (' + policies.length + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="ca-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    return {
        render: render
    };

})();

window.PageConditionalAccess = PageConditionalAccess;
