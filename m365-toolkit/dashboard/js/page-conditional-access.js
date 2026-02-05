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

    /** Current breakdown dimension */
    var currentBreakdown = 'policyType';

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

    function render(container) {
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
            alertDiv.style.cssText = 'margin-bottom: 1.5rem; padding: 1rem; background: var(--critical-bg); border-radius: 6px; border-left: 4px solid var(--critical);';

            var alertTitle = document.createElement('h4');
            alertTitle.style.cssText = 'margin: 0 0 0.5rem 0; color: var(--critical);';
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

    return {
        render: render
    };

})();

window.PageConditionalAccess = PageConditionalAccess;
