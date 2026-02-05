/**
 * ============================================================================
 * TenantScope
 * Author: Robe (https://github.com/Thugney)
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

    /**
     * Renders the PIM activity page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var pimData = DataLoader.getData('pimActivity');

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
            return e.createdDateTime && new Date(e.createdDateTime) > sevenDaysAgo;
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
                { key: 'principalDisplayName', label: 'User', filterable: true },
                { key: 'roleName', label: 'Role', filterable: true },
                { key: 'action', label: 'Action', filterable: true, formatter: formatAction },
                { key: 'status', label: 'Status', filterable: true, formatter: formatPimStatus },
                { key: 'justification', label: 'Justification', className: 'cell-truncate' },
                { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.datetime }
            ],
            pageSize: 15,
            onRowClick: showPimDetails
        });

        // Render eligible assignments table
        Tables.render({
            containerId: 'pim-eligible-table',
            data: eligible,
            columns: [
                { key: 'principalDisplayName', label: 'User', filterable: true },
                { key: 'principalUpn', label: 'UPN', className: 'cell-truncate' },
                { key: 'roleName', label: 'Role', filterable: true },
                { key: 'status', label: 'Status', filterable: true, formatter: formatPimStatus },
                { key: 'scheduleStartDateTime', label: 'Start', formatter: Tables.formatters.date },
                { key: 'scheduleEndDateTime', label: 'Expires', formatter: Tables.formatters.date }
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

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PagePIM = PagePIM;
