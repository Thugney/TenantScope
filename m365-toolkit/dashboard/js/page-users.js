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

    var AU = window.ActionUtils || {};

    /** Current tab */
    var currentTab = 'users';

    /** Current filter state */
    let currentFilters = {};

    /** Active group filter (from hash params) */
    var groupFilter = null;

    /** Column selector instance */
    var colSelector = null;

    /** Filter chips instance */
    var filterChipsInstance = null;

    /** Cached page state */
    var usersState = null;

    /** Cached user -> device index */
    var deviceIndex = null;

    function getHashParams() {
        var hash = window.location.hash || '';
        var idx = hash.indexOf('?');
        if (idx === -1) return {};
        var query = hash.substring(idx + 1);
        var params = new URLSearchParams(query);
        var result = {};
        params.forEach(function(value, key) {
            result[key] = value;
        });
        return result;
    }

    function updateHashParams(updates) {
        var hash = window.location.hash || '';
        var raw = hash.replace(/^#/, '');
        var parts = raw.split('?');
        var page = parts[0] || 'users';
        var params = new URLSearchParams(parts[1] || '');

        Object.keys(updates || {}).forEach(function(key) {
            var value = updates[key];
            if (value === null || value === undefined || value === '') {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });

        var newHash = '#' + page + (params.toString() ? '?' + params.toString() : '');
        if (newHash !== window.location.hash) {
            window.location.hash = newHash;
        }
    }

    function getGroupsData() {
        if (typeof DataLoader === 'undefined' || !DataLoader.getData) return [];
        var groupsData = DataLoader.getData('groups') || [];
        if (groupsData.groups) return groupsData.groups;
        return Array.isArray(groupsData) ? groupsData : [];
    }

    function buildGroupFilterFromHash() {
        var params = getHashParams();
        var groupId = params.groupId || '';
        var groupName = params.groupName || params.group || '';
        var roleParam = (params.groupRole || params.role || 'members').toLowerCase();

        if (!groupId && !groupName) return null;

        var role = (roleParam === 'owners' || roleParam === 'owner') ? 'owners' : 'members';
        var group = null;

        var groups = getGroupsData();
        if (groupId) {
            group = groups.find(function(g) { return g && g.id === groupId; }) || null;
        }
        if (!group && groupName) {
            var nameLower = groupName.toLowerCase();
            group = groups.find(function(g) { return g && g.displayName && g.displayName.toLowerCase() === nameLower; }) || null;
        }

        var list = [];
        var totalCount = 0;
        if (group) {
            groupId = group.id || groupId;
            groupName = group.displayName || groupName;
            list = role === 'owners' ? (group.owners || []) : (group.members || []);
            totalCount = role === 'owners' ? (group.ownerCount || list.length) : (group.memberCount || list.length);
        }

        var userIdSet = {};
        var userUpnSet = {};
        list.forEach(function(m) {
            if (m.id) userIdSet[m.id] = true;
            var upn = (m.userPrincipalName || m.mail || '').toLowerCase();
            if (upn) userUpnSet[upn] = true;
        });

        return {
            groupId: groupId,
            groupName: groupName,
            role: role,
            listCount: list.length,
            totalCount: totalCount,
            userIdSet: userIdSet,
            userUpnSet: userUpnSet,
            isMissingList: list.length === 0 && totalCount > 0,
            isUnknown: !group
        };
    }

    function setGroupFilterFromHash() {
        groupFilter = buildGroupFilterFromHash();
    }

    function clearGroupFilter() {
        groupFilter = null;
        updateHashParams({
            groupId: null,
            groupName: null,
            groupRole: null,
            group: null
        });
    }

    function updateGroupFilterBanner() {
        var banner = document.getElementById('users-group-filter-banner');
        if (!banner) return;

        if (!groupFilter) {
            banner.classList.add('hidden');
            banner.innerHTML = '';
            return;
        }

        var name = escapeHtml(groupFilter.groupName || groupFilter.groupId || 'Group');
        var roleLabel = groupFilter.role === 'owners' ? 'Owners' : 'Members';
        var detail = '';

        if (groupFilter.isUnknown) {
            detail = 'Group not found in dataset.';
        } else if (groupFilter.isMissingList) {
            detail = 'Membership list not collected; showing 0 of ' + (groupFilter.totalCount || 0) + '.';
        } else if (groupFilter.totalCount && groupFilter.totalCount !== groupFilter.listCount) {
            detail = 'Showing ' + groupFilter.listCount + ' of ' + groupFilter.totalCount + ' collected.';
        }

        var html = '<strong>Group filter:</strong> ' + name + ' (' + roleLabel + ').';
        if (detail) {
            html += ' <span class="text-muted">' + escapeHtml(detail) + '</span>';
        }

        banner.innerHTML = html;
        banner.classList.remove('hidden');
    }

    function getDeviceIndex() {
        if (deviceIndex) return deviceIndex;

        var raw = DataLoader.getData('devices') || [];
        var devices = Array.isArray(raw) ? raw : (raw.devices || []);
        var map = {};

        devices.forEach(function(d) {
            var upn = (d.userPrincipalName || d.emailAddress || '').toLowerCase();
            if (!upn) return;
            if (!map[upn]) map[upn] = [];
            map[upn].push(d);
        });

        deviceIndex = map;
        return map;
    }

    function getDeviceCountForUser(user) {
        var upn = (user.userPrincipalName || '').toLowerCase();
        if (!upn) return 0;
        var index = getDeviceIndex();
        return index[upn] ? index[upn].length : 0;
    }

    function buildDevicesLink(user, count) {
        if (!user || !user.userPrincipalName) {
            return '<span class="text-muted">--</span>';
        }
        if (!count || count <= 0) {
            return '<span class="text-muted">0</span>';
        }
        var upn = encodeURIComponent(user.userPrincipalName);
        var label = count === 1 ? 'device' : 'devices';
        return '<a href="#devices?tab=devices&user=' + upn + '">View ' + count + ' ' + label + '</a>';
    }

    function buildUser360Link(user, label) {
        if (!user) return label || '--';
        var id = user.id || '';
        var upn = user.userPrincipalName || user.mail || '';
        var query = id ? ('id=' + encodeURIComponent(id)) : ('upn=' + encodeURIComponent(upn));
        if (!id && !upn) return label || '--';
        var text = label || user.displayName || upn || '--';
        return '<a href="#user-360?' + query + '" class="entity-link"><strong>' + escapeHtml(text) + '</strong></a>';
    }

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

        if (groupFilter) {
            var groupLabel = groupFilter.groupName || groupFilter.groupId || 'Group';
            var roleLabel = groupFilter.role === 'owners' ? 'Owners' : 'Members';
            activeFilters.group = groupLabel + ' (' + roleLabel + ')';
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

            clearGroupFilter();
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
                case 'group':
                    clearGroupFilter();
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
        deviceIndex = null;
        if (!groupFilter) {
            groupFilter = buildGroupFilterFromHash();
        }

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

        if (groupFilter) {
            filteredData = filteredData.filter(function(u) {
                if (!u) return false;
                if (groupFilter.userIdSet && groupFilter.userIdSet[u.id]) return true;
                var upn = (u.userPrincipalName || u.mail || '').toLowerCase();
                return upn && groupFilter.userUpnSet && groupFilter.userUpnSet[upn];
            });
        }

        // Date range filters
        var createdRange = Filters.getValue('users-created-range');
        if (createdRange && (createdRange.from || createdRange.to)) {
            filteredData = filteredData.filter(function(u) {
                if (!u.createdDateTime) return false;
                var dt = new Date(u.createdDateTime);
                if (isNaN(dt.getTime())) return false;
                if (createdRange.from) {
                    var fromDt = new Date(createdRange.from);
                    if (!isNaN(fromDt.getTime()) && dt < fromDt) return false;
                }
                if (createdRange.to) {
                    var toDt = new Date(createdRange.to + 'T23:59:59');
                    if (!isNaN(toDt.getTime()) && dt > toDt) return false;
                }
                return true;
            });
        }

        updateGroupFilterBanner();

        var signinRange = Filters.getValue('users-signin-range');
        if (signinRange && (signinRange.from || signinRange.to)) {
            filteredData = filteredData.filter(function(u) {
                if (!u.lastSignIn) return !signinRange.from;
                var dt = new Date(u.lastSignIn);
                if (isNaN(dt.getTime())) return !signinRange.from;
                if (signinRange.from) {
                    var fromDt = new Date(signinRange.from);
                    if (!isNaN(fromDt.getTime()) && dt < fromDt) return false;
                }
                if (signinRange.to) {
                    var toDt = new Date(signinRange.to + 'T23:59:59');
                    if (!isNaN(toDt.getTime()) && dt > toDt) return false;
                }
                return true;
            });
        }

        // Attach device counts for sorting and display
        filteredData.forEach(function(u) {
            u.deviceCount = getDeviceCountForUser(u);
        });

        // Update summary cards with filtered data
        updateUsersSummaryCards(filteredData);

        // Update tab label with filtered count
        var usersTabBtn = document.querySelector('.tab-btn[data-tab="users"]');
        if (usersTabBtn) {
            usersTabBtn.textContent = 'All Users (' + filteredData.length + ')';
        }

        // Render Focus/Breakdown tables
        renderFocusBreakdown(filteredData);

        // Render table
        renderTable(filteredData);

        // Update filter chips
        updateFilterChips();
    }

    /**
     * Updates the summary cards with filtered data counts.
     */
    function updateUsersSummaryCards(filteredUsers) {
        var total = filteredUsers.length;
        var employeeCount = 0;
        var studentCount = 0;
        var noMfaCount = 0;

        // Get domain config for employee/student classification
        var metadata = DataLoader.getMetadata ? DataLoader.getMetadata() : {};
        var domains = metadata.domains || {};
        var employeeDomain = (domains.employees || '').toLowerCase();
        var studentDomain = (domains.students || '').toLowerCase();

        filteredUsers.forEach(function(u) {
            var upn = (u.userPrincipalName || '').toLowerCase();
            if (studentDomain && upn.endsWith(studentDomain)) {
                studentCount++;
            } else if (employeeDomain && upn.endsWith(employeeDomain)) {
                employeeCount++;
            }
            if (!u.mfaRegistered) {
                noMfaCount++;
            }
        });

        // Update values
        var totalEl = document.getElementById('users-sum-total-value');
        var employeesEl = document.getElementById('users-sum-employees-value');
        var studentsEl = document.getElementById('users-sum-students-value');
        var nomfaEl = document.getElementById('users-sum-nomfa-value');
        var nomfaCard = document.getElementById('users-sum-nomfa-card');

        if (totalEl) totalEl.textContent = total;
        if (employeesEl) employeesEl.textContent = employeeCount;
        if (studentsEl) studentsEl.textContent = studentCount;
        if (nomfaEl) nomfaEl.textContent = noMfaCount;
        if (nomfaCard) {
            nomfaCard.className = 'card' + (noMfaCount > 0 ? ' card-critical' : ' card-success');
        }
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
            'lastSignIn', 'daysSinceLastSignIn', 'mfaRegistered', 'licenseCount', 'deviceCount', 'flags'
        ];

        // All column definitions
        var allDefs = [
            { key: 'displayName', label: 'Name', formatter: function(v, row) {
                if (!v) return '--';
                return buildUser360Link(row, v);
            }},
            { key: 'userPrincipalName', label: 'UPN', className: 'cell-truncate', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#user-360?upn=' + encodeURIComponent(v) + '" class="entity-link" title="' + v + '">' + v + '</a>';
            }},
            { key: 'mail', label: 'Email', className: 'cell-truncate' },
            { key: 'domain', label: 'Domain', formatter: formatDomain },
            { key: 'accountEnabled', label: 'Status', formatter: Tables.formatters.enabledStatus },
            { key: 'userSource', label: 'Source', formatter: formatUserSource },
            { key: 'department', label: 'Department', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link">' + v + '</a>';
            }},
            { key: 'jobTitle', label: 'Job Title' },
            { key: 'companyName', label: 'Company' },
            { key: 'officeLocation', label: 'Office' },
            { key: 'city', label: 'City' },
            { key: 'country', label: 'Country' },
            { key: 'manager', label: 'Manager', formatter: function(v, row) {
                if (!v) return '--';
                var mgrUpn = row.managerUpn || '';
                if (mgrUpn) {
                    return '<a href="#users?search=' + encodeURIComponent(mgrUpn) + '" class="entity-link">' + v + '</a>';
                }
                return v;
            }},
            { key: 'usageLocation', label: 'Usage Location' },
            { key: 'createdDateTime', label: 'Created', formatter: Tables.formatters.date },
            { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
            { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
            { key: 'mfaRegistered', label: 'MFA', formatter: formatMfa },
            { key: 'licenseCount', label: 'Licenses', className: 'cell-right' },
            { key: 'deviceCount', label: 'Devices', formatter: function(v, row) {
                var count = getDeviceCountForUser(row);
                return buildDevicesLink(row, count);
            }},
            { key: 'flags', label: 'Flags', formatter: Tables.formatters.flags },
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (!row.id) return '--';
                var url = 'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(row.id);
                return '<a href="' + url + '" target="_blank" rel="noopener" class="admin-link" title="Open in Entra ID">Entra</a>';
            }}
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
                breakdownLabel: (breakdownDimensions.find(function(d) { return d.key === currentBreakdown; }) || {}).label || currentBreakdown
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
     * Shows detailed modal for a user with tabbed layout and all related data.
     *
     * @param {object} user - User data object
     */
    function showUserDetails(user) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = user.displayName;

        // Get all related data using DataRelationships
        var profile = null;
        if (typeof DataRelationships !== 'undefined') {
            profile = DataRelationships.getUserProfile(user.id);
        }

        var licenses = profile ? profile.licenses : [];
        var mfa = profile ? profile.mfa : { registered: user.mfaRegistered, methods: [] };
        var risks = profile ? profile.risks : { riskLevel: 'none', detections: [] };
        var adminRoles = profile ? profile.adminRoles : [];
        var devices = profile ? profile.devices : [];
        var signIns = profile ? profile.signIns : [];
        var teams = profile ? profile.teams : [];
        var alerts = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserAlerts(user.userPrincipalName) : [];
        var adminUrls = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserAdminUrls(user) : {};
        var caPolicies = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserConditionalAccessPolicies(user, adminRoles) : [];
        var oauthConsents = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserOAuthConsents(user) : [];
        var auditLogs = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserAuditLogs(user) : [];
        var directReports = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserDirectReports(user) : [];
        var managerChain = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserManagerChain(user) : [];
        var pimActivity = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserPimActivity(user) : { eligibleRoles: [], activations: [], pendingApprovals: [] };
        var riskySignins = typeof DataRelationships !== 'undefined' ? DataRelationships.getUserRiskySignins(user) : [];
        var groups = profile ? profile.groups : [];

        var disableCommand = buildDisableUserCommand(user);

        body.innerHTML = buildUserModalContent(user, licenses, mfa, risks, adminRoles, devices, signIns, teams, disableCommand, alerts, adminUrls, caPolicies, oauthConsents, auditLogs, directReports, managerChain, pimActivity, riskySignins, groups);

        // Set up tab switching
        setupUserModalTabs(body);

        // Set up copy button
        var cmdInput = body.querySelector('#disable-user-command');
        var copyBtn = body.querySelector('#copy-disable-user');
        if (cmdInput) {
            cmdInput.value = disableCommand || 'Command unavailable';
        }
        if (copyBtn) {
            copyBtn.disabled = !disableCommand;
            copyBtn.addEventListener('click', function() {
                if (!disableCommand || !AU.copyText) return;
                AU.copyText(disableCommand).then(function() {
                    if (window.Toast) Toast.success('Copied', 'Disable user command copied.');
                }).catch(function() {
                    if (window.Toast) Toast.error('Copy failed', 'Unable to copy command.');
                });
            });
        }

        modal.classList.add('visible');
    }

    /**
     * Build the complete user modal content with tabs.
     */
    function buildUserModalContent(user, licenses, mfa, risks, adminRoles, devices, signIns, teams, disableCommand, alerts, adminUrls, caPolicies, oauthConsents, auditLogs, directReports, managerChain, pimActivity, riskySignins, groups) {
        var riskBadge = getRiskBadge(risks.riskLevel);
        alerts = alerts || [];
        adminUrls = adminUrls || {};
        caPolicies = caPolicies || [];
        oauthConsents = oauthConsents || [];
        auditLogs = auditLogs || [];
        directReports = directReports || [];
        managerChain = managerChain || [];
        pimActivity = pimActivity || { eligibleRoles: [], activations: [], pendingApprovals: [] };
        riskySignins = riskySignins || [];
        groups = groups || [];

        return '<div class="modal-tabs">' +
            '<button class="modal-tab active" data-tab="overview">Overview</button>' +
            '<button class="modal-tab" data-tab="licenses">Licenses (' + licenses.length + ')</button>' +
            '<button class="modal-tab" data-tab="security">Security</button>' +
            '<button class="modal-tab" data-tab="devices">Devices (' + devices.length + ')</button>' +
            '<button class="modal-tab" data-tab="groups">Groups (' + groups.length + ')</button>' +
            '<button class="modal-tab" data-tab="activity">Activity</button>' +
        '</div>' +
        '<div class="modal-tab-content">' +
            buildOverviewTab(user, mfa, risks, adminRoles, adminUrls, directReports, managerChain) +
            buildLicensesTab(licenses) +
            buildSecurityTab(mfa, risks, adminRoles, alerts, caPolicies, oauthConsents, pimActivity, riskySignins) +
            buildDevicesTab(devices) +
            buildGroupsTab(groups) +
            buildActivityTab(signIns, teams, disableCommand, auditLogs) +
        '</div>';
    }

    function buildOverviewTab(user, mfa, risks, adminRoles, adminUrls, directReports, managerChain) {
        var riskBadge = getRiskBadge(risks.riskLevel);
        var adminBadge = adminRoles.length > 0 ? '<span class="status-badge status-warning">' + adminRoles.length + ' roles</span>' : '<span class="status-badge">None</span>';
        adminUrls = adminUrls || {};
        directReports = directReports || [];
        managerChain = managerChain || [];

        var adminLinks = '';
        if (adminUrls.entra || adminUrls.defender) {
            adminLinks = '<div class="detail-section full-width"><h4>Quick Actions</h4><div class="admin-portal-links" style="display:flex;flex-wrap:wrap;gap:0.5rem">';
            if (adminUrls.entra) {
                adminLinks += '<a href="' + adminUrls.entra + '" target="_blank" rel="noopener" class="btn btn-primary btn-sm">Open in Entra</a>';
            }
            if (adminUrls.defender) {
                adminLinks += '<a href="' + adminUrls.defender + '" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Defender</a>';
            }
            if (adminUrls.entraAuth) {
                adminLinks += '<a href="' + adminUrls.entraAuth + '" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Auth Methods</a>';
            }
            if (adminUrls.entraDevices) {
                adminLinks += '<a href="' + adminUrls.entraDevices + '" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Devices</a>';
            }
            if (adminUrls.entraRoles) {
                adminLinks += '<a href="' + adminUrls.entraRoles + '" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Roles</a>';
            }
            if (adminUrls.resetPassword) {
                adminLinks += '<a href="' + adminUrls.resetPassword + '" target="_blank" rel="noopener" class="btn btn-warning btn-sm">Reset Password</a>';
            }
            adminLinks += '</div></div>';
        }

        // Build Org Hierarchy section
        var orgHierarchy = '';
        if (managerChain.length > 0 || directReports.length > 0) {
            orgHierarchy = '<div class="detail-section full-width"><h4>Org Hierarchy</h4>';

            // Manager chain (upward)
            if (managerChain.length > 0) {
                orgHierarchy += '<div style="margin-bottom:0.75rem"><strong>Reports To:</strong><ul class="detail-methods-list" style="margin-top:0.25rem">';
                managerChain.forEach(function(mgr, idx) {
                    var indent = idx > 0 ? 'style="margin-left:' + (idx * 12) + 'px"' : '';
                    orgHierarchy += '<li ' + indent + '><a href="#users?search=' + encodeURIComponent(mgr.userPrincipalName) + '" class="text-link">' +
                        escapeHtml(mgr.displayName) + '</a> <span class="text-muted">(' + escapeHtml(mgr.jobTitle || '--') + ')</span></li>';
                });
                orgHierarchy += '</ul></div>';
            }

            // Direct reports (downward)
            if (directReports.length > 0) {
                orgHierarchy += '<div><strong>Direct Reports (' + directReports.length + '):</strong><ul class="detail-methods-list" style="margin-top:0.25rem">';
                directReports.slice(0, 10).forEach(function(report) {
                    orgHierarchy += '<li><a href="#users?search=' + encodeURIComponent(report.userPrincipalName) + '" class="text-link">' +
                        escapeHtml(report.displayName) + '</a> <span class="text-muted">(' + escapeHtml(report.jobTitle || '--') + ')</span></li>';
                });
                if (directReports.length > 10) {
                    orgHierarchy += '<li class="text-muted">...and ' + (directReports.length - 10) + ' more</li>';
                }
                orgHierarchy += '</ul></div>';
            }

            orgHierarchy += '</div>';
        }

        return '<div class="modal-tab-pane active" data-tab="overview">' +
            '<div class="detail-grid">' +
                '<div class="detail-section">' +
                    '<h4>Identity</h4>' +
                    '<div class="detail-list">' +
                        '<span class="detail-label">UPN:</span><span class="detail-value">' + user.userPrincipalName + '</span>' +
                        '<span class="detail-label">Email:</span><span class="detail-value">' + (user.mail || '--') + '</span>' +
                        '<span class="detail-label">Domain:</span><span class="detail-value">' + user.domain + '</span>' +
                        '<span class="detail-label">User Type:</span><span class="detail-value">' + (user.userType || 'Member') + '</span>' +
                        '<span class="detail-label">Account Status:</span><span class="detail-value">' + (user.accountEnabled ? '<span class="status-badge status-success">Enabled</span>' : '<span class="status-badge status-danger">Disabled</span>') + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="detail-section">' +
                    '<h4>Organization</h4>' +
                    '<div class="detail-list">' +
                        '<span class="detail-label">Department:</span><span class="detail-value">' + (user.department || '--') + '</span>' +
                        '<span class="detail-label">Job Title:</span><span class="detail-value">' + (user.jobTitle || '--') + '</span>' +
                        '<span class="detail-label">Manager:</span><span class="detail-value">' + (user.manager || '--') + '</span>' +
                        '<span class="detail-label">Company:</span><span class="detail-value">' + (user.companyName || '--') + '</span>' +
                        '<span class="detail-label">Office:</span><span class="detail-value">' + (user.officeLocation || '--') + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="detail-section">' +
                    '<h4>Security Summary</h4>' +
                    '<div class="detail-list">' +
                        '<span class="detail-label">Risk Level:</span><span class="detail-value">' + riskBadge + '</span>' +
                        '<span class="detail-label">MFA Status:</span><span class="detail-value">' + (mfa.registered ? '<span class="status-badge status-success">Registered</span>' : '<span class="status-badge status-danger">Not Registered</span>') + '</span>' +
                        '<span class="detail-label">Admin Roles:</span><span class="detail-value">' + adminBadge + '</span>' +
                        '<span class="detail-label">Account Source:</span><span class="detail-value">' + (user.onPremSync ? '<span class="status-badge">On-Premises</span>' : '<span class="status-badge status-info">Cloud-Only</span>') + '</span>' +
                        '<span class="detail-label">Last Password Change:</span><span class="detail-value">' + DataLoader.formatDate(user.lastPasswordChange) + (user.passwordAge !== null && user.passwordAge !== undefined ? ' (' + user.passwordAge + ' days ago)' : '') + '</span>' +
                        '<span class="detail-label">Password Expires:</span><span class="detail-value">' + (user.passwordNeverExpires ? '<span class="status-badge status-warning">Never</span>' : '<span class="status-badge status-success">Yes</span>') + '</span>' +
                        (user.disableStrongPassword ? '<span class="detail-label">Strong Password:</span><span class="detail-value"><span class="status-badge status-danger">Disabled</span></span>' : '') +
                    '</div>' +
                '</div>' +
                (user.onPremSync ? '<div class="detail-section">' +
                    '<h4>On-Premises Sync</h4>' +
                    '<div class="detail-list">' +
                        '<span class="detail-label">Domain:</span><span class="detail-value">' + escapeHtml(user.onPremDomainName || '--') + '</span>' +
                        '<span class="detail-label">SAM Account:</span><span class="detail-value"><code>' + escapeHtml(user.onPremSamAccountName || '--') + '</code></span>' +
                        '<span class="detail-label">Last Sync:</span><span class="detail-value">' + DataLoader.formatDate(user.onPremLastSync) + '</span>' +
                        '<span class="detail-label">Sync Age:</span><span class="detail-value">' + (user.onPremSyncAge !== null && user.onPremSyncAge !== undefined ? user.onPremSyncAge + ' days' + (user.onPremSyncAge > 1 ? ' <span class="text-warning">(stale)</span>' : '') : '--') + '</span>' +
                        (user.onPremDistinguishedName ? '<span class="detail-label">DN:</span><span class="detail-value" title="' + escapeHtml(user.onPremDistinguishedName) + '"><code style="font-size:0.75em;word-break:break-all">' + escapeHtml(user.onPremDistinguishedName) + '</code></span>' : '') +
                    '</div>' +
                '</div>' : '') +
                '<div class="detail-section">' +
                    '<h4>Activity</h4>' +
                    '<div class="detail-list">' +
                        '<span class="detail-label">Created:</span><span class="detail-value">' + DataLoader.formatDate(user.createdDateTime) + '</span>' +
                        '<span class="detail-label">Last Sign-In:</span><span class="detail-value">' + DataLoader.formatDate(user.lastSignIn) + '</span>' +
                        '<span class="detail-label">Days Inactive:</span><span class="detail-value">' + (user.daysSinceLastSignIn !== null ? user.daysSinceLastSignIn : '--') + '</span>' +
                    '</div>' +
                '</div>' +
                orgHierarchy +
                adminLinks +
            '</div>' +
        '</div>';
    }

    function buildLicensesTab(licenses) {
        var content = '<div class="modal-tab-pane" data-tab="licenses">';
        if (licenses.length === 0) {
            content += '<div class="empty-state-small">No licenses assigned</div>';
        } else {
            content += '<table class="mini-table"><thead><tr><th>License</th><th>SKU</th><th>Assigned Via</th></tr></thead><tbody>';
            licenses.forEach(function(lic) {
                content += '<tr><td>' + escapeHtml(lic.displayName) + '</td><td><code>' + escapeHtml(lic.skuPartNumber) + '</code></td><td>' + lic.assignedVia + '</td></tr>';
            });
            content += '</tbody></table>';
        }
        content += '</div>';
        return content;
    }

    function buildSecurityTab(mfa, risks, adminRoles, alerts, caPolicies, oauthConsents, pimActivity, riskySignins) {
        alerts = alerts || [];
        caPolicies = caPolicies || [];
        oauthConsents = oauthConsents || [];
        pimActivity = pimActivity || { eligibleRoles: [], activations: [], pendingApprovals: [] };
        riskySignins = riskySignins || [];
        var content = '<div class="modal-tab-pane" data-tab="security">';

        // MFA Methods section
        content += '<div class="detail-section"><h4>MFA Methods</h4>';
        if (mfa.methods && mfa.methods.length > 0) {
            content += '<ul class="method-list">';
            mfa.methods.forEach(function(method) {
                var methodName = typeof method === 'string' ? method : (method.methodType || method.type || 'Unknown');
                content += '<li>' + escapeHtml(methodName) + '</li>';
            });
            content += '</ul>';
            if (mfa.isPhishingResistant) {
                content += '<div class="status-badge status-success">Phishing-Resistant Method Available</div>';
            }
        } else {
            content += '<div class="empty-state-small">No MFA methods registered</div>';
        }
        content += '</div>';

        // Risk section
        content += '<div class="detail-section"><h4>Identity Risk</h4>';
        content += '<div class="detail-list">';
        content += '<span class="detail-label">Risk Level:</span><span class="detail-value">' + getRiskBadge(risks.riskLevel) + '</span>';
        content += '<span class="detail-label">Risk State:</span><span class="detail-value">' + (risks.riskState || 'none') + '</span>';
        content += '</div>';
        if (risks.detections && risks.detections.length > 0) {
            content += '<h5>Recent Risk Detections</h5><ul class="detection-list">';
            risks.detections.slice(0, 5).forEach(function(det) {
                content += '<li><strong>' + escapeHtml(det.riskEventType || det.riskType || 'Unknown') + '</strong> - ' + (det.riskLevel || 'unknown') + ' (' + DataLoader.formatDate(det.detectedDateTime) + ')</li>';
            });
            content += '</ul>';
        }
        content += '</div>';

        // Admin Roles section
        content += '<div class="detail-section"><h4>Admin Roles</h4>';
        if (adminRoles.length > 0) {
            content += '<ul class="role-list">';
            adminRoles.forEach(function(role) {
                content += '<li><strong>' + escapeHtml(role.displayName) + '</strong>' + (role.description ? '<br><small>' + escapeHtml(role.description) + '</small>' : '') + '</li>';
            });
            content += '</ul>';
        } else {
            content += '<div class="empty-state-small">No admin roles assigned</div>';
        }
        content += '</div>';

        // Defender Alerts section
        content += '<div class="detail-section full-width"><h4>Defender Alerts (' + alerts.length + ')</h4>';
        if (alerts.length > 0) {
            content += '<table class="mini-table"><thead><tr><th>Alert</th><th>Severity</th><th>Status</th><th>Date</th></tr></thead><tbody>';
            alerts.slice(0, 10).forEach(function(alert) {
                var sevClass = alert.severity === 'high' ? 'text-critical' : alert.severity === 'medium' ? 'text-warning' : '';
                var statusClass = alert.status === 'new' ? 'text-critical' : alert.status === 'inProgress' ? 'text-warning' : 'text-success';
                content += '<tr>';
                content += '<td title="' + escapeHtml(alert.description || '') + '">' + escapeHtml(alert.title || '--') + '</td>';
                content += '<td class="' + sevClass + '">' + (alert.severity || '--') + '</td>';
                content += '<td class="' + statusClass + '">' + (alert.status || '--') + '</td>';
                content += '<td>' + (alert.createdDateTime ? DataLoader.formatDate(alert.createdDateTime) : '--') + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
            if (alerts.length > 10) {
                content += '<p class="text-muted" style="margin-top:0.5rem">...and ' + (alerts.length - 10) + ' more alerts</p>';
            }
        } else {
            content += '<div class="empty-state-small">No Defender alerts for this user</div>';
        }
        content += '</div>';

        // Conditional Access Policies section
        content += '<div class="detail-section full-width"><h4>Conditional Access Policies (' + caPolicies.length + ')</h4>';
        if (caPolicies.length > 0) {
            content += '<table class="mini-table"><thead><tr><th>Policy</th><th>Requires</th><th>Effect</th></tr></thead><tbody>';
            caPolicies.forEach(function(policy) {
                var requires = [];
                if (policy.requiresMfa) requires.push('MFA');
                if (policy.requiresCompliantDevice) requires.push('Compliant Device');
                if (policy.blocksLegacyAuth) requires.push('Modern Auth');
                var requiresText = requires.length > 0 ? requires.join(', ') : 'None';

                var effect = policy.blockAccess ? '<span class="text-critical">Block</span>' : '<span class="text-success">Grant</span>';

                content += '<tr>';
                content += '<td>' + escapeHtml(policy.displayName) + '</td>';
                content += '<td>' + requiresText + '</td>';
                content += '<td>' + effect + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
            content += '<p class="text-muted" style="margin-top:0.5rem;font-size:0.85em">Policies shown are enabled and apply to this user based on "All Users" or admin role membership.</p>';
        } else {
            content += '<div class="empty-state-small">No Conditional Access policies detected for this user</div>';
        }
        content += '</div>';

        // OAuth Consent Grants section
        content += '<div class="detail-section full-width"><h4>OAuth App Consents (' + oauthConsents.length + ')</h4>';
        if (oauthConsents.length > 0) {
            content += '<table class="mini-table"><thead><tr><th>App</th><th>Publisher</th><th>Consent Type</th><th>Risk</th></tr></thead><tbody>';
            oauthConsents.forEach(function(grant) {
                var riskClass = grant.riskLevel === 'high' ? 'text-critical' : grant.riskLevel === 'medium' ? 'text-warning' : '';
                var verifiedBadge = grant.isVerifiedPublisher ? ' <span class="status-badge status-success" style="font-size:0.7em">Verified</span>' : '';
                content += '<tr>';
                content += '<td>' + escapeHtml(grant.appDisplayName || '--') + '</td>';
                content += '<td>' + escapeHtml(grant.appPublisher || '--') + verifiedBadge + '</td>';
                content += '<td>' + escapeHtml(grant.consentType) + '</td>';
                content += '<td class="' + riskClass + '">' + (grant.riskLevel || 'low') + (grant.scopeCount ? ' (' + grant.scopeCount + ' scopes)' : '') + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
            var highRiskApps = oauthConsents.filter(function(g) { return g.riskLevel === 'high'; });
            if (highRiskApps.length > 0) {
                content += '<p class="text-warning" style="margin-top:0.5rem;font-size:0.85em">' + highRiskApps.length + ' app(s) with high-risk permissions detected.</p>';
            }
        } else {
            content += '<div class="empty-state-small">No OAuth consent grants for this user</div>';
        }
        content += '</div>';

        // PIM Activity section
        var pimTotal = pimActivity.eligibleRoles.length + pimActivity.activations.length;
        content += '<div class="detail-section full-width"><h4>Privileged Identity Management (PIM)</h4>';

        if (pimActivity.pendingApprovals.length > 0) {
            content += '<div class="status-badge status-warning" style="margin-bottom:0.5rem">' + pimActivity.pendingApprovals.length + ' pending approval(s)</div>';
        }

        if (pimActivity.eligibleRoles.length > 0) {
            content += '<h5>Eligible Roles (' + pimActivity.eligibleRoles.length + ')</h5>';
            content += '<table class="mini-table"><thead><tr><th>Role</th><th>Status</th><th>Expires</th></tr></thead><tbody>';
            pimActivity.eligibleRoles.forEach(function(role) {
                var expiryDate = role.endDateTime ? DataLoader.formatDate(role.endDateTime) : 'Permanent';
                content += '<tr>';
                content += '<td>' + escapeHtml(role.roleName) + '</td>';
                content += '<td>' + (role.status || '--') + '</td>';
                content += '<td>' + expiryDate + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
        }

        if (pimActivity.activations.length > 0) {
            content += '<h5 style="margin-top:1rem">Recent Activations (' + pimActivity.activations.length + ')</h5>';
            content += '<table class="mini-table"><thead><tr><th>Role</th><th>Date</th><th>Justification</th></tr></thead><tbody>';
            pimActivity.activations.forEach(function(act) {
                content += '<tr>';
                content += '<td>' + escapeHtml(act.roleName) + '</td>';
                content += '<td>' + (act.createdDateTime ? DataLoader.formatDate(act.createdDateTime) : '--') + '</td>';
                content += '<td title="' + escapeHtml(act.justification || '') + '">' + escapeHtml((act.justification || '--').substring(0, 40)) + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
        }

        if (pimTotal === 0) {
            content += '<div class="empty-state-small">No PIM roles or activations for this user</div>';
        }
        content += '</div>';

        // Risky Sign-Ins section
        content += '<div class="detail-section full-width"><h4>Risky Sign-Ins (' + riskySignins.length + ')</h4>';
        if (riskySignins.length > 0) {
            content += '<table class="mini-table"><thead><tr><th>Time</th><th>App</th><th>Risk Level</th><th>Risk State</th><th>Location</th></tr></thead><tbody>';
            riskySignins.forEach(function(signin) {
                var riskClass = signin.riskLevel === 'high' ? 'text-critical' : signin.riskLevel === 'medium' ? 'text-warning' : '';
                var stateClass = signin.riskState === 'atRisk' ? 'text-critical' : signin.riskState === 'confirmedCompromised' ? 'text-critical' : signin.riskState === 'remediated' ? 'text-success' : '';
                var location = signin.location ? ((signin.location.city || '') + (signin.location.countryOrRegion ? ', ' + signin.location.countryOrRegion : '')) : '--';
                content += '<tr>';
                content += '<td>' + DataLoader.formatDate(signin.createdDateTime) + '</td>';
                content += '<td>' + escapeHtml(signin.appDisplayName || '--') + '</td>';
                content += '<td class="' + riskClass + '">' + (signin.riskLevel || '--') + '</td>';
                content += '<td class="' + stateClass + '">' + (signin.riskState || '--') + '</td>';
                content += '<td>' + escapeHtml(location) + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
            var highRiskCount = riskySignins.filter(function(s) { return s.riskLevel === 'high'; }).length;
            if (highRiskCount > 0) {
                content += '<p class="text-critical" style="margin-top:0.5rem;font-size:0.85em">' + highRiskCount + ' high-risk sign-in(s) detected. Review immediately.</p>';
            }
        } else {
            content += '<div class="empty-state-small">No risky sign-ins detected</div>';
        }
        content += '</div>';

        content += '</div>';
        return content;
    }

    function buildDevicesTab(devices) {
        var content = '<div class="modal-tab-pane" data-tab="devices">';
        if (devices.length === 0) {
            content += '<div class="empty-state-small">No devices enrolled</div>';
        } else {
            content += '<table class="mini-table"><thead><tr><th>Device</th><th>OS</th><th>Compliance</th><th>Last Sync</th></tr></thead><tbody>';
            devices.forEach(function(dev) {
                var complianceBadge = dev.complianceState === 'compliant' ? '<span class="status-badge status-success">Compliant</span>' :
                                     dev.complianceState === 'noncompliant' ? '<span class="status-badge status-danger">Non-Compliant</span>' :
                                     '<span class="status-badge">Unknown</span>';
                content += '<tr>' +
                    '<td>' + escapeHtml(dev.deviceName || dev.displayName || '--') + '</td>' +
                    '<td>' + escapeHtml(dev.operatingSystem || '--') + '</td>' +
                    '<td>' + complianceBadge + '</td>' +
                    '<td>' + DataLoader.formatDate(dev.lastSyncDateTime) + '</td>' +
                '</tr>';
            });
            content += '</tbody></table>';
        }
        content += '</div>';
        return content;
    }

    function buildGroupsTab(groups) {
        var content = '<div class="modal-tab-pane" data-tab="groups">';
        if (!groups || groups.length === 0) {
            content += '<div class="empty-state-small">No group memberships found</div>';
        } else {
            content += '<table class="mini-table"><thead><tr><th>Group Name</th><th>Type</th><th>Source</th><th>Members</th><th>Licenses</th></tr></thead><tbody>';
            groups.forEach(function(group) {
                var typeBadge = group.groupType === 'Security' ? '<span class="status-badge status-info">Security</span>' :
                               group.groupType === 'Microsoft 365' ? '<span class="status-badge status-success">M365</span>' :
                               group.groupType === 'Distribution' ? '<span class="status-badge status-warning">Distribution</span>' :
                               '<span class="status-badge">' + escapeHtml(group.groupType || 'Other') + '</span>';
                var sourceBadge = group.onPremSync ? '<span class="status-badge">On-prem</span>' : '<span class="status-badge status-info">Cloud</span>';
                var licenseCount = group.licenseAssignmentCount || 0;
                var licenseDisplay = licenseCount > 0 ? '<span class="text-info font-bold">' + licenseCount + '</span>' : '<span class="text-muted">0</span>';
                content += '<tr>' +
                    '<td><a href="#groups?search=' + encodeURIComponent(group.displayName || '') + '" class="text-link">' + escapeHtml(group.displayName || '--') + '</a></td>' +
                    '<td>' + typeBadge + '</td>' +
                    '<td>' + sourceBadge + '</td>' +
                    '<td>' + (group.memberCount || 0) + '</td>' +
                    '<td>' + licenseDisplay + '</td>' +
                '</tr>';
            });
            content += '</tbody></table>';

            // Show license groups summary
            var licenseGroups = groups.filter(function(g) { return g.hasLicenseAssignments; });
            if (licenseGroups.length > 0) {
                content += '<p class="text-info" style="margin-top:0.75rem;font-size:0.85em">User receives licenses via ' + licenseGroups.length + ' group(s).</p>';
            }
        }
        content += '</div>';
        return content;
    }

    function buildActivityTab(signIns, teams, disableCommand, auditLogs) {
        auditLogs = auditLogs || [];
        var content = '<div class="modal-tab-pane" data-tab="activity">';

        // Recent Sign-Ins
        content += '<div class="detail-section"><h4>Recent Sign-Ins</h4>';
        if (signIns.length > 0) {
            content += '<table class="mini-table"><thead><tr><th>Time</th><th>App</th><th>Status</th><th>Location</th></tr></thead><tbody>';
            signIns.slice(0, 10).forEach(function(si) {
                var statusBadge = si.status && si.status.errorCode === 0 ? '<span class="status-badge status-success">Success</span>' : '<span class="status-badge status-danger">Failed</span>';
                var location = si.location ? (si.location.city || '') + (si.location.countryOrRegion ? ', ' + si.location.countryOrRegion : '') : '--';
                content += '<tr>' +
                    '<td>' + DataLoader.formatDate(si.createdDateTime) + '</td>' +
                    '<td>' + escapeHtml(si.appDisplayName || '--') + '</td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td>' + escapeHtml(location) + '</td>' +
                '</tr>';
            });
            content += '</tbody></table>';
        } else {
            content += '<div class="empty-state-small">No recent sign-in data</div>';
        }
        content += '</div>';

        // Audit Logs section
        content += '<div class="detail-section full-width"><h4>Audit Logs (' + auditLogs.length + ')</h4>';
        if (auditLogs.length > 0) {
            content += '<table class="mini-table"><thead><tr><th>Time</th><th>Activity</th><th>Result</th><th>Category</th></tr></thead><tbody>';
            auditLogs.forEach(function(log) {
                var resultClass = log.result === 'success' ? 'text-success' : log.result === 'failure' ? 'text-critical' : '';
                content += '<tr>';
                content += '<td>' + DataLoader.formatDate(log.activityDateTime) + '</td>';
                content += '<td title="' + escapeHtml(log.operationType || '') + '">' + escapeHtml(log.activityDisplayName || log.activity || '--') + '</td>';
                content += '<td class="' + resultClass + '">' + escapeHtml(log.result || '--') + '</td>';
                content += '<td>' + escapeHtml(log.category || '--') + '</td>';
                content += '</tr>';
            });
            content += '</tbody></table>';
        } else {
            content += '<div class="empty-state-small">No audit log entries for this user</div>';
        }
        content += '</div>';

        // Teams Membership
        content += '<div class="detail-section"><h4>Teams Owned</h4>';
        if (teams.length > 0) {
            content += '<ul class="team-list">';
            teams.forEach(function(team) {
                content += '<li>' + escapeHtml(team.displayName) + ' <span class="status-badge">' + team.visibility + '</span></li>';
            });
            content += '</ul>';
        } else {
            content += '<div class="empty-state-small">Not an owner of any teams</div>';
        }
        content += '</div>';

        // Actions
        content += '<div class="detail-section"><h4>Actions</h4>' +
            '<div class="detail-grid"><div class="detail-item">' +
            '<span class="detail-label">Disable User (PowerShell)</span>' +
            '<div class="detail-value"><input type="text" class="filter-input action-input" id="disable-user-command" readonly></div>' +
            '</div></div>' +
            '<div class="action-row"><button class="btn btn-secondary" id="copy-disable-user">Copy Command</button></div>' +
            '<div class="action-note">Copy and run in a PowerShell session with Microsoft Graph connected.</div>' +
        '</div>';

        content += '</div>';
        return content;
    }

    function getRiskBadge(riskLevel) {
        if (!riskLevel || riskLevel === 'none' || riskLevel === 'hidden') {
            return '<span class="status-badge status-success">None</span>';
        } else if (riskLevel === 'low') {
            return '<span class="status-badge status-info">Low</span>';
        } else if (riskLevel === 'medium') {
            return '<span class="status-badge status-warning">Medium</span>';
        } else if (riskLevel === 'high') {
            return '<span class="status-badge status-danger">High</span>';
        }
        return '<span class="status-badge">' + riskLevel + '</span>';
    }

    function setupUserModalTabs(body) {
        var tabs = body.querySelectorAll('.modal-tab');
        var panes = body.querySelectorAll('.modal-tab-pane');

        tabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                var targetTab = this.getAttribute('data-tab');

                // Update active tab
                tabs.forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');

                // Update active pane
                panes.forEach(function(p) {
                    if (p.getAttribute('data-tab') === targetTab) {
                        p.classList.add('active');
                    } else {
                        p.classList.remove('active');
                    }
                });
            });
        });
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function buildDisableUserCommand(user) {
        if (!user) return '';
        var id = user.id || user.userPrincipalName || '';
        if (!id) return '';
        var safeId = AU.escapeSingleQuotes ? AU.escapeSingleQuotes(id) : String(id).replace(/'/g, "''");
        return "Update-MgUser -UserId '" + safeId + "' -AccountEnabled:$false";
    }

    /**
     * Creates a summary card element.
     */
    function createSummaryCard(label, value, variant, id) {
        var card = document.createElement('div');
        card.className = 'card' + (variant ? ' card-' + variant : '');
        if (id) card.id = id + '-card';
        var labelDiv = document.createElement('div');
        labelDiv.className = 'card-label';
        labelDiv.textContent = label;
        var valueDiv = document.createElement('div');
        valueDiv.className = 'card-value' + (variant ? ' ' + variant : '');
        if (id) valueDiv.id = id + '-value';
        valueDiv.textContent = value;
        card.appendChild(labelDiv);
        card.appendChild(valueDiv);
        return card;
    }

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = document.createElement('div');
        card.className = 'analytics-card';
        var h4 = document.createElement('h4');
        h4.textContent = title;
        card.appendChild(h4);
        var list = document.createElement('div');
        list.className = 'platform-list';
        rows.forEach(function(row) {
            var rowDiv = document.createElement('div');
            rowDiv.className = 'platform-row';
            var name = document.createElement('span');
            name.className = 'platform-name';
            name.textContent = row.name;
            rowDiv.appendChild(name);
            var policies = document.createElement('span');
            policies.className = 'platform-policies';
            policies.textContent = row.count;
            rowDiv.appendChild(policies);
            var miniBar = document.createElement('div');
            miniBar.className = 'mini-bar';
            var fill = document.createElement('div');
            fill.className = 'mini-bar-fill ' + row.cls;
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            var rate = document.createElement('span');
            rate.className = 'platform-rate';
            rate.textContent = row.showCount ? row.count : (row.pct + '%');
            rowDiv.appendChild(rate);
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = document.createElement('div');
        card.className = 'insight-card insight-' + type;
        var header = document.createElement('div');
        header.className = 'insight-header';
        var badgeSpan = document.createElement('span');
        badgeSpan.className = 'badge badge-' + type;
        badgeSpan.textContent = badge;
        header.appendChild(badgeSpan);
        var catSpan = document.createElement('span');
        catSpan.className = 'insight-category';
        catSpan.textContent = category;
        header.appendChild(catSpan);
        card.appendChild(header);
        var descP = document.createElement('p');
        descP.className = 'insight-description';
        descP.textContent = description;
        card.appendChild(descP);
        if (action) {
            var actionP = document.createElement('p');
            actionP.className = 'insight-action';
            var strong = document.createElement('strong');
            strong.textContent = 'Action: ';
            actionP.appendChild(strong);
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    /**
     * Renders the users overview section with ASR Rules pattern.
     */
    function renderUsersOverview(container, stats) {
        container.textContent = '';

        // Build analytics section with donut chart
        var section = document.createElement('div');
        section.className = 'analytics-section';

        var sectionTitle = document.createElement('h3');
        sectionTitle.textContent = 'User Health Overview';
        section.appendChild(sectionTitle);

        var complianceOverview = document.createElement('div');
        complianceOverview.className = 'compliance-overview';

        // Donut chart showing MFA coverage
        var chartContainer = document.createElement('div');
        chartContainer.className = 'compliance-chart';
        var donutDiv = document.createElement('div');
        donutDiv.className = 'donut-chart';

        var circumference = 2 * Math.PI * 40;
        var mfaDash = (stats.mfaPct / 100) * circumference;
        var noMfaDash = ((100 - stats.mfaPct) / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (stats.mfaPct > 0) {
            var mfaCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            mfaCircle.setAttribute('cx', '50');
            mfaCircle.setAttribute('cy', '50');
            mfaCircle.setAttribute('r', '40');
            mfaCircle.setAttribute('fill', 'none');
            mfaCircle.setAttribute('stroke', 'var(--color-success)');
            mfaCircle.setAttribute('stroke-width', '12');
            mfaCircle.setAttribute('stroke-dasharray', mfaDash + ' ' + circumference);
            mfaCircle.setAttribute('stroke-dashoffset', '0');
            mfaCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(mfaCircle);
        }
        if (stats.noMfaCount > 0) {
            var noMfaCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            noMfaCircle.setAttribute('cx', '50');
            noMfaCircle.setAttribute('cy', '50');
            noMfaCircle.setAttribute('r', '40');
            noMfaCircle.setAttribute('fill', 'none');
            noMfaCircle.setAttribute('stroke', 'var(--color-critical)');
            noMfaCircle.setAttribute('stroke-width', '12');
            noMfaCircle.setAttribute('stroke-dasharray', noMfaDash + ' ' + circumference);
            noMfaCircle.setAttribute('stroke-dashoffset', String(-mfaDash));
            noMfaCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(noMfaCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = document.createElement('div');
        donutCenter.className = 'donut-center';
        var donutValue = document.createElement('span');
        donutValue.className = 'donut-value';
        donutValue.textContent = stats.mfaPct + '%';
        var donutLabel = document.createElement('span');
        donutLabel.className = 'donut-label';
        donutLabel.textContent = 'MFA Enrolled';
        donutCenter.appendChild(donutValue);
        donutCenter.appendChild(donutLabel);
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = document.createElement('div');
        legend.className = 'compliance-legend';
        var legendItems = [
            { cls: 'bg-success', label: 'MFA Enrolled', value: stats.mfaCount },
            { cls: 'bg-critical', label: 'Without MFA', value: stats.noMfaCount }
        ];
        legendItems.forEach(function(item) {
            var legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            var dot = document.createElement('span');
            dot.className = 'legend-dot ' + item.cls;
            legendItem.appendChild(dot);
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            var strong = document.createElement('strong');
            strong.textContent = item.value;
            legendItem.appendChild(strong);
            legend.appendChild(legendItem);
        });

        var metricItems = [
            { label: 'Enabled', value: stats.enabledCount },
            { label: 'Disabled', value: stats.disabledCount },
            { label: 'Inactive', value: stats.inactiveCount }
        ];
        metricItems.forEach(function(item) {
            var legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            legendItem.appendChild(document.createTextNode(item.label + ': '));
            var strong = document.createElement('strong');
            strong.textContent = item.value;
            legendItem.appendChild(strong);
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = document.createElement('div');
        analyticsGrid.className = 'analytics-grid';

        // Account Status card
        var disabledPct = stats.total > 0 ? Math.round((stats.disabledCount / stats.total) * 100) : 0;
        analyticsGrid.appendChild(createPlatformCard('Account Status', [
            { name: 'Enabled', count: stats.enabledCount, pct: stats.enabledPct, cls: 'bg-success' },
            { name: 'Disabled', count: stats.disabledCount, pct: disabledPct, cls: 'bg-neutral' }
        ]));

        // Domain Distribution card
        var empPct = stats.total > 0 ? Math.round((stats.employeeCount / stats.total) * 100) : 0;
        var stuPct = stats.total > 0 ? Math.round((stats.studentCount / stats.total) * 100) : 0;
        var othPct = stats.total > 0 ? Math.round((stats.otherCount / stats.total) * 100) : 0;
        analyticsGrid.appendChild(createPlatformCard('Domain Distribution', [
            { name: 'Employees', count: stats.employeeCount, pct: empPct, cls: 'bg-info' },
            { name: 'Students', count: stats.studentCount, pct: stuPct, cls: 'bg-primary' },
            { name: 'Other', count: stats.otherCount, pct: othPct, cls: 'bg-neutral' }
        ]));

        // User Source card
        var cloudPct = stats.total > 0 ? Math.round((stats.cloudUsers / stats.total) * 100) : 0;
        var syncPct = stats.total > 0 ? Math.round((stats.syncedUsers / stats.total) * 100) : 0;
        analyticsGrid.appendChild(createPlatformCard('User Source', [
            { name: 'Cloud', count: stats.cloudUsers, pct: cloudPct, cls: 'bg-info' },
            { name: 'On-prem Synced', count: stats.syncedUsers, pct: syncPct, cls: 'bg-neutral' }
        ]));

        // Security Posture card
        var inactivePct = stats.total > 0 ? Math.round((stats.inactiveCount / stats.total) * 100) : 0;
        var noMfaPct = 100 - stats.mfaPct;
        analyticsGrid.appendChild(createPlatformCard('Security Posture', [
            { name: 'MFA Enrolled', count: stats.mfaCount, pct: stats.mfaPct, cls: 'bg-success' },
            { name: 'Without MFA', count: stats.noMfaCount, pct: noMfaPct, cls: 'bg-critical' },
            { name: 'Inactive (90+ days)', count: stats.inactiveCount, pct: inactivePct, cls: 'bg-warning' }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = document.createElement('div');
        insightsList.className = 'insights-list';

        // No MFA insight
        if (stats.noMfaCount > 0) {
            var severity = stats.noMfaCount > 10 ? 'critical' : 'warning';
            var badge = stats.noMfaCount > 10 ? 'CRITICAL' : 'WARNING';
            insightsList.appendChild(createInsightCard(severity, badge, 'MFA Coverage',
                stats.noMfaCount + ' user' + (stats.noMfaCount !== 1 ? 's are' : ' is') + ' not enrolled in MFA. This is a significant security risk.',
                'Enforce MFA registration through Conditional Access policies.'));
        }

        // Inactive users insight
        if (stats.inactiveCount > 0) {
            insightsList.appendChild(createInsightCard('warning', 'REVIEW', 'Inactive Accounts',
                stats.inactiveCount + ' user' + (stats.inactiveCount !== 1 ? 's have' : ' has') + ' not signed in for 90+ days. These may be candidates for offboarding.',
                'Review inactive accounts and disable or remove as appropriate.'));
        }

        // Disabled accounts insight
        if (stats.disabledCount > 0) {
            insightsList.appendChild(createInsightCard('info', 'INFO', 'Disabled Accounts',
                stats.disabledCount + ' account' + (stats.disabledCount !== 1 ? 's are' : ' is') + ' currently disabled. Ensure licenses are reclaimed.',
                'Review disabled accounts for license reclamation opportunities.'));
        }

        // Healthy state
        if (stats.noMfaCount === 0 && stats.inactiveCount === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'User Status',
                'All users have MFA enrolled and no inactive accounts detected. User security posture is strong.',
                null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Switches to a different tab.
     */
    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    /**
     * Renders the content for the current tab.
     */
    function renderContent() {
        var container = document.getElementById('users-content');
        if (!container || !usersState) return;

        switch (currentTab) {
            case 'quality':
                renderDataQualityTab(container);
                break;
            case 'users':
                renderUsersTab(container);
                break;
        }
    }

    /**
     * Renders the Analysis tab with focus/breakdown tables.
     */
    function renderAnalysisTab(container) {
        container.textContent = '';

        // Section header
        var sectionHeader = document.createElement('div');
        sectionHeader.className = 'section-header';
        var analysisH3 = document.createElement('h3');
        analysisH3.textContent = 'User Analysis';
        sectionHeader.appendChild(analysisH3);
        var breakdownFilter = document.createElement('div');
        breakdownFilter.id = 'users-breakdown-filter';
        sectionHeader.appendChild(breakdownFilter);
        container.appendChild(sectionHeader);

        var fbRow = document.createElement('div');
        fbRow.className = 'focus-breakdown-row';
        var focusTable = document.createElement('div');
        focusTable.id = 'users-focus-table';
        fbRow.appendChild(focusTable);
        var breakdownTable = document.createElement('div');
        breakdownTable.id = 'users-breakdown-table';
        fbRow.appendChild(breakdownTable);
        container.appendChild(fbRow);

        // Render focus/breakdown tables
        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;
        renderFocusBreakdown(users);
    }

    /**
     * Renders the Data Quality tab with stale accounts, duplicates, and naming issues.
     */
    function renderDataQualityTab(container) {
        container.textContent = '';
        var users = usersState.users || [];
        var now = new Date();

        // Calculate data quality metrics
        var staleAccounts = [];
        var neverSignedIn = [];
        var namingIssues = [];
        var potentialDuplicates = [];
        var syncIssues = [];
        var missingData = [];

        // Track names for duplicate detection
        var nameMap = {};

        users.forEach(function(user) {
            var displayName = user.displayName || '';
            var upn = user.userPrincipalName || '';
            var mail = user.mail || '';

            // Stale accounts - no sign-in for 90+ days
            if (user.lastSignIn) {
                var lastSignIn = new Date(user.lastSignIn);
                var daysSinceSignIn = Math.floor((now - lastSignIn) / (1000 * 60 * 60 * 24));
                if (daysSinceSignIn > 90) {
                    staleAccounts.push({ user: user, days: daysSinceSignIn });
                }
            } else if (user.accountEnabled !== false) {
                neverSignedIn.push(user);
            }

            // Naming convention issues
            if (displayName) {
                // Check for all lowercase or all uppercase
                if (displayName === displayName.toLowerCase() || displayName === displayName.toUpperCase()) {
                    namingIssues.push({ user: user, issue: 'Case formatting' });
                }
                // Check for numbers in display name (often test accounts)
                if (/\d{3,}/.test(displayName)) {
                    namingIssues.push({ user: user, issue: 'Contains numbers' });
                }
                // Check for special characters that shouldn't be in names
                if (/[<>{}|\\^~\[\]`]/.test(displayName)) {
                    namingIssues.push({ user: user, issue: 'Special characters' });
                }

                // Track for duplicates (normalize name)
                var normalizedName = displayName.toLowerCase().trim();
                if (!nameMap[normalizedName]) {
                    nameMap[normalizedName] = [];
                }
                nameMap[normalizedName].push(user);
            }

            // Sync issues (on-premises sync problems)
            if (user.onPremisesSyncEnabled === true) {
                if (!user.onPremisesLastSyncDateTime) {
                    syncIssues.push({ user: user, issue: 'Never synced' });
                } else {
                    var syncDate = new Date(user.onPremisesLastSyncDateTime);
                    var daysSinceSync = Math.floor((now - syncDate) / (1000 * 60 * 60 * 24));
                    if (daysSinceSync > 3) {
                        syncIssues.push({ user: user, issue: 'Sync stale (' + daysSinceSync + ' days)', days: daysSinceSync });
                    }
                }
            }

            // Missing critical data
            var missingFields = [];
            if (!mail && user.accountEnabled !== false) missingFields.push('Email');
            if (!user.department) missingFields.push('Department');
            if (!user.jobTitle) missingFields.push('Job Title');
            if (!user.manager) missingFields.push('Manager');
            if (missingFields.length >= 3) {
                missingData.push({ user: user, missing: missingFields });
            }
        });

        // Find duplicates from name map
        Object.keys(nameMap).forEach(function(name) {
            if (nameMap[name].length > 1) {
                nameMap[name].forEach(function(u) {
                    potentialDuplicates.push({ user: u, duplicateCount: nameMap[name].length });
                });
            }
        });

        // Sort stale by days descending
        staleAccounts.sort(function(a, b) { return b.days - a.days; });

        var html = '';

        // Issues Breakdown Grid
        html += '<div class="analytics-section">';
        html += '<h3>Issues Breakdown</h3>';
        html += '<div class="analytics-grid">';

        // Stale Accounts Card
        html += '<div class="analytics-card">';
        html += '<h4>Stale Accounts</h4>';
        html += '<div class="platform-list">';
        html += '<div class="platform-row"><span class="platform-name">90-180 days</span><span class="platform-policies">' + staleAccounts.filter(function(s) { return s.days <= 180; }).length + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">180-365 days</span><span class="platform-policies">' + staleAccounts.filter(function(s) { return s.days > 180 && s.days <= 365; }).length + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">365+ days</span><span class="platform-policies">' + staleAccounts.filter(function(s) { return s.days > 365; }).length + '</span></div>';
        html += '</div></div>';

        // Data Completeness Card
        html += '<div class="analytics-card">';
        html += '<h4>Missing Data</h4>';
        html += '<div class="platform-list">';
        var missingEmail = users.filter(function(u) { return !u.mail && u.accountEnabled !== false; }).length;
        var missingDept = users.filter(function(u) { return !u.department; }).length;
        var missingTitle = users.filter(function(u) { return !u.jobTitle; }).length;
        html += '<div class="platform-row"><span class="platform-name">Missing Email</span><span class="platform-policies">' + missingEmail + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Missing Department</span><span class="platform-policies">' + missingDept + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Missing Job Title</span><span class="platform-policies">' + missingTitle + '</span></div>';
        html += '</div></div>';

        // Naming Issues Card
        html += '<div class="analytics-card">';
        html += '<h4>Naming Issues</h4>';
        html += '<div class="platform-list">';
        var caseIssues = namingIssues.filter(function(n) { return n.issue === 'Case formatting'; }).length;
        var numberIssues = namingIssues.filter(function(n) { return n.issue === 'Contains numbers'; }).length;
        var specialIssues = namingIssues.filter(function(n) { return n.issue === 'Special characters'; }).length;
        html += '<div class="platform-row"><span class="platform-name">Case formatting</span><span class="platform-policies">' + caseIssues + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Contains numbers</span><span class="platform-policies">' + numberIssues + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Special characters</span><span class="platform-policies">' + specialIssues + '</span></div>';
        html += '</div></div>';

        // Sync Status Card
        html += '<div class="analytics-card">';
        html += '<h4>Sync Health</h4>';
        html += '<div class="platform-list">';
        var syncEnabled = users.filter(function(u) { return u.onPremisesSyncEnabled === true; }).length;
        var cloudOnly = users.filter(function(u) { return u.onPremisesSyncEnabled !== true; }).length;
        html += '<div class="platform-row"><span class="platform-name">Synced from AD</span><span class="platform-policies">' + syncEnabled + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Cloud-only</span><span class="platform-policies">' + cloudOnly + '</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Sync problems</span><span class="platform-policies text-critical">' + syncIssues.length + '</span></div>';
        html += '</div></div>';

        html += '</div>'; // analytics-grid
        html += '</div>'; // analytics-section

        // Stale Accounts Table
        if (staleAccounts.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Stale Accounts (Top 20)</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Display Name</th><th>UPN</th><th>Last Sign-In</th><th>Days Stale</th><th>Department</th>';
            html += '</tr></thead><tbody>';

            staleAccounts.slice(0, 20).forEach(function(item) {
                var u = item.user;
                html += '<tr>';
                html += '<td>' + (u.displayName || '--') + '</td>';
                html += '<td>' + (u.userPrincipalName || '--') + '</td>';
                html += '<td>' + (u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString() : '--') + '</td>';
                html += '<td class="text-warning font-bold">' + item.days + '</td>';
                html += '<td>' + (u.department || '--') + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';
        }

        // Potential Duplicates Table
        if (potentialDuplicates.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Potential Duplicate Accounts</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Display Name</th><th>UPN</th><th>Email</th><th>Created</th>';
            html += '</tr></thead><tbody>';

            potentialDuplicates.slice(0, 20).forEach(function(item) {
                var u = item.user;
                html += '<tr>';
                html += '<td>' + (u.displayName || '--') + '</td>';
                html += '<td>' + (u.userPrincipalName || '--') + '</td>';
                html += '<td>' + (u.mail || '--') + '</td>';
                html += '<td>' + (u.createdDateTime ? new Date(u.createdDateTime).toLocaleDateString() : '--') + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';
        }

        // Healthy state
        if (staleAccounts.length === 0 && neverSignedIn.length === 0 && syncIssues.length === 0 && potentialDuplicates.length === 0) {
            html += '<div class="empty-state">';
            html += '<div class="empty-state-icon">\u2713</div>';
            html += '<div class="empty-state-title">Excellent Data Quality</div>';
            html += '<div class="empty-state-description">No significant data quality issues detected.</div>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    /**
     * Renders the Users tab with filters and data table.
     */
    function renderUsersTab(container) {
        container.textContent = '';

        // Filters
        var filterDiv = document.createElement('div');
        filterDiv.id = 'users-filter';
        container.appendChild(filterDiv);

        // Filter chips
        var chipsDiv = document.createElement('div');
        chipsDiv.id = 'users-filter-chips';
        container.appendChild(chipsDiv);

        // Group filter banner
        var groupBanner = document.createElement('div');
        groupBanner.id = 'users-group-filter-banner';
        groupBanner.className = 'group-filter-banner hidden';
        container.appendChild(groupBanner);

        // Table toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'table-toolbar';
        var colSelectorDiv = document.createElement('div');
        colSelectorDiv.id = 'users-col-selector';
        toolbar.appendChild(colSelectorDiv);
        container.appendChild(toolbar);

        // Data table
        var tableDiv = document.createElement('div');
        tableDiv.id = 'users-table';
        container.appendChild(tableDiv);

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'users-filter',
            controls: [
                { type: 'search', id: 'users-search', label: 'Search', placeholder: 'Search users...' },
                { type: 'select', id: 'users-domain', label: 'Domain', options: [
                    { value: 'all', label: 'All Domains' },
                    { value: 'employee', label: 'Employees' },
                    { value: 'student', label: 'Students' },
                    { value: 'other', label: 'Other' }
                ]},
                { type: 'select', id: 'users-status', label: 'Status', options: [
                    { value: 'all', label: 'All Status' },
                    { value: 'enabled', label: 'Enabled' },
                    { value: 'disabled', label: 'Disabled' }
                ]},
                { type: 'select', id: 'users-source', label: 'Source', options: [
                    { value: 'all', label: 'All Sources' },
                    { value: 'Cloud', label: 'Cloud' },
                    { value: 'On-premises synced', label: 'On-prem Synced' }
                ]},
                { type: 'checkbox-group', id: 'users-flags', label: 'Flags', options: [
                    { value: 'inactive', label: 'Inactive' },
                    { value: 'no-mfa', label: 'No MFA' },
                    { value: 'admin', label: 'Admin' }
                ]},
                { type: 'date-range', id: 'users-created-range', label: 'Created' },
                { type: 'date-range', id: 'users-signin-range', label: 'Last Sign-In' }
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
                    { key: 'managerUpn', label: 'Manager UPN' },
                    { key: 'usageLocation', label: 'Usage Location' },
                    { key: 'createdDateTime', label: 'Created' },
                    { key: 'accountAge', label: 'Account Age (days)' },
                    { key: 'lastSignIn', label: 'Last Sign-In' },
                    { key: 'lastNonInteractiveSignIn', label: 'Last Non-Interactive' },
                    { key: 'daysSinceLastSignIn', label: 'Days Inactive' },
                    { key: 'mfaRegistered', label: 'MFA' },
                    { key: 'licenseCount', label: 'Licenses' },
                    { key: 'deviceCount', label: 'Devices' },
                    { key: 'flags', label: 'Flags' },
                    { key: 'employeeId', label: 'Employee ID' },
                    { key: 'employeeType', label: 'Employee Type' },
                    { key: 'employeeHireDate', label: 'Hire Date' },
                    { key: 'employeeLeaveDateTime', label: 'Leave Date' },
                    { key: 'daysUntilLeave', label: 'Days Until Leave' },
                    { key: 'lastPasswordChange', label: 'Password Changed' },
                    { key: 'passwordAge', label: 'Password Age (days)' },
                    { key: 'passwordNeverExpires', label: 'Password Never Expires' },
                    { key: 'onPremSync', label: 'On-Prem Synced' },
                    { key: 'onPremLastSync', label: 'Last Sync' },
                    { key: 'onPremSyncAge', label: 'Sync Age (days)' },
                    { key: 'onPremSamAccountName', label: 'SAM Account' },
                    { key: 'mobilePhone', label: 'Mobile Phone' },
                    { key: 'businessPhones', label: 'Business Phones' },
                    { key: '_adminLinks', label: 'Admin' }
                ],
                defaultVisible: [
                    'displayName', 'userPrincipalName', 'domain', 'accountEnabled', 'department',
                    'lastSignIn', 'daysSinceLastSignIn', 'mfaRegistered', 'licenseCount', 'deviceCount', 'flags',
                    '_adminLinks'
                ],
                onColumnsChanged: applyFilters
            });
        }

        var hashParams = getHashParams();
        var searchSeed = hashParams.user || hashParams.upn || hashParams.search;
        if (searchSeed) {
            Filters.setValue('users-search', searchSeed);
        }

        setGroupFilterFromHash();

        // Bind export button
        Export.bindExportButton('users-table', 'users');

        // Initial render
        applyFilters();
    }

    /**
     * Renders the users page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var users = DataLoader.getData('users') || [];
        var summary = DataLoader.getSummary() || {};

        // Calculate stats
        var enabledCount = users.filter(function(u) { return u.accountEnabled; }).length;
        var disabledCount = users.filter(function(u) { return !u.accountEnabled; }).length;
        var mfaCount = users.filter(function(u) { return u.mfaRegistered; }).length;
        var noMfaCount = users.filter(function(u) { return !u.mfaRegistered; }).length;
        var inactiveCount = users.filter(function(u) { return u.isInactive; }).length;
        var cloudUsers = users.filter(function(u) { return u.userSource === 'Cloud'; }).length;
        var syncedUsers = users.filter(function(u) { return u.userSource === 'On-premises synced'; }).length;

        var total = users.length;
        var mfaPct = total > 0 ? Math.round((mfaCount / total) * 100) : 0;
        var enabledPct = total > 0 ? Math.round((enabledCount / total) * 100) : 0;

        // Cache state for tab rendering
        usersState = {
            users: users,
            summary: summary,
            stats: {
                total: total,
                enabledCount: enabledCount,
                disabledCount: disabledCount,
                mfaCount: mfaCount,
                noMfaCount: noMfaCount,
                inactiveCount: inactiveCount,
                cloudUsers: cloudUsers,
                syncedUsers: syncedUsers,
                mfaPct: mfaPct,
                enabledPct: enabledPct,
                employeeCount: summary.employeeCount || 0,
                studentCount: summary.studentCount || 0,
                otherCount: summary.otherCount || 0
            }
        };

        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Users';
        header.appendChild(h2);
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'All member accounts in your tenant';
        header.appendChild(desc);
        container.appendChild(header);

        // Summary cards with IDs for dynamic updates
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'summary-cards';
        cardsGrid.id = 'users-summary-cards';
        cardsGrid.appendChild(createSummaryCard('Total Users', summary.totalUsers || total, '', 'users-sum-total'));
        cardsGrid.appendChild(createSummaryCard('Employees', summary.employeeCount || 0, '', 'users-sum-employees'));
        cardsGrid.appendChild(createSummaryCard('Students', summary.studentCount || 0, '', 'users-sum-students'));
        cardsGrid.appendChild(createSummaryCard('Without MFA', noMfaCount, noMfaCount > 0 ? 'critical' : 'success', 'users-sum-nomfa'));
        container.appendChild(cardsGrid);

        // Tab bar
        var tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        var tabs = [
            { id: 'quality', label: 'Data Quality' },
            { id: 'users', label: 'All Users (' + total + ')' }
        ];
        tabs.forEach(function(t) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (t.id === 'users' ? ' active' : '');
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            tabBar.appendChild(btn);
        });
        container.appendChild(tabBar);

        // Content area
        var contentArea = document.createElement('div');
        contentArea.className = 'content-area';
        contentArea.id = 'users-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        var hashParams = getHashParams();
        var allowed = { quality: true, users: true };
        var initialTab = 'users';
        if (hashParams.tab && allowed[hashParams.tab]) {
            initialTab = hashParams.tab;
        } else if (hashParams.search || hashParams.user || hashParams.upn || hashParams.groupId || hashParams.groupName || hashParams.groupRole) {
            initialTab = 'users';
        }
        currentTab = initialTab;
        switchTab(currentTab);
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageUsers = PageUsers;
