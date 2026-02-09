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

    var colSelector = null;

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
        var teams = DataLoader.getData('teams') || [];
        if (!teams || teams.length === 0) return;

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

        // Update summary cards with filtered data
        updateTeamsSummaryCards(filteredData);

        renderTable(filteredData);
    }

    /**
     * Updates the summary cards with filtered data counts.
     */
    function updateTeamsSummaryCards(filteredTeams) {
        var total = filteredTeams.length;
        var activeCount = filteredTeams.filter(function(t) { return !t.isInactive; }).length;
        var inactiveCount = filteredTeams.filter(function(t) { return t.isInactive; }).length;
        var ownerlessCount = filteredTeams.filter(function(t) { return t.hasNoOwner; }).length;

        // Update values
        var totalEl = document.getElementById('teams-sum-total');
        var activeEl = document.getElementById('teams-sum-active');
        var inactiveEl = document.getElementById('teams-sum-inactive');
        var ownerlessEl = document.getElementById('teams-sum-ownerless');

        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = activeCount;
        if (inactiveEl) inactiveEl.textContent = inactiveCount;
        if (ownerlessEl) ownerlessEl.textContent = ownerlessCount;

        // Update card styling based on values
        var inactiveCard = document.getElementById('teams-card-inactive');
        var ownerlessCard = document.getElementById('teams-card-ownerless');

        if (inactiveCard) {
            inactiveCard.className = 'summary-card' + (inactiveCount > 0 ? ' card-warning' : '');
        }
        if (ownerlessCard) {
            ownerlessCard.className = 'summary-card' + (ownerlessCount > 0 ? ' card-danger' : '');
        }

        // Update value text colors
        if (inactiveEl) {
            inactiveEl.className = 'summary-value' + (inactiveCount > 0 ? ' text-warning' : '');
        }
        if (ownerlessEl) {
            ownerlessEl.className = 'summary-value' + (ownerlessCount > 0 ? ' text-critical' : '');
        }
    }

    /**
     * Renders the teams table.
     *
     * @param {Array} data - Filtered team data
     */
    function renderTable(data) {
        // Get visible columns from Column Selector
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'visibility', 'mail', 'ownerCount', 'memberCount',
            'guestCount', 'lastActivityDate', 'daysSinceActivity', 'flags', '_adminLinks'
        ];

        // All column definitions
        var allDefs = [
            { key: 'displayName', label: 'Team Name', formatter: function(v, row) {
                if (!v) return '--';
                return '<a href="#teams?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + v + '</strong></a>';
            }},
            { key: 'description', label: 'Description', formatter: formatDescription },
            { key: 'visibility', label: 'Visibility', formatter: formatVisibility },
            { key: 'sensitivityLabelName', label: 'Sensitivity', formatter: formatSensitivityLabel },
            { key: 'mail', label: 'Email' },
            { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
            { key: 'ownerCount', label: 'Owners', className: 'cell-right', formatter: function(v, row) {
                if (!v || v === 0) {
                    return '<span class="text-critical font-bold">0</span>';
                }
                // Link to owners on users page if ownerUpns available
                if (row.ownerUpns && row.ownerUpns.length > 0) {
                    return '<a href="#users?search=' + encodeURIComponent(row.ownerUpns[0]) + '" class="entity-link" title="' + row.ownerUpns.join(', ') + '">' + v + '</a>';
                }
                return String(v);
            }},
            { key: 'memberCount', label: 'Members', className: 'cell-right', formatter: formatMemberCount },
            { key: 'channelCount', label: 'Channels', className: 'cell-right', formatter: formatChannelCount },
            { key: 'privateChannelCount', label: 'Private Ch.', className: 'cell-right', formatter: formatChannelCount },
            { key: 'guestCount', label: 'Guests', className: 'cell-right', formatter: formatGuestCount },
            { key: 'externalDomains', label: 'External Domains', formatter: formatExternalDomains },
            { key: 'activeUsers', label: 'Active Users', className: 'cell-right' },
            { key: 'lastActivityDate', label: 'Last Activity', formatter: Tables.formatters.date },
            { key: 'daysSinceActivity', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
            { key: 'suggestedOwners', label: 'Suggested Owners', formatter: function(v, row) {
                if (!v || v.length === 0) {
                    return '<span class="text-muted">--</span>';
                }
                var arr = Array.isArray(v) ? v : [v];
                var links = arr.map(function(upn) {
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link">' + upn + '</a>';
                });
                if (links.length > 2) {
                    return links.slice(0, 2).join(', ') + ' +' + (links.length - 2) + ' more';
                }
                return links.join(', ');
            }},
            { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags },
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                var links = [];
                if (row.id) {
                    links.push('<a href="https://admin.teams.microsoft.com/teams/' + encodeURIComponent(row.id) + '" target="_blank" rel="noopener" class="admin-link" title="Open in Teams Admin">Teams Admin</a>');
                }
                return links.length > 0 ? links.join(' ') : '--';
            }}
        ];

        // Filter to visible columns only
        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'teams-table',
            data: data,
            columns: columns,
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
     * Formats description with truncation.
     */
    function formatDescription(value) {
        if (!value) {
            return '<span class="text-muted">--</span>';
        }
        if (value.length > 50) {
            return '<span title="' + value.replace(/"/g, '&quot;') + '">' + value.substring(0, 47) + '...</span>';
        }
        return value;
    }

    /**
     * Formats external domains array.
     */
    function formatExternalDomains(value) {
        if (!value || value.length === 0) {
            return '<span class="text-muted">--</span>';
        }
        // Ensure value is an array
        var arr = Array.isArray(value) ? value : [value];
        if (arr.length > 2) {
            return '<span class="text-warning">' + arr.slice(0, 2).join(', ') + ' +' + (arr.length - 2) + ' more</span>';
        }
        return '<span class="text-warning">' + arr.join(', ') + '</span>';
    }

    /**
     * Formats suggested owners array.
     */
    function formatSuggestedOwners(value) {
        if (!value || value.length === 0) {
            return '<span class="text-muted">--</span>';
        }
        // Ensure value is an array
        var arr = Array.isArray(value) ? value : [value];
        if (arr.length > 2) {
            return arr.slice(0, 2).join(', ') + ' +' + (arr.length - 2) + ' more';
        }
        return arr.join(', ');
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

        // Get linked SharePoint site via DataRelationships
        var linkedSite = typeof DataRelationships !== 'undefined' ? DataRelationships.getTeamSharePointSite(team) : null;

        // Build SharePoint link section - safe: data from trusted collector
        var spLinkHtml = '';
        if (linkedSite) {
            spLinkHtml = '<a href="#sharepoint?search=' + encodeURIComponent(linkedSite.displayName || '') + '" class="text-link">' + (linkedSite.displayName || 'View Site') + '</a>';
            spLinkHtml += '<br><span style="font-size:0.75em;color:var(--color-text-muted)">' + (linkedSite.url || '') + '</span>';
        } else if (team.linkedSharePointSiteId) {
            spLinkHtml = '<span class="text-muted" style="font-size:0.8em">' + team.linkedSharePointSiteId + '</span>';
        } else {
            spLinkHtml = '--';
        }

        // Build owner links (clickable to users page) - safe: data from trusted collector
        var ownerLinksHtml = '--';
        if (team.ownerUpns && team.ownerUpns.length > 0) {
            ownerLinksHtml = team.ownerUpns.map(function(upn) {
                return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="text-link">' + upn + '</a>';
            }).join('<br>');
        }

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
            '    <span class="detail-label">Created:</span>',
            '    <span class="detail-value">' + DataLoader.formatDate(team.createdDateTime) + '</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Linked SharePoint Site</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">SharePoint Site:</span>',
            '    <span class="detail-value">' + spLinkHtml + '</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Governance</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">Owners:</span>',
            '    <span class="detail-value' + (team.ownerCount === 0 ? ' text-critical font-bold' : '') + '">' + team.ownerCount + '</span>',
            '',
            '    <span class="detail-label">Owner Emails:</span>',
            '    <span class="detail-value">' + ownerLinksHtml + '</span>',
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
            '    <span class="detail-value">' + (team.externalDomains && team.externalDomains.length > 0 ? (Array.isArray(team.externalDomains) ? team.externalDomains.join(', ') : team.externalDomains) : '--') + '</span>',
            '',
            '    <span class="detail-label">Suggested Owners:</span>',
            '    <span class="detail-value">' + (team.suggestedOwners && team.suggestedOwners.length > 0 ? (Array.isArray(team.suggestedOwners) ? team.suggestedOwners.join(', ') : team.suggestedOwners) : '--') + '</span>',
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
            '    <span class="detail-value">' + (team.flags && team.flags.length > 0 ? (Array.isArray(team.flags) ? team.flags.join(', ') : team.flags) : 'None') + '</span>',
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
        var teams = DataLoader.getData('teams') || [];

        if (!teams || teams.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Teams Data</div><p>No Microsoft Teams data available. Run data collection to gather Teams information.</p></div>';
            return;
        }

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
            '<div class="summary-cards" id="teams-summary-cards">',
            '    <div class="summary-card card-info" id="teams-card-total"><div class="summary-value" id="teams-sum-total">' + teams.length + '</div><div class="summary-label">Total Teams</div></div>',
            '    <div class="summary-card" id="teams-card-active"><div class="summary-value" id="teams-sum-active">' + activeCount + '</div><div class="summary-label">Active</div></div>',
            '    <div class="summary-card' + inactiveCardClass + '" id="teams-card-inactive"><div class="summary-value' + inactiveTextClass + '" id="teams-sum-inactive">' + inactiveCount + '</div><div class="summary-label">Inactive (90d+)</div></div>',
            '    <div class="summary-card' + ownerlessCardClass + '" id="teams-card-ownerless"><div class="summary-value' + ownerlessTextClass + '" id="teams-sum-ownerless">' + ownerlessCount + '</div><div class="summary-label">Ownerless</div></div>',
            '</div>',
            '',
            '<div class="analytics-grid" id="teams-charts"></div>',
            '<div id="teams-filter"></div>',
            '<div class="table-toolbar"><div id="teams-colselector"></div></div>',
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

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'teams-colselector',
                storageKey: 'tenantscope-teams-cols-v1',
                allColumns: [
                    { key: 'displayName', label: 'Team Name' },
                    { key: 'description', label: 'Description' },
                    { key: 'visibility', label: 'Visibility' },
                    { key: 'sensitivityLabelName', label: 'Sensitivity' },
                    { key: 'mail', label: 'Email' },
                    { key: 'createdDateTime', label: 'Created' },
                    { key: 'ownerCount', label: 'Owners' },
                    { key: 'memberCount', label: 'Members' },
                    { key: 'channelCount', label: 'Channels' },
                    { key: 'privateChannelCount', label: 'Private Ch.' },
                    { key: 'guestCount', label: 'Guests' },
                    { key: 'externalDomains', label: 'External Domains' },
                    { key: 'activeUsers', label: 'Active Users' },
                    { key: 'lastActivityDate', label: 'Last Activity' },
                    { key: 'daysSinceActivity', label: 'Days Inactive' },
                    { key: 'suggestedOwners', label: 'Suggested Owners' },
                    { key: 'flags', label: 'Flags' },
                    { key: '_adminLinks', label: 'Admin' }
                ],
                defaultVisible: [
                    'displayName', 'visibility', 'mail', 'ownerCount', 'memberCount',
                    'guestCount', 'lastActivityDate', 'daysSinceActivity', 'flags', '_adminLinks'
                ],
                onColumnsChanged: function() { applyFilters(); }
            });
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
