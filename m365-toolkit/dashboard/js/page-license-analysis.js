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
        OVERLAP_RULES.forEach(function(r) { ruleStats[r.name] = { count: 0, users: [] }; });

        users.forEach(function(user) {
            // Ensure assignedSkuIds is an array with at least 2 items
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

        container.textContent = '';

        // Page header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'License Overlap Analysis'));
        header.appendChild(el('p', 'page-description', 'Identify users with redundant license assignments and potential cost savings'));
        container.appendChild(header);

        // Summary cards
        var cards = el('div', 'summary-cards');
        cards.appendChild(createCard('Users with Overlaps', analysis.totalOverlapCount, analysis.totalOverlapCount > 0 ? 'warning' : 'success'));
        cards.appendChild(createCard('Monthly Waste', formatCurrency(analysis.totalMonthlyWaste, currency), 'danger'));
        cards.appendChild(createCard('Annual Waste', formatCurrency(analysis.totalAnnualWaste, currency), 'danger'));
        cards.appendChild(createCard('Overlap Rules Checked', OVERLAP_RULES.length, 'info'));
        container.appendChild(cards);

        // Alert if overlaps found
        if (analysis.totalOverlapCount > 0) {
            var alert = el('div', 'alert-box alert-warning');
            var strong = el('strong', null, 'Cost Optimization Opportunity: ');
            alert.appendChild(strong);
            alert.appendChild(document.createTextNode(
                analysis.totalOverlapCount + ' users have redundant licenses that could save ' +
                formatCurrency(analysis.totalAnnualWaste, currency) + ' annually.'
            ));
            container.appendChild(alert);
        }

        // Charts row
        var chartsRow = el('div', 'charts-row');
        chartsRow.id = 'license-charts-row';
        container.appendChild(chartsRow);

        // Render charts using DashboardCharts
        renderCharts(analysis, currency, chartsRow);

        // Focus/Breakdown section
        var fbRow = el('div', 'focus-breakdown-row');

        var focusPanel = el('div', 'focus-panel');
        focusPanel.appendChild(el('h3', 'panel-title', 'Focus: Overlap Rules'));
        var focusTable = el('div');
        focusTable.id = 'overlap-rules-table';
        focusPanel.appendChild(focusTable);
        fbRow.appendChild(focusPanel);

        var breakdownPanel = el('div', 'breakdown-panel');
        breakdownPanel.appendChild(el('h3', 'panel-title', 'Breakdown: Department Waste'));
        var breakdownTable = el('div');
        breakdownTable.id = 'dept-waste-table';
        breakdownPanel.appendChild(breakdownTable);
        fbRow.appendChild(breakdownPanel);

        container.appendChild(fbRow);

        // Users with overlaps table
        var tableSection = el('div', 'table-section');
        var tableHeader = el('div', 'table-header');
        tableHeader.appendChild(el('h3', 'table-title', 'Users with Redundant Licenses (' + analysis.totalOverlapCount + ')'));
        var tableActions = el('div', 'table-actions');
        var exportBtn = el('button', 'btn btn-secondary', 'Export CSV');
        exportBtn.id = 'export-overlaps-btn';
        tableActions.appendChild(exportBtn);
        tableHeader.appendChild(tableActions);
        tableSection.appendChild(tableHeader);
        var tableDiv = el('div');
        tableDiv.id = 'overlaps-table';
        tableSection.appendChild(tableDiv);
        container.appendChild(tableSection);

        // Render focus tables
        renderOverlapRulesTable(analysis.ruleStats);
        renderDeptWasteTable(analysis.deptOverlaps, currency);

        // Render main table
        renderOverlapsTable(analysis.overlapUsers, currency);

        // Export button
        document.getElementById('export-overlaps-btn').addEventListener('click', function() {
            var exportData = analysis.overlapUsers.map(function(o) {
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
    }

    function createCard(label, value, variant) {
        var card = el('div', 'summary-card card-' + variant);
        var valDiv = el('div', 'card-value');
        valDiv.textContent = typeof value === 'number' ? value.toLocaleString() : value;
        card.appendChild(valDiv);
        card.appendChild(el('div', 'card-label', label));
        return card;
    }

    function formatCurrency(value, currency) {
        return value.toLocaleString() + ' ' + currency;
    }

    /**
     * Renders both charts using DashboardCharts.createChartCard.
     */
    function renderCharts(analysis, currency, chartsRow) {
        if (typeof DashboardCharts === 'undefined') return;

        var colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

        // Overlaps by Rule chart
        var ruleData = [];
        var i = 0;
        Object.keys(analysis.ruleStats).forEach(function(ruleName) {
            var stat = analysis.ruleStats[ruleName];
            if (stat.count > 0) {
                ruleData.push({
                    label: ruleName,
                    value: stat.count,
                    color: colors[i % colors.length]
                });
                i++;
            }
        });

        var ruleTotal = ruleData.reduce(function(sum, d) { return sum + d.value; }, 0);

        if (ruleData.length > 0) {
            var ruleCard = DashboardCharts.createChartCard(
                'Overlaps by Rule',
                ruleData,
                String(ruleTotal),
                'Overlaps',
                { size: 200, strokeWidth: 28 }
            );
            chartsRow.appendChild(ruleCard);
        } else {
            var emptyRule = el('div', 'chart-container');
            emptyRule.appendChild(el('div', 'chart-title', 'Overlaps by Rule'));
            emptyRule.appendChild(el('div', 'empty-state-small', 'No overlaps detected'));
            chartsRow.appendChild(emptyRule);
        }

        // Overlaps by Department chart
        var deptColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        var deptData = [];
        var depts = Object.keys(analysis.deptOverlaps).sort(function(a, b) {
            return analysis.deptOverlaps[b].count - analysis.deptOverlaps[a].count;
        }).slice(0, 5);

        depts.forEach(function(dept, idx) {
            deptData.push({
                label: dept,
                value: analysis.deptOverlaps[dept].count,
                color: deptColors[idx % deptColors.length]
            });
        });

        var deptTotal = deptData.reduce(function(sum, d) { return sum + d.value; }, 0);

        if (deptData.length > 0) {
            var deptCard = DashboardCharts.createChartCard(
                'Overlaps by Department',
                deptData,
                String(deptTotal),
                'Users',
                { size: 200, strokeWidth: 28 }
            );
            chartsRow.appendChild(deptCard);
        } else {
            var emptyDept = el('div', 'chart-container');
            emptyDept.appendChild(el('div', 'chart-title', 'Overlaps by Department'));
            emptyDept.appendChild(el('div', 'empty-state-small', 'No department data'));
            chartsRow.appendChild(emptyDept);
        }
    }

    function renderOverlapRulesTable(ruleStats) {
        var container = document.getElementById('overlap-rules-table');
        if (!container) return;

        var table = document.createElement('table');
        table.className = 'data-table focus-table';

        var thead = document.createElement('thead');
        var headerRow = document.createElement('tr');
        ['Overlap Rule', 'Users', '%'].forEach(function(h) {
            var th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        var total = 0;
        Object.values(ruleStats).forEach(function(s) { total += s.count; });

        Object.keys(ruleStats).forEach(function(ruleName) {
            var stat = ruleStats[ruleName];
            if (stat.count === 0) return;

            var tr = document.createElement('tr');
            var pct = total > 0 ? Math.round((stat.count / total) * 100) : 0;

            [ruleName, stat.count, pct + '%'].forEach(function(val) {
                var td = document.createElement('td');
                td.textContent = val;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        if (tbody.children.length === 0) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = 3;
            td.textContent = 'No overlaps detected';
            td.className = 'text-muted';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        container.appendChild(table);
    }

    function renderDeptWasteTable(deptOverlaps, currency) {
        var container = document.getElementById('dept-waste-table');
        if (!container) return;

        var table = document.createElement('table');
        table.className = 'data-table breakdown-table';

        var thead = document.createElement('thead');
        var headerRow = document.createElement('tr');
        ['Department', 'Users', 'Monthly Waste', 'Annual Waste'].forEach(function(h) {
            var th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        var depts = Object.keys(deptOverlaps).sort(function(a, b) {
            return deptOverlaps[b].cost - deptOverlaps[a].cost;
        });

        var totals = { count: 0, monthly: 0 };

        depts.forEach(function(dept) {
            var data = deptOverlaps[dept];
            var tr = document.createElement('tr');

            var cells = [
                dept,
                data.count,
                formatCurrency(data.cost, currency),
                formatCurrency(data.cost * 12, currency)
            ];

            cells.forEach(function(val, idx) {
                var td = document.createElement('td');
                if (idx >= 2) td.className = 'text-danger';
                td.textContent = val;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);

            totals.count += data.count;
            totals.monthly += data.cost;
        });

        // Totals row
        var totalRow = document.createElement('tr');
        totalRow.className = 'totals-row';
        ['Total', totals.count, formatCurrency(totals.monthly, currency), formatCurrency(totals.monthly * 12, currency)].forEach(function(val) {
            var td = document.createElement('td');
            var strong = document.createElement('strong');
            strong.textContent = val;
            td.appendChild(strong);
            totalRow.appendChild(td);
        });
        tbody.appendChild(totalRow);

        table.appendChild(tbody);
        container.appendChild(table);
    }

    function renderOverlapsTable(overlapUsers, currency) {
        var container = document.getElementById('overlaps-table');
        if (!container) return;

        if (overlapUsers.length === 0) {
            var emptyDiv = el('div', 'empty-state');
            emptyDiv.appendChild(el('div', 'empty-state-icon', ''));
            emptyDiv.appendChild(el('div', 'empty-state-title', 'No License Overlaps Detected'));
            emptyDiv.appendChild(el('div', 'empty-state-description', 'All users have optimized license assignments.'));
            container.appendChild(emptyDiv);
            return;
        }

        var columns = [
            { key: 'displayName', label: 'User', sortable: true },
            { key: 'department', label: 'Department', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'rule', label: 'Overlap', sortable: true },
            { key: 'higherLicense', label: 'Keeps', sortable: true },
            { key: 'lowerLicense', label: 'Redundant', sortable: true },
            { key: 'redundantCost', label: 'Monthly Waste', sortable: true, formatter: function(v) {
                return '<span class="text-danger">' + formatCurrency(v, currency) + '</span>';
            }}
        ];

        var tableData = overlapUsers.map(function(o) {
            return {
                displayName: o.user.displayName,
                userPrincipalName: o.user.userPrincipalName,
                department: o.user.department,
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
            pageSize: 20,
            sortable: true,
            defaultSort: { column: 'redundantCost', direction: 'desc' }
        });
    }

    return { render: render };
})();
