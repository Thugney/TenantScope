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

        // Overview section with ASR Rules pattern
        var overviewDiv = el('div');
        overviewDiv.id = 'org-overview';
        container.appendChild(overviewDiv);
        renderOrgOverview(overviewDiv, hierarchy, users.length);

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

        // Render focus tables
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

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = el('div', 'analytics-card');
        card.appendChild(el('h4', null, title));
        var list = el('div', 'platform-list');
        rows.forEach(function(row) {
            var rowDiv = el('div', 'platform-row');
            rowDiv.appendChild(el('span', 'platform-name', row.name));
            rowDiv.appendChild(el('span', 'platform-policies', String(row.count)));
            var miniBar = el('div', 'mini-bar');
            var fill = el('div', 'mini-bar-fill ' + row.cls);
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            rowDiv.appendChild(el('span', 'platform-rate', row.showCount ? String(row.count) : (row.pct + '%')));
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = el('div', 'insight-card insight-' + type);
        var header = el('div', 'insight-header');
        var badgeSpan = el('span', 'badge badge-' + type, badge);
        header.appendChild(badgeSpan);
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
     * Renders the organization overview section with ASR Rules pattern.
     */
    function renderOrgOverview(container, hierarchy, totalUsers) {
        container.textContent = '';

        // Calculate stats
        var withManager = totalUsers - hierarchy.totalOrphans;
        var withManagerPct = totalUsers > 0 ? Math.round((withManager / totalUsers) * 100) : 0;
        var orphanPct = totalUsers > 0 ? Math.round((hierarchy.totalOrphans / totalUsers) * 100) : 0;

        // Build analytics section with donut chart
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Organization Health Overview'));

        var complianceOverview = el('div', 'compliance-overview');

        // Donut chart showing manager coverage
        var chartContainer = el('div', 'compliance-chart');
        var donutDiv = el('div', 'donut-chart');

        var circumference = 2 * Math.PI * 40;
        var withMgrDash = (withManagerPct / 100) * circumference;
        var orphanDash = (orphanPct / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (withManagerPct > 0) {
            var mgrCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            mgrCircle.setAttribute('cx', '50');
            mgrCircle.setAttribute('cy', '50');
            mgrCircle.setAttribute('r', '40');
            mgrCircle.setAttribute('fill', 'none');
            mgrCircle.setAttribute('stroke', 'var(--success)');
            mgrCircle.setAttribute('stroke-width', '12');
            mgrCircle.setAttribute('stroke-dasharray', withMgrDash + ' ' + circumference);
            mgrCircle.setAttribute('stroke-dashoffset', '0');
            mgrCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(mgrCircle);
        }
        if (orphanPct > 0) {
            var orphCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            orphCircle.setAttribute('cx', '50');
            orphCircle.setAttribute('cy', '50');
            orphCircle.setAttribute('r', '40');
            orphCircle.setAttribute('fill', 'none');
            orphCircle.setAttribute('stroke', 'var(--warning)');
            orphCircle.setAttribute('stroke-width', '12');
            orphCircle.setAttribute('stroke-dasharray', orphanDash + ' ' + circumference);
            orphCircle.setAttribute('stroke-dashoffset', String(-withMgrDash));
            orphCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(orphCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = el('div', 'donut-center');
        donutCenter.appendChild(el('span', 'donut-value', withManagerPct + '%'));
        donutCenter.appendChild(el('span', 'donut-label', 'Have Manager'));
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = el('div', 'compliance-legend');
        var legendItems = [
            { cls: 'bg-success', label: 'With Manager', value: withManager },
            { cls: 'bg-warning', label: 'Orphan Users', value: hierarchy.totalOrphans },
            { cls: 'bg-info', label: 'Total Managers', value: hierarchy.totalManagers },
            { cls: 'bg-primary', label: 'Departments', value: hierarchy.departments.length }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, String(item.value)));
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = el('div', 'analytics-grid');

        // Span of Control card
        var spanRows = [
            { name: '1-3 reports', count: hierarchy.spanBuckets['1-3'], pct: hierarchy.totalManagers > 0 ? Math.round((hierarchy.spanBuckets['1-3'] / hierarchy.totalManagers) * 100) : 0, cls: 'bg-success' },
            { name: '4-7 reports', count: hierarchy.spanBuckets['4-7'], pct: hierarchy.totalManagers > 0 ? Math.round((hierarchy.spanBuckets['4-7'] / hierarchy.totalManagers) * 100) : 0, cls: 'bg-info' },
            { name: '8-15 reports', count: hierarchy.spanBuckets['8-15'], pct: hierarchy.totalManagers > 0 ? Math.round((hierarchy.spanBuckets['8-15'] / hierarchy.totalManagers) * 100) : 0, cls: 'bg-warning' },
            { name: '16+ reports', count: hierarchy.spanBuckets['16+'], pct: hierarchy.totalManagers > 0 ? Math.round((hierarchy.spanBuckets['16+'] / hierarchy.totalManagers) * 100) : 0, cls: 'bg-critical' }
        ];
        analyticsGrid.appendChild(createPlatformCard('Span of Control', spanRows));

        // Top Departments card
        var topDepts = hierarchy.departments.slice(0, 4);
        var maxDeptUsers = topDepts.length > 0 ? topDepts[0].totalUsers : 1;
        var deptRows = topDepts.map(function(d) {
            return { name: d.name, count: d.totalUsers, pct: Math.round((d.totalUsers / maxDeptUsers) * 100), cls: 'bg-info', showCount: true };
        });
        if (deptRows.length === 0) {
            deptRows = [{ name: 'No departments', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Top Departments', deptRows));

        // Top Managers card
        var topMgrs = hierarchy.managers.slice(0, 4);
        var maxReports = topMgrs.length > 0 ? topMgrs[0].directReports.length : 1;
        var mgrRows = topMgrs.map(function(m) {
            return { name: m.name, count: m.directReports.length, pct: Math.round((m.directReports.length / maxReports) * 100), cls: 'bg-primary', showCount: true };
        });
        if (mgrRows.length === 0) {
            mgrRows = [{ name: 'No managers', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Top Managers', mgrRows));

        // Manager Coverage card
        analyticsGrid.appendChild(createPlatformCard('Manager Coverage', [
            { name: 'With Manager', count: withManager, pct: withManagerPct, cls: 'bg-success' },
            { name: 'Orphan Users', count: hierarchy.totalOrphans, pct: orphanPct, cls: 'bg-warning' }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = el('div', 'insights-list');

        // Orphan users insight
        if (hierarchy.totalOrphans > 0) {
            insightsList.appendChild(createInsightCard('warning', 'GOVERNANCE', 'Orphan Users',
                hierarchy.totalOrphans + ' user' + (hierarchy.totalOrphans !== 1 ? 's have' : ' has') + ' no manager assigned. This creates visibility gaps for access reviews and reporting chains.',
                'Assign managers to orphan users to enable proper governance and access reviews.'));
        }

        // Wide span of control insight
        var wideSpan = hierarchy.spanBuckets['16+'];
        if (wideSpan > 0) {
            insightsList.appendChild(createInsightCard('info', 'ATTENTION', 'Wide Span of Control',
                wideSpan + ' manager' + (wideSpan !== 1 ? 's have' : ' has') + ' 16+ direct reports. Consider if delegation is needed.',
                'Review managers with wide span of control and consider organizational restructuring.'));
        }

        // External managers insight
        var externalMgrs = hierarchy.managers.filter(function(m) { return !m.isUser; });
        if (externalMgrs.length > 0) {
            insightsList.appendChild(createInsightCard('info', 'INFO', 'External Managers',
                externalMgrs.length + ' manager' + (externalMgrs.length !== 1 ? 's are' : ' is') + ' not found in the tenant. These may be external or former employees.',
                'Verify external manager references and update or remove as needed.'));
        }

        // Healthy state
        if (hierarchy.totalOrphans === 0 && wideSpan === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Organization Status',
                'All users have managers assigned and span of control is within recommended limits.',
                null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Renders both charts using DashboardCharts.createChartCard.
     */
    function renderCharts(hierarchy, chartsRow) {
        if (typeof DashboardCharts === 'undefined') return;

        // Span of Control chart
        var spanData = [
            { label: '1-3 reports', value: hierarchy.spanBuckets['1-3'], color: '#10b981' },
            { label: '4-7 reports', value: hierarchy.spanBuckets['4-7'], color: '#3b82f6' },
            { label: '8-15 reports', value: hierarchy.spanBuckets['8-15'], color: '#f59e0b' },
            { label: '16+ reports', value: hierarchy.spanBuckets['16+'], color: '#ef4444' }
        ].filter(function(d) { return d.value > 0; });

        var spanTotal = spanData.reduce(function(sum, d) { return sum + d.value; }, 0);

        if (spanData.length > 0) {
            var spanCard = DashboardCharts.createChartCard(
                'Span of Control Distribution',
                spanData,
                String(spanTotal),
                'Managers',
                { size: 200, strokeWidth: 28 }
            );
            chartsRow.appendChild(spanCard);
        } else {
            var emptySpan = el('div', 'chart-container');
            emptySpan.appendChild(el('div', 'chart-title', 'Span of Control Distribution'));
            emptySpan.appendChild(el('div', 'empty-state-small', 'No managers found'));
            chartsRow.appendChild(emptySpan);
        }

        // Department Coverage chart
        var top5 = hierarchy.departments.slice(0, 5);
        var colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

        var deptData = top5.map(function(d, i) {
            var pct = d.totalUsers > 0 ? Math.round((d.withManager / d.totalUsers) * 100) : 0;
            return { label: d.name + ' (' + pct + '%)', value: d.withManager, color: colors[i % colors.length] };
        });

        var deptTotal = deptData.reduce(function(sum, d) { return sum + d.value; }, 0);

        if (deptData.length > 0) {
            var deptCard = DashboardCharts.createChartCard(
                'Manager Coverage by Department',
                deptData,
                String(deptTotal),
                'With Manager',
                { size: 200, strokeWidth: 28 }
            );
            chartsRow.appendChild(deptCard);
        } else {
            var emptyDept = el('div', 'chart-container');
            emptyDept.appendChild(el('div', 'chart-title', 'Manager Coverage by Department'));
            emptyDept.appendChild(el('div', 'empty-state-small', 'No department data'));
            chartsRow.appendChild(emptyDept);
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
