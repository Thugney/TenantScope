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

    var currentTab = 'overview';
    var auditState = null;

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('audit-content');
        if (!container || !auditState) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, auditState);
                break;
            case 'events':
                renderEventsTab(container, auditState);
                break;
        }
    }

    function isSuccessResult(result) {
        return (result || '').toLowerCase() === 'success';
    }

    function isFailureResult(result) {
        if (!result) return false;
        return (result || '').toLowerCase() !== 'success';
    }

    function renderOverview(container, state) {
        container.textContent = '';

        // Calculate stats
        var total = state.totalEvents;
        var successPct = total > 0 ? Math.round((state.successCount / total) * 100) : 0;
        var failurePct = total > 0 ? Math.round((state.failureCount / total) * 100) : 0;

        // Build analytics section with donut chart
        var section = document.createElement('div');
        section.className = 'analytics-section';

        var sectionTitle = document.createElement('h3');
        sectionTitle.textContent = 'Audit Activity Overview';
        section.appendChild(sectionTitle);

        var complianceOverview = document.createElement('div');
        complianceOverview.className = 'compliance-overview';

        // Donut chart
        var chartContainer = document.createElement('div');
        chartContainer.className = 'compliance-chart';
        var donutDiv = document.createElement('div');
        donutDiv.className = 'donut-chart';

        var circumference = 2 * Math.PI * 40;
        var successDash = (successPct / 100) * circumference;
        var failureDash = (failurePct / 100) * circumference;

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

        if (successPct > 0) {
            var successCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            successCircle.setAttribute('cx', '50');
            successCircle.setAttribute('cy', '50');
            successCircle.setAttribute('r', '40');
            successCircle.setAttribute('fill', 'none');
            successCircle.setAttribute('stroke', 'var(--color-success)');
            successCircle.setAttribute('stroke-width', '12');
            successCircle.setAttribute('stroke-dasharray', successDash + ' ' + circumference);
            successCircle.setAttribute('stroke-dashoffset', '0');
            successCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(successCircle);
        }
        if (failurePct > 0) {
            var failCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            failCircle.setAttribute('cx', '50');
            failCircle.setAttribute('cy', '50');
            failCircle.setAttribute('r', '40');
            failCircle.setAttribute('fill', 'none');
            failCircle.setAttribute('stroke', 'var(--color-critical)');
            failCircle.setAttribute('stroke-width', '12');
            failCircle.setAttribute('stroke-dasharray', failureDash + ' ' + circumference);
            failCircle.setAttribute('stroke-dashoffset', String(-successDash));
            failCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(failCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = document.createElement('div');
        donutCenter.className = 'donut-center';
        var donutValue = document.createElement('span');
        donutValue.className = 'donut-value';
        donutValue.textContent = successPct + '%';
        var donutLabel = document.createElement('span');
        donutLabel.className = 'donut-label';
        donutLabel.textContent = 'Success Rate';
        donutCenter.appendChild(donutValue);
        donutCenter.appendChild(donutLabel);
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = document.createElement('div');
        legend.className = 'compliance-legend';
        var legendItems = [
            { cls: 'bg-success', label: 'Successful', value: state.successCount },
            { cls: 'bg-critical', label: 'Failed', value: state.failureCount }
        ];
        legendItems.forEach(function(item) {
            var legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            var dot = document.createElement('span');
            dot.className = 'legend-dot ' + item.cls;
            legendItem.appendChild(dot);
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            var strong = document.createElement('strong');
            strong.textContent = item.value;
            legendItem.appendChild(strong);
            legend.appendChild(legendItem);
        });
        var metricItems = [
            { label: 'Total Events', value: total },
            { label: 'Categories', value: Object.keys(state.categories).length }
        ];
        metricItems.forEach(function(item) {
            var legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            legendItem.appendChild(document.createTextNode(item.label + ': '));
            var strong = document.createElement('strong');
            strong.textContent = item.value;
            legendItem.appendChild(strong);
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = document.createElement('div');
        analyticsGrid.className = 'analytics-grid';

        // Top Categories card
        var sortedCats = Object.entries(state.categories).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 4);
        var maxCatCount = sortedCats.length > 0 ? sortedCats[0][1] : 1;
        var catRows = sortedCats.map(function(cat) {
            return { name: cat[0], count: cat[1], pct: Math.round((cat[1] / maxCatCount) * 100), cls: 'bg-info', showCount: true };
        });
        if (catRows.length === 0) {
            catRows = [{ name: 'No categories', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Top Categories', catRows));

        // Operation Types card
        var opTypes = {};
        state.auditLogs.forEach(function(e) {
            var op = e.operationType || 'Other';
            opTypes[op] = (opTypes[op] || 0) + 1;
        });
        var sortedOps = Object.entries(opTypes).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 4);
        var maxOpCount = sortedOps.length > 0 ? sortedOps[0][1] : 1;
        var opRows = sortedOps.map(function(op) {
            return { name: op[0], count: op[1], pct: Math.round((op[1] / maxOpCount) * 100), cls: 'bg-primary', showCount: true };
        });
        if (opRows.length === 0) {
            opRows = [{ name: 'No operations', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Operation Types', opRows));

        // Top Initiators card
        var initiators = {};
        state.auditLogs.forEach(function(e) {
            var init = e.initiatedBy || e.initiatedByApp || 'Unknown';
            initiators[init] = (initiators[init] || 0) + 1;
        });
        var sortedInit = Object.entries(initiators).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 4);
        var maxInitCount = sortedInit.length > 0 ? sortedInit[0][1] : 1;
        var initRows = sortedInit.map(function(init) {
            return { name: init[0], count: init[1], pct: Math.round((init[1] / maxInitCount) * 100), cls: 'bg-warning', showCount: true };
        });
        if (initRows.length === 0) {
            initRows = [{ name: 'Unknown', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Top Initiators', initRows));

        // Result Summary card
        var resultRows = [
            { name: 'Successful', count: state.successCount, pct: successPct, cls: 'bg-success' },
            { name: 'Failed', count: state.failureCount, pct: failurePct, cls: 'bg-critical' }
        ];
        analyticsGrid.appendChild(createPlatformCard('Result Summary', resultRows));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = document.createElement('div');
        insightsList.className = 'insights-list';

        // High failure rate insight
        if (failurePct > 10) {
            insightsList.appendChild(createInsightCard('critical', 'HIGH FAILURE RATE', 'Audit Failures',
                state.failureCount + ' operations failed (' + failurePct + '% failure rate). High failure rates may indicate configuration issues or attack attempts.',
                'Review failed operations to identify patterns and root causes.'));
        } else if (failurePct > 5) {
            insightsList.appendChild(createInsightCard('warning', 'ELEVATED FAILURES', 'Audit Failures',
                state.failureCount + ' operations failed (' + failurePct + '% failure rate). Monitor for potential issues.',
                'Investigate recurring failure patterns in the failed events table below.'));
        }

        // Admin activity insight
        var adminOps = state.auditLogs.filter(function(e) {
            var activity = (e.activityDisplayName || '').toLowerCase();
            return activity.includes('admin') || activity.includes('role') || activity.includes('permission');
        });
        if (adminOps.length > 0) {
            insightsList.appendChild(createInsightCard('info', 'ADMIN ACTIVITY', 'Administrative Changes',
                adminOps.length + ' administrative operation' + (adminOps.length !== 1 ? 's' : '') + ' detected. Review for unauthorized changes.',
                'Verify that admin operations align with approved change requests.'));
        }

        // User management insight
        var userMgmtOps = state.auditLogs.filter(function(e) {
            var activity = (e.activityDisplayName || '').toLowerCase();
            return activity.includes('user') || activity.includes('member') || activity.includes('group');
        });
        if (userMgmtOps.length > 10) {
            insightsList.appendChild(createInsightCard('info', 'USER MANAGEMENT', 'Identity Changes',
                userMgmtOps.length + ' user/group management operation' + (userMgmtOps.length !== 1 ? 's' : '') + ' detected in the collection period.',
                'Review for bulk changes or unusual patterns.'));
        }

        if (failurePct <= 5 && state.totalEvents > 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Audit Status',
                'Audit operations show a healthy ' + successPct + '% success rate with ' + total + ' total events.',
                null));
        }

        container.appendChild(insightsList);

        // Failed events table
        var failedEvents = state.auditLogs.filter(function(e) { return isFailureResult(e.result); });
        if (failedEvents.length > 0) {
            var failSection = document.createElement('div');
            failSection.className = 'analytics-section';
            var failTitle = document.createElement('h3');
            failTitle.textContent = 'Failed Events (' + failedEvents.length + ')';
            failSection.appendChild(failTitle);
            var failTableDiv = document.createElement('div');
            failTableDiv.id = 'audit-failed-table';
            failSection.appendChild(failTableDiv);
            container.appendChild(failSection);

            Tables.render({
                containerId: 'audit-failed-table',
                data: failedEvents.slice(0, 15),
                columns: [
                    { key: 'activityDateTime', label: 'Date', formatter: Tables.formatters.datetime },
                    { key: 'initiatedBy', label: 'Initiated By', className: 'cell-truncate', formatter: formatInitiator },
                    { key: 'activityDisplayName', label: 'Activity', className: 'cell-truncate' },
                    { key: 'targetResource', label: 'Target', className: 'cell-truncate' },
                    { key: 'resultReason', label: 'Reason', className: 'cell-truncate' }
                ],
                pageSize: 15,
                onRowClick: showAuditLogDetails
            });
        }
    }

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = document.createElement('div');
        card.className = 'analytics-card';
        var h4 = document.createElement('h4');
        h4.textContent = title;
        card.appendChild(h4);
        var list = document.createElement('div');
        list.className = 'platform-list';
        rows.forEach(function(row) {
            var rowDiv = document.createElement('div');
            rowDiv.className = 'platform-row';
            var name = document.createElement('span');
            name.className = 'platform-name';
            name.textContent = row.name;
            rowDiv.appendChild(name);
            var policies = document.createElement('span');
            policies.className = 'platform-policies';
            policies.textContent = row.count;
            rowDiv.appendChild(policies);
            var miniBar = document.createElement('div');
            miniBar.className = 'mini-bar';
            var fill = document.createElement('div');
            fill.className = 'mini-bar-fill ' + row.cls;
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            var rate = document.createElement('span');
            rate.className = 'platform-rate';
            rate.textContent = row.showCount ? row.count : (row.pct + '%');
            rowDiv.appendChild(rate);
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = document.createElement('div');
        card.className = 'insight-card insight-' + type;
        var header = document.createElement('div');
        header.className = 'insight-header';
        var badgeSpan = document.createElement('span');
        badgeSpan.className = 'badge badge-' + type;
        badgeSpan.textContent = badge;
        header.appendChild(badgeSpan);
        var catSpan = document.createElement('span');
        catSpan.className = 'insight-category';
        catSpan.textContent = category;
        header.appendChild(catSpan);
        card.appendChild(header);
        var descP = document.createElement('p');
        descP.className = 'insight-description';
        descP.textContent = description;
        card.appendChild(descP);
        if (action) {
            var actionP = document.createElement('p');
            actionP.className = 'insight-action';
            var strong = document.createElement('strong');
            strong.textContent = 'Action: ';
            actionP.appendChild(strong);
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    /**
     * Formats the initiator - shows user if available, otherwise app, otherwise Unknown.
     */
    function formatInitiator(value, row) {
        var initiator = row.initiatedBy || row.initiatedByApp || 'Unknown';
        if (!initiator || initiator === '') initiator = 'Unknown';

        // Add a subtle indicator if it was an app
        if (!row.initiatedBy && row.initiatedByApp) {
            return '<span class="initiator-app" title="App-initiated">' + escapeHtml(initiator) + '</span>';
        }
        return escapeHtml(initiator);
    }

    /**
     * Escapes HTML special characters to prevent XSS.
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderEventsTab(container, state) {
        container.textContent = '';
        var tableDiv = document.createElement('div');
        tableDiv.id = 'audit-logs-table';
        container.appendChild(tableDiv);

        Tables.render({
            containerId: 'audit-logs-table',
            data: state.auditLogs,
            columns: [
                { key: 'activityDateTime', label: 'Date', formatter: Tables.formatters.datetime },
                { key: 'initiatedBy', label: 'Initiated By', filterable: true, className: 'cell-truncate', formatter: formatInitiator },
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
     * Renders the audit logs page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var auditLogs = DataLoader.getData('auditLogs') || [];

        // Calculate stats
        var totalEvents = auditLogs.length;
        var successCount = auditLogs.filter(function(e) { return isSuccessResult(e.result); }).length;
        var failureCount = auditLogs.filter(function(e) { return isFailureResult(e.result); }).length;

        // Count categories
        var categories = {};
        auditLogs.forEach(function(e) {
            var cat = e.category || 'Other';
            categories[cat] = (categories[cat] || 0) + 1;
        });
        var topCategory = Object.entries(categories).sort(function(a, b) { return b[1] - a[1]; })[0];

        auditState = {
            auditLogs: auditLogs,
            totalEvents: totalEvents,
            successCount: successCount,
            failureCount: failureCount,
            categories: categories,
            topCategory: topCategory
        };

        // Build page structure
        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.textContent = 'Audit Logs';
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'Directory audit events from Microsoft Entra ID';
        header.appendChild(h2);
        header.appendChild(desc);
        container.appendChild(header);

        // Summary cards
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'summary-cards';

        cardsGrid.appendChild(createSummaryCard('Total Events', String(totalEvents), '', ''));
        cardsGrid.appendChild(createSummaryCard('Successful', String(successCount), 'card-success', 'text-success'));
        cardsGrid.appendChild(createSummaryCard('Failed', String(failureCount),
            failureCount > 0 ? 'card-danger' : 'card-success', failureCount > 0 ? 'text-critical' : 'text-success'));
        cardsGrid.appendChild(createSummaryCard('Top Category',
            topCategory ? topCategory[0] : '--', '', '', topCategory ? topCategory[1] + ' events' : ''));

        container.appendChild(cardsGrid);

        // Tab bar
        var tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        var overviewBtn = document.createElement('button');
        overviewBtn.className = 'tab-btn active';
        overviewBtn.dataset.tab = 'overview';
        overviewBtn.textContent = 'Overview';
        var eventsBtn = document.createElement('button');
        eventsBtn.className = 'tab-btn';
        eventsBtn.dataset.tab = 'events';
        eventsBtn.textContent = 'All Events (' + totalEvents + ')';
        tabBar.appendChild(overviewBtn);
        tabBar.appendChild(eventsBtn);
        container.appendChild(tabBar);

        // Content area
        var contentArea = document.createElement('div');
        contentArea.className = 'content-area';
        contentArea.id = 'audit-content';
        container.appendChild(contentArea);

        // Tab click handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    /**
     * Helper: creates a summary card element.
     */
    function createSummaryCard(label, value, cardClass, valueClass, changeText) {
        var card = document.createElement('div');
        card.className = 'summary-card' + (cardClass ? ' ' + cardClass : '');

        var lbl = document.createElement('div');
        lbl.className = 'summary-label';
        lbl.textContent = label;
        card.appendChild(lbl);

        var val = document.createElement('div');
        val.className = 'summary-value' + (valueClass ? ' ' + valueClass : '');
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
