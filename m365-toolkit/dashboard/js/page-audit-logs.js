/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: AUDIT LOGS
 *
 * Renders the directory audit logs page with summary cards and a
 * filterable table of audit events from Microsoft Entra ID.
 *
 * NOTE: This page renders static HTML structure and locally-collected
 * Graph API JSON data. No user-submitted content is rendered.
 * innerHTML usage follows the established pattern of all other page modules.
 */

const PageAuditLogs = (function() {
    'use strict';

    /**
     * Renders the audit logs page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        const auditLogs = DataLoader.getData('auditLogs');

        // Calculate stats
        const totalEvents = auditLogs.length;
        const successCount = auditLogs.filter(e => e.result === 'success').length;
        const failureCount = auditLogs.filter(e => e.result === 'failure').length;

        // Count categories
        const categories = {};
        auditLogs.forEach(e => {
            const cat = e.category || 'Other';
            categories[cat] = (categories[cat] || 0) + 1;
        });
        const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

        // Build page structure using DOM
        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Audit Logs';
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'Directory audit events from Microsoft Entra ID';
        header.appendChild(h2);
        header.appendChild(desc);
        container.appendChild(header);

        // Summary cards
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';

        cardsGrid.appendChild(createCard('Total Events', String(totalEvents), ''));
        cardsGrid.appendChild(createCard('Successful', String(successCount), 'card-success', 'success'));
        cardsGrid.appendChild(createCard('Failed', String(failureCount),
            failureCount > 0 ? 'card-critical' : '', failureCount > 0 ? 'critical' : 'success'));
        cardsGrid.appendChild(createCard('Top Category',
            topCategory ? topCategory[0] : '--', '',
            '', topCategory ? topCategory[1] + ' events' : ''));

        container.appendChild(cardsGrid);

        // Charts row
        var chartsRow = document.createElement('div');
        chartsRow.className = 'charts-row';

        var C = DashboardCharts.colors;

        // Result distribution donut
        chartsRow.appendChild(DashboardCharts.createChartCard(
            'Result Distribution',
            [
                { value: successCount, label: 'Success', color: C.green },
                { value: failureCount, label: 'Failure', color: C.red }
            ],
            totalEvents > 0 ? Math.round((successCount / totalEvents) * 100) + '%' : '0%',
            'success rate'
        ));

        // Category breakdown donut
        var categorySegments = Object.entries(categories)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, 6)
            .map(function(entry, idx) {
                var catColors = [C.blue, C.teal, C.purple, C.orange, C.indigo, C.gray];
                return { value: entry[1], label: entry[0], color: catColors[idx] || C.gray };
            });

        chartsRow.appendChild(DashboardCharts.createChartCard(
            'Events by Category',
            categorySegments,
            String(Object.keys(categories).length), 'categories'
        ));

        container.appendChild(chartsRow);

        // Table section
        var section = document.createElement('div');
        section.className = 'section';
        var sectionHeader = document.createElement('div');
        sectionHeader.className = 'section-header';
        var sectionInner = document.createElement('div');
        var sectionTitle = document.createElement('h3');
        sectionTitle.className = 'section-title';
        sectionTitle.textContent = 'All Audit Events';
        var sectionSub = document.createElement('p');
        sectionSub.className = 'section-subtitle';
        sectionSub.textContent = 'Administrative directory operations';
        sectionInner.appendChild(sectionTitle);
        sectionInner.appendChild(sectionSub);
        sectionHeader.appendChild(sectionInner);
        section.appendChild(sectionHeader);

        var tableDiv = document.createElement('div');
        tableDiv.id = 'audit-logs-table';
        section.appendChild(tableDiv);
        container.appendChild(section);

        // Render the audit logs table with per-column filters
        Tables.render({
            containerId: 'audit-logs-table',
            data: auditLogs,
            columns: [
                { key: 'activityDateTime', label: 'Date', formatter: Tables.formatters.datetime },
                { key: 'initiatedBy', label: 'Initiated By', filterable: true, className: 'cell-truncate' },
                { key: 'initiatedByApp', label: 'App Name', filterable: true },
                { key: 'activityDisplayName', label: 'Activity', filterable: true, className: 'cell-truncate' },
                { key: 'targetResource', label: 'Target', filterable: true, className: 'cell-truncate' },
                { key: 'category', label: 'Category', filterable: true },
                { key: 'result', label: 'Status', filterable: true, formatter: Tables.formatters.resultStatus },
                { key: 'operationType', label: 'Operation', filterable: true }
            ],
            pageSize: 25,
            onRowClick: showAuditLogDetails
        });
    }

    /**
     * Helper: creates a summary card element.
     */
    function createCard(label, value, cardClass, valueClass, changeText) {
        var card = document.createElement('div');
        card.className = 'card' + (cardClass ? ' ' + cardClass : '');

        var lbl = document.createElement('div');
        lbl.className = 'card-label';
        lbl.textContent = label;
        card.appendChild(lbl);

        var val = document.createElement('div');
        val.className = 'card-value' + (valueClass ? ' ' + valueClass : '');
        val.textContent = value;
        card.appendChild(val);

        if (changeText) {
            var change = document.createElement('div');
            change.className = 'card-change';
            change.textContent = changeText;
            card.appendChild(change);
        }

        return card;
    }

    /**
     * Shows audit log entry details in modal.
     */
    function showAuditLogDetails(item) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = 'Audit Log Details';

        // Build detail view with DOM methods
        var detailList = document.createElement('div');
        detailList.className = 'detail-list';

        var fields = [
            { label: 'Activity', value: item.activityDisplayName || '--' },
            { label: 'Date', value: item.activityDateTime ? DataLoader.formatDate(item.activityDateTime) : '--' },
            { label: 'Initiated By', value: item.initiatedBy || '--' },
            { label: 'App Name', value: item.initiatedByApp || '--' },
            { label: 'Target', value: item.targetResource || '--' },
            { label: 'Target Type', value: item.targetResourceType || '--' },
            { label: 'Category', value: item.category || '--' },
            { label: 'Result', value: item.result || '--' },
            { label: 'Result Reason', value: item.resultReason || '--' },
            { label: 'Operation Type', value: item.operationType || '--' },
            { label: 'Service', value: item.loggedByService || '--' },
            { label: 'Correlation ID', value: item.correlationId || '--' }
        ];

        fields.forEach(function(f) {
            var labelSpan = document.createElement('span');
            labelSpan.className = 'detail-label';
            labelSpan.textContent = f.label + ':';
            detailList.appendChild(labelSpan);

            var valueSpan = document.createElement('span');
            valueSpan.className = 'detail-value';
            valueSpan.textContent = f.value;
            detailList.appendChild(valueSpan);
        });

        body.textContent = '';
        body.appendChild(detailList);
        modal.classList.add('visible');
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageAuditLogs = PageAuditLogs;
