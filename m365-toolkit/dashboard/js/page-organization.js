/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: ORGANIZATION
 *
 * Renders the organization hierarchy page showing management structure,
 * span of control, orphan users, and department analysis.
 */

const PageOrganization = (function() {
    'use strict';

    /**
     * Analyzes the organization hierarchy from user data.
     *
     * @param {Array} users - All user data
     * @returns {Object} Hierarchy analysis
     */
    function analyzeHierarchy(users) {
        var managerMap = {};
        var orphanUsers = [];
        var allManagers = new Set();

        users.forEach(function(u) {
            if (u.manager) {
                allManagers.add(u.manager);
            }
        });

        users.forEach(function(u) {
            var mgrName = u.manager || null;
            if (!mgrName) {
                if (!allManagers.has(u.displayName)) {
                    orphanUsers.push(u);
                }
            } else {
                if (!managerMap[mgrName]) {
                    managerMap[mgrName] = {
                        name: mgrName,
                        directReports: [],
                        department: null,
                        isUser: false,
                        userData: null
                    };
                }
                managerMap[mgrName].directReports.push(u);
            }
        });

        users.forEach(function(u) {
            if (managerMap[u.displayName]) {
                managerMap[u.displayName].isUser = true;
                managerMap[u.displayName].userData = u;
                managerMap[u.displayName].department = u.department;
            }
        });

        var spanBuckets = { '0': 0, '1-3': 0, '4-7': 0, '8-15': 0, '16+': 0 };
        var managerList = Object.values(managerMap);

        managerList.forEach(function(m) {
            var count = m.directReports.length;
            if (count === 0) spanBuckets['0']++;
            else if (count <= 3) spanBuckets['1-3']++;
            else if (count <= 7) spanBuckets['4-7']++;
            else if (count <= 15) spanBuckets['8-15']++;
            else spanBuckets['16+']++;
        });

        var deptAnalysis = {};
        users.forEach(function(u) {
            var dept = u.department || 'Unassigned';
            if (!deptAnalysis[dept]) {
                deptAnalysis[dept] = {
                    name: dept,
                    totalUsers: 0,
                    managers: new Set(),
                    withManager: 0,
                    withoutManager: 0,
                    mfaEnabled: 0,
                    inactive: 0,
                    disabled: 0
                };
            }
            deptAnalysis[dept].totalUsers++;
            if (u.manager) {
                deptAnalysis[dept].withManager++;
                deptAnalysis[dept].managers.add(u.manager);
            } else if (!allManagers.has(u.displayName)) {
                deptAnalysis[dept].withoutManager++;
            }
            if (u.mfaRegistered) deptAnalysis[dept].mfaEnabled++;
            if (u.isInactive) deptAnalysis[dept].inactive++;
            if (!u.accountEnabled) deptAnalysis[dept].disabled++;
        });

        Object.values(deptAnalysis).forEach(function(d) {
            d.managerCount = d.managers.size;
            delete d.managers;
        });

        return {
            managers: managerList.sort(function(a, b) {
                return b.directReports.length - a.directReports.length;
            }),
            orphanUsers: orphanUsers,
            spanBuckets: spanBuckets,
            totalManagers: managerList.length,
            totalOrphans: orphanUsers.length,
            departments: Object.values(deptAnalysis).sort(function(a, b) {
                return b.totalUsers - a.totalUsers;
            })
        };
    }

    /**
     * Creates an element with text content.
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    /**
     * Renders the page.
     */
    function render(container) {
        var users = DataLoader.getData('users') || [];
        if (typeof DepartmentFilter !== 'undefined') {
            users = DepartmentFilter.filterData(users, 'department');
        }

        var hierarchy = analyzeHierarchy(users);
        container.textContent = '';

        // Page header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Organization Structure'));
        header.appendChild(el('p', 'page-description', 'Management hierarchy, span of control, and department analysis'));
        container.appendChild(header);

        // Summary cards
        var cards = el('div', 'summary-cards');
        cards.appendChild(createCard('Total Users', users.length, 'primary'));
        cards.appendChild(createCard('Managers', hierarchy.totalManagers, 'info'));
        cards.appendChild(createCard('Orphan Users', hierarchy.totalOrphans, hierarchy.totalOrphans > 0 ? 'warning' : 'success'));
        cards.appendChild(createCard('Departments', hierarchy.departments.length, 'secondary'));
        container.appendChild(cards);

        // Charts
        var chartsGrid = el('div', 'charts-grid');
        var spanChartCard = el('div', 'chart-card');
        spanChartCard.appendChild(el('h3', 'chart-title', 'Span of Control Distribution'));
        var spanChartDiv = el('div');
        spanChartDiv.id = 'span-chart';
        spanChartCard.appendChild(spanChartDiv);
        chartsGrid.appendChild(spanChartCard);

        var deptChartCard = el('div', 'chart-card');
        deptChartCard.appendChild(el('h3', 'chart-title', 'Manager Coverage by Department'));
        var deptChartDiv = el('div');
        deptChartDiv.id = 'dept-coverage-chart';
        deptChartCard.appendChild(deptChartDiv);
        chartsGrid.appendChild(deptChartCard);
        container.appendChild(chartsGrid);

        // Alert for orphan users
        if (hierarchy.totalOrphans > 0) {
            var alert = el('div', 'alert-box alert-warning');
            var strong = el('strong', null, 'Governance Alert: ');
            alert.appendChild(strong);
            alert.appendChild(document.createTextNode(hierarchy.totalOrphans + ' users have no manager assigned. This creates visibility gaps for access reviews and reporting chains.'));
            container.appendChild(alert);
        }

        // Focus/Breakdown section
        var fbRow = el('div', 'focus-breakdown-row');
        var focusPanel = el('div', 'focus-panel');
        focusPanel.appendChild(el('h3', 'panel-title', 'Focus: Managers by Direct Reports'));
        var focusTable = el('div');
        focusTable.id = 'manager-focus-table';
        focusPanel.appendChild(focusTable);
        fbRow.appendChild(focusPanel);

        var breakdownPanel = el('div', 'breakdown-panel');
        breakdownPanel.appendChild(el('h3', 'panel-title', 'Breakdown: Department Analysis'));
        var breakdownTable = el('div');
        breakdownTable.id = 'dept-breakdown-table';
        breakdownPanel.appendChild(breakdownTable);
        fbRow.appendChild(breakdownPanel);
        container.appendChild(fbRow);

        // Managers table section
        var mgrSection = el('div', 'table-section');
        var mgrHeader = el('div', 'table-header');
        mgrHeader.appendChild(el('h3', 'table-title', 'Managers'));
        var mgrActions = el('div', 'table-actions');
        var exportMgrBtn = el('button', 'btn btn-secondary', 'Export CSV');
        exportMgrBtn.id = 'export-managers-btn';
        mgrActions.appendChild(exportMgrBtn);
        mgrHeader.appendChild(mgrActions);
        mgrSection.appendChild(mgrHeader);
        var mgrTableDiv = el('div');
        mgrTableDiv.id = 'managers-table';
        mgrSection.appendChild(mgrTableDiv);
        container.appendChild(mgrSection);

        // Orphan users table
        if (hierarchy.totalOrphans > 0) {
            var orphanSection = el('div', 'table-section');
            var orphanHeader = el('div', 'table-header');
            orphanHeader.appendChild(el('h3', 'table-title', 'Users Without Manager (' + hierarchy.totalOrphans + ')'));
            var exportOrphanBtn = el('button', 'btn btn-secondary', 'Export CSV');
            exportOrphanBtn.id = 'export-orphans-btn';
            orphanHeader.appendChild(exportOrphanBtn);
            orphanSection.appendChild(orphanHeader);
            var orphanTableDiv = el('div');
            orphanTableDiv.id = 'orphans-table';
            orphanSection.appendChild(orphanTableDiv);
            container.appendChild(orphanSection);
        }

        // Render charts
        renderSpanChart(hierarchy.spanBuckets);
        renderDeptCoverageChart(hierarchy.departments);
        renderManagerFocus(hierarchy.managers);
        renderDeptBreakdown(hierarchy.departments);
        renderManagersTable(hierarchy.managers);
        if (hierarchy.totalOrphans > 0) {
            renderOrphansTable(hierarchy.orphanUsers);
        }

        // Export buttons
        document.getElementById('export-managers-btn').addEventListener('click', function() {
            var exportData = hierarchy.managers.map(function(m) {
                return {
                    Manager: m.name,
                    Department: m.department || '',
                    DirectReports: m.directReports.length,
                    InTenant: m.isUser ? 'Yes' : 'No'
                };
            });
            Export.toCSV(exportData, 'tenantscope-managers.csv');
        });

        var orphanBtn = document.getElementById('export-orphans-btn');
        if (orphanBtn) {
            orphanBtn.addEventListener('click', function() {
                var exportData = hierarchy.orphanUsers.map(function(u) {
                    return {
                        Name: u.displayName,
                        Email: u.userPrincipalName,
                        Department: u.department || '',
                        JobTitle: u.jobTitle || '',
                        Status: u.accountEnabled ? 'Enabled' : 'Disabled'
                    };
                });
                Export.toCSV(exportData, 'tenantscope-orphan-users.csv');
            });
        }
    }

    function createCard(label, value, variant) {
        var card = el('div', 'summary-card card-' + variant);
        card.appendChild(el('div', 'card-value', (value || 0).toLocaleString()));
        card.appendChild(el('div', 'card-label', label));
        return card;
    }

    function renderSpanChart(buckets) {
        var container = document.getElementById('span-chart');
        if (!container) return;

        var data = [
            { label: '1-3 reports', value: buckets['1-3'], color: '#10b981' },
            { label: '4-7 reports', value: buckets['4-7'], color: '#3b82f6' },
            { label: '8-15 reports', value: buckets['8-15'], color: '#f59e0b' },
            { label: '16+ reports', value: buckets['16+'], color: '#ef4444' }
        ].filter(function(d) { return d.value > 0; });

        if (data.length === 0) {
            container.appendChild(el('div', 'empty-state-small', 'No managers found'));
            return;
        }

        if (typeof DashboardCharts !== 'undefined') {
            DashboardCharts.renderDonut(container, data, {
                size: 180, showLegend: true, showTotal: true, totalLabel: 'Managers'
            });
        }
    }

    function renderDeptCoverageChart(departments) {
        var container = document.getElementById('dept-coverage-chart');
        if (!container) return;

        var top5 = departments.slice(0, 5);
        var colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

        var data = top5.map(function(d, i) {
            var pct = d.totalUsers > 0 ? Math.round((d.withManager / d.totalUsers) * 100) : 0;
            return { label: d.name + ' (' + pct + '%)', value: d.withManager, color: colors[i % colors.length] };
        });

        if (data.length === 0) {
            container.appendChild(el('div', 'empty-state-small', 'No department data'));
            return;
        }

        if (typeof DashboardCharts !== 'undefined') {
            DashboardCharts.renderDonut(container, data, {
                size: 180, showLegend: true, showTotal: true, totalLabel: 'With Mgr'
            });
        }
    }

    function renderManagerFocus(managers) {
        var container = document.getElementById('manager-focus-table');
        if (!container) return;

        // Add spanBucket property to each manager for grouping
        var dataWithBucket = managers.map(function(m) {
            var count = m.directReports.length;
            var bucket = count === 0 ? '0 reports' : count <= 3 ? '1-3 reports' : count <= 7 ? '4-7 reports' : count <= 15 ? '8-15 reports' : '16+ reports';
            return { spanBucket: bucket };
        });

        if (typeof FocusTables !== 'undefined') {
            FocusTables.renderFocusTable({
                containerId: 'manager-focus-table',
                data: dataWithBucket,
                groupByKey: 'spanBucket',
                groupByLabel: 'Span of Control',
                countLabel: 'Managers'
            });
        }
    }

    function renderDeptBreakdown(departments) {
        var container = document.getElementById('dept-breakdown-table');
        if (!container) return;

        var table = document.createElement('table');
        table.className = 'data-table breakdown-table';

        var thead = document.createElement('thead');
        var headerRow = document.createElement('tr');
        ['Department', 'Users', 'Managers', 'With Mgr', 'Orphans', 'MFA %'].forEach(function(text) {
            var th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        var totals = { users: 0, managers: 0, withMgr: 0, orphans: 0, mfa: 0 };

        departments.forEach(function(d) {
            var tr = document.createElement('tr');
            var mfaPct = d.totalUsers > 0 ? Math.round((d.mfaEnabled / d.totalUsers) * 100) : 0;

            var cells = [
                d.name,
                d.totalUsers,
                d.managerCount,
                d.withManager,
                d.withoutManager,
                mfaPct + '%'
            ];

            cells.forEach(function(val, idx) {
                var td = document.createElement('td');
                if (idx === 4 && d.withoutManager > 0) {
                    var span = document.createElement('span');
                    span.className = 'text-warning';
                    span.textContent = val;
                    td.appendChild(span);
                } else if (idx === 5) {
                    td.className = mfaPct >= 90 ? 'text-success' : (mfaPct >= 70 ? 'text-warning' : 'text-danger');
                    td.textContent = val;
                } else {
                    td.textContent = val;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);

            totals.users += d.totalUsers;
            totals.managers += d.managerCount;
            totals.withMgr += d.withManager;
            totals.orphans += d.withoutManager;
            totals.mfa += d.mfaEnabled;
        });

        var totalRow = document.createElement('tr');
        totalRow.className = 'totals-row';
        var totalMfaPct = totals.users > 0 ? Math.round((totals.mfa / totals.users) * 100) : 0;
        ['Total', totals.users, totals.managers, totals.withMgr, totals.orphans, totalMfaPct + '%'].forEach(function(val) {
            var td = document.createElement('td');
            var strong = document.createElement('strong');
            strong.textContent = val;
            td.appendChild(strong);
            totalRow.appendChild(td);
        });
        tbody.appendChild(totalRow);
        table.appendChild(tbody);
        container.appendChild(table);
    }

    function renderManagersTable(managers) {
        var container = document.getElementById('managers-table');
        if (!container) return;

        var columns = [
            { key: 'name', label: 'Manager', sortable: true },
            { key: 'department', label: 'Department', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'directReportsCount', label: 'Direct Reports', sortable: true },
            { key: 'isUser', label: 'In Tenant', sortable: true, formatter: function(v) {
                return v ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">External</span>';
            }},
            { key: 'topReports', label: 'Sample Reports', sortable: false }
        ];

        var tableData = managers.map(function(m) {
            var topReports = m.directReports.slice(0, 3).map(function(r) { return r.displayName; }).join(', ');
            if (m.directReports.length > 3) topReports += '...';
            return {
                name: m.name,
                department: m.department,
                directReportsCount: m.directReports.length,
                isUser: m.isUser,
                topReports: topReports || '-',
                _raw: m
            };
        });

        Tables.render({
            containerId: 'managers-table',
            data: tableData,
            columns: columns,
            pageSize: 15,
            sortable: true,
            defaultSort: { column: 'directReportsCount', direction: 'desc' },
            onRowClick: function(row) { showManagerDetails(row._raw); }
        });
    }

    function renderOrphansTable(orphans) {
        var container = document.getElementById('orphans-table');
        if (!container) return;

        var columns = [
            { key: 'displayName', label: 'Name', sortable: true },
            { key: 'userPrincipalName', label: 'Email', sortable: true },
            { key: 'department', label: 'Department', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'jobTitle', label: 'Job Title', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'accountEnabled', label: 'Status', sortable: true, formatter: function(v) {
                return v ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-danger">Disabled</span>';
            }}
        ];

        Tables.render({
            containerId: 'orphans-table',
            data: orphans,
            columns: columns,
            pageSize: 10,
            sortable: true,
            defaultSort: { column: 'displayName', direction: 'asc' }
        });
    }

    function showManagerDetails(manager) {
        var modalOverlay = document.getElementById('modal-overlay');
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        if (!modalOverlay || !modalTitle || !modalBody) return;

        modalTitle.textContent = manager.name + ' - Direct Reports';
        modalBody.textContent = '';

        var content = el('div', 'modal-details');

        // Manager info section
        var infoSection = el('div', 'detail-section');
        infoSection.appendChild(el('h4', null, 'Manager Info'));
        var grid = el('div', 'detail-grid');

        var items = [
            ['Department', manager.department || 'N/A'],
            ['Direct Reports', manager.directReports.length],
            ['In Tenant', manager.isUser ? 'Yes' : 'No (External)']
        ];
        items.forEach(function(item) {
            var div = el('div', 'detail-item');
            var label = el('span', 'detail-label', item[0] + ':');
            div.appendChild(label);
            div.appendChild(document.createTextNode(' ' + item[1]));
            grid.appendChild(div);
        });
        infoSection.appendChild(grid);
        content.appendChild(infoSection);

        // Direct reports section
        var reportsSection = el('div', 'detail-section');
        reportsSection.appendChild(el('h4', null, 'Direct Reports (' + manager.directReports.length + ')'));

        var table = document.createElement('table');
        table.className = 'data-table';
        var thead = document.createElement('thead');
        var headerRow = document.createElement('tr');
        ['Name', 'Department', 'Job Title', 'Status'].forEach(function(h) {
            var th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        manager.directReports.forEach(function(r) {
            var tr = document.createElement('tr');
            [r.displayName, r.department || '-', r.jobTitle || '-'].forEach(function(val) {
                var td = document.createElement('td');
                td.textContent = val;
                tr.appendChild(td);
            });
            var statusTd = document.createElement('td');
            var badge = document.createElement('span');
            badge.className = 'badge ' + (r.accountEnabled ? 'badge-success' : 'badge-danger');
            badge.textContent = r.accountEnabled ? 'Enabled' : 'Disabled';
            statusTd.appendChild(badge);
            tr.appendChild(statusTd);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        reportsSection.appendChild(table);
        content.appendChild(reportsSection);

        modalBody.appendChild(content);
        modalOverlay.classList.add('visible');
    }

    return { render: render };
})();
