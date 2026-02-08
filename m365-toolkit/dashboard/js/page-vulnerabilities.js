/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: VULNERABILITIES
 *
 * Displays CVE/vulnerability data from Microsoft Defender with severity
 * breakdown, affected devices, and patch status.
 */

const PageVulnerabilities = (function() {
    'use strict';

    var currentTab = 'overview';

    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('vuln-content');
        if (!container) return;

        var data = DataLoader.getData('vulnerabilities') || {};
        var vulns = data.vulnerabilities || [];

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container, vulns, data.summary, data.insights);
                break;
            case 'all':
                renderAllVulnsTab(container, vulns);
                break;
            case 'exploited':
                renderExploitedTab(container, vulns);
                break;
        }
    }

    function renderOverviewTab(container, vulns, summary, insights) {
        container.textContent = '';
        summary = summary || {};
        insights = insights || [];

        // Summary Cards
        var cards = el('div', 'signal-cards');

        // Total Vulnerabilities
        var totalCard = el('div', 'signal-card signal-card--info');
        totalCard.appendChild(el('div', 'signal-card-value', String(summary.totalVulnerabilities || vulns.length)));
        totalCard.appendChild(el('div', 'signal-card-label', 'Total CVEs'));
        cards.appendChild(totalCard);

        // Critical
        var critCount = summary.criticalCount || vulns.filter(function(v) { return v.severity === 'critical'; }).length;
        var critCard = el('div', 'signal-card signal-card--' + (critCount > 0 ? 'critical' : 'success'));
        critCard.appendChild(el('div', 'signal-card-value', String(critCount)));
        critCard.appendChild(el('div', 'signal-card-label', 'Critical'));
        cards.appendChild(critCard);

        // High
        var highCount = summary.highCount || vulns.filter(function(v) { return v.severity === 'high'; }).length;
        var highCard = el('div', 'signal-card signal-card--' + (highCount > 0 ? 'warning' : 'success'));
        highCard.appendChild(el('div', 'signal-card-value', String(highCount)));
        highCard.appendChild(el('div', 'signal-card-label', 'High'));
        cards.appendChild(highCard);

        // Exploited in Wild
        var exploitedCount = summary.exploitedInWild || vulns.filter(function(v) { return v.exploitedInWild; }).length;
        var exploitedCard = el('div', 'signal-card signal-card--' + (exploitedCount > 0 ? 'critical' : 'success'));
        exploitedCard.appendChild(el('div', 'signal-card-value', String(exploitedCount)));
        exploitedCard.appendChild(el('div', 'signal-card-label', 'Actively Exploited'));
        cards.appendChild(exploitedCard);

        // Affected Devices
        var affectedDevices = summary.totalAffectedDevices || 0;
        var affectedCard = el('div', 'signal-card signal-card--warning');
        affectedCard.appendChild(el('div', 'signal-card-value', String(affectedDevices)));
        affectedCard.appendChild(el('div', 'signal-card-label', 'Affected Devices'));
        cards.appendChild(affectedCard);

        container.appendChild(cards);

        // Insights Section
        if (insights.length > 0) {
            var insightsSection = el('div', 'analytics-section');
            insightsSection.appendChild(el('h3', null, 'Security Insights'));

            var insightsList = el('div', 'insights-list');
            insights.forEach(function(insight) {
                var card = el('div', 'insight-card insight-' + insight.severity);
                var header = el('div', 'insight-header');
                header.appendChild(el('span', 'badge badge-' + insight.severity, insight.severity.toUpperCase()));
                header.appendChild(el('span', 'insight-category', insight.title));
                card.appendChild(header);
                card.appendChild(el('p', 'insight-description', insight.description));
                if (insight.recommendedAction) {
                    var actionP = el('p', 'insight-action');
                    actionP.appendChild(el('strong', null, 'Action: '));
                    actionP.appendChild(document.createTextNode(insight.recommendedAction));
                    card.appendChild(actionP);
                }
                insightsList.appendChild(card);
            });
            insightsSection.appendChild(insightsList);
            container.appendChild(insightsSection);
        }

        // Severity Breakdown
        var breakdownSection = el('div', 'analytics-section');
        breakdownSection.appendChild(el('h3', null, 'Severity Breakdown'));

        var medCount = summary.mediumCount || vulns.filter(function(v) { return v.severity === 'medium'; }).length;
        var lowCount = summary.lowCount || vulns.filter(function(v) { return v.severity === 'low'; }).length;

        var heatmap = el('div', 'risk-heatmap');
        var bar = el('div', 'heatmap-bar');
        var total = critCount + highCount + medCount + lowCount;
        if (total > 0) {
            if (critCount > 0) {
                var critSeg = el('div', 'heatmap-segment bg-critical');
                critSeg.style.width = (critCount / total * 100) + '%';
                bar.appendChild(critSeg);
            }
            if (highCount > 0) {
                var highSeg = el('div', 'heatmap-segment bg-warning');
                highSeg.style.width = (highCount / total * 100) + '%';
                bar.appendChild(highSeg);
            }
            if (medCount > 0) {
                var medSeg = el('div', 'heatmap-segment bg-info');
                medSeg.style.width = (medCount / total * 100) + '%';
                bar.appendChild(medSeg);
            }
            if (lowCount > 0) {
                var lowSeg = el('div', 'heatmap-segment bg-success');
                lowSeg.style.width = (lowCount / total * 100) + '%';
                bar.appendChild(lowSeg);
            }
        }
        heatmap.appendChild(bar);

        var legend = el('div', 'heatmap-legend');
        legend.appendChild(createLegendItem('Critical', critCount, 'bg-critical'));
        legend.appendChild(createLegendItem('High', highCount, 'bg-warning'));
        legend.appendChild(createLegendItem('Medium', medCount, 'bg-info'));
        legend.appendChild(createLegendItem('Low', lowCount, 'bg-success'));
        heatmap.appendChild(legend);
        breakdownSection.appendChild(heatmap);
        container.appendChild(breakdownSection);

        // Top Critical/Exploited CVEs Table
        var criticalVulns = vulns.filter(function(v) {
            return v.severity === 'critical' || v.exploitedInWild;
        }).sort(function(a, b) {
            return (b.cvssScore || 0) - (a.cvssScore || 0);
        });

        if (criticalVulns.length > 0) {
            var tableSection = el('div', 'analytics-section');
            tableSection.appendChild(el('h3', null, 'Priority Vulnerabilities'));
            var desc = el('p', null, 'Critical severity or actively exploited CVEs requiring immediate attention.');
            desc.style.color = 'var(--color-text-muted)';
            tableSection.appendChild(desc);

            var table = el('table', 'data-table');
            var thead = el('thead');
            var headerRow = el('tr');
            ['CVE ID', 'Name', 'Severity', 'CVSS', 'Exploited', 'Devices', 'Patch'].forEach(function(h) {
                headerRow.appendChild(el('th', null, h));
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);

            var tbody = el('tbody');
            criticalVulns.slice(0, 10).forEach(function(v) {
                var row = el('tr');
                row.appendChild(el('td', 'font-bold', v.id));
                var nameCell = el('td');
                nameCell.textContent = (v.name || '').substring(0, 40);
                row.appendChild(nameCell);

                var sevCell = el('td');
                var sevBadge = el('span', 'badge badge-' + (v.severity === 'critical' ? 'critical' : v.severity === 'high' ? 'warning' : 'info'));
                sevBadge.textContent = v.severity.toUpperCase();
                sevCell.appendChild(sevBadge);
                row.appendChild(sevCell);

                row.appendChild(el('td', 'cell-right', String(v.cvssScore || '--')));

                var exploitCell = el('td');
                if (v.exploitedInWild) {
                    var exploitBadge = el('span', 'badge badge-critical');
                    exploitBadge.textContent = 'YES';
                    exploitCell.appendChild(exploitBadge);
                } else {
                    exploitCell.textContent = 'No';
                }
                row.appendChild(exploitCell);

                row.appendChild(el('td', 'cell-right', String(v.affectedDevices || 0)));

                var patchCell = el('td');
                if (v.patchAvailable) {
                    var patchBadge = el('span', 'badge badge-success');
                    patchBadge.textContent = 'Available';
                    patchCell.appendChild(patchBadge);
                } else {
                    var noPatchBadge = el('span', 'badge badge-warning');
                    noPatchBadge.textContent = 'Pending';
                    patchCell.appendChild(noPatchBadge);
                }
                row.appendChild(patchCell);

                tbody.appendChild(row);
            });
            table.appendChild(tbody);

            var tableWrap = el('div', 'table-container');
            tableWrap.appendChild(table);
            tableSection.appendChild(tableWrap);
            container.appendChild(tableSection);
        }
    }

    function createLegendItem(label, count, colorClass) {
        var item = el('span', 'legend-item');
        var dot = el('span', 'legend-dot ' + colorClass);
        item.appendChild(dot);
        item.appendChild(document.createTextNode(label + ' ' + count));
        return item;
    }

    function renderAllVulnsTab(container, vulns) {
        container.textContent = '';

        if (vulns.length === 0) {
            var empty = el('div', 'empty-state');
            empty.appendChild(el('div', 'empty-state-icon', '\u2713'));
            empty.appendChild(el('div', 'empty-state-title', 'No Vulnerabilities Detected'));
            empty.appendChild(el('div', 'empty-state-description', 'No CVEs affecting your managed devices.'));
            container.appendChild(empty);
            return;
        }

        var sorted = vulns.slice().sort(function(a, b) {
            var sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return (sevOrder[a.severity] || 4) - (sevOrder[b.severity] || 4);
        });

        var table = el('table', 'data-table');
        var thead = el('thead');
        var headerRow = el('tr');
        ['CVE ID', 'Name', 'Severity', 'CVSS', 'Product', 'Exploited', 'Devices', 'Patch', 'Action'].forEach(function(h) {
            headerRow.appendChild(el('th', null, h));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        sorted.forEach(function(v) {
            var row = el('tr');
            row.appendChild(el('td', 'font-bold', v.id));
            var nameCell = el('td');
            nameCell.textContent = (v.name || '').substring(0, 35);
            row.appendChild(nameCell);

            var sevCell = el('td');
            var sevClass = v.severity === 'critical' ? 'critical' : v.severity === 'high' ? 'warning' : v.severity === 'medium' ? 'info' : 'success';
            var sevBadge = el('span', 'badge badge-' + sevClass);
            sevBadge.textContent = (v.severity || 'unknown').toUpperCase();
            sevCell.appendChild(sevBadge);
            row.appendChild(sevCell);

            row.appendChild(el('td', 'cell-right', String(v.cvssScore || '--')));
            row.appendChild(el('td', null, (v.product || '--').substring(0, 20)));

            var exploitCell = el('td');
            if (v.exploitedInWild) {
                var exploitBadge = el('span', 'badge badge-critical');
                exploitBadge.textContent = 'YES';
                exploitCell.appendChild(exploitBadge);
            } else {
                exploitCell.textContent = 'No';
            }
            row.appendChild(exploitCell);

            row.appendChild(el('td', 'cell-right', String(v.affectedDevices || 0)));

            var patchCell = el('td');
            if (v.patchAvailable) {
                var patchBadge = el('span', 'badge badge-success');
                patchBadge.textContent = 'Yes';
                patchCell.appendChild(patchBadge);
            } else {
                patchCell.textContent = 'No';
            }
            row.appendChild(patchCell);

            var actionCell = el('td');
            actionCell.style.fontSize = 'var(--font-size-xs)';
            actionCell.textContent = (v.recommendedAction || '--').substring(0, 30);
            row.appendChild(actionCell);

            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        var tableWrap = el('div', 'table-container');
        tableWrap.appendChild(table);
        container.appendChild(tableWrap);
    }

    function renderExploitedTab(container, vulns) {
        container.textContent = '';

        var exploited = vulns.filter(function(v) { return v.exploitedInWild; });

        if (exploited.length === 0) {
            var empty = el('div', 'empty-state');
            empty.appendChild(el('div', 'empty-state-icon', '\u2713'));
            empty.appendChild(el('div', 'empty-state-title', 'No Active Exploits'));
            empty.appendChild(el('div', 'empty-state-description', 'No CVEs with known active exploitation detected.'));
            container.appendChild(empty);
            return;
        }

        var warningSection = el('div', 'analytics-section');
        var warningCard = el('div', 'insight-card insight-critical');
        var header = el('div', 'insight-header');
        header.appendChild(el('span', 'badge badge-critical', 'URGENT'));
        header.appendChild(el('span', 'insight-category', 'Active Threat'));
        warningCard.appendChild(header);
        warningCard.appendChild(el('p', 'insight-description', exploited.length + ' vulnerabilities affecting your devices are being actively exploited by threat actors. Prioritize patching these immediately.'));
        warningSection.appendChild(warningCard);
        container.appendChild(warningSection);

        var sorted = exploited.sort(function(a, b) {
            return (b.cvssScore || 0) - (a.cvssScore || 0);
        });

        sorted.forEach(function(v) {
            var card = el('div', 'vuln-detail-card');

            var cardHeader = el('div', 'vuln-detail-header');
            cardHeader.appendChild(el('span', 'vuln-id', v.id));
            var sevBadge = el('span', 'badge badge-' + (v.severity === 'critical' ? 'critical' : 'warning'));
            sevBadge.textContent = (v.severity || 'unknown').toUpperCase();
            cardHeader.appendChild(sevBadge);
            var exploitBadge = el('span', 'badge badge-critical');
            exploitBadge.textContent = 'EXPLOITED';
            cardHeader.appendChild(exploitBadge);
            card.appendChild(cardHeader);

            card.appendChild(el('h4', null, v.name || 'Unknown Vulnerability'));
            card.appendChild(el('p', 'vuln-description', v.description || 'No description available.'));

            var meta = el('div', 'vuln-meta');
            meta.appendChild(createMetaItem('CVSS', v.cvssScore || 'N/A'));
            meta.appendChild(createMetaItem('Product', v.product || 'N/A'));
            meta.appendChild(createMetaItem('Affected Devices', v.affectedDevices || 0));
            meta.appendChild(createMetaItem('Patch', v.patchAvailable ? 'Available' : 'Pending'));
            card.appendChild(meta);

            if (v.recommendedAction) {
                var actionDiv = el('div', 'vuln-action');
                actionDiv.appendChild(el('strong', null, 'Recommended Action: '));
                actionDiv.appendChild(document.createTextNode(v.recommendedAction));
                card.appendChild(actionDiv);
            }

            container.appendChild(card);
        });
    }

    function createMetaItem(label, value) {
        var span = el('span');
        span.appendChild(el('strong', null, label + ': '));
        span.appendChild(document.createTextNode(String(value)));
        return span;
    }

    function render(container) {
        var data = DataLoader.getData('vulnerabilities') || {};
        var vulns = data.vulnerabilities || [];
        var summary = data.summary || {};

        container.textContent = '';

        // Page Header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Vulnerability Management'));
        header.appendChild(el('p', 'page-description', 'CVE tracking and prioritized remediation from Microsoft Defender'));
        container.appendChild(header);

        // Summary Cards
        var cards = el('div', 'summary-cards');

        var totalCard = el('div', 'summary-card');
        totalCard.appendChild(el('div', 'summary-value', String(summary.totalVulnerabilities || vulns.length)));
        totalCard.appendChild(el('div', 'summary-label', 'Total CVEs'));
        cards.appendChild(totalCard);

        var exploitedCount = summary.exploitedInWild || vulns.filter(function(v) { return v.exploitedInWild; }).length;
        var exploitedCard = el('div', 'summary-card' + (exploitedCount > 0 ? ' card-critical' : ''));
        exploitedCard.appendChild(el('div', 'summary-value' + (exploitedCount > 0 ? ' text-critical' : ''), String(exploitedCount)));
        exploitedCard.appendChild(el('div', 'summary-label', 'Actively Exploited'));
        cards.appendChild(exploitedCard);

        var critCount = summary.criticalCount || vulns.filter(function(v) { return v.severity === 'critical'; }).length;
        var critCard = el('div', 'summary-card' + (critCount > 0 ? ' card-critical' : ''));
        critCard.appendChild(el('div', 'summary-value' + (critCount > 0 ? ' text-critical' : ''), String(critCount)));
        critCard.appendChild(el('div', 'summary-label', 'Critical Severity'));
        cards.appendChild(critCard);

        var patchAvail = summary.patchAvailable || vulns.filter(function(v) { return v.patchAvailable; }).length;
        var patchCard = el('div', 'summary-card');
        patchCard.appendChild(el('div', 'summary-value text-success', String(patchAvail)));
        patchCard.appendChild(el('div', 'summary-label', 'Patches Available'));
        cards.appendChild(patchCard);

        container.appendChild(cards);

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'all', label: 'All CVEs (' + vulns.length + ')' },
            { id: 'exploited', label: 'Exploited (' + exploitedCount + ')' }
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
        contentArea.id = 'vuln-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        // Initial render
        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();

window.PageVulnerabilities = PageVulnerabilities;
