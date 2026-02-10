/**
 * ============================================================================
 * TenantScope - Compliance Page
 * ============================================================================
 * Combined view for compliance data: Retention, eDiscovery, Sensitivity Labels, Access Reviews.
 * Data sourced from trusted Graph API collectors - all dynamic content sanitized with escapeHtml.
 */

const PageCompliance = (function() {
    'use strict';

    var currentTab = 'retention';
    var state = {
        retentionData: null,
        ediscoveryData: null,
        sensitivityData: null,
        accessReviewData: null,
        insights: []
    };

    function render(container) {
        const retentionData = DataLoader.getData('retentionData');
        const ediscoveryData = DataLoader.getData('ediscoveryData');
        const sensitivityData = DataLoader.getData('sensitivityLabels');
        const accessReviewData = DataLoader.getData('accessReviews');

        const hasData = (retentionData?.labels?.length) ||
                        (ediscoveryData?.cases?.length) ||
                        (sensitivityData?.labels?.length) ||
                        (accessReviewData?.definitions?.length);

        if (!hasData) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-title">No Compliance Data</div>
                    <div class="empty-state-description">
                        No compliance data found. This requires E5/E5 Compliance licenses.<br>
                        Run data collection to populate retention, eDiscovery, sensitivity labels, and access reviews.
                    </div>
                </div>
            `;
            return;
        }

        state = {
            retentionData: retentionData,
            ediscoveryData: ediscoveryData,
            sensitivityData: sensitivityData,
            accessReviewData: accessReviewData,
            insights: [
                ...(retentionData?.insights || []),
                ...(ediscoveryData?.insights || []),
                ...(sensitivityData?.insights || []),
                ...(accessReviewData?.insights || [])
            ]
        };

        const retentionSummary = retentionData?.summary || {};
        const ediscoverySummary = ediscoveryData?.summary || {};
        const sensitivitySummary = sensitivityData?.summary || {};
        const accessReviewSummary = accessReviewData?.summary || {};

        let html = `
            <div class="page-header">
                <h2 class="page-title">Compliance &amp; Data Governance</h2>
                <p class="page-description">Retention, eDiscovery, Information Protection, and Access Reviews</p>
            </div>
        `;

        html += '<div class="summary-cards">';
        html += '<div class="summary-card card-info"><div class="summary-value">' + (retentionSummary.totalLabels || 0) + '</div><div class="summary-label">Retention Labels</div></div>';
        html += '<div class="summary-card' + ((ediscoverySummary.activeCases || 0) > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + (ediscoverySummary.activeCases || 0) + '</div><div class="summary-label">Active eDiscovery Cases</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + (sensitivitySummary.totalLabels || 0) + '</div><div class="summary-label">Sensitivity Labels</div></div>';
        html += '<div class="summary-card' + ((accessReviewSummary.overdueInstances || 0) > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + (accessReviewSummary.overdueInstances || 0) + '</div><div class="summary-label">Overdue Reviews</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="retention">Retention</button>';
        html += '<button class="tab-btn" data-tab="sensitivity">Sensitivity Labels</button>';
        html += '<button class="tab-btn" data-tab="ediscovery">eDiscovery</button>';
        html += '<button class="tab-btn" data-tab="access-reviews">Access Reviews</button>';
        html += '</div>';

        html += '<div class="content-area" id="compliance-content"></div>';
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

        currentTab = 'retention';
        renderTabContent();
    }

    function renderTabContent() {
        const container = document.getElementById('compliance-content');
        if (!container) return;

        if (currentTab === 'retention') {
            container.innerHTML = renderRetentionTab(state.retentionData);
        } else if (currentTab === 'sensitivity') {
            container.innerHTML = renderSensitivityTab(state.sensitivityData);
        } else if (currentTab === 'ediscovery') {
            container.innerHTML = renderEdiscoveryTab(state.ediscoveryData);
        } else if (currentTab === 'access-reviews') {
            container.innerHTML = renderAccessReviewsTab(state.accessReviewData);
        }
    }

    function renderOverview(container) {
        const retentionSummary = state.retentionData?.summary || {};
        const ediscoverySummary = state.ediscoveryData?.summary || {};
        const sensitivitySummary = state.sensitivityData?.summary || {};
        const accessReviewSummary = state.accessReviewData?.summary || {};

        let html = '<div class="analytics-grid">';

        html += '<div class="analytics-card">';
        html += '<h3>Retention Coverage</h3>';
        html += '<div class="score-categories">';
        html += '<div class="category-item"><span class="category-label">Total Labels</span><span class="category-score">' + (retentionSummary.totalLabels || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Record Labels</span><span class="category-score">' + (retentionSummary.recordLabels || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Regulatory Labels</span><span class="category-score">' + (retentionSummary.regulatoryLabels || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Event-Based</span><span class="category-score">' + (retentionSummary.eventBasedLabels || 0) + '</span></div>';
        html += '</div></div>';

        html += '<div class="analytics-card">';
        html += '<h3>Sensitivity Coverage</h3>';
        html += '<div class="score-categories">';
        html += '<div class="category-item"><span class="category-label">Total Labels</span><span class="category-score">' + (sensitivitySummary.totalLabels || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Encryption</span><span class="category-score">' + (sensitivitySummary.encryptionLabels || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Auto-Labeling</span><span class="category-score">' + (sensitivitySummary.autoLabelingLabels || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Container Labels</span><span class="category-score">' + (sensitivitySummary.containerLabels || 0) + '</span></div>';
        html += '</div></div>';

        html += '<div class="analytics-card">';
        html += '<h3>eDiscovery Activity</h3>';
        html += '<div class="score-categories">';
        html += '<div class="category-item"><span class="category-label">Total Cases</span><span class="category-score">' + (ediscoverySummary.totalCases || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Active Cases</span><span class="category-score">' + (ediscoverySummary.activeCases || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Total Holds</span><span class="category-score">' + (ediscoverySummary.totalHolds || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Total Custodians</span><span class="category-score">' + (ediscoverySummary.totalCustodians || 0) + '</span></div>';
        html += '</div></div>';

        html += '<div class="analytics-card">';
        html += '<h3>Access Reviews</h3>';
        html += '<div class="score-categories">';
        html += '<div class="category-item"><span class="category-label">Definitions</span><span class="category-score">' + (accessReviewSummary.totalDefinitions || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Active Reviews</span><span class="category-score">' + (accessReviewSummary.activeReviews || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Overdue Instances</span><span class="category-score">' + (accessReviewSummary.overdueInstances || 0) + '</span></div>';
        html += '<div class="category-item"><span class="category-label">Recurring Reviews</span><span class="category-score">' + (accessReviewSummary.recurringReviews || 0) + '</span></div>';
        html += '</div></div>';

        html += '</div>';

        if (state.insights.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Compliance Insights</h3>';
            html += '<div class="insights-list">';
            state.insights.slice(0, 6).forEach(insight => {
                const cls = insightClass(insight.severity);
                html += '<div class="insight-card ' + cls + '">';
                html += '<div class="insight-header"><strong>' + escapeHtml(insight.title || 'Insight') + '</strong></div>';
                html += '<p class="insight-description">' + escapeHtml(insight.description || '') + '</p>';
                if (insight.recommendedAction) {
                    html += '<p class="insight-action"><strong>Action:</strong> ' + escapeHtml(insight.recommendedAction) + '</p>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    function renderRetentionTab(data) {
        const labels = data?.labels || [];
        const summary = data?.summary || {};

        if (!labels.length) {
            return '<div class="empty-state"><p>No retention labels configured</p></div>';
        }

        return `
            <div class="section-stats">
                <span class="stat">Record Labels: <strong>${summary.recordLabels || 0}</strong></span>
                <span class="stat">Regulatory: <strong>${summary.regulatoryLabels || 0}</strong></span>
                <span class="stat">Event-Based: <strong>${summary.eventBasedLabels || 0}</strong></span>
                <span class="stat">Avg Retention: <strong>${summary.avgRetentionDays || 0} days</strong></span>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Label Name</th>
                            <th>Type</th>
                            <th>Retention</th>
                            <th>Action After</th>
                            <th>In Use</th>
                            <th>Flags</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${labels.map(label => `
                            <tr>
                                <td><strong>${escapeHtml(label.displayName)}</strong></td>
                                <td><span class="badge ${label.isRegulatoryRecord ? 'badge-critical' : label.isRecordLabel ? 'badge-warning' : 'badge-info'}">${escapeHtml(label.labelType)}</span></td>
                                <td>${label.isUnlimited ? 'Unlimited' : (label.retentionYears ? label.retentionYears + ' years' : (label.retentionDays ? label.retentionDays + ' days' : '--'))}</td>
                                <td>${escapeHtml(label.actionAfterRetention || '--')}</td>
                                <td>${label.isInUse ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
                                <td>${(label.flags || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join(' ')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderSensitivityTab(data) {
        const labels = data?.labels || [];
        const summary = data?.summary || {};

        if (!labels.length) {
            return '<div class="empty-state"><p>No sensitivity labels configured</p></div>';
        }

        return `
            <div class="section-stats">
                <span class="stat">Encryption Labels: <strong>${summary.encryptionLabels || 0}</strong></span>
                <span class="stat">Auto-Labeling: <strong>${summary.autoLabelingLabels || 0}</strong></span>
                <span class="stat">Container Labels: <strong>${summary.containerLabels || 0}</strong></span>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Label Name</th>
                            <th>Protection Tier</th>
                            <th>Encryption</th>
                            <th>Marking</th>
                            <th>Scope</th>
                            <th>Flags</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${labels.map(label => `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(label.displayName)}</strong>
                                    ${label.color ? `<span class="color-dot" style="background:${escapeHtml(label.color)}"></span>` : ''}
                                </td>
                                <td><span class="badge ${label.protectionTier === 'highlyConfidential' ? 'badge-critical' : label.protectionTier === 'confidential' ? 'badge-warning' : 'badge-info'}">${escapeHtml(label.protectionTier)}</span></td>
                                <td>${label.hasEncryption ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
                                <td>${label.hasMarking ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
                                <td>${[label.isFileLabel && 'Files', label.isEmailLabel && 'Email', label.isSiteLabel && 'Sites'].filter(Boolean).join(', ') || '--'}</td>
                                <td>${(label.flags || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join(' ')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderEdiscoveryTab(data) {
        const cases = data?.cases || [];
        const summary = data?.summary || {};

        if (!cases.length) {
            return '<div class="empty-state"><p>No eDiscovery cases found</p></div>';
        }

        return `
            <div class="section-stats">
                <span class="stat">Active Cases: <strong>${summary.activeCases || 0}</strong></span>
                <span class="stat">Total Holds: <strong>${summary.totalHolds || 0}</strong></span>
                <span class="stat">Total Custodians: <strong>${summary.totalCustodians || 0}</strong></span>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Case Name</th>
                            <th>Status</th>
                            <th>Custodians</th>
                            <th>Legal Holds</th>
                            <th>Created</th>
                            <th>Flags</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cases.map(c => `
                            <tr class="${c.status === 'active' ? 'row-highlight' : ''}">
                                <td><strong>${escapeHtml(c.displayName)}</strong></td>
                                <td><span class="badge ${c.status === 'active' ? 'badge-warning' : 'badge-neutral'}">${escapeHtml(c.status)}</span></td>
                                <td>${c.custodianCount || 0}</td>
                                <td>${c.holdCount || 0}</td>
                                <td>${formatDate(c.createdDateTime)}</td>
                                <td>${(c.flags || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join(' ')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderAccessReviewsTab(data) {
        const definitions = data?.definitions || [];
        const summary = data?.summary || {};

        if (!definitions.length) {
            return '<div class="empty-state"><p>No access reviews found</p></div>';
        }

        return `
            <div class="section-stats">
                <span class="stat">Definitions: <strong>${summary.totalDefinitions || 0}</strong></span>
                <span class="stat">Active Reviews: <strong>${summary.activeReviews || 0}</strong></span>
                <span class="stat">Overdue Instances: <strong>${summary.overdueInstances || 0}</strong></span>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Review Name</th>
                            <th>Scope</th>
                            <th>Recurrence</th>
                            <th>Status</th>
                            <th>Instances</th>
                            <th>Flags</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${definitions.map(def => `
                            <tr class="${def.overdueInstanceCount > 0 ? 'row-warning' : ''}">
                                <td>
                                    <strong>${escapeHtml(def.displayName)}</strong>
                                    <small>${escapeHtml(def.description || '')}</small>
                                </td>
                                <td>${escapeHtml(def.scopeName || def.scopeType || '--')}</td>
                                <td>${def.isRecurring ? escapeHtml(def.recurrencePattern || 'recurring') : 'one-time'}</td>
                                <td>${def.overdueInstanceCount > 0 ? '<span class="badge badge-warning">Overdue</span>' : (def.inProgressInstanceCount > 0 ? '<span class="badge badge-info">In Progress</span>' : '<span class="badge badge-success">On Track</span>')}</td>
                                <td>${def.instanceCount || 0}</td>
                                <td>${(def.flags || []).map(f => `<span class="tag">${escapeHtml(f)}</span>`).join(' ')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function insightClass(severity) {
        if (severity === 'critical') return 'insight-critical';
        if (severity === 'high') return 'insight-high';
        if (severity === 'warning') return 'insight-warning';
        if (severity === 'info') return 'insight-info';
        return 'insight-info';
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        try {
            return new Date(dateStr).toLocaleDateString('en-GB', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
        } catch { return '--'; }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    return { render };
})();

window.PageCompliance = PageCompliance;
