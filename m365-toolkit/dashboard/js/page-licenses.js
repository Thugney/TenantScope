/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: LICENSES
 *
 * Renders the licenses page showing SKU allocation and waste analysis.
 * Helps identify underutilized licenses and waste.
 */

const PageLicenses = (function() {
    'use strict';

    /** Current tab */
    var currentTab = 'overview';

    /** Cached page state */
    var licensesState = null;

    /** Column selector instance */
    var colSelector = null;

    /**
     * Creates an element with className and textContent.
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
     * Formats a number as currency.
     */
    function formatCurrency(value, curr) {
        if (!value && value !== 0) return '--';
        var sym = curr === 'NOK' ? 'kr' : curr === 'USD' ? '$' : curr === 'EUR' ? '€' : '';
        return sym + ' ' + value.toLocaleString();
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
        var container = document.getElementById('licenses-content');
        if (!container || !licensesState) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'licenses':
                renderLicensesTab(container);
                break;
        }
    }

    /**
     * Renders the Overview tab with analytics.
     */
    function renderOverviewTab(container) {
        container.textContent = '';
        var data = licensesState;

        // Calculate healthy percentage
        var utilizationPct = data.avgUtilization;
        var wastePct = data.totals.purchased > 0 ? Math.round((data.totals.waste / data.totals.purchased) * 100) : 0;

        // Build analytics section with donut chart
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'License Utilization Overview'));

        var complianceOverview = el('div', 'compliance-overview');

        // Donut chart
        var chartContainer = el('div', 'compliance-chart');
        var donutDiv = el('div', 'donut-chart');

        var circumference = 2 * Math.PI * 40;
        var activeUse = data.totals.assigned - data.totals.waste;
        var total = data.totals.purchased || 1;
        var activePct = Math.round((activeUse / total) * 100);
        var wastedPct = Math.round((data.totals.waste / total) * 100);
        var availablePct = 100 - activePct - wastedPct;

        var activeDash = (activePct / 100) * circumference;
        var wasteDash = (wastedPct / 100) * circumference;
        var availDash = (availablePct / 100) * circumference;

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

        var offset = 0;
        if (activePct > 0) {
            var activeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            activeCircle.setAttribute('cx', '50');
            activeCircle.setAttribute('cy', '50');
            activeCircle.setAttribute('r', '40');
            activeCircle.setAttribute('fill', 'none');
            activeCircle.setAttribute('stroke', 'var(--color-success)');
            activeCircle.setAttribute('stroke-width', '12');
            activeCircle.setAttribute('stroke-dasharray', activeDash + ' ' + circumference);
            activeCircle.setAttribute('stroke-dashoffset', String(-offset));
            activeCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(activeCircle);
            offset += activeDash;
        }
        if (wastedPct > 0) {
            var wasteCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            wasteCircle.setAttribute('cx', '50');
            wasteCircle.setAttribute('cy', '50');
            wasteCircle.setAttribute('r', '40');
            wasteCircle.setAttribute('fill', 'none');
            wasteCircle.setAttribute('stroke', 'var(--color-critical)');
            wasteCircle.setAttribute('stroke-width', '12');
            wasteCircle.setAttribute('stroke-dasharray', wasteDash + ' ' + circumference);
            wasteCircle.setAttribute('stroke-dashoffset', String(-offset));
            wasteCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(wasteCircle);
            offset += wasteDash;
        }
        if (availablePct > 0) {
            var availCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            availCircle.setAttribute('cx', '50');
            availCircle.setAttribute('cy', '50');
            availCircle.setAttribute('r', '40');
            availCircle.setAttribute('fill', 'none');
            availCircle.setAttribute('stroke', 'var(--color-warning)');
            availCircle.setAttribute('stroke-width', '12');
            availCircle.setAttribute('stroke-dasharray', availDash + ' ' + circumference);
            availCircle.setAttribute('stroke-dashoffset', String(-offset));
            availCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(availCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = el('div', 'donut-center');
        donutCenter.appendChild(el('span', 'donut-value', utilizationPct + '%'));
        donutCenter.appendChild(el('span', 'donut-label', 'Utilization'));
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = el('div', 'compliance-legend');
        var legendItems = [
            { cls: 'bg-success', label: 'Active Use', value: activeUse.toLocaleString() },
            { cls: 'bg-critical', label: 'Wasted', value: data.totals.waste.toLocaleString() },
            { cls: 'bg-warning', label: 'Available', value: (data.totals.purchased - data.totals.assigned).toLocaleString() }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, item.value));
            legend.appendChild(legendItem);
        });
        var metricItem = el('div', 'legend-item');
        metricItem.appendChild(document.createTextNode('Total Purchased: '));
        metricItem.appendChild(el('strong', null, data.totals.purchased.toLocaleString()));
        legend.appendChild(metricItem);
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = el('div', 'analytics-grid');

        // Cost Analysis card
        analyticsGrid.appendChild(createPlatformCard('Cost Analysis', [
            { name: 'Total Monthly Cost', count: formatCurrency(data.totals.totalCost, data.currency), pct: 100, cls: 'bg-info', showCount: true },
            { name: 'Waste Monthly Cost', count: formatCurrency(data.totals.wasteCost, data.currency), pct: data.savingsPct, cls: 'bg-critical', showCount: true },
            { name: 'Avg Cost/User', count: formatCurrency(data.avgCost, data.currency), pct: 50, cls: 'bg-neutral', showCount: true }
        ]));

        // Waste Breakdown card
        analyticsGrid.appendChild(createPlatformCard('Waste Breakdown', [
            { name: 'Disabled Users', count: data.disabledWaste, pct: data.totals.waste > 0 ? Math.round((data.disabledWaste / data.totals.waste) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'Inactive Users', count: data.inactiveWaste, pct: data.totals.waste > 0 ? Math.round((data.inactiveWaste / data.totals.waste) * 100) : 0, cls: 'bg-orange', showCount: true }
        ]));

        // SKU Status card
        var skusWithWaste = data.licenses.filter(function(l) { return l.wasteCount > 0; }).length;
        var skusWithOverlap = data.licenses.filter(function(l) { return (l.overlapCount || 0) > 0; }).length;
        analyticsGrid.appendChild(createPlatformCard('SKU Status', [
            { name: 'Total SKUs', count: data.licenses.length, pct: 100, cls: 'bg-info', showCount: true },
            { name: 'SKUs with Waste', count: skusWithWaste, pct: data.licenses.length > 0 ? Math.round((skusWithWaste / data.licenses.length) * 100) : 0, cls: 'bg-warning', showCount: true },
            { name: 'SKUs with Overlap', count: skusWithOverlap, pct: data.licenses.length > 0 ? Math.round((skusWithOverlap / data.licenses.length) * 100) : 0, cls: 'bg-critical', showCount: true }
        ]));

        // Top Wasted SKUs card
        var topWasted = data.licenses.slice().sort(function(a, b) { return b.wasteCount - a.wasteCount; }).slice(0, 4);
        var maxWaste = topWasted.length > 0 ? topWasted[0].wasteCount : 1;
        analyticsGrid.appendChild(createPlatformCard('Top Wasted SKUs', topWasted.map(function(sku) {
            return { name: sku.skuName.substring(0, 25), count: sku.wasteCount, pct: Math.round((sku.wasteCount / maxWaste) * 100), cls: 'bg-critical', showCount: true };
        })));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = el('div', 'insights-list');

        // Waste insight
        if (data.totals.waste > 0) {
            insightsList.appendChild(createInsightCard('warning', 'WASTE', 'License Waste Detected',
                data.totals.waste + ' licenses (' + wastePct + '%) are assigned to disabled or inactive users, costing ' + formatCurrency(data.totals.wasteCost, data.currency) + '/month.',
                'Remove licenses from disabled accounts and review inactive user assignments.'));
        }

        // Overlap insight
        if (data.totals.overlapCount > 0) {
            insightsList.appendChild(createInsightCard('critical', 'OVERLAP', 'License Overlaps',
                data.totals.overlapCount + ' users have overlapping licenses. Consider consolidating to higher-tier licenses.',
                'Review the License Analysis page for detailed overlap detection.'));
        }

        // Low utilization insight
        var lowUtilSkus = data.licenses.filter(function(l) { return l.utilizationPercent < 50 && l.totalPurchased > 10; });
        if (lowUtilSkus.length > 0) {
            insightsList.appendChild(createInsightCard('info', 'REVIEW', 'Low Utilization',
                lowUtilSkus.length + ' license SKU' + (lowUtilSkus.length !== 1 ? 's have' : ' has') + ' less than 50% utilization.',
                'Consider reducing license quantities or reassigning to other users.'));
        }

        // Healthy state
        if (data.totals.waste === 0 && utilizationPct >= 80) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'License Health',
                'License utilization is healthy at ' + utilizationPct + '% with no detected waste.',
                null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Applies filters and renders the licenses table.
     */
    function applyFilters() {
        var licenses = licensesState.licenses;

        var filterConfig = {
            search: Filters.getValue('licenses-search'),
            searchFields: ['skuName', 'skuPartNumber']
        };

        var filteredData = Filters.apply(licenses, filterConfig);

        // Apply waste filter
        var wasteFilter = Filters.getValue('licenses-waste-filter');
        if (wasteFilter === 'waste') {
            filteredData = filteredData.filter(function(sku) { return sku.wasteCount > 0; });
        } else if (wasteFilter === 'overlap') {
            filteredData = filteredData.filter(function(sku) { return (sku.overlapCount || 0) > 0; });
        }

        renderTable(filteredData);
    }

    /**
     * Renders the licenses table with dynamic columns.
     */
    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['skuName', 'totalPurchased', 'totalAssigned', 'available', 'wasteCount', 'overlapCount', 'estimatedMonthlyCost', 'wasteMonthlyCost', 'utilizationPercent'];

        var allDefs = [
            { key: 'skuName', label: 'License Name' },
            { key: 'skuPartNumber', label: 'Part Number', className: 'cell-truncate' },
            { key: 'totalPurchased', label: 'Purchased', className: 'cell-right' },
            { key: 'totalAssigned', label: 'Assigned', className: 'cell-right' },
            { key: 'available', label: 'Available', className: 'cell-right' },
            { key: 'assignedToDisabled', label: 'Disabled', className: 'cell-right', formatter: formatWasteCell },
            { key: 'assignedToInactive', label: 'Inactive', className: 'cell-right', formatter: formatWasteCell },
            { key: 'wasteCount', label: 'Total Waste', className: 'cell-right', formatter: formatWasteCell },
            { key: 'overlapCount', label: 'Overlap', className: 'cell-right', formatter: formatOverlapCell },
            { key: 'estimatedMonthlyCost', label: 'Monthly Cost', className: 'cell-right', formatter: function(v, row) { return v ? formatCurrency(v, (row && row.currency) || licensesState.currency) : '<span class="text-muted">--</span>'; } },
            { key: 'wasteMonthlyCost', label: 'Waste Cost', className: 'cell-right', formatter: formatCostCell },
            { key: 'potentialSavingsPercent', label: 'Savings %', className: 'cell-right', formatter: formatSavingsCell },
            { key: 'averageCostPerUser', label: 'Avg Cost/User', className: 'cell-right', formatter: function(v, row) { return v ? formatCurrency(v, (row && row.currency) || licensesState.currency) : '<span class="text-muted">--</span>'; } },
            { key: 'billedUsers', label: 'Billed Users', className: 'cell-right' },
            { key: 'utilizationPercent', label: 'Utilization', formatter: Tables.formatters.percentage }
        ];

        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'licenses-table',
            data: data,
            columns: columns,
            pageSize: 50,
            onRowClick: showLicenseDetails
        });

        // Update count
        var countDiv = document.getElementById('licenses-count');
        if (countDiv) {
            countDiv.textContent = data.length + ' license SKU' + (data.length !== 1 ? 's' : '');
        }
    }

    function formatWasteCell(value) {
        if (!value || value === 0) return '<span class="text-muted">0</span>';
        return '<span class="text-warning font-bold">' + value + '</span>';
    }

    function formatOverlapCell(value) {
        if (!value || value === 0) return '<span class="text-muted">0</span>';
        return '<span class="text-critical font-bold">' + value + '</span>';
    }

    function formatSavingsCell(value) {
        if (!value || value === 0) return '<span class="text-muted">0%</span>';
        return '<span class="text-warning font-bold">' + value + '%</span>';
    }

    function formatCostCell(value, row) {
        if (!value || value === 0) return '<span class="text-muted">kr 0</span>';
        var curr = (row && row.currency) || licensesState.currency;
        return '<span class="text-critical font-bold">' + formatCurrency(value, curr) + '</span>';
    }

    /**
     * Shows detailed modal for a license SKU using safe DOM methods.
     */
    function showLicenseDetails(sku) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = sku.skuName;
        body.textContent = '';

        var curr = sku.currency || licensesState.currency;

        // SKU Info section
        var infoList = el('div', 'detail-list');
        appendDetailRow(infoList, 'SKU Name:', sku.skuName);
        appendDetailRow(infoList, 'Part Number:', sku.skuPartNumber);
        var skuIdSpan = el('span', 'detail-value');
        skuIdSpan.style.fontSize = '0.8em';
        skuIdSpan.textContent = sku.skuId;
        appendDetailRowWithElement(infoList, 'SKU ID:', skuIdSpan);
        body.appendChild(infoList);

        // Allocation section
        body.appendChild(el('h4', 'mt-lg mb-sm', 'Allocation'));
        var allocList = el('div', 'detail-list');
        appendDetailRow(allocList, 'Total Purchased:', sku.totalPurchased);
        appendDetailRow(allocList, 'Total Assigned:', sku.totalAssigned);
        appendDetailRow(allocList, 'Available:', sku.available);
        appendDetailRow(allocList, 'Utilization:', sku.utilizationPercent + '%');
        body.appendChild(allocList);

        // Waste Analysis section
        body.appendChild(el('h4', 'mt-lg mb-sm', 'Waste Analysis'));
        var wasteList = el('div', 'detail-list');
        appendDetailRow(wasteList, 'Assigned to Enabled:', sku.assignedToEnabled, 'text-success');
        appendDetailRow(wasteList, 'Assigned to Disabled:', sku.assignedToDisabled, sku.assignedToDisabled > 0 ? 'text-warning' : '');
        appendDetailRow(wasteList, 'Assigned to Inactive:', sku.assignedToInactive, sku.assignedToInactive > 0 ? 'text-warning' : '');
        appendDetailRow(wasteList, 'Total Waste:', sku.wasteCount, sku.wasteCount > 0 ? 'text-critical font-bold' : '');
        body.appendChild(wasteList);

        // Overlap Detection section
        body.appendChild(el('h4', 'mt-lg mb-sm', 'Overlap Detection'));
        var overlapList = el('div', 'detail-list');
        appendDetailRow(overlapList, 'Overlapping Users:', sku.overlapCount || 0, (sku.overlapCount || 0) > 0 ? 'text-warning font-bold' : '');
        appendDetailRow(overlapList, 'Overlaps With:', sku.overlapSkuName || 'None');
        appendDetailRow(overlapList, 'Potential Savings:', (sku.potentialSavingsPercent || 0) + '%');
        body.appendChild(overlapList);

        // Cost Analysis section
        body.appendChild(el('h4', 'mt-lg mb-sm', 'Cost Analysis'));
        var costList = el('div', 'detail-list');
        appendDetailRow(costList, 'Cost per License:', sku.monthlyCostPerLicense ? formatCurrency(sku.monthlyCostPerLicense, curr) + '/mo' : 'Not configured');
        appendDetailRow(costList, 'Estimated Monthly Cost:', formatCurrency(sku.estimatedMonthlyCost || 0, curr));
        appendDetailRow(costList, 'Monthly Waste Cost:', formatCurrency(sku.wasteMonthlyCost || 0, curr), (sku.wasteMonthlyCost || 0) > 0 ? 'text-critical font-bold' : '');
        appendDetailRow(costList, 'Annual Waste Cost:', formatCurrency((sku.wasteMonthlyCost || 0) * 12, curr), (sku.wasteMonthlyCost || 0) > 0 ? 'text-critical font-bold' : '');
        appendDetailRow(costList, 'Avg Cost per User:', sku.averageCostPerUser ? formatCurrency(sku.averageCostPerUser, curr) + '/mo' : 'N/A');
        appendDetailRow(costList, 'Billed Users:', sku.billedUsers || 0);
        body.appendChild(costList);

        modal.classList.add('visible');
    }

    function appendDetailRow(container, label, value, valueClass) {
        container.appendChild(el('span', 'detail-label', label));
        var valSpan = el('span', 'detail-value' + (valueClass ? ' ' + valueClass : ''));
        valSpan.textContent = String(value);
        container.appendChild(valSpan);
    }

    function appendDetailRowWithElement(container, label, element) {
        container.appendChild(el('span', 'detail-label', label));
        container.appendChild(element);
    }

    /**
     * Renders the Licenses tab with table.
     */
    function renderLicensesTab(container) {
        container.textContent = '';

        // Filters
        var filterDiv = el('div');
        filterDiv.id = 'licenses-filter';
        container.appendChild(filterDiv);

        // Table toolbar
        var toolbar = el('div', 'table-toolbar');
        var colSelectorDiv = el('div');
        colSelectorDiv.id = 'licenses-col-selector';
        toolbar.appendChild(colSelectorDiv);
        var exportBtn = el('button', 'btn btn-secondary btn-sm', 'Export CSV');
        exportBtn.id = 'export-licenses-table';
        toolbar.appendChild(exportBtn);
        container.appendChild(toolbar);

        // Count
        var countDiv = el('div', 'table-count');
        countDiv.id = 'licenses-count';
        container.appendChild(countDiv);

        // Table
        var tableDiv = el('div');
        tableDiv.id = 'licenses-table';
        container.appendChild(tableDiv);

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'licenses-filter',
            controls: [
                { type: 'search', id: 'licenses-search', label: 'Search', placeholder: 'Search licenses...' },
                { type: 'select', id: 'licenses-waste-filter', label: 'Filter', options: [
                    { value: 'all', label: 'All Licenses' },
                    { value: 'waste', label: 'With Waste Only' },
                    { value: 'overlap', label: 'With Overlap Only' }
                ]}
            ],
            onFilter: applyFilters
        });

        // Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'licenses-col-selector',
                storageKey: 'tenantscope-licenses-columns',
                allColumns: [
                    { key: 'skuName', label: 'License Name' },
                    { key: 'skuPartNumber', label: 'Part Number' },
                    { key: 'totalPurchased', label: 'Purchased' },
                    { key: 'totalAssigned', label: 'Assigned' },
                    { key: 'available', label: 'Available' },
                    { key: 'assignedToDisabled', label: 'Disabled' },
                    { key: 'assignedToInactive', label: 'Inactive' },
                    { key: 'wasteCount', label: 'Total Waste' },
                    { key: 'overlapCount', label: 'Overlap' },
                    { key: 'estimatedMonthlyCost', label: 'Monthly Cost' },
                    { key: 'wasteMonthlyCost', label: 'Waste Cost' },
                    { key: 'potentialSavingsPercent', label: 'Savings %' },
                    { key: 'averageCostPerUser', label: 'Avg Cost/User' },
                    { key: 'billedUsers', label: 'Billed Users' },
                    { key: 'utilizationPercent', label: 'Utilization' }
                ],
                defaultVisible: ['skuName', 'totalPurchased', 'totalAssigned', 'available', 'wasteCount', 'overlapCount', 'estimatedMonthlyCost', 'wasteMonthlyCost', 'utilizationPercent'],
                onColumnsChanged: applyFilters
            });
        }

        // Bind export
        Export.bindExportButton('licenses-table', 'licenses');

        // Initial render
        applyFilters();
    }

    /**
     * Creates a summary card.
     */
    function createSummaryCard(label, value, valueClass, cardClass) {
        var card = el('div', 'card' + (cardClass ? ' ' + cardClass : ''));
        card.appendChild(el('div', 'card-label', label));
        card.appendChild(el('div', 'card-value' + (valueClass ? ' ' + valueClass : ''), String(value)));
        return card;
    }

    /**
     * Renders the licenses page.
     */
    function render(container) {
        var licenses = DataLoader.getData('licenseSkus');

        // Calculate totals
        var totals = licenses.reduce(function(acc, sku) {
            acc.purchased += sku.totalPurchased;
            acc.assigned += sku.totalAssigned;
            acc.waste += sku.wasteCount;
            acc.wasteCost += (sku.wasteMonthlyCost || 0);
            acc.totalCost += (sku.estimatedMonthlyCost || 0);
            acc.overlapCount += (sku.overlapCount || 0);
            acc.billedUsers += (sku.billedUsers || 0);
            return acc;
        }, { purchased: 0, assigned: 0, waste: 0, wasteCost: 0, totalCost: 0, overlapCount: 0, billedUsers: 0 });

        var currency = (licenses.find(function(l) { return l.currency; }) || {}).currency || 'NOK';
        var annualWasteCost = totals.wasteCost * 12;
        var avgCost = totals.billedUsers > 0 ? Math.round(totals.totalCost / totals.billedUsers) : 0;
        var savingsPct = totals.totalCost > 0 ? Math.round((totals.wasteCost / totals.totalCost) * 100) : 0;
        var avgUtilization = licenses.length > 0
            ? Math.round(licenses.reduce(function(sum, sku) { return sum + sku.utilizationPercent; }, 0) / licenses.length)
            : 0;

        var disabledWaste = licenses.reduce(function(s, l) { return s + l.assignedToDisabled; }, 0);
        var inactiveWaste = licenses.reduce(function(s, l) { return s + l.assignedToInactive; }, 0);

        // Cache state
        licensesState = {
            licenses: licenses,
            totals: totals,
            currency: currency,
            annualWasteCost: annualWasteCost,
            avgCost: avgCost,
            savingsPct: savingsPct,
            avgUtilization: avgUtilization,
            disabledWaste: disabledWaste,
            inactiveWaste: inactiveWaste
        };

        container.textContent = '';

        // Page header
        var pageHeader = el('div', 'page-header');
        pageHeader.appendChild(el('h2', 'page-title', 'Licenses'));
        pageHeader.appendChild(el('p', 'page-description', 'License allocation, waste analysis, overlap detection, and cost impact'));
        container.appendChild(pageHeader);

        // Summary cards
        var cardsGrid = el('div', 'summary-cards');
        cardsGrid.appendChild(createSummaryCard('Total SKUs', licenses.length, null, null));
        cardsGrid.appendChild(createSummaryCard('Avg Utilization', avgUtilization + '%', avgUtilization < 70 ? 'warning' : 'success', avgUtilization < 70 ? 'card-warning' : 'card-success'));
        cardsGrid.appendChild(createSummaryCard('Monthly Waste', formatCurrency(totals.wasteCost, currency), totals.wasteCost > 0 ? 'critical' : null, totals.wasteCost > 0 ? 'card-critical' : null));
        cardsGrid.appendChild(createSummaryCard('Annual Waste', formatCurrency(annualWasteCost, currency), annualWasteCost > 0 ? 'critical' : null, annualWasteCost > 0 ? 'card-critical' : null));
        container.appendChild(cardsGrid);

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'licenses', label: 'All Licenses (' + licenses.length + ')' }
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
        contentArea.id = 'licenses-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageLicenses = PageLicenses;
