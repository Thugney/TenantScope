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

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const licenses = DataLoader.getData('licenseSkus');

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('licenses-search'),
            searchFields: ['skuName', 'skuPartNumber']
        };

        // Apply waste filter
        const wasteOnly = Filters.getValue('licenses-waste');
        let filteredData = Filters.apply(licenses, filterConfig);

        if (wasteOnly) {
            filteredData = filteredData.filter(sku => sku.wasteCount > 0);
        }

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the licenses table.
     *
     * @param {Array} data - Filtered license data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'licenses-table',
            data: data,
            columns: [
                { key: 'skuName', label: 'License Name' },
                { key: 'skuPartNumber', label: 'Part Number', className: 'cell-truncate' },
                { key: 'totalPurchased', label: 'Purchased', className: 'cell-right' },
                { key: 'totalAssigned', label: 'Assigned', className: 'cell-right' },
                { key: 'available', label: 'Available', className: 'cell-right' },
                { key: 'assignedToDisabled', label: 'Disabled', className: 'cell-right', formatter: formatWasteCell },
                { key: 'assignedToInactive', label: 'Inactive', className: 'cell-right', formatter: formatWasteCell },
                { key: 'wasteCount', label: 'Total Waste', className: 'cell-right', formatter: formatWasteCell },
                { key: 'estimatedMonthlyCost', label: 'Monthly Cost', className: 'cell-right', formatter: function(v, row) { return v ? formatCurrency(v, (row && row.currency) || 'NOK') : '<span class="text-muted">--</span>'; } },
                { key: 'wasteMonthlyCost', label: 'Waste Cost', className: 'cell-right', formatter: formatCostCell },
                { key: 'utilizationPercent', label: 'Utilization', formatter: Tables.formatters.percentage }
            ],
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
        return `<span class="text-warning font-bold">${value}</span>`;
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

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">SKU Name:</span>
                <span class="detail-value">${sku.skuName}</span>

                <span class="detail-label">Part Number:</span>
                <span class="detail-value">${sku.skuPartNumber}</span>

                <span class="detail-label">SKU ID:</span>
                <span class="detail-value" style="font-size: 0.8em;">${sku.skuId}</span>
            </div>

            <h4 class="mt-lg mb-sm">Allocation</h4>
            <div class="detail-list">
                <span class="detail-label">Total Purchased:</span>
                <span class="detail-value">${sku.totalPurchased}</span>

                <span class="detail-label">Total Assigned:</span>
                <span class="detail-value">${sku.totalAssigned}</span>

                <span class="detail-label">Available:</span>
                <span class="detail-value">${sku.available}</span>

                <span class="detail-label">Utilization:</span>
                <span class="detail-value">${sku.utilizationPercent}%</span>
            </div>

            <h4 class="mt-lg mb-sm">Waste Analysis</h4>
            <div class="detail-list">
                <span class="detail-label">Assigned to Enabled:</span>
                <span class="detail-value text-success">${sku.assignedToEnabled}</span>

                <span class="detail-label">Assigned to Disabled:</span>
                <span class="detail-value ${sku.assignedToDisabled > 0 ? 'text-warning' : ''}">${sku.assignedToDisabled}</span>

                <span class="detail-label">Assigned to Inactive:</span>
                <span class="detail-value ${sku.assignedToInactive > 0 ? 'text-warning' : ''}">${sku.assignedToInactive}</span>

                <span class="detail-label">Total Waste:</span>
                <span class="detail-value ${sku.wasteCount > 0 ? 'text-critical font-bold' : ''}">${sku.wasteCount}</span>
            </div>

            <h4 class="mt-lg mb-sm">Cost Analysis</h4>
            <div class="detail-list">
                <span class="detail-label">Cost per License:</span>
                <span class="detail-value">${sku.monthlyCostPerLicense ? formatCurrency(sku.monthlyCostPerLicense, sku.currency || 'NOK') + '/mo' : 'Not configured'}</span>

                <span class="detail-label">Estimated Monthly Cost:</span>
                <span class="detail-value">${formatCurrency(sku.estimatedMonthlyCost || 0, sku.currency || 'NOK')}</span>

                <span class="detail-label">Monthly Waste Cost:</span>
                <span class="detail-value ${(sku.wasteMonthlyCost || 0) > 0 ? 'text-critical font-bold' : ''}">${formatCurrency(sku.wasteMonthlyCost || 0, sku.currency || 'NOK')}</span>

                <span class="detail-label">Annual Waste Cost:</span>
                <span class="detail-value ${(sku.wasteMonthlyCost || 0) > 0 ? 'text-critical font-bold' : ''}">${formatCurrency((sku.wasteMonthlyCost || 0) * 12, sku.currency || 'NOK')}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    /**
     * Renders the licenses page content.
     *
     * @param {HTMLElement} container - The page container element
     */
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
            return acc;
        }, { purchased: 0, assigned: 0, waste: 0, wasteCost: 0, totalCost: 0 });

        const currency = (licenses.find(l => l.currency) || {}).currency || 'NOK';
        const annualWasteCost = totals.wasteCost * 12;

        const avgUtilization = licenses.length > 0
            ? Math.round(licenses.reduce((sum, sku) => sum + sku.utilizationPercent, 0) / licenses.length)
            : 0;

        // All interpolated values below are computed integers or pre-validated
        // data from the collection pipeline -- no user-supplied strings
        container.innerHTML = [
            '<div class="page-header">',
            '    <h2 class="page-title">Licenses</h2>',
            '    <p class="page-description">License allocation, waste analysis, and cost impact</p>',
            '</div>',
            '<div class="cards-grid">',
            '    <div class="card">',
            '        <div class="card-label">Total SKUs</div>',
            '        <div class="card-value">' + licenses.length + '</div>',
            '    </div>',
            '    <div class="card">',
            '        <div class="card-label">Total Purchased</div>',
            '        <div class="card-value">' + totals.purchased.toLocaleString() + '</div>',
            '    </div>',
            '    <div class="card ' + (totals.wasteCost > 0 ? 'card-warning' : 'card-success') + '">',
            '        <div class="card-label">Monthly Waste Cost</div>',
            '        <div class="card-value ' + (totals.wasteCost > 0 ? 'warning' : 'success') + '">' + formatCurrency(totals.wasteCost, currency) + '</div>',
            '        <div class="card-change">' + totals.waste + ' wasted licenses</div>',
            '    </div>',
            '    <div class="card ' + (annualWasteCost > 0 ? 'card-critical' : 'card-success') + '">',
            '        <div class="card-label">Annual Waste Cost</div>',
            '        <div class="card-value ' + (annualWasteCost > 0 ? 'critical' : 'success') + '">' + formatCurrency(annualWasteCost, currency) + '</div>',
            '        <div class="card-change">Projected yearly loss</div>',
            '    </div>',
            '</div>',
            '<div class="charts-row" id="licenses-charts"></div>',
            '<div id="licenses-filter"></div>',
            '<div id="licenses-table"></div>'
        ].join('\n');

        // Render charts
        var chartsRow = document.getElementById('licenses-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;
            var available = totals.purchased - totals.assigned;

            chartsRow.appendChild(DashboardCharts.createChartCard(
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

            chartsRow.appendChild(DashboardCharts.createChartCard(
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
                        { value: 'waste', label: 'Show only with waste' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Custom waste filter handler
        const wasteCheckbox = document.querySelector('#licenses-waste-filter input');
        if (wasteCheckbox) {
            wasteCheckbox.id = 'licenses-waste';
        }

        // Bind export button
        Export.bindExportButton('licenses-table', 'licenses');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageLicenses = PageLicenses;
