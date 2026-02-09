/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: EXECUTIVE REPORT
 *
 * One-page print-friendly executive summary. Uses browser print (zero deps).
 * Composites a Health Score from multiple metrics, surfaces top risks,
 * license waste costs, key metrics, and governance posture.
 */

const PageReport = (function() {
    'use strict';

    var C = DashboardCharts.colors;

    /**
     * Formats a number as currency using the tenant's configured currency.
     *
     * @param {number} value - The numeric value
     * @param {string} currency - Currency code (e.g., "NOK")
     * @returns {string} Formatted currency string
     */
    function formatCurrency(value, currency) {
        var code = currency || 'NOK';
        if (value === null || value === undefined || isNaN(Number(value))) {
            return code + ' 0';
        }
        var numVal = Number(value);
        try {
            return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(numVal);
        } catch (e) {
            return code + ' ' + Math.round(numVal).toLocaleString();
        }
    }

    /**
     * Computes the composite health score (0-100) from weighted metrics.
     *
     * Weights: MFA 25%, Device Compliance 25%, Secure Score 25%,
     *          Guest Hygiene 15%, License Efficiency 10%
     *
     * @param {object} summary - DataLoader summary object
     * @param {object|null} secureScore - Secure score data
     * @returns {object} { score, breakdown }
     */
    function computeHealthScore(summary, secureScore) {
        var breakdown = [];

        // MFA Coverage (25%)
        var mfaPct = summary.mfaPct || 0;
        breakdown.push({ label: 'MFA Coverage', value: mfaPct, weight: 25, weighted: Math.round(mfaPct * 0.25) });

        // Device Compliance (25%)
        var compPct = summary.compliancePct || 0;
        breakdown.push({ label: 'Device Compliance', value: compPct, weight: 25, weighted: Math.round(compPct * 0.25) });

        // Secure Score (25%)
        var sscore = (secureScore && secureScore.scorePct) ? secureScore.scorePct : 0;
        breakdown.push({ label: 'Secure Score', value: sscore, weight: 25, weighted: Math.round(sscore * 0.25) });

        // Guest Hygiene (15%) - % of guests that are NOT stale
        var guestTotal = summary.guestCount || 0;
        var staleGuests = summary.staleGuests || 0;
        var guestHealthPct = guestTotal > 0 ? Math.round(((guestTotal - staleGuests) / guestTotal) * 100) : 100;
        breakdown.push({ label: 'Guest Hygiene', value: guestHealthPct, weight: 15, weighted: Math.round(guestHealthPct * 0.15) });

        // License Efficiency (10%) - inverse of waste ratio
        var totalCost = summary.totalEstimatedMonthlyCost || 0;
        var wasteCost = summary.totalWasteMonthlyCost || 0;
        var licEffPct = totalCost > 0 ? Math.round(((totalCost - wasteCost) / totalCost) * 100) : 100;
        breakdown.push({ label: 'License Efficiency', value: licEffPct, weight: 10, weighted: Math.round(licEffPct * 0.10) });

        var score = 0;
        for (var i = 0; i < breakdown.length; i++) {
            score += breakdown[i].weighted;
        }

        return { score: Math.min(score, 100), breakdown: breakdown };
    }

    /**
     * Auto-generates top risks ranked by severity.
     *
     * @param {object} summary - DataLoader summary object
     * @param {object|null} secureScore - Secure score data
     * @returns {Array} Sorted risk objects { severity, title, detail }
     */
    function generateRisks(summary, secureScore) {
        var risks = [];

        // No MFA users
        if (summary.noMfaUsers > 0) {
            risks.push({
                severity: summary.noMfaUsers > 10 ? 'critical' : 'warning',
                weight: summary.noMfaUsers * 10,
                title: summary.noMfaUsers + ' users without MFA',
                detail: 'Accounts without multi-factor authentication are vulnerable to credential attacks.'
            });
        }

        // Non-compliant devices
        var nonCompliant = summary.nonCompliantDevices || 0;
        if (nonCompliant > 0) {
            risks.push({
                severity: nonCompliant > 20 ? 'critical' : 'warning',
                weight: nonCompliant * 5,
                title: nonCompliant + ' non-compliant devices',
                detail: 'Devices failing compliance policies may lack encryption, updates, or security baselines.'
            });
        }

        // Active alerts
        var activeAlerts = summary.activeAlerts || 0;
        if (activeAlerts > 0) {
            risks.push({
                severity: activeAlerts > 5 ? 'critical' : 'warning',
                weight: activeAlerts * 15,
                title: activeAlerts + ' active security alerts',
                detail: 'Unresolved Defender alerts require investigation and remediation.'
            });
        }

        // License waste
        var wasteCost = summary.totalWasteMonthlyCost || 0;
        if (wasteCost > 0) {
            risks.push({
                severity: 'info',
                weight: Math.min(wasteCost / 10, 50),
                title: formatCurrency(wasteCost, summary.currency) + '/mo in license waste',
                detail: 'Licenses assigned to disabled or inactive users represent recoverable cost.'
            });
        }

        // Stale guests
        var staleGuests = summary.staleGuests || 0;
        if (staleGuests > 0) {
            risks.push({
                severity: staleGuests > 10 ? 'warning' : 'info',
                weight: staleGuests * 3,
                title: staleGuests + ' stale guest accounts',
                detail: 'Guest accounts with no recent sign-in may pose an external access risk.'
            });
        }

        // Ownerless teams
        var ownerlessTeams = summary.ownerlessTeams || 0;
        if (ownerlessTeams > 0) {
            risks.push({
                severity: 'warning',
                weight: ownerlessTeams * 4,
                title: ownerlessTeams + ' ownerless teams',
                detail: 'Teams without owners cannot be managed and may accumulate stale content.'
            });
        }

        // Anonymous sharing links
        var anonSites = summary.anonymousLinkSites || 0;
        if (anonSites > 0) {
            risks.push({
                severity: 'warning',
                weight: anonSites * 6,
                title: anonSites + ' sites with anonymous sharing links',
                detail: 'Anonymous links allow unauthenticated access to organizational content.'
            });
        }

        // Low secure score
        if (secureScore && secureScore.scorePct < 50) {
            risks.push({
                severity: 'critical',
                weight: (100 - secureScore.scorePct),
                title: 'Secure Score at ' + secureScore.scorePct + '%',
                detail: 'Score is below 50% -- review recommended improvement actions in Microsoft 365 Defender.'
            });
        }

        // Sites without sensitivity labels
        var noLabelSites = summary.noLabelSites || 0;
        if (noLabelSites > 0) {
            risks.push({
                severity: 'info',
                weight: noLabelSites * 2,
                title: noLabelSites + ' sites without sensitivity labels',
                detail: 'Sites without classification labels may not have appropriate data protection policies.'
            });
        }

        // Sort by weight descending
        risks.sort(function(a, b) { return b.weight - a.weight; });

        return risks.slice(0, 5);
    }

    /**
     * Creates a DOM element with optional class and text content.
     */
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /**
     * Renders the report header with print button and timestamp.
     */
    function renderHeader(page) {
        var header = el('div', 'report-header');

        var titleRow = el('div', 'report-title-row');
        var h2 = el('h2', 'page-title', 'Executive Summary');
        titleRow.appendChild(h2);

        var printBtn = el('button', 'report-print-btn no-print', 'Print Report');
        printBtn.addEventListener('click', function() { window.print(); });
        titleRow.appendChild(printBtn);
        header.appendChild(titleRow);

        var metadata = DataLoader.getData('metadata');
        var dateStr = metadata && metadata.endTime ? DataLoader.formatDate(metadata.endTime) : new Date().toLocaleDateString();
        var sub = el('p', 'page-description', 'Generated: ' + dateStr);
        header.appendChild(sub);

        page.appendChild(header);
    }

    /**
     * Renders the health score donut and breakdown table.
     */
    function renderHealthScore(page, health) {
        var section = el('div', 'report-section');
        section.appendChild(el('h3', 'report-section-title', 'Tenant Health Score'));

        var row = el('div', 'report-health-row');

        // Donut chart
        var chartWrap = el('div', 'report-health-chart');
        var scoreColor = health.score >= 70 ? C.green : (health.score >= 40 ? C.yellow : C.red);
        DashboardCharts.createDonutChart(chartWrap,
            [
                { value: health.score, label: 'Score', color: scoreColor },
                { value: 100 - health.score, label: 'Remaining', color: '#e5e7eb' }
            ],
            health.score + '%', 'health', { size: 140, strokeWidth: 20 }
        );
        row.appendChild(chartWrap);

        // Breakdown table
        var breakdownWrap = el('div', 'report-health-breakdown');
        var table = el('table', 'report-breakdown-table');
        var thead = el('thead');
        var headRow = el('tr');
        headRow.appendChild(el('th', '', 'Metric'));
        headRow.appendChild(el('th', '', 'Score'));
        headRow.appendChild(el('th', '', 'Weight'));
        headRow.appendChild(el('th', '', 'Weighted'));
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        for (var i = 0; i < health.breakdown.length; i++) {
            var b = health.breakdown[i];
            var tr = el('tr');
            tr.appendChild(el('td', '', b.label));
            tr.appendChild(el('td', '', b.value + '%'));
            tr.appendChild(el('td', '', b.weight + '%'));
            tr.appendChild(el('td', '', b.weighted + 'pts'));
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        breakdownWrap.appendChild(table);
        row.appendChild(breakdownWrap);

        section.appendChild(row);
        page.appendChild(section);
    }

    /**
     * Renders the top risks list.
     */
    function renderRisks(page, risks) {
        var section = el('div', 'report-section');
        section.appendChild(el('h3', 'report-section-title', 'Top Risks'));

        if (risks.length === 0) {
            section.appendChild(el('p', 'text-success', 'No significant risks detected.'));
            page.appendChild(section);
            return;
        }

        var list = el('div', 'risk-list');
        for (var i = 0; i < risks.length; i++) {
            var r = risks[i];
            var item = el('div', 'risk-item risk-' + r.severity);
            item.appendChild(el('div', 'risk-title', r.title));
            item.appendChild(el('div', 'risk-detail', r.detail));
            list.appendChild(item);
        }
        section.appendChild(list);
        page.appendChild(section);
    }

    /**
     * Renders the key metrics grid (6 big-number cards).
     */
    function renderMetricsGrid(page, summary, secureScore) {
        var section = el('div', 'report-section');
        section.appendChild(el('h3', 'report-section-title', 'Key Metrics'));

        var grid = el('div', 'report-metrics-grid');

        var metrics = [
            { label: 'Total Users', value: String(summary.totalUsers) },
            { label: 'MFA Coverage', value: summary.mfaPct + '%' },
            { label: 'Device Compliance', value: summary.compliancePct + '%' },
            { label: 'Secure Score', value: secureScore && secureScore.scorePct !== undefined ? secureScore.scorePct + '%' : '--' },
            { label: 'Monthly Waste', value: formatCurrency(summary.totalWasteMonthlyCost || 0, summary.currency) },
            { label: 'Guest Accounts', value: String(summary.guestCount || 0) }
        ];

        for (var i = 0; i < metrics.length; i++) {
            var card = el('div', 'report-metric-card');
            card.appendChild(el('div', 'report-metric-value', metrics[i].value));
            card.appendChild(el('div', 'report-metric-label', metrics[i].label));
            grid.appendChild(card);
        }

        section.appendChild(grid);
        page.appendChild(section);
    }

    /**
     * Renders the license waste summary table (top 5 SKUs by waste cost).
     */
    function renderLicenseWaste(page, summary) {
        var licenseSkus = DataLoader.getData('licenseSkus') || [];
        if (licenseSkus.length === 0) return;

        // Sort by waste cost descending
        var sorted = licenseSkus.slice().sort(function(a, b) {
            return (b.wasteMonthlyCost || 0) - (a.wasteMonthlyCost || 0);
        });

        // Only show SKUs with waste
        var withWaste = sorted.filter(function(l) { return (l.wasteMonthlyCost || 0) > 0; });
        if (withWaste.length === 0) return;

        var top5 = withWaste.slice(0, 5);

        var section = el('div', 'report-section');
        section.appendChild(el('h3', 'report-section-title', 'License Waste Summary'));

        var table = el('table', 'report-waste-table');
        var thead = el('thead');
        var headRow = el('tr');
        headRow.appendChild(el('th', '', 'License'));
        headRow.appendChild(el('th', '', 'Wasted'));
        headRow.appendChild(el('th', '', 'Monthly Cost'));
        headRow.appendChild(el('th', '', 'Annual Cost'));
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        for (var i = 0; i < top5.length; i++) {
            var l = top5[i];
            var tr = el('tr');
            tr.appendChild(el('td', '', l.displayName || l.skuPartNumber));
            tr.appendChild(el('td', '', String(l.wasteCount || 0) + ' licenses'));
            tr.appendChild(el('td', 'text-critical', formatCurrency(l.wasteMonthlyCost || 0, l.currency)));
            tr.appendChild(el('td', 'text-critical', formatCurrency((l.wasteMonthlyCost || 0) * 12, l.currency)));
            tbody.appendChild(tr);
        }

        // Total row
        var totalTr = el('tr', 'report-waste-total');
        totalTr.appendChild(el('td', 'font-bold', 'Total'));
        totalTr.appendChild(el('td', '', ''));
        totalTr.appendChild(el('td', 'font-bold text-critical', formatCurrency(summary.totalWasteMonthlyCost || 0, summary.currency)));
        totalTr.appendChild(el('td', 'font-bold text-critical', formatCurrency(summary.totalWasteAnnualCost || 0, summary.currency)));
        tbody.appendChild(totalTr);

        table.appendChild(tbody);
        section.appendChild(table);
        page.appendChild(section);
    }

    /**
     * Renders governance summary for SharePoint and Teams.
     */
    function renderGovernance(page, summary) {
        var section = el('div', 'report-section');
        section.appendChild(el('h3', 'report-section-title', 'Governance Summary'));

        var grid = el('div', 'report-governance-grid');

        // SharePoint governance
        var spCard = el('div', 'report-governance-card');
        spCard.appendChild(el('h4', 'report-governance-subtitle', 'SharePoint'));
        var spItems = [
            { label: 'Total Sites', value: summary.totalSites || 0 },
            { label: 'External Sharing Enabled', value: summary.externalSharingSites || 0 },
            { label: 'Anonymous Links', value: summary.anonymousLinkSites || 0 },
            { label: 'Without Sensitivity Labels', value: summary.noLabelSites || 0 },
            { label: 'Inactive Sites', value: summary.inactiveSites || 0 }
        ];
        for (var i = 0; i < spItems.length; i++) {
            var row = el('div', 'report-governance-row');
            row.appendChild(el('span', 'report-governance-label', spItems[i].label));
            row.appendChild(el('span', 'report-governance-value', String(spItems[i].value)));
            spCard.appendChild(row);
        }
        grid.appendChild(spCard);

        // Teams governance
        var tCard = el('div', 'report-governance-card');
        tCard.appendChild(el('h4', 'report-governance-subtitle', 'Teams'));
        var tItems = [
            { label: 'Total Teams', value: summary.totalTeams || 0 },
            { label: 'Ownerless Teams', value: summary.ownerlessTeams || 0 },
            { label: 'Inactive Teams', value: summary.inactiveTeams || 0 },
            { label: 'Teams with Guests', value: summary.teamsWithGuests || 0 },
            { label: 'Public Teams', value: summary.publicTeams || 0 }
        ];
        for (var j = 0; j < tItems.length; j++) {
            var tRow = el('div', 'report-governance-row');
            tRow.appendChild(el('span', 'report-governance-label', tItems[j].label));
            tRow.appendChild(el('span', 'report-governance-value', String(tItems[j].value)));
            tCard.appendChild(tRow);
        }
        grid.appendChild(tCard);

        section.appendChild(grid);
        page.appendChild(section);
    }

    /**
     * Renders the executive report page.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var summary = DataLoader.getSummary();
        var secureScore = DataLoader.getData('secureScore');
        if (Array.isArray(secureScore) && secureScore.length === 0) secureScore = null;

        var health = computeHealthScore(summary, secureScore);
        var risks = generateRisks(summary, secureScore);

        var page = el('div', 'report-page');

        renderHeader(page);
        renderHealthScore(page, health);
        renderRisks(page, risks);
        renderMetricsGrid(page, summary, secureScore);
        renderLicenseWaste(page, summary);
        renderGovernance(page, summary);

        container.appendChild(page);
    }

    return {
        render: render
    };

})();

window.PageReport = PageReport;
