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
     * Helper to create elements.
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    /**
     * Renders the Data Quality page.
     */
    function render(container) {
        // Get users (apply department filter if active)
        var allUsers = DataLoader.getData('users');
        var users = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterData(allUsers, 'department') : allUsers;

        container.textContent = '';

        // Page header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Data Quality'));
        header.appendChild(el('p', 'page-description', 'Identify gaps in user profile data - which fields are missing and where'));
        container.appendChild(header);

        // Summary cards
        var stats = computeStats(users);
        var fullyCompletePct = users.length > 0 ? Math.round((stats.fullyComplete / users.length) * 100) : 0;

        var cards = el('div', 'summary-cards');
        cards.appendChild(createCard('Total Users', users.length.toLocaleString(), 'primary'));
        cards.appendChild(createCard('Avg Completeness', stats.avgPct + '%', stats.avgPct >= 80 ? 'success' : (stats.avgPct >= 60 ? 'warning' : 'critical')));
        cards.appendChild(createCard('Fully Complete', stats.fullyComplete.toLocaleString() + ' (' + fullyCompletePct + '%)', fullyCompletePct >= 50 ? 'success' : 'warning'));
        cards.appendChild(createCard('Fields Below 80%', stats.belowThreshold.toString(), stats.belowThreshold === 0 ? 'success' : 'warning'));
        container.appendChild(cards);

        // Insights section
        var insightsSection = el('div', 'insights-list');
        renderInsights(insightsSection, stats, users);
        container.appendChild(insightsSection);

        // Analytics section with focus and breakdown tables
        var analyticsSection = el('div', 'analytics-section');
        analyticsSection.appendChild(el('h3', null, 'Property Analysis'));

        var fbRow = el('div', 'focus-breakdown-row');

        var focusPanel = el('div', 'focus-panel');
        focusPanel.id = 'dq-focus-table';
        fbRow.appendChild(focusPanel);

        var breakdownPanel = el('div', 'breakdown-panel');
        var breakdownFilterDiv = el('div');
        breakdownFilterDiv.id = 'dq-breakdown-filter';
        breakdownPanel.appendChild(breakdownFilterDiv);
        var breakdownDiv = el('div');
        breakdownDiv.id = 'dq-breakdown-table';
        breakdownPanel.appendChild(breakdownDiv);
        fbRow.appendChild(breakdownPanel);

        analyticsSection.appendChild(fbRow);
        container.appendChild(analyticsSection);

        // User Details section
        var tableSection = el('div', 'table-section');
        var tableHeader = el('div', 'table-header');
        tableHeader.appendChild(el('h3', 'table-title', 'User Profile Details'));
        var tableActions = el('div', 'table-actions');
        var exportBtn = el('button', 'btn btn-secondary', 'Export CSV');
        exportBtn.id = 'dq-export-btn';
        tableActions.appendChild(exportBtn);
        tableHeader.appendChild(tableActions);
        tableSection.appendChild(tableHeader);

        // Filter bar container
        var filterDiv = el('div');
        filterDiv.id = 'dq-filters';
        tableSection.appendChild(filterDiv);

        // Column selector container
        var colSelDiv = el('div', 'column-selector-wrap');
        colSelDiv.id = 'dq-column-selector';
        tableSection.appendChild(colSelDiv);

        // Detail table
        var tableDiv = el('div');
        tableDiv.id = 'dq-table';
        tableSection.appendChild(tableDiv);

        container.appendChild(tableSection);

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
        document.getElementById('dq-export-btn').addEventListener('click', function() {
            var data = getFilteredUsers();
            var exportData = data.map(function(user) {
                var filled = 0;
                for (var f = 0; f < PROFILE_FIELDS.length; f++) {
                    if (hasValue(user[PROFILE_FIELDS[f].key])) filled++;
                }
                var pct = PROFILE_FIELDS.length > 0 ? Math.round((filled / PROFILE_FIELDS.length) * 100) : 0;
                return {
                    displayName: user.displayName,
                    userPrincipalName: user.userPrincipalName,
                    domain: user.domain,
                    department: user.department,
                    jobTitle: user.jobTitle,
                    companyName: user.companyName,
                    officeLocation: user.officeLocation,
                    city: user.city,
                    country: user.country,
                    mobilePhone: user.mobilePhone,
                    manager: user.manager,
                    mail: user.mail,
                    usageLocation: user.usageLocation,
                    userSource: user.userSource,
                    completeness: pct + '%'
                };
            });
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
                { key: 'completeness', label: 'Completeness %' }
            ];
            Export.toCSV(exportData, columns, 'tenantscope-data-quality.csv');
        });

        // Initial render
        applyFilters();
    }

    /**
     * Creates a summary card.
     */
    function createCard(label, value, variant) {
        var card = el('div', 'summary-card card-' + variant);
        card.appendChild(el('div', 'card-value', value));
        card.appendChild(el('div', 'card-label', label));
        return card;
    }

    /**
     * Renders insights based on data quality stats.
     */
    function renderInsights(container, stats, users) {
        container.textContent = '';

        // Find fields with lowest completeness
        var lowFields = stats.fieldStats.filter(function(f) { return f.pct < 80; })
            .sort(function(a, b) { return a.pct - b.pct; });

        var criticalFields = stats.fieldStats.filter(function(f) { return f.pct < 50; });

        // Critical fields insight
        if (criticalFields.length > 0) {
            var fieldNames = criticalFields.slice(0, 3).map(function(f) { return f.label + ' (' + f.pct + '%)'; }).join(', ');
            container.appendChild(createInsightCard('critical', 'CRITICAL', 'Low Data Coverage',
                criticalFields.length + ' field' + (criticalFields.length !== 1 ? 's have' : ' has') + ' less than 50% completion: ' + fieldNames,
                'Prioritize populating these fields for accurate reporting and governance.'));
        }

        // Warning fields insight
        var warningFields = stats.fieldStats.filter(function(f) { return f.pct >= 50 && f.pct < 80; });
        if (warningFields.length > 0) {
            var warnNames = warningFields.slice(0, 3).map(function(f) { return f.label + ' (' + f.pct + '%)'; }).join(', ');
            container.appendChild(createInsightCard('warning', 'ATTENTION', 'Incomplete Fields',
                warningFields.length + ' field' + (warningFields.length !== 1 ? 's are' : ' is') + ' between 50-80% complete: ' + warnNames,
                'Review and update user profiles to improve data quality.'));
        }

        // Fully complete insight
        var fullyCompletePct = users.length > 0 ? Math.round((stats.fullyComplete / users.length) * 100) : 0;
        if (fullyCompletePct < 50) {
            container.appendChild(createInsightCard('warning', 'GOVERNANCE', 'Profile Completion',
                'Only ' + fullyCompletePct + '% of users have fully complete profiles (' + stats.fullyComplete + ' of ' + users.length + ').',
                'Consider implementing profile completion requirements or automated data sync.'));
        }

        // Good state
        if (stats.avgPct >= 90 && stats.belowThreshold === 0) {
            container.appendChild(createInsightCard('success', 'HEALTHY', 'Data Quality',
                'Excellent data quality! Average completeness is ' + stats.avgPct + '% with all fields above 80%.',
                null));
        }
    }

    /**
     * Creates an insight card.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = el('div', 'insight-card insight-' + type);
        var header = el('div', 'insight-header');
        header.appendChild(el('span', 'badge badge-' + type, badge));
        header.appendChild(el('span', 'insight-category', category));
        card.appendChild(header);
        card.appendChild(el('p', 'insight-description', description));
        if (action) {
            var actionP = el('p', 'insight-action');
            actionP.appendChild(el('strong', null, 'Action: '));
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
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
     * Renders the Focus Table showing property completeness with visual cards.
     */
    function renderPropertyFocusTable(fieldStats) {
        var container = document.getElementById('dq-focus-table');
        if (!container) return;
        container.textContent = '';

        var wrapper = el('div', 'dq-property-panel');

        // Header with title
        var header = el('div', 'dq-panel-header');
        header.appendChild(el('h4', 'dq-panel-title', 'Profile Fields'));
        header.appendChild(el('p', 'dq-panel-subtitle', 'Checking: department, job title, company, office, city, country, mobile, manager, email, usage location'));
        wrapper.appendChild(header);

        // Sort fields by completeness (lowest first for attention)
        var sortedStats = fieldStats.slice().sort(function(a, b) { return a.pct - b.pct; });

        // Property cards grid
        var cardsGrid = el('div', 'dq-field-cards');

        for (var i = 0; i < sortedStats.length; i++) {
            var fs = sortedStats[i];
            var statusClass = fs.pct >= 90 ? 'success' : (fs.pct >= 70 ? 'warning' : 'critical');

            var card = el('div', 'dq-field-card dq-field-card--' + statusClass);

            // Progress ring
            var ringWrap = el('div', 'dq-field-ring');
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 36 36');
            svg.setAttribute('class', 'dq-ring-svg');

            // Background circle
            var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bgCircle.setAttribute('cx', '18');
            bgCircle.setAttribute('cy', '18');
            bgCircle.setAttribute('r', '15.9');
            bgCircle.setAttribute('fill', 'none');
            bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
            bgCircle.setAttribute('stroke-width', '3');
            svg.appendChild(bgCircle);

            // Progress circle
            var progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            progressCircle.setAttribute('cx', '18');
            progressCircle.setAttribute('cy', '18');
            progressCircle.setAttribute('r', '15.9');
            progressCircle.setAttribute('fill', 'none');
            progressCircle.setAttribute('stroke', 'var(--color-' + statusClass + ')');
            progressCircle.setAttribute('stroke-width', '3');
            progressCircle.setAttribute('stroke-linecap', 'round');
            var circumference = 2 * Math.PI * 15.9;
            var dashOffset = circumference - (fs.pct / 100) * circumference;
            progressCircle.setAttribute('stroke-dasharray', circumference);
            progressCircle.setAttribute('stroke-dashoffset', dashOffset);
            progressCircle.setAttribute('transform', 'rotate(-90 18 18)');
            svg.appendChild(progressCircle);

            ringWrap.appendChild(svg);

            // Percentage in center
            var pctLabel = el('span', 'dq-ring-pct', fs.pct + '%');
            ringWrap.appendChild(pctLabel);
            card.appendChild(ringWrap);

            // Field info - descriptive label
            var infoWrap = el('div', 'dq-field-info');
            var fieldDesc = fs.pct + '% have ' + fs.label.toLowerCase();
            infoWrap.appendChild(el('div', 'dq-field-name', fieldDesc));
            var missingCount = fs.total - fs.filled;
            var missingText = missingCount > 0 ? missingCount.toLocaleString() + ' missing' : 'All filled';
            infoWrap.appendChild(el('div', 'dq-field-count', missingText));
            card.appendChild(infoWrap);

            cardsGrid.appendChild(card);
        }

        wrapper.appendChild(cardsGrid);
        container.appendChild(wrapper);
    }

    /**
     * Renders the Breakdown section: completeness by department/company/etc.
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

        function computeGroupStats(groupUsers) {
            var sumPct = 0;
            for (var f = 0; f < PROFILE_FIELDS.length; f++) {
                var filled = 0;
                for (var u = 0; u < groupUsers.length; u++) {
                    if (hasValue(groupUsers[u][PROFILE_FIELDS[f].key])) filled++;
                }
                var pct = groupUsers.length > 0 ? (filled / groupUsers.length) * 100 : 0;
                sumPct += pct;
            }
            return Math.round(sumPct / PROFILE_FIELDS.length);
        }

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

            // Sort groups by size descending, limit to top 10
            var groupKeys = Object.keys(groups).sort(function(a, b) {
                return groups[b].length - groups[a].length;
            });
            if (groupKeys.length > 10) groupKeys = groupKeys.slice(0, 10);

            var dimLabel = '';
            for (var d = 0; d < dimensions.length; d++) {
                if (dimensions[d].key === dimKey) { dimLabel = dimensions[d].label; break; }
            }

            var wrapper = el('div', 'dq-breakdown-panel');

            var header = el('div', 'dq-panel-header');
            header.appendChild(el('h4', 'dq-panel-title', 'Compare by ' + dimLabel));
            header.appendChild(el('p', 'dq-panel-subtitle', 'Average profile completeness (all 10 fields) per ' + dimLabel.toLowerCase()));
            wrapper.appendChild(header);

            // Group cards list
            var groupsList = el('div', 'dq-groups-list');

            for (var g = 0; g < groupKeys.length; g++) {
                var groupName = groupKeys[g];
                var groupUsers = groups[groupName];
                var avgPct = computeGroupStats(groupUsers);
                var statusClass = avgPct >= 90 ? 'success' : (avgPct >= 70 ? 'warning' : 'critical');

                var groupCard = el('div', 'dq-group-row');

                // Group info
                var groupInfo = el('div', 'dq-group-info');
                var nameEl = el('div', 'dq-group-name', groupName);
                nameEl.title = groupName;
                groupInfo.appendChild(nameEl);
                groupInfo.appendChild(el('div', 'dq-group-count', groupUsers.length.toLocaleString() + ' users'));
                groupCard.appendChild(groupInfo);

                // Progress bar
                var barWrap = el('div', 'dq-group-bar-wrap');
                var barTrack = el('div', 'dq-group-bar-track');
                var barFill = el('div', 'dq-group-bar-fill dq-bar--' + statusClass);
                barFill.style.width = avgPct + '%';
                barTrack.appendChild(barFill);
                barWrap.appendChild(barTrack);
                groupCard.appendChild(barWrap);

                // Percentage badge
                var pctBadge = el('div', 'dq-group-pct dq-pct--' + statusClass, avgPct + '%');
                groupCard.appendChild(pctBadge);

                groupsList.appendChild(groupCard);
            }

            if (groupKeys.length === 0) {
                groupsList.appendChild(el('div', 'dq-empty-state', 'No data available'));
            }

            wrapper.appendChild(groupsList);
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
    /**
     * Deep clone a value to prevent modifications to original data
     */
    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(deepClone);
        var clone = {};
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                clone[key] = deepClone(obj[key]);
            }
        }
        return clone;
    }

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
            // Deep copy to prevent modifications to original DataStore data
            var row = deepClone(user);
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
            var bfValue = user[bf.key];  // Read property once to avoid duplicate access
            var tr = document.createElement('tr');
            var td1 = document.createElement('td');
            td1.textContent = bf.label;
            td1.style.fontWeight = '600';
            var td2 = document.createElement('td');
            td2.textContent = String(bfValue !== null && bfValue !== undefined ? bfValue : '-');
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

    return {
        render: render
    };

})();

window.PageDataQuality = PageDataQuality;
