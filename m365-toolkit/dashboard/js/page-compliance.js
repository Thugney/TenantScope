/**
 * TenantScope - Compliance Page
 *
 * Governance overview that surfaces overdue or high-impact issues first and
 * keeps the underlying reference data visible below.
 */

const PageCompliance = (function() {
    'use strict';

    var AU = window.ActionUtils || {};
    var state = {
        retention: null,
        ediscovery: null,
        sensitivity: null,
        accessReviews: null,
        insights: [],
        overdueReviews: []
    };

    function escapeHtml(value) {
        return Tables.escapeHtml(value === null || value === undefined ? '' : String(value));
    }

    function normalizeText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function getUserHref(target) {
        if (AU.getUserProfileHash) return AU.getUserProfileHash(target);
        var value = typeof target === 'string'
            ? target
            : target && (target.userPrincipalName || target.mail || target.displayName || '');
        return value ? '#users?search=' + encodeURIComponent(value) : '#users';
    }

    function getScopeHref(definition) {
        if (!definition) return '';
        var scopeType = normalizeText(definition.scopeType).toLowerCase();
        if (scopeType === 'group') return '#groups?search=' + encodeURIComponent(definition.scopeName || '');
        if (scopeType === 'application') return '#oauth-consent';
        if (scopeType === 'role') return '#pim';
        if (scopeType === 'guest') return '#guests';
        if (scopeType === 'accesspackage') return '#lifecycle';
        return '';
    }

    function formatFlags(flags) {
        var list = Array.isArray(flags) ? flags : [];
        if (!list.length) return '<span class="text-muted">--</span>';
        return list.map(function(flag) {
            return '<span class="tag">' + escapeHtml(flag) + '</span>';
        }).join(' ');
    }

    function buildOverdueReviews(accessReviews) {
        var definitions = accessReviews && Array.isArray(accessReviews.definitions) ? accessReviews.definitions : [];
        var definitionById = {};
        definitions.forEach(function(definition) {
            definitionById[definition.id] = definition;
        });

        var instances = accessReviews && Array.isArray(accessReviews.instances) ? accessReviews.instances : [];
        return instances.filter(function(instance) {
            return normalizeText(instance.status).toLowerCase() === 'overdue';
        }).map(function(instance) {
            var definition = definitionById[instance.definitionId] || {};
            return {
                id: instance.id,
                displayName: definition.displayName || 'Unknown Review',
                scopeType: definition.scopeType || '--',
                scopeName: definition.scopeName || '--',
                reviewerType: definition.reviewerType || '--',
                decisionsPending: instance.decisionsPending || 0,
                reviewersCompleted: instance.reviewersCompleted || 0,
                reviewersTotal: instance.reviewersTotal || 0,
                endDateTime: instance.endDateTime,
                flags: definition.flags || [],
                definition: definition
            };
        }).sort(function(a, b) {
            return new Date(a.endDateTime).getTime() - new Date(b.endDateTime).getTime();
        });
    }

    function buildCombinedInsights() {
        var insights = [];
        ['retention', 'ediscovery', 'sensitivity', 'accessReviews'].forEach(function(key) {
            var data = state[key];
            if (data && Array.isArray(data.insights)) {
                insights = insights.concat(data.insights);
            }
        });
        if (state.overdueReviews.length > 0) {
            insights.unshift({
                severity: 'critical',
                title: 'Overdue access reviews',
                description: state.overdueReviews.length + ' review instances are overdue and still have pending access decisions.',
                recommendedAction: 'Finish overdue reviews first, starting with privileged and guest scopes.'
            });
        }
        return insights.slice(0, 8);
    }

    function renderSummaryCards() {
        var element = document.getElementById('compliance-summary');
        if (!element) return;
        var retentionSummary = state.retention && state.retention.summary || {};
        var ediscoverySummary = state.ediscovery && state.ediscovery.summary || {};
        var sensitivitySummary = state.sensitivity && state.sensitivity.summary || {};
        var accessSummary = state.accessReviews && state.accessReviews.summary || {};

        element.innerHTML =
            '<div class="summary-card"><div class="summary-value">' + (retentionSummary.totalLabels || 0) + '</div><div class="summary-label">Retention Labels</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + (sensitivitySummary.totalLabels || 0) + '</div><div class="summary-label">Sensitivity Labels</div></div>' +
            '<div class="summary-card card-warning"><div class="summary-value">' + (ediscoverySummary.activeCases || 0) + '</div><div class="summary-label">Active eDiscovery Cases</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + state.overdueReviews.length + '</div><div class="summary-label">Overdue Reviews</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + (accessSummary.totalDefinitions || 0) + '</div><div class="summary-label">Review Definitions</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + (retentionSummary.labelsNotInUse || 0) + '</div><div class="summary-label">Unused Retention Labels</div></div>';
    }

    function renderInsights() {
        var element = document.getElementById('compliance-insights');
        if (!element) return;
        if (!state.insights.length) {
            element.innerHTML = '<p class="text-muted">No governance insights were produced for the current data set.</p>';
            return;
        }
        var html = '<div class="insights-list">';
        state.insights.forEach(function(insight) {
            var severity = normalizeText(insight.severity).toLowerCase();
            var cls = severity === 'critical' ? 'insight-critical' :
                severity === 'high' ? 'insight-high' :
                severity === 'warning' ? 'insight-warning' :
                'insight-info';
            html += '<div class="insight-card ' + cls + '">';
            html += '<div class="insight-header"><strong>' + escapeHtml(insight.title || 'Insight') + '</strong></div>';
            html += '<p class="insight-description">' + escapeHtml(insight.description || '') + '</p>';
            if (insight.recommendedAction) {
                html += '<p class="insight-action"><strong>Action:</strong> ' + escapeHtml(insight.recommendedAction) + '</p>';
            }
            html += '</div>';
        });
        html += '</div>';
        element.innerHTML = html;
    }

    function renderOverdueReviews() {
        Tables.render({
            containerId: 'compliance-overdue-reviews',
            data: state.overdueReviews,
            columns: [
                {
                    key: 'displayName',
                    label: 'Review',
                    formatter: function(v, row) {
                        var href = getScopeHref(row.definition);
                        var label = '<strong>' + escapeHtml(v || '--') + '</strong>';
                        if (href) label = '<a href="' + href + '" class="entity-link" onclick="event.stopPropagation();">' + label + '</a>';
                        return label + '<br><small>' + escapeHtml(row.scopeType || '--') + ': ' + escapeHtml(row.scopeName || '--') + '</small>';
                    }
                },
                { key: 'reviewerType', label: 'Reviewer Type' },
                { key: 'decisionsPending', label: 'Pending Decisions' },
                {
                    key: 'reviewersCompleted',
                    label: 'Reviewer Progress',
                    formatter: function(v, row) {
                        return '<strong>' + row.reviewersCompleted + '</strong> / ' + row.reviewersTotal;
                    }
                },
                { key: 'endDateTime', label: 'Due Date', formatter: Tables.formatters.date },
                { key: 'flags', label: 'Flags', formatter: formatFlags }
            ],
            pageSize: 25
        });
    }

    function renderEdiscoveryCases() {
        var cases = state.ediscovery && Array.isArray(state.ediscovery.cases) ? state.ediscovery.cases : [];
        Tables.render({
            containerId: 'compliance-ediscovery-cases',
            data: cases,
            columns: [
                {
                    key: 'displayName',
                    label: 'Case',
                    formatter: function(v, row) {
                        return '<strong>' + escapeHtml(v || '--') + '</strong><br><small>' + escapeHtml(row.caseType || '--') + '</small>';
                    }
                },
                { key: 'status', label: 'Status', formatter: function(v) { return '<span class="badge ' + (normalizeText(v).toLowerCase() === 'active' ? 'badge-warning' : 'badge-neutral') + '">' + escapeHtml(v || '--') + '</span>'; } },
                { key: 'custodianCount', label: 'Custodians' },
                { key: 'holdCount', label: 'Legal Holds' },
                {
                    key: 'createdBy',
                    label: 'Created By',
                    formatter: function(v) {
                        if (!v) return '--';
                        var email = normalizeText(v.email);
                        return email
                            ? '<a href="' + getUserHref(email) + '" class="entity-link" onclick="event.stopPropagation();">' + escapeHtml(v.displayName || email) + '</a>'
                            : escapeHtml(v.displayName || '--');
                    }
                },
                { key: 'lastModifiedDateTime', label: 'Last Updated', formatter: Tables.formatters.datetime },
                { key: 'flags', label: 'Flags', formatter: formatFlags }
            ],
            pageSize: 20
        });
    }

    function renderCustodians() {
        var custodians = state.ediscovery && Array.isArray(state.ediscovery.custodians) ? state.ediscovery.custodians : [];
        Tables.render({
            containerId: 'compliance-custodians',
            data: custodians,
            columns: [
                {
                    key: 'displayName',
                    label: 'Custodian',
                    formatter: function(v, row) {
                        return '<a href="' + getUserHref(row.email || row.displayName) + '" class="entity-link" onclick="event.stopPropagation();"><strong>' + escapeHtml(v || '--') + '</strong></a><br><small>' + escapeHtml(row.email || '--') + '</small>';
                    }
                },
                { key: 'caseId', label: 'Case Id' },
                { key: 'status', label: 'Status' },
                { key: 'holdStatus', label: 'Hold Status' },
                { key: 'dataSourcesCount', label: 'Data Sources' }
            ],
            pageSize: 15
        });
    }

    function renderSensitivityLabels() {
        var labels = state.sensitivity && Array.isArray(state.sensitivity.labels) ? state.sensitivity.labels : [];
        Tables.render({
            containerId: 'compliance-sensitivity-labels',
            data: labels,
            columns: [
                {
                    key: 'displayName',
                    label: 'Label',
                    formatter: function(v, row) {
                        var color = row.color ? '<span class="color-dot" style="background:' + escapeHtml(row.color) + ';"></span>' : '';
                        return '<strong>' + escapeHtml(v || '--') + '</strong> ' + color;
                    }
                },
                { key: 'protectionTier', label: 'Tier', formatter: function(v) { return '<span class="badge ' + (v === 'highlyConfidential' ? 'badge-critical' : v === 'confidential' ? 'badge-warning' : 'badge-info') + '">' + escapeHtml(v || '--') + '</span>'; } },
                { key: 'hasEncryption', label: 'Encryption', formatter: function(v) { return v ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>'; } },
                { key: 'isAutoLabelingEnabled', label: 'Auto-Labeling', formatter: function(v) { return v ? '<span class="text-success">Enabled</span>' : '<span class="text-muted">Disabled</span>'; } },
                {
                    key: '_scope',
                    label: 'Scope',
                    formatter: function(v, row) {
                        return [row.isFileLabel && 'Files', row.isEmailLabel && 'Email', row.isSiteLabel && 'Sites', row.isMeetingLabel && 'Meetings'].filter(Boolean).join(', ') || '--';
                    }
                },
                { key: 'flags', label: 'Flags', formatter: formatFlags }
            ],
            pageSize: 25
        });
    }

    function renderRetentionLabels() {
        var labels = state.retention && Array.isArray(state.retention.labels) ? state.retention.labels : [];
        Tables.render({
            containerId: 'compliance-retention-labels',
            data: labels,
            columns: [
                { key: 'displayName', label: 'Label', formatter: function(v) { return '<strong>' + escapeHtml(v || '--') + '</strong>'; } },
                { key: 'labelType', label: 'Type' },
                {
                    key: '_retention',
                    label: 'Retention',
                    formatter: function(v, row) {
                        if (row.isUnlimited) return 'Unlimited';
                        if (row.retentionYears) return row.retentionYears + ' years';
                        if (row.retentionDays) return row.retentionDays + ' days';
                        return '--';
                    }
                },
                { key: 'actionAfterRetention', label: 'Action After' },
                { key: 'itemCount', label: 'Items' },
                { key: 'isInUse', label: 'In Use', formatter: function(v) { return v ? '<span class="text-success">Yes</span>' : '<span class="text-warning">No</span>'; } },
                { key: 'flags', label: 'Flags', formatter: formatFlags }
            ],
            pageSize: 25
        });
    }

    function render(container) {
        state.retention = DataLoader.getData('retentionData');
        state.ediscovery = DataLoader.getData('ediscoveryData');
        state.sensitivity = DataLoader.getData('sensitivityLabels');
        state.accessReviews = DataLoader.getData('accessReviews');

        var hasData =
            state.retention && Array.isArray(state.retention.labels) && state.retention.labels.length ||
            state.ediscovery && Array.isArray(state.ediscovery.cases) && state.ediscovery.cases.length ||
            state.sensitivity && Array.isArray(state.sensitivity.labels) && state.sensitivity.labels.length ||
            state.accessReviews && Array.isArray(state.accessReviews.definitions) && state.accessReviews.definitions.length;

        if (!hasData) {
            container.innerHTML =
                '<div class="empty-state">' +
                    '<div class="empty-state-title">No Compliance Data</div>' +
                    '<div class="empty-state-description">No retention, eDiscovery, sensitivity label, or access review data was found in the local bundle.</div>' +
                '</div>';
            return;
        }

        state.overdueReviews = buildOverdueReviews(state.accessReviews);
        state.insights = buildCombinedInsights();

        container.innerHTML =
            '<div class="page-header">' +
                '<h2 class="page-title">Compliance &amp; Data Governance</h2>' +
                '<p class="page-description">Governance exceptions first, then the full retention, eDiscovery, sensitivity, and access review data below.</p>' +
            '</div>' +
            '<div class="summary-cards" id="compliance-summary"></div>' +
            '<div class="analytics-section">' +
                '<h3>Governance Priorities</h3>' +
                '<div id="compliance-insights"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Overdue Access Reviews</h3>' +
                '<div id="compliance-overdue-reviews"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>eDiscovery Cases</h3>' +
                '<div id="compliance-ediscovery-cases"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Custodians Under Hold</h3>' +
                '<div id="compliance-custodians"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Sensitivity Labels</h3>' +
                '<div id="compliance-sensitivity-labels"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Retention Labels</h3>' +
                '<div id="compliance-retention-labels"></div>' +
            '</div>';

        renderSummaryCards();
        renderInsights();
        renderOverdueReviews();
        renderEdiscoveryCases();
        renderCustodians();
        renderSensitivityLabels();
        renderRetentionLabels();
    }

    return {
        render: render
    };
})();

window.PageCompliance = PageCompliance;
