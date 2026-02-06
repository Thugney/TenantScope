/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: DEVICES
 *
 * Renders the devices page showing Intune managed devices with
 * compliance status, encryption, and sync information.
 */

const PageDevices = (function() {
    'use strict';

    var colSelector = null;

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        var allDevices = DataLoader.getData('devices');
        var devices = (typeof DepartmentFilter !== 'undefined') ? DepartmentFilter.filterByUPN(allDevices, 'userPrincipalName') : allDevices;

        // Build filter configuration
        var filterConfig = {
            search: Filters.getValue('devices-search'),
            searchFields: ['deviceName', 'userPrincipalName', 'primaryUserDisplayName', 'model', 'manufacturer', 'serialNumber'],
            exact: {}
        };

        // OS filter
        var osFilter = Filters.getValue('devices-os');
        if (osFilter && osFilter !== 'all') {
            filterConfig.exact.os = osFilter;
        }

        // Compliance filter
        var complianceFilter = Filters.getValue('devices-compliance');
        if (complianceFilter && complianceFilter !== 'all') {
            filterConfig.exact.complianceState = complianceFilter;
        }

        // Ownership filter
        var ownershipFilter = Filters.getValue('devices-ownership');
        if (ownershipFilter && ownershipFilter !== 'all') {
            filterConfig.exact.ownership = ownershipFilter;
        }

        // Apply filters
        var filteredData = Filters.apply(devices, filterConfig);

        // Certificate status filter
        var certFilter = Filters.getValue('devices-cert');
        if (certFilter && certFilter !== 'all') {
            filteredData = filteredData.filter(function(d) { return d.certStatus === certFilter; });
        }

        // Windows support filter
        var winSupportFilter = Filters.getValue('devices-winsupport');
        if (winSupportFilter && winSupportFilter !== 'all') {
            if (winSupportFilter === 'supported') {
                filteredData = filteredData.filter(function(d) { return d.windowsSupported === true; });
            } else if (winSupportFilter === 'unsupported') {
                filteredData = filteredData.filter(function(d) { return d.windowsSupported === false; });
            }
        }

        // Stale filter (special handling)
        var staleCheckbox = document.getElementById('devices-stale');
        if (staleCheckbox && staleCheckbox.checked) {
            filteredData = filteredData.filter(function(d) { return d.isStale; });
        }

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the devices table with dynamic columns from Column Selector.
     *
     * @param {Array} data - Filtered device data
     */
    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'userPrincipalName', 'os', 'windowsType', 'complianceState', 'lastSync', 'windowsSupported', 'certStatus', 'ownership', 'isEncrypted'];

        var allDefs = [
            { key: 'deviceName', label: 'Device' },
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            { key: 'os', label: 'OS', formatter: formatOS },
            { key: 'osVersion', label: 'OS Version' },
            { key: 'windowsType', label: 'Win Type', formatter: formatWindowsType },
            { key: 'windowsRelease', label: 'Win Release' },
            { key: 'windowsSupported', label: 'Supported', formatter: formatWindowsSupported },
            { key: 'windowsEOL', label: 'Win EOL' },
            { key: 'complianceState', label: 'Compliance', formatter: Tables.formatters.compliance },
            { key: 'lastSync', label: 'Last Sync', formatter: Tables.formatters.date },
            { key: 'daysSinceSync', label: 'Days', formatter: formatDaysSinceSync },
            { key: 'certStatus', label: 'Cert Status', formatter: formatCertStatus },
            { key: 'daysUntilCertExpiry', label: 'Cert Days', formatter: formatCertDays },
            { key: 'ownership', label: 'Ownership', formatter: formatOwnership },
            { key: 'isEncrypted', label: 'Encrypted', formatter: formatEncrypted },
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'model', label: 'Model' },
            { key: 'serialNumber', label: 'Serial' },
            { key: 'joinType', label: 'Join Type' },
            { key: 'managementAgent', label: 'Mgmt Agent' }
        ];

        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'devices-table',
            data: data,
            columns: columns,
            pageSize: 50,
            onRowClick: showDeviceDetails
        });
    }

    /**
     * Formats OS with icon-like badge.
     */
    function formatOS(value) {
        const colors = {
            'Windows': 'badge-info',
            'macOS': 'badge-neutral',
            'iOS': 'badge-success',
            'Android': 'badge-success'
        };
        return `<span class="badge ${colors[value] || 'badge-neutral'}">${value || 'Unknown'}</span>`;
    }

    /**
     * Formats days since sync with color coding.
     */
    function formatDaysSinceSync(value) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        let colorClass = '';
        if (value >= 90) colorClass = 'text-critical';
        else if (value >= 30) colorClass = 'text-warning';
        return `<span class="${colorClass}">${value}</span>`;
    }

    /**
     * Formats certificate status with color-coded badge.
     */
    function formatCertStatus(value) {
        const map = {
            'expired':  { cls: 'badge-critical', label: 'Expired' },
            'critical': { cls: 'badge-critical', label: 'Critical' },
            'warning':  { cls: 'badge-warning',  label: 'Warning' },
            'healthy':  { cls: 'badge-success',  label: 'Healthy' },
            'unknown':  { cls: 'badge-neutral',  label: 'Unknown' }
        };
        const info = map[value] || map['unknown'];
        return `<span class="badge ${info.cls}">${info.label}</span>`;
    }

    /**
     * Formats days until certificate expiry with color coding.
     */
    function formatCertDays(value) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        let colorClass = '';
        if (value < 0) colorClass = 'text-critical font-bold';
        else if (value <= 30) colorClass = 'text-critical';
        else if (value <= 60) colorClass = 'text-warning';
        return `<span class="${colorClass}">${value}</span>`;
    }

    /**
     * Formats ownership type.
     */
    function formatOwnership(value) {
        return value === 'corporate'
            ? '<span class="badge badge-info">Corporate</span>'
            : '<span class="badge badge-neutral">Personal</span>';
    }

    /**
     * Formats encryption status.
     */
    function formatEncrypted(value) {
        return value
            ? '<span class="text-success">Yes</span>'
            : '<span class="text-critical font-bold">No</span>';
    }

    /**
     * Formats Windows type (Windows 10/11) with badge.
     */
    function formatWindowsType(value) {
        if (!value) {
            return '<span class="text-muted">--</span>';
        }
        if (value === 'Windows 11') {
            return '<span class="badge badge-info">Win 11</span>';
        }
        if (value === 'Windows 10') {
            return '<span class="badge badge-neutral">Win 10</span>';
        }
        return '<span class="badge badge-neutral">' + value + '</span>';
    }

    /**
     * Formats Windows supported status with color coding.
     */
    function formatWindowsSupported(value) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        return value
            ? '<span class="text-success font-bold">Yes</span>'
            : '<span class="text-critical font-bold">No</span>';
    }

    /**
     * Shows detailed modal for a device.
     *
     * @param {object} device - Device data object
     */
    function showDeviceDetails(device) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = device.deviceName;

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">Device Name:</span>
                <span class="detail-value">${device.deviceName}</span>

                <span class="detail-label">User:</span>
                <span class="detail-value">${device.userPrincipalName || '--'}</span>

                <span class="detail-label">OS:</span>
                <span class="detail-value">${device.os}</span>

                <span class="detail-label">OS Version:</span>
                <span class="detail-value">${device.osVersion || '--'}</span>

                <span class="detail-label">Manufacturer:</span>
                <span class="detail-value">${device.manufacturer || '--'}</span>

                <span class="detail-label">Model:</span>
                <span class="detail-value">${device.model || '--'}</span>

                <span class="detail-label">Serial Number:</span>
                <span class="detail-value">${device.serialNumber || '--'}</span>

                <span class="detail-label">Compliance State:</span>
                <span class="detail-value">${device.complianceState}</span>

                <span class="detail-label">Last Sync:</span>
                <span class="detail-value">${DataLoader.formatDate(device.lastSync)}</span>

                <span class="detail-label">Days Since Sync:</span>
                <span class="detail-value">${device.daysSinceSync !== null ? device.daysSinceSync : '--'}</span>

                <span class="detail-label">Is Stale:</span>
                <span class="detail-value">${device.isStale ? 'Yes' : 'No'}</span>

                <span class="detail-label">Enrolled:</span>
                <span class="detail-value">${DataLoader.formatDate(device.enrolledDateTime)}</span>

                <span class="detail-label">Ownership:</span>
                <span class="detail-value">${device.ownership}</span>

                <span class="detail-label">Encrypted:</span>
                <span class="detail-value">${device.isEncrypted ? 'Yes' : 'No'}</span>

                <span class="detail-label">Management Agent:</span>
                <span class="detail-value">${device.managementAgent}</span>

                <span class="detail-label">Cert Expiry Date:</span>
                <span class="detail-value">${device.certExpiryDate ? DataLoader.formatDate(device.certExpiryDate) : '--'}</span>

                <span class="detail-label">Days Until Cert Expiry:</span>
                <span class="detail-value">${device.daysUntilCertExpiry !== null && device.daysUntilCertExpiry !== undefined ? device.daysUntilCertExpiry : '--'}</span>

                <span class="detail-label">Cert Status:</span>
                <span class="detail-value">${device.certStatus || '--'}</span>

                <span class="detail-label">Device ID:</span>
                <span class="detail-value" style="font-size: 0.8em;">${device.id}</span>
            </div>

            <h4 class="mt-lg mb-sm">User & Enrollment</h4>
            <div class="detail-list">
                <span class="detail-label">Primary User:</span>
                <span class="detail-value">${device.primaryUserDisplayName || '--'}</span>

                <span class="detail-label">Autopilot Enrolled:</span>
                <span class="detail-value">${device.autopilotEnrolled ? 'Yes' : 'No'}</span>

                <span class="detail-label">Device Category:</span>
                <span class="detail-value">${device.deviceCategory || '--'}</span>

                <span class="detail-label">Join Type:</span>
                <span class="detail-value">${device.joinType || '--'}</span>

                <span class="detail-label">Wi-Fi MAC:</span>
                <span class="detail-value">${device.wifiMacAddress || '--'}</span>
            </div>

            <h4 class="mt-lg mb-sm">Storage</h4>
            <div class="detail-list">
                <span class="detail-label">Total Storage:</span>
                <span class="detail-value">${device.totalStorageGB !== null && device.totalStorageGB !== undefined ? device.totalStorageGB + ' GB' : '--'}</span>

                <span class="detail-label">Free Storage:</span>
                <span class="detail-value">${device.freeStorageGB !== null && device.freeStorageGB !== undefined ? device.freeStorageGB + ' GB' : '--'}</span>

                <span class="detail-label">Storage Used:</span>
                <span class="detail-value">${device.storageUsedPct !== null && device.storageUsedPct !== undefined ? device.storageUsedPct + '%' : '--'}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    /**
     * Renders the devices page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var devices = DataLoader.getData('devices');

        // Calculate stats
        var compliantCount = devices.filter(function(d) { return d.complianceState === 'compliant'; }).length;
        var nonCompliantCount = devices.filter(function(d) { return d.complianceState === 'noncompliant'; }).length;
        var staleCount = devices.filter(function(d) { return d.isStale; }).length;
        var unencryptedCount = devices.filter(function(d) { return !d.isEncrypted; }).length;

        // Certificate stats
        var certExpiredCount = devices.filter(function(d) { return d.certStatus === 'expired'; }).length;
        var certCriticalCount = devices.filter(function(d) { return d.certStatus === 'critical'; }).length;
        var certWarningCount = devices.filter(function(d) { return d.certStatus === 'warning'; }).length;
        var certHealthyCount = devices.filter(function(d) { return d.certStatus === 'healthy'; }).length;

        // Windows lifecycle stats
        var win10Count = devices.filter(function(d) { return d.windowsType === 'Windows 10'; }).length;
        var win11Count = devices.filter(function(d) { return d.windowsType === 'Windows 11'; }).length;
        var winSupportedCount = devices.filter(function(d) { return d.windowsSupported === true; }).length;
        var winUnsupportedCount = devices.filter(function(d) { return d.windowsSupported === false; }).length;

        // Get unique OS values
        var osList = [];
        devices.forEach(function(d) {
            if (d.os && osList.indexOf(d.os) === -1) osList.push(d.os);
        });
        osList.sort();

        // Build page HTML using safe integer values only (no user input)
        var compliancePct = devices.length > 0 ? Math.round((compliantCount / devices.length) * 100) : 0;

        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">Devices</h2>
                <p class="page-description">Intune managed devices and compliance status</p>
            </div>

            <!-- Compliance Cards -->
            <div class="cards-grid">
                <div class="card">
                    <div class="card-label">Total Devices</div>
                    <div class="card-value">${devices.length}</div>
                </div>
                <div class="card card-success">
                    <div class="card-label">Compliant</div>
                    <div class="card-value success">${compliantCount}</div>
                    <div class="card-change">${compliancePct}% compliance</div>
                </div>
                <div class="card ${nonCompliantCount > 0 ? 'card-critical' : ''}">
                    <div class="card-label">Non-Compliant</div>
                    <div class="card-value ${nonCompliantCount > 0 ? 'critical' : ''}">${nonCompliantCount}</div>
                </div>
                <div class="card ${unencryptedCount > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Not Encrypted</div>
                    <div class="card-value ${unencryptedCount > 0 ? 'warning' : ''}">${unencryptedCount}</div>
                </div>
            </div>

            <!-- Certificate Renewal Cards -->
            <div class="page-header" style="margin-top: 1.5rem;">
                <h3 class="page-title" style="font-size: 1.1rem;">Certificate Renewal</h3>
                <p class="page-description">MDM certificate expiry status across managed devices</p>
            </div>
            <div class="cards-grid">
                <div class="card ${certExpiredCount > 0 ? 'card-critical' : ''}">
                    <div class="card-label">Expired</div>
                    <div class="card-value ${certExpiredCount > 0 ? 'critical' : ''}">${certExpiredCount}</div>
                </div>
                <div class="card ${certCriticalCount > 0 ? 'card-critical' : ''}">
                    <div class="card-label">Expiring in 30d</div>
                    <div class="card-value ${certCriticalCount > 0 ? 'critical' : ''}">${certCriticalCount}</div>
                </div>
                <div class="card ${certWarningCount > 0 ? 'card-warning' : ''}">
                    <div class="card-label">Expiring in 60d</div>
                    <div class="card-value ${certWarningCount > 0 ? 'warning' : ''}">${certWarningCount}</div>
                </div>
                <div class="card card-success">
                    <div class="card-label">Cert Healthy</div>
                    <div class="card-value success">${certHealthyCount}</div>
                </div>
            </div>

            <!-- Windows Lifecycle Cards -->
            <div class="page-header" style="margin-top: 1.5rem;">
                <h3 class="page-title" style="font-size: 1.1rem;">Windows Lifecycle</h3>
                <p class="page-description">Windows version distribution and support status</p>
            </div>
            <div class="cards-grid">
                <div class="card">
                    <div class="card-label">Windows 11</div>
                    <div class="card-value">${win11Count}</div>
                </div>
                <div class="card">
                    <div class="card-label">Windows 10</div>
                    <div class="card-value">${win10Count}</div>
                </div>
                <div class="card card-success">
                    <div class="card-label">Supported</div>
                    <div class="card-value success">${winSupportedCount}</div>
                </div>
                <div class="card ${winUnsupportedCount > 0 ? 'card-critical' : ''}">
                    <div class="card-label">Unsupported</div>
                    <div class="card-value ${winUnsupportedCount > 0 ? 'critical' : ''}">${winUnsupportedCount}</div>
                </div>
            </div>

            <!-- Charts -->
            <div class="charts-row" id="devices-charts"></div>

            <!-- Filters -->
            <div id="devices-filter"></div>

            <!-- Column Selector -->
            <div id="devices-column-selector" style="margin-bottom: 8px; text-align: right;"></div>

            <!-- Data Table -->
            <div id="devices-table"></div>

            <!-- Devices per Person Section -->
            <div class="page-header" style="margin-top: 2rem;">
                <h3 class="page-title" style="font-size: 1.1rem;">Devices per Person</h3>
                <p class="page-description">Distribution of device counts per user</p>
            </div>
            <div id="devices-per-person-focus"></div>

            <!-- Autopilot Section -->
            <div class="page-header" style="margin-top: 2rem;">
                <h3 class="page-title" style="font-size: 1.1rem;">Windows Autopilot</h3>
                <p class="page-description">Autopilot device identities and enrollment status</p>
            </div>
            <div class="cards-grid" id="autopilot-cards"></div>
            <div id="autopilot-table"></div>
        `;

        // Create filter bar
        const osOptions = [{ value: 'all', label: 'All OS' }].concat(
            osList.map(os => ({ value: os, label: os }))
        );

        Filters.createFilterBar({
            containerId: 'devices-filter',
            controls: [
                {
                    type: 'search',
                    id: 'devices-search',
                    label: 'Search',
                    placeholder: 'Search devices...'
                },
                {
                    type: 'select',
                    id: 'devices-os',
                    label: 'OS',
                    options: osOptions
                },
                {
                    type: 'select',
                    id: 'devices-compliance',
                    label: 'Compliance',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'compliant', label: 'Compliant' },
                        { value: 'noncompliant', label: 'Non-Compliant' },
                        { value: 'unknown', label: 'Unknown' }
                    ]
                },
                {
                    type: 'select',
                    id: 'devices-ownership',
                    label: 'Ownership',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'corporate', label: 'Corporate' },
                        { value: 'personal', label: 'Personal' }
                    ]
                },
                {
                    type: 'select',
                    id: 'devices-cert',
                    label: 'Cert Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'expired', label: 'Expired' },
                        { value: 'critical', label: 'Critical (30d)' },
                        { value: 'warning', label: 'Warning (60d)' },
                        { value: 'healthy', label: 'Healthy' },
                        { value: 'unknown', label: 'Unknown' }
                    ]
                },
                {
                    type: 'select',
                    id: 'devices-winsupport',
                    label: 'Win Support',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'supported', label: 'Supported' },
                        { value: 'unsupported', label: 'Unsupported' }
                    ]
                },
                {
                    type: 'checkbox-group',
                    id: 'devices-stale-filter',
                    label: 'Status',
                    options: [
                        { value: 'stale', label: 'Stale only' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Render device charts
        var chartsRow = document.getElementById('devices-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;

            // Compliance donut
            var unknownCount = devices.length - compliantCount - nonCompliantCount;
            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Device Compliance',
                [
                    { value: compliantCount, label: 'Compliant', color: C.green },
                    { value: nonCompliantCount, label: 'Non-Compliant', color: C.red },
                    { value: unknownCount > 0 ? unknownCount : 0, label: 'Unknown', color: C.gray }
                ],
                compliancePct + '%', 'compliant'
            ));

            // Certificate status donut
            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Certificate Status',
                [
                    { value: certHealthyCount, label: 'Healthy', color: C.green },
                    { value: certWarningCount, label: 'Warning', color: C.yellow },
                    { value: certCriticalCount, label: 'Critical', color: C.orange },
                    { value: certExpiredCount, label: 'Expired', color: C.red }
                ],
                String(certHealthyCount), 'healthy'
            ));
        }

        // Fix stale checkbox ID
        var staleCheckbox = document.querySelector('#devices-stale-filter input');
        if (staleCheckbox) {
            staleCheckbox.id = 'devices-stale';
        }

        // Column Selector
        var allCols = [
            { key: 'deviceName', label: 'Device' },
            { key: 'userPrincipalName', label: 'User' },
            { key: 'os', label: 'OS' },
            { key: 'osVersion', label: 'OS Version' },
            { key: 'windowsType', label: 'Win Type' },
            { key: 'windowsRelease', label: 'Win Release' },
            { key: 'windowsSupported', label: 'Supported' },
            { key: 'windowsEOL', label: 'Win EOL' },
            { key: 'complianceState', label: 'Compliance' },
            { key: 'lastSync', label: 'Last Sync' },
            { key: 'daysSinceSync', label: 'Days' },
            { key: 'certStatus', label: 'Cert Status' },
            { key: 'daysUntilCertExpiry', label: 'Cert Days' },
            { key: 'ownership', label: 'Ownership' },
            { key: 'isEncrypted', label: 'Encrypted' },
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'model', label: 'Model' },
            { key: 'serialNumber', label: 'Serial' },
            { key: 'joinType', label: 'Join Type' },
            { key: 'managementAgent', label: 'Mgmt Agent' }
        ];
        var defaultCols = ['deviceName', 'userPrincipalName', 'os', 'windowsType', 'complianceState', 'lastSync', 'windowsSupported', 'certStatus', 'ownership', 'isEncrypted'];

        colSelector = ColumnSelector.create({
            containerId: 'devices-column-selector',
            storageKey: 'tenantscope-devices-columns',
            allColumns: allCols,
            defaultVisible: defaultCols,
            onColumnsChanged: function() { applyFilters(); }
        });

        // Bind export button
        Export.bindExportButton('devices-table', 'devices');

        // Initial render
        applyFilters();

        // Render Devices per Person Focus Table
        renderDevicesPerPerson(devices);

        // Render Autopilot section
        renderAutopilot();
    }

    /**
     * Renders the Devices per Person Focus Table.
     *
     * @param {Array} devices - Array of device objects
     */
    function renderDevicesPerPerson(devices) {
        // Group devices by user
        var userDeviceCounts = {};
        devices.forEach(function(d) {
            var upn = d.userPrincipalName;
            if (!upn) return;
            if (!userDeviceCounts[upn]) {
                userDeviceCounts[upn] = { user: upn, count: 0 };
            }
            userDeviceCounts[upn].count++;
        });

        // Convert to array and group by device count
        var countBuckets = {};
        Object.keys(userDeviceCounts).forEach(function(upn) {
            var c = userDeviceCounts[upn].count;
            var bucket = c >= 4 ? '4+' : String(c);
            if (!countBuckets[bucket]) {
                countBuckets[bucket] = { bucket: bucket, userCount: 0, deviceCount: 0 };
            }
            countBuckets[bucket].userCount++;
            countBuckets[bucket].deviceCount += c;
        });

        // Build Focus Table data
        var focusData = ['1', '2', '3', '4+'].map(function(bucket) {
            var b = countBuckets[bucket] || { bucket: bucket, userCount: 0, deviceCount: 0 };
            return {
                group: bucket + (bucket === '1' ? ' device' : ' devices'),
                count: b.userCount,
                devices: b.deviceCount
            };
        });

        var totalUsers = Object.keys(userDeviceCounts).length;

        // Render Focus Table using FocusTables module if available
        var container = document.getElementById('devices-per-person-focus');
        if (container && typeof FocusTables !== 'undefined') {
            FocusTables.renderFocusTable({
                containerId: 'devices-per-person-focus',
                data: focusData,
                groupByKey: 'group',
                groupByLabel: 'Device Count',
                countKey: 'count',
                countLabel: 'Users',
                totalCount: totalUsers,
                showPercentage: true
            });
        } else if (container) {
            // Fallback: simple table using DOM methods
            var table = document.createElement('table');
            table.className = 'data-table';
            var thead = document.createElement('thead');
            var headRow = document.createElement('tr');
            ['Device Count', 'Users', '%'].forEach(function(h) {
                var th = document.createElement('th');
                th.textContent = h;
                headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            var tbody = document.createElement('tbody');
            focusData.forEach(function(row) {
                var pct = totalUsers > 0 ? Math.round((row.count / totalUsers) * 100) : 0;
                var tr = document.createElement('tr');
                var td1 = document.createElement('td');
                td1.textContent = row.group;
                var td2 = document.createElement('td');
                td2.textContent = String(row.count);
                var td3 = document.createElement('td');
                td3.textContent = pct + '%';
                tr.appendChild(td1);
                tr.appendChild(td2);
                tr.appendChild(td3);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            container.appendChild(table);
        }
    }

    /**
     * Renders the Autopilot summary cards and table.
     */
    function renderAutopilot() {
        const autopilot = DataLoader.getData('autopilot');

        const enrolledCount = autopilot.filter(d => d.enrollmentState === 'enrolled').length;
        const notContactedCount = autopilot.filter(d => d.enrollmentState === 'notContacted').length;
        const failedCount = autopilot.filter(d => d.enrollmentState === 'failed').length;
        const noProfileCount = autopilot.filter(d => !d.profileAssigned).length;

        // Build cards using DOM
        const cardsContainer = document.getElementById('autopilot-cards');
        if (cardsContainer) {
            cardsContainer.appendChild(createCard('Total Autopilot', String(autopilot.length), '', ''));
            cardsContainer.appendChild(createCard('Enrolled', String(enrolledCount), 'card-success', 'success'));
            cardsContainer.appendChild(createCard('Not Contacted', String(notContactedCount),
                notContactedCount > 0 ? 'card-warning' : '', notContactedCount > 0 ? 'warning' : ''));
            cardsContainer.appendChild(createCard('Failed', String(failedCount),
                failedCount > 0 ? 'card-critical' : '', failedCount > 0 ? 'critical' : 'success'));
        }

        // Render autopilot table
        Tables.render({
            containerId: 'autopilot-table',
            data: autopilot,
            columns: [
                { key: 'serialNumber', label: 'Serial Number', filterable: true },
                { key: 'model', label: 'Model', filterable: true },
                { key: 'manufacturer', label: 'Manufacturer', filterable: true },
                { key: 'groupTag', label: 'Group Tag', filterable: true },
                { key: 'enrollmentState', label: 'Enrollment', filterable: true, formatter: formatEnrollmentState },
                { key: 'lastContacted', label: 'Last Contacted', formatter: Tables.formatters.datetime },
                { key: 'profileAssigned', label: 'Profile', formatter: formatProfileAssigned },
                { key: 'purchaseOrder', label: 'PO', filterable: true }
            ],
            pageSize: 25,
            onRowClick: showAutopilotDetails
        });
    }

    /**
     * Creates a summary card DOM element.
     */
    function createCard(label, value, cardClass, valueClass) {
        const card = document.createElement('div');
        card.className = 'card' + (cardClass ? ' ' + cardClass : '');

        const lbl = document.createElement('div');
        lbl.className = 'card-label';
        lbl.textContent = label;
        card.appendChild(lbl);

        const val = document.createElement('div');
        val.className = 'card-value' + (valueClass ? ' ' + valueClass : '');
        val.textContent = value;
        card.appendChild(val);

        return card;
    }

    /**
     * Formats enrollment state with badge.
     */
    function formatEnrollmentState(value) {
        const classes = {
            'enrolled': 'badge-success',
            'notContacted': 'badge-warning',
            'failed': 'badge-critical'
        };
        const labels = {
            'enrolled': 'Enrolled',
            'notContacted': 'Not Contacted',
            'failed': 'Failed'
        };
        return `<span class="badge ${classes[value] || 'badge-neutral'}">${labels[value] || value || 'Unknown'}</span>`;
    }

    /**
     * Formats profile assignment status with badge.
     */
    function formatProfileAssigned(value, row) {
        if (value === true) {
            // Show status detail if available
            var statusLabel = 'Assigned';
            if (row && row.profileAssignmentStatus) {
                var status = row.profileAssignmentStatus;
                if (status === 'assignedInSync') statusLabel = 'Assigned (In Sync)';
                else if (status === 'assignedOutOfSync') statusLabel = 'Assigned (Out of Sync)';
                else if (status === 'pending') statusLabel = 'Pending';
            }
            return '<span class="badge badge-success">' + statusLabel + '</span>';
        }
        // Check for specific not-assigned reasons
        if (row && row.profileAssignmentStatus) {
            var status = row.profileAssignmentStatus;
            if (status === 'notAssigned') return '<span class="badge badge-warning">Not Assigned</span>';
            if (status === 'failed') return '<span class="badge badge-critical">Failed</span>';
        }
        return '<span class="badge badge-warning">No</span>';
    }

    /**
     * Shows Autopilot device details in modal.
     */
    function showAutopilotDetails(device) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = 'Autopilot Device: ' + (device.serialNumber || '--');

        const detailList = document.createElement('div');
        detailList.className = 'detail-list';

        // Build profile assignment display text
        var profileAssignedText = device.profileAssigned ? 'Yes' : 'No';
        if (device.profileAssignmentStatus) {
            var statusMap = {
                'assignedInSync': 'Yes (In Sync)',
                'assignedOutOfSync': 'Yes (Out of Sync)',
                'assignedUnkownSyncState': 'Yes (Sync Unknown)',
                'pending': 'Pending',
                'notAssigned': 'Not Assigned',
                'failed': 'Failed',
                'unknown': 'Unknown'
            };
            profileAssignedText = statusMap[device.profileAssignmentStatus] || device.profileAssignmentStatus;
        }

        const fields = [
            { label: 'Serial Number', value: device.serialNumber || '--' },
            { label: 'Model', value: device.model || '--' },
            { label: 'Manufacturer', value: device.manufacturer || '--' },
            { label: 'Group Tag', value: device.groupTag || '--' },
            { label: 'Enrollment State', value: device.enrollmentState || '--' },
            { label: 'Last Contacted', value: device.lastContacted ? DataLoader.formatDate(device.lastContacted) : '--' },
            { label: 'Profile Assigned', value: profileAssignedText },
            { label: 'Profile Status', value: device.profileAssignmentStatus || '--' },
            { label: 'Purchase Order', value: device.purchaseOrder || '--' },
            { label: 'Device ID', value: device.id || '--' }
        ];

        fields.forEach(function(f) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'detail-label';
            labelSpan.textContent = f.label + ':';
            detailList.appendChild(labelSpan);

            const valueSpan = document.createElement('span');
            valueSpan.className = 'detail-value';
            valueSpan.textContent = f.value;
            detailList.appendChild(valueSpan);
        });

        body.textContent = '';
        body.appendChild(detailList);
        modal.classList.add('visible');
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageDevices = PageDevices;
