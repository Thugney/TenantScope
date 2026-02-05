/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: GUESTS
 *
 * Renders the guest accounts page showing external users and their status.
 * Highlights stale guests and pending invitations.
 */

const PageGuests = (function() {
    'use strict';

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const guests = DataLoader.getData('guests');

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('guests-search'),
            searchFields: ['displayName', 'mail', 'sourceDomain']
        };

        // Apply filters
        let filteredData = Filters.apply(guests, filterConfig);

        // Status filter
        const status = Filters.getValue('guests-status');
        if (status && status !== 'all') {
            switch (status) {
                case 'active':
                    filteredData = filteredData.filter(g => !g.isStale && !g.neverSignedIn && g.invitationState === 'Accepted');
                    break;
                case 'stale':
                    filteredData = filteredData.filter(g => g.isStale);
                    break;
                case 'never':
                    filteredData = filteredData.filter(g => g.neverSignedIn);
                    break;
                case 'pending':
                    filteredData = filteredData.filter(g => g.invitationState === 'PendingAcceptance');
                    break;
            }
        }

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the guests table.
     *
     * @param {Array} data - Filtered guest data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'guests-table',
            data: data,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'mail', label: 'Email', className: 'cell-truncate' },
                { key: 'sourceDomain', label: 'Source Domain' },
                { key: 'createdDateTime', label: 'Invited', formatter: Tables.formatters.date },
                { key: 'invitationState', label: 'Invitation', formatter: formatInvitationState },
                { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
                { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
                { key: 'isStale', label: 'Status', formatter: formatGuestStatus }
            ],
            pageSize: 50,
            onRowClick: showGuestDetails,
            getRowClass: (row) => {
                if (row.isStale) return 'row-warning';
                if (row.neverSignedIn) return 'row-muted';
                return '';
            }
        });
    }

    /**
     * Formats invitation state with badge.
     */
    function formatInvitationState(value) {
        if (value === 'Accepted') {
            return '<span class="badge badge-success">Accepted</span>';
        }
        return '<span class="badge badge-warning">Pending</span>';
    }

    /**
     * Formats guest status.
     */
    function formatGuestStatus(value, row) {
        if (row.invitationState === 'PendingAcceptance') {
            return '<span class="badge badge-warning">Pending</span>';
        }
        if (row.neverSignedIn) {
            return '<span class="badge badge-neutral">Never Signed In</span>';
        }
        if (row.isStale) {
            return '<span class="badge badge-critical">Stale</span>';
        }
        return '<span class="badge badge-success">Active</span>';
    }

    /**
     * Shows detailed modal for a guest.
     *
     * @param {object} guest - Guest data object
     */
    function showGuestDetails(guest) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = guest.displayName;

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${guest.mail || '--'}</span>

                <span class="detail-label">Source Domain:</span>
                <span class="detail-value">${guest.sourceDomain}</span>

                <span class="detail-label">Invitation State:</span>
                <span class="detail-value">${guest.invitationState}</span>

                <span class="detail-label">Invited:</span>
                <span class="detail-value">${DataLoader.formatDate(guest.createdDateTime)}</span>

                <span class="detail-label">Last Sign-In:</span>
                <span class="detail-value">${DataLoader.formatDate(guest.lastSignIn)}</span>

                <span class="detail-label">Days Since Sign-In:</span>
                <span class="detail-value">${guest.daysSinceLastSignIn !== null ? guest.daysSinceLastSignIn : '--'}</span>

                <span class="detail-label">Is Stale:</span>
                <span class="detail-value">${guest.isStale ? 'Yes' : 'No'}</span>

                <span class="detail-label">Never Signed In:</span>
                <span class="detail-value">${guest.neverSignedIn ? 'Yes' : 'No'}</span>

                <span class="detail-label">Guest ID:</span>
                <span class="detail-value" style="font-size: 0.8em;">${guest.id}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    /**
     * Renders the guests page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        const guests = DataLoader.getData('guests');

        // Calculate stats
        const activeCount = guests.filter(g => !g.isStale && !g.neverSignedIn && g.invitationState === 'Accepted').length;
        const staleCount = guests.filter(g => g.isStale).length;
        const neverSignedInCount = guests.filter(g => g.neverSignedIn).length;
        const pendingCount = guests.filter(g => g.invitationState === 'PendingAcceptance').length;

        // Get unique source domains
        const sourceDomains = [...new Set(guests.map(g => g.sourceDomain).filter(Boolean))].sort();

        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">Guest Accounts</h2>
                <p class="page-description">External users with access to your tenant</p>
            </div>

            <!-- Summary Cards -->
            <div class="cards-grid">
                <div class="card">
                    <div class="card-label">Total Guests</div>
                    <div class="card-value">${guests.length}</div>
                </div>
                <div class="card card-success">
                    <div class="card-label">Active</div>
                    <div class="card-value success">${activeCount}</div>
                </div>
                <div class="card ${staleCount > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Stale</div>
                    <div class="card-value ${staleCount > 0 ? 'warning' : ''}">${staleCount}</div>
                    <div class="card-change">60+ days inactive</div>
                </div>
                <div class="card ${pendingCount > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Pending</div>
                    <div class="card-value ${pendingCount > 0 ? 'warning' : ''}">${pendingCount}</div>
                    <div class="card-change">Awaiting acceptance</div>
                </div>
            </div>

            <!-- Charts -->
            <div class="charts-row" id="guests-charts"></div>

            <!-- Filters -->
            <div id="guests-filter"></div>

            <!-- Data Table -->
            <div id="guests-table"></div>
        `;

        // Render charts
        var chartsRow = document.getElementById('guests-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Guest Status',
                [
                    { value: activeCount, label: 'Active', color: C.green },
                    { value: staleCount, label: 'Stale', color: C.yellow },
                    { value: pendingCount, label: 'Pending', color: C.orange },
                    { value: neverSignedInCount, label: 'Never Signed In', color: C.red }
                ],
                String(guests.length), 'total guests'
            ));

            var acceptedCount = guests.filter(g => g.invitationState === 'Accepted').length;
            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Invitation State',
                [
                    { value: acceptedCount, label: 'Accepted', color: C.green },
                    { value: pendingCount, label: 'Pending', color: C.orange }
                ],
                guests.length > 0 ? Math.round((acceptedCount / guests.length) * 100) + '%' : '0%',
                'accepted'
            ));
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'guests-filter',
            controls: [
                {
                    type: 'search',
                    id: 'guests-search',
                    label: 'Search',
                    placeholder: 'Search guests...'
                },
                {
                    type: 'select',
                    id: 'guests-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All Status' },
                        { value: 'active', label: 'Active' },
                        { value: 'stale', label: 'Stale' },
                        { value: 'never', label: 'Never Signed In' },
                        { value: 'pending', label: 'Pending' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Bind export button
        Export.bindExportButton('guests-table', 'guests');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageGuests = PageGuests;
