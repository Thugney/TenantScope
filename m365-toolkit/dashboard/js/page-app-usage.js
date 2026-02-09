/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: APPLICATION USAGE
 *
 * Tracks which applications users sign into, with counts, sign-in types,
 * and department breakdown. Data sourced from /auditLogs/signIns.
 */

const PageAppUsage = (function() {
    'use strict';

    /**
     * Aggregates sign-in records by application.
     * Returns array of { appName, userCount, totalCount, interactiveCount,
     *   nonInteractiveCount, lastUsed, uniqueUsers }
     */
    function aggregateByApp(signIns) {
        var appMap = {};
        for (var i = 0; i < signIns.length; i++) {
            var s = signIns[i];
            var app = s.appDisplayName || '(unknown)';
            if (!appMap[app]) {
                appMap[app] = { appName: app, totalCount: 0, interactiveCount: 0, nonInteractiveCount: 0, users: {}, lastUsed: null };
            }
            appMap[app].totalCount++;
            if (s.isInteractive) {
                appMap[app].interactiveCount++;
            } else {
                appMap[app].nonInteractiveCount++;
            }
            if (s.userPrincipalName) {
                appMap[app].users[s.userPrincipalName] = true;
            }
            if (s.createdDateTime && (!appMap[app].lastUsed || s.createdDateTime > appMap[app].lastUsed)) {
                appMap[app].lastUsed = s.createdDateTime;
            }
        }

        var result = [];
        for (var key in appMap) {
            if (appMap.hasOwnProperty(key)) {
                var a = appMap[key];
                result.push({
                    appName: a.appName,
                    userCount: Object.keys(a.users).length,
                    totalCount: a.totalCount,
                    interactiveCount: a.interactiveCount,
                    nonInteractiveCount: a.nonInteractiveCount,
                    lastUsed: a.lastUsed
                });
            }
        }
        result.sort(function(a, b) { return b.userCount - a.userCount; });
        return result;
    }

    /**
     * Joins sign-in UPN to user department.
     */
    function enrichWithDepartment(signIns) {
        var users = DataLoader.getData('users');
        var userMap = {};
        for (var i = 0; i < users.length; i++) {
            userMap[users[i].userPrincipalName] = users[i];
        }

        var enriched = [];
        for (var j = 0; j < signIns.length; j++) {
            var s = signIns[j];
            var row = {};
            for (var k in s) {
                if (s.hasOwnProperty(k)) row[k] = s[k];
            }
            var user = userMap[s.userPrincipalName];
            row._department = user ? (user.department || '(empty)') : '(unknown)';
            row._company = user ? (user.companyName || '(empty)') : '(unknown)';
            row._city = user ? (user.city || '(empty)') : '(unknown)';
            row._officeLocation = user ? (user.officeLocation || '(empty)') : '(unknown)';
            row._domain = user ? (user.domain || '(empty)') : '(unknown)';
            enriched.push(row);
        }
        return enriched;
    }

    /**
     * Builds focus data: one row per app with userCount as the groupable field.
     */
    function buildAppFocusData(signIns) {
        // Create one entry per sign-in with appDisplayName for groupBy
        return signIns;
    }

    function render(container) {
        var allSignIns = DataLoader.getData('appSignins') || [];

        var page = document.createElement('div');
        page.className = 'page-section';

        var titleEl = document.createElement('h2');
        titleEl.className = 'section-title';
        titleEl.textContent = 'Application Usage';
        page.appendChild(titleEl);

        var descEl = document.createElement('p');
        descEl.className = 'section-description';
        descEl.textContent = 'Application inventory and sign-in analytics from Entra ID audit logs.';
        page.appendChild(descEl);

        // Summary cards
        var appAgg = aggregateByApp(allSignIns);
        var uniqueUsers = {};
        var interactiveTotal = 0;
        for (var i = 0; i < allSignIns.length; i++) {
            if (allSignIns[i].userPrincipalName) uniqueUsers[allSignIns[i].userPrincipalName] = true;
            if (allSignIns[i].isInteractive) interactiveTotal++;
        }
        var interactivePct = allSignIns.length > 0 ? Math.round((interactiveTotal / allSignIns.length) * 100) : 0;

        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';
        cardsGrid.appendChild(makeCard('Applications', appAgg.length.toString()));
        cardsGrid.appendChild(makeCard('Total Sign-ins', allSignIns.length.toLocaleString()));
        cardsGrid.appendChild(makeCard('Unique Users', Object.keys(uniqueUsers).length.toString()));
        cardsGrid.appendChild(makeCard('Interactive %', interactivePct + '%'));
        page.appendChild(cardsGrid);

        // App Inventory Section
        var inventorySection = document.createElement('div');
        inventorySection.className = 'subsection';
        inventorySection.style.marginTop = '24px';

        var inventoryTitle = document.createElement('h3');
        inventoryTitle.className = 'subsection-title';
        inventoryTitle.textContent = 'App Inventory';
        inventoryTitle.style.marginBottom = '12px';
        inventorySection.appendChild(inventoryTitle);

        var inventoryTableDiv = document.createElement('div');
        inventoryTableDiv.id = 'app-inventory-table';
        inventorySection.appendChild(inventoryTableDiv);
        page.appendChild(inventorySection);

        // Render App Inventory Table
        Tables.render({
            containerId: 'app-inventory-table',
            data: appAgg,
            columns: [
                { key: 'appName', label: 'Application Name', formatter: function(v) {
                    if (!v) return '--';
                    return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="View in Enterprise Apps"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
                }},
                { key: 'userCount', label: 'Users', className: 'cell-right' },
                { key: 'totalCount', label: 'Sign-ins', className: 'cell-right' },
                { key: 'interactiveCount', label: 'Interactive', className: 'cell-right' },
                { key: 'nonInteractiveCount', label: 'Non-Interactive', className: 'cell-right' },
                { key: 'lastUsed', label: 'Last Used', formatter: Tables.formatters.date },
                { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview" target="_blank" rel="noopener" class="admin-link" title="Open Enterprise Apps in Entra">Entra</a>';
                }}
            ],
            pageSize: 15,
            title: null
        });

        // Enrich data with department
        var enriched = enrichWithDepartment(allSignIns);

        // Focus/Breakdown row
        var fbRow = document.createElement('div');
        fbRow.className = 'focus-breakdown-row';

        var focusDiv = document.createElement('div');
        focusDiv.id = 'appusage-focus-table';
        fbRow.appendChild(focusDiv);

        var breakdownCol = document.createElement('div');
        var breakdownFilterDiv = document.createElement('div');
        breakdownFilterDiv.id = 'appusage-breakdown-filter';
        breakdownCol.appendChild(breakdownFilterDiv);
        var breakdownDiv = document.createElement('div');
        breakdownDiv.id = 'appusage-breakdown-table';
        breakdownCol.appendChild(breakdownDiv);
        fbRow.appendChild(breakdownCol);

        page.appendChild(fbRow);

        // Render Focus Table: app name -> count of sign-ins
        FocusTables.renderFocusTable({
            containerId: 'appusage-focus-table',
            data: enriched,
            groupByKey: 'appDisplayName',
            groupByLabel: 'Application',
            countLabel: 'Sign-ins'
        });

        // Render Breakdown
        var breakdownDimensions = [
            { key: '_department', label: 'Department' },
            { key: '_company', label: 'Company' },
            { key: '_city', label: 'City' },
            { key: '_officeLocation', label: 'Office' },
            { key: '_domain', label: 'Domain' }
        ];

        FocusTables.renderBreakdownFilter({
            containerId: 'appusage-breakdown-filter',
            dimensions: breakdownDimensions,
            selected: '_department',
            onChange: function(key) {
                FocusTables.renderBreakdownTable({
                    containerId: 'appusage-breakdown-table',
                    data: enriched,
                    primaryKey: 'appDisplayName',
                    breakdownKey: key,
                    primaryLabel: 'Application',
                    breakdownLabel: (breakdownDimensions.find(function(d) { return d.key === key; }) || {}).label || key
                });
            }
        });

        // Initial breakdown
        FocusTables.renderBreakdownTable({
            containerId: 'appusage-breakdown-table',
            data: enriched,
            primaryKey: 'appDisplayName',
            breakdownKey: '_department',
            primaryLabel: 'Application',
            breakdownLabel: 'Department'
        });

        // Filter bar
        var filterDiv = document.createElement('div');
        filterDiv.id = 'appusage-filters';
        page.appendChild(filterDiv);

        // Column selector
        var colSelDiv = document.createElement('div');
        colSelDiv.id = 'appusage-column-selector';
        colSelDiv.style.marginBottom = '8px';
        colSelDiv.style.textAlign = 'right';
        page.appendChild(colSelDiv);

        // Detail table
        var tableDiv = document.createElement('div');
        tableDiv.id = 'appusage-table';
        page.appendChild(tableDiv);

        container.appendChild(page);

        // Build app list for filter dropdown
        var appNames = [];
        var appSet = {};
        for (var a = 0; a < allSignIns.length; a++) {
            var name = allSignIns[a].appDisplayName || '(unknown)';
            if (!appSet[name]) {
                appSet[name] = true;
                appNames.push(name);
            }
        }
        appNames.sort();
        var appOptions = [{ value: 'all', label: 'All Applications' }];
        for (var ao = 0; ao < appNames.length; ao++) {
            appOptions.push({ value: appNames[ao], label: appNames[ao] });
        }

        Filters.createFilterBar({
            containerId: 'appusage-filters',
            controls: [
                { type: 'search', id: 'appusage-search', placeholder: 'Search sign-ins...' },
                {
                    type: 'select', id: 'appusage-type', label: 'Sign-in Type',
                    options: [
                        { value: 'all', label: 'All Types' },
                        { value: 'interactive', label: 'Interactive' },
                        { value: 'non-interactive', label: 'Non-interactive' }
                    ]
                },
                {
                    type: 'select', id: 'appusage-status', label: 'Status',
                    options: [
                        { value: 'all', label: 'All Statuses' },
                        { value: 'success', label: 'Success' },
                        { value: 'failure', label: 'Failure' }
                    ]
                },
                {
                    type: 'select', id: 'appusage-app', label: 'Application',
                    options: appOptions
                }
            ],
            onFilter: applyFilters
        });

        // Column Selector
        var allCols = [
            { key: 'appDisplayName', label: 'Application' },
            { key: 'resourceDisplayName', label: 'Resource' },
            { key: 'userPrincipalName', label: 'User' },
            { key: '_department', label: 'Department' },
            { key: 'createdDateTime', label: 'Date' },
            { key: 'isInteractive', label: 'Interactive' },
            { key: 'statusCode', label: 'Status Code' },
            { key: 'statusReason', label: 'Status' },
            { key: 'city', label: 'City' },
            { key: 'country', label: 'Country' }
        ];
        var defaultCols = ['appDisplayName', 'userPrincipalName', '_department', 'createdDateTime', 'isInteractive', 'statusReason'];

        ColumnSelector.create({
            containerId: 'appusage-column-selector',
            storageKey: 'tenantscope-appusage-columns',
            allColumns: allCols,
            defaultVisible: defaultCols,
            onColumnsChanged: function() { applyFilters(); }
        });

        // Wire export
        var exportBtn = document.getElementById('appusage-filters-export');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                var data = getFilteredData();
                var columns = [
                    { key: 'appDisplayName', label: 'Application' },
                    { key: 'resourceDisplayName', label: 'Resource' },
                    { key: 'userPrincipalName', label: 'User' },
                    { key: '_department', label: 'Department' },
                    { key: 'createdDateTime', label: 'Date' },
                    { key: 'isInteractive', label: 'Interactive' },
                    { key: 'statusCode', label: 'Status Code' },
                    { key: 'statusReason', label: 'Status' },
                    { key: 'city', label: 'City' },
                    { key: 'country', label: 'Country' }
                ];
                Export.toCSV(data, columns, 'app-signins.csv');
            });
        }

        // Store enriched data for filtering
        window._appUsageEnriched = enriched;

        // Initial render
        applyFilters();
    }

    function getFilteredData() {
        var enriched = window._appUsageEnriched || [];
        var searchVal = Filters.getValue('appusage-search');
        var typeVal = Filters.getValue('appusage-type');
        var statusVal = Filters.getValue('appusage-status');
        var appVal = Filters.getValue('appusage-app');

        var filterConfig = {
            search: searchVal,
            searchFields: ['appDisplayName', 'userPrincipalName', 'resourceDisplayName', 'statusReason']
        };

        if (appVal && appVal !== 'all') {
            filterConfig.exact = { appDisplayName: appVal };
        }

        var filtered = Filters.apply(enriched, filterConfig);

        // Manual filters for type and status
        if (typeVal === 'interactive') {
            filtered = filtered.filter(function(r) { return r.isInteractive === true; });
        } else if (typeVal === 'non-interactive') {
            filtered = filtered.filter(function(r) { return r.isInteractive === false; });
        }

        if (statusVal === 'success') {
            filtered = filtered.filter(function(r) { return r.statusCode === 0; });
        } else if (statusVal === 'failure') {
            filtered = filtered.filter(function(r) { return r.statusCode !== 0; });
        }

        return filtered;
    }

    function applyFilters() {
        var filtered = getFilteredData();
        renderDetailTable(filtered);
    }

    function renderDetailTable(data) {
        // Get visible columns
        var visibleKeys = [];
        try {
            var saved = localStorage.getItem('tenantscope-appusage-columns');
            if (saved) visibleKeys = JSON.parse(saved);
        } catch (e) {}
        if (!visibleKeys || visibleKeys.length === 0) {
            visibleKeys = ['appDisplayName', 'userPrincipalName', '_department', 'createdDateTime', 'isInteractive', 'statusReason'];
        }

        var columnMap = {
            'appDisplayName':      { key: 'appDisplayName', label: 'Application', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#enterprise-apps?search=' + encodeURIComponent(v) + '" class="entity-link" onclick="event.stopPropagation();" title="View in Enterprise Apps">' + Tables.escapeHtml(v) + '</a>';
            }},
            'resourceDisplayName': { key: 'resourceDisplayName', label: 'Resource' },
            'userPrincipalName':   { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            '_department':         { key: '_department', label: 'Department' },
            'createdDateTime':     { key: 'createdDateTime', label: 'Date', formatter: Tables.formatters.date },
            'isInteractive':       { key: 'isInteractive', label: 'Interactive', formatter: formatInteractive },
            'statusCode':          { key: 'statusCode', label: 'Status Code' },
            'statusReason':        { key: 'statusReason', label: 'Status', formatter: formatStatus },
            'city':                { key: 'city', label: 'City' },
            'country':             { key: 'country', label: 'Country' },
            '_adminLinks':         { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview" target="_blank" rel="noopener" class="admin-link" title="Open Enterprise Apps in Entra">Entra</a>';
            }}
        };

        var columns = [];
        for (var c = 0; c < visibleKeys.length; c++) {
            if (columnMap[visibleKeys[c]]) {
                columns.push(columnMap[visibleKeys[c]]);
            }
        }
        // Always append admin links column at the end
        columns.push(columnMap['_adminLinks']);

        Tables.render({
            containerId: 'appusage-table',
            data: data,
            columns: columns,
            pageSize: 50
        });
    }

    function formatInteractive(value) {
        if (value) {
            return '<span class="status-badge status-badge-success">Yes</span>';
        }
        return '<span class="status-badge status-badge-neutral">No</span>';
    }

    function formatStatus(value, row) {
        if (row && row.statusCode === 0) {
            return '<span class="status-badge status-badge-success">Success</span>';
        }
        var text = value || 'Failed';
        return '<span class="status-badge status-badge-critical">' + text + '</span>';
    }

    function makeCard(title, value) {
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
        return card;
    }

    return {
        render: render
    };

})();

window.PageAppUsage = PageAppUsage;
