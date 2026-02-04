/**
 * ============================================================================
 * M365 Tenant Toolkit
 * Author: Robe (https://github.com/Thugney)
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

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const users = DataLoader.getData('users');

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
        const filteredData = Filters.apply(users, filterConfig);

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the users table.
     *
     * @param {Array} data - Filtered user data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'users-table',
            data: data,
            columns: [
                { key: 'displayName', label: 'Name' },
                { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate' },
                { key: 'domain', label: 'Domain', formatter: formatDomain },
                { key: 'accountEnabled', label: 'Status', formatter: Tables.formatters.enabledStatus },
                { key: 'department', label: 'Department' },
                { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
                { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
                { key: 'mfaRegistered', label: 'MFA', formatter: formatMfa },
                { key: 'licenseCount', label: 'Licenses' },
                { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags }
            ],
            pageSize: 50,
            onRowClick: showUserDetails
        });
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

            <!-- Filters -->
            <div id="users-filter"></div>

            <!-- Data Table -->
            <div id="users-table"></div>
        `;

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
                    type: 'checkbox-group',
                    id: 'users-flags',
                    label: 'Flags',
                    options: [
                        { value: 'inactive', label: 'Inactive' },
                        { value: 'no-mfa', label: 'No MFA' },
                        { value: 'admin', label: 'Admin' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

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
