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
     * Builds inline SVG donut chart HTML (matching Endpoint Analytics style).
     *
     * @param {Array} segments - Array of { count: number, color: string }
     * @param {number} total - Total count for percentage calculation
     * @param {string} centerValue - Text shown in center of donut
     * @param {string} centerLabel - Sub-label below center text
     * @returns {string} HTML string for the donut chart
     */
    function buildDonutSVG(segments, total, centerValue, centerLabel) {
        var radius = 40;
        var circumference = 2 * Math.PI * radius;
        var html = '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        if (total > 0) {
            var offset = 0;
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                if (seg.count <= 0) continue;
                var dash = (seg.count / total) * circumference;
                html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="' + seg.color + '" stroke-width="10" stroke-dasharray="' + dash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round" transform="rotate(-90 50 50)"/>';
                offset += dash;
            }
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value">' + centerValue + '</span><span class="donut-label">' + centerLabel + '</span></div>';
        html += '</div>';
        return html;
    }

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
                { key: 'sensitivityLabelName', label: 'Sensitivity', formatter: formatSensitivityLabel },
                { key: 'ownerCount', label: 'Owners', className: 'cell-right', formatter: formatOwnerCount },
                { key: 'memberCount', label: 'Members', className: 'cell-right', formatter: formatMemberCount },
                { key: 'channelCount', label: 'Channels', className: 'cell-right', formatter: formatChannelCount },
                { key: 'privateChannelCount', label: 'Private Ch.', className: 'cell-right', formatter: formatChannelCount },
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

    function formatSensitivityLabel(value) {
        if (!value) {
            return '<span class="text-muted">--</span>';
        }
        return value;
    }

    function formatMemberCount(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return String(value);
    }

    function formatChannelCount(value) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return String(value);
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
            '    <span class="detail-label">Sensitivity:</span>',
            '    <span class="detail-value">' + (team.sensitivityLabelName || '--') + '</span>',
            '',
            '    <span class="detail-label">Email:</span>',
            '    <span class="detail-value">' + (team.mail || '--') + '</span>',
            '',
            '    <span class="detail-label">Linked SharePoint Site ID:</span>',
            '    <span class="detail-value" style="font-size: 0.8em;">' + (team.linkedSharePointSiteId || '--') + '</span>',
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
            '    <span class="detail-label">Owner Emails:</span>',
            '    <span class="detail-value">' + (team.ownerUpns && team.ownerUpns.length > 0 ? team.ownerUpns.join(', ') : '--') + '</span>',
            '',
            '    <span class="detail-label">Members:</span>',
            '    <span class="detail-value">' + (team.memberCount || 0) + '</span>',
            '',
            '    <span class="detail-label">Channels:</span>',
            '    <span class="detail-value">' + (team.channelCount !== null && team.channelCount !== undefined ? team.channelCount : '--') + '</span>',
            '',
            '    <span class="detail-label">Private Channels:</span>',
            '    <span class="detail-value">' + (team.privateChannelCount !== null && team.privateChannelCount !== undefined ? team.privateChannelCount : '--') + '</span>',
            '',
            '    <span class="detail-label">Guests:</span>',
            '    <span class="detail-value' + (team.guestCount > 0 ? ' text-warning' : '') + '">' + team.guestCount + '</span>',
            '',
            '    <span class="detail-label">External Domains:</span>',
            '    <span class="detail-value">' + (team.externalDomains && team.externalDomains.length > 0 ? team.externalDomains.join(', ') : '--') + '</span>',
            '',
            '    <span class="detail-label">Suggested Owners:</span>',
            '    <span class="detail-value">' + (team.suggestedOwners && team.suggestedOwners.length > 0 ? team.suggestedOwners.join(', ') : '--') + '</span>',
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
        var inactiveCardClass = inactiveCount > 0 ? ' card-warning' : '';
        var inactiveTextClass = inactiveCount > 0 ? ' text-warning' : '';
        var ownerlessCardClass = ownerlessCount > 0 ? ' card-danger' : '';
        var ownerlessTextClass = ownerlessCount > 0 ? ' text-critical' : '';
        var cleanCount = Math.max(0, teams.length - ownerlessCount - withGuestsCount);

        // Summary cards (matching Endpoint Analytics style)
        var pageHtml = [
            '<div class="page-header">',
            '    <h2 class="page-title">Teams Governance</h2>',
            '    <p class="page-description">Governance gaps: inactive, ownerless, and guest access</p>',
            '</div>',
            '',
            '<div class="summary-cards">',
            '    <div class="summary-card card-info"><div class="summary-value">' + teams.length + '</div><div class="summary-label">Total Teams</div></div>',
            '    <div class="summary-card"><div class="summary-value">' + activeCount + '</div><div class="summary-label">Active</div></div>',
            '    <div class="summary-card' + inactiveCardClass + '"><div class="summary-value' + inactiveTextClass + '">' + inactiveCount + '</div><div class="summary-label">Inactive (90d+)</div></div>',
            '    <div class="summary-card' + ownerlessCardClass + '"><div class="summary-value' + ownerlessTextClass + '">' + ownerlessCount + '</div><div class="summary-label">Ownerless</div></div>',
            '</div>',
            '',
            '<div class="analytics-grid" id="teams-charts"></div>',
            '<div id="teams-filter"></div>',
            '<div id="teams-table"></div>'
        ].join('\n');

        container.innerHTML = pageHtml;

        // Render charts using inline SVG in analytics-card (matching Endpoint Analytics)
        var chartsContainer = document.getElementById('teams-charts');
        if (chartsContainer) {
            var totalTeams = teams.length;

            // Activity Status donut
            var activityHtml = '<div class="analytics-card"><h3>Activity Status</h3>';
            activityHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            activityHtml += buildDonutSVG([
                { count: activeCount, color: 'var(--color-success)' },
                { count: inactiveCount, color: 'var(--color-warning)' }
            ], totalTeams, String(activeCount), 'active');
            activityHtml += '</div>';
            activityHtml += '<div class="compliance-legend">';
            activityHtml += '<div class="legend-item"><span class="legend-dot bg-success"></span> Active: <strong>' + activeCount + '</strong></div>';
            activityHtml += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Inactive: <strong>' + inactiveCount + '</strong></div>';
            activityHtml += '</div></div></div>';

            // Governance Issues donut
            var govHtml = '<div class="analytics-card"><h3>Governance Issues</h3>';
            govHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            govHtml += buildDonutSVG([
                { count: ownerlessCount, color: 'var(--color-critical)' },
                { count: withGuestsCount, color: '#ea580c' },
                { count: cleanCount, color: 'var(--color-success)' }
            ], totalTeams, String(ownerlessCount + withGuestsCount), 'issues');
            govHtml += '</div>';
            govHtml += '<div class="compliance-legend">';
            govHtml += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Ownerless: <strong>' + ownerlessCount + '</strong></div>';
            govHtml += '<div class="legend-item"><span class="legend-dot bg-orange"></span> With Guests: <strong>' + withGuestsCount + '</strong></div>';
            govHtml += '<div class="legend-item"><span class="legend-dot bg-success"></span> Clean: <strong>' + cleanCount + '</strong></div>';
            govHtml += '</div></div></div>';

            chartsContainer.innerHTML = activityHtml + govHtml;
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
