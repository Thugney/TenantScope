/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: PIM (Privileged Identity Management)
 *
 * Renders the PIM activity page with summary cards, recent activations
 * table, and eligible assignments table.
 */

const PagePIM = (function() {
    'use strict';

    var currentTab = 'overview';
    var pimState = null;

    /**
     * Renders the PIM activity page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function renderLegacy(container) {
        var pimData = DataLoader.getData('pimActivity') || [];

        // Split into requests and eligible assignments
        var requests = pimData.filter(function(e) { return e.entryType === 'request'; });
        var eligible = pimData.filter(function(e) { return e.entryType === 'eligible'; });

        // Calculate stats
        var activeActivations = requests.filter(function(e) {
            return e.action === 'selfActivate' && e.status === 'Provisioned';
        }).length;
        var pendingApprovals = requests.filter(function(e) {
            return e.status === 'PendingApproval';
        }).length;
        var eligibleCount = eligible.length;

        // Recent activity (last 7 days)
        var sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        var recentActivity = requests.filter(function(e) {
            if (!e.createdDateTime) return false;
            var dt = new Date(e.createdDateTime);
            return !isNaN(dt.getTime()) && dt > sevenDaysAgo;
        }).length;

        // Build page using DOM methods
        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Privileged Identity Management';
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'PIM role activations, assignments, and eligible roles';
        header.appendChild(h2);
        header.appendChild(desc);
        container.appendChild(header);

        // Summary cards
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';

        cardsGrid.appendChild(createCard('Active Activations', String(activeActivations),
            activeActivations > 0 ? 'card-warning' : '', activeActivations > 0 ? 'warning' : ''));
        cardsGrid.appendChild(createCard('Pending Approval', String(pendingApprovals),
            pendingApprovals > 0 ? 'card-critical' : '', pendingApprovals > 0 ? 'critical' : 'success',
            pendingApprovals > 0 ? 'Requires attention' : ''));
        cardsGrid.appendChild(createCard('Eligible Assignments', String(eligibleCount), '', ''));
        cardsGrid.appendChild(createCard('Recent Activity (7d)', String(recentActivity), '', '',
            requests.length + ' total requests'));

        container.appendChild(cardsGrid);

        // Charts row
        var chartsRow = document.createElement('div');
        chartsRow.className = 'charts-row';
        container.appendChild(chartsRow);

        if (typeof DashboardCharts !== 'undefined') {
            var C = DashboardCharts.colors;

            // Action distribution
            var selfActivateCount = requests.filter(function(e) { return e.action === 'selfActivate'; }).length;
            var adminAssignCount = requests.filter(function(e) { return e.action === 'adminAssign'; }).length;
            var adminRemoveCount = requests.filter(function(e) { return e.action === 'adminRemove'; }).length;
            var otherActionCount = requests.length - selfActivateCount - adminAssignCount - adminRemoveCount;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Action Distribution',
                [
                    { value: selfActivateCount, label: 'Self Activate', color: C.orange },
                    { value: adminAssignCount, label: 'Admin Assign', color: C.blue },
                    { value: adminRemoveCount, label: 'Admin Remove', color: C.red },
                    { value: otherActionCount, label: 'Other', color: C.gray }
                ],
                String(requests.length), 'total requests'
            ));

            // Status distribution
            var provisionedCount = requests.filter(function(e) { return e.status === 'Provisioned'; }).length;
            var revokedCount = requests.filter(function(e) { return e.status === 'Revoked'; }).length;
            var pendingCount = requests.filter(function(e) { return e.status === 'PendingApproval' || e.status === 'PendingAdminDecision'; }).length;
            var otherStatusCount = requests.length - provisionedCount - revokedCount - pendingCount;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Request Status',
                [
                    { value: provisionedCount, label: 'Provisioned', color: C.green },
                    { value: revokedCount, label: 'Revoked', color: C.gray },
                    { value: pendingCount, label: 'Pending', color: C.yellow },
                    { value: otherStatusCount, label: 'Other', color: C.purple }
                ],
                requests.length > 0
                    ? Math.round((provisionedCount / requests.length) * 100) + '%'
                    : '0%',
                'provisioned'
            ));
        }

        // Role activation requests section
        var requestSection = document.createElement('div');
        requestSection.className = 'section';
        var reqHeader = document.createElement('div');
        reqHeader.className = 'section-header';
        var reqInner = document.createElement('div');
        var reqTitle = document.createElement('h3');
        reqTitle.className = 'section-title';
        reqTitle.textContent = 'Role Assignment Requests';
        var reqSub = document.createElement('p');
        reqSub.className = 'section-subtitle';
        reqSub.textContent = 'Activations, permanent assignments, and removals';
        reqInner.appendChild(reqTitle);
        reqInner.appendChild(reqSub);
        reqHeader.appendChild(reqInner);
        requestSection.appendChild(reqHeader);

        var reqTableDiv = document.createElement('div');
        reqTableDiv.id = 'pim-requests-table';
        requestSection.appendChild(reqTableDiv);
        container.appendChild(requestSection);

        // Eligible assignments section
        var eligibleSection = document.createElement('div');
        eligibleSection.className = 'section';
        var elHeader = document.createElement('div');
        elHeader.className = 'section-header';
        var elInner = document.createElement('div');
        var elTitle = document.createElement('h3');
        elTitle.className = 'section-title';
        elTitle.textContent = 'Eligible Role Assignments';
        var elSub = document.createElement('p');
        elSub.className = 'section-subtitle';
        elSub.textContent = 'Users eligible to activate privileged roles';
        elInner.appendChild(elTitle);
        elInner.appendChild(elSub);
        elHeader.appendChild(elInner);
        eligibleSection.appendChild(elHeader);

        var elTableDiv = document.createElement('div');
        elTableDiv.id = 'pim-eligible-table';
        eligibleSection.appendChild(elTableDiv);
        container.appendChild(eligibleSection);

        // Render requests table
        Tables.render({
            containerId: 'pim-requests-table',
            data: requests,
            columns: [
                { key: 'createdDateTime', label: 'Date', formatter: Tables.formatters.datetime },
                { key: 'principalDisplayName', label: 'User', filterable: true, formatter: function(v, row) {
                    if (!v) return '--';
                    var upn = row.principalUpn || v;
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'roleName', label: 'Role', filterable: true, formatter: function(v) {
                    if (!v) return '--';
                    return '<span class="entity-link">' + Tables.escapeHtml(v) + '</span>';
                }},
                { key: 'action', label: 'Action', filterable: true, formatter: formatAction },
                { key: 'status', label: 'Status', filterable: true, formatter: formatPimStatus },
                { key: 'justification', label: 'Justification', className: 'cell-truncate' },
                { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.datetime },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles" target="_blank" rel="noopener" class="admin-link" title="Open PIM in Entra">Entra</a>';
                }}
            ],
            pageSize: 15,
            onRowClick: showPimDetails
        });

        // Render eligible assignments table
        Tables.render({
            containerId: 'pim-eligible-table',
            data: eligible,
            columns: [
                { key: 'principalDisplayName', label: 'User', filterable: true, formatter: function(v, row) {
                    if (!v) return '--';
                    var upn = row.principalUpn || v;
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'principalUpn', label: 'UPN', className: 'cell-truncate', formatter: function(v) {
                    if (!v) return '--';
                    return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'roleName', label: 'Role', filterable: true, formatter: function(v) {
                    if (!v) return '--';
                    return '<span class="entity-link">' + Tables.escapeHtml(v) + '</span>';
                }},
                { key: 'status', label: 'Status', filterable: true, formatter: formatPimStatus },
                { key: 'scheduleStartDateTime', label: 'Start', formatter: Tables.formatters.date },
                { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.date },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles" target="_blank" rel="noopener" class="admin-link" title="Open PIM in Entra">Entra</a>';
                }}
            ],
            pageSize: 15,
            onRowClick: showPimDetails
        });
    }

    /**
     * Helper: creates a summary card element.
     */
    function createCard(label, value, cardClass, valueClass, changeText) {
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
     * Formats PIM action type with badge.
     */
    function formatAction(value) {
        var labels = {
            'selfActivate': 'Self Activate',
            'adminAssign': 'Admin Assign',
            'adminRemove': 'Admin Remove',
            'adminExtend': 'Admin Extend',
            'adminRenew': 'Admin Renew',
            'selfDeactivate': 'Self Deactivate',
            'selfExtend': 'Self Extend',
            'selfRenew': 'Self Renew',
            'eligible': 'Eligible'
        };
        var classes = {
            'selfActivate': 'badge-warning',
            'adminAssign': 'badge-info',
            'adminRemove': 'badge-critical',
            'adminExtend': 'badge-info',
            'eligible': 'badge-neutral'
        };
        var label = labels[value] || value || 'unknown';
        var cls = classes[value] || 'badge-neutral';
        return '<span class="badge ' + cls + '">' + label + '</span>';
    }

    /**
     * Formats PIM status with badge.
     */
    function formatPimStatus(value) {
        var classes = {
            'Provisioned': 'badge-success',
            'Revoked': 'badge-neutral',
            'PendingApproval': 'badge-warning',
            'PendingAdminDecision': 'badge-warning',
            'Canceled': 'badge-neutral',
            'Denied': 'badge-critical',
            'Failed': 'badge-critical'
        };
        var cls = classes[value] || 'badge-neutral';
        return '<span class="badge ' + cls + '">' + (value || 'unknown') + '</span>';
    }

    /**
     * Shows PIM entry details in modal.
     */
    function showPimDetails(item) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = 'PIM Activity Details';

        var detailList = document.createElement('div');
        detailList.className = 'detail-list';

        var fields = [
            { label: 'User', value: item.principalDisplayName || '--' },
            { label: 'UPN', value: item.principalUpn || '--' },
            { label: 'Role', value: item.roleName || '--' },
            { label: 'Action', value: item.action || '--' },
            { label: 'Status', value: item.status || '--' },
            { label: 'Date', value: item.createdDateTime ? DataLoader.formatDate(item.createdDateTime) : '--' },
            { label: 'Justification', value: item.justification || '--' },
            { label: 'Schedule Start', value: item.scheduleStartDateTime ? DataLoader.formatDate(item.scheduleStartDateTime) : '--' },
            { label: 'Schedule End', value: item.scheduleEndDateTime ? DataLoader.formatDate(item.scheduleEndDateTime) : '--' },
            { label: 'Type', value: item.entryType === 'eligible' ? 'Eligible Assignment' : 'Assignment Request' }
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

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('pim-content');
        if (!container || !pimState) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container);
                break;
            case 'requests':
                renderRequestsTab(container);
                break;
            case 'eligible':
                renderEligibleTab(container);
                break;
        }
    }

    function renderOverview(container) {
        var requests = pimState.requests;
        var eligible = pimState.eligible;
        var total = requests.length;

        // Calculate stats
        var provisionedCount = requests.filter(function(e) { return e.status === 'Provisioned'; }).length;
        var pendingCount = requests.filter(function(e) { return e.status === 'PendingApproval' || e.status === 'PendingAdminDecision'; }).length;
        var revokedCount = requests.filter(function(e) { return e.status === 'Revoked'; }).length;
        var selfActivateCount = requests.filter(function(e) { return e.action === 'selfActivate'; }).length;
        var adminAssignCount = requests.filter(function(e) { return e.action === 'adminAssign'; }).length;
        var adminRemoveCount = requests.filter(function(e) { return e.action === 'adminRemove'; }).length;
        var activeActivations = requests.filter(function(e) { return e.action === 'selfActivate' && e.status === 'Provisioned'; });

        // Calculate percentages
        var provisionedPct = total > 0 ? Math.round((provisionedCount / total) * 100) : 0;
        var pendingPct = total > 0 ? Math.round((pendingCount / total) * 100) : 0;
        var revokedPct = total > 0 ? Math.round((revokedCount / total) * 100) : 0;

        // Build HTML using DOM methods
        container.textContent = '';

        var section = document.createElement('div');
        section.className = 'analytics-section';

        var sectionTitle = document.createElement('h3');
        sectionTitle.textContent = 'PIM Activity Overview';
        section.appendChild(sectionTitle);

        var complianceOverview = document.createElement('div');
        complianceOverview.className = 'compliance-overview';

        // Donut chart
        var chartContainer = document.createElement('div');
        chartContainer.className = 'compliance-chart';
        var donutDiv = document.createElement('div');
        donutDiv.className = 'donut-chart';

        var circumference = 2 * Math.PI * 40;
        var provisionedDash = (provisionedPct / 100) * circumference;
        var pendingDash = (pendingPct / 100) * circumference;
        var revokedDash = (revokedPct / 100) * circumference;

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

        if (provisionedPct > 0) {
            var provCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            provCircle.setAttribute('cx', '50');
            provCircle.setAttribute('cy', '50');
            provCircle.setAttribute('r', '40');
            provCircle.setAttribute('fill', 'none');
            provCircle.setAttribute('stroke', 'var(--color-success)');
            provCircle.setAttribute('stroke-width', '12');
            provCircle.setAttribute('stroke-dasharray', provisionedDash + ' ' + circumference);
            provCircle.setAttribute('stroke-dashoffset', '0');
            provCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(provCircle);
        }
        if (pendingPct > 0) {
            var pendCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            pendCircle.setAttribute('cx', '50');
            pendCircle.setAttribute('cy', '50');
            pendCircle.setAttribute('r', '40');
            pendCircle.setAttribute('fill', 'none');
            pendCircle.setAttribute('stroke', 'var(--color-warning)');
            pendCircle.setAttribute('stroke-width', '12');
            pendCircle.setAttribute('stroke-dasharray', pendingDash + ' ' + circumference);
            pendCircle.setAttribute('stroke-dashoffset', String(-provisionedDash));
            pendCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(pendCircle);
        }
        if (revokedPct > 0) {
            var revCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            revCircle.setAttribute('cx', '50');
            revCircle.setAttribute('cy', '50');
            revCircle.setAttribute('r', '40');
            revCircle.setAttribute('fill', 'none');
            revCircle.setAttribute('stroke', 'var(--text-muted)');
            revCircle.setAttribute('stroke-width', '12');
            revCircle.setAttribute('stroke-dasharray', revokedDash + ' ' + circumference);
            revCircle.setAttribute('stroke-dashoffset', String(-(provisionedDash + pendingDash)));
            revCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(revCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = document.createElement('div');
        donutCenter.className = 'donut-center';
        var donutValue = document.createElement('span');
        donutValue.className = 'donut-value';
        donutValue.textContent = provisionedPct + '%';
        var donutLabel = document.createElement('span');
        donutLabel.className = 'donut-label';
        donutLabel.textContent = 'Provisioned';
        donutCenter.appendChild(donutValue);
        donutCenter.appendChild(donutLabel);
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = document.createElement('div');
        legend.className = 'compliance-legend';
        var legendItems = [
            { cls: 'bg-success', label: 'Provisioned', value: provisionedCount },
            { cls: 'bg-warning', label: 'Pending', value: pendingCount },
            { cls: 'bg-neutral', label: 'Revoked', value: revokedCount }
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
            { label: 'Total Requests', value: total },
            { label: 'Eligible Roles', value: eligible.length }
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

        // Action Distribution card
        var selfPct = total > 0 ? Math.round((selfActivateCount / total) * 100) : 0;
        var assignPct = total > 0 ? Math.round((adminAssignCount / total) * 100) : 0;
        var removePct = total > 0 ? Math.round((adminRemoveCount / total) * 100) : 0;
        var otherActionCount = total - selfActivateCount - adminAssignCount - adminRemoveCount;
        var otherActionPct = total > 0 ? Math.round((otherActionCount / total) * 100) : 0;

        var actionCard = createPlatformCard('Action Distribution', [
            { name: 'Self Activate', count: selfActivateCount, pct: selfPct, cls: 'bg-warning' },
            { name: 'Admin Assign', count: adminAssignCount, pct: assignPct, cls: 'bg-info' },
            { name: 'Admin Remove', count: adminRemoveCount, pct: removePct, cls: 'bg-critical' },
            { name: 'Other', count: otherActionCount, pct: otherActionPct, cls: 'bg-neutral' }
        ]);
        analyticsGrid.appendChild(actionCard);

        // Status Breakdown card
        var statusCard = createPlatformCard('Request Status', [
            { name: 'Provisioned', count: provisionedCount, pct: provisionedPct, cls: 'bg-success' },
            { name: 'Pending Approval', count: pendingCount, pct: pendingPct, cls: 'bg-warning' },
            { name: 'Revoked', count: revokedCount, pct: revokedPct, cls: 'bg-neutral' }
        ]);
        analyticsGrid.appendChild(statusCard);

        // Top Activated Roles
        var roleStats = {};
        requests.forEach(function(r) {
            var role = r.roleName || 'Unknown';
            roleStats[role] = (roleStats[role] || 0) + 1;
        });
        var topRoles = Object.entries(roleStats).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 4);
        var maxRoleCount = topRoles.length > 0 ? topRoles[0][1] : 1;
        var roleRows = topRoles.map(function(r) {
            return { name: r[0], count: r[1], pct: Math.round((r[1] / maxRoleCount) * 100), cls: 'bg-info', showCount: true };
        });
        if (roleRows.length === 0) {
            roleRows = [{ name: 'No activations', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        var roleCard = createPlatformCard('Top Activated Roles', roleRows);
        analyticsGrid.appendChild(roleCard);

        // Eligible Role Distribution
        var eligibleRoles = {};
        eligible.forEach(function(e) {
            var role = e.roleName || 'Unknown';
            eligibleRoles[role] = (eligibleRoles[role] || 0) + 1;
        });
        var topEligible = Object.entries(eligibleRoles).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 4);
        var maxEligibleCount = topEligible.length > 0 ? topEligible[0][1] : 1;
        var eligibleRows = topEligible.map(function(r) {
            return { name: r[0], count: r[1], pct: Math.round((r[1] / maxEligibleCount) * 100), cls: 'bg-primary', showCount: true };
        });
        if (eligibleRows.length === 0) {
            eligibleRows = [{ name: 'No eligible roles', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        var eligibleCard = createPlatformCard('Eligible Role Distribution', eligibleRows);
        analyticsGrid.appendChild(eligibleCard);

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = document.createElement('div');
        insightsList.className = 'insights-list';

        // Pending approvals insight
        if (pendingCount > 0) {
            insightsList.appendChild(createInsightCard('critical', 'ACTION REQUIRED', 'Pending Approvals',
                pendingCount + ' PIM request' + (pendingCount !== 1 ? 's' : '') + ' awaiting approval. Delayed approvals may block user access to critical roles.',
                'Review pending requests and approve or deny based on justification and business need.'));
        }

        // Active activations insight
        if (activeActivations.length > 0) {
            insightsList.appendChild(createInsightCard('warning', 'MONITOR', 'Active Privileges',
                activeActivations.length + ' user' + (activeActivations.length !== 1 ? 's' : '') + ' currently have elevated privileges through PIM. Monitor for unusual activity.',
                'Review active activations and ensure they align with current business needs.'));
        }

        // Missing justifications
        var noJustification = requests.filter(function(e) { return e.action === 'selfActivate' && !e.justification; });
        if (noJustification.length > 0) {
            insightsList.appendChild(createInsightCard('info', 'INFO', 'Justification Gaps',
                noJustification.length + ' activation' + (noJustification.length !== 1 ? 's' : '') + ' submitted without justification. Consider enforcing mandatory justifications.',
                'Configure PIM settings to require justifications for all role activations.'));
        }

        // Expiring eligibilities
        var thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        var expiringEligible = eligible.filter(function(e) {
            if (!e.scheduleEndDateTime) return false;
            var dt = new Date(e.scheduleEndDateTime);
            return !isNaN(dt.getTime()) && dt <= thirtyDaysFromNow;
        });
        if (expiringEligible.length > 0) {
            insightsList.appendChild(createInsightCard('warning', 'ATTENTION', 'Expiring Eligibilities',
                expiringEligible.length + ' eligible assignment' + (expiringEligible.length !== 1 ? 's' : '') + ' will expire within 30 days. Plan renewals to maintain access continuity.',
                'Review expiring assignments and renew those still needed.'));
        }

        if (pendingCount === 0 && activeActivations.length === 0 && noJustification.length === 0 && expiringEligible.length === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'PIM Status',
                'No pending approvals or issues detected. PIM operations are running smoothly.', null));
        }

        container.appendChild(insightsList);

        // Pending approvals table
        var pendingApprovals = requests.filter(function(e) { return e.status === 'PendingApproval' || e.status === 'PendingAdminDecision'; });
        if (pendingApprovals.length > 0) {
            var pendingSection = document.createElement('div');
            pendingSection.className = 'analytics-section';
            var pendingTitle = document.createElement('h3');
            pendingTitle.textContent = 'Pending Approvals (' + pendingApprovals.length + ')';
            pendingSection.appendChild(pendingTitle);
            var pendingTableDiv = document.createElement('div');
            pendingTableDiv.id = 'pim-pending-table';
            pendingSection.appendChild(pendingTableDiv);
            container.appendChild(pendingSection);

            Tables.render({
                containerId: 'pim-pending-table',
                data: pendingApprovals,
                columns: [
                    { key: 'createdDateTime', label: 'Requested', formatter: Tables.formatters.datetime },
                    { key: 'principalDisplayName', label: 'User', formatter: function(v, row) {
                        if (!v) return '--';
                        var upn = row.principalUpn || v;
                        return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                    }},
                    { key: 'roleName', label: 'Role', formatter: function(v) {
                        if (!v) return '--';
                        return '<span class="entity-link">' + Tables.escapeHtml(v) + '</span>';
                    }},
                    { key: 'status', label: 'Status', formatter: formatPimStatus },
                    { key: 'justification', label: 'Justification', className: 'cell-truncate' },
                    { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                        return '<a href="https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles" target="_blank" rel="noopener" class="admin-link" title="Open PIM in Entra">Entra</a>';
                    }}
                ],
                pageSize: 10,
                onRowClick: showPimDetails
            });
        }

        // Active activations table
        if (activeActivations.length > 0) {
            var activeSection = document.createElement('div');
            activeSection.className = 'analytics-section';
            var activeTitle = document.createElement('h3');
            activeTitle.textContent = 'Currently Active Activations (' + activeActivations.length + ')';
            activeSection.appendChild(activeTitle);
            var activeTableDiv = document.createElement('div');
            activeTableDiv.id = 'pim-active-table';
            activeSection.appendChild(activeTableDiv);
            container.appendChild(activeSection);

            Tables.render({
                containerId: 'pim-active-table',
                data: activeActivations,
                columns: [
                    { key: 'principalDisplayName', label: 'User', formatter: function(v, row) {
                        if (!v) return '--';
                        var upn = row.principalUpn || v;
                        return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                    }},
                    { key: 'roleName', label: 'Role', formatter: function(v) {
                        if (!v) return '--';
                        return '<span class="entity-link">' + Tables.escapeHtml(v) + '</span>';
                    }},
                    { key: 'createdDateTime', label: 'Activated', formatter: Tables.formatters.datetime },
                    { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.datetime },
                    { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                        return '<a href="https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles" target="_blank" rel="noopener" class="admin-link" title="Open PIM in Entra">Entra</a>';
                    }}
                ],
                pageSize: 10,
                onRowClick: showPimDetails
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

    function renderRequestsTab(container) {
        container.innerHTML = '<div id="pim-requests-filter"></div><div class="table-container" id="pim-requests-table"></div>';

        Filters.createFilterBar({
            containerId: 'pim-requests-filter',
            controls: [
                {
                    type: 'search',
                    id: 'pim-search',
                    label: 'Search',
                    placeholder: 'Search PIM activities...'
                },
                {
                    type: 'select',
                    id: 'pim-type',
                    label: 'Type',
                    options: [
                        { value: 'all', label: 'All Types' },
                        { value: 'activate', label: 'Activations' },
                        { value: 'assign', label: 'Assignments' }
                    ]
                }
            ],
            onFilter: function() { renderRequestsTable(); }
        });

        renderRequestsTable();
    }

    function renderRequestsTable() {
        var search = Filters.getValue('pim-search') || '';
        var typeFilter = Filters.getValue('pim-type');

        var filtered = pimState.requests.filter(function(e) {
            if (search) {
                var s = search.toLowerCase();
                var match = (e.principalDisplayName && e.principalDisplayName.toLowerCase().indexOf(s) !== -1) ||
                            (e.roleName && e.roleName.toLowerCase().indexOf(s) !== -1) ||
                            (e.principalUpn && e.principalUpn.toLowerCase().indexOf(s) !== -1) ||
                            (e.justification && e.justification.toLowerCase().indexOf(s) !== -1);
                if (!match) return false;
            }
            if (typeFilter === 'activate' && e.action !== 'selfActivate') return false;
            if (typeFilter === 'assign' && e.action !== 'adminAssign') return false;
            return true;
        });

        Tables.render({
            containerId: 'pim-requests-table',
            data: filtered,
            columns: [
                { key: 'createdDateTime', label: 'Date', formatter: Tables.formatters.datetime },
                { key: 'principalDisplayName', label: 'User', filterable: true, formatter: function(v, row) {
                    if (!v) return '--';
                    var upn = row.principalUpn || v;
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'roleName', label: 'Role', filterable: true, formatter: function(v) {
                    if (!v) return '--';
                    return '<span class="entity-link">' + Tables.escapeHtml(v) + '</span>';
                }},
                { key: 'action', label: 'Action', filterable: true, formatter: formatAction },
                { key: 'status', label: 'Status', filterable: true, formatter: formatPimStatus },
                { key: 'justification', label: 'Justification', className: 'cell-truncate' },
                { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.datetime },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles" target="_blank" rel="noopener" class="admin-link" title="Open PIM in Entra">Entra</a>';
                }}
            ],
            pageSize: 15,
            onRowClick: showPimDetails
        });
    }

    function renderEligibleTab(container) {
        container.innerHTML = '<div id="pim-eligible-filter"></div><div class="table-container" id="pim-eligible-table"></div>';

        Filters.createFilterBar({
            containerId: 'pim-eligible-filter',
            controls: [
                {
                    type: 'search',
                    id: 'pim-eligible-search',
                    label: 'Search',
                    placeholder: 'Search eligible assignments...'
                },
                {
                    type: 'select',
                    id: 'pim-eligible-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All Status' },
                        { value: 'Provisioned', label: 'Provisioned' },
                        { value: 'PendingApproval', label: 'Pending Approval' }
                    ]
                }
            ],
            onFilter: function() { renderEligibleTable(); }
        });

        renderEligibleTable();
    }

    function renderEligibleTable() {
        var search = Filters.getValue('pim-eligible-search') || '';
        var statusFilter = Filters.getValue('pim-eligible-status');

        var filtered = pimState.eligible.filter(function(e) {
            if (search) {
                var s = search.toLowerCase();
                var match = (e.principalDisplayName && e.principalDisplayName.toLowerCase().indexOf(s) !== -1) ||
                            (e.principalUpn && e.principalUpn.toLowerCase().indexOf(s) !== -1) ||
                            (e.roleName && e.roleName.toLowerCase().indexOf(s) !== -1);
                if (!match) return false;
            }
            if (statusFilter && statusFilter !== 'all' && e.status !== statusFilter) return false;
            return true;
        });

        Tables.render({
            containerId: 'pim-eligible-table',
            data: filtered,
            columns: [
                { key: 'principalDisplayName', label: 'User', filterable: true, formatter: function(v, row) {
                    if (!v) return '--';
                    var upn = row.principalUpn || v;
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'principalUpn', label: 'UPN', className: 'cell-truncate', formatter: function(v) {
                    if (!v) return '--';
                    return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'roleName', label: 'Role', filterable: true, formatter: function(v) {
                    if (!v) return '--';
                    return '<span class="entity-link">' + Tables.escapeHtml(v) + '</span>';
                }},
                { key: 'status', label: 'Status', filterable: true, formatter: formatPimStatus },
                { key: 'scheduleStartDateTime', label: 'Start', formatter: Tables.formatters.date },
                { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.date },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles" target="_blank" rel="noopener" class="admin-link" title="Open PIM in Entra">Entra</a>';
                }}
            ],
            pageSize: 15,
            onRowClick: showPimDetails
        });
    }

    function render(container) {
        var pimData = DataLoader.getData('pimActivity') || [];

        var requests = pimData.filter(function(e) { return e.entryType === 'request'; });
        var eligible = pimData.filter(function(e) { return e.entryType === 'eligible'; });

        var activeActivations = requests.filter(function(e) {
            return e.action === 'selfActivate' && e.status === 'Provisioned';
        }).length;
        var pendingApprovals = requests.filter(function(e) {
            return e.status === 'PendingApproval';
        }).length;
        var eligibleCount = eligible.length;

        var sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        var recentActivity = requests.filter(function(e) {
            return e.createdDateTime && new Date(e.createdDateTime) > sevenDaysAgo;
        }).length;

        pimState = {
            requests: requests,
            eligible: eligible,
            activeActivations: activeActivations,
            pendingApprovals: pendingApprovals,
            eligibleCount: eligibleCount,
            recentActivity: recentActivity,
            totalRequests: requests.length
        };

        container.textContent = '';

        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Privileged Identity Management';
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'PIM role activations, assignments, and eligible roles';
        header.appendChild(h2);
        header.appendChild(desc);
        container.appendChild(header);

        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'summary-cards';

        cardsGrid.appendChild(createCard('Active Activations', String(activeActivations),
            activeActivations > 0 ? 'card-warning' : '', activeActivations > 0 ? 'text-warning' : ''));
        cardsGrid.appendChild(createCard('Pending Approval', String(pendingApprovals),
            pendingApprovals > 0 ? 'card-danger' : '', pendingApprovals > 0 ? 'text-critical' : 'text-success',
            pendingApprovals > 0 ? 'Requires attention' : ''));
        cardsGrid.appendChild(createCard('Eligible Assignments', String(eligibleCount), '', ''));
        cardsGrid.appendChild(createCard('Recent Activity (7d)', String(recentActivity), '', '',
            requests.length + ' total requests'));

        container.appendChild(cardsGrid);

        var tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        tabBar.innerHTML = [
            '<button class="tab-btn active" data-tab="overview">Overview</button>',
            '<button class="tab-btn" data-tab="requests">Requests (' + requests.length + ')</button>',
            '<button class="tab-btn" data-tab="eligible">Eligible (' + eligible.length + ')</button>'
        ].join('');
        container.appendChild(tabBar);

        var contentArea = document.createElement('div');
        contentArea.className = 'content-area';
        contentArea.id = 'pim-content';
        container.appendChild(contentArea);

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
window.PagePIM = PagePIM;
