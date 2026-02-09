/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: SHAREPOINT
 *
 * Renders the SharePoint page showing site usage, storage consumption,
 * activity, and governance status.
 *
 * Note: innerHTML usage follows existing dashboard patterns. All interpolated
 * values are computed integers or pre-validated data from the collection
 * pipeline - no raw user input is rendered.
 */

const PageSharePoint = (function() {
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

    function getThresholds() {
        if (window.DataLoader && typeof DataLoader.getMetadata === 'function') {
            var meta = DataLoader.getMetadata();
            if (meta && meta.thresholds) return meta.thresholds;
        }
        return {};
    }

    function getHighStorageThreshold() {
        var thresholds = getThresholds();
        return (typeof thresholds.highStorageThresholdGB === 'number' && thresholds.highStorageThresholdGB > 0)
            ? thresholds.highStorageThresholdGB
            : 20;
    }

    function getInactiveThreshold() {
        var thresholds = getThresholds();
        return (typeof thresholds.inactiveSiteDays === 'number' && thresholds.inactiveSiteDays > 0)
            ? thresholds.inactiveSiteDays
            : 90;
    }

    function isHighStorageSite(site, threshold) {
        if (site.flags && site.flags.indexOf('high-storage') !== -1) return true;
        return (site.storageUsedGB || 0) >= threshold;
    }

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        var allSites = DataLoader.getData('sharepointSites');
        // Filter by owner's department if department filter is active
        var sites = (typeof DepartmentFilter !== 'undefined')
            ? DepartmentFilter.filterByUPN(allSites, 'ownerPrincipalName')
            : allSites;

        // Build filter configuration
        var filterConfig = {
            search: Filters.getValue('sp-search'),
            searchFields: ['displayName', 'url', 'ownerPrincipalName', 'ownerDisplayName'],
            exact: {}
        };

        // Template filter
        var templateFilter = Filters.getValue('sp-template');
        if (templateFilter && templateFilter !== 'all') {
            filterConfig.exact.template = templateFilter;
        }

        // Apply filters
        var filteredData = Filters.apply(sites, filterConfig);

        // Status filter
        var statusFilter = Filters.getValue('sp-status');
        if (statusFilter && statusFilter !== 'all') {
            if (statusFilter === 'active') {
                filteredData = filteredData.filter(function(s) { return !s.isInactive; });
            } else if (statusFilter === 'inactive') {
                filteredData = filteredData.filter(function(s) { return s.isInactive; });
            }
        }

        // Sharing filter
        var sharingFilter = Filters.getValue('sp-sharing');
        if (sharingFilter && sharingFilter !== 'all') {
            if (sharingFilter === 'external') {
                filteredData = filteredData.filter(function(s) { return s.hasExternalSharing; });
            } else if (sharingFilter === 'anonymous') {
                filteredData = filteredData.filter(function(s) { return (s.anonymousLinkCount || 0) > 0; });
            } else if (sharingFilter === 'internal') {
                filteredData = filteredData.filter(function(s) { return !s.hasExternalSharing; });
            }
        }

        // Personal sites toggle
        var showPersonal = Filters.getValue('sp-personal');
        if (!showPersonal) {
            filteredData = filteredData.filter(function(s) { return !s.isPersonalSite; });
        }

        // Update summary cards with filtered data
        updateSharePointSummaryCards(filteredData);

        renderTable(filteredData);
    }

    /**
     * Updates the summary cards with filtered data counts.
     */
    function updateSharePointSummaryCards(filteredSites) {
        var highStorageThreshold = getHighStorageThreshold();
        var nonPersonal = filteredSites.filter(function(s) { return !s.isPersonalSite; });

        var totalStorageGB = Math.round(nonPersonal.reduce(function(s, site) { return s + (site.storageUsedGB || 0); }, 0) * 10) / 10;
        var inactiveSites = nonPersonal.filter(function(s) { return s.isInactive; }).length;
        var highStorage = nonPersonal.filter(function(s) { return isHighStorageSite(s, highStorageThreshold); }).length;
        var externalSharingSites = nonPersonal.filter(function(s) { return s.hasExternalSharing; }).length;
        var anonymousLinkSites = nonPersonal.filter(function(s) { return (s.anonymousLinkCount || 0) > 0; }).length;

        // Update values
        var totalEl = document.getElementById('sp-sum-total');
        var storageEl = document.getElementById('sp-sum-storage');
        var inactiveEl = document.getElementById('sp-sum-inactive');
        var highStorageEl = document.getElementById('sp-sum-highstorage');
        var externalEl = document.getElementById('sp-sum-external');
        var anonEl = document.getElementById('sp-sum-anon');

        if (totalEl) totalEl.textContent = nonPersonal.length;
        if (storageEl) storageEl.textContent = totalStorageGB + ' GB';
        if (inactiveEl) inactiveEl.textContent = inactiveSites;
        if (highStorageEl) highStorageEl.textContent = highStorage;
        if (externalEl) externalEl.textContent = externalSharingSites;
        if (anonEl) anonEl.textContent = anonymousLinkSites;

        // Update card and value styling based on values
        var inactiveCard = document.getElementById('sp-card-inactive');
        var highStorageCard = document.getElementById('sp-card-highstorage');
        var externalCard = document.getElementById('sp-card-external');
        var anonCard = document.getElementById('sp-card-anon');

        if (inactiveCard) {
            inactiveCard.className = 'summary-card' + (inactiveSites > 0 ? ' card-warning' : '');
        }
        if (inactiveEl) {
            inactiveEl.className = 'summary-value' + (inactiveSites > 0 ? ' text-warning' : '');
        }
        if (highStorageCard) {
            highStorageCard.className = 'summary-card' + (highStorage > 0 ? ' card-warning' : '');
        }
        if (highStorageEl) {
            highStorageEl.className = 'summary-value' + (highStorage > 0 ? ' text-warning' : '');
        }
        if (externalCard) {
            externalCard.className = 'summary-card' + (externalSharingSites > 0 ? ' card-warning' : '');
        }
        if (externalEl) {
            externalEl.className = 'summary-value' + (externalSharingSites > 0 ? ' text-warning' : '');
        }
        if (anonCard) {
            anonCard.className = 'summary-card' + (anonymousLinkSites > 0 ? ' card-danger' : '');
        }
        if (anonEl) {
            anonEl.className = 'summary-value' + (anonymousLinkSites > 0 ? ' text-critical' : '');
        }
    }

    /**
     * Renders the SharePoint sites table.
     *
     * @param {Array} data - Filtered site data
     */
    function renderTable(data) {
        var highStorageThreshold = getHighStorageThreshold();

        // Get visible columns from Column Selector
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'url', 'template', 'ownerDisplayName', 'ownerPrincipalName',
            'createdDateTime', 'storageUsedGB', 'storagePct', 'fileCount',
            'externalSharing', 'anonymousLinkCount', 'lastActivityDate',
            'daysSinceActivity', 'flags'
        ];

        // All column definitions
        var allDefs = [
            { key: 'displayName', label: 'Site Name', formatter: function(v, row) {
                if (!v) return '--';
                return '<a href="#sharepoint?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + v + '</strong></a>';
            }},
            { key: 'url', label: 'URL', formatter: formatUrl },
            { key: 'template', label: 'Template', formatter: formatTemplate },
            { key: 'ownerDisplayName', label: 'Owner', formatter: function(v, row) {
                if (!v) return '--';
                var upn = row.ownerPrincipalName || '';
                if (upn) {
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + v + '</a>';
                }
                return v;
            }},
            { key: 'ownerPrincipalName', label: 'Owner UPN', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="View user profile">' + v + '</a>';
            }},
            { key: 'linkedTeamName', label: 'Linked Team', formatter: function(v, row) {
                var teamName = v || '';
                if (!teamName && typeof DataRelationships !== 'undefined') {
                    var linkedTeam = DataRelationships.getSiteTeam(row.id);
                    if (linkedTeam) teamName = linkedTeam.displayName || '';
                }
                if (teamName) {
                    return '<a href="#teams?search=' + encodeURIComponent(teamName) + '" class="entity-link" onclick="event.stopPropagation();" title="View team">' + teamName + '</a>';
                }
                return '<span class="text-muted">--</span>';
            }},
            { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
            { key: 'storageUsedGB', label: 'Storage (GB)', className: 'cell-right', formatter: formatStorage },
            { key: 'storageAllocatedGB', label: 'Allocated (GB)', className: 'cell-right' },
            { key: 'storagePct', label: 'Usage %', className: 'cell-right', formatter: formatStoragePct },
            { key: 'fileCount', label: 'Files', className: 'cell-right' },
            { key: 'activeFileCount', label: 'Active Files', className: 'cell-right' },
            { key: 'pageViewCount', label: 'Page Views', className: 'cell-right' },
            { key: 'visitedPageCount', label: 'Visited Pages', className: 'cell-right' },
            { key: 'externalSharing', label: 'Ext. Sharing', formatter: formatExternalSharing },
            { key: 'anonymousLinkCount', label: 'Anon Links', className: 'cell-right', formatter: formatLinkCount },
            { key: 'guestLinkCount', label: 'Guest Links', className: 'cell-right', formatter: formatLinkCount },
            { key: 'companyLinkCount', label: 'Company Links', className: 'cell-right', formatter: formatLinkCount },
            { key: 'memberLinkCount', label: 'Member Links', className: 'cell-right', formatter: formatLinkCount },
            { key: 'totalSharingLinks', label: 'Total Links', className: 'cell-right' },
            { key: 'isGroupConnected', label: 'Group Connected', formatter: formatBoolean },
            { key: 'sensitivityLabelId', label: 'Has Label', formatter: formatHasLabel },
            { key: 'lastActivityDate', label: 'Last Activity', formatter: Tables.formatters.date },
            { key: 'daysSinceActivity', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
            { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags },
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (row.url) {
                    return '<a href="https://admin.microsoft.com/Adminportal/Home#/SharePoint" target="_blank" rel="noopener" class="admin-link" title="Open SharePoint Admin">SP Admin</a>';
                }
                return '--';
            }}
        ];

        // Filter to visible columns only
        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'sp-table',
            data: data,
            columns: columns,
            pageSize: 50,
            onRowClick: showSiteDetails,
            getRowClass: function(row) {
                if (row.isInactive) return 'row-muted';
                if (isHighStorageSite(row, highStorageThreshold)) return 'row-warning';
                return '';
            }
        });
    }

    /**
     * Formats site template with badge.
     */
    function formatTemplate(value) {
        var map = {
            'Group':         { cls: 'badge-info', label: 'Team Site' },
            'Communication': { cls: 'badge-success', label: 'Communication' },
            'OneDrive':      { cls: 'badge-neutral', label: 'OneDrive' },
            'Other':         { cls: 'badge-neutral', label: 'Other' }
        };
        var info = map[value] || { cls: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + info.cls + '">' + info.label + '</span>';
    }

    /**
     * Formats storage with color coding.
     */
    function formatStorage(value) {
        var highStorageThreshold = getHighStorageThreshold();
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        var colorClass = '';
        if (value >= highStorageThreshold) colorClass = 'text-critical font-bold';
        else if (value >= Math.max(10, Math.round(highStorageThreshold / 2))) colorClass = 'text-warning';
        return '<span class="' + colorClass + '">' + value + '</span>';
    }

    /**
     * Formats external sharing status with severity badge.
     */
    function formatExternalSharing(value) {
        if (!value || value === 'Disabled' || value === 'None') {
            return '<span class="badge badge-success">Internal Only</span>';
        }
        if (value === 'Anyone') {
            return '<span class="badge badge-critical">Anyone</span>';
        }
        if (value === 'NewAndExistingGuests') {
            return '<span class="badge badge-warning">New + Guests</span>';
        }
        if (value === 'ExistingGuests') {
            return '<span class="badge badge-info">Guests Only</span>';
        }
        return '<span class="badge badge-neutral">' + value + '</span>';
    }

    /**
     * Formats link count with color coding.
     */
    function formatLinkCount(value) {
        var count = value || 0;
        if (count === 0) {
            return '<span class="text-muted">0</span>';
        }
        if (count >= 5) {
            return '<span class="text-critical font-bold">' + count + '</span>';
        }
        if (count >= 1) {
            return '<span class="text-warning">' + count + '</span>';
        }
        return String(count);
    }

    /**
     * Formats URL with truncation.
     */
    function formatUrl(value) {
        if (!value) {
            return '<span class="text-muted">--</span>';
        }
        var displayUrl = value.length > 40 ? value.substring(0, 37) + '...' : value;
        return '<span class="cell-truncate" title="' + value + '">' + displayUrl + '</span>';
    }

    /**
     * Formats storage percentage with color coding.
     */
    function formatStoragePct(value) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        var colorClass = '';
        if (value >= 90) colorClass = 'text-critical font-bold';
        else if (value >= 75) colorClass = 'text-warning';
        return '<span class="' + colorClass + '">' + value + '%</span>';
    }

    /**
     * Formats boolean value.
     */
    function formatBoolean(value) {
        return value ? 'Yes' : 'No';
    }

    /**
     * Formats sensitivity label presence.
     */
    function formatHasLabel(value) {
        if (value) {
            return '<span class="badge badge-success">Yes</span>';
        }
        return '<span class="badge badge-warning">No</span>';
    }

    /**
     * Shows detailed modal for a site.
     * Note: innerHTML usage follows existing dashboard patterns. All interpolated
     * values are pre-validated data from the collection pipeline - no raw user input.
     *
     * @param {object} site - SharePoint site data object
     */
    function showSiteDetails(site) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        var highStorageThreshold = getHighStorageThreshold();

        title.textContent = site.displayName;

        // Get linked Team via DataRelationships - safe: data from trusted collector
        var linkedTeam = typeof DataRelationships !== 'undefined' ? DataRelationships.getSiteTeam(site.id) : null;

        // Build Team link section
        var teamLinkHtml = '';
        if (linkedTeam) {
            teamLinkHtml = '<a href="#teams?search=' + encodeURIComponent(linkedTeam.displayName || '') + '" class="text-link">' + (linkedTeam.displayName || 'View Team') + '</a>';
        } else if (site.isGroupConnected && site.groupId) {
            teamLinkHtml = '<span class="text-muted">Group ID: ' + site.groupId + '</span>';
        } else {
            teamLinkHtml = '<span class="text-muted">Not connected to a Team</span>';
        }

        // Build owner link (clickable to users page)
        var ownerLinkHtml = site.ownerPrincipalName
            ? '<a href="#users?search=' + encodeURIComponent(site.ownerPrincipalName) + '" class="text-link">' + (site.ownerDisplayName || site.ownerPrincipalName) + '</a>'
            : '--';

        // All values below are pre-validated from the collection pipeline
        body.innerHTML = [
            '<div class="detail-list">',
            '    <span class="detail-label">Site Name:</span>',
            '    <span class="detail-value">' + site.displayName + '</span>',
            '',
            '    <span class="detail-label">URL:</span>',
            '    <span class="detail-value" style="font-size: 0.8em; word-break: break-all;">' + site.url + '</span>',
            '',
            '    <span class="detail-label">Owner:</span>',
            '    <span class="detail-value">' + ownerLinkHtml + '</span>',
            '',
            '    <span class="detail-label">Template:</span>',
            '    <span class="detail-value">' + site.template + '</span>',
            '',
            '    <span class="detail-label">Group-Connected:</span>',
            '    <span class="detail-value">' + (site.isGroupConnected ? 'Yes' : 'No') + '</span>',
            '',
            '    <span class="detail-label">Linked Team:</span>',
            '    <span class="detail-value">' + teamLinkHtml + '</span>',
            '',
            '    <span class="detail-label">Created:</span>',
            '    <span class="detail-value">' + DataLoader.formatDate(site.createdDateTime) + '</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Storage</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">Storage Used:</span>',
            '    <span class="detail-value' + (isHighStorageSite(site, highStorageThreshold) ? ' text-critical font-bold' : '') + '">' + site.storageUsedGB + ' GB</span>',
            '',
            '    <span class="detail-label">Storage Allocated:</span>',
            '    <span class="detail-value">' + site.storageAllocatedGB + ' GB</span>',
            '',
            '    <span class="detail-label">Usage:</span>',
            '    <span class="detail-value">' + site.storagePct + '%</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Activity</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">Total Files:</span>',
            '    <span class="detail-value">' + site.fileCount + '</span>',
            '',
            '    <span class="detail-label">Active Files:</span>',
            '    <span class="detail-value">' + site.activeFileCount + '</span>',
            '',
            '    <span class="detail-label">Page Views:</span>',
            '    <span class="detail-value">' + site.pageViewCount + '</span>',
            '',
            '    <span class="detail-label">Last Activity:</span>',
            '    <span class="detail-value">' + DataLoader.formatDate(site.lastActivityDate) + '</span>',
            '',
            '    <span class="detail-label">Days Since Activity:</span>',
            '    <span class="detail-value">' + (site.daysSinceActivity !== null ? site.daysSinceActivity : '--') + '</span>',
            '',
            '    <span class="detail-label">Is Inactive:</span>',
            '    <span class="detail-value">' + (site.isInactive ? 'Yes' : 'No') + '</span>',
            '',
            '    <span class="detail-label">Visited Pages:</span>',
            '    <span class="detail-value">' + (site.visitedPageCount || 0) + '</span>',
            '',
            '    <span class="detail-label">Flags:</span>',
            '    <span class="detail-value">' + (site.flags && site.flags.length > 0 ? (Array.isArray(site.flags) ? site.flags.join(', ') : site.flags) : 'None') + '</span>',
            '</div>',
            '',
            '<h4 class="mt-lg mb-sm">Sharing & Governance</h4>',
            '<div class="detail-list">',
            '    <span class="detail-label">External Sharing:</span>',
            '    <span class="detail-value">' + formatExternalSharing(site.externalSharing) + '</span>',
            '',
            '    <span class="detail-label">Anonymous Links:</span>',
            '    <span class="detail-value">' + (site.anonymousLinkCount || 0) + '</span>',
            '',
            '    <span class="detail-label">Company Links:</span>',
            '    <span class="detail-value">' + (site.companyLinkCount || 0) + '</span>',
            '',
            '    <span class="detail-label">Guest Links:</span>',
            '    <span class="detail-value">' + (site.guestLinkCount || 0) + '</span>',
            '',
            '    <span class="detail-label">Member Links:</span>',
            '    <span class="detail-value">' + (site.memberLinkCount || 0) + '</span>',
            '',
            '    <span class="detail-label">Total Sharing Links:</span>',
            '    <span class="detail-value font-bold">' + (site.totalSharingLinks || 0) + '</span>',
            '',
            '    <span class="detail-label">Sensitivity Label:</span>',
            '    <span class="detail-value">' + (site.sensitivityLabelId ? '<span class="badge badge-success">Labeled</span>' : '<span class="badge badge-warning">Unlabeled</span>') + '</span>',
            '',
            '    <span class="detail-label">Unmanaged Device Policy:</span>',
            '    <span class="detail-value">' + (site.unmanagedDevicePolicy || '--') + '</span>',
            '</div>',
            '',
            '<div class="detail-list" style="margin-top: var(--space-md);">',
            '    <span class="detail-label">Site ID:</span>',
            '    <span class="detail-value" style="font-size: 0.8em;">' + site.id + '</span>',
            '</div>'
        ].join('\n');

        modal.classList.add('visible');
    }

    /**
     * Renders the SharePoint page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var allSites = DataLoader.getData('sharepointSites');
        // Filter by owner's department if department filter is active
        var sites = (typeof DepartmentFilter !== 'undefined')
            ? DepartmentFilter.filterByUPN(allSites, 'ownerPrincipalName')
            : allSites;
        var nonPersonal = sites.filter(function(s) { return !s.isPersonalSite; });
        var highStorageThreshold = getHighStorageThreshold();
        var inactiveThreshold = getInactiveThreshold();

        // Calculate stats
        var totalStorageGB = Math.round(nonPersonal.reduce(function(s, site) { return s + (site.storageUsedGB || 0); }, 0) * 10) / 10;
        var activeSites = nonPersonal.filter(function(s) { return !s.isInactive; }).length;
        var inactiveSites = nonPersonal.filter(function(s) { return s.isInactive; }).length;
        var groupConnected = nonPersonal.filter(function(s) { return s.isGroupConnected; }).length;
        var highStorage = nonPersonal.filter(function(s) { return isHighStorageSite(s, highStorageThreshold); }).length;

        // Template counts
        var groupCount = nonPersonal.filter(function(s) { return s.template === 'Group'; }).length;
        var commCount = nonPersonal.filter(function(s) { return s.template === 'Communication'; }).length;
        var otherCount = nonPersonal.filter(function(s) { return s.template !== 'Group' && s.template !== 'Communication'; }).length;
        var personalCount = sites.filter(function(s) { return s.isPersonalSite; }).length;

        // Governance stats
        var externalSharingSites = nonPersonal.filter(function(s) { return s.hasExternalSharing; }).length;
        var anonymousLinkSites = nonPersonal.filter(function(s) { return (s.anonymousLinkCount || 0) > 0; }).length;
        var noLabelSites = nonPersonal.filter(function(s) { return !s.sensitivityLabelId; }).length;
        var internalOnlySites = nonPersonal.filter(function(s) { return !s.hasExternalSharing; }).length;
        var guestSharedSites = nonPersonal.filter(function(s) { return s.hasExternalSharing && (s.anonymousLinkCount || 0) === 0; }).length;

        // Build summary cards + charts + filter/table skeleton
        // All values below are computed integers from trusted collection data
        var inactiveCardClass = inactiveSites > 0 ? ' card-warning' : '';
        var inactiveTextClass = inactiveSites > 0 ? ' text-warning' : '';
        var highStorageCardClass = highStorage > 0 ? ' card-warning' : '';
        var highStorageTextClass = highStorage > 0 ? ' text-warning' : '';
        var extSharingCardClass = externalSharingSites > 0 ? ' card-warning' : '';
        var extSharingTextClass = externalSharingSites > 0 ? ' text-warning' : '';
        var anonCardClass = anonymousLinkSites > 0 ? ' card-danger' : '';
        var anonTextClass = anonymousLinkSites > 0 ? ' text-critical' : '';

        var pageHtml = [
            '<div class="page-header">',
            '    <h2 class="page-title">SharePoint</h2>',
            '    <p class="page-description">SharePoint site usage, storage, activity, and sharing governance</p>',
            '</div>',
            '',
            '<div class="summary-cards" id="sp-summary-cards">',
            '    <div class="summary-card card-info" id="sp-card-total"><div class="summary-value" id="sp-sum-total">' + nonPersonal.length + '</div><div class="summary-label">Total Sites</div></div>',
            '    <div class="summary-card" id="sp-card-storage"><div class="summary-value" id="sp-sum-storage">' + totalStorageGB + ' GB</div><div class="summary-label">Total Storage</div></div>',
            '    <div class="summary-card' + inactiveCardClass + '" id="sp-card-inactive"><div class="summary-value' + inactiveTextClass + '" id="sp-sum-inactive">' + inactiveSites + '</div><div class="summary-label">Inactive Sites</div></div>',
            '    <div class="summary-card' + highStorageCardClass + '" id="sp-card-highstorage"><div class="summary-value' + highStorageTextClass + '" id="sp-sum-highstorage">' + highStorage + '</div><div class="summary-label">High Storage</div></div>',
            '    <div class="summary-card' + extSharingCardClass + '" id="sp-card-external"><div class="summary-value' + extSharingTextClass + '" id="sp-sum-external">' + externalSharingSites + '</div><div class="summary-label">Externally Shared</div></div>',
            '    <div class="summary-card' + anonCardClass + '" id="sp-card-anon"><div class="summary-value' + anonTextClass + '" id="sp-sum-anon">' + anonymousLinkSites + '</div><div class="summary-label">Anonymous Links</div></div>',
            '</div>',
            '',
            '<div class="analytics-grid" id="sp-charts"></div>',
            '<div id="sp-filter"></div>',
            '<div class="table-toolbar"><div id="sp-colselector"></div></div>',
            '<div id="sp-table"></div>'
        ].join('\n');

        container.innerHTML = pageHtml;

        // Render charts using inline SVG in analytics-card (matching Endpoint Analytics)
        var chartsContainer = document.getElementById('sp-charts');
        if (chartsContainer) {
            var totalNP = nonPersonal.length;

            // Site Activity donut
            var activityHtml = '<div class="analytics-card"><h3>Site Activity</h3>';
            activityHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            activityHtml += buildDonutSVG([
                { count: activeSites, color: 'var(--color-success)' },
                { count: inactiveSites, color: 'var(--color-warning)' }
            ], totalNP, totalNP > 0 ? Math.round((activeSites / totalNP) * 100) + '%' : '0%', 'active');
            activityHtml += '</div>';
            activityHtml += '<div class="compliance-legend">';
            activityHtml += '<div class="legend-item"><span class="legend-dot bg-success"></span> Active: <strong>' + activeSites + '</strong></div>';
            activityHtml += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Inactive: <strong>' + inactiveSites + '</strong></div>';
            activityHtml += '</div></div></div>';

            // Site Templates donut
            var templatesHtml = '<div class="analytics-card"><h3>Site Templates</h3>';
            templatesHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            templatesHtml += buildDonutSVG([
                { count: groupCount, color: 'var(--color-accent)' },
                { count: commCount, color: '#0d9488' },
                { count: otherCount, color: '#6b7280' }
            ], totalNP, String(totalNP), 'sites');
            templatesHtml += '</div>';
            templatesHtml += '<div class="compliance-legend">';
            templatesHtml += '<div class="legend-item"><span class="legend-dot bg-info"></span> Team Site: <strong>' + groupCount + '</strong></div>';
            templatesHtml += '<div class="legend-item"><span class="legend-dot" style="background-color:#0d9488"></span> Communication: <strong>' + commCount + '</strong></div>';
            templatesHtml += '<div class="legend-item"><span class="legend-dot" style="background-color:#6b7280"></span> Other: <strong>' + otherCount + '</strong></div>';
            templatesHtml += '</div></div></div>';

            // Sharing Exposure donut
            var sharingHtml = '<div class="analytics-card"><h3>Sharing Exposure</h3>';
            sharingHtml += '<div class="compliance-overview"><div class="compliance-chart">';
            sharingHtml += buildDonutSVG([
                { count: internalOnlySites, color: 'var(--color-success)' },
                { count: guestSharedSites, color: 'var(--color-warning)' },
                { count: anonymousLinkSites, color: 'var(--color-critical)' }
            ], totalNP, externalSharingSites > 0 ? Math.round((externalSharingSites / totalNP) * 100) + '%' : '0%', 'external');
            sharingHtml += '</div>';
            sharingHtml += '<div class="compliance-legend">';
            sharingHtml += '<div class="legend-item"><span class="legend-dot bg-success"></span> Internal Only: <strong>' + internalOnlySites + '</strong></div>';
            sharingHtml += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Guest Shared: <strong>' + guestSharedSites + '</strong></div>';
            sharingHtml += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Anonymous Links: <strong>' + anonymousLinkSites + '</strong></div>';
            sharingHtml += '</div></div></div>';

            chartsContainer.innerHTML = activityHtml + templatesHtml + sharingHtml;
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'sp-filter',
            controls: [
                {
                    type: 'search',
                    id: 'sp-search',
                    label: 'Search',
                    placeholder: 'Search sites...'
                },
                {
                    type: 'select',
                    id: 'sp-template',
                    label: 'Template',
                    options: [
                        { value: 'all', label: 'All Templates' },
                        { value: 'Group', label: 'Team Site' },
                        { value: 'Communication', label: 'Communication' },
                        { value: 'OneDrive', label: 'OneDrive' },
                        { value: 'Other', label: 'Other' }
                    ]
                },
                {
                    type: 'select',
                    id: 'sp-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'active', label: 'Active' },
                        { value: 'inactive', label: 'Inactive' }
                    ]
                },
                {
                    type: 'select',
                    id: 'sp-sharing',
                    label: 'Sharing',
                    options: [
                        { value: 'all', label: 'All Sharing' },
                        { value: 'external', label: 'External' },
                        { value: 'anonymous', label: 'Anonymous Links' },
                        { value: 'internal', label: 'Internal Only' }
                    ]
                },
                {
                    type: 'checkbox-group',
                    id: 'sp-options-filter',
                    label: 'Options',
                    options: [
                        { value: 'personal', label: 'Include personal sites' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Map checkbox ID
        var personalCheckbox = document.querySelector('#sp-options-filter input');
        if (personalCheckbox) {
            personalCheckbox.id = 'sp-personal';
        }

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'sp-colselector',
                storageKey: 'tenantscope-sharepoint-cols-v1',
                allColumns: [
                    { key: 'displayName', label: 'Site Name' },
                    { key: 'url', label: 'URL' },
                    { key: 'template', label: 'Template' },
                    { key: 'ownerDisplayName', label: 'Owner' },
                    { key: 'ownerPrincipalName', label: 'Owner UPN' },
                    { key: 'linkedTeamName', label: 'Linked Team' },
                    { key: 'createdDateTime', label: 'Created' },
                    { key: 'storageUsedGB', label: 'Storage (GB)' },
                    { key: 'storageAllocatedGB', label: 'Allocated (GB)' },
                    { key: 'storagePct', label: 'Usage %' },
                    { key: 'fileCount', label: 'Files' },
                    { key: 'activeFileCount', label: 'Active Files' },
                    { key: 'pageViewCount', label: 'Page Views' },
                    { key: 'visitedPageCount', label: 'Visited Pages' },
                    { key: 'externalSharing', label: 'Ext. Sharing' },
                    { key: 'anonymousLinkCount', label: 'Anon Links' },
                    { key: 'guestLinkCount', label: 'Guest Links' },
                    { key: 'companyLinkCount', label: 'Company Links' },
                    { key: 'memberLinkCount', label: 'Member Links' },
                    { key: 'totalSharingLinks', label: 'Total Links' },
                    { key: 'isGroupConnected', label: 'Group Connected' },
                    { key: 'sensitivityLabelId', label: 'Has Label' },
                    { key: 'lastActivityDate', label: 'Last Activity' },
                    { key: 'daysSinceActivity', label: 'Days Inactive' },
                    { key: 'flags', label: 'Flags' },
                    { key: '_adminLinks', label: 'Admin' }
                ],
                defaultVisible: [
                    'displayName', 'url', 'template', 'ownerDisplayName', 'ownerPrincipalName',
                    'createdDateTime', 'storageUsedGB', 'storagePct', 'fileCount',
                    'externalSharing', 'anonymousLinkCount', 'lastActivityDate',
                    'daysSinceActivity', 'flags', '_adminLinks'
                ],
                onColumnsChanged: function() { applyFilters(); }
            });
        }

        // Bind export button
        Export.bindExportButton('sp-table', 'sharepoint-sites');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageSharePoint = PageSharePoint;
