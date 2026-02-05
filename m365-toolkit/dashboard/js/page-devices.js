/**
 * ============================================================================
 * TenantScope
 * Author: Robe (https://github.com/Thugney)
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

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const devices = DataLoader.getData('devices');

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('devices-search'),
            searchFields: ['deviceName', 'userPrincipalName', 'model', 'manufacturer', 'serialNumber'],
            exact: {}
        };

        // OS filter
        const osFilter = Filters.getValue('devices-os');
        if (osFilter && osFilter !== 'all') {
            filterConfig.exact.os = osFilter;
        }

        // Compliance filter
        const complianceFilter = Filters.getValue('devices-compliance');
        if (complianceFilter && complianceFilter !== 'all') {
            filterConfig.exact.complianceState = complianceFilter;
        }

        // Ownership filter
        const ownershipFilter = Filters.getValue('devices-ownership');
        if (ownershipFilter && ownershipFilter !== 'all') {
            filterConfig.exact.ownership = ownershipFilter;
        }

        // Apply filters
        let filteredData = Filters.apply(devices, filterConfig);

        // Certificate status filter
        const certFilter = Filters.getValue('devices-cert');
        if (certFilter && certFilter !== 'all') {
            filteredData = filteredData.filter(d => d.certStatus === certFilter);
        }

        // Stale filter (special handling)
        const staleOnly = Filters.getValue('devices-stale');
        if (staleOnly) {
            filteredData = filteredData.filter(d => d.isStale);
        }

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the devices table.
     *
     * @param {Array} data - Filtered device data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'devices-table',
            data: data,
            columns: [
                { key: 'deviceName', label: 'Device' },
                { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
                { key: 'os', label: 'OS', formatter: formatOS },
                { key: 'osVersion', label: 'Version' },
                { key: 'complianceState', label: 'Compliance', formatter: Tables.formatters.compliance },
                { key: 'lastSync', label: 'Last Sync', formatter: Tables.formatters.date },
                { key: 'daysSinceSync', label: 'Days', formatter: formatDaysSinceSync },
                { key: 'certStatus', label: 'Cert Status', formatter: formatCertStatus },
                { key: 'daysUntilCertExpiry', label: 'Cert Days', formatter: formatCertDays },
                { key: 'ownership', label: 'Ownership', formatter: formatOwnership },
                { key: 'isEncrypted', label: 'Encrypted', formatter: formatEncrypted }
            ],
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
        `;

        modal.classList.add('visible');
    }

    /**
     * Renders the devices page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        const devices = DataLoader.getData('devices');

        // Calculate stats
        const compliantCount = devices.filter(d => d.complianceState === 'compliant').length;
        const nonCompliantCount = devices.filter(d => d.complianceState === 'noncompliant').length;
        const staleCount = devices.filter(d => d.isStale).length;
        const unencryptedCount = devices.filter(d => !d.isEncrypted).length;

        // Certificate stats
        const certExpiredCount = devices.filter(d => d.certStatus === 'expired').length;
        const certCriticalCount = devices.filter(d => d.certStatus === 'critical').length;
        const certWarningCount = devices.filter(d => d.certStatus === 'warning').length;
        const certHealthyCount = devices.filter(d => d.certStatus === 'healthy').length;

        // Get unique OS values
        const osList = [...new Set(devices.map(d => d.os).filter(Boolean))].sort();

        // Build page HTML using safe integer values only (no user input)
        const compliancePct = devices.length > 0 ? Math.round((compliantCount / devices.length) * 100) : 0;

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

            <!-- Filters -->
            <div id="devices-filter"></div>

            <!-- Data Table -->
            <div id="devices-table"></div>

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

        // Fix stale checkbox ID
        const staleCheckbox = document.querySelector('#devices-stale-filter input');
        if (staleCheckbox) {
            staleCheckbox.id = 'devices-stale';
        }

        // Bind export button
        Export.bindExportButton('devices-table', 'devices');

        // Initial render
        applyFilters();

        // Render Autopilot section
        renderAutopilot();
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
                { key: 'profileAssigned', label: 'Profile' },
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
     * Shows Autopilot device details in modal.
     */
    function showAutopilotDetails(device) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = 'Autopilot Device: ' + (device.serialNumber || '--');

        const detailList = document.createElement('div');
        detailList.className = 'detail-list';

        const fields = [
            { label: 'Serial Number', value: device.serialNumber || '--' },
            { label: 'Model', value: device.model || '--' },
            { label: 'Manufacturer', value: device.manufacturer || '--' },
            { label: 'Group Tag', value: device.groupTag || '--' },
            { label: 'Enrollment State', value: device.enrollmentState || '--' },
            { label: 'Last Contacted', value: device.lastContacted ? DataLoader.formatDate(device.lastContacted) : '--' },
            { label: 'Profile Assigned', value: device.profileAssigned ? 'Yes' : 'No' },
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
