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

    /** Column selector instance */
    var colSelector = null;

    /** Current breakdown dimension */
    var currentBreakdown = 'sourceDomain';

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

        // Date range filters
        var createdRange = Filters.getValue('guests-created-range');
        if (createdRange && (createdRange.from || createdRange.to)) {
            filteredData = filteredData.filter(function(g) {
                if (!g.createdDateTime) return false;
                var dt = new Date(g.createdDateTime);
                if (createdRange.from && dt < new Date(createdRange.from)) return false;
                if (createdRange.to && dt > new Date(createdRange.to + 'T23:59:59')) return false;
                return true;
            });
        }

        var signinRange = Filters.getValue('guests-signin-range');
        if (signinRange && (signinRange.from || signinRange.to)) {
            filteredData = filteredData.filter(function(g) {
                if (!g.lastSignIn) return !signinRange.from;
                var dt = new Date(g.lastSignIn);
                if (signinRange.from && dt < new Date(signinRange.from)) return false;
                if (signinRange.to && dt > new Date(signinRange.to + 'T23:59:59')) return false;
                return true;
            });
        }

        // Render Focus/Breakdown tables
        renderFocusBreakdown(filteredData);

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the guests table.
     *
     * @param {Array} data - Filtered guest data
     */
    function renderTable(data) {
        // Get visible columns from Column Selector
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'mail', 'sourceDomain', 'createdDateTime',
            'invitationState', 'lastSignIn', 'daysSinceLastSignIn', 'isStale'
        ];

        // All column definitions
        var allDefs = [
            { key: 'displayName', label: 'Name' },
            { key: 'mail', label: 'Email', className: 'cell-truncate' },
            { key: 'sourceDomain', label: 'Source Domain' },
            { key: 'createdDateTime', label: 'Invited', formatter: Tables.formatters.date },
            { key: 'invitationState', label: 'Invitation', formatter: formatInvitationState },
            { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
            { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
            { key: 'isStale', label: 'Status', formatter: formatGuestStatus },
            { key: 'neverSignedIn', label: 'Never Signed In', formatter: function(v) { return v ? 'Yes' : 'No'; } }
        ];

        // Filter to visible columns only
        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'guests-table',
            data: data,
            columns: columns,
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
     * Renders Focus/Breakdown tables for guest analysis.
     *
     * @param {Array} guests - Filtered guest data
     */
    function renderFocusBreakdown(guests) {
        var focusContainer = document.getElementById('guests-focus-table');
        var breakdownContainer = document.getElementById('guests-breakdown-table');
        var breakdownFilterContainer = document.getElementById('guests-breakdown-filter');

        if (!focusContainer || !breakdownContainer) return;

        // Breakdown dimension options
        var breakdownDimensions = [
            { key: 'sourceDomain', label: 'Source Domain' },
            { key: 'invitationState', label: 'Invitation State' }
        ];

        // Render breakdown filter
        if (breakdownFilterContainer && typeof FocusTables !== 'undefined') {
            FocusTables.renderBreakdownFilter({
                containerId: 'guests-breakdown-filter',
                dimensions: breakdownDimensions,
                selected: currentBreakdown,
                onChange: function(newDim) {
                    currentBreakdown = newDim;
                    renderFocusBreakdown(guests);
                }
            });
        }

        // Derive guest status for focus grouping
        var guestsWithStatus = guests.map(function(g) {
            var guestStatus = 'Active';
            if (g.invitationState === 'PendingAcceptance') guestStatus = 'Pending';
            else if (g.neverSignedIn) guestStatus = 'Never Signed In';
            else if (g.isStale) guestStatus = 'Stale';
            return Object.assign({}, g, { guestStatus: guestStatus });
        });

        // Render Focus Table: group by status
        if (typeof FocusTables !== 'undefined') {
            FocusTables.renderFocusTable({
                containerId: 'guests-focus-table',
                data: guestsWithStatus,
                groupByKey: 'guestStatus',
                groupByLabel: 'Status',
                countLabel: 'Guests'
            });

            // Render Breakdown Table: status x breakdown dimension
            FocusTables.renderBreakdownTable({
                containerId: 'guests-breakdown-table',
                data: guestsWithStatus,
                primaryKey: 'guestStatus',
                breakdownKey: currentBreakdown,
                primaryLabel: 'Status',
                breakdownLabel: breakdownDimensions.find(function(d) { return d.key === currentBreakdown; }).label
            });
        }
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

            <!-- Focus/Breakdown Analysis -->
            <div class="section-header">
                <h3>Guest Analysis</h3>
                <div id="guests-breakdown-filter"></div>
            </div>
            <div class="focus-breakdown-row">
                <div id="guests-focus-table"></div>
                <div id="guests-breakdown-table"></div>
            </div>

            <!-- Filters -->
            <div id="guests-filter"></div>

            <!-- Column Selector + Export -->
            <div class="table-toolbar">
                <div id="guests-col-selector"></div>
                <button class="btn btn-secondary btn-sm" id="export-guests-table">Export CSV</button>
            </div>

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
                },
                {
                    type: 'date-range',
                    id: 'guests-created-range',
                    label: 'Invited'
                },
                {
                    type: 'date-range',
                    id: 'guests-signin-range',
                    label: 'Last Sign-In'
                }
            ],
            onFilter: applyFilters
        });

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'guests-col-selector',
                storageKey: 'guests-columns',
                allColumns: [
                    { key: 'displayName', label: 'Name' },
                    { key: 'mail', label: 'Email' },
                    { key: 'sourceDomain', label: 'Source Domain' },
                    { key: 'createdDateTime', label: 'Invited' },
                    { key: 'invitationState', label: 'Invitation' },
                    { key: 'lastSignIn', label: 'Last Sign-In' },
                    { key: 'daysSinceLastSignIn', label: 'Days Inactive' },
                    { key: 'isStale', label: 'Status' },
                    { key: 'neverSignedIn', label: 'Never Signed In' }
                ],
                defaultVisible: [
                    'displayName', 'mail', 'sourceDomain', 'createdDateTime',
                    'invitationState', 'lastSignIn', 'daysSinceLastSignIn', 'isStale'
                ],
                onColumnsChanged: applyFilters
            });
        }

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
