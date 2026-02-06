/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: USERS
 *
 * Renders the users page with filtering and detailed user table.
 * Shows all member users (not guests) with their status, MFA, and activity.
 */

const PageUsers = (function() {
    'use strict';

    /** Current filter state */
    let currentFilters = {};

    /** Column selector instance */
    var colSelector = null;

    /** Filter chips instance */
    var filterChipsInstance = null;

    /**
     * Updates filter chips display with current filter values.
     */
    function updateFilterChips() {
        if (!filterChipsInstance) return;

        var activeFilters = {};

        var search = Filters.getValue('users-search');
        if (search && search.trim()) {
            activeFilters.search = search.trim();
        }

        var domain = Filters.getValue('users-domain');
        if (domain && domain !== 'all') {
            activeFilters.domain = domain;
        }

        var status = Filters.getValue('users-status');
        if (status && status !== 'all') {
            activeFilters.accountEnabled = status;
        }

        var source = Filters.getValue('users-source');
        if (source && source !== 'all') {
            activeFilters.userSource = source;
        }

        var flags = Filters.getValue('users-flags');
        if (flags && flags.length > 0) {
            activeFilters.flags = flags;
        }

        var createdRange = Filters.getValue('users-created-range');
        if (createdRange && (createdRange.from || createdRange.to)) {
            activeFilters.created = createdRange;
        }

        var signinRange = Filters.getValue('users-signin-range');
        if (signinRange && (signinRange.from || signinRange.to)) {
            activeFilters.lastSignIn = signinRange;
        }

        filterChipsInstance.update(activeFilters);
    }

    /**
     * Handles filter removal from chips.
     * @param {string} removedKey - Key of removed filter (null if clearing all)
     * @param {object} remainingFilters - Remaining active filters
     * @param {Array} allRemovedKeys - All removed keys when clearing all
     */
    function handleFilterChipRemove(removedKey, remainingFilters, allRemovedKeys) {
        if (removedKey === null) {
            // Clear all filters
            Filters.setValue('users-search', '');
            Filters.setValue('users-domain', 'all');
            Filters.setValue('users-status', 'all');
            Filters.setValue('users-source', 'all');

            // Clear checkbox group
            var flagsEl = document.getElementById('users-flags');
            if (flagsEl) {
                var checkboxes = flagsEl.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(function(cb) { cb.checked = false; });
            }

            // Clear date ranges
            var createdEl = document.getElementById('users-created-range');
            if (createdEl) {
                var createdInputs = createdEl.querySelectorAll('input');
                createdInputs.forEach(function(i) { i.value = ''; });
            }
            var signinEl = document.getElementById('users-signin-range');
            if (signinEl) {
                var signinInputs = signinEl.querySelectorAll('input');
                signinInputs.forEach(function(i) { i.value = ''; });
            }
        } else {
            // Clear specific filter
            switch (removedKey) {
                case 'search':
                    Filters.setValue('users-search', '');
                    break;
                case 'domain':
                    Filters.setValue('users-domain', 'all');
                    break;
                case 'accountEnabled':
                    Filters.setValue('users-status', 'all');
                    break;
                case 'userSource':
                    Filters.setValue('users-source', 'all');
                    break;
                case 'flags':
                    var flagsEl = document.getElementById('users-flags');
                    if (flagsEl) {
                        var checkboxes = flagsEl.querySelectorAll('input[type="checkbox"]');
                        checkboxes.forEach(function(cb) { cb.checked = false; });
                    }
                    break;
                case 'created':
                    var createdEl = document.getElementById('users-created-range');
                    if (createdEl) {
                        var inputs = createdEl.querySelectorAll('input');
                        inputs.forEach(function(i) { i.value = ''; });
                    }
                    break;
                case 'lastSignIn':
                    var signinEl = document.getElementById('users-signin-range');
                    if (signinEl) {
                        var inputs = signinEl.querySelectorAll('input');
                        inputs.forEach(function(i) { i.value = ''; });
                    }
                    break;
            }
        }

        // Re-apply filters
        applyFilters();
    }

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('users-search'),
            searchFields: ['displayName', 'userPrincipalName', 'mail', 'department', 'jobTitle'],
            exact: {
                domain: Filters.getValue('users-domain'),
                accountEnabled: Filters.getValue('users-status') === 'enabled' ? true :
                               (Filters.getValue('users-status') === 'disabled' ? false : null)
            },
            boolean: {},
            includes: {}
        };

        // Handle flags filter
        const flagFilters = Filters.getValue('users-flags');
        if (flagFilters && flagFilters.length > 0) {
            filterConfig.includes.flags = flagFilters;
        }

        // Apply filters
        var filteredData = Filters.apply(users, filterConfig);

        // User Source filter (Cloud vs On-premises synced)
        var userSourceFilter = Filters.getValue('users-source');
        if (userSourceFilter && userSourceFilter !== 'all') {
            filteredData = filteredData.filter(function(u) {
                return u.userSource === userSourceFilter;
            });
        }

        // Date range filters
        var createdRange = Filters.getValue('users-created-range');
        if (createdRange && (createdRange.from || createdRange.to)) {
            filteredData = filteredData.filter(function(u) {
                if (!u.createdDateTime) return false;
                var dt = new Date(u.createdDateTime);
                if (createdRange.from && dt < new Date(createdRange.from)) return false;
                if (createdRange.to && dt > new Date(createdRange.to + 'T23:59:59')) return false;
                return true;
            });
        }

        var signinRange = Filters.getValue('users-signin-range');
        if (signinRange && (signinRange.from || signinRange.to)) {
            filteredData = filteredData.filter(function(u) {
                if (!u.lastSignIn) return !signinRange.from;
                var dt = new Date(u.lastSignIn);
                if (signinRange.from && dt < new Date(signinRange.from)) return false;
                if (signinRange.to && dt > new Date(signinRange.to + 'T23:59:59')) return false;
                return true;
            });
        }

        // Render Focus/Breakdown tables
        renderFocusBreakdown(filteredData);

        // Render table
        renderTable(filteredData);

        // Update filter chips
        updateFilterChips();
    }

    /**
     * Renders the users table.
     *
     * @param {Array} data - Filtered user data
     */
    function renderTable(data) {
        // Get visible columns from Column Selector
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'userPrincipalName', 'domain', 'accountEnabled', 'department',
            'lastSignIn', 'daysSinceLastSignIn', 'mfaRegistered', 'licenseCount', 'flags'
        ];

        // All column definitions
        var allDefs = [
            { key: 'displayName', label: 'Name' },
            { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
            { key: 'mail', label: 'Email', className: 'cell-truncate' },
            { key: 'domain', label: 'Domain', formatter: formatDomain },
            { key: 'accountEnabled', label: 'Status', formatter: Tables.formatters.enabledStatus },
            { key: 'userSource', label: 'Source', formatter: formatUserSource },
            { key: 'department', label: 'Department' },
            { key: 'jobTitle', label: 'Job Title' },
            { key: 'companyName', label: 'Company' },
            { key: 'officeLocation', label: 'Office' },
            { key: 'city', label: 'City' },
            { key: 'country', label: 'Country' },
            { key: 'manager', label: 'Manager' },
            { key: 'usageLocation', label: 'Usage Location' },
            { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
            { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
            { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
            { key: 'mfaRegistered', label: 'MFA', formatter: formatMfa },
            { key: 'licenseCount', label: 'Licenses', className: 'cell-right' },
            { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags }
        ];

        // Filter to visible columns only
        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'users-table',
            data: data,
            columns: columns,
            pageSize: 50,
            onRowClick: showUserDetails
        });
    }

    /**
     * Formats user source badge.
     */
    function formatUserSource(value) {
        if (!value) return '<span class="text-muted">--</span>';
        if (value === 'Cloud') {
            return '<span class="badge badge-info">Cloud</span>';
        }
        return '<span class="badge badge-neutral">On-prem</span>';
    }

    /**
     * Formats the domain badge.
     */
    function formatDomain(value) {
        const classes = {
            'employee': 'badge-info',
            'student': 'badge-success',
            'other': 'badge-neutral'
        };
        return `<span class="badge ${classes[value] || 'badge-neutral'}">${value || 'unknown'}</span>`;
    }

    /**
     * Formats MFA status.
     */
    function formatMfa(value) {
        return value
            ? '<span class="text-success">Yes</span>'
            : '<span class="text-critical font-bold">No</span>';
    }

    /** Current breakdown dimension */
    var currentBreakdown = 'department';

    /**
     * Renders Focus/Breakdown tables for user analysis.
     *
     * @param {Array} users - Filtered user data
     */
    function renderFocusBreakdown(users) {
        var focusContainer = document.getElementById('users-focus-table');
        var breakdownContainer = document.getElementById('users-breakdown-table');
        var breakdownFilterContainer = document.getElementById('users-breakdown-filter');

        if (!focusContainer || !breakdownContainer) return;

        // Breakdown dimension options
        var breakdownDimensions = [
            { key: 'department', label: 'Department' },
            { key: 'companyName', label: 'Company' },
            { key: 'city', label: 'City' },
            { key: 'officeLocation', label: 'Office' },
            { key: 'jobTitle', label: 'Job Title' },
            { key: 'manager', label: 'Manager' },
            { key: 'userSource', label: 'Source' }
        ];

        // Render breakdown filter
        if (breakdownFilterContainer && typeof FocusTables !== 'undefined') {
            FocusTables.renderBreakdownFilter({
                containerId: 'users-breakdown-filter',
                dimensions: breakdownDimensions,
                selected: currentBreakdown,
                onChange: function(newDim) {
                    currentBreakdown = newDim;
                    renderFocusBreakdown(users);
                }
            });
        }

        // Render Focus Table: group by domain
        if (typeof FocusTables !== 'undefined') {
            FocusTables.renderFocusTable({
                containerId: 'users-focus-table',
                data: users,
                groupByKey: 'domain',
                groupByLabel: 'Domain',
                countLabel: 'Users'
            });

            // Render Breakdown Table: domain x breakdown dimension
            FocusTables.renderBreakdownTable({
                containerId: 'users-breakdown-table',
                data: users,
                primaryKey: 'domain',
                breakdownKey: currentBreakdown,
                primaryLabel: 'Domain',
                breakdownLabel: breakdownDimensions.find(function(d) { return d.key === currentBreakdown; }).label
            });
        } else {
            // Fallback - render simple summary
            var fallbackMsg = document.createElement('p');
            fallbackMsg.className = 'text-muted';
            fallbackMsg.textContent = 'Focus/Breakdown tables not available';
            focusContainer.appendChild(fallbackMsg);
        }
    }

    /**
     * Shows detailed modal for a user.
     *
     * @param {object} user - User data object
     */
    function showUserDetails(user) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = user.displayName;

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">UPN:</span>
                <span class="detail-value">${user.userPrincipalName}</span>

                <span class="detail-label">Email:</span>
                <span class="detail-value">${user.mail || '--'}</span>

                <span class="detail-label">Domain:</span>
                <span class="detail-value">${user.domain}</span>

                <span class="detail-label">Department:</span>
                <span class="detail-value">${user.department || '--'}</span>

                <span class="detail-label">Job Title:</span>
                <span class="detail-value">${user.jobTitle || '--'}</span>

                <span class="detail-label">Account Status:</span>
                <span class="detail-value">${user.accountEnabled ? 'Enabled' : 'Disabled'}</span>

                <span class="detail-label">User Type:</span>
                <span class="detail-value">${user.userType || 'Member'}</span>

                <span class="detail-label">Created:</span>
                <span class="detail-value">${DataLoader.formatDate(user.createdDateTime)}</span>

                <span class="detail-label">Last Sign-In:</span>
                <span class="detail-value">${DataLoader.formatDate(user.lastSignIn)}</span>

                <span class="detail-label">Days Since Sign-In:</span>
                <span class="detail-value">${user.daysSinceLastSignIn !== null ? user.daysSinceLastSignIn : '--'}</span>

                <span class="detail-label">MFA Registered:</span>
                <span class="detail-value">${user.mfaRegistered ? 'Yes' : 'No'}</span>

                <span class="detail-label">License Count:</span>
                <span class="detail-value">${user.licenseCount}</span>

                <span class="detail-label">On-Prem Sync:</span>
                <span class="detail-value">${user.onPremSync ? 'Yes' : 'No'}</span>

                <span class="detail-label">Flags:</span>
                <span class="detail-value">${user.flags && user.flags.length > 0 ? user.flags.join(', ') : 'None'}</span>

                <span class="detail-label">User ID:</span>
                <span class="detail-value" style="font-size: 0.8em;">${user.id}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    /**
     * Renders the users page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        const users = DataLoader.getData('users');
        const summary = DataLoader.getSummary();

        // Get unique departments for filter
        const departments = [...new Set(users.map(u => u.department).filter(Boolean))].sort();

        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">Users</h2>
                <p class="page-description">All member accounts in your tenant</p>
            </div>

            <!-- Summary Cards -->
            <div class="cards-grid">
                <div class="card">
                    <div class="card-label">Total Users</div>
                    <div class="card-value">${summary.totalUsers}</div>
                </div>
                <div class="card">
                    <div class="card-label">Employees</div>
                    <div class="card-value">${summary.employeeCount}</div>
                </div>
                <div class="card">
                    <div class="card-label">Students</div>
                    <div class="card-value">${summary.studentCount}</div>
                </div>
                <div class="card ${summary.noMfaUsers > 0 ? 'card-critical' : 'card-success'}">
                    <div class="card-label">Without MFA</div>
                    <div class="card-value ${summary.noMfaUsers > 0 ? 'critical' : 'success'}">${summary.noMfaUsers}</div>
                </div>
            </div>

            <!-- Charts -->
            <div class="charts-row" id="users-charts"></div>

            <!-- Focus/Breakdown Analysis -->
            <div class="section-header">
                <h3>User Analysis</h3>
                <div id="users-breakdown-filter"></div>
            </div>
            <div class="focus-breakdown-row">
                <div id="users-focus-table"></div>
                <div id="users-breakdown-table"></div>
            </div>

            <!-- Filters -->
            <div id="users-filter"></div>

            <!-- Active Filter Chips -->
            <div id="users-filter-chips"></div>

            <!-- Column Selector + Export -->
            <div class="table-toolbar">
                <div id="users-col-selector"></div>
                <button class="btn btn-secondary btn-sm" id="export-users-table">Export CSV</button>
            </div>

            <!-- Data Table -->
            <div id="users-table"></div>
        `;

        // Render charts
        var chartsRow = document.getElementById('users-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;
            var enabledCount = users.filter(u => u.accountEnabled).length;
            var disabledCount = users.filter(u => !u.accountEnabled).length;
            var mfaCount = users.filter(u => u.mfaRegistered).length;
            var noMfaCount = users.filter(u => !u.mfaRegistered).length;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Account Status',
                [
                    { value: enabledCount, label: 'Enabled', color: C.green },
                    { value: disabledCount, label: 'Disabled', color: C.red }
                ],
                String(enabledCount), 'enabled'
            ));

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Domain Distribution',
                [
                    { value: summary.employeeCount, label: 'Employees', color: C.blue },
                    { value: summary.studentCount, label: 'Students', color: C.teal },
                    { value: summary.otherCount || 0, label: 'Other', color: C.gray }
                ],
                String(users.length), 'total users'
            ));
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'users-filter',
            controls: [
                {
                    type: 'search',
                    id: 'users-search',
                    label: 'Search',
                    placeholder: 'Search users...'
                },
                {
                    type: 'select',
                    id: 'users-domain',
                    label: 'Domain',
                    options: [
                        { value: 'all', label: 'All Domains' },
                        { value: 'employee', label: 'Employees' },
                        { value: 'student', label: 'Students' },
                        { value: 'other', label: 'Other' }
                    ]
                },
                {
                    type: 'select',
                    id: 'users-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All Status' },
                        { value: 'enabled', label: 'Enabled' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select',
                    id: 'users-source',
                    label: 'Source',
                    options: [
                        { value: 'all', label: 'All Sources' },
                        { value: 'Cloud', label: 'Cloud' },
                        { value: 'On-premises synced', label: 'On-prem Synced' }
                    ]
                },
                {
                    type: 'checkbox-group',
                    id: 'users-flags',
                    label: 'Flags',
                    options: [
                        { value: 'inactive', label: 'Inactive' },
                        { value: 'no-mfa', label: 'No MFA' },
                        { value: 'admin', label: 'Admin' }
                    ]
                },
                {
                    type: 'date-range',
                    id: 'users-created-range',
                    label: 'Created'
                },
                {
                    type: 'date-range',
                    id: 'users-signin-range',
                    label: 'Last Sign-In'
                }
            ],
            onFilter: applyFilters
        });

        // Initialize filter chips
        if (typeof FilterChips !== 'undefined') {
            filterChipsInstance = Object.create(FilterChips);
            filterChipsInstance.init('users-filter-chips', handleFilterChipRemove);
        }

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'users-col-selector',
                storageKey: 'users-columns',
                allColumns: [
                    { key: 'displayName', label: 'Name' },
                    { key: 'userPrincipalName', label: 'UPN' },
                    { key: 'mail', label: 'Email' },
                    { key: 'domain', label: 'Domain' },
                    { key: 'accountEnabled', label: 'Status' },
                    { key: 'userSource', label: 'Source' },
                    { key: 'department', label: 'Department' },
                    { key: 'jobTitle', label: 'Job Title' },
                    { key: 'companyName', label: 'Company' },
                    { key: 'officeLocation', label: 'Office' },
                    { key: 'city', label: 'City' },
                    { key: 'country', label: 'Country' },
                    { key: 'manager', label: 'Manager' },
                    { key: 'usageLocation', label: 'Usage Location' },
                    { key: 'createdDateTime', label: 'Created' },
                    { key: 'lastSignIn', label: 'Last Sign-In' },
                    { key: 'daysSinceLastSignIn', label: 'Days Inactive' },
                    { key: 'mfaRegistered', label: 'MFA' },
                    { key: 'licenseCount', label: 'Licenses' },
                    { key: 'flags', label: 'Flags' }
                ],
                defaultVisible: [
                    'displayName', 'userPrincipalName', 'domain', 'accountEnabled', 'department',
                    'lastSignIn', 'daysSinceLastSignIn', 'mfaRegistered', 'licenseCount', 'flags'
                ],
                onColumnsChanged: applyFilters
            });
        }

        // Bind export button
        Export.bindExportButton('users-table', 'users');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageUsers = PageUsers;
