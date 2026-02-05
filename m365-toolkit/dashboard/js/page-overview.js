/**
 * ============================================================================
 * TenantScope
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: OVERVIEW
 *
 * Renders the overview dashboard with key metric cards, SVG donut charts,
 * license utilization bars, and recent activity panels.
 */

const PageOverview = (function() {
    'use strict';

    var C = DashboardCharts.colors;

    /**
     * Renders the overview page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var summary = DataLoader.getSummary();

        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Overview';
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'Summary of your Microsoft 365 tenant health and status';
        header.appendChild(h2);
        header.appendChild(desc);
        container.appendChild(header);

        // Row 1: Key metric cards
        renderKeyMetrics(container, summary);

        // Row 2: Donut charts
        renderCharts(container, summary);

        // Row 3: License utilization
        renderLicenseUtilization(container);

        // Row 4: Recent activity
        renderRecentActivity(container);

        // Card navigation click handlers
        var cards = container.querySelectorAll('.card[data-navigate]');
        cards.forEach(function(card) {
            card.addEventListener('click', function() {
                var page = card.dataset.navigate;
                window.location.hash = page;
            });
        });
    }

    /**
     * Renders the 4 key metric cards.
     */
    function renderKeyMetrics(container, s) {
        var grid = document.createElement('div');
        grid.className = 'cards-grid';

        // Total Users
        var userCard = createCard('Total Users', String(s.totalUsers), '', '');
        userCard.dataset.navigate = 'users';
        var userChange = document.createElement('div');
        userChange.className = 'card-change';
        userChange.textContent = s.employeeCount + ' employees, ' + s.studentCount + ' students';
        userCard.appendChild(userChange);
        grid.appendChild(userCard);

        // MFA Coverage
        var mfaClass = s.mfaPct >= 90 ? 'card-success' : (s.mfaPct >= 70 ? 'card-warning' : 'card-critical');
        var mfaValClass = s.mfaPct >= 90 ? 'success' : (s.mfaPct >= 70 ? 'warning' : 'critical');
        var mfaCard = createCard('MFA Coverage', s.mfaPct + '%', mfaClass, mfaValClass);
        mfaCard.dataset.navigate = 'security';
        var mfaChange = document.createElement('div');
        mfaChange.className = 'card-change';
        mfaChange.textContent = s.noMfaUsers + ' users without MFA';
        mfaCard.appendChild(mfaChange);
        grid.appendChild(mfaCard);

        // Device Compliance
        var compClass = s.compliancePct >= 90 ? 'card-success' : (s.compliancePct >= 70 ? 'card-warning' : 'card-critical');
        var compValClass = s.compliancePct >= 90 ? 'success' : (s.compliancePct >= 70 ? 'warning' : 'critical');
        var compCard = createCard('Device Compliance', s.compliancePct + '%', compClass, compValClass);
        compCard.dataset.navigate = 'devices';
        var compChange = document.createElement('div');
        compChange.className = 'card-change';
        compChange.textContent = s.compliantDevices + ' of ' + s.totalDevices + ' devices';
        compCard.appendChild(compChange);
        grid.appendChild(compCard);

        // Active Alerts
        var alertClass = s.activeAlerts > 0 ? 'card-critical' : 'card-success';
        var alertValClass = s.activeAlerts > 0 ? 'critical' : 'success';
        var alertCard = createCard('Active Alerts', String(s.activeAlerts), alertClass, alertValClass);
        alertCard.dataset.navigate = 'security';
        var alertChange = document.createElement('div');
        alertChange.className = 'card-change';
        alertChange.textContent = s.activeAlerts > 0 ? 'Requires attention' : 'All clear';
        alertCard.appendChild(alertChange);
        grid.appendChild(alertCard);

        container.appendChild(grid);
    }

    /**
     * Renders the 3 donut charts row.
     */
    function renderCharts(container, s) {
        var grid = document.createElement('div');
        grid.className = 'overview-charts-grid';

        // User Composition donut
        var userSegments = [
            { value: s.employeeCount, label: 'Employees', color: C.blue },
            { value: s.studentCount, label: 'Students', color: C.teal },
            { value: s.guestCount, label: 'Guests', color: C.purple },
            { value: s.otherCount, label: 'Other', color: C.gray }
        ];
        grid.appendChild(DashboardCharts.createChartCard(
            'User Composition', userSegments,
            String(s.totalUsers), 'total users'
        ));

        // MFA Status donut
        var mfaSegments = [
            { value: s.mfaRegisteredCount, label: 'Enrolled', color: C.green },
            { value: s.noMfaUsers, label: 'Not Enrolled', color: C.red }
        ];
        grid.appendChild(DashboardCharts.createChartCard(
            'MFA Status', mfaSegments,
            s.mfaPct + '%', 'coverage'
        ));

        // Device Compliance donut
        var deviceSegments = [
            { value: s.compliantDevices, label: 'Compliant', color: C.green },
            { value: s.nonCompliantDevices, label: 'Non-Compliant', color: C.red },
            { value: s.unknownDevices, label: 'Unknown', color: C.gray }
        ];
        grid.appendChild(DashboardCharts.createChartCard(
            'Device Compliance', deviceSegments,
            s.compliancePct + '%', 'compliant'
        ));

        container.appendChild(grid);
    }

    /**
     * Renders the license utilization section.
     */
    function renderLicenseUtilization(container) {
        var licenses = DataLoader.getData('licenseSkus');
        if (!licenses || licenses.length === 0) return;

        // Sort by utilization descending
        var sorted = licenses.slice().sort(function(a, b) {
            return (b.utilizationPercent || 0) - (a.utilizationPercent || 0);
        });

        var panel = document.createElement('div');
        panel.className = 'license-grid';

        var title = document.createElement('div');
        title.className = 'license-grid-title';
        title.textContent = 'License Utilization';
        panel.appendChild(title);

        for (var i = 0; i < sorted.length; i++) {
            var sku = sorted[i];
            var pct = sku.utilizationPercent || 0;

            var row = document.createElement('div');
            row.className = 'license-row';

            // Name
            var name = document.createElement('div');
            name.className = 'license-name';
            name.textContent = sku.skuName;
            name.title = sku.skuName;
            row.appendChild(name);

            // Progress bar
            var barWrap = document.createElement('div');
            barWrap.className = 'license-bar';

            var bar = document.createElement('div');
            bar.className = 'progress-bar';
            var fill = document.createElement('div');
            fill.className = 'progress-fill';
            if (pct >= 80) fill.className += ' success';
            else if (pct >= 40) fill.className += ' warning';
            else fill.className += ' critical';
            fill.style.width = pct + '%';
            bar.appendChild(fill);
            barWrap.appendChild(bar);
            row.appendChild(barWrap);

            // Stats
            var stats = document.createElement('div');
            stats.className = 'license-stats';
            stats.textContent = sku.totalAssigned + ' / ' + sku.totalPurchased;

            var pctSpan = document.createElement('span');
            pctSpan.className = 'license-pct';
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
     * Renders the recent activity panels (PIM + Alerts).
     */
    function renderRecentActivity(container) {
        var grid = document.createElement('div');
        grid.className = 'activity-grid';

        // PIM Activity panel
        var pimData = DataLoader.getData('pimActivity');
        var requests = pimData.filter(function(e) { return e.entryType === 'request'; });
        var recentPim = requests.slice(0, 5);

        var pimPanel = document.createElement('div');
        pimPanel.className = 'activity-panel';

        var pimTitle = document.createElement('div');
        pimTitle.className = 'activity-panel-title';
        pimTitle.textContent = 'Recent PIM Activity';
        pimPanel.appendChild(pimTitle);

        if (recentPim.length > 0) {
            var pimTable = document.createElement('table');
            pimTable.className = 'activity-table';

            var pimHead = document.createElement('thead');
            var pimHeadRow = document.createElement('tr');
            ['User', 'Role', 'Action', 'Status'].forEach(function(h) {
                var th = document.createElement('th');
                th.textContent = h;
                pimHeadRow.appendChild(th);
            });
            pimHead.appendChild(pimHeadRow);
            pimTable.appendChild(pimHead);

            var pimBody = document.createElement('tbody');
            recentPim.forEach(function(entry) {
                var tr = document.createElement('tr');
                var tdUser = document.createElement('td');
                tdUser.textContent = entry.principalDisplayName || '--';
                tr.appendChild(tdUser);

                var tdRole = document.createElement('td');
                tdRole.textContent = entry.roleName || '--';
                tr.appendChild(tdRole);

                var tdAction = document.createElement('td');
                tdAction.textContent = formatActionLabel(entry.action);
                tr.appendChild(tdAction);

                var tdStatus = document.createElement('td');
                tdStatus.textContent = entry.status || '--';
                tr.appendChild(tdStatus);

                pimBody.appendChild(tr);
            });
            pimTable.appendChild(pimBody);
            pimPanel.appendChild(pimTable);
        } else {
            var emptyPim = document.createElement('div');
            emptyPim.className = 'text-muted';
            emptyPim.style.fontSize = 'var(--font-size-xs)';
            emptyPim.textContent = 'No recent PIM activity';
            pimPanel.appendChild(emptyPim);
        }

        var pimLink = document.createElement('a');
        pimLink.className = 'activity-link';
        pimLink.textContent = 'View all PIM activity';
        pimLink.addEventListener('click', function() { window.location.hash = 'pim'; });
        pimPanel.appendChild(pimLink);

        grid.appendChild(pimPanel);

        // Security Alerts panel
        var alerts = DataLoader.getData('defenderAlerts');
        var recentAlerts = alerts.slice(0, 5);

        var alertPanel = document.createElement('div');
        alertPanel.className = 'activity-panel';

        var alertTitle = document.createElement('div');
        alertTitle.className = 'activity-panel-title';
        alertTitle.textContent = 'Recent Security Alerts';
        alertPanel.appendChild(alertTitle);

        if (recentAlerts.length > 0) {
            var alertTable = document.createElement('table');
            alertTable.className = 'activity-table';

            var alertHead = document.createElement('thead');
            var alertHeadRow = document.createElement('tr');
            ['Title', 'Severity', 'Status'].forEach(function(h) {
                var th = document.createElement('th');
                th.textContent = h;
                alertHeadRow.appendChild(th);
            });
            alertHead.appendChild(alertHeadRow);
            alertTable.appendChild(alertHead);

            var alertBody = document.createElement('tbody');
            recentAlerts.forEach(function(alert) {
                var tr = document.createElement('tr');
                var tdTitle = document.createElement('td');
                tdTitle.textContent = alert.title || alert.alertDisplayName || '--';
                tr.appendChild(tdTitle);

                var tdSev = document.createElement('td');
                tdSev.textContent = alert.severity || '--';
                tr.appendChild(tdSev);

                var tdStat = document.createElement('td');
                tdStat.textContent = alert.status || '--';
                tr.appendChild(tdStat);

                alertBody.appendChild(tr);
            });
            alertTable.appendChild(alertBody);
            alertPanel.appendChild(alertTable);
        } else {
            var emptyAlert = document.createElement('div');
            emptyAlert.className = 'text-muted';
            emptyAlert.style.fontSize = 'var(--font-size-xs)';
            emptyAlert.textContent = 'No recent alerts';
            alertPanel.appendChild(emptyAlert);
        }

        var alertLink = document.createElement('a');
        alertLink.className = 'activity-link';
        alertLink.textContent = 'View all security details';
        alertLink.addEventListener('click', function() { window.location.hash = 'security'; });
        alertPanel.appendChild(alertLink);

        grid.appendChild(alertPanel);
        container.appendChild(grid);
    }

    /**
     * Creates a summary card DOM element.
     */
    function createCard(label, value, cardClass, valueClass) {
        var card = document.createElement('div');
        card.className = 'card' + (cardClass ? ' ' + cardClass : '');
        card.style.cursor = 'pointer';

        var lbl = document.createElement('div');
        lbl.className = 'card-label';
        lbl.textContent = label;
        card.appendChild(lbl);

        var val = document.createElement('div');
        val.className = 'card-value' + (valueClass ? ' ' + valueClass : '');
        val.textContent = value;
        card.appendChild(val);

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

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageOverview = PageOverview;
