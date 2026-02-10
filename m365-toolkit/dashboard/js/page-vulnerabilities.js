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
    var deviceIndex = null;
    var vulnColSelector = null;

    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    function normalizeDeviceKey(value) {
        if (!value) return null;
        return String(value).toLowerCase();
    }

    function getDevicesArray() {
        var raw = DataLoader.getData('devices') || [];
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.devices)) return raw.devices;
        return [];
    }

    function buildDeviceIndex() {
        var index = {};
        var devices = getDevicesArray();
        devices.forEach(function(device) {
            var keys = [
                device.azureAdDeviceId,
                device.deviceName,
                device.managedDeviceName,
                device.id
            ];
            keys.forEach(function(key) {
                var normalized = normalizeDeviceKey(key);
                if (normalized) {
                    index[normalized] = device;
                }
            });
        });
        return index;
    }

    function ensureDeviceIndex() {
        if (!deviceIndex) {
            deviceIndex = buildDeviceIndex();
        }
        return deviceIndex;
    }

    function getAffectedDevicesList(vuln) {
        if (!vuln || !Array.isArray(vuln.affectedDevicesList)) return [];
        return vuln.affectedDevicesList;
    }

    function resolveDeviceRecord(item) {
        if (!item) return null;
        var index = ensureDeviceIndex();
        var keys = [
            item.deviceId,
            item.azureAdDeviceId,
            item.machineId,
            item.id,
            item.deviceName,
            item.managedDeviceName,
            item.computerDnsName
        ];
        for (var i = 0; i < keys.length; i++) {
            var key = normalizeDeviceKey(keys[i]);
            if (key && index[key]) {
                return index[key];
            }
        }
        return null;
    }

    function formatDateValue(value) {
        if (!value) return '--';
        if (window.DataLoader && typeof DataLoader.formatDate === 'function') {
            return DataLoader.formatDate(value);
        }
        var date = new Date(value);
        if (isNaN(date.getTime())) return '--';
        return date.toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function appendDetailRow(container, label, value) {
        container.appendChild(el('div', 'detail-label', label));
        container.appendChild(el('div', 'detail-value', value || '--'));
    }

    function buildAffectedDevicesCell(vuln) {
        var cell = el('td');
        var list = getAffectedDevicesList(vuln);
        var total = (typeof vuln.affectedDevices === 'number') ? vuln.affectedDevices : list.length;

        if (list.length > 0) {
            var btn = el('button', 'btn btn-secondary btn-sm');
            var label = list.length === total ? (total + ' devices') : (list.length + ' of ' + total);
            btn.textContent = label;
            btn.addEventListener('click', function() {
                showAffectedDevicesModal(vuln);
            });
            cell.appendChild(btn);
        } else {
            cell.textContent = String(total || 0);
        }

        return cell;
    }

    function createAffectedDevicesMeta(vuln) {
        var span = el('span');
        span.appendChild(el('strong', null, 'Affected Devices: '));
        var list = getAffectedDevicesList(vuln);
        var total = (typeof vuln.affectedDevices === 'number') ? vuln.affectedDevices : list.length;

        if (list.length > 0) {
            var btn = el('button', 'btn btn-secondary btn-sm');
            var label = list.length === total ? (total + ' devices') : (list.length + ' of ' + total);
            btn.textContent = label;
            btn.addEventListener('click', function() {
                showAffectedDevicesModal(vuln);
            });
            span.appendChild(btn);
        } else {
            span.appendChild(document.createTextNode(String(total || 0)));
        }

        return span;
    }

    function showAffectedDevicesModal(vuln) {
        var overlay = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!overlay || !title || !body) return;

        var list = getAffectedDevicesList(vuln);
        var total = (typeof vuln.affectedDevices === 'number') ? vuln.affectedDevices : list.length;
        var vulnId = vuln.id || 'CVE';

        title.textContent = 'Affected Devices - ' + vulnId;
        body.textContent = '';

        var details = el('div', 'detail-list');
        details.appendChild(el('div', 'detail-label', 'CVE'));
        var cveValueCell = el('div', 'detail-value');
        cveValueCell.appendChild(createCveLink(vulnId, 'cve-link'));
        details.appendChild(cveValueCell);
        appendDetailRow(details, 'Name', vuln.name || 'Unknown');
        appendDetailRow(details, 'Severity', (vuln.severity || 'unknown').toUpperCase());
        appendDetailRow(details, 'Affected Devices', String(total));
        appendDetailRow(details, 'Showing', String(list.length));
        body.appendChild(details);

        var actionRow = el('div', 'action-row');
        if (list.length > 0 && window.ActionUtils && ActionUtils.copyText) {
            var copyBtn = el('button', 'btn btn-secondary btn-sm', 'Copy device list');
            copyBtn.addEventListener('click', function() {
                var names = list.map(function(item) {
                    return item.deviceName || item.computerDnsName || item.managedDeviceName || item.deviceId || 'Unknown Device';
                });
                ActionUtils.copyText(names.join('\n')).then(function() {
                    if (window.Toast) Toast.success('Copied', 'Device list copied to clipboard.');
                }).catch(function() {
                    if (window.Toast) Toast.error('Copy failed', 'Unable to copy device list.');
                });
            });
            actionRow.appendChild(copyBtn);
        }

        if (total > list.length) {
            var note = el('div', 'action-note', 'Showing ' + list.length + ' of ' + total + ' devices.');
            actionRow.appendChild(note);
        }

        if (actionRow.childNodes.length > 0) {
            body.appendChild(actionRow);
        }

        if (list.length === 0) {
            var empty = el('div', 'empty-state');
            empty.appendChild(el('div', 'empty-state-title', 'No device list available'));
            empty.appendChild(el('div', 'empty-state-description', 'This vulnerability does not include affected device details.'));
            body.appendChild(empty);
            overlay.classList.add('visible');
            return;
        }

        var table = el('table', 'detail-table');
        var thead = el('thead');
        var headerRow = el('tr');
        ['Device', 'User', 'OS', 'Compliance', 'Last Sync', 'Exposure', 'Risk Score', 'Action'].forEach(function(label) {
            headerRow.appendChild(el('th', null, label));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        list.forEach(function(item) {
            var record = resolveDeviceRecord(item);
            var name = item.deviceName || item.computerDnsName || item.managedDeviceName || (record ? (record.deviceName || record.managedDeviceName) : null) || '--';
            var user = item.userPrincipalName || (record ? record.userPrincipalName : null) || '--';
            var os = item.osPlatform || item.os || (record ? (record.os + (record.windowsRelease ? ' ' + record.windowsRelease : '')) : null) || '--';
            var compliance = item.complianceState || (record ? record.complianceState : null) || '--';
            var lastSeen = item.lastSeen || item.lastSeenDateTime || (record ? record.lastSync : null);
            var exposure = item.exposureLevel || item.severity || '--';
            var riskScore = item.riskScore || '--';

            var row = el('tr');

            // Make device name clickable - navigates to device page with search
            var nameCell = el('td');
            if (name && name !== '--') {
                var nameLink = el('a', 'text-link font-bold', name);
                nameLink.href = '#devices?search=' + encodeURIComponent(name);
                nameCell.appendChild(nameLink);
            } else {
                nameCell.textContent = name;
            }
            row.appendChild(nameCell);

            // Make user clickable - navigates to user page with search
            var userCell = el('td');
            if (user && user !== '--') {
                var userLink = el('a', 'text-link', user);
                userLink.href = '#users?search=' + encodeURIComponent(user);
                userCell.appendChild(userLink);
            } else {
                userCell.textContent = user;
            }
            row.appendChild(userCell);

            row.appendChild(el('td', null, os));

            // Format compliance with badge
            var compCell = el('td');
            if (compliance === 'compliant') {
                var compBadge = el('span', 'badge badge-success', 'Compliant');
                compCell.appendChild(compBadge);
            } else if (compliance === 'noncompliant') {
                var ncBadge = el('span', 'badge badge-critical', 'Non-Compliant');
                compCell.appendChild(ncBadge);
            } else {
                compCell.textContent = compliance;
            }
            row.appendChild(compCell);

            row.appendChild(el('td', null, formatDateValue(lastSeen)));
            row.appendChild(el('td', null, String(exposure)));
            row.appendChild(el('td', null, String(riskScore)));

            var actionCell = el('td');
            if (record) {
                var viewBtn = el('button', 'btn btn-secondary btn-sm', 'Details');
                viewBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    // Show device details if PageDevices is available
                    if (window.PageDevices && typeof PageDevices.showDeviceDetails === 'function') {
                        PageDevices.showDeviceDetails(record);
                    } else {
                        // Fallback: navigate to devices page
                        window.location.hash = '#devices?search=' + encodeURIComponent(name);
                    }
                });
                actionCell.appendChild(viewBtn);
            } else if (name && name !== '--') {
                var link = el('a', 'btn btn-secondary btn-sm', 'Find');
                link.href = '#devices?search=' + encodeURIComponent(name);
                actionCell.appendChild(link);
            } else {
                actionCell.textContent = '--';
            }
            row.appendChild(actionCell);

            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        body.appendChild(table);
        overlay.classList.add('visible');
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
                var cveCell = el('td');
                cveCell.appendChild(createCveLink(v.id, 'font-bold cve-link'));
                row.appendChild(cveCell);
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

                row.appendChild(buildAffectedDevicesCell(v));

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

        // Filter bar
        var filterBar = el('div', 'filter-bar');
        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'filter-input';
        searchInput.id = 'vuln-search';
        searchInput.placeholder = 'Search vulnerabilities...';
        filterBar.appendChild(searchInput);

        var sevSelect = document.createElement('select');
        sevSelect.className = 'filter-select';
        sevSelect.id = 'vuln-severity';
        [['all', 'All Severities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].forEach(function(opt) {
            var o = document.createElement('option');
            o.value = opt[0];
            o.textContent = opt[1];
            sevSelect.appendChild(o);
        });
        filterBar.appendChild(sevSelect);

        // Exploited filter
        var exploitedSelect = document.createElement('select');
        exploitedSelect.className = 'filter-select';
        exploitedSelect.id = 'vuln-exploited';
        [['all', 'All Exploit Status'], ['true', 'Exploited'], ['false', 'Not Exploited']].forEach(function(opt) {
            var o = document.createElement('option');
            o.value = opt[0];
            o.textContent = opt[1];
            exploitedSelect.appendChild(o);
        });
        filterBar.appendChild(exploitedSelect);

        var colSelectorDiv = el('div');
        colSelectorDiv.id = 'vuln-colselector';
        filterBar.appendChild(colSelectorDiv);
        container.appendChild(filterBar);

        var tableContainer = el('div');
        tableContainer.id = 'vuln-table-container';
        container.appendChild(tableContainer);

        vulnColSelector = ColumnSelector.create({
            containerId: 'vuln-colselector',
            storageKey: 'tenantscope-vuln-cols-v1',
            allColumns: [
                { key: 'cveId', label: 'CVE ID' },
                { key: 'name', label: 'Name' },
                { key: 'severity', label: 'Severity' },
                { key: 'cvss', label: 'CVSS' },
                { key: 'product', label: 'Product' },
                { key: 'exploited', label: 'Exploited' },
                { key: 'devices', label: 'Devices' },
                { key: 'patch', label: 'Patch' },
                { key: 'action', label: 'Action' },
                { key: 'admin', label: 'Admin' }
            ],
            defaultVisible: ['cveId', 'name', 'severity', 'cvss', 'exploited', 'devices', 'patch', 'admin'],
            onColumnsChanged: function() { applyVulnFilters(); }
        });

        function applyVulnFilters() {
            var search = (searchInput.value || '').toLowerCase();
            var sev = sevSelect.value;
            var exploited = exploitedSelect.value;
            var filtered = vulns.filter(function(v) {
                if (search && (v.id || '').toLowerCase().indexOf(search) === -1 &&
                    (v.name || '').toLowerCase().indexOf(search) === -1 &&
                    (v.product || '').toLowerCase().indexOf(search) === -1) return false;
                if (sev && sev !== 'all' && v.severity !== sev) return false;
                if (exploited && exploited !== 'all') {
                    if (exploited === 'true' && !v.exploitedInWild) return false;
                    if (exploited === 'false' && v.exploitedInWild) return false;
                }
                return true;
            });
            renderVulnTable(tableContainer, filtered);
        }

        Filters.setup('vuln-search', applyVulnFilters);
        Filters.setup('vuln-severity', applyVulnFilters);
        Filters.setup('vuln-exploited', applyVulnFilters);

        var sorted = vulns.slice().sort(function(a, b) {
            var sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return (sevOrder[a.severity] || 4) - (sevOrder[b.severity] || 4);
        });
        renderVulnTable(tableContainer, sorted);
    }

    function renderVulnTable(container, vulns) {
        container.textContent = '';
        if (vulns.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No matching vulnerabilities</p></div>';
            return;
        }
        var sorted = vulns.slice().sort(function(a, b) {
            var sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return (sevOrder[a.severity] || 4) - (sevOrder[b.severity] || 4);
        });

        var visible = vulnColSelector ? vulnColSelector.getVisible() : ['cveId', 'name', 'severity', 'cvss', 'product', 'exploited', 'devices', 'patch', 'action', 'admin'];

        // Column definitions mapped by key
        var colDefs = {
            'cveId': { label: 'CVE ID' },
            'name': { label: 'Name' },
            'severity': { label: 'Severity' },
            'cvss': { label: 'CVSS' },
            'product': { label: 'Product' },
            'exploited': { label: 'Exploited' },
            'devices': { label: 'Devices' },
            'patch': { label: 'Patch' },
            'action': { label: 'Action' },
            'admin': { label: 'Admin' }
        };

        var table = el('table', 'data-table');
        var thead = el('thead');
        var headerRow = el('tr');
        visible.forEach(function(key) {
            if (colDefs[key]) headerRow.appendChild(el('th', null, colDefs[key].label));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        sorted.forEach(function(v) {
            var row = el('tr');

            visible.forEach(function(key) {
                if (key === 'cveId') {
                    var cveCell = el('td');
                    cveCell.appendChild(createCveLink(v.id, 'font-bold cve-link'));
                    row.appendChild(cveCell);
                } else if (key === 'name') {
                    var nameCell = el('td');
                    var vulnName = (v.name || '').substring(0, 35);
                    if (vulnName) {
                        var nameLink = el('a', 'entity-link');
                        nameLink.href = '#vulnerabilities';
                        nameLink.textContent = vulnName;
                        nameLink.title = v.name || '';
                        nameCell.appendChild(nameLink);
                    } else {
                        nameCell.textContent = '--';
                    }
                    row.appendChild(nameCell);
                } else if (key === 'severity') {
                    var sevCell = el('td');
                    var sevClass = v.severity === 'critical' ? 'critical' : v.severity === 'high' ? 'warning' : v.severity === 'medium' ? 'info' : 'success';
                    var sevBadge = el('span', 'badge badge-' + sevClass);
                    sevBadge.textContent = (v.severity || 'unknown').toUpperCase();
                    sevCell.appendChild(sevBadge);
                    row.appendChild(sevCell);
                } else if (key === 'cvss') {
                    row.appendChild(el('td', 'cell-right', String(v.cvssScore || '--')));
                } else if (key === 'product') {
                    row.appendChild(el('td', null, (v.product || '--').substring(0, 20)));
                } else if (key === 'exploited') {
                    var exploitCell = el('td');
                    if (v.exploitedInWild) {
                        var exploitBadge = el('span', 'badge badge-critical');
                        exploitBadge.textContent = 'YES';
                        exploitCell.appendChild(exploitBadge);
                    } else {
                        exploitCell.textContent = 'No';
                    }
                    row.appendChild(exploitCell);
                } else if (key === 'devices') {
                    row.appendChild(buildAffectedDevicesCell(v));
                } else if (key === 'patch') {
                    var patchCell = el('td');
                    if (v.patchAvailable) {
                        var patchBadge = el('span', 'badge badge-success');
                        patchBadge.textContent = 'Yes';
                        patchCell.appendChild(patchBadge);
                    } else {
                        patchCell.textContent = 'No';
                    }
                    row.appendChild(patchCell);
                } else if (key === 'action') {
                    var actionCell = el('td');
                    actionCell.style.fontSize = 'var(--font-size-xs)';
                    actionCell.textContent = (v.recommendedAction || '--').substring(0, 30);
                    row.appendChild(actionCell);
                } else if (key === 'admin') {
                    var adminCell = el('td');
                    if (v.id) {
                        var adminLink = document.createElement('a');
                        adminLink.href = 'https://security.microsoft.com/vulnerabilities/vulnerability/' + encodeURIComponent(v.id) + '/overview';
                        adminLink.target = '_blank';
                        adminLink.rel = 'noopener';
                        adminLink.className = 'admin-link';
                        adminLink.title = 'Open in Defender';
                        adminLink.textContent = 'Defender';
                        adminCell.appendChild(adminLink);
                    } else {
                        adminCell.textContent = '--';
                    }
                    row.appendChild(adminCell);
                }
            });

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
            cardHeader.appendChild(createCveLink(v.id, 'vuln-id cve-link'));
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
            meta.appendChild(createAffectedDevicesMeta(v));
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

    /**
     * Creates a clickable CVE link to National Vulnerability Database
     */
    function createCveLink(cveId, className) {
        if (!cveId) return el('span', null, '--');
        var link = el('a', className || 'cve-link');
        link.textContent = cveId;
        link.href = 'https://nvd.nist.gov/vuln/detail/' + encodeURIComponent(cveId);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = 'View CVE details on NVD';
        return link;
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
