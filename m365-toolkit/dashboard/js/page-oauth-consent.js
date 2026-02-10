/**
 * ============================================================================
 * TenantScope - OAuth Consent Grants Page
 * ============================================================================
 * Displays OAuth permission grants and identifies high-risk app consents.
 * Data sourced from trusted Graph API collectors - sanitized with escapeHtml.
 */

const PageOAuthConsent = (function() {
    'use strict';

    var AU = window.ActionUtils || {};
    var SF = window.SharedFormatters || {};
    var currentTab = 'grants';
    var state = {
        summary: {},
        grants: [],
        insights: [],
        riskyScopes: []
    };

    function render(container) {
        const data = DataLoader.getData('oauthConsentGrants');

        if (!data || !data.grants?.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-title">No OAuth Consent Data</div>
                    <div class="empty-state-description">
                        No OAuth permission grants found or data not yet collected.<br>
                        Run the data collection to populate this page.
                    </div>
                </div>
            `;
            return;
        }

        const grants = Array.isArray(data.grants) ? data.grants : [];
        const summary = buildSummary(data, grants);

        state = {
            summary: summary,
            grants: grants,
            insights: Array.isArray(data.insights) ? data.insights : [],
            riskyScopes: Array.isArray(summary.riskyScopeBreakdown) ? summary.riskyScopeBreakdown.slice() : []
        };

        let html = `
            <div class="page-header">
                <h2 class="page-title">OAuth Consent Grants</h2>
                <p class="page-description">Application permissions and consent analysis</p>
            </div>
        `;

        const totalGrants = summary.totalGrants || grants.length;
        const highRisk = summary.highRiskGrants || 0;
        const unverified = summary.unverifiedPublisherGrants || 0;
        const adminConsents = summary.adminConsentGrants || 0;
        const uniqueApps = summary.uniqueAppCount || 0;

        html += '<div class="summary-cards">';
        html += '<div class="summary-card card-info"><div class="summary-value">' + totalGrants + '</div><div class="summary-label">Total Grants</div></div>';
        html += '<div class="summary-card' + (highRisk > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value text-critical">' + highRisk + '</div><div class="summary-label">High Risk</div></div>';
        html += '<div class="summary-card' + (unverified > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + unverified + '</div><div class="summary-label">Unverified Publishers</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + adminConsents + '</div><div class="summary-label">Admin Consents</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + uniqueApps + '</div><div class="summary-label">Unique Apps</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="grants">All Grants (' + totalGrants + ')</button>';
        html += '</div>';
        html += '<div class="content-area" id="oauth-consent-content"></div>';

        container.innerHTML = html;

        const tabButtons = container.querySelectorAll('.tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab;
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderTabContent();
            });
        });

        currentTab = 'grants';
        renderTabContent();
    }

    function renderTabContent() {
        const container = document.getElementById('oauth-consent-content');
        if (!container) return;

        if (currentTab === 'grants') {
            renderGrantsTab(container);
        }
    }

    var colSelector = null;

    function renderGrantsTab(container) {
        let html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="oauth-search" placeholder="Search apps, publishers, users...">';
        html += '<select class="filter-select" id="oauth-risk">';
        html += '<option value="all">All Risk Levels</option>';
        html += '<option value="high">High</option>';
        html += '<option value="medium">Medium</option>';
        html += '<option value="low">Low</option>';
        html += '</select>';
        html += '<select class="filter-select" id="oauth-consent">';
        html += '<option value="all">All Consent Types</option>';
        html += '<option value="admin">Admin Consent</option>';
        html += '<option value="user">User Consent</option>';
        html += '</select>';
        html += '<div id="oauth-colselector"></div>';
        html += '</div>';
        html += '<div id="oauth-grants-table"></div>';

        container.innerHTML = html;

        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'oauth-colselector',
                storageKey: 'tenantscope-oauth-cols-v1',
                allColumns: [
                    { key: 'appDisplayName', label: 'Application' },
                    { key: 'appPublisher', label: 'Publisher' },
                    { key: 'riskLevel', label: 'Risk Level' },
                    { key: 'isAdminConsent', label: 'Consent Type' },
                    { key: 'principalDisplayName', label: 'User' },
                    { key: 'scopeCount', label: 'Scopes' },
                    { key: 'highRiskScopes', label: 'High-Risk Scopes' },
                    { key: '_adminLinks', label: 'Admin' }
                ],
                defaultVisible: ['appDisplayName', 'appPublisher', 'riskLevel', 'isAdminConsent', 'principalDisplayName', 'scopeCount', 'highRiskScopes', '_adminLinks'],
                onColumnsChanged: function() { applyGrantFilters(); }
            });
        }

        Filters.setup('oauth-search', applyGrantFilters);
        Filters.setup('oauth-risk', applyGrantFilters);
        Filters.setup('oauth-consent', applyGrantFilters);
        applyGrantFilters();
    }

    function applyGrantFilters() {
        const search = Filters.getValue('oauth-search');
        const risk = Filters.getValue('oauth-risk');
        const consent = Filters.getValue('oauth-consent');

        const filterConfig = {
            search: search,
            searchFields: ['appDisplayName', 'appPublisher', 'principalDisplayName', 'scopes', 'highRiskScopes'],
            exact: { riskLevel: risk }
        };

        if (consent === 'admin') {
            filterConfig.boolean = { isAdminConsent: true };
        } else if (consent === 'user') {
            filterConfig.boolean = { isAdminConsent: false };
        }

        const filtered = Filters.apply(state.grants, filterConfig);
        renderGrantsTable(filtered);
    }

    function renderGrantsTable(grants) {
        if (!grants.length) {
            document.getElementById('oauth-grants-table').innerHTML = '<div class="empty-state"><p>No grants found</p></div>';
            return;
        }

        var visible = colSelector ? colSelector.getVisible() : ['appDisplayName', 'appPublisher', 'riskLevel', 'isAdminConsent', 'principalDisplayName', 'scopeCount', 'highRiskScopes', '_adminLinks'];

        var allDefs = [
            { key: 'appDisplayName', label: 'Application', formatter: function(v, row) {
                var name = escapeHtml(v || 'Unknown App');
                return '<a href="#enterprise-apps?search=' + encodeURIComponent(v || '') + '" class="entity-link"><strong>' + name + '</strong></a>';
            }},
            { key: 'appPublisher', label: 'Publisher', formatter: function(v, row) {
                var publisher = escapeHtml(v || 'Unknown');
                var tags = '';
                if (row.isMicrosoft) tags += ' <span class="tag">Microsoft</span>';
                else if (row.isVerifiedPublisher) tags += ' <span class="tag">Verified</span>';
                else tags += ' <span class="tag">Unverified</span>';
                return publisher + tags;
            }},
            { key: 'riskLevel', label: 'Risk Level', formatter: function(v) { return formatSeverityBadge(v); } },
            { key: 'isAdminConsent', label: 'Consent Type', formatter: function(v) {
                return v ? '<span class="badge badge-info">Admin</span>' : '<span class="badge badge-neutral">User</span>';
            }},
            { key: 'principalDisplayName', label: 'User', formatter: function(v, row) {
                var upn = row.principalDisplayName || '';
                if (upn) {
                    return '<a href="#users?search=' + encodeURIComponent(upn) + '" class="entity-link">' + escapeHtml(upn) + '</a>';
                }
                return '<span class="text-muted">All Users</span>';
            }},
            { key: 'scopeCount', label: 'Scopes' },
            { key: 'highRiskScopes', label: 'High-Risk Scopes', formatter: function(v) {
                var list = Array.isArray(v) ? v : [];
                var html = list.slice(0, 3).map(function(s) {
                    return '<code class="scope-tag scope-tag--danger">' + escapeHtml(s) + '</code>';
                }).join(' ');
                if (list.length > 3) html += ' <span class="more-tag">+' + (list.length - 3) + ' more</span>';
                return html || '<span class="text-muted">--</span>';
            }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (row.appId || row.clientAppId) {
                    var appId = row.appId || row.clientAppId;
                    return '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ManagedAppMenuBlade/appId/' + encodeURIComponent(appId) + '/Permissions" target="_blank" rel="noopener" class="admin-link" title="Open in Entra">Entra</a>';
                }
                return '--';
            }}
        ];

        Tables.render({
            containerId: 'oauth-grants-table',
            data: grants,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showGrantDetails
        });
    }

    function buildSummary(data, grants) {
        const summary = data.summary || {};

        const computed = {
            totalGrants: grants.length,
            adminConsentGrants: grants.filter(g => g.isAdminConsent).length,
            userConsentGrants: grants.filter(g => !g.isAdminConsent).length,
            highRiskGrants: grants.filter(g => g.riskLevel === 'high').length,
            mediumRiskGrants: grants.filter(g => g.riskLevel === 'medium').length,
            lowRiskGrants: grants.filter(g => g.riskLevel === 'low').length,
            unverifiedPublisherGrants: grants.filter(g => !g.isVerifiedPublisher && !g.isMicrosoft).length,
            thirdPartyGrants: grants.filter(g => !g.isMicrosoft).length,
            microsoftGrants: grants.filter(g => g.isMicrosoft).length,
            uniqueAppCount: new Set(grants.map(g => g.appId || g.appDisplayName)).size,
            uniqueUserCount: new Set(grants.filter(g => g.principalId).map(g => g.principalId)).size,
            riskyScopeBreakdown: summary.riskyScopeBreakdown || buildRiskyScopeBreakdown(grants)
        };

        return {
            totalGrants: valueOr(summary.totalGrants, computed.totalGrants),
            adminConsentGrants: valueOr(summary.adminConsentGrants, computed.adminConsentGrants),
            userConsentGrants: valueOr(summary.userConsentGrants, computed.userConsentGrants),
            highRiskGrants: valueOr(summary.highRiskGrants, computed.highRiskGrants),
            mediumRiskGrants: valueOr(summary.mediumRiskGrants, computed.mediumRiskGrants),
            lowRiskGrants: valueOr(summary.lowRiskGrants, computed.lowRiskGrants),
            unverifiedPublisherGrants: valueOr(summary.unverifiedPublisherGrants, computed.unverifiedPublisherGrants),
            thirdPartyGrants: valueOr(summary.thirdPartyGrants, computed.thirdPartyGrants),
            microsoftGrants: valueOr(summary.microsoftGrants, computed.microsoftGrants),
            uniqueAppCount: valueOr(summary.uniqueAppCount, computed.uniqueAppCount),
            uniqueUserCount: valueOr(summary.uniqueUserCount, computed.uniqueUserCount),
            riskyScopeBreakdown: computed.riskyScopeBreakdown
        };
    }

    function buildRiskyScopeBreakdown(grants) {
        const map = {};
        grants.forEach(grant => {
            (grant.highRiskScopes || []).forEach(scope => {
                map[scope] = (map[scope] || 0) + 1;
            });
        });
        return Object.keys(map).map(scope => ({ scope: scope, count: map[scope] }))
            .sort((a, b) => b.count - a.count);
    }

    function formatSeverityBadge(value) {
        const sev = (value || '').toLowerCase();
        return SF.formatSeverity ? SF.formatSeverity(sev) : '<span class="badge badge-neutral">' + escapeHtml(sev || 'Unknown') + '</span>';
    }

    function buildRevokeConsentCommand(grant) {
        if (!grant || !grant.id) return '';
        var safeId = AU.escapeSingleQuotes ? AU.escapeSingleQuotes(grant.id) : String(grant.id).replace(/'/g, "''");
        return "Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId '" + safeId + "'";
    }

    function showGrantDetails(grant) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        if (!modal || !title || !body) return;

        title.textContent = grant.appDisplayName || 'Consent Grant Details';

        var revokeCommand = buildRevokeConsentCommand(grant);
        var scopes = Array.isArray(grant.scopes) ? grant.scopes.join(', ') : '--';
        var highRiskScopes = Array.isArray(grant.highRiskScopes) ? grant.highRiskScopes.join(', ') : '--';

        body.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Application</span>
                    <span class="detail-value">${escapeHtml(grant.appDisplayName || 'Unknown')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Publisher</span>
                    <span class="detail-value">${escapeHtml(grant.appPublisher || 'Unknown')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Consent Type</span>
                    <span class="detail-value">${grant.isAdminConsent ? 'Admin' : 'User'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Risk Level</span>
                    <span class="detail-value">${formatSeverityBadge(grant.riskLevel)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Principal</span>
                    <span class="detail-value">${escapeHtml(grant.principalDisplayName || 'All Users')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Granted</span>
                    <span class="detail-value">${escapeHtml(grant.grantedDateTime || '--')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Scopes</span>
                    <span class="detail-value">${escapeHtml(scopes)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">High-Risk Scopes</span>
                    <span class="detail-value">${escapeHtml(highRiskScopes)}</span>
                </div>
            </div>

            <div class="detail-section">
                <h4>Actions</h4>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Revoke Consent (PowerShell)</span>
                        <div class="detail-value">
                            <input type="text" class="filter-input action-input" id="revoke-consent-command" readonly>
                        </div>
                    </div>
                </div>
                <div class="action-row">
                    <button class="btn btn-secondary" id="copy-revoke-consent">Copy Command</button>
                </div>
                <div class="action-note">Copy and run in a PowerShell session with Microsoft Graph connected.</div>
            </div>
        `;

        var cmdInput = body.querySelector('#revoke-consent-command');
        var copyBtn = body.querySelector('#copy-revoke-consent');
        if (cmdInput) {
            cmdInput.value = revokeCommand || 'Command unavailable';
        }
        if (copyBtn) {
            copyBtn.disabled = !revokeCommand;
            copyBtn.addEventListener('click', function() {
                if (!revokeCommand || !AU.copyText) return;
                AU.copyText(revokeCommand).then(function() {
                    if (window.Toast) Toast.success('Copied', 'Revoke consent command copied.');
                }).catch(function() {
                    if (window.Toast) Toast.error('Copy failed', 'Unable to copy command.');
                });
            });
        }

        modal.classList.add('visible');
    }

    function insightClass(severity) {
        if (severity === 'critical') return 'insight-critical';
        if (severity === 'high') return 'insight-high';
        if (severity === 'warning') return 'insight-warning';
        if (severity === 'info') return 'insight-info';
        return 'insight-info';
    }

    function valueOr(value, fallback) {
        return (value === null || value === undefined) ? fallback : value;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    return { render };
})();

window.PageOAuthConsent = PageOAuthConsent;
