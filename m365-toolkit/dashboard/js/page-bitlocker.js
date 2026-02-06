/**
 * TenantScope - BitLocker Status Page
 */

const PageBitLocker = (function() {
    'use strict';

    var colSelector = null;

    function applyFilters() {
        var rawData = DataLoader.getData('bitlockerStatus') || [];
        // Handle both array format (sample data) and object format (real collector output)
        var devices = Array.isArray(rawData) ? rawData : (rawData.devices || []);
        var filterConfig = { search: Filters.getValue('bitlocker-search'), searchFields: ['deviceName', 'userPrincipalName'], exact: {} };
        var encFilter = Filters.getValue('bitlocker-encryption');
        if (encFilter && encFilter !== 'all') filterConfig.exact.encryptionState = encFilter;
        var filteredData = Filters.apply(devices, filterConfig);
        var keyFilter = Filters.getValue('bitlocker-key');
        if (keyFilter === 'escrowed') filteredData = filteredData.filter(function(d) { return d.recoveryKeyEscrowed === true; });
        else if (keyFilter === 'missing') filteredData = filteredData.filter(function(d) { return d.recoveryKeyEscrowed === false; });
        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'userPrincipalName', 'encryptionState', 'recoveryKeyEscrowed', 'tpmVersion'];
        var allDefs = [
            { key: 'deviceName', label: 'Device' },
            { key: 'userPrincipalName', label: 'User', className: 'cell-truncate' },
            { key: 'encryptionState', label: 'Encryption', formatter: function(v) {
                var states = { 'encrypted': 'badge-success', 'notEncrypted': 'badge-critical', 'encryptionInProgress': 'badge-warning' };
                return '<span class="badge ' + (states[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'recoveryKeyEscrowed', label: 'Key Escrowed', formatter: function(v) { return v === true ? '<span class="text-success">Yes</span>' : '<span class="text-critical">No</span>'; }},
            { key: 'tpmVersion', label: 'TPM Version' }
        ];
        Tables.render({ containerId: 'bitlocker-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 50 });
    }

    function render(container) {
        var rawData = DataLoader.getData('bitlockerStatus') || [];
        // Handle both array format (sample data) and object format (real collector output)
        var devices = Array.isArray(rawData) ? rawData : (rawData.devices || []);
        var total = devices.length;
        var encrypted = devices.filter(function(d) { return d.encryptionState === 'encrypted'; }).length;
        var notEnc = devices.filter(function(d) { return d.encryptionState === 'notEncrypted'; }).length;
        var keysMissing = devices.filter(function(d) { return d.recoveryKeyEscrowed === false; }).length;
        var rate = total > 0 ? Math.round((encrypted / total) * 100) : 0;

        var html = '<div class="page-header"><h2>BitLocker Status</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + encrypted + '</div><div class="summary-label">Encrypted</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + notEnc + '</div><div class="summary-label">Not Encrypted</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + keysMissing + '</div><div class="summary-label">Keys Missing</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + rate + '%</div><div class="summary-label">Encryption Rate</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="bitlocker-search" placeholder="Search devices...">';
        html += '<select class="filter-select" id="bitlocker-encryption"><option value="all">All States</option><option value="encrypted">Encrypted</option><option value="notEncrypted">Not Encrypted</option></select>';
        html += '<select class="filter-select" id="bitlocker-key"><option value="all">All Keys</option><option value="escrowed">Escrowed</option><option value="missing">Missing</option></select>';
        html += '<div id="bitlocker-colselector"></div></div>';
        html += '<div class="table-container" id="bitlocker-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'bitlocker-colselector',
            storageKey: 'tenantscope-bitlocker-cols',
            allColumns: [
                { key: 'deviceName', label: 'Device' },
                { key: 'userPrincipalName', label: 'User' },
                { key: 'encryptionState', label: 'Encryption' },
                { key: 'recoveryKeyEscrowed', label: 'Key Escrowed' },
                { key: 'tpmVersion', label: 'TPM Version' }
            ],
            defaultVisible: ['deviceName', 'userPrincipalName', 'encryptionState', 'recoveryKeyEscrowed', 'tpmVersion'],
            onColumnsChanged: function() { applyFilters(); }
        });

        Filters.setup('bitlocker-search', applyFilters);
        Filters.setup('bitlocker-encryption', applyFilters);
        Filters.setup('bitlocker-key', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
