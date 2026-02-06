/**
 * TenantScope - ASR Rules Page
 */

const PageASRRules = (function() {
    'use strict';

    var colSelector = null;

    // Extract rules from nested structure
    function extractRules(rawData) {
        if (Array.isArray(rawData)) return rawData;
        if (!rawData) return [];
        return rawData.rulesArray || [];
    }

    function applyFilters() {
        var rules = extractRules(DataLoader.getData('asrRules'));
        var filterConfig = { search: Filters.getValue('asr-search'), searchFields: ['ruleName', 'ruleId', 'description'], exact: {} };
        var modeFilter = Filters.getValue('asr-mode');
        if (modeFilter && modeFilter !== 'all') filterConfig.exact.mode = modeFilter;
        renderTable(Filters.apply(rules, filterConfig));
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['ruleName', 'mode', 'assignedDevices', 'enabledDevices', 'auditDevices', 'coverage'];
        var allDefs = [
            { key: 'ruleName', label: 'Rule Name' },
            { key: 'ruleId', label: 'Rule ID', className: 'cell-truncate' },
            { key: 'mode', label: 'Mode', formatter: function(v) {
                var modes = { 'block': 'badge-success', 'audit': 'badge-warning', 'warn': 'badge-warning', 'disabled': 'badge-neutral' };
                return '<span class="badge ' + (modes[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'assignedDevices', label: 'Assigned' },
            { key: 'enabledDevices', label: 'Block Mode', formatter: function(v) { return '<span class="text-success">' + (v || 0) + '</span>'; }},
            { key: 'auditDevices', label: 'Audit Mode', formatter: function(v) { return '<span class="text-warning">' + (v || 0) + '</span>'; }},
            { key: 'coverage', label: 'Coverage', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var pct = Math.round(v);
                var cls = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-critical';
                return '<span class="' + cls + '">' + pct + '%</span>';
            }}
        ];
        Tables.render({ containerId: 'asr-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 50 });
    }

    function render(container) {
        var rules = extractRules(DataLoader.getData('asrRules'));
        var total = rules.length;
        var blockMode = rules.filter(function(r) { return r.mode === 'block'; }).length;
        var auditMode = rules.filter(function(r) { return r.mode === 'audit'; }).length;
        var disabled = rules.filter(function(r) { return r.mode === 'disabled' || r.mode === 'notConfigured'; }).length;
        var avgCoverage = total > 0 ? Math.round(rules.reduce(function(s, r) { return s + (r.coverage || 0); }, 0) / total) : 0;

        var html = '<div class="page-header"><h2>Attack Surface Reduction Rules</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Rules</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + blockMode + '</div><div class="summary-label">Block Mode</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + auditMode + '</div><div class="summary-label">Audit Mode</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + disabled + '</div><div class="summary-label">Disabled</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + avgCoverage + '%</div><div class="summary-label">Avg Coverage</div></div>';
        html += '</div>';
        html += '<div class="filter-bar"><input type="text" class="filter-input" id="asr-search" placeholder="Search rules...">';
        html += '<select class="filter-select" id="asr-mode"><option value="all">All Modes</option><option value="block">Block</option><option value="audit">Audit</option><option value="disabled">Disabled</option></select>';
        html += '<div id="asr-colselector"></div></div>';
        html += '<div class="table-container" id="asr-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'asr-colselector',
            storageKey: 'tenantscope-asr-cols',
            allColumns: [
                { key: 'ruleName', label: 'Rule Name' },
                { key: 'mode', label: 'Mode' },
                { key: 'assignedDevices', label: 'Assigned' },
                { key: 'enabledDevices', label: 'Block Mode' },
                { key: 'auditDevices', label: 'Audit Mode' },
                { key: 'coverage', label: 'Coverage' }
            ],
            defaultVisible: ['ruleName', 'mode', 'assignedDevices', 'enabledDevices', 'auditDevices', 'coverage'],
            onColumnsChanged: function() { applyFilters(); }
        });

        Filters.setup('asr-search', applyFilters);
        Filters.setup('asr-mode', applyFilters);
        applyFilters();
    }

    return { render: render };
})();
