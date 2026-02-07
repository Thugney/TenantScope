/**
 * TenantScope - Devices Page
 * Shows Intune managed devices with compliance, encryption, certificates, and Windows lifecycle
 * Author: Robel (https://github.com/Thugney)
 */

const PageDevices = (function() {
    'use strict';

    var currentTab = 'overview';
    var colSelector = null;

    // Extract data from both array and object formats
    function extractData(rawData) {
        var devices;
        var summary;
        var insights;
        if (Array.isArray(rawData)) {
            devices = rawData;
            summary = computeSummary(rawData);
            insights = [];
        } else {
            devices = rawData.devices || [];
            summary = rawData.summary || computeSummary(rawData.devices || []);
            insights = rawData.insights || [];
        }
        summary = normalizeSummary(summary, devices);
        return { devices: devices, summary: summary, insights: insights };
    }

    function computeSummary(devices) {
        var compliant = 0, noncompliant = 0, unknown = 0;
        var encrypted = 0, notEncrypted = 0, unknownEncrypted = 0;
        var stale = 0;
        var certExpired = 0, certCritical = 0, certWarning = 0, certHealthy = 0, certUnknown = 0;
        var win10 = 0, win11 = 0, winSupported = 0, winUnsupported = 0;
        var corporate = 0, personal = 0;
        var osBreakdown = {};
        var manufacturerBreakdown = {};

        devices.forEach(function(d) {
            // Compliance
            if (d.complianceState === 'compliant') compliant++;
            else if (d.complianceState === 'noncompliant') noncompliant++;
            else unknown++;

            // Encryption (treat null/undefined as unknown)
            if (d.isEncrypted === true) encrypted++;
            else if (d.isEncrypted === false) notEncrypted++;
            else unknownEncrypted++;

            // Stale
            if (d.isStale) stale++;

            // Certificate
            switch (d.certStatus) {
                case 'expired': certExpired++; break;
                case 'critical': certCritical++; break;
                case 'warning': certWarning++; break;
                case 'healthy': certHealthy++; break;
                default: certUnknown++;
            }

            // Windows
            if (d.windowsType === 'Windows 11') win11++;
            else if (d.windowsType === 'Windows 10') win10++;
            if (d.windowsSupported === true) winSupported++;
            else if (d.windowsSupported === false) winUnsupported++;

            // Ownership
            if (d.ownership === 'corporate') corporate++;
            else if (d.ownership === 'personal') personal++;

            // OS breakdown
            var os = d.os || 'Unknown';
            if (!osBreakdown[os]) osBreakdown[os] = 0;
            osBreakdown[os]++;

            // Manufacturer breakdown
            var mfr = d.manufacturer || 'Unknown';
            if (!manufacturerBreakdown[mfr]) manufacturerBreakdown[mfr] = 0;
            manufacturerBreakdown[mfr]++;
        });

        var total = devices.length;
        return {
            totalDevices: total,
            compliantDevices: compliant,
            noncompliantDevices: noncompliant,
            unknownDevices: unknown,
            complianceRate: total > 0 ? Math.round((compliant / total) * 100 * 10) / 10 : 0,
            encryptedDevices: encrypted,
            notEncryptedDevices: notEncrypted,
            unknownEncryptedDevices: unknownEncrypted,
            staleDevices: stale,
            certExpired: certExpired,
            certCritical: certCritical,
            certWarning: certWarning,
            certHealthy: certHealthy,
            certUnknown: certUnknown,
            win10Count: win10,
            win11Count: win11,
            winSupportedCount: winSupported,
            winUnsupportedCount: winUnsupported,
            corporateDevices: corporate,
            personalDevices: personal,
            osBreakdown: osBreakdown,
            manufacturerBreakdown: manufacturerBreakdown
        };
    }

    function normalizeSummary(summary, devices) {
        var normalized = summary || {};

        // Core counts (legacy collector keys)
        if (normalized.totalDevices === undefined) normalized.totalDevices = Array.isArray(devices) ? devices.length : 0;
        if (normalized.compliantDevices === undefined) normalized.compliantDevices = normalized.compliant || 0;
        if (normalized.noncompliantDevices === undefined) normalized.noncompliantDevices = normalized.noncompliant || 0;
        if (normalized.unknownDevices === undefined) normalized.unknownDevices = normalized.unknown || 0;

        if (normalized.complianceRate === undefined) {
            var total = normalized.totalDevices || 0;
            normalized.complianceRate = total > 0 ? Math.round((normalized.compliantDevices / total) * 100 * 10) / 10 : 0;
        }

        // Encryption
        if (normalized.encryptedDevices === undefined) normalized.encryptedDevices = normalized.encrypted || 0;
        if (normalized.notEncryptedDevices === undefined) normalized.notEncryptedDevices = normalized.notEncrypted || 0;
        if (normalized.unknownEncryptedDevices === undefined) normalized.unknownEncryptedDevices = normalized.unknownEncrypted || 0;

        // Activity
        if (normalized.staleDevices === undefined) normalized.staleDevices = normalized.stale || 0;

        // Windows
        if (normalized.win10Count === undefined) normalized.win10Count = normalized.windows10 || 0;
        if (normalized.win11Count === undefined) normalized.win11Count = normalized.windows11 || 0;
        if (normalized.winSupportedCount === undefined) normalized.winSupportedCount = normalized.windowsSupported || 0;
        if (normalized.winUnsupportedCount === undefined) normalized.winUnsupportedCount = normalized.windowsUnsupported || 0;

        // Ownership
        if (normalized.corporateDevices === undefined) normalized.corporateDevices = normalized.corporate || 0;
        if (normalized.personalDevices === undefined) normalized.personalDevices = normalized.personal || 0;

        // Breakdowns: convert arrays to maps when needed
        if (Array.isArray(normalized.osBreakdown)) {
            var osMap = {};
            normalized.osBreakdown.forEach(function(item) {
                if (item && item.name !== undefined) osMap[item.name] = item.count || 0;
            });
            normalized.osBreakdown = osMap;
        } else if (!normalized.osBreakdown) {
            normalized.osBreakdown = {};
        }

        if (Array.isArray(normalized.manufacturerBreakdown)) {
            var mfrMap = {};
            normalized.manufacturerBreakdown.forEach(function(item) {
                if (item && item.name !== undefined) mfrMap[item.name] = item.count || 0;
            });
            normalized.manufacturerBreakdown = mfrMap;
        } else if (!normalized.manufacturerBreakdown) {
            normalized.manufacturerBreakdown = {};
        }

        return normalized;
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var data = extractData(DataLoader.getData('devices') || []);
        var container = document.getElementById('devices-content');
        if (!container) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, data);
                break;
            case 'devices':
                renderDevicesTab(container, data.devices);
                break;
            case 'windows':
                renderWindowsTab(container, data.devices);
                break;
            case 'certificates':
                renderCertificatesTab(container, data.devices);
                break;
            case 'autopilot':
                renderAutopilotTab(container);
                break;
        }
    }

    function renderOverview(container, data) {
        var summary = data.summary;
        var devices = data.devices;
        var insights = data.insights || [];

        var rateClass = summary.complianceRate >= 90 ? 'text-success' : summary.complianceRate >= 70 ? 'text-warning' : 'text-critical';
        var compliant = summary.compliantDevices || 0;
        var noncompliant = summary.noncompliantDevices || 0;
        var unknown = summary.unknownDevices || 0;

        var html = '<div class="analytics-section">';
        html += '<h3>Device Compliance Overview</h3>';
        html += '<div class="compliance-overview">';
        html += '<div class="compliance-chart">';
        var radius = 40;
        var circumference = 2 * Math.PI * radius;
        var totalForChart = compliant + noncompliant + unknown;
        var compliantDash = totalForChart > 0 ? (compliant / totalForChart) * circumference : 0;
        var noncompliantDash = totalForChart > 0 ? (noncompliant / totalForChart) * circumference : 0;
        var unknownDash = totalForChart > 0 ? (unknown / totalForChart) * circumference : 0;
        html += '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        var offset = 0;
        if (compliant > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-success)" stroke-width="10" stroke-dasharray="' + compliantDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += compliantDash;
        }
        if (noncompliant > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-critical)" stroke-width="10" stroke-dasharray="' + noncompliantDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += noncompliantDash;
        }
        if (unknown > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-neutral)" stroke-width="10" stroke-dasharray="' + unknownDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value ' + rateClass + '">' + Math.round(summary.complianceRate) + '%</span><span class="donut-label">Compliant</span></div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="compliance-legend">';
        html += '<div class="legend-item"><span class="legend-dot bg-success"></span> Compliant: <strong>' + compliant + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Non-Compliant: <strong>' + noncompliant + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-neutral"></span> Unknown: <strong>' + unknown + '</strong></div>';
        html += '</div></div></div>';

        // Analytics Grid
        html += '<div class="analytics-grid">';

        // Priority Signals
        var certRisk = (summary.certExpired || 0) + (summary.certCritical || 0);
        var unsupportedWindows = summary.winUnsupportedCount || 0;
        var notEncrypted = summary.notEncryptedDevices || 0;
        var stale = summary.staleDevices || 0;
        html += '<div class="analytics-card">';
        html += '<h4>Priority Signals</h4>';
        html += '<div class="compliance-legend">';
        html += '<div class="legend-item"><span class="legend-dot ' + (noncompliant > 0 ? 'bg-critical' : 'bg-success') + '"></span> Non-Compliant: <strong>' + noncompliant + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot ' + (notEncrypted > 0 ? 'bg-critical' : 'bg-success') + '"></span> Not Encrypted: <strong>' + notEncrypted + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot ' + (stale > 0 ? 'bg-warning' : 'bg-success') + '"></span> Stale Devices: <strong>' + stale + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot ' + (certRisk > 0 ? 'bg-critical' : 'bg-success') + '"></span> Cert Expired/Critical: <strong>' + certRisk + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot ' + (unsupportedWindows > 0 ? 'bg-warning' : 'bg-success') + '"></span> Unsupported Windows: <strong>' + unsupportedWindows + '</strong></div>';
        html += '</div></div>';

        // OS Breakdown
        html += '<div class="analytics-card">';
        html += '<h4>Platform Breakdown</h4>';
        html += '<div class="platform-list">';
        var osKeys = Object.keys(summary.osBreakdown).sort(function(a, b) {
            return summary.osBreakdown[b] - summary.osBreakdown[a];
        });
        osKeys.forEach(function(os) {
            var count = summary.osBreakdown[os];
            var pct = summary.totalDevices > 0 ? Math.round((count / summary.totalDevices) * 100) : 0;
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + os + '</span>';
            html += '<span class="platform-policies">' + count + ' devices</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill bg-info" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Manufacturer Breakdown
        html += '<div class="analytics-card">';
        html += '<h4>Manufacturer Breakdown</h4>';
        html += '<div class="platform-list">';
        var mfrKeys = Object.keys(summary.manufacturerBreakdown).sort(function(a, b) {
            return summary.manufacturerBreakdown[b] - summary.manufacturerBreakdown[a];
        }).slice(0, 6);
        mfrKeys.forEach(function(mfr) {
            var count = summary.manufacturerBreakdown[mfr];
            var pct = summary.totalDevices > 0 ? Math.round((count / summary.totalDevices) * 100) : 0;
            html += '<div class="platform-row">';
            html += '<span class="platform-name">' + mfr + '</span>';
            html += '<span class="platform-policies">' + count + ' devices</span>';
            html += '<div class="mini-bar"><div class="mini-bar-fill bg-info" style="width:' + pct + '%"></div></div>';
            html += '<span class="platform-rate">' + pct + '%</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Ownership Breakdown
        html += '<div class="analytics-card">';
        html += '<h4>Ownership Breakdown</h4>';
        html += '<div class="platform-list">';
        var corpPct = summary.totalDevices > 0 ? Math.round((summary.corporateDevices / summary.totalDevices) * 100) : 0;
        var persPct = summary.totalDevices > 0 ? Math.round((summary.personalDevices / summary.totalDevices) * 100) : 0;
        html += '<div class="platform-row"><span class="platform-name">Corporate</span><span class="platform-policies">' + summary.corporateDevices + ' devices</span>';
        html += '<div class="mini-bar"><div class="mini-bar-fill bg-info" style="width:' + corpPct + '%"></div></div><span class="platform-rate">' + corpPct + '%</span></div>';
        html += '<div class="platform-row"><span class="platform-name">Personal</span><span class="platform-policies">' + summary.personalDevices + ' devices</span>';
        html += '<div class="mini-bar"><div class="mini-bar-fill bg-neutral" style="width:' + persPct + '%"></div></div><span class="platform-rate">' + persPct + '%</span></div>';
        html += '</div></div>';

        html += '</div>'; // end analytics-grid

        // Quick Status Cards
        html += '<div class="analytics-section">';
        html += '<h3>Quick Status</h3>';
        html += '<div class="summary-cards" style="margin-bottom:0">';
        html += '<div class="summary-card' + (summary.notEncryptedDevices > 0 ? ' card-warning' : ' card-success') + '"><div class="summary-value">' + summary.notEncryptedDevices + '</div><div class="summary-label">Not Encrypted</div></div>';
        html += '<div class="summary-card' + (summary.certExpired > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value">' + summary.certExpired + '</div><div class="summary-label">Certs Expired</div></div>';
        html += '<div class="summary-card' + (summary.certCritical > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + summary.certCritical + '</div><div class="summary-label">Certs Critical</div></div>';
        html += '<div class="summary-card' + (summary.winUnsupportedCount > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value">' + summary.winUnsupportedCount + '</div><div class="summary-label">Win Unsupported</div></div>';
        html += '</div></div>';

        // Devices Needing Attention
        var needsAttention = devices.filter(function(d) {
            return d.complianceState === 'noncompliant' ||
                   d.isStale === true ||
                   d.certStatus === 'expired' ||
                   d.certStatus === 'critical' ||
                   d.windowsSupported === false ||
                   d.isEncrypted === false;
        });

        if (needsAttention.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Devices Needing Attention (' + needsAttention.length + ')</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Device</th><th>User</th><th>Issues</th><th>Last Sync</th>';
            html += '</tr></thead><tbody>';

            needsAttention.slice(0, 10).forEach(function(d) {
                var issues = [];
                if (d.complianceState === 'noncompliant') issues.push('<span class="badge badge-critical">Non-Compliant</span>');
                if (d.isStale) issues.push('<span class="badge badge-warning">Stale</span>');
                if (d.certStatus === 'expired') issues.push('<span class="badge badge-critical">Cert Expired</span>');
                if (d.certStatus === 'critical') issues.push('<span class="badge badge-warning">Cert Critical</span>');
                if (d.windowsSupported === false) issues.push('<span class="badge badge-critical">Win Unsupported</span>');
                if (d.isEncrypted === false) issues.push('<span class="badge badge-warning">Not Encrypted</span>');

                html += '<tr>';
                html += '<td><strong>' + (d.deviceName || '--') + '</strong></td>';
                html += '<td class="cell-truncate">' + (d.userPrincipalName || '--') + '</td>';
                html += '<td>' + issues.join(' ') + '</td>';
                html += '<td>' + formatDate(d.lastSync) + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (needsAttention.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + needsAttention.length + ' devices. View the All Devices tab for complete list.</p>';
            }
            html += '</div>';
        }

        // Insights section
        if (insights.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Device Insights</h3>';
            html += '<div class="insights-list">';
            insights.forEach(function(insight) {
                var severityClass = 'insight-' + (insight.severity || 'info');
                var badgeClass = insight.severity === 'critical' ? 'badge-danger' :
                                 insight.severity === 'high' ? 'badge-warning' :
                                 insight.severity === 'medium' ? 'badge-info' : 'badge-neutral';
                html += '<div class="insight-card ' + severityClass + '">';
                html += '<div class="insight-header">';
                html += '<span class="badge ' + badgeClass + '">' + (insight.severity || 'info').toUpperCase() + '</span>';
                html += '<span class="insight-category">' + (insight.category || '') + '</span>';
                html += '</div>';
                html += '<p class="insight-description">' + insight.description + '</p>';
                if (insight.recommendedAction) {
                    html += '<p class="insight-action"><strong>Action:</strong> ' + insight.recommendedAction + '</p>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        }

        // Devices per Person
        html += '<div class="analytics-section">';
        html += '<h3>Devices per Person</h3>';
        html += '<div id="devices-per-person-container"></div>';
        html += '</div>';

        container.innerHTML = html;

        // Render devices per person
        renderDevicesPerPerson(devices);
    }

    function renderDevicesTab(container, devices) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="devices-search" placeholder="Search devices...">';
        html += '<select class="filter-select" id="devices-os"><option value="all">All OS</option>';
        var osList = [];
        devices.forEach(function(d) { if (d.os && osList.indexOf(d.os) === -1) osList.push(d.os); });
        osList.sort().forEach(function(os) { html += '<option value="' + os + '">' + os + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="devices-compliance"><option value="all">All Compliance</option>';
        html += '<option value="compliant">Compliant</option><option value="noncompliant">Non-Compliant</option><option value="unknown">Unknown</option></select>';
        html += '<select class="filter-select" id="devices-ownership"><option value="all">All Ownership</option>';
        html += '<option value="corporate">Corporate</option><option value="personal">Personal</option></select>';
        html += '<label class="filter-checkbox"><input type="checkbox" id="devices-stale"> Stale only</label>';
        html += '<div id="devices-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="devices-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'devices-colselector',
            storageKey: 'tenantscope-devices-cols-v3',
            allColumns: [
                // Core identity
                { key: 'deviceName', label: 'Device Name' },
                { key: 'userPrincipalName', label: 'User' },
                { key: 'primaryUserDisplayName', label: 'Display Name' },
                { key: 'azureAdDeviceId', label: 'Azure AD ID' },
                // OS
                { key: 'os', label: 'OS' },
                { key: 'osVersion', label: 'OS Version' },
                { key: 'windowsType', label: 'Win Type' },
                { key: 'windowsRelease', label: 'Win Release' },
                { key: 'windowsSupported', label: 'Win Supported' },
                { key: 'windowsEOL', label: 'Win EOL' },
                { key: 'androidSecurityPatchLevel', label: 'Android Patch' },
                // Compliance
                { key: 'complianceState', label: 'Compliance' },
                { key: 'inGracePeriod', label: 'In Grace Period' },
                { key: 'nonCompliantPolicyCount', label: 'Non-Compliant Policies' },
                // Activity
                { key: 'lastSync', label: 'Last Sync' },
                { key: 'daysSinceSync', label: 'Days Since Sync' },
                { key: 'isStale', label: 'Stale' },
                // Enrollment
                { key: 'ownership', label: 'Ownership' },
                { key: 'enrollmentTypeDisplay', label: 'Enrollment Type' },
                { key: 'registrationStateDisplay', label: 'Registration' },
                { key: 'enrollmentProfileName', label: 'Enrollment Profile' },
                { key: 'enrolledDateTime', label: 'Enrolled' },
                { key: 'autopilotEnrolled', label: 'Autopilot' },
                // Hardware
                { key: 'manufacturer', label: 'Manufacturer' },
                { key: 'model', label: 'Model' },
                { key: 'serialNumber', label: 'Serial' },
                { key: 'chassisType', label: 'Chassis Type' },
                { key: 'deviceCategory', label: 'Category' },
                { key: 'physicalMemoryGB', label: 'RAM (GB)' },
                // Security
                { key: 'isEncrypted', label: 'Encrypted' },
                { key: 'jailBroken', label: 'Jailbroken' },
                { key: 'isSupervised', label: 'Supervised' },
                { key: 'threatStateDisplay', label: 'Threat State' },
                { key: 'threatSeverity', label: 'Threat Severity' },
                // Management
                { key: 'joinType', label: 'Join Type' },
                { key: 'managementAgent', label: 'Mgmt Agent' },
                { key: 'managementSource', label: 'Source' },
                // Certificates
                { key: 'certStatus', label: 'Cert Status' },
                { key: 'daysUntilCertExpiry', label: 'Cert Days' },
                // Exchange
                { key: 'exchangeAccessDisplay', label: 'Exchange Access' },
                // Storage
                { key: 'totalStorageGB', label: 'Total Storage' },
                { key: 'freeStorageGB', label: 'Free Storage' },
                { key: 'storageUsedPct', label: 'Storage Used %' },
                // Network
                { key: 'wifiMacAddress', label: 'WiFi MAC' },
                { key: 'ethernetMacAddress', label: 'Ethernet MAC' },
                { key: 'phoneNumber', label: 'Phone Number' },
                { key: 'subscriberCarrier', label: 'Carrier' },
                // Mobile identifiers
                { key: 'imei', label: 'IMEI' },
                { key: 'meid', label: 'MEID' }
            ],
            defaultVisible: ['deviceName', 'userPrincipalName', 'os', 'windowsType', 'complianceState', 'lastSync', 'isEncrypted', 'certStatus', 'ownership', 'threatStateDisplay'],
            onColumnsChanged: function() { applyDeviceFilters(); }
        });

        Filters.setup('devices-search', applyDeviceFilters);
        Filters.setup('devices-os', applyDeviceFilters);
        Filters.setup('devices-compliance', applyDeviceFilters);
        Filters.setup('devices-ownership', applyDeviceFilters);
        document.getElementById('devices-stale').addEventListener('change', applyDeviceFilters);
        applyDeviceFilters();
    }

    function applyDeviceFilters() {
        var data = extractData(DataLoader.getData('devices') || []);
        var devices = data.devices;

        // Apply department filter if available
        if (typeof DepartmentFilter !== 'undefined') {
            devices = DepartmentFilter.filterByUPN(devices, 'userPrincipalName');
        }

        var filterConfig = {
            search: Filters.getValue('devices-search'),
            searchFields: ['deviceName', 'userPrincipalName', 'primaryUserDisplayName', 'model', 'manufacturer', 'serialNumber'],
            exact: {}
        };

        var osFilter = Filters.getValue('devices-os');
        if (osFilter && osFilter !== 'all') filterConfig.exact.os = osFilter;

        var compFilter = Filters.getValue('devices-compliance');
        if (compFilter && compFilter !== 'all') filterConfig.exact.complianceState = compFilter;

        var ownerFilter = Filters.getValue('devices-ownership');
        if (ownerFilter && ownerFilter !== 'all') filterConfig.exact.ownership = ownerFilter;

        var filtered = Filters.apply(devices, filterConfig);

        // Stale filter
        var staleCheckbox = document.getElementById('devices-stale');
        if (staleCheckbox && staleCheckbox.checked) {
            filtered = filtered.filter(function(d) { return d.isStale === true; });
        }

        renderDevicesTable(filtered);
    }

    function renderDevicesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'userPrincipalName', 'os', 'windowsType', 'complianceState', 'lastSync', 'isEncrypted', 'certStatus', 'ownership', 'threatStateDisplay'];

        var allDefs = [
            // Core identity
            { key: 'deviceName', label: 'Device Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            { key: 'primaryUserDisplayName', label: 'Display Name' },
            { key: 'azureAdDeviceId', label: 'Azure AD ID', className: 'cell-truncate' },
            // OS
            { key: 'os', label: 'OS', formatter: formatOS },
            { key: 'osVersion', label: 'OS Version' },
            { key: 'windowsType', label: 'Win Type', formatter: formatWindowsType },
            { key: 'windowsRelease', label: 'Win Release' },
            { key: 'windowsSupported', label: 'Win Supported', formatter: formatBoolean },
            { key: 'windowsEOL', label: 'Win EOL' },
            { key: 'androidSecurityPatchLevel', label: 'Android Patch' },
            // Compliance
            { key: 'complianceState', label: 'Compliance', formatter: formatCompliance },
            { key: 'inGracePeriod', label: 'In Grace Period', formatter: formatBoolean },
            { key: 'nonCompliantPolicyCount', label: 'Non-Compliant Policies', formatter: function(v) { return v === null || v === undefined ? '--' : v; } },
            // Activity
            { key: 'lastSync', label: 'Last Sync', formatter: formatDate },
            { key: 'daysSinceSync', label: 'Days Since Sync', formatter: formatDaysSinceSync },
            { key: 'isStale', label: 'Stale', formatter: formatStale },
            // Enrollment
            { key: 'ownership', label: 'Ownership', formatter: formatOwnership },
            { key: 'enrollmentTypeDisplay', label: 'Enrollment Type' },
            { key: 'registrationStateDisplay', label: 'Registration' },
            { key: 'enrollmentProfileName', label: 'Enrollment Profile' },
            { key: 'enrolledDateTime', label: 'Enrolled', formatter: formatDate },
            { key: 'autopilotEnrolled', label: 'Autopilot', formatter: formatBoolean },
            // Hardware
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'model', label: 'Model' },
            { key: 'serialNumber', label: 'Serial' },
            { key: 'chassisType', label: 'Chassis Type' },
            { key: 'deviceCategory', label: 'Category' },
            { key: 'physicalMemoryGB', label: 'RAM (GB)', formatter: function(v) { return v ? v + ' GB' : '--'; }},
            // Security
            { key: 'isEncrypted', label: 'Encrypted', formatter: formatBoolean },
            { key: 'jailBroken', label: 'Jailbroken', formatter: formatJailbroken },
            { key: 'isSupervised', label: 'Supervised', formatter: formatBoolean },
            { key: 'threatStateDisplay', label: 'Threat State', formatter: formatThreatState },
            { key: 'threatSeverity', label: 'Threat Severity', formatter: formatThreatSeverity },
            // Management
            { key: 'joinType', label: 'Join Type' },
            { key: 'managementAgent', label: 'Mgmt Agent' },
            { key: 'managementSource', label: 'Source' },
            // Certificates
            { key: 'certStatus', label: 'Cert Status', formatter: formatCertStatus },
            { key: 'daysUntilCertExpiry', label: 'Cert Days', formatter: formatCertDays },
            // Exchange
            { key: 'exchangeAccessDisplay', label: 'Exchange Access', formatter: formatExchangeAccess },
            // Storage
            { key: 'totalStorageGB', label: 'Total Storage', formatter: function(v) { return v ? v + ' GB' : '--'; }},
            { key: 'freeStorageGB', label: 'Free Storage', formatter: function(v) { return v ? v + ' GB' : '--'; }},
            { key: 'storageUsedPct', label: 'Storage Used %', formatter: formatStoragePct },
            // Network
            { key: 'wifiMacAddress', label: 'WiFi MAC' },
            { key: 'ethernetMacAddress', label: 'Ethernet MAC' },
            { key: 'phoneNumber', label: 'Phone Number' },
            { key: 'subscriberCarrier', label: 'Carrier' },
            // Mobile identifiers
            { key: 'imei', label: 'IMEI' },
            { key: 'meid', label: 'MEID' }
        ];

        Tables.render({
            containerId: 'devices-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showDeviceDetails
        });
    }

    function renderWindowsTab(container, devices) {
        // Filter to Windows devices only
        var winDevices = devices.filter(function(d) { return d.os === 'Windows'; });
        var summary = computeSummary(winDevices);

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + winDevices.length + '</div><div class="summary-label">Windows Devices</div></div>';
        html += '<div class="summary-card card-info"><div class="summary-value">' + summary.win11Count + '</div><div class="summary-label">Windows 11</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + summary.win10Count + '</div><div class="summary-label">Windows 10</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + summary.winSupportedCount + '</div><div class="summary-label">Supported</div></div>';
        html += '<div class="summary-card' + (summary.winUnsupportedCount > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + summary.winUnsupportedCount + '</div><div class="summary-label">Unsupported</div></div>';
        html += '</div>';

        // Windows Version Breakdown
        var releases = {};
        winDevices.forEach(function(d) {
            var rel = (d.windowsType || 'Unknown') + ' ' + (d.windowsRelease || 'Unknown');
            if (!releases[rel]) releases[rel] = { total: 0, supported: 0, unsupported: 0 };
            releases[rel].total++;
            if (d.windowsSupported === true) releases[rel].supported++;
            else if (d.windowsSupported === false) releases[rel].unsupported++;
        });

        html += '<div class="analytics-section">';
        html += '<h3>Windows Version Distribution</h3>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Version</th><th>Devices</th><th>Supported</th><th>Unsupported</th><th>Support %</th>';
        html += '</tr></thead><tbody>';
        Object.keys(releases).sort().forEach(function(rel) {
            var r = releases[rel];
            var supportPct = r.total > 0 ? Math.round((r.supported / r.total) * 100) : 0;
            var pctClass = supportPct === 100 ? 'text-success' : supportPct >= 80 ? 'text-warning' : 'text-critical';
            html += '<tr>';
            html += '<td><strong>' + rel + '</strong></td>';
            html += '<td>' + r.total + '</td>';
            html += '<td class="text-success">' + r.supported + '</td>';
            html += '<td class="text-critical">' + r.unsupported + '</td>';
            html += '<td class="' + pctClass + ' font-bold">' + supportPct + '%</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        // Unsupported devices list
        var unsupported = winDevices.filter(function(d) { return d.windowsSupported === false; });
        if (unsupported.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Unsupported Windows Devices (' + unsupported.length + ')</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Device</th><th>User</th><th>Version</th><th>EOL Date</th><th>Last Sync</th>';
            html += '</tr></thead><tbody>';
            unsupported.forEach(function(d) {
                html += '<tr>';
                html += '<td><strong>' + (d.deviceName || '--') + '</strong></td>';
                html += '<td class="cell-truncate">' + (d.userPrincipalName || '--') + '</td>';
                html += '<td>' + (d.windowsType || '--') + ' ' + (d.windowsRelease || '') + '</td>';
                html += '<td class="text-critical">' + (d.windowsEOL || '--') + '</td>';
                html += '<td>' + formatDate(d.lastSync) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        container.innerHTML = html;
    }

    function renderCertificatesTab(container, devices) {
        var certExpired = devices.filter(function(d) { return d.certStatus === 'expired'; });
        var certCritical = devices.filter(function(d) { return d.certStatus === 'critical'; });
        var certWarning = devices.filter(function(d) { return d.certStatus === 'warning'; });
        var certHealthy = devices.filter(function(d) { return d.certStatus === 'healthy'; });

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + devices.length + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card' + (certExpired.length > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value">' + certExpired.length + '</div><div class="summary-label">Expired</div></div>';
        html += '<div class="summary-card' + (certCritical.length > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + certCritical.length + '</div><div class="summary-label">Critical (30d)</div></div>';
        html += '<div class="summary-card' + (certWarning.length > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + certWarning.length + '</div><div class="summary-label">Warning (60d)</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + certHealthy.length + '</div><div class="summary-label">Healthy</div></div>';
        html += '</div>';

        // Expired certificates
        if (certExpired.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Expired Certificates (' + certExpired.length + ')</h3>';
            html += renderCertTable(certExpired);
            html += '</div>';
        }

        // Critical certificates
        if (certCritical.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Certificates Expiring in 30 Days (' + certCritical.length + ')</h3>';
            html += renderCertTable(certCritical);
            html += '</div>';
        }

        // Warning certificates
        if (certWarning.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Certificates Expiring in 60 Days (' + certWarning.length + ')</h3>';
            html += renderCertTable(certWarning);
            html += '</div>';
        }

        if (certExpired.length === 0 && certCritical.length === 0 && certWarning.length === 0) {
            html += '<div class="analytics-section"><div class="empty-state"><div class="empty-state-title">All Certificates Healthy</div><p>No device certificates require immediate attention.</p></div></div>';
        }

        container.innerHTML = html;
    }

    function renderCertTable(devices) {
        var html = '<table class="data-table"><thead><tr>';
        html += '<th>Device</th><th>User</th><th>Expiry Date</th><th>Days</th><th>Last Sync</th>';
        html += '</tr></thead><tbody>';
        devices.forEach(function(d) {
            var daysClass = d.daysUntilCertExpiry < 0 ? 'text-critical font-bold' : d.daysUntilCertExpiry <= 30 ? 'text-critical' : 'text-warning';
            html += '<tr>';
            html += '<td><strong>' + (d.deviceName || '--') + '</strong></td>';
            html += '<td class="cell-truncate">' + (d.userPrincipalName || '--') + '</td>';
            html += '<td>' + (d.certExpiryDate ? formatDate(d.certExpiryDate) : '--') + '</td>';
            html += '<td class="' + daysClass + '">' + (d.daysUntilCertExpiry !== null ? d.daysUntilCertExpiry : '--') + '</td>';
            html += '<td>' + formatDate(d.lastSync) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function renderAutopilotTab(container) {
        var autopilot = DataLoader.getData('autopilot') || [];

        if (autopilot.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Autopilot Devices</div><p>No Windows Autopilot device identities found.</p></div>';
            return;
        }

        var enrolled = autopilot.filter(function(d) { return d.enrollmentState === 'enrolled'; }).length;
        var notContacted = autopilot.filter(function(d) { return d.enrollmentState === 'notContacted'; }).length;
        var failed = autopilot.filter(function(d) { return d.enrollmentState === 'failed'; }).length;
        var noProfile = autopilot.filter(function(d) { return !d.profileAssigned; }).length;

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + autopilot.length + '</div><div class="summary-label">Total Autopilot</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + enrolled + '</div><div class="summary-label">Enrolled</div></div>';
        html += '<div class="summary-card' + (notContacted > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + notContacted + '</div><div class="summary-label">Not Contacted</div></div>';
        html += '<div class="summary-card' + (failed > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + failed + '</div><div class="summary-label">Failed</div></div>';
        html += '<div class="summary-card' + (noProfile > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + noProfile + '</div><div class="summary-label">No Profile</div></div>';
        html += '</div>';

        html += '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="autopilot-search" placeholder="Search autopilot devices...">';
        html += '</div>';
        html += '<div class="table-container" id="autopilot-table"></div>';
        container.innerHTML = html;

        renderAutopilotTable(autopilot);
        Filters.setup('autopilot-search', function() {
            var search = (Filters.getValue('autopilot-search') || '').toLowerCase();
            var filtered = autopilot.filter(function(d) {
                return (d.serialNumber || '').toLowerCase().indexOf(search) !== -1 ||
                       (d.model || '').toLowerCase().indexOf(search) !== -1 ||
                       (d.manufacturer || '').toLowerCase().indexOf(search) !== -1 ||
                       (d.groupTag || '').toLowerCase().indexOf(search) !== -1;
            });
            renderAutopilotTable(filtered);
        });
    }

    function renderAutopilotTable(data) {
        Tables.render({
            containerId: 'autopilot-table',
            data: data,
            columns: [
                { key: 'serialNumber', label: 'Serial Number', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
                { key: 'model', label: 'Model' },
                { key: 'manufacturer', label: 'Manufacturer' },
                { key: 'groupTag', label: 'Group Tag' },
                { key: 'enrollmentState', label: 'Enrollment', formatter: formatEnrollmentState },
                { key: 'lastContacted', label: 'Last Contacted', formatter: formatDate },
                { key: 'profileAssigned', label: 'Profile', formatter: formatProfileAssigned },
                { key: 'purchaseOrder', label: 'PO' }
            ],
            pageSize: 25,
            onRowClick: showAutopilotDetails
        });
    }

    function renderDevicesPerPerson(devices) {
        var userCounts = {};
        devices.forEach(function(d) {
            var upn = d.userPrincipalName;
            if (!upn) return;
            if (!userCounts[upn]) userCounts[upn] = 0;
            userCounts[upn]++;
        });

        var buckets = { '1': 0, '2': 0, '3': 0, '4+': 0 };
        Object.keys(userCounts).forEach(function(upn) {
            var c = userCounts[upn];
            var bucket = c >= 4 ? '4+' : String(c);
            buckets[bucket]++;
        });

        var totalUsers = Object.keys(userCounts).length;

        var container = document.getElementById('devices-per-person-container');
        if (!container) return;

        var html = '<table class="data-table"><thead><tr><th>Device Count</th><th>Users</th><th>%</th></tr></thead><tbody>';
        ['1', '2', '3', '4+'].forEach(function(bucket) {
            var count = buckets[bucket];
            var pct = totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0;
            html += '<tr><td>' + bucket + ' device' + (bucket !== '1' ? 's' : '') + '</td><td>' + count + '</td><td>' + pct + '%</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Formatters
    function formatOS(v) {
        var colors = { 'Windows': 'badge-info', 'macOS': 'badge-neutral', 'iOS': 'badge-success', 'Android': 'badge-success' };
        return '<span class="badge ' + (colors[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
    }

    function formatWindowsType(v) {
        if (!v) return '<span class="text-muted">--</span>';
        if (v === 'Windows 11') return '<span class="badge badge-info">Win 11</span>';
        if (v === 'Windows 10') return '<span class="badge badge-neutral">Win 10</span>';
        return '<span class="badge badge-neutral">' + v + '</span>';
    }

    function formatCompliance(v) {
        var map = { 'compliant': 'badge-success', 'noncompliant': 'badge-critical', 'unknown': 'badge-neutral' };
        var labels = { 'compliant': 'Compliant', 'noncompliant': 'Non-Compliant', 'unknown': 'Unknown' };
        return '<span class="badge ' + (map[v] || 'badge-neutral') + '">' + (labels[v] || v || 'Unknown') + '</span>';
    }

    function formatCertStatus(v) {
        var map = { 'expired': 'badge-critical', 'critical': 'badge-critical', 'warning': 'badge-warning', 'healthy': 'badge-success', 'unknown': 'badge-neutral' };
        var labels = { 'expired': 'Expired', 'critical': 'Critical', 'warning': 'Warning', 'healthy': 'Healthy', 'unknown': 'Unknown' };
        return '<span class="badge ' + (map[v] || 'badge-neutral') + '">' + (labels[v] || v || 'Unknown') + '</span>';
    }

    function formatCertDays(v) {
        if (v === null || v === undefined) return '<span class="text-muted">--</span>';
        var cls = v < 0 ? 'text-critical font-bold' : v <= 30 ? 'text-critical' : v <= 60 ? 'text-warning' : '';
        return '<span class="' + cls + '">' + v + '</span>';
    }

    function formatOwnership(v) {
        if (v === 'corporate') return '<span class="badge badge-info">Corporate</span>';
        if (v === 'personal') return '<span class="badge badge-neutral">Personal</span>';
        return '<span class="badge badge-neutral">Unknown</span>';
    }

    function formatBoolean(v) {
        if (v === true) return '<span class="text-success font-bold">Yes</span>';
        if (v === false) return '<span class="text-critical">No</span>';
        return '<span class="text-muted">--</span>';
    }

    function formatStale(v) {
        if (v === true) return '<span class="badge badge-warning">Stale</span>';
        return '<span class="text-muted">No</span>';
    }

    function formatDaysSinceSync(v) {
        if (v === null || v === undefined) return '<span class="text-muted">--</span>';
        var cls = v >= 90 ? 'text-critical font-bold' : v >= 30 ? 'text-warning' : '';
        return '<span class="' + cls + '">' + v + 'd</span>';
    }

    function formatStoragePct(v) {
        if (v === null || v === undefined) return '<span class="text-muted">--</span>';
        var cls = v >= 90 ? 'text-critical' : v >= 80 ? 'text-warning' : '';
        return '<span class="' + cls + '">' + v + '%</span>';
    }

    function formatJailbroken(v) {
        if (v === 'True' || v === true) return '<span class="badge badge-critical">Jailbroken</span>';
        if (v === 'False' || v === false) return '<span class="text-success">No</span>';
        return '<span class="text-muted">--</span>';
    }

    function formatThreatState(v) {
        if (!v) return '<span class="text-muted">--</span>';
        var map = {
            'Secured': 'badge-success',
            'Compromised': 'badge-critical',
            'High': 'badge-critical',
            'Medium': 'badge-warning',
            'Low': 'badge-info',
            'Active': 'badge-success',
            'Deactivated': 'badge-neutral',
            'Unknown': 'badge-neutral'
        };
        return '<span class="badge ' + (map[v] || 'badge-neutral') + '">' + v + '</span>';
    }

    function formatThreatSeverity(v) {
        if (!v) return '<span class="text-muted">--</span>';
        var map = {
            'critical': 'text-critical font-bold',
            'high': 'text-critical',
            'medium': 'text-warning',
            'low': 'text-info',
            'none': 'text-success',
            'unknown': 'text-muted'
        };
        return '<span class="' + (map[v] || '') + '">' + (v.charAt(0).toUpperCase() + v.slice(1)) + '</span>';
    }

    function formatExchangeAccess(v) {
        if (!v) return '<span class="text-muted">--</span>';
        var map = {
            'Allowed': 'badge-success',
            'Blocked': 'badge-critical',
            'Quarantined': 'badge-warning',
            'None': 'badge-neutral',
            'Unknown': 'badge-neutral'
        };
        return '<span class="badge ' + (map[v] || 'badge-neutral') + '">' + v + '</span>';
    }

    function formatDate(v) {
        if (!v) return '<span class="text-muted">--</span>';
        try {
            var date = new Date(v);
            return date.toLocaleDateString();
        } catch (e) {
            return '--';
        }
    }

    function formatEnrollmentState(v) {
        var map = { 'enrolled': 'badge-success', 'notContacted': 'badge-warning', 'failed': 'badge-critical' };
        var labels = { 'enrolled': 'Enrolled', 'notContacted': 'Not Contacted', 'failed': 'Failed' };
        return '<span class="badge ' + (map[v] || 'badge-neutral') + '">' + (labels[v] || v || 'Unknown') + '</span>';
    }

    function formatProfileAssigned(v, row) {
        if (v === true) {
            var status = row && row.profileAssignmentStatus;
            if (status === 'assignedInSync') return '<span class="badge badge-success">Assigned (Sync)</span>';
            if (status === 'assignedOutOfSync') return '<span class="badge badge-warning">Assigned (Out)</span>';
            return '<span class="badge badge-success">Assigned</span>';
        }
        return '<span class="badge badge-warning">No</span>';
    }

    function showDeviceDetails(device) {
        // Device details modal - data is from trusted collector scripts
        document.getElementById('modal-title').textContent = device.deviceName || 'Device Details';

        var html = '<div class="detail-grid">';

        // Device Identity
        html += '<div class="detail-section"><h4>Device Identity</h4><dl class="detail-list">';
        html += '<dt>Device Name</dt><dd>' + (device.deviceName || '--') + '</dd>';
        html += '<dt>Managed Name</dt><dd>' + (device.managedDeviceName || '--') + '</dd>';
        html += '<dt>User</dt><dd>' + (device.userPrincipalName || '--') + '</dd>';
        html += '<dt>Display Name</dt><dd>' + (device.primaryUserDisplayName || '--') + '</dd>';
        html += '<dt>Azure AD Device ID</dt><dd class="text-mono" style="font-size:0.8em">' + (device.azureAdDeviceId || '--') + '</dd>';
        html += '<dt>Intune Device ID</dt><dd class="text-mono" style="font-size:0.8em">' + (device.id || '--') + '</dd>';
        html += '</dl></div>';

        // Hardware
        html += '<div class="detail-section"><h4>Hardware</h4><dl class="detail-list">';
        html += '<dt>Manufacturer</dt><dd>' + (device.manufacturer || '--') + '</dd>';
        html += '<dt>Model</dt><dd>' + (device.model || '--') + '</dd>';
        html += '<dt>Serial Number</dt><dd>' + (device.serialNumber || '--') + '</dd>';
        html += '<dt>Chassis Type</dt><dd>' + (device.chassisType || '--') + '</dd>';
        html += '<dt>Category</dt><dd>' + (device.deviceCategory || '--') + '</dd>';
        html += '<dt>Physical Memory</dt><dd>' + (device.physicalMemoryGB ? device.physicalMemoryGB + ' GB' : '--') + '</dd>';
        html += '</dl></div>';

        // Operating System
        html += '<div class="detail-section"><h4>Operating System</h4><dl class="detail-list">';
        html += '<dt>OS</dt><dd>' + formatOS(device.os) + '</dd>';
        html += '<dt>OS Version</dt><dd>' + (device.osVersion || '--') + '</dd>';
        if (device.windowsType) {
            html += '<dt>Windows Type</dt><dd>' + device.windowsType + '</dd>';
            html += '<dt>Windows Release</dt><dd>' + (device.windowsRelease || '--') + '</dd>';
            html += '<dt>Windows Supported</dt><dd>' + (device.windowsSupported ? '<span class="text-success">Yes</span>' : '<span class="text-critical">No</span>') + '</dd>';
            html += '<dt>Windows EOL</dt><dd>' + (device.windowsEOL || '--') + '</dd>';
        }
        if (device.androidSecurityPatchLevel) {
            html += '<dt>Android Patch Level</dt><dd>' + device.androidSecurityPatchLevel + '</dd>';
        }
        html += '</dl></div>';

        // Security
        html += '<div class="detail-section"><h4>Security</h4><dl class="detail-list">';
        if (device.isEncrypted === true) {
            html += '<dt>Encrypted</dt><dd><span class="text-success">Yes</span></dd>';
        } else if (device.isEncrypted === false) {
            html += '<dt>Encrypted</dt><dd><span class="text-critical">No</span></dd>';
        } else {
            html += '<dt>Encrypted</dt><dd><span class="text-muted">--</span></dd>';
        }
        html += '<dt>Jailbroken/Rooted</dt><dd>' + formatJailbroken(device.jailBroken) + '</dd>';
        if (device.os === 'iOS') {
            html += '<dt>Supervised</dt><dd>' + (device.isSupervised ? '<span class="text-success">Yes</span>' : '<span class="text-warning">No</span>') + '</dd>';
            html += '<dt>Activation Lock Bypass</dt><dd>' + (device.activationLockBypass ? '<span class="text-success">Available</span>' : 'N/A') + '</dd>';
        }
        html += '<dt>Threat State</dt><dd>' + formatThreatState(device.threatStateDisplay) + '</dd>';
        html += '<dt>Threat Severity</dt><dd>' + formatThreatSeverity(device.threatSeverity) + '</dd>';
        html += '</dl></div>';

        // Compliance
        html += '<div class="detail-section"><h4>Compliance</h4><dl class="detail-list">';
        html += '<dt>Compliance State</dt><dd>' + formatCompliance(device.complianceState) + '</dd>';
        html += '<dt>In Grace Period</dt><dd>' + (device.inGracePeriod ? '<span class="text-warning">Yes</span>' : 'No') + '</dd>';
        if (device.complianceGraceDays) {
            html += '<dt>Grace Period Ends</dt><dd>' + device.complianceGraceDays + ' days</dd>';
        }
        if (device.nonCompliantPolicyCount !== null && device.nonCompliantPolicyCount !== undefined) {
            html += '<dt>Non-Compliant Policies</dt><dd>' + device.nonCompliantPolicyCount + '</dd>';
            if (device.nonCompliantPolicies && device.nonCompliantPolicies.length > 0) {
                html += '<dt>Policy Names</dt><dd>' + device.nonCompliantPolicies.join(', ') + '</dd>';
            }
        }
        html += '</dl></div>';

        // Enrollment & Management
        html += '<div class="detail-section"><h4>Enrollment & Management</h4><dl class="detail-list">';
        html += '<dt>Ownership</dt><dd>' + formatOwnership(device.ownership) + '</dd>';
        html += '<dt>Enrollment Type</dt><dd>' + (device.enrollmentTypeDisplay || '--') + '</dd>';
        html += '<dt>Registration State</dt><dd>' + (device.registrationStateDisplay || '--') + '</dd>';
        html += '<dt>Enrollment Profile</dt><dd>' + (device.enrollmentProfileName || '--') + '</dd>';
        html += '<dt>Join Type</dt><dd>' + (device.joinType || '--') + '</dd>';
        html += '<dt>Management Agent</dt><dd>' + (device.managementAgent || '--') + '</dd>';
        html += '<dt>Management Source</dt><dd>' + (device.managementSource || '--') + '</dd>';
        html += '<dt>Enrolled</dt><dd>' + (device.enrolledDateTime ? new Date(device.enrolledDateTime).toLocaleDateString() : '--') + '</dd>';
        var autopilotLabel = device.autopilotEnrolled === true
            ? '<span class="text-success">Yes</span>'
            : device.autopilotEnrolled === false
                ? 'No'
                : '--';
        html += '<dt>Autopilot Enrolled</dt><dd>' + autopilotLabel + '</dd>';
        html += '</dl></div>';

        // Sync & Certificates
        html += '<div class="detail-section"><h4>Sync & Certificates</h4><dl class="detail-list">';
        html += '<dt>Last Sync</dt><dd>' + (device.lastSync ? new Date(device.lastSync).toLocaleString() : '--') + '</dd>';
        html += '<dt>Days Since Sync</dt><dd>' + (device.daysSinceSync !== null ? device.daysSinceSync + ' days' : '--') + '</dd>';
        html += '<dt>Is Stale</dt><dd>' + (device.isStale ? '<span class="text-warning">Yes</span>' : 'No') + '</dd>';
        html += '<dt>Cert Expiry</dt><dd>' + (device.certExpiryDate ? new Date(device.certExpiryDate).toLocaleDateString() : '--') + '</dd>';
        html += '<dt>Days Until Expiry</dt><dd>' + (device.daysUntilCertExpiry !== null ? device.daysUntilCertExpiry : '--') + '</dd>';
        html += '<dt>Cert Status</dt><dd>' + formatCertStatus(device.certStatus) + '</dd>';
        html += '</dl></div>';

        // Exchange (if applicable)
        if (device.exchangeAccessState || device.easActivated) {
            html += '<div class="detail-section"><h4>Exchange ActiveSync</h4><dl class="detail-list">';
            html += '<dt>Access State</dt><dd>' + formatExchangeAccess(device.exchangeAccessDisplay) + '</dd>';
            html += '<dt>Access Reason</dt><dd>' + (device.exchangeAccessReason || '--') + '</dd>';
            html += '<dt>EAS Activated</dt><dd>' + (device.easActivated ? 'Yes' : 'No') + '</dd>';
            html += '<dt>Last Exchange Sync</dt><dd>' + (device.exchangeLastSync ? new Date(device.exchangeLastSync).toLocaleString() : '--') + '</dd>';
            html += '</dl></div>';
        }

        // Storage
        html += '<div class="detail-section"><h4>Storage</h4><dl class="detail-list">';
        html += '<dt>Total Storage</dt><dd>' + (device.totalStorageGB ? device.totalStorageGB + ' GB' : '--') + '</dd>';
        html += '<dt>Free Storage</dt><dd>' + (device.freeStorageGB ? device.freeStorageGB + ' GB' : '--') + '</dd>';
        html += '<dt>Storage Used</dt><dd>' + formatStoragePct(device.storageUsedPct) + '</dd>';
        html += '</dl></div>';

        // Network
        html += '<div class="detail-section"><h4>Network</h4><dl class="detail-list">';
        html += '<dt>WiFi MAC</dt><dd>' + (device.wifiMacAddress || '--') + '</dd>';
        html += '<dt>Ethernet MAC</dt><dd>' + (device.ethernetMacAddress || '--') + '</dd>';
        if (device.phoneNumber) {
            html += '<dt>Phone Number</dt><dd>' + device.phoneNumber + '</dd>';
        }
        if (device.subscriberCarrier) {
            html += '<dt>Carrier</dt><dd>' + device.subscriberCarrier + '</dd>';
        }
        html += '</dl></div>';

        // Mobile Identifiers (if applicable)
        if (device.imei || device.meid || device.iccid || device.udid) {
            html += '<div class="detail-section"><h4>Mobile Identifiers</h4><dl class="detail-list">';
            if (device.imei) html += '<dt>IMEI</dt><dd>' + device.imei + '</dd>';
            if (device.meid) html += '<dt>MEID</dt><dd>' + device.meid + '</dd>';
            if (device.iccid) html += '<dt>ICCID</dt><dd>' + device.iccid + '</dd>';
            if (device.udid) html += '<dt>UDID</dt><dd>' + device.udid + '</dd>';
            html += '</dl></div>';
        }

        // Admin Notes (if present)
        if (device.notes) {
            html += '<div class="detail-section"><h4>Admin Notes</h4>';
            html += '<p class="text-muted">' + device.notes + '</p>';
            html += '</div>';
        }

        html += '</div>'; // end detail-grid

        // Safe: data is from trusted collector scripts, no user input
        document.getElementById('modal-body').innerHTML = html;
        document.getElementById('modal-overlay').classList.add('visible');
    }

    function showAutopilotDetails(device) {
        document.getElementById('modal-title').textContent = 'Autopilot: ' + (device.serialNumber || 'Device');

        var html = '<div class="detail-grid">';
        html += '<div class="detail-section"><h4>Device Information</h4><dl class="detail-list">';
        html += '<dt>Serial Number</dt><dd>' + (device.serialNumber || '--') + '</dd>';
        html += '<dt>Model</dt><dd>' + (device.model || '--') + '</dd>';
        html += '<dt>Manufacturer</dt><dd>' + (device.manufacturer || '--') + '</dd>';
        html += '<dt>Group Tag</dt><dd>' + (device.groupTag || '--') + '</dd>';
        html += '<dt>Purchase Order</dt><dd>' + (device.purchaseOrder || '--') + '</dd>';
        html += '</dl></div>';

        html += '<div class="detail-section"><h4>Enrollment Status</h4><dl class="detail-list">';
        html += '<dt>Enrollment State</dt><dd>' + formatEnrollmentState(device.enrollmentState) + '</dd>';
        html += '<dt>Last Contacted</dt><dd>' + (device.lastContacted ? new Date(device.lastContacted).toLocaleString() : '--') + '</dd>';
        html += '<dt>Profile Assigned</dt><dd>' + (device.profileAssigned ? 'Yes' : 'No') + '</dd>';
        html += '<dt>Profile Status</dt><dd>' + (device.profileAssignmentStatus || '--') + '</dd>';
        html += '<dt>Device ID</dt><dd style="font-size:0.8em">' + (device.id || '--') + '</dd>';
        html += '</dl></div>';

        html += '</div>';

        document.getElementById('modal-body').innerHTML = html;
        document.getElementById('modal-overlay').classList.add('visible');
    }

    function render(container) {
        var data = extractData(DataLoader.getData('devices') || []);
        var summary = data.summary;
        var devices = data.devices;

        var rateClass = summary.complianceRate >= 90 ? 'text-success' : summary.complianceRate >= 70 ? 'text-warning' : 'text-critical';

        // Get autopilot count
        var autopilot = DataLoader.getData('autopilot') || [];

        var html = '<div class="page-header"><h2>Devices</h2></div>';

        // Summary cards
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + summary.totalDevices + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + summary.compliantDevices + '</div><div class="summary-label">Compliant</div></div>';
        html += '<div class="summary-card' + (summary.noncompliantDevices > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + summary.noncompliantDevices + '</div><div class="summary-label">Non-Compliant</div></div>';
        html += '<div class="summary-card' + (summary.staleDevices > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + summary.staleDevices + '</div><div class="summary-label">Stale</div></div>';
        html += '<div class="summary-card"><div class="summary-value ' + rateClass + '">' + Math.round(summary.complianceRate) + '%</div><div class="summary-label">Compliance Rate</div></div>';
        html += '</div>';

        // Tab bar
        var winDevices = devices.filter(function(d) { return d.os === 'Windows'; }).length;
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="devices">All Devices (' + devices.length + ')</button>';
        html += '<button class="tab-btn" data-tab="windows">Windows (' + winDevices + ')</button>';
        html += '<button class="tab-btn" data-tab="certificates">Certificates</button>';
        html += '<button class="tab-btn" data-tab="autopilot">Autopilot (' + autopilot.length + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="devices-content"></div>';
        container.innerHTML = html;

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();

window.PageDevices = PageDevices;
