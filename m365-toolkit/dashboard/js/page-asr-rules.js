/**
 * TenantScope - ASR Rules Page
 * Shows Attack Surface Reduction rule configurations with mode distribution and coverage analytics
 * Author: Robel (https://github.com/Thugney)
 */

const PageASRRules = (function() {
    'use strict';

    // SharedFormatters reference
    var Fmt = window.SharedFormatters || {};

    var currentTab = 'overview';
    var colSelector = null;

    // Extract and map rules from nested structure
    function extractData(rawData) {
        var rules = [];
        var policies = [];
        var summary = {};

        if (Array.isArray(rawData)) {
            rules = rawData;
        } else if (rawData) {
            if (rawData.rulesArray) {
                rules = rawData.rulesArray;
            }
            if (rawData.policies) {
                policies = rawData.policies;
            }
            if (rawData.summary) {
                summary = rawData.summary;
            }
        }

        // Map collector field names to display field names
        var mappedRules = rules.map(function(r) {
            // Determine mode based on counts
            var mode = 'notConfigured';
            if (r.blockCount > 0) mode = 'block';
            else if (r.auditCount > 0) mode = 'audit';
            else if (r.warnCount > 0) mode = 'warn';
            else if (r.disabledCount > 0) mode = 'off';
            else if (r.mode) mode = r.mode.toLowerCase();

            // Map or compute policy counts (not device counts)
            var blockDevices = r.enabledDevices || r.blockCount || 0;
            var auditDevices = r.auditDevices || r.auditCount || 0;
            var warnDevices = r.warnCount || 0;
            var assignedDevices = r.assignedDevices || (blockDevices + auditDevices + warnDevices) || 0;
            var coverage = r.coverage;
            if (coverage === undefined && assignedDevices > 0) {
                coverage = 100; // If deployed, assume 100% coverage within that scope
            }

            return {
                ruleId: r.ruleId,
                ruleName: r.ruleName,
                description: r.description || getDefaultDescription(r.ruleName),
                mode: mode,
                assignedDevices: assignedDevices,
                blockCount: blockDevices,
                auditCount: auditDevices,
                warnCount: warnDevices,
                coverage: coverage || 0,
                isDeployed: r.isDeployed || (r.blockCount > 0 || r.auditCount > 0 || r.warnCount > 0)
            };
        });

        // Compute summary if not provided
        var computedSummary = {
            totalRules: mappedRules.length,
            rulesInBlock: mappedRules.filter(function(r) { return r.mode === 'block'; }).length,
            rulesInAudit: mappedRules.filter(function(r) { return r.mode === 'audit'; }).length,
            rulesInWarn: mappedRules.filter(function(r) { return r.mode === 'warn'; }).length,
            rulesNotConfigured: mappedRules.filter(function(r) { return r.mode === 'notConfigured' || r.mode === 'off'; }).length,
            deployedRules: mappedRules.filter(function(r) { return r.isDeployed; }).length,
            avgCoverage: mappedRules.length > 0 ? Math.round(mappedRules.reduce(function(s, r) { return s + (r.coverage || 0); }, 0) / mappedRules.length) : 0
        };

        return {
            rules: mappedRules,
            policies: policies,
            summary: summary.totalPolicies !== undefined ? summary : computedSummary
        };
    }

    // Get default description for known ASR rules
    function getDefaultDescription(ruleName) {
        var descriptions = {
            'Block executable content from email and webmail': 'Prevents executable files from running when opened from email clients',
            'Block all Office applications from creating child processes': 'Prevents Office apps from spawning child processes used in attacks',
            'Block credential stealing from Windows LSASS': 'Protects credentials stored in the LSASS process from being extracted',
            'Use advanced protection against ransomware': 'Provides additional ransomware protection through heuristics',
            'Block JavaScript or VBScript from launching downloaded content': 'Prevents scripts from executing downloaded payloads',
            'Block untrusted and unsigned processes from USB': 'Blocks execution of untrusted files from removable drives'
        };
        return descriptions[ruleName] || 'Attack surface reduction rule to enhance endpoint security';
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var data = extractData(DataLoader.getData('asrRules'));
        var container = document.getElementById('asr-content');
        if (!container) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, data);
                break;
            case 'rules':
                renderRulesTab(container, data.rules);
                break;
            case 'policies':
                renderPoliciesTab(container, data.policies);
                break;
        }
    }

    function renderOverview(container, data) {
        var rules = data.rules;
        var html = '';

        // Rules summary table
        html += '<div class="analytics-section">';
        html += '<h3>All Rules Summary</h3>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Rule Name</th><th>Mode</th><th>Status</th><th>Block</th><th>Audit</th>';
        html += '</tr></thead><tbody>';

        rules.slice(0, 10).forEach(function(r) {
            html += '<tr class="clickable-row" data-rule-id="' + r.ruleId + '">';
            html += '<td><strong>' + (r.ruleName || '--') + '</strong></td>';
            html += '<td>' + (Fmt.formatActionMode ? Fmt.formatActionMode(r.mode) : formatMode(r.mode)) + '</td>';
            html += '<td>' + (r.isDeployed ? '<span class="badge badge-success">Deployed</span>' : '<span class="badge badge-neutral">Not Deployed</span>') + '</td>';
            html += '<td>' + (Fmt.formatCount ? Fmt.formatCount(r.blockCount) : r.blockCount) + '</td>';
            html += '<td>' + (Fmt.formatCount ? Fmt.formatCount(r.auditCount) : r.auditCount) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        if (rules.length > 10) {
            html += '<p class="text-muted">Showing 10 of ' + rules.length + ' rules. View the All Rules tab for complete list.</p>';
        }
        html += '</div>';

        container.innerHTML = html;

        // Add click handlers for rows
        container.querySelectorAll('.clickable-row').forEach(function(row) {
            row.addEventListener('click', function() {
                var ruleId = this.dataset.ruleId;
                var rule = rules.find(function(r) { return r.ruleId === ruleId; });
                if (rule) showRuleDetails(rule);
            });
        });
    }

    function renderRulesTab(container, rules) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="asr-search" placeholder="Search rules...">';
        html += '<select class="filter-select" id="asr-mode">';
        html += '<option value="all">All Modes</option>';
        html += '<option value="block">Block</option>';
        html += '<option value="audit">Audit</option>';
        html += '<option value="warn">Warn</option>';
        html += '<option value="notConfigured">Not Configured</option>';
        html += '</select>';
        html += '<select class="filter-select" id="asr-deployed">';
        html += '<option value="all">All Status</option>';
        html += '<option value="true">Deployed</option>';
        html += '<option value="false">Not Deployed</option>';
        html += '</select>';
        html += '<div id="asr-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="asr-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'asr-colselector',
            storageKey: 'tenantscope-asr-cols-v1',
            allColumns: [
                { key: 'ruleName', label: 'Rule Name' },
                { key: 'ruleId', label: 'Rule ID' },
                { key: 'mode', label: 'Mode' },
                { key: 'isDeployed', label: 'Deployed' },
                { key: 'blockCount', label: 'Block Count' },
                { key: 'auditCount', label: 'Audit Count' },
                { key: 'warnCount', label: 'Warn Count' },
                { key: 'coverage', label: 'Coverage' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['ruleName', 'mode', 'isDeployed', 'blockCount', 'auditCount', 'coverage', '_adminLinks'],
            onColumnsChanged: function() { applyFilters(); }
        });

        Filters.setup('asr-search', applyFilters);
        Filters.setup('asr-mode', applyFilters);
        Filters.setup('asr-deployed', applyFilters);
        applyFilters();
    }

    function renderPoliciesTab(container, policies) {
        if (!policies || policies.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No ASR Policies</div><p>No Attack Surface Reduction policies found.</p></div>';
            return;
        }

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="policy-search" placeholder="Search policies...">';
        html += '</div>';
        html += '<div class="table-container" id="policy-table"></div>';
        container.innerHTML = html;

        renderPolicyTable(policies);
        Filters.setup('policy-search', function() {
            var search = (Filters.getValue('policy-search') || '').toLowerCase();
            var filtered = policies.filter(function(p) {
                return (p.displayName || '').toLowerCase().indexOf(search) !== -1 ||
                       (p.description || '').toLowerCase().indexOf(search) !== -1;
            });
            renderPolicyTable(filtered);
        });
    }

    function renderPolicyTable(data) {
        Tables.render({
            containerId: 'policy-table',
            data: data,
            columns: [
                { key: 'displayName', label: 'Policy Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
                { key: 'description', label: 'Description', className: 'cell-truncate' },
                { key: 'ruleCount', label: 'Rules', formatter: function(v) { return (Fmt.formatCount ? Fmt.formatCount(v) : v) || '0'; }},
                { key: 'isAssigned', label: 'Assigned', formatter: function(v) { return Fmt.formatBoolean ? Fmt.formatBoolean(v) : (v ? 'Yes' : 'No'); }},
                { key: 'lastModifiedDateTime', label: 'Modified', formatter: function(v) { return Fmt.formatDate ? Fmt.formatDate(v) : v; }}
            ],
            pageSize: 25,
            onRowClick: showPolicyDetails
        });
    }

    function applyFilters() {
        var data = extractData(DataLoader.getData('asrRules'));
        var rules = data.rules;

        var filterConfig = {
            search: Filters.getValue('asr-search'),
            searchFields: ['ruleName', 'ruleId', 'description'],
            exact: {}
        };

        var modeFilter = Filters.getValue('asr-mode');
        if (modeFilter && modeFilter !== 'all') filterConfig.exact.mode = modeFilter;

        var deployedFilter = Filters.getValue('asr-deployed');
        if (deployedFilter && deployedFilter !== 'all') {
            filterConfig.exact.isDeployed = deployedFilter === 'true';
        }

        renderTable(Filters.apply(rules, filterConfig));
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['ruleName', 'mode', 'isDeployed', 'blockCount', 'auditCount', 'coverage'];

        var allDefs = [
            { key: 'ruleName', label: 'Rule Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'ruleId', label: 'Rule ID', className: 'cell-truncate' },
            { key: 'mode', label: 'Mode', formatter: function(v) {
                return Fmt.formatActionMode ? Fmt.formatActionMode(v) : formatMode(v);
            }},
            { key: 'isDeployed', label: 'Deployed', formatter: function(v) {
                return v ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-neutral">No</span>';
            }},
            { key: 'blockCount', label: 'Block Count', formatter: function(v) {
                return Fmt.formatCount ? Fmt.formatCount(v) : '<span class="text-success">' + (v || 0) + '</span>';
            }},
            { key: 'auditCount', label: 'Audit Count', formatter: function(v) {
                return Fmt.formatCount ? Fmt.formatCount(v) : '<span class="text-info">' + (v || 0) + '</span>';
            }},
            { key: 'warnCount', label: 'Warn Count', formatter: function(v) {
                return Fmt.formatCount ? Fmt.formatCount(v) : '<span class="text-warning">' + (v || 0) + '</span>';
            }},
            { key: 'coverage', label: 'Coverage', formatter: function(v) {
                return Fmt.formatPercentage ? Fmt.formatPercentage(v, { inverse: true }) : formatCoverage(v);
            }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://security.microsoft.com/asr" target="_blank" rel="noopener" class="admin-link" title="Open in Defender">Defender</a>';
            }}
        ];

        Tables.render({
            containerId: 'asr-table',
            data: data,
            columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }),
            pageSize: 50,
            onRowClick: showRuleDetails
        });
    }

    // Fallback formatters if SharedFormatters not available
    function formatMode(v) {
        var modes = {
            'block': 'badge-success',
            'audit': 'badge-info',
            'warn': 'badge-warning',
            'off': 'badge-neutral',
            'notConfigured': 'badge-neutral'
        };
        var labels = {
            'block': 'Block',
            'audit': 'Audit',
            'warn': 'Warn',
            'off': 'Off',
            'notConfigured': 'Not Configured'
        };
        return '<span class="badge ' + (modes[v] || 'badge-neutral') + '">' + (labels[v] || v || 'Unknown') + '</span>';
    }

    function formatCoverage(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
        var pct = Math.round(Number(v));
        var cls = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + pct + '%</span>';
    }

    function showRuleDetails(rule) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = rule.ruleName || 'ASR Rule Details';

        var html = '<div class="detail-grid">';

        // Rule Information
        html += '<div class="detail-section"><h4>Rule Information</h4><dl class="detail-list">';
        html += '<dt>Rule Name</dt><dd>' + (rule.ruleName || '--') + '</dd>';
        html += '<dt>Rule ID</dt><dd style="font-size:0.85em; word-break:break-all">' + (rule.ruleId || '--') + '</dd>';
        html += '<dt>Description</dt><dd>' + (rule.description || '--') + '</dd>';
        html += '</dl></div>';

        // Configuration
        html += '<div class="detail-section"><h4>Configuration</h4><dl class="detail-list">';
        html += '<dt>Mode</dt><dd>' + (Fmt.formatActionMode ? Fmt.formatActionMode(rule.mode) : formatMode(rule.mode)) + '</dd>';
        html += '<dt>Deployed</dt><dd>' + (rule.isDeployed ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-neutral">No</span>') + '</dd>';
        html += '<dt>Coverage</dt><dd>' + (Fmt.formatPercentage ? Fmt.formatPercentage(rule.coverage, { inverse: true }) : formatCoverage(rule.coverage)) + '</dd>';
        html += '</dl></div>';

        // Policy Counts
        html += '<div class="detail-section"><h4>Policy Counts</h4><dl class="detail-list">';
        html += '<dt>Block Mode</dt><dd>' + (Fmt.formatCount ? Fmt.formatCount(rule.blockCount) : rule.blockCount || 0) + '</dd>';
        html += '<dt>Audit Mode</dt><dd>' + (Fmt.formatCount ? Fmt.formatCount(rule.auditCount) : rule.auditCount || 0) + '</dd>';
        html += '<dt>Warn Mode</dt><dd>' + (Fmt.formatCount ? Fmt.formatCount(rule.warnCount) : rule.warnCount || 0) + '</dd>';
        html += '<dt>Total Policies</dt><dd>' + (rule.assignedDevices || 0) + '</dd>';
        html += '</dl></div>';

        // Recommendations
        html += '<div class="detail-section"><h4>Recommendations</h4><dl class="detail-list">';
        if (!rule.isDeployed) {
            html += '<dt>Status</dt><dd><span class="badge badge-warning">Action Required</span></dd>';
            html += '<dt>Recommendation</dt><dd>Consider deploying this ASR rule to protect endpoints against common attack techniques.</dd>';
        } else if (rule.mode === 'audit') {
            html += '<dt>Status</dt><dd><span class="badge badge-info">Review</span></dd>';
            html += '<dt>Recommendation</dt><dd>Review audit logs and consider promoting to Block mode once verified safe.</dd>';
        } else if (rule.mode === 'block') {
            html += '<dt>Status</dt><dd><span class="badge badge-success">Enforcing</span></dd>';
            html += '<dt>Recommendation</dt><dd>Rule is actively protecting endpoints. Monitor for any legitimate application blocks.</dd>';
        } else {
            html += '<dt>Status</dt><dd><span class="badge badge-neutral">Not Configured</span></dd>';
            html += '<dt>Recommendation</dt><dd>Configure this rule based on your organization security requirements.</dd>';
        }
        html += '</dl></div>';

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function showPolicyDetails(policy) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = policy.displayName || 'ASR Policy Details';

        var html = '<div class="detail-grid">';

        // Policy Information
        html += '<div class="detail-section"><h4>Policy Information</h4><dl class="detail-list">';
        html += '<dt>Policy Name</dt><dd>' + (policy.displayName || '--') + '</dd>';
        html += '<dt>Description</dt><dd>' + (policy.description || '--') + '</dd>';
        html += '<dt>Template ID</dt><dd style="font-size:0.85em">' + (policy.templateId || '--') + '</dd>';
        html += '</dl></div>';

        // Status
        html += '<div class="detail-section"><h4>Status</h4><dl class="detail-list">';
        html += '<dt>Assigned</dt><dd>' + (Fmt.formatBoolean ? Fmt.formatBoolean(policy.isAssigned) : (policy.isAssigned ? 'Yes' : 'No')) + '</dd>';
        html += '<dt>Rule Count</dt><dd>' + (policy.ruleCount || 0) + '</dd>';
        html += '<dt>Created</dt><dd>' + (Fmt.formatDateTime ? Fmt.formatDateTime(policy.createdDateTime) : policy.createdDateTime || '--') + '</dd>';
        html += '<dt>Modified</dt><dd>' + (Fmt.formatDateTime ? Fmt.formatDateTime(policy.lastModifiedDateTime) : policy.lastModifiedDateTime || '--') + '</dd>';
        html += '</dl></div>';

        // Rules in Policy
        if (policy.asrRules && policy.asrRules.length > 0) {
            html += '<div class="detail-section" style="grid-column: span 2"><h4>Rules in Policy (' + policy.asrRules.length + ')</h4>';
            html += '<table class="data-table"><thead><tr><th>Rule Name</th><th>Mode</th></tr></thead><tbody>';
            policy.asrRules.forEach(function(r) {
                var mode = (r.mode || '').toLowerCase();
                html += '<tr>';
                html += '<td>' + (r.ruleName || '--') + '</td>';
                html += '<td>' + (Fmt.formatActionMode ? Fmt.formatActionMode(mode) : formatMode(mode)) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function render(container) {
        var data = extractData(DataLoader.getData('asrRules'));
        var rules = data.rules;
        var policies = data.policies;

        var totalRules = rules.length;
        var blockMode = rules.filter(function(r) { return r.mode === 'block'; }).length;
        var auditMode = rules.filter(function(r) { return r.mode === 'audit'; }).length;
        var notConfigured = rules.filter(function(r) { return r.mode === 'notConfigured' || r.mode === 'off'; }).length;
        var deployed = rules.filter(function(r) { return r.isDeployed; }).length;
        var avgCoverage = totalRules > 0 ? Math.round(rules.reduce(function(s, r) { return s + (r.coverage || 0); }, 0) / totalRules) : 0;

        var html = '<div class="page-header"><h2>Attack Surface Reduction Rules</h2></div>';

        // Summary cards
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + totalRules + '</div><div class="summary-label">Total Rules</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + blockMode + '</div><div class="summary-label">Block Mode</div></div>';
        html += '<div class="summary-card card-info"><div class="summary-value">' + auditMode + '</div><div class="summary-label">Audit Mode</div></div>';
        html += '<div class="summary-card' + (notConfigured > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + notConfigured + '</div><div class="summary-label">Not Configured</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + deployed + '/' + totalRules + '</div><div class="summary-label">Deployed</div></div>';
        html += '</div>';

        // Tab bar
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="rules">All Rules (' + rules.length + ')</button>';
        html += '<button class="tab-btn" data-tab="policies">Policies (' + policies.length + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="asr-content"></div>';
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

window.PageASRRules = PageASRRules;
