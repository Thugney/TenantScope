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

    var colSelector = null;

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        var licenses = DataLoader.getData('licenseSkus');

        var filterConfig = {
            search: Filters.getValue('licenses-search'),
            searchFields: ['skuName', 'skuPartNumber']
        };

        var filteredData = Filters.apply(licenses, filterConfig);

        // Apply waste filter
        var wasteCheckbox = document.getElementById('licenses-waste');
        if (wasteCheckbox && wasteCheckbox.checked) {
            filteredData = filteredData.filter(function(sku) { return sku.wasteCount > 0; });
        }

        // Apply overlap filter
        var overlapCheckbox = document.getElementById('licenses-overlap');
        if (overlapCheckbox && overlapCheckbox.checked) {
            filteredData = filteredData.filter(function(sku) { return (sku.overlapCount || 0) > 0; });
        }

        renderTable(filteredData);
    }

    /**
     * Renders the licenses table with dynamic columns from Column Selector.
     *
     * @param {Array} data - Filtered license data
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
            { key: 'estimatedMonthlyCost', label: 'Monthly Cost', className: 'cell-right', formatter: function(v, row) { return v ? formatCurrency(v, (row && row.currency) || 'NOK') : '<span class="text-muted">--</span>'; } },
            { key: 'wasteMonthlyCost', label: 'Waste Cost', className: 'cell-right', formatter: formatCostCell },
            { key: 'potentialSavingsPercent', label: 'Savings %', className: 'cell-right', formatter: formatSavingsCell },
            { key: 'averageCostPerUser', label: 'Avg Cost/User', className: 'cell-right', formatter: function(v, row) { return v ? formatCurrency(v, (row && row.currency) || 'NOK') : '<span class="text-muted">--</span>'; } },
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
    }

    /**
     * Formats waste count with color coding.
     */
    function formatWasteCell(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return '<span class="text-warning font-bold">' + value + '</span>';
    }

    /**
     * Formats overlap count with color coding.
     */
    function formatOverlapCell(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return '<span class="text-critical font-bold">' + value + '</span>';
    }

    /**
     * Formats savings percentage with color coding.
     */
    function formatSavingsCell(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0%</span>';
        }
        return '<span class="text-warning font-bold">' + value + '%</span>';
    }

    /**
     * Shows detailed modal for a license SKU.
     *
     * @param {object} sku - License SKU data
     */
    function showLicenseDetails(sku) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = sku.skuName;

        var curr = sku.currency || 'NOK';
        var html = '<div class="detail-list">' +
            '<span class="detail-label">SKU Name:</span>' +
            '<span class="detail-value">' + sku.skuName + '</span>' +
            '<span class="detail-label">Part Number:</span>' +
            '<span class="detail-value">' + sku.skuPartNumber + '</span>' +
            '<span class="detail-label">SKU ID:</span>' +
            '<span class="detail-value" style="font-size: 0.8em;">' + sku.skuId + '</span>' +
            '</div>' +

            '<h4 class="mt-lg mb-sm">Allocation</h4>' +
            '<div class="detail-list">' +
            '<span class="detail-label">Total Purchased:</span>' +
            '<span class="detail-value">' + sku.totalPurchased + '</span>' +
            '<span class="detail-label">Total Assigned:</span>' +
            '<span class="detail-value">' + sku.totalAssigned + '</span>' +
            '<span class="detail-label">Available:</span>' +
            '<span class="detail-value">' + sku.available + '</span>' +
            '<span class="detail-label">Utilization:</span>' +
            '<span class="detail-value">' + sku.utilizationPercent + '%</span>' +
            '</div>' +

            '<h4 class="mt-lg mb-sm">Waste Analysis</h4>' +
            '<div class="detail-list">' +
            '<span class="detail-label">Assigned to Enabled:</span>' +
            '<span class="detail-value text-success">' + sku.assignedToEnabled + '</span>' +
            '<span class="detail-label">Assigned to Disabled:</span>' +
            '<span class="detail-value ' + (sku.assignedToDisabled > 0 ? 'text-warning' : '') + '">' + sku.assignedToDisabled + '</span>' +
            '<span class="detail-label">Assigned to Inactive:</span>' +
            '<span class="detail-value ' + (sku.assignedToInactive > 0 ? 'text-warning' : '') + '">' + sku.assignedToInactive + '</span>' +
            '<span class="detail-label">Total Waste:</span>' +
            '<span class="detail-value ' + (sku.wasteCount > 0 ? 'text-critical font-bold' : '') + '">' + sku.wasteCount + '</span>' +
            '</div>' +

            '<h4 class="mt-lg mb-sm">Overlap Detection</h4>' +
            '<div class="detail-list">' +
            '<span class="detail-label">Overlapping Users:</span>' +
            '<span class="detail-value ' + ((sku.overlapCount || 0) > 0 ? 'text-warning font-bold' : '') + '">' + (sku.overlapCount || 0) + '</span>' +
            '<span class="detail-label">Overlaps With:</span>' +
            '<span class="detail-value">' + (sku.overlapSkuName || 'None') + '</span>' +
            '<span class="detail-label">Potential Savings:</span>' +
            '<span class="detail-value">' + (sku.potentialSavingsPercent || 0) + '%</span>' +
            '</div>' +

            '<h4 class="mt-lg mb-sm">Cost Analysis</h4>' +
            '<div class="detail-list">' +
            '<span class="detail-label">Cost per License:</span>' +
            '<span class="detail-value">' + (sku.monthlyCostPerLicense ? formatCurrency(sku.monthlyCostPerLicense, curr) + '/mo' : 'Not configured') + '</span>' +
            '<span class="detail-label">Estimated Monthly Cost:</span>' +
            '<span class="detail-value">' + formatCurrency(sku.estimatedMonthlyCost || 0, curr) + '</span>' +
            '<span class="detail-label">Monthly Waste Cost:</span>' +
            '<span class="detail-value ' + ((sku.wasteMonthlyCost || 0) > 0 ? 'text-critical font-bold' : '') + '">' + formatCurrency(sku.wasteMonthlyCost || 0, curr) + '</span>' +
            '<span class="detail-label">Annual Waste Cost:</span>' +
            '<span class="detail-value ' + ((sku.wasteMonthlyCost || 0) > 0 ? 'text-critical font-bold' : '') + '">' + formatCurrency((sku.wasteMonthlyCost || 0) * 12, curr) + '</span>' +
            '<span class="detail-label">Avg Cost per User:</span>' +
            '<span class="detail-value">' + (sku.averageCostPerUser ? formatCurrency(sku.averageCostPerUser, curr) + '/mo' : 'N/A') + '</span>' +
            '<span class="detail-label">Billed Users:</span>' +
            '<span class="detail-value">' + (sku.billedUsers || 0) + '</span>' +
            '</div>';

        body.innerHTML = html;

        modal.classList.add('visible');
    }

    /**
     * Formats a number as currency using locale from data.
     */
    function formatCurrency(value, curr) {
        if (!value && value !== 0) return '--';
        var sym = curr === 'NOK' ? 'kr' : curr === 'USD' ? '$' : curr === 'EUR' ? 'E' : '';
        return sym + ' ' + value.toLocaleString();
    }

    /**
     * Formats cost cell with color coding.
     * All values are computed integers from the collection pipeline.
     */
    function formatCostCell(value, row) {
        if (!value || value === 0) {
            return '<span class="text-muted">kr 0</span>';
        }
        var curr = (row && row.currency) || 'NOK';
        return '<span class="text-critical font-bold">' + formatCurrency(value, curr) + '</span>';
    }

    function render(container) {
        const licenses = DataLoader.getData('licenseSkus');

        // Calculate totals
        const totals = licenses.reduce((acc, sku) => {
            acc.purchased += sku.totalPurchased;
            acc.assigned += sku.totalAssigned;
            acc.waste += sku.wasteCount;
            acc.wasteCost += (sku.wasteMonthlyCost || 0);
            acc.totalCost += (sku.estimatedMonthlyCost || 0);
            acc.overlapCount += (sku.overlapCount || 0);
            acc.billedUsers += (sku.billedUsers || 0);
            return acc;
        }, { purchased: 0, assigned: 0, waste: 0, wasteCost: 0, totalCost: 0, overlapCount: 0, billedUsers: 0 });

        const currency = (licenses.find(l => l.currency) || {}).currency || 'NOK';
        const annualWasteCost = totals.wasteCost * 12;
        var overlapSkus = licenses.filter(function(l) { return (l.overlapCount || 0) > 0; }).length;
        var avgCost = totals.billedUsers > 0 ? Math.round(totals.totalCost / totals.billedUsers) : 0;
        var savingsPct = totals.totalCost > 0 ? Math.round((totals.wasteCost / totals.totalCost) * 100) : 0;

        const avgUtilization = licenses.length > 0
            ? Math.round(licenses.reduce((sum, sku) => sum + sku.utilizationPercent, 0) / licenses.length)
            : 0;

        // Build page with DOM
        var page = document.createElement('div');

        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Licenses';
        header.appendChild(h2);
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'License allocation, waste analysis, overlap detection, and cost impact';
        header.appendChild(desc);
        page.appendChild(header);

        // Cards row 1
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';
        cardsGrid.appendChild(makeCard('Total SKUs', String(licenses.length), ''));
        cardsGrid.appendChild(makeCard('Total Purchased', totals.purchased.toLocaleString(), ''));
        cardsGrid.appendChild(makeCard('Monthly Waste Cost', formatCurrency(totals.wasteCost, currency), totals.wasteCost > 0 ? 'negative' : 'positive'));
        cardsGrid.appendChild(makeCard('Annual Waste Cost', formatCurrency(annualWasteCost, currency), annualWasteCost > 0 ? 'negative' : 'positive'));
        page.appendChild(cardsGrid);

        // Cards row 2 (new metrics)
        var cardsGrid2 = document.createElement('div');
        cardsGrid2.className = 'cards-grid';
        cardsGrid2.appendChild(makeCard('Savings Potential', savingsPct + '%', savingsPct > 5 ? 'negative' : 'positive'));
        cardsGrid2.appendChild(makeCard('Avg Cost/User', formatCurrency(avgCost, currency), ''));
        cardsGrid2.appendChild(makeCard('Billed Users', totals.billedUsers.toLocaleString(), ''));
        cardsGrid2.appendChild(makeCard('Overlapping SKUs', overlapSkus + ' of ' + licenses.length, overlapSkus > 0 ? 'negative' : 'positive'));
        page.appendChild(cardsGrid2);

        var chartsDiv = document.createElement('div');
        chartsDiv.className = 'charts-row';
        chartsDiv.id = 'licenses-charts';
        page.appendChild(chartsDiv);

        var filterDiv = document.createElement('div');
        filterDiv.id = 'licenses-filter';
        page.appendChild(filterDiv);

        var colSelDiv = document.createElement('div');
        colSelDiv.id = 'licenses-column-selector';
        colSelDiv.style.marginBottom = '8px';
        colSelDiv.style.textAlign = 'right';
        page.appendChild(colSelDiv);

        var tableDiv = document.createElement('div');
        tableDiv.id = 'licenses-table';
        page.appendChild(tableDiv);

        container.appendChild(page);

        // Render charts
        if (chartsDiv) {
            var C = DashboardCharts.colors;
            var available = totals.purchased - totals.assigned;

            chartsDiv.appendChild(DashboardCharts.createChartCard(
                'License Allocation',
                [
                    { value: totals.assigned - totals.waste, label: 'Active Use', color: C.green },
                    { value: totals.waste, label: 'Waste', color: C.red },
                    { value: available > 0 ? available : 0, label: 'Available', color: C.gray }
                ],
                avgUtilization + '%', 'avg utilization'
            ));

            var disabledWaste = licenses.reduce(function(s, l) { return s + l.assignedToDisabled; }, 0);
            var inactiveWaste = licenses.reduce(function(s, l) { return s + l.assignedToInactive; }, 0);

            chartsDiv.appendChild(DashboardCharts.createChartCard(
                'Waste Breakdown',
                [
                    { value: disabledWaste, label: 'Disabled Users', color: C.orange },
                    { value: inactiveWaste, label: 'Inactive Users', color: C.yellow }
                ],
                String(totals.waste), 'wasted licenses'
            ));
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'licenses-filter',
            controls: [
                {
                    type: 'search',
                    id: 'licenses-search',
                    label: 'Search',
                    placeholder: 'Search licenses...'
                },
                {
                    type: 'checkbox-group',
                    id: 'licenses-waste-filter',
                    label: 'Filter',
                    options: [
                        { value: 'waste', label: 'Show only with waste' },
                        { value: 'overlap', label: 'Show only with overlap' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Custom filter handler IDs
        var checkboxes = document.querySelectorAll('#licenses-waste-filter input');
        if (checkboxes.length >= 1) checkboxes[0].id = 'licenses-waste';
        if (checkboxes.length >= 2) checkboxes[1].id = 'licenses-overlap';

        // Column Selector
        var allCols = [
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
        ];
        var defaultCols = ['skuName', 'totalPurchased', 'totalAssigned', 'available', 'wasteCount', 'overlapCount', 'estimatedMonthlyCost', 'wasteMonthlyCost', 'utilizationPercent'];

        colSelector = ColumnSelector.create({
            containerId: 'licenses-column-selector',
            storageKey: 'tenantscope-licenses-columns',
            allColumns: allCols,
            defaultVisible: defaultCols,
            onColumnsChanged: function() { applyFilters(); }
        });

        // Bind export button
        Export.bindExportButton('licenses-table', 'licenses');

        // Initial render
        applyFilters();
    }

    function makeCard(title, value, trend) {
        var card = document.createElement('div');
        card.className = 'card';
        var label = document.createElement('div');
        label.className = 'card-label';
        label.textContent = title;
        card.appendChild(label);
        var val = document.createElement('div');
        val.className = 'card-value';
        val.textContent = value;
        if (trend === 'negative') val.style.color = 'var(--color-critical)';
        if (trend === 'positive') val.style.color = 'var(--color-success)';
        card.appendChild(val);
        return card;
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageLicenses = PageLicenses;
