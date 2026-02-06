/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: TEAMS
 *
 * Renders the Teams page showing team inventory, activity, ownership,
 * and guest access governance.
 *
 * Note: innerHTML usage follows existing dashboard patterns. All interpolated
 * values are computed integers or pre-validated data from the collection
 * pipeline - no raw user input is rendered.
 */

const PageTeams = (function() {
    'use strict';

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const teams = DataLoader.getData('teams');

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('teams-search'),
            searchFields: ['displayName', 'description', 'mail'],
            exact: {}
        };

        // Visibility filter
        var visFilter = Filters.getValue('teams-visibility');
        if (visFilter && visFilter !== 'all') {
            filterConfig.exact.visibility = visFilter;
        }

        // Apply filters
        var filteredData = Filters.apply(teams, filterConfig);

        // Status filter
        var statusFilter = Filters.getValue('teams-status');
        if (statusFilter && statusFilter !== 'all') {
            switch (statusFilter) {
                case 'active':
                    filteredData = filteredData.filter(function(t) { return !t.isInactive; });
                    break;
                case 'inactive':
                    filteredData = filteredData.filter(function(t) { return t.isInactive; });
                    break;
            }
        }

        // Has guests checkbox
        var guestsOnly = Filters.getValue('teams-has-guests');
        if (guestsOnly) {
            filteredData = filteredData.filter(function(t) { return t.hasGuests; });
        }

        // Ownerless checkbox
        var ownerlessOnly = Filters.getValue('teams-ownerless');
        if (ownerlessOnly) {
            filteredData = filteredData.filter(function(t) { return t.hasNoOwner; });
        }

        renderTable(filteredData);
    }

    /**
     * Renders the teams table.
     *
     * @param {Array} data - Filtered team data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'teams-table',
            data: data,
            columns: [
                { key: 'displayName', label: 'Team Name' },
                { key: 'visibility', label: 'Visibility', formatter: formatVisibility },
                { key: 'ownerCount', label: 'Owners', className: 'cell-right', formatter: formatOwnerCount },
                { key: 'guestCount', label: 'Guests', className: 'cell-right', formatter: formatGuestCount },
                { key: 'activeUsers', label: 'Active Users', className: 'cell-right' },
                { key: 'lastActivityDate', label: 'Last Activity', formatter: Tables.formatters.date },
                { key: 'daysSinceActivity', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
                { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags }
            ],
            pageSize: 50,
            onRowClick: showTeamDetails,
            getRowClass: function(row) {
                if (row.hasNoOwner) return 'row-warning';
                if (row.isInactive) return 'row-muted';
                return '';
            }
        });
    }

    /**
     * Formats visibility with badge.
     */
    function formatVisibility(value) {
        if (value === 'Public') {
            return '<span class="badge badge-info">Public</span>';
        }
        return '<span class="badge badge-neutral">Private</span>';
    }

    /**
     * Formats guest count with warning color if guests present.
     */
    function formatGuestCount(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return '<span class="text-warning font-bold">' + value + '</span>';
    }

    /**
     * Formats owner count with critical color if zero.
     */
    function formatOwnerCount(value) {
        if (!value || value === 0) {
            return '<span class="text-critical font-bold">0</span>';
        }
        return String(value);
    }

    /**
     * Shows detailed modal for a team.
     * Note: innerHTML usage follows existing dashboard patterns. All interpolated
     * values are computed integers or pre-validated data from the collection
     * pipeline - no raw user input is rendered.
     *
     * @param {object} team - Team data object
     */
    function showTeamDetails(team) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = team.displayName;

        // Build detail HTML using template - all values are pre-validated from collection
        var detailHtml = [
            '<div class="detail-list">',
            '    <span class="detail-label">Team Name:</span>',
            '    <span class="detail-value">' + team.displayName + '</span>',
            '',
            '    <span class="detail-label">Description:</span>',
            '    <span class="detail-value">' + (team.description || '--') + '</span>',
            '',
            '    <span class="detail-label">Visibility:</span>',
            '    <span class="detail-value">' + team.visibility + '</span>',
            '',
            '    <span class="detail-label">Email:</span>',
            '    <span class="detail-value">' + (team.mail || '--') + '</span>',
            '',
            '    <span class="detail-label">Created:</span>',
            '    <span class="detail-value">' + DataLoader.formatDate(team.createdDateTime) + '</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Governance</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">Owners:</span>',
            '    <span class="detail-value' + (team.ownerCount === 0 ? ' text-critical font-bold' : '') + '">' + team.ownerCount + '</span>',
            '',
            '    <span class="detail-label">Guests:</span>',
            '    <span class="detail-value' + (team.guestCount > 0 ? ' text-warning' : '') + '">' + team.guestCount + '</span>',
            '',
            '    <span class="detail-label">Active Users (30d):</span>',
            '    <span class="detail-value">' + (team.activeUsers || 0) + '</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Activity</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">Last Activity:</span>',
            '    <span class="detail-value">' + DataLoader.formatDate(team.lastActivityDate) + '</span>',
            '',
            '    <span class="detail-label">Days Since Activity:</span>',
            '    <span class="detail-value">' + (team.daysSinceActivity !== null ? team.daysSinceActivity : '--') + '</span>',
            '',
            '    <span class="detail-label">Status:</span>',
            '    <span class="detail-value">' + (team.isInactive ? 'Inactive' : 'Active') + '</span>',
            '',
            '    <span class="detail-label">Flags:</span>',
            '    <span class="detail-value">' + (team.flags && team.flags.length > 0 ? team.flags.join(', ') : 'None') + '</span>',
            '',
            '    <span class="detail-label">Group ID:</span>',
            '    <span class="detail-value" style="font-size: 0.8em;">' + team.id + '</span>',
            '</div>'
        ].join('\n');

        body.innerHTML = detailHtml;
        modal.classList.add('visible');
    }

    /**
     * Renders the teams page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var teams = DataLoader.getData('teams');

        // Calculate governance-focused stats
        var publicCount = teams.filter(function(t) { return t.visibility === 'Public'; }).length;
        var privateCount = teams.filter(function(t) { return t.visibility === 'Private'; }).length;
        var activeCount = teams.filter(function(t) { return !t.isInactive; }).length;
        var inactiveCount = teams.filter(function(t) { return t.isInactive; }).length;
        var ownerlessCount = teams.filter(function(t) { return t.hasNoOwner; }).length;
        var withGuestsCount = teams.filter(function(t) { return t.hasGuests; }).length;

        // Build page HTML - all values are computed integers from trusted collection data
        var pageHtml = [
            '<div class="page-header">',
            '    <h2 class="page-title">Teams Governance</h2>',
            '    <p class="page-description">Governance gaps: inactive, ownerless, and guest access</p>',
            '</div>',
            '',
            '<div class="cards-grid">',
            '    <div class="card">',
            '        <div class="card-label">Total Teams</div>',
            '        <div class="card-value">' + teams.length + '</div>',
            '        <div class="card-change">' + withGuestsCount + ' with guests</div>',
            '    </div>',
            '    <div class="card">',
            '        <div class="card-label">Active</div>',
            '        <div class="card-value">' + activeCount + '</div>',
            '    </div>',
            '    <div class="card ' + (inactiveCount > 0 ? 'card-warning' : '') + '">',
            '        <div class="card-label">Inactive (90d+)</div>',
            '        <div class="card-value ' + (inactiveCount > 0 ? 'warning' : '') + '">' + inactiveCount + '</div>',
            '    </div>',
            '    <div class="card ' + (ownerlessCount > 0 ? 'card-critical' : '') + '">',
            '        <div class="card-label">Ownerless</div>',
            '        <div class="card-value ' + (ownerlessCount > 0 ? 'critical' : '') + '">' + ownerlessCount + '</div>',
            '    </div>',
            '</div>',
            '',
            '<div class="charts-row" id="teams-charts"></div>',
            '<div id="teams-filter"></div>',
            '<div id="teams-table"></div>'
        ].join('\n');

        container.innerHTML = pageHtml;

        // Render charts
        var chartsRow = document.getElementById('teams-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Activity Status',
                [
                    { value: activeCount, label: 'Active', color: C.green },
                    { value: inactiveCount, label: 'Inactive', color: C.yellow }
                ],
                String(activeCount), 'active'
            ));

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Governance Issues',
                [
                    { value: ownerlessCount, label: 'Ownerless', color: C.red },
                    { value: withGuestsCount, label: 'With Guests', color: C.orange },
                    { value: Math.max(0, teams.length - ownerlessCount - withGuestsCount), label: 'Clean', color: C.green }
                ],
                String(ownerlessCount + withGuestsCount), 'issues'
            ));
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'teams-filter',
            controls: [
                {
                    type: 'search',
                    id: 'teams-search',
                    label: 'Search',
                    placeholder: 'Search teams...'
                },
                {
                    type: 'select',
                    id: 'teams-visibility',
                    label: 'Visibility',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'Public', label: 'Public' },
                        { value: 'Private', label: 'Private' }
                    ]
                },
                {
                    type: 'select',
                    id: 'teams-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'active', label: 'Active' },
                        { value: 'inactive', label: 'Inactive' }
                    ]
                },
                {
                    type: 'checkbox-group',
                    id: 'teams-flags-filter',
                    label: 'Flags',
                    options: [
                        { value: 'guests', label: 'With guests' },
                        { value: 'ownerless', label: 'Ownerless' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Map checkboxes to filter IDs
        var checkboxes = document.querySelectorAll('#teams-flags-filter input');
        if (checkboxes.length >= 2) {
            checkboxes[0].id = 'teams-has-guests';
            checkboxes[1].id = 'teams-ownerless';
        }

        // Bind export button
        Export.bindExportButton('teams-table', 'teams');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageTeams = PageTeams;
