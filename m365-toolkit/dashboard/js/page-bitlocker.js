/**
 * TenantScope - BitLocker Status Page
 * Shows BitLocker encryption status, recovery keys, and device compliance
 * Author: Robel (https://github.com/Thugney)
 */

const PageBitLocker = (function() {
    'use strict';

    // Import SharedFormatters
    var SF = window.SharedFormatters || {};

    var currentTab = 'overview';
    var colSelector = null;

    function extractData(rawData) {
        // Handle both array format (legacy) and object format (current collector)
        if (Array.isArray(rawData)) {
            return {
                devices: rawData,
                summary: computeSummary(rawData),
                insights: []
            };
        }
        return {
            devices: rawData.devices || [],
            summary: rawData.summary || computeSummary(rawData.devices || []),
            insights: rawData.insights || []
        };
    }

    function computeSummary(devices) {
        var encrypted = 0, notEncrypted = 0, unknown = 0, withKeys = 0;
        var manufacturerBreakdown = {};
        var modelBreakdown = {};

        devices.forEach(function(d) {
            if (d.encryptionState === 'encrypted') encrypted++;
            else if (d.encryptionState === 'notEncrypted') notEncrypted++;
            else unknown++;
            if (d.recoveryKeyEscrowed || d.hasRecoveryKey) withKeys++;

            // Manufacturer breakdown
            var mfr = d.manufacturer || 'Unknown';
            if (!manufacturerBreakdown[mfr]) manufacturerBreakdown[mfr] = { total: 0, encrypted: 0 };
            manufacturerBreakdown[mfr].total++;
            if (d.encryptionState === 'encrypted') manufacturerBreakdown[mfr].encrypted++;

            // Model breakdown
            var model = d.model || 'Unknown';
            if (!modelBreakdown[model]) modelBreakdown[model] = { total: 0, encrypted: 0 };
            modelBreakdown[model].total++;
            if (d.encryptionState === 'encrypted') modelBreakdown[model].encrypted++;
        });

        var total = devices.length;
        return {
            totalDevices: total,
            encryptedDevices: encrypted,
            notEncryptedDevices: notEncrypted,
            unknownDevices: unknown,
            devicesWithRecoveryKeys: withKeys,
            encryptionRate: total > 0 ? Math.round((encrypted / total) * 100 * 10) / 10 : 0,
            manufacturerBreakdown: manufacturerBreakdown,
            modelBreakdown: modelBreakdown
        };
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var data = extractData(DataLoader.getData('bitlockerStatus') || {});
        var container = document.getElementById('bitlocker-content');
        if (!container) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, data);
                break;
            case 'devices':
                renderDevicesTab(container, data.devices);
                break;
            case 'keys':
                renderKeysTab(container, data.devices);
                break;
        }
    }

    function renderOverview(container, data) {
        var summary = data.summary;
        var devices = data.devices;

        var encrypted = summary.encryptedDevices || 0;
        var notEncrypted = summary.notEncryptedDevices || 0;
        var unknown = summary.unknownDevices || 0;
        var total = summary.totalDevices || devices.length;
        var withKeys = summary.devicesWithRecoveryKeys || 0;
        var rate = summary.encryptionRate || 0;
        var rateClass = rate >= 90 ? 'text-success' : rate >= 70 ? 'text-warning' : 'text-critical';

        var html = '<div class="analytics-section">';
        html += '<h3>Encryption Compliance</h3>';
        html += '<div class="compliance-overview">';
        html += '<div class="compliance-chart">';
        var radius = 40;
        var circumference = 2 * Math.PI * radius;
        var totalForChart = encrypted + notEncrypted + unknown;
        var encryptedDash = totalForChart > 0 ? (encrypted / totalForChart) * circumference : 0;
        var notEncryptedDash = totalForChart > 0 ? (notEncrypted / totalForChart) * circumference : 0;
        var unknownDash = totalForChart > 0 ? (unknown / totalForChart) * circumference : 0;
        html += '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        var offset = 0;
        if (encrypted > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-success)" stroke-width="10" stroke-dasharray="' + encryptedDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += encryptedDash;
        }
        if (notEncrypted > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-critical)" stroke-width="10" stroke-dasharray="' + notEncryptedDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += notEncryptedDash;
        }
        if (unknown > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-neutral)" stroke-width="10" stroke-dasharray="' + unknownDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value ' + rateClass + '">' + Math.round(rate) + '%</span><span class="donut-label">Encrypted</span></div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="compliance-legend">';
        html += '<div class="legend-item"><span class="legend-dot bg-success"></span> Encrypted: <strong>' + encrypted + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Not Encrypted: <strong>' + notEncrypted + '</strong></div>';
        if (unknown > 0) {
            html += '<div class="legend-item"><span class="legend-dot bg-neutral"></span> Unknown: <strong>' + unknown + '</strong></div>';
        }
        html += '<div class="legend-item">Keys Escrowed: <strong>' + withKeys + '</strong></div>';
        html += '</div></div></div>';

        // Analytics Grid
        html += '<div class="analytics-grid">';

        // Manufacturer Breakdown - simple list
        html += '<div class="analytics-card">';
        html += '<h4>By Manufacturer</h4>';
        html += '<div class="stat-list">';
        var mfrKeys = Object.keys(summary.manufacturerBreakdown || {}).sort(function(a, b) {
            return (summary.manufacturerBreakdown[b] ? summary.manufacturerBreakdown[b].total : 0) -
                   (summary.manufacturerBreakdown[a] ? summary.manufacturerBreakdown[a].total : 0);
        }).slice(0, 5);
        mfrKeys.forEach(function(mfr) {
            var m = summary.manufacturerBreakdown[mfr];
            var mRate = m.total > 0 ? Math.round((m.encrypted / m.total) * 100) : 0;
            var rateClass = mRate >= 90 ? 'text-success' : mRate >= 70 ? 'text-warning' : 'text-critical';
            html += '<div class="stat-row"><span class="stat-label">' + mfr + '</span>';
            html += '<span class="stat-value"><span class="' + rateClass + '">' + mRate + '%</span> (' + m.encrypted + '/' + m.total + ')</span></div>';
        });
        html += '</div></div>';

        // OS Version Breakdown - simple list
        var osVersions = {};
        devices.forEach(function(d) {
            var os = d.osVersion || 'Unknown';
            var osDisplay = os.indexOf('10.0.22') === 0 ? 'Windows 11' :
                            os.indexOf('10.0.19') === 0 ? 'Windows 10' : os;
            if (!osVersions[osDisplay]) osVersions[osDisplay] = { total: 0, encrypted: 0 };
            osVersions[osDisplay].total++;
            if (d.encryptionState === 'encrypted') osVersions[osDisplay].encrypted++;
        });

        html += '<div class="analytics-card">';
        html += '<h4>By OS Version</h4>';
        html += '<div class="stat-list">';
        Object.keys(osVersions).sort(function(a, b) {
            return osVersions[b].total - osVersions[a].total;
        }).forEach(function(os) {
            var o = osVersions[os];
            var oRate = o.total > 0 ? Math.round((o.encrypted / o.total) * 100) : 0;
            var rateClass = oRate >= 90 ? 'text-success' : oRate >= 70 ? 'text-warning' : 'text-critical';
            html += '<div class="stat-row"><span class="stat-label">' + os + '</span>';
            html += '<span class="stat-value"><span class="' + rateClass + '">' + oRate + '%</span> (' + o.encrypted + '/' + o.total + ')</span></div>';
        });
        html += '</div></div>';

        // Recovery Key Status - simple list
        html += '<div class="analytics-card">';
        html += '<h4>Recovery Key Status</h4>';
        html += '<div class="stat-list">';
        html += '<div class="stat-row"><span class="stat-label">Keys Escrowed</span><span class="stat-value text-success">' + withKeys + '</span></div>';
        var keysMissing = devices.filter(function(d) { return d.encryptionState === 'encrypted' && d.recoveryKeyEscrowed === false; }).length;
        html += '<div class="stat-row"><span class="stat-label">Keys Missing</span><span class="stat-value ' + (keysMissing > 0 ? 'text-warning' : 'text-muted') + '">' + keysMissing + '</span></div>';
        var multipleKeys = devices.filter(function(d) { return d.recoveryKeyCount > 1; }).length;
        html += '<div class="stat-row"><span class="stat-label">Multiple Keys</span><span class="stat-value text-info">' + multipleKeys + '</span></div>';
        html += '</div></div>';

        html += '</div>'; // end analytics-grid

        // Devices Needing Attention
        var needsAttention = devices.filter(function(d) {
            return d.encryptionState === 'notEncrypted' ||
                   (d.recoveryKeyEscrowed === false && d.encryptionState === 'encrypted') ||
                   (d.daysSinceSync && d.daysSinceSync > 14);
        });

        if (needsAttention.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Devices Needing Attention (' + needsAttention.length + ')</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Device</th><th>User</th><th>Issue</th><th>Last Sync</th><th>Action</th>';
            html += '</tr></thead><tbody>';

            needsAttention.slice(0, 10).forEach(function(d) {
                var issues = [];
                if (d.encryptionState === 'notEncrypted') issues.push('<span class="badge badge-critical">Not Encrypted</span>');
                if (d.recoveryKeyEscrowed === false && d.encryptionState === 'encrypted') issues.push('<span class="badge badge-warning">Key Not Escrowed</span>');
                if (d.daysSinceSync && d.daysSinceSync > 14) issues.push('<span class="badge badge-neutral">Stale (' + d.daysSinceSync + 'd)</span>');

                var action = d.encryptionState === 'notEncrypted' ? 'Enable BitLocker' :
                             d.recoveryKeyEscrowed === false ? 'Backup Recovery Key' : 'Check Device';

                html += '<tr>';
                html += '<td><a href="#devices?search=' + encodeURIComponent(d.deviceName || '') + '" class="entity-link"><strong>' + (d.deviceName || '--') + '</strong></a></td>';
                html += '<td class="cell-truncate"><a href="#users?search=' + encodeURIComponent(d.userPrincipalName || '') + '" class="entity-link">' + (d.userPrincipalName || '--') + '</a></td>';
                html += '<td>' + issues.join(' ') + '</td>';
                html += '<td>' + (SF.formatDate ? SF.formatDate(d.lastSyncDateTime) : formatDateFallback(d.lastSyncDateTime)) + '</td>';
                html += '<td><span class="text-info">' + action + '</span></td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (needsAttention.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + needsAttention.length + ' devices. View the Devices tab for all.</p>';
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function renderDevicesTab(container, devices) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="bitlocker-search" placeholder="Search devices...">';
        html += '<select class="filter-select" id="bitlocker-encryption"><option value="all">All Encryption States</option>';
        html += '<option value="encrypted">Encrypted</option><option value="notEncrypted">Not Encrypted</option><option value="unknown">Unknown</option></select>';
        html += '<select class="filter-select" id="bitlocker-key"><option value="all">All Key Status</option>';
        html += '<option value="escrowed">Keys Escrowed</option><option value="missing">Keys Missing</option></select>';
        html += '<select class="filter-select" id="bitlocker-compliance"><option value="all">All Compliance</option>';
        html += '<option value="compliant">Compliant</option><option value="noncompliant">Non-Compliant</option></select>';
        html += '<div id="bitlocker-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="bitlocker-devices-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'bitlocker-colselector',
            storageKey: 'tenantscope-bitlocker-cols-v1',
            allColumns: [
                { key: 'deviceName', label: 'Device Name' },
                { key: 'userPrincipalName', label: 'User' },
                { key: 'encryptionState', label: 'Encryption' },
                { key: 'recoveryKeyEscrowed', label: 'Key Escrowed' },
                { key: 'recoveryKeyCount', label: 'Key Count' },
                { key: 'manufacturer', label: 'Manufacturer' },
                { key: 'model', label: 'Model' },
                { key: 'serialNumber', label: 'Serial Number' },
                { key: 'osVersion', label: 'OS Version' },
                { key: 'complianceState', label: 'Compliance' },
                { key: 'lastSyncDateTime', label: 'Last Sync' },
                { key: 'daysSinceSync', label: 'Days Since Sync' }
            ],
            defaultVisible: ['deviceName', 'userPrincipalName', 'encryptionState', 'recoveryKeyEscrowed', 'manufacturer', 'model', 'lastSyncDateTime'],
            onColumnsChanged: function() { applyDeviceFilters(); }
        });

        Filters.setup('bitlocker-search', applyDeviceFilters);
        Filters.setup('bitlocker-encryption', applyDeviceFilters);
        Filters.setup('bitlocker-key', applyDeviceFilters);
        Filters.setup('bitlocker-compliance', applyDeviceFilters);
        applyDeviceFilters();
    }

    function applyDeviceFilters() {
        var data = extractData(DataLoader.getData('bitlockerStatus') || {});
        var devices = data.devices;

        var filterConfig = {
            search: Filters.getValue('bitlocker-search'),
            searchFields: ['deviceName', 'userPrincipalName', 'manufacturer', 'model', 'serialNumber'],
            exact: {}
        };

        var encFilter = Filters.getValue('bitlocker-encryption');
        if (encFilter && encFilter !== 'all') filterConfig.exact.encryptionState = encFilter;

        var compFilter = Filters.getValue('bitlocker-compliance');
        if (compFilter && compFilter !== 'all') filterConfig.exact.complianceState = compFilter;

        var filtered = Filters.apply(devices, filterConfig);

        // Apply key filter (special handling)
        var keyFilter = Filters.getValue('bitlocker-key');
        if (keyFilter === 'escrowed') {
            filtered = filtered.filter(function(d) { return d.recoveryKeyEscrowed === true; });
        } else if (keyFilter === 'missing') {
            filtered = filtered.filter(function(d) { return d.recoveryKeyEscrowed === false; });
        }

        renderDevicesTable(filtered);
    }

    function renderDevicesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'userPrincipalName', 'encryptionState', 'recoveryKeyEscrowed', 'manufacturer', 'model', 'lastSyncDateTime'];

        var allDefs = [
            { key: 'deviceName', label: 'Device Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            { key: 'encryptionState', label: 'Encryption', formatter: SF.formatEncryptionState || formatEncryptionStateFallback },
            { key: 'recoveryKeyEscrowed', label: 'Key Escrowed', formatter: SF.formatBoolean || formatBooleanFallback },
            { key: 'recoveryKeyCount', label: 'Key Count', formatter: function(v) {
                return v > 0 ? '<span class="text-success">' + v + '</span>' : '<span class="text-muted">0</span>';
            }},
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'model', label: 'Model' },
            { key: 'serialNumber', label: 'Serial Number' },
            { key: 'osVersion', label: 'OS Version', formatter: formatOsVersion },
            { key: 'complianceState', label: 'Compliance', formatter: SF.formatCompliance || formatComplianceFallback },
            { key: 'lastSyncDateTime', label: 'Last Sync', formatter: SF.formatDateTime || formatDateTimeFallback },
            { key: 'daysSinceSync', label: 'Days Since Sync', formatter: SF.formatDaysSinceSync || formatDaysSinceSyncFallback }
        ];

        Tables.render({
            containerId: 'bitlocker-devices-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showDeviceDetails
        });
    }

    function renderKeysTab(container, devices) {
        // Filter to devices with recovery keys
        var devicesWithKeys = devices.filter(function(d) {
            return d.recoveryKeyEscrowed === true || (d.recoveryKeys && d.recoveryKeys.length > 0);
        });

        if (devicesWithKeys.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Recovery Keys Found</div><p>No BitLocker recovery keys have been escrowed to Azure AD.</p></div>';
            return;
        }

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="keys-search" placeholder="Search devices...">';
        html += '</div>';
        html += '<div class="table-container" id="keys-table"></div>';
        container.innerHTML = html;

        renderKeysTable(devicesWithKeys);

        Filters.setup('keys-search', function() {
            var search = (Filters.getValue('keys-search') || '').toLowerCase();
            var filtered = devicesWithKeys.filter(function(d) {
                return (d.deviceName || '').toLowerCase().indexOf(search) !== -1 ||
                       (d.userPrincipalName || '').toLowerCase().indexOf(search) !== -1;
            });
            renderKeysTable(filtered);
        });
    }

    function renderKeysTable(devicesWithKeys) {
        var tableData = devicesWithKeys.map(function(d) {
            var keys = d.recoveryKeys || [];
            var volumeTypes = [];
            var latestDate = null;

            keys.forEach(function(k) {
                if (k.volumeType && volumeTypes.indexOf(k.volumeType) === -1) {
                    volumeTypes.push(k.volumeType);
                }
                if (k.createdDateTime) {
                    var kDate = new Date(k.createdDateTime);
                    if (!latestDate || kDate > latestDate) latestDate = kDate;
                }
            });

            return {
                deviceName: d.deviceName,
                userPrincipalName: d.userPrincipalName,
                recoveryKeyCount: d.recoveryKeyCount || keys.length || 1,
                volumeTypes: volumeTypes,
                latestKeyDate: latestDate,
                _original: d
            };
        });

        Tables.render({
            containerId: 'keys-table',
            data: tableData,
            columns: [
                { key: 'deviceName', label: 'Device', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
                { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
                { key: 'recoveryKeyCount', label: 'Key Count', formatter: function(v) {
                    return '<span class="text-success">' + v + '</span>';
                }},
                { key: 'volumeTypes', label: 'Volume Types', formatter: function(v) {
                    if (!v || !Array.isArray(v) || v.length === 0) return '--';
                    return v.map(function(vt) {
                        var label = vt === 'operatingSystemVolume' ? 'OS' : vt === 'fixedDataVolume' ? 'Data' : vt;
                        return '<span class="badge badge-info">' + label + '</span>';
                    }).join(' ');
                }},
                { key: 'latestKeyDate', label: 'Latest Key Date', formatter: function(v) {
                    return v ? (SF.formatDate ? SF.formatDate(v.toISOString()) : v.toLocaleDateString()) : '--';
                }}
            ],
            pageSize: 50,
            onRowClick: function(row) {
                if (row._original) showDeviceDetails(row._original);
            }
        });
    }

    // Fallback formatters (used if SharedFormatters not available)
    function formatEncryptionStateFallback(v) {
        var states = {
            'encrypted': { badge: 'badge-success', label: 'Encrypted' },
            'notEncrypted': { badge: 'badge-critical', label: 'Not Encrypted' },
            'encryptionInProgress': { badge: 'badge-warning', label: 'In Progress' },
            'unknown': { badge: 'badge-neutral', label: 'Unknown' }
        };
        var state = states[v] || states['unknown'];
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    function formatBooleanFallback(v) {
        if (v === true) return '<span class="text-success font-bold">Yes</span>';
        if (v === false) return '<span class="text-critical">No</span>';
        return '<span class="text-muted">--</span>';
    }

    function formatComplianceFallback(v) {
        var states = {
            'compliant': { badge: 'badge-success', label: 'Compliant' },
            'noncompliant': { badge: 'badge-critical', label: 'Non-Compliant' },
            'unknown': { badge: 'badge-neutral', label: 'Unknown' }
        };
        var state = states[v] || states['unknown'];
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    function formatOsVersion(v) {
        if (!v) return '--';
        // Simplify display
        if (v.indexOf('10.0.22') === 0) return 'Win 11 (' + v.split('.').pop() + ')';
        if (v.indexOf('10.0.19') === 0) return 'Win 10 (' + v.split('.').pop() + ')';
        return v;
    }

    function formatDateFallback(v) {
        if (!v) return '<span class="text-muted">--</span>';
        try {
            var date = new Date(v);
            return date.toLocaleDateString();
        } catch (e) {
            return '--';
        }
    }

    function formatDateTimeFallback(v) {
        if (!v) return '<span class="text-muted">--</span>';
        try {
            var date = new Date(v);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '--';
        }
    }

    function formatDaysSinceSyncFallback(v) {
        if (v === null || v === undefined) return '<span class="text-muted">--</span>';
        var cls = v > 14 ? 'text-critical' : v > 7 ? 'text-warning' : 'text-success';
        return '<span class="' + cls + '">' + v + 'd</span>';
    }

    function showDeviceDetails(device) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = device.deviceName || 'Device Details';

        var html = '<div class="detail-grid">';

        // Device Information
        html += '<div class="detail-section"><h4>Device Information</h4><dl class="detail-list">';
        html += '<dt>Device Name</dt><dd>' + (device.deviceName || '--') + '</dd>';
        html += '<dt>User</dt><dd>' + (device.userPrincipalName || '--') + '</dd>';
        html += '<dt>Manufacturer</dt><dd>' + (device.manufacturer || '--') + '</dd>';
        html += '<dt>Model</dt><dd>' + (device.model || '--') + '</dd>';
        html += '<dt>Serial Number</dt><dd>' + (device.serialNumber || '--') + '</dd>';
        html += '<dt>OS Version</dt><dd>' + (device.osVersion || '--') + '</dd>';
        html += '</dl></div>';

        // Encryption Status
        html += '<div class="detail-section"><h4>BitLocker Status</h4><dl class="detail-list">';
        html += '<dt>Encryption State</dt><dd>' + (SF.formatEncryptionState ? SF.formatEncryptionState(device.encryptionState) : formatEncryptionStateFallback(device.encryptionState)) + '</dd>';
        html += '<dt>Is Encrypted</dt><dd>' + (SF.formatBoolean ? SF.formatBoolean(device.isEncrypted) : formatBooleanFallback(device.isEncrypted)) + '</dd>';
        html += '<dt>Needs Encryption</dt><dd>' + (device.needsEncryption ? '<span class="text-warning">Yes</span>' : '<span class="text-success">No</span>') + '</dd>';
        html += '</dl></div>';

        // Recovery Keys
        html += '<div class="detail-section"><h4>Recovery Keys</h4><dl class="detail-list">';
        html += '<dt>Keys Escrowed</dt><dd>' + (SF.formatBoolean ? SF.formatBoolean(device.recoveryKeyEscrowed) : formatBooleanFallback(device.recoveryKeyEscrowed)) + '</dd>';
        html += '<dt>Key Count</dt><dd>' + (device.recoveryKeyCount || 0) + '</dd>';
        html += '</dl>';

        if (device.recoveryKeys && device.recoveryKeys.length > 0) {
            html += '<table class="detail-table"><thead><tr><th>Volume Type</th><th>Key ID</th><th>Created</th></tr></thead><tbody>';
            device.recoveryKeys.forEach(function(k) {
                var volumeLabel = k.volumeType === 'operatingSystemVolume' ? 'OS Volume' :
                                  k.volumeType === 'fixedDataVolume' ? 'Data Volume' : k.volumeType;
                html += '<tr>';
                html += '<td>' + (volumeLabel || '--') + '</td>';
                html += '<td class="cell-truncate">' + (k.keyId || '--') + '</td>';
                html += '<td>' + (k.createdDateTime ? (SF.formatDate ? SF.formatDate(k.createdDateTime) : new Date(k.createdDateTime).toLocaleDateString()) : '--') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';

        // Compliance Info
        html += '<div class="detail-section"><h4>Compliance & Sync</h4><dl class="detail-list">';
        html += '<dt>Compliance State</dt><dd>' + (SF.formatCompliance ? SF.formatCompliance(device.complianceState) : formatComplianceFallback(device.complianceState)) + '</dd>';
        html += '<dt>Last Sync</dt><dd>' + (device.lastSyncDateTime ? (SF.formatDateTime ? SF.formatDateTime(device.lastSyncDateTime) : new Date(device.lastSyncDateTime).toLocaleString()) : '--') + '</dd>';
        html += '<dt>Days Since Sync</dt><dd>' + (device.daysSinceSync !== undefined ? (SF.formatDaysSinceSync ? SF.formatDaysSinceSync(device.daysSinceSync) : device.daysSinceSync + ' days') : '--') + '</dd>';
        html += '</dl></div>';

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function render(container) {
        var data = extractData(DataLoader.getData('bitlockerStatus') || {});
        var summary = data.summary;
        var devices = data.devices;

        var total = summary.totalDevices || devices.length;
        var encrypted = summary.encryptedDevices || 0;
        var notEncrypted = summary.notEncryptedDevices || 0;
        var withKeys = summary.devicesWithRecoveryKeys || 0;
        var keysMissing = devices.filter(function(d) { return d.encryptionState === 'encrypted' && d.recoveryKeyEscrowed === false; }).length;
        var rate = summary.encryptionRate || 0;
        var rateClass = rate >= 90 ? 'text-success' : rate >= 70 ? 'text-warning' : 'text-critical';

        var html = '<div class="page-header"><h2>BitLocker Status</h2></div>';

        // Summary cards
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + encrypted + '</div><div class="summary-label">Encrypted</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + notEncrypted + '</div><div class="summary-label">Not Encrypted</div></div>';
        html += '<div class="summary-card card-info"><div class="summary-value">' + withKeys + '</div><div class="summary-label">Keys Escrowed</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + keysMissing + '</div><div class="summary-label">Keys Missing</div></div>';
        html += '<div class="summary-card"><div class="summary-value ' + rateClass + '">' + Math.round(rate) + '%</div><div class="summary-label">Encryption Rate</div></div>';
        html += '</div>';

        // Tab bar
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="devices">Devices (' + devices.length + ')</button>';
        html += '<button class="tab-btn" data-tab="keys">Recovery Keys (' + withKeys + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="bitlocker-content"></div>';
        container.innerHTML = html;

        // Set up tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchTab(btn.dataset.tab);
            });
        });

        // Render initial tab
        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();

window.PageBitLocker = PageBitLocker;
