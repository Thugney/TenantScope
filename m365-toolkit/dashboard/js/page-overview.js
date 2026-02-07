/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: OVERVIEW
 *
 * Renders the overview dashboard with unified analytics pattern: donut chart,
 * analytics grid, insights section, and quick stats.
 */

const PageOverview = (function() {
    'use strict';

    var C = DashboardCharts.colors;

    /** Current tab */
    var currentTab = 'overview';

    /** Cached page state */
    var overviewState = null;

    /**
     * Creates an element with className and textContent.
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
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
            rowDiv.appendChild(el('span', 'platform-rate', row.showPct ? (row.pct + '%') : String(row.count)));
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action, navigateTo) {
        var card = el('div', 'insight-card insight-' + type);
        if (navigateTo) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', function() {
                window.location.hash = navigateTo;
            });
        }
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
        var container = document.getElementById('overview-content');
        if (!container || !overviewState) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'stats':
                renderStatsTab(container);
                break;
        }
    }

    /**
     * Renders the Overview tab with analytics.
     */
    function renderOverviewTab(container) {
        container.textContent = '';
        var s = overviewState.summary;

        // Calculate tenant health score (composite)
        var healthScore = Math.round((s.mfaPct + s.compliancePct + (s.activeAlerts === 0 ? 100 : Math.max(0, 100 - s.activeAlerts * 10))) / 3);
        var healthyPct = healthScore;
        var issuesPct = 100 - healthScore;

        // Build analytics section with donut chart
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Tenant Health Overview'));

        var complianceOverview = el('div', 'compliance-overview');

        // Donut chart
        var chartContainer = el('div', 'compliance-chart');
        var donutDiv = el('div', 'donut-chart');

        var circumference = 2 * Math.PI * 40;
        var healthyDash = (healthyPct / 100) * circumference;
        var issuesDash = (issuesPct / 100) * circumference;

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

        if (healthyPct > 0) {
            var healthyCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            healthyCircle.setAttribute('cx', '50');
            healthyCircle.setAttribute('cy', '50');
            healthyCircle.setAttribute('r', '40');
            healthyCircle.setAttribute('fill', 'none');
            healthyCircle.setAttribute('stroke', 'var(--color-success)');
            healthyCircle.setAttribute('stroke-width', '12');
            healthyCircle.setAttribute('stroke-dasharray', healthyDash + ' ' + circumference);
            healthyCircle.setAttribute('stroke-dashoffset', '0');
            healthyCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(healthyCircle);
        }
        if (issuesPct > 0) {
            var issuesCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            issuesCircle.setAttribute('cx', '50');
            issuesCircle.setAttribute('cy', '50');
            issuesCircle.setAttribute('r', '40');
            issuesCircle.setAttribute('fill', 'none');
            issuesCircle.setAttribute('stroke', healthScore >= 70 ? 'var(--color-warning)' : 'var(--color-critical)');
            issuesCircle.setAttribute('stroke-width', '12');
            issuesCircle.setAttribute('stroke-dasharray', issuesDash + ' ' + circumference);
            issuesCircle.setAttribute('stroke-dashoffset', String(-healthyDash));
            issuesCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(issuesCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = el('div', 'donut-center');
        donutCenter.appendChild(el('span', 'donut-value', healthScore + '%'));
        donutCenter.appendChild(el('span', 'donut-label', 'Health'));
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = el('div', 'compliance-legend');
        var issueClass = healthScore >= 70 ? 'bg-warning' : 'bg-critical';
        var legendItems = [
            { cls: 'bg-success', label: 'Healthy', value: healthyPct + '%' },
            { cls: issueClass, label: 'Issues', value: issuesPct + '%' }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, item.value));
            legend.appendChild(legendItem);
        });
        var metricItems = [
            { label: 'MFA Coverage', value: s.mfaPct + '%' },
            { label: 'Device Compliance', value: s.compliancePct + '%' },
            { label: 'Active Alerts', value: String(s.activeAlerts) },
            { label: 'Total Users', value: s.totalUsers.toLocaleString() }
        ];
        metricItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(document.createTextNode(item.label + ': '));
            legendItem.appendChild(el('strong', null, item.value));
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = el('div', 'analytics-grid');

        // Operational signals (not part of health donut)
        var signalCard = el('div', 'analytics-card');
        signalCard.appendChild(el('h4', null, 'Operational Signals'));
        var signalList = el('div', 'compliance-legend');
        var signalItems = [
            {
                cls: s.mfaPct >= 90 ? 'bg-success' : s.mfaPct >= 70 ? 'bg-warning' : 'bg-critical',
                label: 'MFA Coverage',
                value: s.mfaPct + '%'
            },
            {
                cls: s.compliancePct >= 90 ? 'bg-success' : s.compliancePct >= 70 ? 'bg-warning' : 'bg-critical',
                label: 'Device Compliance',
                value: s.compliancePct + '%'
            },
            {
                cls: s.activeAlerts > 0 ? 'bg-critical' : 'bg-success',
                label: 'Active Alerts',
                value: String(s.activeAlerts)
            },
            {
                cls: 'bg-neutral',
                label: 'Total Users',
                value: s.totalUsers.toLocaleString()
            }
        ];
        signalItems.forEach(function(item) {
            var row = el('div', 'legend-item');
            row.appendChild(el('span', 'legend-dot ' + item.cls));
            row.appendChild(document.createTextNode(' ' + item.label + ': '));
            row.appendChild(el('strong', null, item.value));
            signalList.appendChild(row);
        });
        signalCard.appendChild(signalList);
        analyticsGrid.appendChild(signalCard);

        // Users card
        var maxUsers = Math.max(s.employeeCount, s.studentCount, s.guestCount, 1);
        analyticsGrid.appendChild(createPlatformCard('User Composition', [
            { name: 'Employees', count: s.employeeCount, pct: Math.round((s.employeeCount / maxUsers) * 100), cls: 'bg-info', showPct: false },
            { name: 'Students', count: s.studentCount, pct: Math.round((s.studentCount / maxUsers) * 100), cls: 'bg-success', showPct: false },
            { name: 'Guests', count: s.guestCount, pct: Math.round((s.guestCount / maxUsers) * 100), cls: 'bg-purple', showPct: false },
            { name: 'Other', count: s.otherCount, pct: Math.round((s.otherCount / maxUsers) * 100), cls: 'bg-neutral', showPct: false }
        ]));

        // Security card
        analyticsGrid.appendChild(createPlatformCard('Security Status', [
            { name: 'MFA Enrolled', count: s.mfaRegisteredCount, pct: s.mfaPct, cls: 'bg-success', showPct: true },
            { name: 'Without MFA', count: s.noMfaUsers, pct: 100 - s.mfaPct, cls: 'bg-warning', showPct: true },
            { name: 'Active Alerts', count: s.activeAlerts, pct: Math.min(s.activeAlerts * 20, 100), cls: s.activeAlerts > 0 ? 'bg-critical' : 'bg-success', showPct: false }
        ]));

        // Devices card
        analyticsGrid.appendChild(createPlatformCard('Device Status', [
            { name: 'Compliant', count: s.compliantDevices, pct: s.compliancePct, cls: 'bg-success', showPct: true },
            { name: 'Non-Compliant', count: s.nonCompliantDevices, pct: s.totalDevices > 0 ? Math.round((s.nonCompliantDevices / s.totalDevices) * 100) : 0, cls: 'bg-critical', showPct: true },
            { name: 'Unknown', count: s.unknownDevices, pct: s.totalDevices > 0 ? Math.round((s.unknownDevices / s.totalDevices) * 100) : 0, cls: 'bg-neutral', showPct: true }
        ]));

        // Licenses card
        var licenseData = overviewState.licenseStats;
        analyticsGrid.appendChild(createPlatformCard('License Status', [
            { name: 'Total SKUs', count: licenseData.totalSkus, pct: 100, cls: 'bg-info', showPct: false },
            { name: 'Avg Utilization', count: licenseData.avgUtilization + '%', pct: licenseData.avgUtilization, cls: licenseData.avgUtilization >= 70 ? 'bg-success' : 'bg-warning', showPct: false },
            { name: 'Total Waste', count: licenseData.totalWaste, pct: licenseData.wastePct, cls: licenseData.totalWaste > 0 ? 'bg-critical' : 'bg-success', showPct: false }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = el('div', 'insights-list');

        // Generate insights based on data
        if (s.mfaPct < 90) {
            insightsList.appendChild(createInsightCard('warning', 'MFA', 'Security Gap',
                (100 - s.mfaPct) + '% of users (' + s.noMfaUsers + ') are not enrolled in MFA.',
                'Enable MFA for all users to prevent account compromise.', 'security'));
        }

        if (s.compliancePct < 80) {
            insightsList.appendChild(createInsightCard('warning', 'COMPLIANCE', 'Device Risk',
                s.nonCompliantDevices + ' devices (' + (100 - s.compliancePct) + '%) are non-compliant.',
                'Review and remediate non-compliant devices.', 'devices'));
        }

        if (s.activeAlerts > 0) {
            insightsList.appendChild(createInsightCard('critical', 'ALERTS', 'Active Threats',
                s.activeAlerts + ' security alert' + (s.activeAlerts !== 1 ? 's' : '') + ' require attention.',
                'Investigate and resolve active security alerts immediately.', 'security'));
        }

        if (licenseData.totalWaste > 0) {
            insightsList.appendChild(createInsightCard('info', 'COST', 'License Waste',
                licenseData.totalWaste + ' licenses are assigned to disabled or inactive users.',
                'Review license assignments to reduce costs.', 'licenses'));
        }

        // Secure Score insight
        var secureScore = overviewState.secureScore;
        if (secureScore && secureScore.scorePct < 70) {
            insightsList.appendChild(createInsightCard('info', 'SCORE', 'Secure Score',
                'Microsoft Secure Score is ' + secureScore.scorePct + '%. Consider implementing recommended actions.',
                'Review and complete improvement actions.', 'security'));
        }

        // Healthy state
        if (healthScore >= 90 && s.activeAlerts === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Tenant Health',
                'Your tenant is in good health with ' + healthScore + '% overall score.',
                null, null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Renders the Quick Stats tab.
     */
    function renderStatsTab(container) {
        container.textContent = '';

        // Donut charts row
        var chartsGrid = el('div', 'overview-charts-grid');
        var s = overviewState.summary;

        // Secure Score donut
        var secureScore = overviewState.secureScore;
        if (secureScore && secureScore.scorePct !== undefined) {
            var pct = secureScore.scorePct;
            var scoreColor = pct >= 70 ? C.green : (pct >= 40 ? C.yellow : C.red);
            var scoreSegments = [
                { value: pct, label: 'Achieved', color: scoreColor },
                { value: 100 - pct, label: 'Remaining', color: C.gray }
            ];
            var scoreCard = DashboardCharts.createChartCard(
                'Secure Score', scoreSegments,
                pct + '%', 'of 100'
            );

            if (secureScore.controlScores && secureScore.controlScores.length > 0) {
                var list = el('ul', 'secure-score-actions');
                var top3 = secureScore.controlScores.slice(0, 3);
                for (var i = 0; i < top3.length; i++) {
                    var li = el('li', null, top3[i].description);
                    list.appendChild(li);
                }
                scoreCard.appendChild(list);
            }
            chartsGrid.appendChild(scoreCard);
        }

        // User Composition donut
        var userSegments = [
            { value: s.employeeCount, label: 'Employees', color: C.blue },
            { value: s.studentCount, label: 'Students', color: C.teal },
            { value: s.guestCount, label: 'Guests', color: C.purple },
            { value: s.otherCount, label: 'Other', color: C.gray }
        ];
        chartsGrid.appendChild(DashboardCharts.createChartCard(
            'User Composition', userSegments,
            String(s.totalUsers), 'total users'
        ));

        // MFA Status donut
        var mfaSegments = [
            { value: s.mfaRegisteredCount, label: 'Enrolled', color: C.green },
            { value: s.noMfaUsers, label: 'Not Enrolled', color: C.red }
        ];
        chartsGrid.appendChild(DashboardCharts.createChartCard(
            'MFA Status', mfaSegments,
            s.mfaPct + '%', 'coverage'
        ));

        // Device Compliance donut
        var deviceSegments = [
            { value: s.compliantDevices, label: 'Compliant', color: C.green },
            { value: s.nonCompliantDevices, label: 'Non-Compliant', color: C.red },
            { value: s.unknownDevices, label: 'Unknown', color: C.gray }
        ];
        chartsGrid.appendChild(DashboardCharts.createChartCard(
            'Device Compliance', deviceSegments,
            s.compliancePct + '%', 'compliant'
        ));

        container.appendChild(chartsGrid);

        // License utilization section
        renderLicenseUtilization(container);

        // Recent activity section
        renderRecentActivity(container);
    }

    /**
     * Renders the license utilization section.
     */
    function renderLicenseUtilization(container) {
        var licenses = DataLoader.getData('licenseSkus');
        if (!licenses || licenses.length === 0) return;

        var sorted = licenses.slice().sort(function(a, b) {
            return (b.utilizationPercent || 0) - (a.utilizationPercent || 0);
        });

        var panel = el('div', 'license-grid');
        panel.appendChild(el('div', 'license-grid-title', 'License Utilization'));

        var summary = overviewState.summary;
        if (summary.totalWasteMonthlyCost > 0) {
            var costCallout = el('div', 'license-waste-callout');
            var sym = summary.currency === 'NOK' ? 'kr' : summary.currency === 'USD' ? '$' : '';
            costCallout.textContent = sym + ' ' + summary.totalWasteMonthlyCost.toLocaleString() + '/mo wasted';
            panel.appendChild(costCallout);
        }

        for (var i = 0; i < sorted.length; i++) {
            var sku = sorted[i];
            var pct = sku.utilizationPercent || 0;

            var row = el('div', 'license-row');

            var name = el('div', 'license-name', sku.skuName);
            name.title = sku.skuName;
            row.appendChild(name);

            var barWrap = el('div', 'license-bar');
            var bar = el('div', 'progress-bar');
            var fill = el('div', 'progress-fill');
            if (pct >= 80) fill.className += ' success';
            else if (pct >= 40) fill.className += ' warning';
            else fill.className += ' critical';
            fill.style.width = pct + '%';
            bar.appendChild(fill);
            barWrap.appendChild(bar);
            row.appendChild(barWrap);

            var stats = el('div', 'license-stats', sku.totalAssigned + ' / ' + sku.totalPurchased);
            var pctSpan = el('span', 'license-pct');
            if (pct >= 80) pctSpan.className += ' text-success';
            else if (pct >= 40) pctSpan.className += ' text-warning';
            else pctSpan.className += ' text-critical';
            pctSpan.textContent = pct + '%';
            stats.appendChild(pctSpan);
            row.appendChild(stats);

            panel.appendChild(row);
        }

        container.appendChild(panel);
    }

    /**
     * Renders the recent activity panels.
     */
    function renderRecentActivity(container) {
        var grid = el('div', 'activity-grid');

        // PIM Activity panel
        var pimData = DataLoader.getData('pimActivity');
        var requests = pimData.filter(function(e) { return e.entryType === 'request'; });
        var recentPim = requests.slice(0, 5);

        var pimPanel = el('div', 'activity-panel');
        pimPanel.appendChild(el('div', 'activity-panel-title', 'Recent PIM Activity'));

        if (recentPim.length > 0) {
            var pimTable = el('table', 'activity-table');
            var pimHead = el('thead');
            var pimHeadRow = el('tr');
            ['User', 'Role', 'Action', 'Status'].forEach(function(h) {
                pimHeadRow.appendChild(el('th', null, h));
            });
            pimHead.appendChild(pimHeadRow);
            pimTable.appendChild(pimHead);

            var pimBody = el('tbody');
            recentPim.forEach(function(entry) {
                var tr = el('tr');
                tr.appendChild(el('td', null, entry.principalDisplayName || '--'));
                tr.appendChild(el('td', null, entry.roleName || '--'));
                tr.appendChild(el('td', null, formatActionLabel(entry.action)));
                tr.appendChild(el('td', null, entry.status || '--'));
                pimBody.appendChild(tr);
            });
            pimTable.appendChild(pimBody);
            pimPanel.appendChild(pimTable);
        } else {
            var emptyPim = el('div', 'text-muted', 'No recent PIM activity');
            emptyPim.style.fontSize = 'var(--font-size-xs)';
            pimPanel.appendChild(emptyPim);
        }

        var pimLink = el('a', 'activity-link', 'View all PIM activity');
        pimLink.addEventListener('click', function() { window.location.hash = 'pim'; });
        pimPanel.appendChild(pimLink);
        grid.appendChild(pimPanel);

        // Security Alerts panel
        var alerts = DataLoader.getData('defenderAlerts');
        var recentAlerts = alerts.slice(0, 5);

        var alertPanel = el('div', 'activity-panel');
        alertPanel.appendChild(el('div', 'activity-panel-title', 'Recent Security Alerts'));

        if (recentAlerts.length > 0) {
            var alertTable = el('table', 'activity-table');
            var alertHead = el('thead');
            var alertHeadRow = el('tr');
            ['Title', 'Severity', 'Status'].forEach(function(h) {
                alertHeadRow.appendChild(el('th', null, h));
            });
            alertHead.appendChild(alertHeadRow);
            alertTable.appendChild(alertHead);

            var alertBody = el('tbody');
            recentAlerts.forEach(function(alert) {
                var tr = el('tr');
                tr.appendChild(el('td', null, alert.title || alert.alertDisplayName || '--'));
                tr.appendChild(el('td', null, alert.severity || '--'));
                tr.appendChild(el('td', null, alert.status || '--'));
                alertBody.appendChild(tr);
            });
            alertTable.appendChild(alertBody);
            alertPanel.appendChild(alertTable);
        } else {
            var emptyAlert = el('div', 'text-muted', 'No recent alerts');
            emptyAlert.style.fontSize = 'var(--font-size-xs)';
            alertPanel.appendChild(emptyAlert);
        }

        var alertLink = el('a', 'activity-link', 'View all security details');
        alertLink.addEventListener('click', function() { window.location.hash = 'security'; });
        alertPanel.appendChild(alertLink);
        grid.appendChild(alertPanel);

        container.appendChild(grid);
    }

    /**
     * Creates a summary card.
     */
    function createSummaryCard(label, value, valueClass, cardClass, navigateTo) {
        var card = el('div', 'card' + (cardClass ? ' ' + cardClass : ''));
        if (navigateTo) {
            card.dataset.navigate = navigateTo;
            card.style.cursor = 'pointer';
        }
        card.appendChild(el('div', 'card-label', label));
        card.appendChild(el('div', 'card-value' + (valueClass ? ' ' + valueClass : ''), String(value)));
        return card;
    }

    /**
     * Maps PIM action keys to readable labels.
     */
    function formatActionLabel(action) {
        var labels = {
            'selfActivate': 'Self Activate',
            'adminAssign': 'Admin Assign',
            'adminRemove': 'Admin Remove',
            'selfDeactivate': 'Self Deactivate',
            'selfExtend': 'Self Extend',
            'selfRenew': 'Self Renew',
            'adminExtend': 'Admin Extend',
            'adminRenew': 'Admin Renew'
        };
        return labels[action] || action || '--';
    }

    /**
     * Renders the overview page content.
     */
    function render(container) {
        var summary = DataLoader.getSummary();

        // Recompute summary from department-filtered data if active
        if (typeof DepartmentFilter !== 'undefined' && DepartmentFilter.getSelected()) {
            var fUsers = DepartmentFilter.filterData(DataLoader.getData('users'), 'department');
            var fDevices = DepartmentFilter.filterByUPN(DataLoader.getData('devices'), 'userPrincipalName');
            var compliant = fDevices.filter(function(d) { return d.complianceState === 'compliant'; }).length;
            var mfaReg = fUsers.filter(function(u) { return u.mfaRegistered; }).length;
            summary = Object.assign({}, summary, {
                totalUsers: fUsers.length,
                employeeCount: fUsers.filter(function(u) { return u.domain === 'employee'; }).length,
                studentCount: fUsers.filter(function(u) { return u.domain === 'student'; }).length,
                otherCount: fUsers.filter(function(u) { return u.domain === 'other'; }).length,
                mfaRegisteredCount: mfaReg,
                noMfaUsers: fUsers.length - mfaReg,
                mfaPct: fUsers.length > 0 ? Math.round((mfaReg / fUsers.length) * 100) : 0,
                totalDevices: fDevices.length,
                compliantDevices: compliant,
                compliancePct: fDevices.length > 0 ? Math.round((compliant / fDevices.length) * 100) : 0
            });
        }

        // License stats
        var licenses = DataLoader.getData('licenseSkus') || [];
        var licenseStats = {
            totalSkus: licenses.length,
            avgUtilization: licenses.length > 0 ? Math.round(licenses.reduce(function(s, l) { return s + (l.utilizationPercent || 0); }, 0) / licenses.length) : 0,
            totalWaste: licenses.reduce(function(s, l) { return s + (l.wasteCount || 0); }, 0),
            wastePct: 0
        };
        var totalAssigned = licenses.reduce(function(s, l) { return s + (l.totalAssigned || 0); }, 0);
        if (totalAssigned > 0) {
            licenseStats.wastePct = Math.round((licenseStats.totalWaste / totalAssigned) * 100);
        }

        // Cache state
        overviewState = {
            summary: summary,
            licenseStats: licenseStats,
            secureScore: DataLoader.getData('secureScore')
        };

        container.textContent = '';

        // Page header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Overview'));
        header.appendChild(el('p', 'page-description', 'Summary of your Microsoft 365 tenant health and status'));
        container.appendChild(header);

        // Summary cards
        var cardsGrid = el('div', 'summary-cards');

        var userCard = createSummaryCard('Total Users', summary.totalUsers, null, null, 'users');
        var userChange = el('div', 'card-change', summary.employeeCount + ' employees, ' + summary.studentCount + ' students');
        userCard.appendChild(userChange);
        cardsGrid.appendChild(userCard);

        var mfaClass = summary.mfaPct >= 90 ? 'card-success' : (summary.mfaPct >= 70 ? 'card-warning' : 'card-critical');
        var mfaValClass = summary.mfaPct >= 90 ? 'success' : (summary.mfaPct >= 70 ? 'warning' : 'critical');
        var mfaCard = createSummaryCard('MFA Coverage', summary.mfaPct + '%', mfaValClass, mfaClass, 'security');
        mfaCard.appendChild(el('div', 'card-change', summary.noMfaUsers + ' users without MFA'));
        cardsGrid.appendChild(mfaCard);

        var compClass = summary.compliancePct >= 90 ? 'card-success' : (summary.compliancePct >= 70 ? 'card-warning' : 'card-critical');
        var compValClass = summary.compliancePct >= 90 ? 'success' : (summary.compliancePct >= 70 ? 'warning' : 'critical');
        var compCard = createSummaryCard('Device Compliance', summary.compliancePct + '%', compValClass, compClass, 'devices');
        compCard.appendChild(el('div', 'card-change', summary.compliantDevices + ' of ' + summary.totalDevices + ' devices'));
        cardsGrid.appendChild(compCard);

        var alertClass = summary.activeAlerts > 0 ? 'card-critical' : 'card-success';
        var alertValClass = summary.activeAlerts > 0 ? 'critical' : 'success';
        var alertCard = createSummaryCard('Active Alerts', summary.activeAlerts, alertValClass, alertClass, 'security');
        alertCard.appendChild(el('div', 'card-change', summary.activeAlerts > 0 ? 'Requires attention' : 'All clear'));
        cardsGrid.appendChild(alertCard);

        container.appendChild(cardsGrid);

        // Add trend indicators if available
        if (typeof TrendHelper !== 'undefined') {
            var history = DataLoader.getData('trendHistory');
            if (history && history.length > 0) {
                var cards = container.querySelectorAll('.card[data-navigate]');
                var trendMetrics = [
                    { key: 'totalUsers', value: summary.totalUsers },
                    { key: 'mfaPct', value: summary.mfaPct },
                    { key: 'compliancePct', value: summary.compliancePct },
                    { key: 'activeAlerts', value: summary.activeAlerts }
                ];
                cards.forEach(function(card, idx) {
                    if (trendMetrics[idx]) {
                        var trend = TrendHelper.getTrend(trendMetrics[idx].value, history, trendMetrics[idx].key);
                        if (trend) {
                            var indicator = TrendHelper.createIndicator(trend);
                            var valEl = card.querySelector('.card-value');
                            if (valEl) valEl.appendChild(indicator);
                        }
                    }
                });
            }
        }

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'stats', label: 'Quick Stats' }
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
        contentArea.id = 'overview-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        // Card navigation
        container.querySelectorAll('.card[data-navigate]').forEach(function(card) {
            card.addEventListener('click', function() {
                window.location.hash = card.dataset.navigate;
            });
        });

        currentTab = 'overview';
        renderContent();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageOverview = PageOverview;
