/**
 * ============================================================================
 * TenantScope
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: ENTERPRISE APPS
 *
 * Renders the enterprise applications page showing service principals
 * with credential expiry tracking, status, and publisher information.
 *
 * Note: innerHTML usage follows existing dashboard patterns. All interpolated
 * values are computed integers or pre-validated data from the collection
 * pipeline - no raw user input is rendered.
 */

const PageEnterpriseApps = (function() {
    'use strict';

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const apps = DataLoader.getData('enterpriseApps');

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('apps-search'),
            searchFields: ['displayName', 'publisher', 'appId'],
            exact: {}
        };

        // Publisher filter
        const publisherFilter = Filters.getValue('apps-publisher');
        if (publisherFilter === 'microsoft') {
            filterConfig.exact.isMicrosoft = true;
        } else if (publisherFilter === 'third-party') {
            filterConfig.exact.isMicrosoft = false;
        }

        // Apply filters
        let filteredData = Filters.apply(apps, filterConfig);

        // Status filter (enabled/disabled)
        const statusFilter = Filters.getValue('apps-status');
        if (statusFilter === 'enabled') {
            filteredData = filteredData.filter(a => a.accountEnabled);
        } else if (statusFilter === 'disabled') {
            filteredData = filteredData.filter(a => !a.accountEnabled);
        }

        // Credential status filter
        const credFilter = Filters.getValue('apps-cred');
        if (credFilter && credFilter !== 'all') {
            filteredData = filteredData.filter(a => a.credentialStatus === credFilter);
        }

        // Has credentials filter
        const credsOnly = Filters.getValue('apps-has-creds');
        if (credsOnly) {
            filteredData = filteredData.filter(a => a.hasCredentials);
        }

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the enterprise apps table.
     *
     * @param {Array} data - Filtered app data
     */
    function renderTable(data) {
        Tables.render({
            containerId: 'apps-table',
            data: data,
            columns: [
                { key: 'displayName', label: 'Application', className: 'cell-truncate' },
                { key: 'publisher', label: 'Publisher' },
                { key: 'accountEnabled', label: 'Status', formatter: formatStatus },
                { key: 'credentialStatus', label: 'Credential Status', formatter: formatCredStatus },
                { key: 'nearestExpiryDays', label: 'Expiry Days', formatter: formatExpiryDays },
                { key: 'secretCount', label: 'Secrets' },
                { key: 'certificateCount', label: 'Certs' },
                { key: 'appType', label: 'Type', formatter: formatAppType }
            ],
            pageSize: 50,
            onRowClick: showAppDetails
        });
    }

    /**
     * Formats enabled/disabled status.
     */
    function formatStatus(value) {
        return value
            ? '<span class="badge badge-success">Active</span>'
            : '<span class="badge badge-critical">Disabled</span>';
    }

    /**
     * Formats credential status with color-coded badge.
     */
    function formatCredStatus(value) {
        const map = {
            'expired':        { cls: 'badge-critical', label: 'Expired' },
            'critical':       { cls: 'badge-critical', label: 'Critical' },
            'warning':        { cls: 'badge-warning',  label: 'Warning' },
            'healthy':        { cls: 'badge-success',  label: 'Healthy' },
            'no-credentials': { cls: 'badge-neutral',  label: 'No Creds' }
        };
        const info = map[value] || { cls: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + info.cls + '">' + info.label + '</span>';
    }

    /**
     * Formats days until expiry with color coding.
     */
    function formatExpiryDays(value) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        var colorClass = '';
        if (value < 0) colorClass = 'text-critical font-bold';
        else if (value <= 30) colorClass = 'text-critical';
        else if (value <= 90) colorClass = 'text-warning';
        return '<span class="' + colorClass + '">' + value + '</span>';
    }

    /**
     * Formats app type.
     */
    function formatAppType(value) {
        const labels = {
            'application':      'App',
            'managed-identity': 'Managed ID',
            'legacy':           'Legacy',
            'social-idp':       'Social IdP',
            'other':            'Other'
        };
        return '<span class="badge badge-neutral">' + (labels[value] || value) + '</span>';
    }

    /**
     * Builds credential detail rows for the modal.
     */
    function buildCredentialRows(credentials, type) {
        if (!credentials || credentials.length === 0) {
            return '<span class="text-muted">None</span>';
        }

        return credentials.map(function(cred) {
            var statusClass = '';
            if (cred.daysUntilExpiry !== null) {
                if (cred.daysUntilExpiry < 0) statusClass = 'text-critical';
                else if (cred.daysUntilExpiry <= 30) statusClass = 'text-critical';
                else if (cred.daysUntilExpiry <= 90) statusClass = 'text-warning';
            }
            var name = cred.displayName || type;
            var expiry = cred.endDateTime ? DataLoader.formatDate(cred.endDateTime) : '--';
            var days = cred.daysUntilExpiry !== null ? cred.daysUntilExpiry + 'd' : '--';
            return '<div style="margin-bottom: 0.3rem;">' +
                name + ' - ' + expiry +
                ' (<span class="' + statusClass + '">' + days + '</span>)' +
                '</div>';
        }).join('');
    }

    /**
     * Shows detailed modal for an app.
     *
     * @param {object} app - Enterprise app data object
     */
    function showAppDetails(app) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');

        title.textContent = app.displayName;

        body.innerHTML = [
            '<div class="detail-list">',
            '    <span class="detail-label">Application Name:</span>',
            '    <span class="detail-value">' + app.displayName + '</span>',
            '',
            '    <span class="detail-label">App ID:</span>',
            '    <span class="detail-value" style="font-size: 0.8em;">' + app.appId + '</span>',
            '',
            '    <span class="detail-label">Status:</span>',
            '    <span class="detail-value">' + (app.accountEnabled ? 'Active' : 'Disabled') + '</span>',
            '',
            '    <span class="detail-label">Publisher:</span>',
            '    <span class="detail-value">' + app.publisher + '</span>',
            '',
            '    <span class="detail-label">Type:</span>',
            '    <span class="detail-value">' + app.appType + '</span>',
            '',
            '    <span class="detail-label">Created:</span>',
            '    <span class="detail-value">' + DataLoader.formatDate(app.createdDateTime) + '</span>',
            '',
            '    <span class="detail-label">Credential Status:</span>',
            '    <span class="detail-value">' + formatCredStatus(app.credentialStatus) + '</span>',
            '',
            '    <span class="detail-label">Nearest Expiry:</span>',
            '    <span class="detail-value">' + (app.nearestExpiryDays !== null ? app.nearestExpiryDays + ' days' : '--') + '</span>',
            '',
            '    <span class="detail-label">Client Secrets (' + app.secretCount + '):</span>',
            '    <span class="detail-value">' + buildCredentialRows(app.secrets, 'Secret') + '</span>',
            '',
            '    <span class="detail-label">Certificates (' + app.certificateCount + '):</span>',
            '    <span class="detail-value">' + buildCredentialRows(app.certificates, 'Certificate') + '</span>',
            '',
            '    <span class="detail-label">Service Principal ID:</span>',
            '    <span class="detail-value" style="font-size: 0.8em;">' + app.id + '</span>',
            '</div>'
        ].join('\n');

        modal.classList.add('visible');
    }

    /**
     * Renders the enterprise apps page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var apps = DataLoader.getData('enterpriseApps');

        // Calculate stats
        var totalApps = apps.length;
        var thirdPartyApps = apps.filter(function(a) { return !a.isMicrosoft; });
        var enabledCount = apps.filter(function(a) { return a.accountEnabled; }).length;
        var disabledCount = apps.filter(function(a) { return !a.accountEnabled; }).length;

        // Credential stats (third-party only, Microsoft apps rarely have custom creds)
        var expiredCount = thirdPartyApps.filter(function(a) { return a.credentialStatus === 'expired'; }).length;
        var criticalCount = thirdPartyApps.filter(function(a) { return a.credentialStatus === 'critical'; }).length;
        var warningCount = thirdPartyApps.filter(function(a) { return a.credentialStatus === 'warning'; }).length;
        var healthyCount = thirdPartyApps.filter(function(a) { return a.credentialStatus === 'healthy'; }).length;

        // All values below are computed integers from trusted collection data
        container.innerHTML = [
            '<div class="page-header">',
            '    <h2 class="page-title">Enterprise Applications</h2>',
            '    <p class="page-description">Service principals, credential expiry, and application status</p>',
            '</div>',
            '',
            '<div class="cards-grid">',
            '    <div class="card">',
            '        <div class="card-label">Total Apps</div>',
            '        <div class="card-value">' + totalApps + '</div>',
            '        <div class="card-change">' + thirdPartyApps.length + ' third-party</div>',
            '    </div>',
            '    <div class="card ' + (expiredCount > 0 ? 'card-critical' : '') + '">',
            '        <div class="card-label">Expired Creds</div>',
            '        <div class="card-value ' + (expiredCount > 0 ? 'critical' : '') + '">' + expiredCount + '</div>',
            '    </div>',
            '    <div class="card ' + (criticalCount > 0 ? 'card-critical' : '') + '">',
            '        <div class="card-label">Expiring 30d</div>',
            '        <div class="card-value ' + (criticalCount > 0 ? 'critical' : '') + '">' + criticalCount + '</div>',
            '    </div>',
            '    <div class="card ' + (warningCount > 0 ? 'card-warning' : '') + '">',
            '        <div class="card-label">Expiring 90d</div>',
            '        <div class="card-value ' + (warningCount > 0 ? 'warning' : '') + '">' + warningCount + '</div>',
            '    </div>',
            '</div>',
            '',
            '<div class="cards-grid" style="margin-top: 0.75rem;">',
            '    <div class="card card-success">',
            '        <div class="card-label">Healthy Creds</div>',
            '        <div class="card-value success">' + healthyCount + '</div>',
            '    </div>',
            '    <div class="card">',
            '        <div class="card-label">Active</div>',
            '        <div class="card-value">' + enabledCount + '</div>',
            '    </div>',
            '    <div class="card ' + (disabledCount > 0 ? 'card-warning' : '') + '">',
            '        <div class="card-label">Disabled</div>',
            '        <div class="card-value ' + (disabledCount > 0 ? 'warning' : '') + '">' + disabledCount + '</div>',
            '    </div>',
            '    <div class="card">',
            '        <div class="card-label">Microsoft</div>',
            '        <div class="card-value">' + (totalApps - thirdPartyApps.length) + '</div>',
            '    </div>',
            '</div>',
            '',
            '<div class="charts-row" id="apps-charts"></div>',
            '<div id="apps-filter"></div>',
            '<div id="apps-table"></div>'
        ].join('\n');

        // Render charts
        var chartsRow = document.getElementById('apps-charts');
        if (chartsRow) {
            var C = DashboardCharts.colors;

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'Credential Status',
                [
                    { value: expiredCount, label: 'Expired', color: C.red },
                    { value: criticalCount, label: 'Critical (30d)', color: C.orange },
                    { value: warningCount, label: 'Warning (90d)', color: C.yellow },
                    { value: healthyCount, label: 'Healthy', color: C.green }
                ],
                thirdPartyApps.length > 0
                    ? Math.round((healthyCount / thirdPartyApps.length) * 100) + '%'
                    : '0%',
                'healthy'
            ));

            chartsRow.appendChild(DashboardCharts.createChartCard(
                'App Distribution',
                [
                    { value: totalApps - thirdPartyApps.length, label: 'Microsoft', color: C.blue },
                    { value: thirdPartyApps.length, label: 'Third-party', color: C.purple }
                ],
                String(totalApps), 'total apps'
            ));
        }

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'apps-filter',
            controls: [
                {
                    type: 'search',
                    id: 'apps-search',
                    label: 'Search',
                    placeholder: 'Search apps...'
                },
                {
                    type: 'select',
                    id: 'apps-publisher',
                    label: 'Publisher',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'microsoft', label: 'Microsoft' },
                        { value: 'third-party', label: 'Third-party' }
                    ]
                },
                {
                    type: 'select',
                    id: 'apps-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'enabled', label: 'Active' },
                        { value: 'disabled', label: 'Disabled' }
                    ]
                },
                {
                    type: 'select',
                    id: 'apps-cred',
                    label: 'Credential Status',
                    options: [
                        { value: 'all', label: 'All' },
                        { value: 'expired', label: 'Expired' },
                        { value: 'critical', label: 'Critical (30d)' },
                        { value: 'warning', label: 'Warning (90d)' },
                        { value: 'healthy', label: 'Healthy' },
                        { value: 'no-credentials', label: 'No Credentials' }
                    ]
                },
                {
                    type: 'checkbox-group',
                    id: 'apps-creds-filter',
                    label: 'Credentials',
                    options: [
                        { value: 'has-creds', label: 'With credentials only' }
                    ]
                }
            ],
            onFilter: applyFilters
        });

        // Fix checkbox ID
        var credsCheckbox = document.querySelector('#apps-creds-filter input');
        if (credsCheckbox) {
            credsCheckbox.id = 'apps-has-creds';
        }

        // Bind export button
        Export.bindExportButton('apps-table', 'enterprise-apps');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageEnterpriseApps = PageEnterpriseApps;
