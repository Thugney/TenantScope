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

    /** Current tab */
    var currentTab = 'overview';

    /** Cached page state */
    var orgState = null;

    /**
     * Analyzes the organization hierarchy from user data.
     *
     * @param {Array} users - All user data
     * @returns {Object} Hierarchy analysis
     */
    function analyzeHierarchy(users) {
        var managerMap = {};
        var orphanUsers = [];
        var allManagerKeys = new Set();
        var userById = {};
        var userByUpn = {};
        var userByName = {};
        var managerByUser = new Map();
        var missingManagerRefs = [];
        var missingManagerKeys = new Set();
        var selfManagedUsers = [];

        users.forEach(function(u) {
            if (u.id) userById[u.id] = u;
            if (u.userPrincipalName) userByUpn[u.userPrincipalName.toLowerCase()] = u;
            if (u.displayName && !userByName[u.displayName.toLowerCase()]) {
                userByName[u.displayName.toLowerCase()] = u;
            }
        });

        function getManagerRef(user) {
            var managerId = user.managerId || null;
            var managerUpn = user.managerUpn || null;
            var managerName = user.manager || null;
            var key = null;
            if (managerId) key = managerId;
            else if (managerUpn) key = 'upn:' + managerUpn.toLowerCase();
            else if (managerName) key = 'name:' + managerName.toLowerCase();
            if (!key) return null;
            return {
                key: key,
                id: managerId || null,
                upn: managerUpn || null,
                name: managerName || managerUpn || managerId || 'Unknown'
            };
        }

        function getUserManagerKeys(user) {
            var keys = [];
            if (user.id) keys.push(user.id);
            if (user.userPrincipalName) keys.push('upn:' + user.userPrincipalName.toLowerCase());
            if (user.displayName) keys.push('name:' + user.displayName.toLowerCase());
            return keys;
        }

        function resolveManagerUser(ref) {
            if (!ref) return null;
            if (ref.id && userById[ref.id]) return userById[ref.id];
            if (ref.upn && userByUpn[ref.upn.toLowerCase()]) return userByUpn[ref.upn.toLowerCase()];
            if (ref.name && userByName[ref.name.toLowerCase()]) return userByName[ref.name.toLowerCase()];
            return null;
        }

        users.forEach(function(u) {
            var ref = getManagerRef(u);
            if (ref) {
                allManagerKeys.add(ref.key);
            }
        });

        users.forEach(function(u) {
            var ref = getManagerRef(u);
            if (!ref) return;
            var managerUser = resolveManagerUser(ref);
            if (managerUser) {
                managerByUser.set(u, managerUser);
                if (managerUser === u) {
                    selfManagedUsers.push(u);
                }
            } else {
                missingManagerRefs.push({ user: u, managerRef: ref });
                missingManagerKeys.add(ref.key);
            }
        });

        users.forEach(function(u) {
            var ref = getManagerRef(u);
            if (!ref) {
                var isManager = getUserManagerKeys(u).some(function(k) { return allManagerKeys.has(k); });
                if (!isManager) {
                    orphanUsers.push(u);
                }
            } else {
                if (!managerMap[ref.key]) {
                    managerMap[ref.key] = {
                        key: ref.key,
                        name: ref.name,
                        managerId: ref.id,
                        managerUpn: ref.upn,
                        directReports: [],
                        department: null,
                        companyName: null,
                        officeLocation: null,
                        city: null,
                        country: null,
                        isUser: false,
                        userData: null
                    };
                }
                managerMap[ref.key].directReports.push(u);
            }
        });

        Object.values(managerMap).forEach(function(manager) {
            var managerUser = null;
            if (manager.managerId && userById[manager.managerId]) {
                managerUser = userById[manager.managerId];
            } else if (manager.managerUpn && userByUpn[manager.managerUpn.toLowerCase()]) {
                managerUser = userByUpn[manager.managerUpn.toLowerCase()];
            } else if (manager.name && userByName[manager.name.toLowerCase()]) {
                managerUser = userByName[manager.name.toLowerCase()];
            }

            if (managerUser) {
                manager.isUser = true;
                manager.userData = managerUser;
                manager.name = managerUser.displayName || manager.name;
                manager.department = managerUser.department;
                manager.companyName = managerUser.companyName;
                manager.officeLocation = managerUser.officeLocation;
                manager.city = managerUser.city;
                manager.country = managerUser.country;
                manager.userPrincipalName = managerUser.userPrincipalName;
                manager.jobTitle = managerUser.jobTitle;
            }
        });

        var spanBuckets = { '0': 0, '1-3': 0, '4-7': 0, '8-15': 0, '16+': 0 };
        var managerList = Object.values(managerMap);
        var cycleUsers = new Set();
        var visitState = new Map();

        managerList.forEach(function(m) {
            var count = m.directReports.length;
            if (count === 0) spanBuckets['0']++;
            else if (count <= 3) spanBuckets['1-3']++;
            else if (count <= 7) spanBuckets['4-7']++;
            else if (count <= 15) spanBuckets['8-15']++;
            else spanBuckets['16+']++;
        });

        function markCycle(start) {
            var cur = start;
            var safety = 0;
            while (cur && safety < users.length + 1) {
                cycleUsers.add(cur);
                cur = managerByUser.get(cur);
                if (cur === start) break;
                safety++;
            }
        }

        function visit(user) {
            var state = visitState.get(user) || 0;
            if (state === 2) return;
            if (state === 1) return;
            visitState.set(user, 1);
            var mgr = managerByUser.get(user);
            if (mgr) {
                if (mgr === user) {
                    // self-managed loop tracked separately
                } else {
                    var mgrState = visitState.get(mgr) || 0;
                    if (mgrState === 1) {
                        markCycle(mgr);
                    } else {
                        visit(mgr);
                    }
                }
            }
            visitState.set(user, 2);
        }

        managerByUser.forEach(function(_, user) {
            visit(user);
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
            var ref = getManagerRef(u);
            if (ref) {
                deptAnalysis[dept].withManager++;
                deptAnalysis[dept].managers.add(ref.key);
            } else {
                var isManager = getUserManagerKeys(u).some(function(k) { return allManagerKeys.has(k); });
                if (!isManager) {
                    deptAnalysis[dept].withoutManager++;
                }
            }
            if (u.mfaRegistered) deptAnalysis[dept].mfaEnabled++;
            if (u.isInactive) deptAnalysis[dept].inactive++;
            if (!u.accountEnabled) deptAnalysis[dept].disabled++;
        });

        Object.values(deptAnalysis).forEach(function(d) {
            d.managerCount = d.managers.size;
            delete d.managers;
        });

        var rootManagers = managerList.filter(function(m) {
            return m.isUser && m.userData && !getManagerRef(m.userData);
        });

        return {
            managers: managerList.sort(function(a, b) {
                return b.directReports.length - a.directReports.length;
            }),
            orphanUsers: orphanUsers,
            spanBuckets: spanBuckets,
            totalManagers: managerList.length,
            totalOrphans: orphanUsers.length,
            rootManagers: rootManagers,
            totalRootManagers: rootManagers.length,
            integrity: {
                missingManagerRefUsers: missingManagerRefs,
                missingManagerRefCount: missingManagerRefs.length,
                missingManagerKeyCount: missingManagerKeys.size,
                selfManagedUsers: selfManagedUsers,
                selfManagedCount: selfManagedUsers.length,
                cycleUsers: Array.from(cycleUsers),
                cycleUserCount: cycleUsers.size
            },
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
        var container = document.getElementById('org-content');
        if (!container || !orgState) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'analysis':
                renderAnalysisTab(container);
                break;
            case 'managers':
                renderManagersTab(container);
                break;
        }
    }

    /**
     * Renders the Overview tab.
     */
    function renderOverviewTab(container) {
        container.textContent = '';
        renderOrgOverview(container, orgState.hierarchy, orgState.totalUsers);
    }

    /**
     * Renders the Analysis tab.
     */
    function renderAnalysisTab(container) {
        container.textContent = '';

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

        renderManagerFocus(orgState.hierarchy.managers);
        renderDeptBreakdown(orgState.hierarchy.departments);
    }

    /**
     * Renders the Managers tab with tables.
     */
    function renderManagersTab(container) {
        container.textContent = '';

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
        if (orgState.hierarchy.totalOrphans > 0) {
            var orphanSection = el('div', 'table-section');
            var orphanHeader = el('div', 'table-header');
            orphanHeader.appendChild(el('h3', 'table-title', 'Users Without Manager (' + orgState.hierarchy.totalOrphans + ')'));
            var exportOrphanBtn = el('button', 'btn btn-secondary', 'Export CSV');
            exportOrphanBtn.id = 'export-orphans-btn';
            orphanHeader.appendChild(exportOrphanBtn);
            orphanSection.appendChild(orphanHeader);
            var orphanTableDiv = el('div');
            orphanTableDiv.id = 'orphans-table';
            orphanSection.appendChild(orphanTableDiv);
            container.appendChild(orphanSection);
        }

        renderManagersTable(orgState.hierarchy.managers);
        if (orgState.hierarchy.totalOrphans > 0) {
            renderOrphansTable(orgState.hierarchy.orphanUsers);
        }

        // Export buttons
        document.getElementById('export-managers-btn').addEventListener('click', function() {
            var exportData = orgState.hierarchy.managers.map(function(m) {
                return {
                    Manager: m.name,
                    Email: m.userPrincipalName || m.managerUpn || '',
                    JobTitle: m.jobTitle || '',
                    Department: m.department || '',
                    Office: m.officeLocation || '',
                    Company: m.companyName || '',
                    DirectReports: m.directReports.length,
                    InTenant: m.isUser ? 'Yes' : 'No'
                };
            });
            var columns = [
                { key: 'Manager', label: 'Manager' },
                { key: 'Email', label: 'Email' },
                { key: 'JobTitle', label: 'Job Title' },
                { key: 'Department', label: 'Department' },
                { key: 'Office', label: 'Office' },
                { key: 'Company', label: 'Company' },
                { key: 'DirectReports', label: 'Direct Reports' },
                { key: 'InTenant', label: 'In Tenant' }
            ];
            Export.toCSV(exportData, columns, 'tenantscope-managers.csv');
        });

        var orphanBtn = document.getElementById('export-orphans-btn');
        if (orphanBtn) {
            orphanBtn.addEventListener('click', function() {
                var exportData = orgState.hierarchy.orphanUsers.map(function(u) {
                    return {
                        Name: u.displayName,
                        Email: u.userPrincipalName,
                        Department: u.department || '',
                        JobTitle: u.jobTitle || '',
                        Office: u.officeLocation || '',
                        Company: u.companyName || '',
                        City: u.city || '',
                        Country: u.country || '',
                        Status: u.accountEnabled ? 'Enabled' : 'Disabled'
                    };
                });
                var columns = [
                    { key: 'Name', label: 'Name' },
                    { key: 'Email', label: 'Email' },
                    { key: 'Department', label: 'Department' },
                    { key: 'JobTitle', label: 'Job Title' },
                    { key: 'Office', label: 'Office' },
                    { key: 'Company', label: 'Company' },
                    { key: 'City', label: 'City' },
                    { key: 'Country', label: 'Country' },
                    { key: 'Status', label: 'Status' }
                ];
                Export.toCSV(exportData, columns, 'tenantscope-orphan-users.csv');
            });
        }
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

        // Cache state
        orgState = {
            users: users,
            totalUsers: users.length,
            hierarchy: hierarchy
        };

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
        cards.appendChild(createCard('Root Managers', hierarchy.totalRootManagers || 0, 'secondary'));
        cards.appendChild(createCard('Orphan Users', hierarchy.totalOrphans, hierarchy.totalOrphans > 0 ? 'warning' : 'success'));
        cards.appendChild(createCard('Departments', hierarchy.departments.length, 'secondary'));
        container.appendChild(cards);

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'analysis', label: 'Analysis' },
            { id: 'managers', label: 'All Managers (' + hierarchy.totalManagers + ')' }
        ];
        tabs.forEach(function(t) {
            var btn = el('button', 'tab-btn' + (t.id === 'overview' ? ' active' : ''));
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            tabBar.appendChild(btn);
        });
        container.appendChild(tabBar);

        // Content area
        var contentArea = el('div', 'content-area');
        contentArea.id = 'org-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
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
        var integrity = hierarchy.integrity || {};
        var missingManagerRefCount = integrity.missingManagerRefCount || 0;
        var missingManagerKeyCount = integrity.missingManagerKeyCount || 0;
        var selfManagedCount = integrity.selfManagedCount || 0;
        var cycleUserCount = integrity.cycleUserCount || 0;

        function sampleNames(list, limit, accessor) {
            if (!list || list.length === 0) return '';
            var names = list.slice(0, limit).map(function(item) {
                var user = accessor ? accessor(item) : item;
                if (!user) return 'Unknown';
                return user.displayName || user.userPrincipalName || 'Unknown';
            }).filter(function(n) { return n && n !== 'Unknown'; });
            return names.join(', ');
        }

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
        bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (withManagerPct > 0) {
            var mgrCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            mgrCircle.setAttribute('cx', '50');
            mgrCircle.setAttribute('cy', '50');
            mgrCircle.setAttribute('r', '40');
            mgrCircle.setAttribute('fill', 'none');
            mgrCircle.setAttribute('stroke', 'var(--color-success)');
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
            orphCircle.setAttribute('stroke', 'var(--color-warning)');
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
            { cls: 'bg-warning', label: 'Orphan Users', value: hierarchy.totalOrphans }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, String(item.value)));
            legend.appendChild(legendItem);
        });
        var metricItems = [
            { label: 'Total Managers', value: hierarchy.totalManagers },
            { label: 'Root Managers', value: hierarchy.totalRootManagers || 0 },
            { label: 'Departments', value: hierarchy.departments.length }
        ];
        metricItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(document.createTextNode(item.label + ': '));
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

        if (missingManagerRefCount > 0) {
            var missingSample = sampleNames(integrity.missingManagerRefUsers, 3, function(item) { return item.user; });
            var sampleText = missingSample ? ' Example: ' + missingSample + '.' : '';
            insightsList.appendChild(createInsightCard('warning', 'INTEGRITY', 'Missing Manager References',
                missingManagerRefCount + ' user' + (missingManagerRefCount !== 1 ? 's reference ' : ' references ') +
                missingManagerKeyCount + ' manager' + (missingManagerKeyCount !== 1 ? 's' : '') + ' not found in the tenant.' + sampleText,
                'Resolve missing manager objects or update the manager field to restore reporting chains.'));
        }

        if (selfManagedCount > 0) {
            var selfSample = sampleNames(integrity.selfManagedUsers, 3);
            var selfText = selfSample ? ' Example: ' + selfSample + '.' : '';
            insightsList.appendChild(createInsightCard('warning', 'INTEGRITY', 'Self-Managed Loops',
                selfManagedCount + ' user' + (selfManagedCount !== 1 ? 's have' : ' has') + ' their own account set as manager.' + selfText,
                'Fix self-managed loops to prevent broken escalation paths.'));
        }

        if (cycleUserCount > 0) {
            var cycleSample = sampleNames(integrity.cycleUsers, 3);
            var cycleText = cycleSample ? ' Example: ' + cycleSample + '.' : '';
            insightsList.appendChild(createInsightCard('warning', 'INTEGRITY', 'Hierarchy Cycles',
                'Detected manager chain cycles involving ' + cycleUserCount + ' user' + (cycleUserCount !== 1 ? 's' : '') + '.' + cycleText,
                'Correct cyclic manager assignments to restore a valid hierarchy.'));
        }

        if (hierarchy.totalRootManagers > 0) {
            insightsList.appendChild(createInsightCard('info', 'STRUCTURE', 'Top-Level Managers',
                hierarchy.totalRootManagers + ' manager' + (hierarchy.totalRootManagers !== 1 ? 's have' : ' has') + ' no manager assigned (top of chain).',
                'Confirm these are intended roots or assign an executive owner.'));
        }

        // Healthy state
        if (hierarchy.totalOrphans === 0 && wideSpan === 0 && externalMgrs.length === 0 &&
            missingManagerRefCount === 0 && selfManagedCount === 0 && cycleUserCount === 0) {
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
        ['Department', 'Users', 'Managers', 'With Mgr', 'Orphans', 'Inactive', 'Disabled', 'MFA %'].forEach(function(text) {
            var th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        var totals = { users: 0, managers: 0, withMgr: 0, orphans: 0, inactive: 0, disabled: 0, mfa: 0 };

        departments.forEach(function(d) {
            var tr = document.createElement('tr');
            var mfaPct = d.totalUsers > 0 ? Math.round((d.mfaEnabled / d.totalUsers) * 100) : 0;

        var cells = [
            d.name,
            d.totalUsers,
            d.managerCount,
            d.withManager,
            d.withoutManager,
            d.inactive,
            d.disabled,
            mfaPct + '%'
        ];

            cells.forEach(function(val, idx) {
                var td = document.createElement('td');
            if (idx === 4 && d.withoutManager > 0) {
                var span = document.createElement('span');
                span.className = 'text-warning';
                span.textContent = val;
                td.appendChild(span);
            } else if (idx === 5 && d.inactive > 0) {
                td.className = 'text-warning';
                td.textContent = val;
            } else if (idx === 6 && d.disabled > 0) {
                td.className = 'text-danger';
                td.textContent = val;
            } else if (idx === 7) {
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
        totals.inactive += d.inactive;
        totals.disabled += d.disabled;
        totals.mfa += d.mfaEnabled;
    });

        var totalRow = document.createElement('tr');
        totalRow.className = 'totals-row';
        var totalMfaPct = totals.users > 0 ? Math.round((totals.mfa / totals.users) * 100) : 0;
        ['Total', totals.users, totals.managers, totals.withMgr, totals.orphans, totals.inactive, totals.disabled, totalMfaPct + '%'].forEach(function(val) {
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
            { key: 'email', label: 'Email', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'jobTitle', label: 'Job Title', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'department', label: 'Department', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'officeLocation', label: 'Office', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'companyName', label: 'Company', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'directReportsCount', label: 'Direct Reports', sortable: true },
            { key: 'isUser', label: 'In Tenant', sortable: true, formatter: function(v) {
                return v ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">External</span>';
            }},
            { key: 'topReports', label: 'Sample Reports', sortable: false }
        ];

        var tableData = managers.map(function(m) {
            var reports = Array.isArray(m.directReports) ? m.directReports : [];
            var topReports = reports.slice(0, 3).map(function(r) { return r.displayName; }).join(', ');
            if (reports.length > 3) topReports += '...';
            var email = m.userPrincipalName || m.managerUpn || '';
            return {
                name: m.name,
                email: email,
                jobTitle: m.jobTitle || '',
                department: m.department,
                officeLocation: m.officeLocation || '',
                companyName: m.companyName || '',
                directReportsCount: reports.length,
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
            { key: 'officeLocation', label: 'Office', sortable: true, formatter: function(v) { return v || '-'; } },
            { key: 'companyName', label: 'Company', sortable: true, formatter: function(v) { return v || '-'; } },
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

        var locationParts = [];
        if (manager.city) locationParts.push(manager.city);
        if (manager.country) locationParts.push(manager.country);
        var locationDisplay = locationParts.length > 0 ? locationParts.join(', ') : 'N/A';

        var items = [
            ['Email', manager.userPrincipalName || manager.managerUpn || 'N/A'],
            ['Job Title', manager.jobTitle || 'N/A'],
            ['Department', manager.department || 'N/A'],
            ['Office', manager.officeLocation || 'N/A'],
            ['Company', manager.companyName || 'N/A'],
            ['Location', locationDisplay],
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


