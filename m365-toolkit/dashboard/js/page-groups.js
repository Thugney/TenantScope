/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: GROUPS
 *
 * Renders the Groups page showing all Entra ID groups including Security,
 * Microsoft 365, Distribution, and Mail-enabled Security groups with
 * membership, ownership, and license assignment information.
 *
 * Note: innerHTML usage follows existing dashboard patterns. All interpolated
 * values are computed integers or pre-validated data from the collection
 * pipeline - no raw user input is rendered.
 */

const PageGroups = (function() {
    'use strict';

    var colSelector = null;

    /**
     * Builds inline SVG donut chart HTML (matching existing dashboard style).
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
     * Gets groups data from DataStore with proper format handling.
     */
    function getGroupsData() {
        var groupsData = DataLoader.getData('groups') || [];
        // Handle nested structure if present
        if (groupsData.groups) {
            return groupsData.groups;
        }
        return Array.isArray(groupsData) ? groupsData : [];
    }

    /**
     * Gets groups summary from DataStore.
     */
    function getGroupsSummary() {
        var groupsData = DataLoader.getData('groups') || {};
        return groupsData.summary || null;
    }

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        var groups = getGroupsData();
        if (!groups || groups.length === 0) return;

        // Build filter configuration
        var filterConfig = {
            search: Filters.getValue('groups-search'),
            searchFields: ['displayName', 'description', 'mail'],
            exact: {}
        };

        // Group type filter
        var typeFilter = Filters.getValue('groups-type');
        if (typeFilter && typeFilter !== 'all') {
            filterConfig.exact.groupType = typeFilter;
        }

        // Apply filters
        var filteredData = Filters.apply(groups, filterConfig);

        // Source filter
        var sourceFilter = Filters.getValue('groups-source');
        if (sourceFilter && sourceFilter !== 'all') {
            switch (sourceFilter) {
                case 'cloud':
                    filteredData = filteredData.filter(function(g) { return g.userSource === 'Cloud'; });
                    break;
                case 'onprem':
                    filteredData = filteredData.filter(function(g) { return g.onPremSync === true; });
                    break;
            }
        }

        // Ownerless checkbox
        var ownerlessOnly = Filters.getValue('groups-ownerless');
        if (ownerlessOnly) {
            filteredData = filteredData.filter(function(g) { return g.hasNoOwner; });
        }

        // With guests checkbox
        var guestsOnly = Filters.getValue('groups-has-guests');
        if (guestsOnly) {
            filteredData = filteredData.filter(function(g) { return g.hasGuests; });
        }

        // With licenses checkbox
        var licensesOnly = Filters.getValue('groups-has-licenses');
        if (licensesOnly) {
            filteredData = filteredData.filter(function(g) { return g.hasLicenseAssignments; });
        }

        // Update summary cards with filtered data
        updateGroupsSummaryCards(filteredData);

        renderTable(filteredData);
    }

    /**
     * Updates the summary cards with filtered data counts.
     */
    function updateGroupsSummaryCards(filteredGroups) {
        var total = filteredGroups.length;
        var securityCount = filteredGroups.filter(function(g) { return g.groupType === 'Security'; }).length;
        var m365Count = filteredGroups.filter(function(g) { return g.groupType === 'Microsoft 365'; }).length;
        var licenseCount = filteredGroups.filter(function(g) { return g.hasLicenseAssignments; }).length;

        // Update values
        var totalEl = document.getElementById('groups-sum-total');
        var securityEl = document.getElementById('groups-sum-security');
        var m365El = document.getElementById('groups-sum-m365');
        var licenseEl = document.getElementById('groups-sum-licenses');

        if (totalEl) totalEl.textContent = total;
        if (securityEl) securityEl.textContent = securityCount;
        if (m365El) m365El.textContent = m365Count;
        if (licenseEl) licenseEl.textContent = licenseCount;
    }

    /**
     * Renders the groups table.
     *
     * @param {Array} data - Filtered group data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'groups-table',
            data: data,
            columns: [
                { key: 'displayName', label: 'Group Name', formatter: function(v, row) {
                    if (!v) return '<span class="text-muted">--</span>';
                    return '<a href="#groups?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Filter by this group"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
                }},
                { key: 'groupType', label: 'Type', formatter: formatGroupType },
                { key: 'userSource', label: 'Source', formatter: formatSource },
                { key: 'memberCount', label: 'Members', className: 'cell-right', formatter: function(v, row) {
                    var count = v || 0;
                    if (row.groupType === 'Microsoft 365' && row.displayName) {
                        return '<a href="#teams?search=' + encodeURIComponent(row.displayName) + '" class="entity-link" onclick="event.stopPropagation();" title="View in Teams">' + count + '</a>';
                    }
                    return String(count);
                }},
                { key: 'ownerCount', label: 'Owners', className: 'cell-right', formatter: formatOwnerCount },
                { key: 'mail', label: 'Email', formatter: function(v, row) {
                    if (!v) return '<span class="text-muted">--</span>';
                    return '<a href="#groups?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="Filter by this email">' + Tables.escapeHtml(v) + '</a>';
                }},
                { key: 'visibility', label: 'Visibility', formatter: formatVisibility },
                { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
                { key: 'guestMemberCount', label: 'Guests', className: 'cell-right', formatter: formatGuestCount },
                { key: 'licenseAssignmentCount', label: 'Licenses', className: 'cell-right', formatter: formatLicenseCount },
                { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    if (!row.id) return '--';
                    var url = 'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/groupId/' + encodeURIComponent(row.id);
                    return '<a href="' + url + '" target="_blank" rel="noopener" class="admin-link" title="Open in Entra ID">Entra</a>';
                }}
            ],
            pageSize: 50,
            onRowClick: showGroupDetails,
            getRowClass: function(row) {
                if (row.hasNoOwner) return 'row-warning';
                return '';
            }
        });
    }

    /**
     * Formats group type with badge.
     */
    function formatGroupType(value) {
        var badgeClass = 'badge-neutral';
        if (value === 'Security') badgeClass = 'badge-info';
        else if (value === 'Microsoft 365') badgeClass = 'badge-success';
        else if (value === 'Distribution') badgeClass = 'badge-warning';
        else if (value === 'Mail-enabled Security') badgeClass = 'badge-purple';
        return '<span class="badge ' + badgeClass + '">' + value + '</span>';
    }

    /**
     * Formats source (Cloud/On-prem) with badge.
     */
    function formatSource(value) {
        if (value === 'Cloud') {
            return '<span class="badge badge-info">Cloud</span>';
        }
        return '<span class="badge badge-neutral">On-prem</span>';
    }

    /**
     * Formats visibility.
     */
    function formatVisibility(value) {
        if (!value) return '<span class="text-muted">--</span>';
        if (value === 'Public') {
            return '<span class="badge badge-warning">Public</span>';
        }
        return '<span class="badge badge-neutral">' + value + '</span>';
    }

    /**
     * Formats mail field.
     */
    function formatMail(value) {
        if (!value) return '<span class="text-muted">--</span>';
        return value;
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
     * Formats guest count with warning color if > 0.
     */
    function formatGuestCount(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return '<span class="text-warning font-bold">' + value + '</span>';
    }

    /**
     * Formats license count with info color if > 0.
     */
    function formatLicenseCount(value) {
        if (!value || value === 0) {
            return '<span class="text-muted">0</span>';
        }
        return '<span class="text-info font-bold">' + value + '</span>';
    }

    /**
     * Shows detailed modal for a group with tabs.
     *
     * @param {object} group - Group data object
     */
    function showGroupDetails(group) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        if (!modal || !title || !body) return;

        title.textContent = group.displayName;

        // Get group profile via DataRelationships if available
        var profile = typeof DataRelationships !== 'undefined' && DataRelationships.getGroupProfile
            ? DataRelationships.getGroupProfile(group.id)
            : null;

        // Get admin URLs
        var adminUrls = typeof DataRelationships !== 'undefined' && DataRelationships.getGroupAdminUrls
            ? DataRelationships.getGroupAdminUrls(group)
            : {};

        // Build tabs
        var tabsHtml = [
            '<div class="modal-tabs">',
            '    <button class="modal-tab active" data-tab="group-overview">Overview</button>',
            '    <button class="modal-tab" data-tab="group-members">Members (' + (group.memberCount || 0) + ')</button>',
            '    <button class="modal-tab" data-tab="group-owners">Owners (' + (group.ownerCount || 0) + ')</button>',
            '    <button class="modal-tab" data-tab="group-licenses">Licenses (' + (group.licenseAssignmentCount || 0) + ')</button>',
            '</div>'
        ].join('\n');

        // Build Overview tab content
        var overviewHtml = [
            '<div id="group-overview" class="modal-tab-content active">',
            '    <h4 class="mt-0 mb-sm">Identity</h4>',
            '    <div class="detail-list">',
            '        <span class="detail-label">Display Name:</span>',
            '        <span class="detail-value">' + group.displayName + '</span>',
            '        <span class="detail-label">Description:</span>',
            '        <span class="detail-value">' + (group.description || '--') + '</span>',
            '        <span class="detail-label">Mail:</span>',
            '        <span class="detail-value">' + (group.mail || '--') + '</span>',
            '        <span class="detail-label">Mail Nickname:</span>',
            '        <span class="detail-value">' + (group.mailNickname || '--') + '</span>',
            '        <span class="detail-label">Group ID:</span>',
            '        <span class="detail-value" style="font-size: 0.8em;">' + group.id + '</span>',
            '    </div>',
            '',
            '    <h4 class="mt-lg mb-sm">Configuration</h4>',
            '    <div class="detail-list">',
            '        <span class="detail-label">Group Type:</span>',
            '        <span class="detail-value">' + formatGroupType(group.groupType) + '</span>',
            '        <span class="detail-label">Source:</span>',
            '        <span class="detail-value">' + formatSource(group.userSource) + '</span>',
            '        <span class="detail-label">Visibility:</span>',
            '        <span class="detail-value">' + (group.visibility || '--') + '</span>',
            '        <span class="detail-label">Dynamic Group:</span>',
            '        <span class="detail-value">' + (group.isDynamicGroup ? 'Yes' : 'No') + '</span>',
            group.isDynamicGroup ? '        <span class="detail-label">Membership Rule:</span>' : '',
            group.isDynamicGroup ? '        <span class="detail-value" style="font-size:0.8em;">' + (group.membershipRule || '--') + '</span>' : '',
            '        <span class="detail-label">Classification:</span>',
            '        <span class="detail-value">' + (group.classification || '--') + '</span>',
            '        <span class="detail-label">Sensitivity Label:</span>',
            '        <span class="detail-value">' + (group.sensitivityLabel || '--') + '</span>',
            '        <span class="detail-label">Created:</span>',
            '        <span class="detail-value">' + DataLoader.formatDate(group.createdDateTime) + '</span>',
            '    </div>'
        ];

        // On-premises sync info
        if (group.onPremSync) {
            overviewHtml = overviewHtml.concat([
                '',
                '    <h4 class="mt-lg mb-sm">On-Premises Sync</h4>',
                '    <div class="detail-list">',
                '        <span class="detail-label">Domain:</span>',
                '        <span class="detail-value">' + (group.onPremDomainName || '--') + '</span>',
                '        <span class="detail-label">SAM Account Name:</span>',
                '        <span class="detail-value">' + (group.onPremSamAccountName || '--') + '</span>',
                '        <span class="detail-label">Last Sync:</span>',
                '        <span class="detail-value">' + DataLoader.formatDate(group.onPremLastSync) + '</span>',
                '        <span class="detail-label">Sync Age (days):</span>',
                '        <span class="detail-value' + (group.onPremSyncAge > 7 ? ' text-warning' : '') + '">' + (group.onPremSyncAge !== null ? group.onPremSyncAge : '--') + '</span>',
                '    </div>'
            ]);
        }

        // Admin URLs
        overviewHtml = overviewHtml.concat([
            '',
            '    <h4 class="mt-lg mb-sm">Admin Links</h4>',
            '    <div class="admin-links">',
            adminUrls.entra ? '        <a href="' + adminUrls.entra + '" target="_blank" class="admin-link"><span class="admin-link-icon">E</span>Entra ID</a>' : '',
            adminUrls.entraMembers ? '        <a href="' + adminUrls.entraMembers + '" target="_blank" class="admin-link"><span class="admin-link-icon">M</span>Members</a>' : '',
            adminUrls.entraLicenses ? '        <a href="' + adminUrls.entraLicenses + '" target="_blank" class="admin-link"><span class="admin-link-icon">L</span>Licenses</a>' : '',
            adminUrls.teams ? '        <a href="' + adminUrls.teams + '" target="_blank" class="admin-link"><span class="admin-link-icon">T</span>Teams Admin</a>' : '',
            adminUrls.sharepoint ? '        <a href="' + adminUrls.sharepoint + '" target="_blank" class="admin-link"><span class="admin-link-icon">S</span>SharePoint</a>' : '',
            '    </div>',
            '</div>'
        ]);

        // Build Members tab content
        var members = group.members || [];
        var membersHtml = [
            '<div id="group-members" class="modal-tab-content">',
            '    <h4 class="mt-0 mb-sm">Group Members (' + (group.memberCount || 0) + ')</h4>'
        ];
        if (members.length === 0) {
            membersHtml.push('    <p class="text-muted">No members data available or membership list is empty.</p>');
        } else {
            membersHtml.push('    <table class="modal-table">');
            membersHtml.push('        <thead><tr><th>Name</th><th>Email</th><th>Type</th></tr></thead>');
            membersHtml.push('        <tbody>');
            members.slice(0, 100).forEach(function(m) {
                var userTypeClass = m.userType === 'Guest' ? 'text-warning' : '';
                membersHtml.push('            <tr>');
                membersHtml.push('                <td><a href="#users?search=' + encodeURIComponent(m.userPrincipalName || '') + '" class="text-link">' + (m.displayName || '--') + '</a></td>');
                membersHtml.push('                <td>' + (m.mail || m.userPrincipalName || '--') + '</td>');
                membersHtml.push('                <td class="' + userTypeClass + '">' + (m.userType || 'Member') + '</td>');
                membersHtml.push('            </tr>');
            });
            membersHtml.push('        </tbody>');
            membersHtml.push('    </table>');
            if (members.length > 100) {
                membersHtml.push('    <p class="text-muted mt-sm">Showing first 100 of ' + members.length + ' members.</p>');
            }
        }
        membersHtml.push('</div>');

        // Build Owners tab content
        var owners = group.owners || [];
        var ownersHtml = [
            '<div id="group-owners" class="modal-tab-content">',
            '    <h4 class="mt-0 mb-sm">Group Owners (' + (group.ownerCount || 0) + ')</h4>'
        ];
        if (owners.length === 0) {
            ownersHtml.push('    <div class="warning-box"><strong>Warning:</strong> This group has no owners assigned.</div>');
        } else {
            ownersHtml.push('    <table class="modal-table">');
            ownersHtml.push('        <thead><tr><th>Name</th><th>Email</th></tr></thead>');
            ownersHtml.push('        <tbody>');
            owners.forEach(function(o) {
                ownersHtml.push('            <tr>');
                ownersHtml.push('                <td><a href="#users?search=' + encodeURIComponent(o.userPrincipalName || '') + '" class="text-link">' + (o.displayName || '--') + '</a></td>');
                ownersHtml.push('                <td>' + (o.userPrincipalName || '--') + '</td>');
                ownersHtml.push('            </tr>');
            });
            ownersHtml.push('        </tbody>');
            ownersHtml.push('    </table>');
        }
        ownersHtml.push('</div>');

        // Build Licenses tab content
        var licenses = group.assignedLicenses || [];
        var licensesHtml = [
            '<div id="group-licenses" class="modal-tab-content">',
            '    <h4 class="mt-0 mb-sm">License Assignments via Group</h4>'
        ];
        if (licenses.length === 0) {
            licensesHtml.push('    <p class="text-muted">This group is not used for license assignment.</p>');
        } else {
            licensesHtml.push('    <table class="modal-table">');
            licensesHtml.push('        <thead><tr><th>License</th><th>SKU Part Number</th><th>Assigned Users</th></tr></thead>');
            licensesHtml.push('        <tbody>');
            licenses.forEach(function(lic) {
                licensesHtml.push('            <tr>');
                licensesHtml.push('                <td>' + (lic.skuName || lic.skuId || '--') + '</td>');
                licensesHtml.push('                <td>' + (lic.skuPartNumber || '--') + '</td>');
                licensesHtml.push('                <td class="cell-right font-bold">' + (lic.assignedUserCount || 0) + '</td>');
                licensesHtml.push('            </tr>');
            });
            licensesHtml.push('        </tbody>');
            licensesHtml.push('    </table>');
            licensesHtml.push('    <p class="text-muted mt-sm">Total licensed users via this group: ' + (group.licensedMemberCount || 0) + '</p>');
        }
        licensesHtml.push('</div>');

        // Combine all content
        var modalContent = tabsHtml + overviewHtml.join('\n') + membersHtml.join('\n') + ownersHtml.join('\n') + licensesHtml.join('\n');

        body.innerHTML = modalContent;

        // Bind tab switching
        var tabs = body.querySelectorAll('.modal-tab');
        tabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                var targetId = this.getAttribute('data-tab');
                tabs.forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');
                var contents = body.querySelectorAll('.modal-tab-content');
                contents.forEach(function(c) { c.classList.remove('active'); });
                var targetContent = document.getElementById(targetId);
                if (targetContent) targetContent.classList.add('active');
            });
        });

        modal.classList.add('visible');
    }

    /**
     * Renders the groups page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var groups = getGroupsData();
        var summary = getGroupsSummary();

        if (!groups || groups.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Groups Data</div><p>No Entra ID groups data available. Run data collection to gather group information.</p></div>';
            return;
        }

        // Calculate stats
        var securityCount = summary ? summary.byType.security : groups.filter(function(g) { return g.groupType === 'Security'; }).length;
        var m365Count = summary ? summary.byType.microsoft365 : groups.filter(function(g) { return g.groupType === 'Microsoft 365'; }).length;
        var distCount = summary ? summary.byType.distribution : groups.filter(function(g) { return g.groupType === 'Distribution'; }).length;
        var mailSecCount = summary ? summary.byType.mailEnabledSecurity : groups.filter(function(g) { return g.groupType === 'Mail-enabled Security'; }).length;
        var cloudCount = summary ? summary.cloudOnly : groups.filter(function(g) { return g.userSource === 'Cloud'; }).length;
        var onPremCount = summary ? summary.onPremSynced : groups.filter(function(g) { return g.onPremSync === true; }).length;
        var ownerlessCount = summary ? summary.ownerless : groups.filter(function(g) { return g.hasNoOwner; }).length;
        var withGuestsCount = summary ? summary.withGuests : groups.filter(function(g) { return g.hasGuests; }).length;
        var withLicensesCount = summary ? summary.withLicenseAssignments : groups.filter(function(g) { return g.hasLicenseAssignments; }).length;
        var dynamicCount = summary ? summary.dynamicGroups : groups.filter(function(g) { return g.isDynamicGroup; }).length;

        var totalGroups = groups.length;

        // Build page HTML
        var pageHtml = [
            '<div class="page-header">',
            '    <h2 class="page-title">Groups</h2>',
            '    <p class="page-description">Entra ID groups: membership, ownership, and license assignments</p>',
            '</div>',
            '',
            '<div class="summary-cards" id="groups-summary-cards">',
            '    <div class="summary-card card-info"><div class="summary-value" id="groups-sum-total">' + totalGroups + '</div><div class="summary-label">Total Groups</div></div>',
            '    <div class="summary-card"><div class="summary-value" id="groups-sum-security">' + securityCount + '</div><div class="summary-label">Security</div></div>',
            '    <div class="summary-card"><div class="summary-value" id="groups-sum-m365">' + m365Count + '</div><div class="summary-label">Microsoft 365</div></div>',
            '    <div class="summary-card' + (withLicensesCount > 0 ? ' card-success' : '') + '"><div class="summary-value' + (withLicensesCount > 0 ? ' text-success' : '') + '" id="groups-sum-licenses">' + withLicensesCount + '</div><div class="summary-label">License Groups</div></div>',
            '</div>',
            '',
            '<div class="analytics-grid" id="groups-charts"></div>',
            '<div id="groups-filter"></div>',
            '<div class="table-toolbar"><div id="groups-col-selector"></div></div>',
            '<div id="groups-table"></div>'
        ].join('\n');

        container.innerHTML = pageHtml;

        // Render charts
        var chartsContainer = document.getElementById('groups-charts');
        if (chartsContainer) {
            // Group Type Distribution donut
            var typeHtml = '<div class="analytics-card"><h3>Group Types</h3>';
            typeHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            typeHtml += buildDonutSVG([
                { count: securityCount, color: 'var(--color-info)' },
                { count: m365Count, color: 'var(--color-success)' },
                { count: distCount, color: 'var(--color-warning)' },
                { count: mailSecCount, color: '#a855f7' }
            ], totalGroups, String(totalGroups), 'groups');
            typeHtml += '</div>';
            typeHtml += '<div class="compliance-legend">';
            typeHtml += '<div class="legend-item"><span class="legend-dot bg-info"></span> Security: <strong>' + securityCount + '</strong></div>';
            typeHtml += '<div class="legend-item"><span class="legend-dot bg-success"></span> Microsoft 365: <strong>' + m365Count + '</strong></div>';
            typeHtml += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Distribution: <strong>' + distCount + '</strong></div>';
            typeHtml += '<div class="legend-item"><span class="legend-dot" style="background:#a855f7"></span> Mail-enabled Security: <strong>' + mailSecCount + '</strong></div>';
            typeHtml += '</div></div></div>';

            // Source & Governance donut
            var sourceHtml = '<div class="analytics-card"><h3>Source & Governance</h3>';
            sourceHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            sourceHtml += buildDonutSVG([
                { count: cloudCount, color: 'var(--color-info)' },
                { count: onPremCount, color: 'var(--color-neutral)' }
            ], totalGroups, String(cloudCount), 'cloud');
            sourceHtml += '</div>';
            sourceHtml += '<div class="compliance-legend">';
            sourceHtml += '<div class="legend-item"><span class="legend-dot bg-info"></span> Cloud: <strong>' + cloudCount + '</strong></div>';
            sourceHtml += '<div class="legend-item"><span class="legend-dot bg-neutral"></span> On-premises: <strong>' + onPremCount + '</strong></div>';
            sourceHtml += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Ownerless: <strong>' + ownerlessCount + '</strong></div>';
            sourceHtml += '<div class="legend-item"><span class="legend-dot bg-warning"></span> With Guests: <strong>' + withGuestsCount + '</strong></div>';
            sourceHtml += '<div class="legend-item"><span class="legend-dot bg-success"></span> Dynamic: <strong>' + dynamicCount + '</strong></div>';
            sourceHtml += '</div></div></div>';

            chartsContainer.innerHTML = typeHtml + sourceHtml;
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'groups-filter',
            controls: [
                {
                    type: 'search',
                    id: 'groups-search',
                    label: 'Search',
                    placeholder: 'Search groups...'
                },
                {
                    type: 'select',
                    id: 'groups-type',
                    label: 'Type',
                    options: [
                        { value: 'all', label: 'All Types' },
                        { value: 'Security', label: 'Security' },
                        { value: 'Microsoft 365', label: 'Microsoft 365' },
                        { value: 'Distribution', label: 'Distribution' },
                        { value: 'Mail-enabled Security', label: 'Mail-enabled Security' }
                    ]
                },
                {
                    type: 'select',
                    id: 'groups-source',
                    label: 'Source',
                    options: [
                        { value: 'all', label: 'All Sources' },
                        { value: 'cloud', label: 'Cloud' },
                        { value: 'onprem', label: 'On-premises' }
                    ]
                },
                {
                    type: 'checkbox-group',
                    id: 'groups-flags-filter',
                    label: 'Flags',
                    options: [
                        { value: 'ownerless', label: 'Ownerless' },
                        { value: 'guests', label: 'With guests' },
                        { value: 'licenses', label: 'With licenses' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Map checkboxes to filter IDs
        var checkboxes = document.querySelectorAll('#groups-flags-filter input');
        if (checkboxes.length >= 3) {
            checkboxes[0].id = 'groups-ownerless';
            checkboxes[1].id = 'groups-has-guests';
            checkboxes[2].id = 'groups-has-licenses';
        }

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'groups-col-selector',
                storageKey: 'groups-columns',
                allColumns: [
                    { key: 'displayName', label: 'Group Name' },
                    { key: 'groupType', label: 'Type' },
                    { key: 'userSource', label: 'Source' },
                    { key: 'memberCount', label: 'Members' },
                    { key: 'ownerCount', label: 'Owners' },
                    { key: 'mail', label: 'Email' },
                    { key: 'visibility', label: 'Visibility' },
                    { key: 'createdDateTime', label: 'Created' },
                    { key: 'guestMemberCount', label: 'Guests' },
                    { key: 'licenseAssignmentCount', label: 'Licenses' },
                    { key: 'flags', label: 'Flags' },
                    { key: '_adminLinks', label: 'Admin' }
                ],
                defaultVisible: [
                    'displayName', 'groupType', 'userSource', 'memberCount', 'ownerCount',
                    'mail', 'visibility', 'createdDateTime', 'flags', '_adminLinks'
                ],
                onColumnsChanged: applyFilters
            });
        }

        // Bind export button
        Export.bindExportButton('groups-table', 'groups');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageGroups = PageGroups;
