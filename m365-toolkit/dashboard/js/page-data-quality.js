/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: DATA QUALITY
 *
 * Shows profile property completeness for all users. The signature BSURE data
 * governance feature: Focus Table (property -> % complete), Breakdown Table
 * (property completeness by department), and detail table showing per-user
 * field completion with missing values highlighted.
 */

const PageDataQuality = (function() {
    'use strict';

    /**
     * Profile fields to check for completeness.
     * Each entry: { key, label }
     */
    var PROFILE_FIELDS = [
        { key: 'department',   label: 'Department' },
        { key: 'jobTitle',     label: 'Job Title' },
        { key: 'companyName',  label: 'Company' },
        { key: 'officeLocation', label: 'Office' },
        { key: 'city',         label: 'City' },
        { key: 'country',      label: 'Country' },
        { key: 'mobilePhone',  label: 'Mobile Phone' },
        { key: 'manager',      label: 'Manager' },
        { key: 'mail',         label: 'Email' },
        { key: 'usageLocation', label: 'Usage Location' }
    ];

    /**
     * Checks if a field value is considered "populated".
     */
    function hasValue(val) {
        return val !== null && val !== undefined && val !== '';
    }

    /**
     * Computes completeness stats for a set of users.
     * Returns { fieldStats: [{key, label, filled, total, pct}], avgPct, fullyComplete, belowThreshold }
     */
    function computeStats(users) {
        var total = users.length;
        var fieldStats = [];
        var sumPct = 0;
        var belowThreshold = 0;

        for (var i = 0; i < PROFILE_FIELDS.length; i++) {
            var field = PROFILE_FIELDS[i];
            var filled = 0;
            for (var j = 0; j < users.length; j++) {
                if (hasValue(users[j][field.key])) filled++;
            }
            var pct = total > 0 ? Math.round((filled / total) * 100) : 0;
            fieldStats.push({ key: field.key, label: field.label, filled: filled, total: total, pct: pct });
            sumPct += pct;
            if (pct < 80) belowThreshold++;
        }

        var avgPct = PROFILE_FIELDS.length > 0 ? Math.round(sumPct / PROFILE_FIELDS.length) : 0;

        // Count fully complete users
        var fullyComplete = 0;
        for (var u = 0; u < users.length; u++) {
            var complete = true;
            for (var f = 0; f < PROFILE_FIELDS.length; f++) {
                if (!hasValue(users[u][PROFILE_FIELDS[f].key])) {
                    complete = false;
                    break;
                }
            }
            if (complete) fullyComplete++;
        }

        return {
            fieldStats: fieldStats,
            avgPct: avgPct,
            fullyComplete: fullyComplete,
            belowThreshold: belowThreshold
        };
    }

    /**
     * Creates a color class string based on percentage.
     */
    function pctColorClass(pct) {
        if (pct >= 90) return 'status-badge status-badge-success';
        if (pct >= 70) return 'status-badge status-badge-warning';
        return 'status-badge status-badge-critical';
    }

    /**
     * Renders the Data Quality page.
     */
    function render(container) {
        // Get users (apply department filter if active)
        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;

        // Page wrapper
        var page = document.createElement('div');
        page.className = 'page-section';

        // Page title
        var titleEl = document.createElement('h2');
        titleEl.className = 'section-title';
        titleEl.textContent = 'Data Quality';
        page.appendChild(titleEl);

        var descEl = document.createElement('p');
        descEl.className = 'section-description';
        descEl.textContent = 'Profile property completeness analysis across all user accounts.';
        page.appendChild(descEl);

        // Summary cards
        var stats = computeStats(users);

        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';
        cardsGrid.appendChild(makeCard('Total Users', users.length.toLocaleString(), ''));
        cardsGrid.appendChild(makeCard('Avg Completeness', stats.avgPct + '%', stats.avgPct >= 80 ? 'positive' : 'negative'));
        cardsGrid.appendChild(makeCard('Fields < 80%', stats.belowThreshold.toString(), stats.belowThreshold === 0 ? 'positive' : 'negative'));
        cardsGrid.appendChild(makeCard('Fully Complete', stats.fullyComplete.toLocaleString(), ''));
        page.appendChild(cardsGrid);

        // Focus/Breakdown row
        var fbRow = document.createElement('div');
        fbRow.className = 'focus-breakdown-row';

        var focusDiv = document.createElement('div');
        focusDiv.id = 'dq-focus-table';
        fbRow.appendChild(focusDiv);

        var breakdownCol = document.createElement('div');
        var breakdownFilterDiv = document.createElement('div');
        breakdownFilterDiv.id = 'dq-breakdown-filter';
        breakdownCol.appendChild(breakdownFilterDiv);
        var breakdownDiv = document.createElement('div');
        breakdownDiv.id = 'dq-breakdown-table';
        breakdownCol.appendChild(breakdownDiv);
        fbRow.appendChild(breakdownCol);

        page.appendChild(fbRow);

        // Filter bar container
        var filterDiv = document.createElement('div');
        filterDiv.id = 'dq-filters';
        page.appendChild(filterDiv);

        // Column selector container
        var colSelDiv = document.createElement('div');
        colSelDiv.id = 'dq-column-selector';
        colSelDiv.style.marginBottom = '8px';
        colSelDiv.style.textAlign = 'right';
        page.appendChild(colSelDiv);

        // Detail table
        var tableDiv = document.createElement('div');
        tableDiv.id = 'dq-table';
        page.appendChild(tableDiv);

        container.appendChild(page);

        // Render Focus Table (property completeness)
        renderPropertyFocusTable(stats.fieldStats);

        // Render Breakdown
        renderPropertyBreakdown(users);

        // Render filters
        Filters.createFilterBar({
            containerId: 'dq-filters',
            controls: [
                { type: 'search', id: 'dq-search', placeholder: 'Search users...' },
                {
                    type: 'select', id: 'dq-source', label: 'User Source',
                    options: [
                        { value: 'all', label: 'All Sources' },
                        { value: 'On-premises synced', label: 'On-premises synced' },
                        { value: 'Cloud', label: 'Cloud' }
                    ]
                },
                {
                    type: 'select', id: 'dq-status', label: 'Account Status',
                    options: [
                        { value: 'all', label: 'All Statuses' },
                        { value: 'enabled', label: 'Enabled' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select', id: 'dq-domain', label: 'Domain',
                    options: [
                        { value: 'all', label: 'All Domains' },
                        { value: 'employee', label: 'Employee' },
                        { value: 'student', label: 'Student' },
                        { value: 'other', label: 'Other' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Setup Column Selector
        var allCols = [
            { key: 'displayName', label: 'Name' },
            { key: 'userPrincipalName', label: 'UPN' },
            { key: 'domain', label: 'Domain' },
            { key: 'department', label: 'Department' },
            { key: 'jobTitle', label: 'Job Title' },
            { key: 'companyName', label: 'Company' },
            { key: 'officeLocation', label: 'Office' },
            { key: 'city', label: 'City' },
            { key: 'country', label: 'Country' },
            { key: 'mobilePhone', label: 'Mobile Phone' },
            { key: 'manager', label: 'Manager' },
            { key: 'mail', label: 'Email' },
            { key: 'usageLocation', label: 'Usage Location' },
            { key: 'userSource', label: 'User Source' },
            { key: '_completeness', label: 'Completeness %' },
            { key: '_adminLinks', label: 'Admin' }
        ];
        var defaultCols = ['displayName', 'department', 'jobTitle', 'companyName', 'officeLocation', 'city', 'mobilePhone', 'manager', '_completeness', '_adminLinks'];

        ColumnSelector.create({
            containerId: 'dq-column-selector',
            storageKey: 'tenantscope-dq-columns',
            allColumns: allCols,
            defaultVisible: defaultCols,
            onColumnsChanged: function() { applyFilters(); }
        });

        // Wire export
        var exportBtn = document.getElementById('dq-filters-export');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var data = getFilteredUsers();
                var columns = [
                    { key: 'displayName', label: 'Name' },
                    { key: 'userPrincipalName', label: 'UPN' },
                    { key: 'domain', label: 'Domain' },
                    { key: 'department', label: 'Department' },
                    { key: 'jobTitle', label: 'Job Title' },
                    { key: 'companyName', label: 'Company' },
                    { key: 'officeLocation', label: 'Office' },
                    { key: 'city', label: 'City' },
                    { key: 'country', label: 'Country' },
                    { key: 'mobilePhone', label: 'Mobile Phone' },
                    { key: 'manager', label: 'Manager' },
                    { key: 'mail', label: 'Email' },
                    { key: 'usageLocation', label: 'Usage Location' },
                    { key: 'userSource', label: 'User Source' },
                    { key: '_completeness', label: 'Completeness %' }
                ];
                Export.toCSV(data, columns, 'data-quality.csv');
            });
        }

        // Initial render
        applyFilters();
    }

    /**
     * Returns filtered users based on current filter state.
     */
    function getFilteredUsers() {
        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;

        var sourceVal = Filters.getValue('dq-source');
        var statusVal = Filters.getValue('dq-status');

        var filterConfig = {
            search: Filters.getValue('dq-search'),
            searchFields: ['displayName', 'userPrincipalName', 'mail', 'department', 'jobTitle'],
            exact: {
                domain: Filters.getValue('dq-domain')
            }
        };

        if (sourceVal && sourceVal !== 'all') {
            filterConfig.exact.userSource = sourceVal;
        }

        if (statusVal === 'enabled') {
            filterConfig.exact.accountEnabled = true;
        } else if (statusVal === 'disabled') {
            filterConfig.exact.accountEnabled = false;
        }

        return Filters.apply(users, filterConfig);
    }

    /**
     * Applies filters and re-renders detail table.
     */
    function applyFilters() {
        var filteredData = getFilteredUsers();
        renderDetailTable(filteredData);
    }

    /**
     * Renders the Focus Table showing property completeness.
     */
    function renderPropertyFocusTable(fieldStats) {
        var container = document.getElementById('dq-focus-table');
        if (!container) return;
        container.textContent = '';

        var wrapper = document.createElement('div');
        wrapper.className = 'focus-table-wrapper';

        var title = document.createElement('div');
        title.className = 'focus-table-title';
        title.textContent = 'Property Completeness';
        wrapper.appendChild(title);

        var subtitle = document.createElement('div');
        subtitle.className = 'focus-table-subtitle';
        subtitle.textContent = 'Coverage of profile fields across all users';
        wrapper.appendChild(subtitle);

        var table = document.createElement('table');
        table.className = 'focus-table';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        var th1 = document.createElement('th');
        th1.textContent = 'Property';
        var th2 = document.createElement('th');
        th2.textContent = 'Users with Data';
        th2.className = 'cell-right';
        var th3 = document.createElement('th');
        th3.textContent = '% Complete';
        th3.className = 'cell-right';
        headRow.appendChild(th1);
        headRow.appendChild(th2);
        headRow.appendChild(th3);
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        for (var i = 0; i < fieldStats.length; i++) {
            var fs = fieldStats[i];
            var tr = document.createElement('tr');

            var td1 = document.createElement('td');
            td1.textContent = fs.label;
            var td2 = document.createElement('td');
            td2.className = 'cell-right';
            td2.textContent = fs.filled + ' / ' + fs.total;
            var td3 = document.createElement('td');
            td3.className = 'cell-right';

            // Create progress bar with percentage
            var barWrapper = document.createElement('div');
            barWrapper.className = 'completeness-bar';

            var barTrack = document.createElement('div');
            barTrack.className = 'completeness-bar-track';
            var barFill = document.createElement('div');
            var pctClass = fs.pct >= 90 ? 'pct-high' : (fs.pct >= 70 ? 'pct-medium' : 'pct-low');
            barFill.className = 'completeness-bar-fill ' + pctClass;
            barFill.style.width = fs.pct + '%';
            barTrack.appendChild(barFill);

            var badge = document.createElement('span');
            badge.className = pctColorClass(fs.pct);
            badge.textContent = fs.pct + '%';

            barWrapper.appendChild(barTrack);
            barWrapper.appendChild(badge);
            td3.appendChild(barWrapper);

            tr.appendChild(td1);
            tr.appendChild(td2);
            tr.appendChild(td3);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Renders the Breakdown Table: property completeness by a breakdown dimension.
     */
    function renderPropertyBreakdown(users) {
        var dimensions = [
            { key: 'department', label: 'Department' },
            { key: 'companyName', label: 'Company' },
            { key: 'officeLocation', label: 'Office' },
            { key: 'city', label: 'City' },
            { key: 'domain', label: 'Domain' }
        ];

        var currentDim = 'department';

        function renderBreakdown(dimKey) {
            var bContainer = document.getElementById('dq-breakdown-table');
            if (!bContainer) return;
            bContainer.textContent = '';

            // Group users by selected dimension
            var groups = {};
            for (var i = 0; i < users.length; i++) {
                var val = users[i][dimKey];
                var label = (val === null || val === undefined || val === '') ? '(empty)' : String(val);
                if (!groups[label]) groups[label] = [];
                groups[label].push(users[i]);
            }

            // Sort groups by size descending, limit to top 8
            var groupKeys = Object.keys(groups).sort(function(a, b) {
                return groups[b].length - groups[a].length;
            });
            if (groupKeys.length > 8) groupKeys = groupKeys.slice(0, 8);

            var dimLabel = '';
            for (var d = 0; d < dimensions.length; d++) {
                if (dimensions[d].key === dimKey) { dimLabel = dimensions[d].label; break; }
            }

            var wrapper = document.createElement('div');
            wrapper.className = 'breakdown-table-wrapper';

            var title = document.createElement('div');
            title.className = 'breakdown-table-title';
            title.textContent = 'Completeness by ' + dimLabel;
            wrapper.appendChild(title);

            var subtitle = document.createElement('div');
            subtitle.className = 'breakdown-table-subtitle';
            subtitle.textContent = 'Average property completeness per ' + dimLabel.toLowerCase();
            wrapper.appendChild(subtitle);

            var tableWrap = document.createElement('div');
            tableWrap.className = 'breakdown-table-scroll';

            var table = document.createElement('table');
            table.className = 'breakdown-table';

            // Header: Property | Group1 | Group2 | ... | Average
            var thead = document.createElement('thead');
            var headRow = document.createElement('tr');
            var thProp = document.createElement('th');
            thProp.textContent = 'Property';
            headRow.appendChild(thProp);
            for (var g = 0; g < groupKeys.length; g++) {
                var th = document.createElement('th');
                th.className = 'cell-right';
                th.textContent = groupKeys[g];
                headRow.appendChild(th);
            }
            var thAvg = document.createElement('th');
            thAvg.className = 'cell-right';
            thAvg.textContent = 'Average';
            headRow.appendChild(thAvg);
            thead.appendChild(headRow);
            table.appendChild(thead);

            // Data rows: one per PROFILE_FIELD
            var tbody = document.createElement('tbody');
            for (var p = 0; p < PROFILE_FIELDS.length; p++) {
                var field = PROFILE_FIELDS[p];
                var tr = document.createElement('tr');
                var tdName = document.createElement('td');
                tdName.textContent = field.label;
                tr.appendChild(tdName);

                var sumPct = 0;
                for (var gc = 0; gc < groupKeys.length; gc++) {
                    var gUsers = groups[groupKeys[gc]];
                    var filled = 0;
                    for (var gu = 0; gu < gUsers.length; gu++) {
                        if (hasValue(gUsers[gu][field.key])) filled++;
                    }
                    var pct = gUsers.length > 0 ? Math.round((filled / gUsers.length) * 100) : 0;
                    sumPct += pct;
                    var td = document.createElement('td');
                    td.className = 'cell-right';

                    // Create mini progress bar with percentage badge
                    var barWrapper = document.createElement('div');
                    barWrapper.className = 'completeness-bar';
                    barWrapper.style.justifyContent = 'flex-end';

                    var barTrack = document.createElement('div');
                    barTrack.className = 'completeness-bar-track';
                    barTrack.style.maxWidth = '50px';
                    var barFill = document.createElement('div');
                    var pctClass = pct >= 90 ? 'pct-high' : (pct >= 70 ? 'pct-medium' : 'pct-low');
                    barFill.className = 'completeness-bar-fill ' + pctClass;
                    barFill.style.width = pct + '%';
                    barTrack.appendChild(barFill);

                    var badge = document.createElement('span');
                    badge.className = pctColorClass(pct);
                    badge.textContent = pct + '%';
                    badge.style.minWidth = '42px';
                    badge.style.textAlign = 'center';

                    barWrapper.appendChild(barTrack);
                    barWrapper.appendChild(badge);
                    td.appendChild(barWrapper);
                    tr.appendChild(td);
                }

                var avgPct = groupKeys.length > 0 ? Math.round(sumPct / groupKeys.length) : 0;
                var tdAvg = document.createElement('td');
                tdAvg.className = 'cell-right font-bold';
                tdAvg.textContent = avgPct + '%';
                tr.appendChild(tdAvg);
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            wrapper.appendChild(tableWrap);
            bContainer.appendChild(wrapper);
        }

        // Render breakdown filter
        FocusTables.renderBreakdownFilter({
            containerId: 'dq-breakdown-filter',
            dimensions: dimensions,
            selected: currentDim,
            onChange: function(key) {
                currentDim = key;
                renderBreakdown(key);
            }
        });

        renderBreakdown(currentDim);
    }

    /**
     * Renders the detail table showing per-user profile fields.
     */
    function renderDetailTable(data) {
        // Compute per-user completeness
        var enriched = [];
        for (var i = 0; i < data.length; i++) {
            var user = data[i];
            var filled = 0;
            for (var f = 0; f < PROFILE_FIELDS.length; f++) {
                if (hasValue(user[PROFILE_FIELDS[f].key])) filled++;
            }
            var pct = PROFILE_FIELDS.length > 0 ? Math.round((filled / PROFILE_FIELDS.length) * 100) : 0;
            // Shallow copy with completeness
            var row = {};
            for (var k in user) {
                if (user.hasOwnProperty(k)) row[k] = user[k];
            }
            row._completeness = pct;
            enriched.push(row);
        }

        // Get visible columns from column selector
        var visibleKeys = [];
        try {
            var saved = localStorage.getItem('tenantscope-dq-columns');
            if (saved) visibleKeys = JSON.parse(saved);
        } catch (e) {}
        if (!visibleKeys || visibleKeys.length === 0) {
            visibleKeys = ['displayName', 'department', 'jobTitle', 'companyName', 'officeLocation', 'city', 'mobilePhone', 'manager', '_completeness'];
        }

        // Build columns array based on visible keys
        var columnMap = {
            'displayName':      { key: 'displayName', label: 'Name', formatter: function(v, row) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + v + '</strong></a>';
            }},
            'userPrincipalName': { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link" title="' + v + '">' + v + '</a>';
            }},
            'domain':           { key: 'domain', label: 'Domain' },
            'department':       { key: 'department', label: 'Department', formatter: formatMissing },
            'jobTitle':         { key: 'jobTitle', label: 'Job Title', formatter: formatMissing },
            'companyName':      { key: 'companyName', label: 'Company', formatter: formatMissing },
            'officeLocation':   { key: 'officeLocation', label: 'Office', formatter: formatMissing },
            'city':             { key: 'city', label: 'City', formatter: formatMissing },
            'country':          { key: 'country', label: 'Country', formatter: formatMissing },
            'mobilePhone':      { key: 'mobilePhone', label: 'Mobile Phone', formatter: formatMissing },
            'manager':          { key: 'manager', label: 'Manager', formatter: formatMissing },
            'mail':             { key: 'mail', label: 'Email', formatter: formatMissing },
            'usageLocation':    { key: 'usageLocation', label: 'Usage Location', formatter: formatMissing },
            'userSource':       { key: 'userSource', label: 'User Source' },
            '_completeness':    { key: '_completeness', label: 'Completeness', formatter: formatCompleteness },
            '_adminLinks':      { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (row.id) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(row.id) + '" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>';
                }
                return '--';
            }}
        };

        var columns = [];
        for (var c = 0; c < visibleKeys.length; c++) {
            if (columnMap[visibleKeys[c]]) {
                columns.push(columnMap[visibleKeys[c]]);
            }
        }

        Tables.render({
            containerId: 'dq-table',
            data: enriched,
            columns: columns,
            pageSize: 50,
            onRowClick: showUserDetail
        });
    }

    /**
     * Formatter that shows "Missing" in red for empty values.
     */
    function formatMissing(value) {
        if (value === null || value === undefined || value === '') {
            return '<span class="status-badge status-badge-critical">Missing</span>';
        }
        return String(value);
    }

    /**
     * Formatter for completeness percentage.
     */
    function formatCompleteness(value) {
        var span = document.createElement('span');
        span.className = pctColorClass(value);
        span.textContent = value + '%';
        return span;
    }

    /**
     * Shows user detail in modal.
     */
    function showUserDetail(user) {
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        var overlay = document.getElementById('modal-overlay');

        if (!title || !body || !overlay) return;

        title.textContent = user.displayName + ' - Profile Completeness';
        body.textContent = '';

        var table = document.createElement('table');
        table.className = 'modal-detail-table';

        // Header
        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        var th1 = document.createElement('th');
        th1.textContent = 'Property';
        var th2 = document.createElement('th');
        th2.textContent = 'Value';
        var th3 = document.createElement('th');
        th3.textContent = 'Status';
        headRow.appendChild(th1);
        headRow.appendChild(th2);
        headRow.appendChild(th3);
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');

        // Basic info
        var basicFields = [
            { key: 'displayName', label: 'Display Name' },
            { key: 'userPrincipalName', label: 'UPN' },
            { key: 'accountEnabled', label: 'Account Enabled' },
            { key: 'domain', label: 'Domain' },
            { key: 'userSource', label: 'User Source' }
        ];

        for (var b = 0; b < basicFields.length; b++) {
            var bf = basicFields[b];
            var tr = document.createElement('tr');
            var td1 = document.createElement('td');
            td1.textContent = bf.label;
            td1.style.fontWeight = '600';
            var td2 = document.createElement('td');
            td2.textContent = String(user[bf.key] !== null && user[bf.key] !== undefined ? user[bf.key] : '-');
            var td3 = document.createElement('td');
            td3.textContent = '-';
            tr.appendChild(td1);
            tr.appendChild(td2);
            tr.appendChild(td3);
            tbody.appendChild(tr);
        }

        // Separator
        var sep = document.createElement('tr');
        var sepTd = document.createElement('td');
        sepTd.colSpan = 3;
        sepTd.style.borderBottom = '2px solid #e5e7eb';
        sepTd.style.padding = '4px';
        sep.appendChild(sepTd);
        tbody.appendChild(sep);

        // Profile fields with status
        for (var p = 0; p < PROFILE_FIELDS.length; p++) {
            var field = PROFILE_FIELDS[p];
            var val = user[field.key];
            var populated = hasValue(val);

            var row = document.createElement('tr');
            var rtd1 = document.createElement('td');
            rtd1.textContent = field.label;
            rtd1.style.fontWeight = '600';

            var rtd2 = document.createElement('td');
            if (populated) {
                rtd2.textContent = String(val);
            } else {
                var missing = document.createElement('span');
                missing.className = 'status-badge status-badge-critical';
                missing.textContent = 'Missing';
                rtd2.appendChild(missing);
            }

            var rtd3 = document.createElement('td');
            var statusBadge = document.createElement('span');
            statusBadge.className = populated ? 'status-badge status-badge-success' : 'status-badge status-badge-critical';
            statusBadge.textContent = populated ? 'Complete' : 'Incomplete';
            rtd3.appendChild(statusBadge);

            row.appendChild(rtd1);
            row.appendChild(rtd2);
            row.appendChild(rtd3);
            tbody.appendChild(row);
        }

        table.appendChild(tbody);
        body.appendChild(table);
        overlay.classList.add('visible');
    }

    /**
     * Creates a summary card element.
     */
    function makeCard(title, value, trend) {
        var card = document.createElement('div');
        card.className = 'card';

        var label = document.createElement('div');
        label.className = 'card-label';
        label.textContent = title;
        card.appendChild(label);

        var val = document.createElement('div');
        val.className = 'card-value';
        val.textContent = value;
        card.appendChild(val);

        if (trend === 'positive') {
            val.style.color = 'var(--color-success)';
        } else if (trend === 'negative') {
            val.style.color = 'var(--color-critical)';
        }

        return card;
    }

    return {
        render: render
    };

})();

window.PageDataQuality = PageDataQuality;
