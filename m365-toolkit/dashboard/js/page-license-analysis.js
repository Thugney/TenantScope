/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: LICENSE ANALYSIS
 *
 * Detailed license overlap detection at user level, showing users with
 * redundant licenses, department breakdown, and potential savings.
 */

const PageLicenseAnalysis = (function() {
    'use strict';

    // Known overlap rules: higher tier includes lower tier
    var OVERLAP_RULES = [
        { name: 'E3 + E5', higherSku: 'SPE_E5', lowerSku: 'SPE_E3', higherName: 'Microsoft 365 E5', lowerName: 'Microsoft 365 E3' },
        { name: 'E3 + E1', higherSku: 'SPE_E3', lowerSku: 'SPE_E1', higherName: 'Microsoft 365 E3', lowerName: 'Microsoft 365 E1' },
        { name: 'A3 Faculty + A1 Faculty', higherSku: 'M365EDU_A3_FACULTY', lowerSku: 'M365EDU_A1_FACULTY', higherName: 'M365 A3 Faculty', lowerName: 'M365 A1 Faculty' },
        { name: 'A3 Student + A1 Student', higherSku: 'M365EDU_A3_STUUSEBNFT', lowerSku: 'M365EDU_A1', higherName: 'M365 A3 Student', lowerName: 'M365 A1 Student' },
        { name: 'Entra ID P2 + P1', higherSku: 'AAD_PREMIUM_P2', lowerSku: 'AAD_PREMIUM', higherName: 'Entra ID P2', lowerName: 'Entra ID P1' },
        { name: 'Power BI Premium + Pro', higherSku: 'PBI_PREMIUM_EM1_ADDON', lowerSku: 'POWER_BI_PRO', higherName: 'Power BI Premium', lowerName: 'Power BI Pro' }
    ];

    /** Current tab */
    var currentTab = 'overview';

    /** Cached page state */
    var analysisState = null;

    /** Column selector instance */
    var colSelector = null;

    /**
     * Creates an element with text content.
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = el('div', 'analytics-card');
        card.appendChild(el('h4', null, title));
        var list = el('div', 'platform-list');
        rows.forEach(function(row) {
            var rowDiv = el('div', 'platform-row');
            rowDiv.appendChild(el('span', 'platform-name', row.name));
            rowDiv.appendChild(el('span', 'platform-policies', String(row.count)));
            var miniBar = el('div', 'mini-bar');
            var fill = el('div', 'mini-bar-fill ' + row.cls);
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            rowDiv.appendChild(el('span', 'platform-rate', row.showCount ? String(row.count) : (row.pct + '%')));
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = el('div', 'insight-card insight-' + type);
        var header = el('div', 'insight-header');
        header.appendChild(el('span', 'badge badge-' + type, badge));
        header.appendChild(el('span', 'insight-category', category));
        card.appendChild(header);
        card.appendChild(el('p', 'insight-description', description));
        if (action) {
            var actionP = el('p', 'insight-action');
            actionP.appendChild(el('strong', null, 'Action: '));
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    /**
     * Analyzes license overlaps at user level.
     */
    function analyzeOverlaps(users, licenses) {
        var skuMap = {};
        licenses.forEach(function(lic) {
            skuMap[lic.skuId] = lic;
            skuMap[lic.skuPartNumber] = lic;
        });

        var overlapUsers = [];
        var ruleStats = {};
        OVERLAP_RULES.forEach(function(r) { ruleStats[r.name] = { count: 0, users: [], monthlyCost: 0 }; });

        users.forEach(function(user) {
            if (!user.assignedSkuIds || !Array.isArray(user.assignedSkuIds) || user.assignedSkuIds.length < 2) return;

            var userSkuPartNumbers = user.assignedSkuIds.map(function(id) {
                var lic = skuMap[id];
                return lic ? lic.skuPartNumber : id;
            });

            OVERLAP_RULES.forEach(function(rule) {
                var hasHigher = userSkuPartNumbers.indexOf(rule.higherSku) !== -1;
                var hasLower = userSkuPartNumbers.indexOf(rule.lowerSku) !== -1;

                if (hasHigher && hasLower) {
                    var lowerLic = skuMap[rule.lowerSku];
                    var monthlyCost = lowerLic ? (lowerLic.monthlyCostPerLicense || 0) : 0;

                    overlapUsers.push({
                        user: user,
                        rule: rule.name,
                        higherLicense: rule.higherName,
                        lowerLicense: rule.lowerName,
                        redundantCost: monthlyCost
                    });

                    ruleStats[rule.name].count++;
                    ruleStats[rule.name].users.push(user);
                    ruleStats[rule.name].monthlyCost += monthlyCost;
                }
            });
        });

        // Department breakdown
        var deptOverlaps = {};
        overlapUsers.forEach(function(o) {
            var dept = o.user.department || 'Unassigned';
            if (!deptOverlaps[dept]) {
                deptOverlaps[dept] = { count: 0, cost: 0 };
            }
            deptOverlaps[dept].count++;
            deptOverlaps[dept].cost += o.redundantCost;
        });

        var totalWaste = overlapUsers.reduce(function(sum, o) { return sum + o.redundantCost; }, 0);

        return {
            overlapUsers: overlapUsers,
            ruleStats: ruleStats,
            deptOverlaps: deptOverlaps,
            totalOverlapCount: overlapUsers.length,
            totalMonthlyWaste: totalWaste,
            totalAnnualWaste: totalWaste * 12
        };
    }

    function formatCurrency(value, currency) {
        return value.toLocaleString() + ' ' + currency;
    }

    /**
     * Switches to a different tab.
     */
    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    /**
     * Renders the content for the current tab.
     */
    function renderContent() {
        var container = document.getElementById('analysis-content');
        if (!container || !analysisState) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'overlaps':
                renderOverlapsTab(container);
                break;
        }
    }

    /**
     * Renders the Overview tab with analytics.
     */
    function renderOverviewTab(container) {
        container.textContent = '';
        var data = analysisState;

        // Build analytics section with donut chart
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Overlap Analysis Overview'));

        var complianceOverview = el('div', 'compliance-overview');

        // Donut chart
        var chartContainer = el('div', 'compliance-chart');
        var donutDiv = el('div', 'donut-chart');

        var circumference = 2 * Math.PI * 40;
        var totalUsers = data.totalUsers || 1;
        var overlapPct = Math.round((data.analysis.totalOverlapCount / totalUsers) * 100);
        var cleanPct = 100 - overlapPct;

        var cleanDash = (cleanPct / 100) * circumference;
        var overlapDash = (overlapPct / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (cleanPct > 0) {
            var cleanCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            cleanCircle.setAttribute('cx', '50');
            cleanCircle.setAttribute('cy', '50');
            cleanCircle.setAttribute('r', '40');
            cleanCircle.setAttribute('fill', 'none');
            cleanCircle.setAttribute('stroke', 'var(--color-success)');
            cleanCircle.setAttribute('stroke-width', '12');
            cleanCircle.setAttribute('stroke-dasharray', cleanDash + ' ' + circumference);
            cleanCircle.setAttribute('stroke-dashoffset', '0');
            cleanCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(cleanCircle);
        }
        if (overlapPct > 0) {
            var overlapCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            overlapCircle.setAttribute('cx', '50');
            overlapCircle.setAttribute('cy', '50');
            overlapCircle.setAttribute('r', '40');
            overlapCircle.setAttribute('fill', 'none');
            overlapCircle.setAttribute('stroke', 'var(--color-critical)');
            overlapCircle.setAttribute('stroke-width', '12');
            overlapCircle.setAttribute('stroke-dasharray', overlapDash + ' ' + circumference);
            overlapCircle.setAttribute('stroke-dashoffset', String(-cleanDash));
            overlapCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(overlapCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = el('div', 'donut-center');
        donutCenter.appendChild(el('span', 'donut-value', data.analysis.totalOverlapCount));
        donutCenter.appendChild(el('span', 'donut-label', 'Overlaps'));
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = el('div', 'compliance-legend');
        var legendItems = [
            { cls: 'bg-success', label: 'Clean Users', value: (totalUsers - data.analysis.totalOverlapCount).toLocaleString() },
            { cls: 'bg-critical', label: 'With Overlaps', value: data.analysis.totalOverlapCount.toLocaleString() },
            { cls: 'bg-warning', label: 'Monthly Waste', value: formatCurrency(data.analysis.totalMonthlyWaste, data.currency) },
            { cls: 'bg-info', label: 'Annual Waste', value: formatCurrency(data.analysis.totalAnnualWaste, data.currency) }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, item.value));
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = el('div', 'analytics-grid');

        // Overlaps by Rule card
        var ruleRows = [];
        var maxRuleCount = 1;
        Object.keys(data.analysis.ruleStats).forEach(function(ruleName) {
            var stat = data.analysis.ruleStats[ruleName];
            if (stat.count > maxRuleCount) maxRuleCount = stat.count;
        });
        Object.keys(data.analysis.ruleStats).forEach(function(ruleName) {
            var stat = data.analysis.ruleStats[ruleName];
            if (stat.count > 0) {
                ruleRows.push({
                    name: ruleName,
                    count: stat.count,
                    pct: Math.round((stat.count / maxRuleCount) * 100),
                    cls: 'bg-critical',
                    showCount: true
                });
            }
        });
        if (ruleRows.length > 0) {
            analyticsGrid.appendChild(createPlatformCard('Overlaps by Rule', ruleRows));
        }

        // Top Departments card
        var depts = Object.keys(data.analysis.deptOverlaps).sort(function(a, b) {
            return data.analysis.deptOverlaps[b].count - data.analysis.deptOverlaps[a].count;
        }).slice(0, 4);
        var maxDept = depts.length > 0 ? data.analysis.deptOverlaps[depts[0]].count : 1;
        var deptRows = depts.map(function(dept) {
            return {
                name: dept.substring(0, 20),
                count: data.analysis.deptOverlaps[dept].count,
                pct: Math.round((data.analysis.deptOverlaps[dept].count / maxDept) * 100),
                cls: 'bg-warning',
                showCount: true
            };
        });
        if (deptRows.length > 0) {
            analyticsGrid.appendChild(createPlatformCard('Top Departments', deptRows));
        }

        // Cost Impact card
        analyticsGrid.appendChild(createPlatformCard('Cost Impact', [
            { name: 'Monthly Waste', count: formatCurrency(data.analysis.totalMonthlyWaste, data.currency), pct: 100, cls: 'bg-critical', showCount: true },
            { name: 'Annual Waste', count: formatCurrency(data.analysis.totalAnnualWaste, data.currency), pct: 100, cls: 'bg-critical', showCount: true },
            { name: 'Avg per User', count: formatCurrency(data.analysis.totalOverlapCount > 0 ? Math.round(data.analysis.totalMonthlyWaste / data.analysis.totalOverlapCount) : 0, data.currency), pct: 50, cls: 'bg-warning', showCount: true }
        ]));

        // Overlap Rules Checked card
        var rulesChecked = OVERLAP_RULES.length;
        var rulesTriggered = Object.keys(data.analysis.ruleStats).filter(function(r) { return data.analysis.ruleStats[r].count > 0; }).length;
        analyticsGrid.appendChild(createPlatformCard('Rules Analysis', [
            { name: 'Rules Checked', count: rulesChecked, pct: 100, cls: 'bg-info', showCount: true },
            { name: 'Rules Triggered', count: rulesTriggered, pct: Math.round((rulesTriggered / rulesChecked) * 100), cls: rulesTriggered > 0 ? 'bg-warning' : 'bg-success', showCount: true },
            { name: 'Affected Users', count: data.analysis.totalOverlapCount, pct: overlapPct, cls: 'bg-critical', showCount: true }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = el('div', 'insights-list');

        if (data.analysis.totalOverlapCount > 0) {
            // Main overlap insight
            insightsList.appendChild(createInsightCard('critical', 'SAVINGS', 'Cost Optimization Opportunity',
                data.analysis.totalOverlapCount + ' users have redundant licenses that could save ' + formatCurrency(data.analysis.totalAnnualWaste, data.currency) + ' annually.',
                'Remove redundant lower-tier licenses from users who already have higher-tier coverage.'));

            // Top rule insight
            var topRule = Object.keys(data.analysis.ruleStats).reduce(function(max, r) {
                return data.analysis.ruleStats[r].count > (max ? data.analysis.ruleStats[max].count : 0) ? r : max;
            }, null);
            if (topRule && data.analysis.ruleStats[topRule].count > 0) {
                insightsList.appendChild(createInsightCard('warning', 'TOP ISSUE', 'Most Common Overlap',
                    'The "' + topRule + '" overlap affects ' + data.analysis.ruleStats[topRule].count + ' users.',
                    'Focus cleanup efforts on this license combination first.'));
            }

            // Department insight
            if (depts.length > 0) {
                var topDept = depts[0];
                insightsList.appendChild(createInsightCard('info', 'DEPARTMENT', 'Highest Impact Department',
                    topDept + ' has ' + data.analysis.deptOverlaps[topDept].count + ' users with overlapping licenses.',
                    'Coordinate with department managers to review and clean up license assignments.'));
            }
        } else {
            // Healthy state
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'No Overlaps Detected',
                'All users have optimized license assignments with no redundant licenses detected.',
                null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Applies filters and renders the overlaps table.
     */
    function applyFilters() {
        var data = analysisState.analysis.overlapUsers;

        // Search filter
        var search = Filters.getValue('overlaps-search');
        if (search) {
            var term = search.toLowerCase();
            data = data.filter(function(o) {
                return (o.user.displayName && o.user.displayName.toLowerCase().indexOf(term) !== -1) ||
                       (o.user.userPrincipalName && o.user.userPrincipalName.toLowerCase().indexOf(term) !== -1) ||
                       (o.user.department && o.user.department.toLowerCase().indexOf(term) !== -1);
            });
        }

        // Rule filter
        var ruleFilter = Filters.getValue('overlaps-rule');
        if (ruleFilter && ruleFilter !== 'all') {
            data = data.filter(function(o) { return o.rule === ruleFilter; });
        }

        // Department filter
        var deptFilter = Filters.getValue('overlaps-dept');
        if (deptFilter && deptFilter !== 'all') {
            data = data.filter(function(o) { return (o.user.department || 'Unassigned') === deptFilter; });
        }

        renderTable(data);
    }

    /**
     * Renders the overlaps table.
     */
    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'department', 'rule', 'higherLicense', 'lowerLicense', 'redundantCost'];

        var allDefs = [
            { key: 'displayName', label: 'User' },
            { key: 'userPrincipalName', label: 'Email', className: 'cell-truncate' },
            { key: 'department', label: 'Department' },
            { key: 'rule', label: 'Overlap Rule' },
            { key: 'higherLicense', label: 'Keeps' },
            { key: 'lowerLicense', label: 'Redundant' },
            { key: 'redundantCost', label: 'Monthly Waste', className: 'cell-right', formatter: formatCostCell }
        ];

        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        var tableData = data.map(function(o) {
            return {
                displayName: o.user.displayName,
                userPrincipalName: o.user.userPrincipalName,
                department: o.user.department || 'Unassigned',
                rule: o.rule,
                higherLicense: o.higherLicense,
                lowerLicense: o.lowerLicense,
                redundantCost: o.redundantCost
            };
        });

        Tables.render({
            containerId: 'overlaps-table',
            data: tableData,
            columns: columns,
            pageSize: 25
        });

        // Update count
        var countDiv = document.getElementById('overlaps-count');
        if (countDiv) {
            countDiv.textContent = data.length + ' user' + (data.length !== 1 ? 's' : '') + ' with overlaps';
        }
    }

    function formatCostCell(value) {
        if (!value || value === 0) return '<span class="text-muted">0</span>';
        return '<span class="text-critical font-bold">' + formatCurrency(value, analysisState.currency) + '</span>';
    }

    /**
     * Renders the Overlaps tab with unified table.
     */
    function renderOverlapsTab(container) {
        container.textContent = '';

        if (analysisState.analysis.totalOverlapCount === 0) {
            var emptyDiv = el('div', 'empty-state');
            emptyDiv.appendChild(el('div', 'empty-state-icon', '✓'));
            emptyDiv.appendChild(el('div', 'empty-state-title', 'No License Overlaps Detected'));
            emptyDiv.appendChild(el('div', 'empty-state-description', 'All users have optimized license assignments.'));
            container.appendChild(emptyDiv);
            return;
        }

        // Get unique rules and departments for filters
        var rules = Object.keys(analysisState.analysis.ruleStats).filter(function(r) {
            return analysisState.analysis.ruleStats[r].count > 0;
        });
        var depts = Object.keys(analysisState.analysis.deptOverlaps);

        // Filters
        var filterDiv = el('div');
        filterDiv.id = 'overlaps-filter';
        container.appendChild(filterDiv);

        // Table toolbar
        var toolbar = el('div', 'table-toolbar');
        var colSelectorDiv = el('div');
        colSelectorDiv.id = 'overlaps-col-selector';
        toolbar.appendChild(colSelectorDiv);
        var exportBtn = el('button', 'btn btn-secondary btn-sm', 'Export CSV');
        exportBtn.id = 'export-overlaps-table';
        toolbar.appendChild(exportBtn);
        container.appendChild(toolbar);

        // Count
        var countDiv = el('div', 'table-count');
        countDiv.id = 'overlaps-count';
        container.appendChild(countDiv);

        // Table
        var tableDiv = el('div');
        tableDiv.id = 'overlaps-table';
        container.appendChild(tableDiv);

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'overlaps-filter',
            controls: [
                { type: 'search', id: 'overlaps-search', label: 'Search', placeholder: 'Search users...' },
                { type: 'select', id: 'overlaps-rule', label: 'Overlap Rule', options: [
                    { value: 'all', label: 'All Rules' }
                ].concat(rules.map(function(r) { return { value: r, label: r }; })) },
                { type: 'select', id: 'overlaps-dept', label: 'Department', options: [
                    { value: 'all', label: 'All Departments' }
                ].concat(depts.map(function(d) { return { value: d, label: d }; })) }
            ],
            onFilter: applyFilters
        });

        // Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'overlaps-col-selector',
                storageKey: 'tenantscope-overlaps-columns',
                allColumns: [
                    { key: 'displayName', label: 'User' },
                    { key: 'userPrincipalName', label: 'Email' },
                    { key: 'department', label: 'Department' },
                    { key: 'rule', label: 'Overlap Rule' },
                    { key: 'higherLicense', label: 'Keeps' },
                    { key: 'lowerLicense', label: 'Redundant' },
                    { key: 'redundantCost', label: 'Monthly Waste' }
                ],
                defaultVisible: ['displayName', 'department', 'rule', 'higherLicense', 'lowerLicense', 'redundantCost'],
                onColumnsChanged: applyFilters
            });
        }

        // Bind export
        document.getElementById('export-overlaps-table').addEventListener('click', function() {
            var exportData = analysisState.analysis.overlapUsers.map(function(o) {
                return {
                    Name: o.user.displayName,
                    Email: o.user.userPrincipalName,
                    Department: o.user.department || '',
                    OverlapRule: o.rule,
                    HigherLicense: o.higherLicense,
                    RedundantLicense: o.lowerLicense,
                    MonthlyCost: o.redundantCost
                };
            });
            Export.toCSV(exportData, 'tenantscope-license-overlaps.csv');
        });

        // Initial render
        applyFilters();
    }

    /**
     * Creates a summary card.
     */
    function createSummaryCard(label, value, valueClass, cardClass) {
        var card = el('div', 'card' + (cardClass ? ' ' + cardClass : ''));
        card.appendChild(el('div', 'card-label', label));
        var valDiv = el('div', 'card-value' + (valueClass ? ' ' + valueClass : ''));
        valDiv.textContent = typeof value === 'number' ? value.toLocaleString() : value;
        card.appendChild(valDiv);
        return card;
    }

    /**
     * Renders the page.
     */
    function render(container) {
        var users = DataLoader.getData('users') || [];
        var licenses = DataLoader.getData('licenseSkus') || [];

        if (typeof DepartmentFilter !== 'undefined') {
            users = DepartmentFilter.filterData(users, 'department');
        }

        var analysis = analyzeOverlaps(users, licenses);
        var currency = licenses.length > 0 && licenses[0].currency ? licenses[0].currency : 'USD';

        // Cache state
        analysisState = {
            analysis: analysis,
            currency: currency,
            totalUsers: users.length
        };

        container.textContent = '';

        // Page header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'License Overlap Analysis'));
        header.appendChild(el('p', 'page-description', 'Identify users with redundant license assignments and potential cost savings'));
        container.appendChild(header);

        // Summary cards
        var cards = el('div', 'summary-cards');
        cards.appendChild(createSummaryCard('Users with Overlaps', analysis.totalOverlapCount, analysis.totalOverlapCount > 0 ? 'warning' : 'success', analysis.totalOverlapCount > 0 ? 'card-warning' : 'card-success'));
        cards.appendChild(createSummaryCard('Monthly Waste', formatCurrency(analysis.totalMonthlyWaste, currency), analysis.totalMonthlyWaste > 0 ? 'critical' : null, analysis.totalMonthlyWaste > 0 ? 'card-critical' : null));
        cards.appendChild(createSummaryCard('Annual Waste', formatCurrency(analysis.totalAnnualWaste, currency), analysis.totalAnnualWaste > 0 ? 'critical' : null, analysis.totalAnnualWaste > 0 ? 'card-critical' : null));
        cards.appendChild(createSummaryCard('Rules Checked', OVERLAP_RULES.length, null, null));
        container.appendChild(cards);

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'overlaps', label: 'All Overlaps (' + analysis.totalOverlapCount + ')' }
        ];
        tabs.forEach(function(t) {
            var btn = el('button', 'tab-btn' + (t.id === 'overview' ? ' active' : ''));
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            tabBar.appendChild(btn);
        });
        container.appendChild(tabBar);

        // Content area
        var contentArea = el('div', 'content-area');
        contentArea.id = 'analysis-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();
