/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: OVERVIEW
 *
 * Renders the overview dashboard with unified analytics pattern: donut chart,
 * analytics grid, insights section, and quick stats.
 */

const PageOverview = (function() {
    'use strict';

    var C = DashboardCharts.colors;

    /** Current tab */
    var currentTab = 'overview';

    /** Cached page state */
    var overviewState = null;

    /** Aggregated security signals */
    var securitySignals = null;

    /**
     * Creates an element with className and textContent.
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = el('div', 'analytics-card');
        card.appendChild(el('h4', null, title));
        var list = el('div', 'platform-list');
        rows.forEach(function(row) {
            var rowDiv = el('div', 'platform-row');
            rowDiv.appendChild(el('span', 'platform-name', row.name));
            rowDiv.appendChild(el('span', 'platform-policies', String(row.count)));
            var miniBar = el('div', 'mini-bar');
            var fill = el('div', 'mini-bar-fill ' + row.cls);
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            rowDiv.appendChild(el('span', 'platform-rate', row.showPct ? (row.pct + '%') : String(row.count)));
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action, navigateTo) {
        var card = el('div', 'insight-card insight-' + type);
        if (navigateTo) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', function() {
                window.location.hash = navigateTo;
            });
        }
        var header = el('div', 'insight-header');
        header.appendChild(el('span', 'badge badge-' + type, badge));
        header.appendChild(el('span', 'insight-category', category));
        card.appendChild(header);
        card.appendChild(el('p', 'insight-description', description));
        if (action) {
            var actionP = el('p', 'insight-action');
            actionP.appendChild(el('strong', null, 'Action: '));
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    function showAdminDetails(titleText, rows) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        title.textContent = titleText;
        body.textContent = '';

        var list = el('div', 'detail-list');
        rows.forEach(function(row) {
            var label = el('span', 'detail-label', row[0] + ':');
            var value = el('span', 'detail-value', row[1] !== null && row[1] !== undefined && row[1] !== '' ? row[1] : '--');
            list.appendChild(label);
            list.appendChild(value);
        });

        body.appendChild(list);
        modal.classList.add('visible');
    }

    /**
     * Switches to a different tab.
     */
    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    /**
     * Renders the content for the current tab.
     */
    function renderContent() {
        var container = document.getElementById('overview-content');
        if (!container || !overviewState) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'cockpit':
                renderCockpitTab(container);
                break;
            case 'stats':
                renderStatsTab(container);
                break;
            case 'agents':
                renderAgentsTab(container);
                break;
            case 'executive':
                renderExecutiveTab(container);
                break;
        }
    }

    /**
     * Aggregates security signals from all data sources.
     */
    function aggregateSecuritySignals() {
        var signals = {
            criticalCount: 0,
            warningCount: 0,
            infoCount: 0,
            actionItems: [],
            riskScore: 100,
            categories: {}
        };

        // Identity Risk signals
        var identityRisk = DataLoader.getData('identityRisk');
        if (identityRisk && identityRisk.summary) {
            var ir = identityRisk.summary;
            if (ir.confirmedCompromised > 0) {
                signals.criticalCount += ir.confirmedCompromised;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Identity',
                    title: ir.confirmedCompromised + ' Confirmed Compromised Account' + (ir.confirmedCompromised > 1 ? 's' : ''),
                    action: 'Revoke sessions, reset passwords, investigate access',
                    navigateTo: 'identity-risk'
                });
                signals.riskScore -= 20;
            }
            if (ir.highRiskUsers > 0) {
                signals.criticalCount += ir.highRiskUsers;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Identity',
                    title: ir.highRiskUsers + ' High-Risk User' + (ir.highRiskUsers > 1 ? 's' : ''),
                    action: 'Review and remediate high-risk accounts',
                    navigateTo: 'identity-risk'
                });
                signals.riskScore -= 10;
            }
            if (ir.mediumRiskUsers > 0) {
                signals.warningCount += ir.mediumRiskUsers;
                signals.riskScore -= 5;
            }
            signals.categories['Identity Risk'] = {
                score: Math.max(0, 100 - (ir.highRiskUsers * 15) - (ir.mediumRiskUsers * 5)),
                count: ir.totalRiskyUsers || 0,
                severity: ir.confirmedCompromised > 0 ? 'critical' : ir.highRiskUsers > 0 ? 'warning' : 'success'
            };
        }

        // OAuth Consent signals
        var oauth = DataLoader.getData('oauthConsentGrants');
        if (oauth && oauth.summary) {
            var oa = oauth.summary;
            if (oa.highRiskGrants > 0) {
                signals.criticalCount += oa.highRiskGrants;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Apps',
                    title: oa.highRiskGrants + ' High-Risk OAuth Grant' + (oa.highRiskGrants > 1 ? 's' : ''),
                    action: 'Review and revoke suspicious app permissions',
                    navigateTo: 'oauth-consent'
                });
                signals.riskScore -= 10;
            }
            if (oa.unverifiedPublisherGrants > 0) {
                signals.warningCount += oa.unverifiedPublisherGrants;
                signals.actionItems.push({
                    severity: 'warning',
                    category: 'Apps',
                    title: oa.unverifiedPublisherGrants + ' Unverified Publisher App' + (oa.unverifiedPublisherGrants > 1 ? 's' : ''),
                    action: 'Verify legitimacy of apps from unverified publishers',
                    navigateTo: 'oauth-consent'
                });
                signals.riskScore -= 5;
            }
            signals.categories['OAuth Apps'] = {
                score: Math.max(0, 100 - (oa.highRiskGrants * 15) - (oa.unverifiedPublisherGrants * 5)),
                count: oa.totalGrants || 0,
                severity: oa.highRiskGrants > 0 ? 'critical' : oa.unverifiedPublisherGrants > 0 ? 'warning' : 'success'
            };
        }

        // Access Review signals
        var accessReviews = DataLoader.getData('accessReviews');
        if (accessReviews && accessReviews.summary) {
            var ar = accessReviews.summary;
            if (ar.overdueInstances > 0) {
                signals.criticalCount += ar.overdueInstances;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Governance',
                    title: ar.overdueInstances + ' Overdue Access Review' + (ar.overdueInstances > 1 ? 's' : ''),
                    action: 'Complete overdue reviews to maintain compliance',
                    navigateTo: 'compliance'
                });
                signals.riskScore -= 10;
            }
            signals.categories['Access Reviews'] = {
                score: ar.overdueInstances > 0 ? Math.max(0, 100 - (ar.overdueInstances * 20)) : 100,
                count: ar.totalDefinitions || 0,
                severity: ar.overdueInstances > 0 ? 'critical' : 'success'
            };
        }

        // MFA signals
        var summary = overviewState.summary;
        if (summary.mfaPct < 90) {
            var mfaGap = 100 - summary.mfaPct;
            if (mfaGap > 30) {
                signals.criticalCount++;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Identity',
                    title: summary.noMfaUsers + ' Users Without MFA (' + mfaGap + '%)',
                    action: 'Enable MFA for all users immediately',
                    navigateTo: 'security'
                });
                signals.riskScore -= 15;
            } else if (mfaGap > 10) {
                signals.warningCount++;
                signals.actionItems.push({
                    severity: 'warning',
                    category: 'Identity',
                    title: summary.noMfaUsers + ' Users Without MFA (' + mfaGap + '%)',
                    action: 'Enable MFA to improve security posture',
                    navigateTo: 'security'
                });
                signals.riskScore -= 5;
            }
        }
        signals.categories['MFA Coverage'] = {
            score: summary.mfaPct,
            count: summary.mfaRegisteredCount || 0,
            severity: summary.mfaPct >= 90 ? 'success' : summary.mfaPct >= 70 ? 'warning' : 'critical'
        };

        // Device Compliance signals
        if (summary.compliancePct < 80) {
            var compGap = 100 - summary.compliancePct;
            if (compGap > 40) {
                signals.criticalCount++;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Devices',
                    title: summary.nonCompliantDevices + ' Non-Compliant Devices (' + compGap + '%)',
                    action: 'Review and remediate non-compliant devices',
                    navigateTo: 'devices'
                });
                signals.riskScore -= 10;
            } else {
                signals.warningCount++;
                signals.actionItems.push({
                    severity: 'warning',
                    category: 'Devices',
                    title: summary.nonCompliantDevices + ' Non-Compliant Devices',
                    action: 'Review device compliance policies',
                    navigateTo: 'devices'
                });
                signals.riskScore -= 5;
            }
        }
        signals.categories['Device Compliance'] = {
            score: summary.compliancePct,
            count: summary.compliantDevices || 0,
            severity: summary.compliancePct >= 90 ? 'success' : summary.compliancePct >= 70 ? 'warning' : 'critical'
        };

        // Defender Alerts signals
        if (summary.activeAlerts > 0) {
            signals.criticalCount += summary.activeAlerts;
            signals.actionItems.push({
                severity: 'critical',
                category: 'Security',
                title: summary.activeAlerts + ' Active Security Alert' + (summary.activeAlerts > 1 ? 's' : ''),
                action: 'Investigate and resolve security alerts',
                navigateTo: 'security'
            });
            signals.riskScore -= Math.min(20, summary.activeAlerts * 5);
        }
        signals.categories['Security Alerts'] = {
            score: summary.activeAlerts === 0 ? 100 : Math.max(0, 100 - summary.activeAlerts * 20),
            count: summary.activeAlerts,
            severity: summary.activeAlerts > 0 ? 'critical' : 'success'
        };

        // Credential Expiry signals
        var secrets = DataLoader.getData('servicePrincipalSecrets');
        if (secrets && secrets.length > 0) {
            var expiringSoon = secrets.filter(function(s) { return s.daysUntilExpiry <= 30 && s.daysUntilExpiry > 0; }).length;
            var expired = secrets.filter(function(s) { return s.daysUntilExpiry <= 0; }).length;
            if (expired > 0) {
                signals.criticalCount += expired;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Apps',
                    title: expired + ' Expired App Credential' + (expired > 1 ? 's' : ''),
                    action: 'Rotate expired credentials immediately',
                    navigateTo: 'credential-expiry'
                });
                signals.riskScore -= 10;
            }
            if (expiringSoon > 0) {
                signals.warningCount += expiringSoon;
                signals.actionItems.push({
                    severity: 'warning',
                    category: 'Apps',
                    title: expiringSoon + ' Credential' + (expiringSoon > 1 ? 's' : '') + ' Expiring Within 30 Days',
                    action: 'Plan credential rotation before expiry',
                    navigateTo: 'credential-expiry'
                });
            }
        }

        // Secure Score
        var secureScore = overviewState.secureScore;
        if (secureScore && secureScore.scorePct < 50) {
            signals.warningCount++;
            signals.actionItems.push({
                severity: 'warning',
                category: 'Security',
                title: 'Secure Score: ' + secureScore.scorePct + '%',
                action: 'Implement recommended security improvements',
                navigateTo: 'security'
            });
        }
        if (secureScore) {
            signals.categories['Secure Score'] = {
                score: secureScore.scorePct,
                count: secureScore.currentScore || 0,
                severity: secureScore.scorePct >= 70 ? 'success' : secureScore.scorePct >= 40 ? 'warning' : 'critical'
            };
        }

        // License waste
        var licenseStats = overviewState.licenseStats;
        if (licenseStats && licenseStats.totalWaste > 10) {
            signals.infoCount++;
            signals.actionItems.push({
                severity: 'info',
                category: 'Cost',
                title: licenseStats.totalWaste + ' Wasted Licenses',
                action: 'Review and reclaim unused licenses',
                navigateTo: 'license-analysis'
            });
        }

        // Vulnerabilities signals
        var vulns = DataLoader.getData('vulnerabilities');
        if (vulns && vulns.summary) {
            var vs = vulns.summary;
            var exploited = vs.exploitedInWild || 0;
            var critical = vs.criticalCount || 0;
            var high = vs.highCount || 0;

            if (exploited > 0) {
                signals.criticalCount += exploited;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Vulnerabilities',
                    title: exploited + ' Actively Exploited CVE' + (exploited > 1 ? 's' : ''),
                    action: 'Prioritize patching exploited vulnerabilities',
                    navigateTo: 'vulnerabilities'
                });
                signals.riskScore -= Math.min(20, exploited * 5);
            }
            if (critical > 0) {
                signals.criticalCount += critical;
                signals.actionItems.push({
                    severity: 'critical',
                    category: 'Vulnerabilities',
                    title: critical + ' Critical Severity CVE' + (critical > 1 ? 's' : ''),
                    action: 'Apply critical security patches',
                    navigateTo: 'vulnerabilities'
                });
                signals.riskScore -= Math.min(15, critical * 5);
            }
            if (high > 0) {
                signals.warningCount += high;
            }

            signals.categories['Vulnerabilities'] = {
                score: Math.max(0, 100 - (exploited * 10) - (critical * 8) - (high * 3)),
                count: vs.totalVulnerabilities || 0,
                severity: exploited > 0 ? 'critical' : critical > 0 ? 'critical' : high > 0 ? 'warning' : 'success'
            };
        }

        // Ensure risk score is within bounds
        signals.riskScore = Math.max(0, Math.min(100, signals.riskScore));

        // Sort action items by severity
        var severityOrder = { critical: 0, warning: 1, info: 2 };
        signals.actionItems.sort(function(a, b) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        });

        return signals;
    }

    /**
     * Renders the Security Cockpit tab.
     */
    function renderCockpitTab(container) {
        container.textContent = '';

        // Aggregate all security signals
        securitySignals = aggregateSecuritySignals();
        var signals = securitySignals;

        // Risk Score Header
        var riskHeader = el('div', 'cockpit-risk-header');
        var riskScoreClass = signals.riskScore >= 80 ? 'success' : signals.riskScore >= 60 ? 'warning' : 'critical';

        var riskGauge = el('div', 'risk-gauge');
        var gaugeCircle = el('div', 'gauge-circle gauge-' + riskScoreClass);
        gaugeCircle.appendChild(el('span', 'gauge-value', signals.riskScore));
        gaugeCircle.appendChild(el('span', 'gauge-label', 'Risk Score'));
        riskGauge.appendChild(gaugeCircle);
        riskHeader.appendChild(riskGauge);

        var riskSummary = el('div', 'risk-summary');
        riskSummary.appendChild(el('h3', null, 'Security Posture'));
        var summaryText = signals.riskScore >= 80 ? 'Your tenant security posture is strong.' :
                          signals.riskScore >= 60 ? 'Some security concerns require attention.' :
                          'Critical security issues need immediate action.';
        riskSummary.appendChild(el('p', null, summaryText));

        var signalCounts = el('div', 'signal-counts');
        if (signals.criticalCount > 0) {
            var critBadge = el('span', 'signal-badge signal-critical');
            critBadge.appendChild(el('strong', null, signals.criticalCount));
            critBadge.appendChild(document.createTextNode(' Critical'));
            signalCounts.appendChild(critBadge);
        }
        if (signals.warningCount > 0) {
            var warnBadge = el('span', 'signal-badge signal-warning');
            warnBadge.appendChild(el('strong', null, signals.warningCount));
            warnBadge.appendChild(document.createTextNode(' Warning'));
            signalCounts.appendChild(warnBadge);
        }
        if (signals.infoCount > 0) {
            var infoBadge = el('span', 'signal-badge signal-info');
            infoBadge.appendChild(el('strong', null, signals.infoCount));
            infoBadge.appendChild(document.createTextNode(' Info'));
            signalCounts.appendChild(infoBadge);
        }
        if (signals.criticalCount === 0 && signals.warningCount === 0) {
            var okBadge = el('span', 'signal-badge signal-success');
            okBadge.textContent = 'All Clear';
            signalCounts.appendChild(okBadge);
        }
        riskSummary.appendChild(signalCounts);
        riskHeader.appendChild(riskSummary);
        container.appendChild(riskHeader);

        // Category Cards
        var categoryGrid = el('div', 'cockpit-category-grid');
        Object.keys(signals.categories).forEach(function(catName) {
            var cat = signals.categories[catName];
            var card = el('div', 'cockpit-category-card cockpit-card-' + cat.severity);
            card.appendChild(el('div', 'category-score', cat.score + '%'));
            card.appendChild(el('div', 'category-name', catName));
            categoryGrid.appendChild(card);
        });
        container.appendChild(categoryGrid);

        // Action Items Section
        if (signals.actionItems.length > 0) {
            var actionsSection = el('div', 'cockpit-actions-section');
            actionsSection.appendChild(el('h3', null, 'Action Required (' + signals.actionItems.length + ')'));

            var actionsList = el('div', 'cockpit-actions-list');
            signals.actionItems.forEach(function(item) {
                var actionCard = el('div', 'cockpit-action-card action-' + item.severity);
                if (item.navigateTo) {
                    actionCard.style.cursor = 'pointer';
                    actionCard.addEventListener('click', function() {
                        window.location.hash = item.navigateTo;
                    });
                }

                var actionHeader = el('div', 'action-header');
                actionHeader.appendChild(el('span', 'action-badge badge-' + item.severity, item.category));
                actionHeader.appendChild(el('span', 'action-title', item.title));
                actionCard.appendChild(actionHeader);

                if (item.action) {
                    var actionText = el('p', 'action-text');
                    actionText.appendChild(el('strong', null, 'Action: '));
                    actionText.appendChild(document.createTextNode(item.action));
                    actionCard.appendChild(actionText);
                }

                actionsList.appendChild(actionCard);
            });
            actionsSection.appendChild(actionsList);
            container.appendChild(actionsSection);
        } else {
            var noActions = el('div', 'cockpit-no-actions');
            noActions.appendChild(el('div', 'no-actions-icon', '\u2713'));
            noActions.appendChild(el('h3', null, 'All Clear'));
            noActions.appendChild(el('p', null, 'No critical security issues detected. Keep up the good work!'));
            container.appendChild(noActions);
        }

        // Quick Links
        var quickLinks = el('div', 'cockpit-quick-links');
        quickLinks.appendChild(el('h4', null, 'Quick Navigation'));
        var linksGrid = el('div', 'quick-links-grid');
        var links = [
            { label: 'Identity Risk', icon: '\u26A0', page: 'identity-risk' },
            { label: 'OAuth Apps', icon: '\uD83D\uDD10', page: 'oauth-consent' },
            { label: 'Devices', icon: '\uD83D\uDCBB', page: 'devices' },
            { label: 'Compliance', icon: '\uD83D\uDCCB', page: 'compliance' },
            { label: 'Licenses', icon: '\uD83D\uDCB3', page: 'license-analysis' },
            { label: 'Data Quality', icon: '\uD83D\uDCCA', page: 'data-quality' }
        ];
        links.forEach(function(link) {
            var linkBtn = el('button', 'quick-link-btn');
            linkBtn.appendChild(el('span', 'quick-link-icon', link.icon));
            linkBtn.appendChild(el('span', 'quick-link-label', link.label));
            linkBtn.addEventListener('click', function() {
                window.location.hash = link.page;
            });
            linksGrid.appendChild(linkBtn);
        });
        quickLinks.appendChild(linksGrid);
        container.appendChild(quickLinks);
    }

    /**
     * Renders the Overview tab with analytics.
     */
    function renderOverviewTab(container) {
        container.textContent = '';
        var s = overviewState.summary;

        // Calculate tenant health score (composite)
        var healthScore = Math.round((s.mfaPct + s.compliancePct + (s.activeAlerts === 0 ? 100 : Math.max(0, 100 - s.activeAlerts * 10))) / 3);
        var healthyPct = healthScore;
        var issuesPct = 100 - healthScore;

        // Build analytics section with donut chart
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Tenant Health Overview'));

        var complianceOverview = el('div', 'compliance-overview');

        // Donut chart
        var chartContainer = el('div', 'compliance-chart');
        var donutDiv = el('div', 'donut-chart');

        var circumference = 2 * Math.PI * 40;
        var healthyDash = (healthyPct / 100) * circumference;
        var issuesDash = (issuesPct / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        if (healthyPct > 0) {
            var healthyCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            healthyCircle.setAttribute('cx', '50');
            healthyCircle.setAttribute('cy', '50');
            healthyCircle.setAttribute('r', '40');
            healthyCircle.setAttribute('fill', 'none');
            healthyCircle.setAttribute('stroke', 'var(--color-success)');
            healthyCircle.setAttribute('stroke-width', '12');
            healthyCircle.setAttribute('stroke-dasharray', healthyDash + ' ' + circumference);
            healthyCircle.setAttribute('stroke-dashoffset', '0');
            healthyCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(healthyCircle);
        }
        if (issuesPct > 0) {
            var issuesCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            issuesCircle.setAttribute('cx', '50');
            issuesCircle.setAttribute('cy', '50');
            issuesCircle.setAttribute('r', '40');
            issuesCircle.setAttribute('fill', 'none');
            issuesCircle.setAttribute('stroke', healthScore >= 70 ? 'var(--color-warning)' : 'var(--color-critical)');
            issuesCircle.setAttribute('stroke-width', '12');
            issuesCircle.setAttribute('stroke-dasharray', issuesDash + ' ' + circumference);
            issuesCircle.setAttribute('stroke-dashoffset', String(-healthyDash));
            issuesCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(issuesCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = el('div', 'donut-center');
        donutCenter.appendChild(el('span', 'donut-value', healthScore + '%'));
        donutCenter.appendChild(el('span', 'donut-label', 'Health'));
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = el('div', 'compliance-legend');
        var issueClass = healthScore >= 70 ? 'bg-warning' : 'bg-critical';
        var legendItems = [
            { cls: 'bg-success', label: 'Healthy', value: healthyPct + '%' },
            { cls: issueClass, label: 'Issues', value: issuesPct + '%' }
        ];
        legendItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(el('span', 'legend-dot ' + item.cls));
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            legendItem.appendChild(el('strong', null, item.value));
            legend.appendChild(legendItem);
        });
        var metricItems = [
            { label: 'MFA Coverage', value: s.mfaPct + '%' },
            { label: 'Device Compliance', value: s.compliancePct + '%' },
            { label: 'Active Alerts', value: String(s.activeAlerts) },
            { label: 'Total Users', value: s.totalUsers.toLocaleString() }
        ];
        metricItems.forEach(function(item) {
            var legendItem = el('div', 'legend-item');
            legendItem.appendChild(document.createTextNode(item.label + ': '));
            legendItem.appendChild(el('strong', null, item.value));
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = el('div', 'analytics-grid');

        // Operational signals (not part of health donut)
        var signalCard = el('div', 'analytics-card');
        signalCard.appendChild(el('h4', null, 'Operational Signals'));
        var signalList = el('div', 'compliance-legend');
        var signalItems = [
            {
                cls: s.mfaPct >= 90 ? 'bg-success' : s.mfaPct >= 70 ? 'bg-warning' : 'bg-critical',
                label: 'MFA Coverage',
                value: s.mfaPct + '%'
            },
            {
                cls: s.compliancePct >= 90 ? 'bg-success' : s.compliancePct >= 70 ? 'bg-warning' : 'bg-critical',
                label: 'Device Compliance',
                value: s.compliancePct + '%'
            },
            {
                cls: s.activeAlerts > 0 ? 'bg-critical' : 'bg-success',
                label: 'Active Alerts',
                value: String(s.activeAlerts)
            },
            {
                cls: 'bg-neutral',
                label: 'Total Users',
                value: s.totalUsers.toLocaleString()
            }
        ];
        signalItems.forEach(function(item) {
            var row = el('div', 'legend-item');
            row.appendChild(el('span', 'legend-dot ' + item.cls));
            row.appendChild(document.createTextNode(' ' + item.label + ': '));
            row.appendChild(el('strong', null, item.value));
            signalList.appendChild(row);
        });
        signalCard.appendChild(signalList);
        analyticsGrid.appendChild(signalCard);

        // Users card
        var maxUsers = Math.max(s.employeeCount, s.studentCount, s.guestCount, 1);
        analyticsGrid.appendChild(createPlatformCard('User Composition', [
            { name: 'Employees', count: s.employeeCount, pct: Math.round((s.employeeCount / maxUsers) * 100), cls: 'bg-info', showPct: false },
            { name: 'Students', count: s.studentCount, pct: Math.round((s.studentCount / maxUsers) * 100), cls: 'bg-success', showPct: false },
            { name: 'Guests', count: s.guestCount, pct: Math.round((s.guestCount / maxUsers) * 100), cls: 'bg-purple', showPct: false },
            { name: 'Other', count: s.otherCount, pct: Math.round((s.otherCount / maxUsers) * 100), cls: 'bg-neutral', showPct: false }
        ]));

        // Security card
        analyticsGrid.appendChild(createPlatformCard('Security Status', [
            { name: 'MFA Enrolled', count: s.mfaRegisteredCount, pct: s.mfaPct, cls: 'bg-success', showPct: true },
            { name: 'Without MFA', count: s.noMfaUsers, pct: 100 - s.mfaPct, cls: 'bg-warning', showPct: true },
            { name: 'Active Alerts', count: s.activeAlerts, pct: Math.min(s.activeAlerts * 20, 100), cls: s.activeAlerts > 0 ? 'bg-critical' : 'bg-success', showPct: false }
        ]));

        // Devices card
        analyticsGrid.appendChild(createPlatformCard('Device Status', [
            { name: 'Compliant', count: s.compliantDevices, pct: s.compliancePct, cls: 'bg-success', showPct: true },
            { name: 'Non-Compliant', count: s.nonCompliantDevices, pct: s.totalDevices > 0 ? Math.round((s.nonCompliantDevices / s.totalDevices) * 100) : 0, cls: 'bg-critical', showPct: true },
            { name: 'Unknown', count: s.unknownDevices, pct: s.totalDevices > 0 ? Math.round((s.unknownDevices / s.totalDevices) * 100) : 0, cls: 'bg-neutral', showPct: true }
        ]));

        // Licenses card
        var licenseData = overviewState.licenseStats;
        analyticsGrid.appendChild(createPlatformCard('License Status', [
            { name: 'Total SKUs', count: licenseData.totalSkus, pct: 100, cls: 'bg-info', showPct: false },
            { name: 'Avg Utilization', count: licenseData.avgUtilization + '%', pct: licenseData.avgUtilization, cls: licenseData.avgUtilization >= 70 ? 'bg-success' : 'bg-warning', showPct: false },
            { name: 'Total Waste', count: licenseData.totalWaste, pct: licenseData.wastePct, cls: licenseData.totalWaste > 0 ? 'bg-critical' : 'bg-success', showPct: false }
        ]));

        container.appendChild(analyticsGrid);

        // Admin Center updates (Message Center + Service Health)
        var adminData = overviewState.serviceAnnouncements || {};
        var messageCenter = Array.isArray(adminData.messageCenter) ? adminData.messageCenter : [];
        var serviceHealth = Array.isArray(adminData.serviceHealth) ? adminData.serviceHealth : [];

        var adminGrid = el('div', 'activity-grid');

        var messagePanel = el('div', 'activity-panel');
        var messageTitle = el('div', 'activity-panel-title', 'Message Center');
        messagePanel.appendChild(messageTitle);

        var messageFilterBar = el('div', 'filter-bar');
        var msgSearchGroup = el('div', 'filter-group');
        msgSearchGroup.appendChild(el('label', 'filter-label', 'Search'));
        var msgSearch = document.createElement('input');
        msgSearch.type = 'text';
        msgSearch.className = 'filter-input';
        msgSearch.placeholder = 'Title, category, service';
        msgSearchGroup.appendChild(msgSearch);
        messageFilterBar.appendChild(msgSearchGroup);

        var msgSeverityGroup = el('div', 'filter-group');
        msgSeverityGroup.appendChild(el('label', 'filter-label', 'Severity'));
        var msgSeverity = document.createElement('select');
        msgSeverity.className = 'filter-select';
        ['all', 'high', 'medium', 'low', 'critical'].forEach(function(level) {
            var opt = document.createElement('option');
            opt.value = level;
            opt.textContent = level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1);
            msgSeverity.appendChild(opt);
        });
        msgSeverityGroup.appendChild(msgSeverity);
        messageFilterBar.appendChild(msgSeverityGroup);

        var msgActionGroup = el('div', 'filter-group');
        msgActionGroup.appendChild(el('label', 'filter-label', 'Action Required'));
        var msgActionWrap = el('div', 'filter-checkbox-group');
        var msgActionLabel = el('label', 'filter-checkbox');
        var msgAction = document.createElement('input');
        msgAction.type = 'checkbox';
        msgActionLabel.appendChild(msgAction);
        msgActionLabel.appendChild(document.createTextNode('Only show action required'));
        msgActionWrap.appendChild(msgActionLabel);
        msgActionGroup.appendChild(msgActionWrap);
        messageFilterBar.appendChild(msgActionGroup);

        messagePanel.appendChild(messageFilterBar);

        var messageTableWrap = el('div');
        messagePanel.appendChild(messageTableWrap);
        adminGrid.appendChild(messagePanel);

        var healthPanel = el('div', 'activity-panel');
        var healthTitle = el('div', 'activity-panel-title', 'Service Health');
        healthPanel.appendChild(healthTitle);

        var healthFilterBar = el('div', 'filter-bar');
        var healthSearchGroup = el('div', 'filter-group');
        healthSearchGroup.appendChild(el('label', 'filter-label', 'Search'));
        var healthSearch = document.createElement('input');
        healthSearch.type = 'text';
        healthSearch.className = 'filter-input';
        healthSearch.placeholder = 'Service or issue';
        healthSearchGroup.appendChild(healthSearch);
        healthFilterBar.appendChild(healthSearchGroup);

        var healthStatusGroup = el('div', 'filter-group');
        healthStatusGroup.appendChild(el('label', 'filter-label', 'Status'));
        var healthStatus = document.createElement('select');
        healthStatus.className = 'filter-select';
        var statusOptions = ['all'];
        serviceHealth.forEach(function(h) {
            if (h.status && statusOptions.indexOf(h.status) === -1) {
                statusOptions.push(h.status);
            }
        });
        statusOptions.forEach(function(level) {
            var opt = document.createElement('option');
            opt.value = level;
            opt.textContent = level === 'all' ? 'All' : level;
            healthStatus.appendChild(opt);
        });
        healthStatusGroup.appendChild(healthStatus);
        healthFilterBar.appendChild(healthStatusGroup);

        healthPanel.appendChild(healthFilterBar);

        var healthTableWrap = el('div');
        healthPanel.appendChild(healthTableWrap);
        adminGrid.appendChild(healthPanel);

        function applyMessageFilters(list) {
            var query = (msgSearch.value || '').toLowerCase().trim();
            var severity = (msgSeverity.value || 'all').toLowerCase();
            var actionOnly = msgAction.checked;

            return list.filter(function(item) {
                if (severity !== 'all' && (item.severity || '').toLowerCase() !== severity) {
                    return false;
                }
                if (actionOnly && !item.actionRequiredByDateTime) {
                    return false;
                }
                if (query) {
                    var servicesText = (item.services || []).join(' ').toLowerCase();
                    var titleText = (item.title || '').toLowerCase();
                    var categoryText = (item.category || '').toLowerCase();
                    if (titleText.indexOf(query) === -1 && categoryText.indexOf(query) === -1 && servicesText.indexOf(query) === -1) {
                        return false;
                    }
                }
                return true;
            });
        }

        function renderMessageTable() {
            messageTableWrap.textContent = '';
            var filtered = applyMessageFilters(messageCenter);
            messageTitle.textContent = 'Message Center (' + filtered.length + ')';

            if (filtered.length === 0) {
                var emptyMsg = el('div', 'text-muted', 'No message center items match filters');
                emptyMsg.style.fontSize = 'var(--font-size-xs)';
                messageTableWrap.appendChild(emptyMsg);
                return;
            }

            var messageTable = el('table', 'activity-table');
            var mHead = el('thead');
            var mHeadRow = el('tr');
            ['Message', 'Severity', 'Updated'].forEach(function(h) { mHeadRow.appendChild(el('th', null, h)); });
            mHead.appendChild(mHeadRow);
            messageTable.appendChild(mHead);

            var mBody = el('tbody');
            filtered.slice(0, 10).forEach(function(item) {
                var tr = el('tr');
                tr.style.cursor = 'pointer';
                tr.appendChild(el('td', null, item.title || '--'));
                tr.appendChild(el('td', null, item.severity || '--'));
                tr.appendChild(el('td', null, DataLoader.formatDate(item.lastModifiedDateTime)));
                tr.addEventListener('click', function() {
                    showAdminDetails(item.title || 'Message Center', [
                        ['Severity', item.severity || '--'],
                        ['Category', item.category || '--'],
                        ['Services', (item.services && item.services.length > 0) ? item.services.join(', ') : '--'],
                        ['Status', item.status || '--'],
                        ['Major Change', item.isMajorChange ? 'Yes' : 'No'],
                        ['Action Required By', DataLoader.formatDate(item.actionRequiredByDateTime)],
                        ['Start', DataLoader.formatDate(item.startDateTime)],
                        ['End', DataLoader.formatDate(item.endDateTime)],
                        ['Last Updated', DataLoader.formatDate(item.lastModifiedDateTime)],
                        ['Id', item.id || '--']
                    ]);
                });
                mBody.appendChild(tr);
            });
            messageTable.appendChild(mBody);
            messageTableWrap.appendChild(messageTable);
        }

        function flattenHealthIssues() {
            var rows = [];
            serviceHealth.forEach(function(h) {
                (h.issues || []).forEach(function(issue) {
                    rows.push({
                        service: h.service,
                        serviceStatus: h.status,
                        issue: issue
                    });
                });
            });
            return rows;
        }

        var healthIssues = flattenHealthIssues();

        function applyHealthFilters(list) {
            var query = (healthSearch.value || '').toLowerCase().trim();
            var status = (healthStatus.value || 'all').toLowerCase();
            return list.filter(function(item) {
                var serviceName = (item.service || '').toLowerCase();
                var issueTitle = (item.issue && item.issue.title ? item.issue.title : '').toLowerCase();
                var issueStatus = (item.issue && item.issue.status ? item.issue.status : (item.serviceStatus || '')).toLowerCase();

                if (status !== 'all' && issueStatus !== status) {
                    return false;
                }
                if (query && serviceName.indexOf(query) === -1 && issueTitle.indexOf(query) === -1) {
                    return false;
                }
                return true;
            });
        }

        function renderHealthTable() {
            healthTableWrap.textContent = '';
            var filtered = applyHealthFilters(healthIssues);
            healthTitle.textContent = 'Service Health (' + filtered.length + ')';

            if (filtered.length === 0) {
                var emptyHealth = el('div', 'text-muted', 'No service health issues match filters');
                emptyHealth.style.fontSize = 'var(--font-size-xs)';
                healthTableWrap.appendChild(emptyHealth);
                return;
            }

            var healthTable = el('table', 'activity-table');
            var hHead = el('thead');
            var hHeadRow = el('tr');
            ['Service', 'Issue', 'Status'].forEach(function(h) { hHeadRow.appendChild(el('th', null, h)); });
            hHead.appendChild(hHeadRow);
            healthTable.appendChild(hHead);

            var hBody = el('tbody');
            filtered.slice(0, 10).forEach(function(item) {
                var tr = el('tr');
                tr.style.cursor = 'pointer';
                tr.appendChild(el('td', null, item.service || '--'));
                tr.appendChild(el('td', null, (item.issue && item.issue.title) ? item.issue.title : '--'));
                tr.appendChild(el('td', null, (item.issue && item.issue.status) ? item.issue.status : (item.serviceStatus || '--')));
                tr.addEventListener('click', function() {
                    var issue = item.issue || {};
                    showAdminDetails((item.service || 'Service') + ' - ' + (issue.title || 'Issue'), [
                        ['Service', item.service || '--'],
                        ['Service Status', item.serviceStatus || '--'],
                        ['Issue Status', issue.status || '--'],
                        ['Classification', issue.classification || '--'],
                        ['Feature', issue.feature || '--'],
                        ['Impact', issue.impactDescription || '--'],
                        ['Start', DataLoader.formatDate(issue.startDateTime)],
                        ['End', DataLoader.formatDate(issue.endDateTime)],
                        ['Last Updated', DataLoader.formatDate(issue.lastModifiedDateTime)],
                        ['Id', issue.id || '--']
                    ]);
                });
                hBody.appendChild(tr);
            });
            healthTable.appendChild(hBody);
            healthTableWrap.appendChild(healthTable);
        }

        msgSearch.addEventListener('input', renderMessageTable);
        msgSeverity.addEventListener('change', renderMessageTable);
        msgAction.addEventListener('change', renderMessageTable);
        healthSearch.addEventListener('input', renderHealthTable);
        healthStatus.addEventListener('change', renderHealthTable);

        renderMessageTable();
        renderHealthTable();
        container.appendChild(adminGrid);

        // Insights section
        var insightsList = el('div', 'insights-list');

        // Generate insights based on data
        if (s.mfaPct < 90) {
            insightsList.appendChild(createInsightCard('warning', 'MFA', 'Security Gap',
                (100 - s.mfaPct) + '% of users (' + s.noMfaUsers + ') are not enrolled in MFA.',
                'Enable MFA for all users to prevent account compromise.', 'security'));
        }

        if (s.compliancePct < 80) {
            insightsList.appendChild(createInsightCard('warning', 'COMPLIANCE', 'Device Risk',
                s.nonCompliantDevices + ' devices (' + (100 - s.compliancePct) + '%) are non-compliant.',
                'Review and remediate non-compliant devices.', 'devices'));
        }

        if (s.activeAlerts > 0) {
            insightsList.appendChild(createInsightCard('critical', 'ALERTS', 'Active Threats',
                s.activeAlerts + ' security alert' + (s.activeAlerts !== 1 ? 's' : '') + ' require attention.',
                'Investigate and resolve active security alerts immediately.', 'security'));
        }

        if (s.serviceHealthActiveIssues > 0) {
            insightsList.appendChild(createInsightCard('warning', 'SERVICE', 'Service Health Issues',
                s.serviceHealthActiveIssues + ' active service health issue' + (s.serviceHealthActiveIssues !== 1 ? 's' : '') + ' reported by Microsoft 365.',
                'Review the Service Health dashboard for impact and updates.', null));
        }

        if (s.messageCenterActionRequired > 0) {
            insightsList.appendChild(createInsightCard('info', 'MESSAGE', 'Message Center Actions',
                s.messageCenterActionRequired + ' message' + (s.messageCenterActionRequired !== 1 ? 's require' : ' requires') + ' action in the Message Center.',
                'Review messages and complete required actions.', null));
        }

        if (licenseData.totalWaste > 0) {
            insightsList.appendChild(createInsightCard('info', 'COST', 'License Waste',
                licenseData.totalWaste + ' licenses are assigned to disabled or inactive users.',
                'Review license assignments to reduce costs.', 'licenses'));
        }

        // Secure Score insight
        var secureScore = overviewState.secureScore;
        if (secureScore && secureScore.scorePct < 70) {
            insightsList.appendChild(createInsightCard('info', 'SCORE', 'Secure Score',
                'Microsoft Secure Score is ' + secureScore.scorePct + '%. Consider implementing recommended actions.',
                'Review and complete improvement actions.', 'security'));
        }

        // Healthy state
        if (healthScore >= 90 && s.activeAlerts === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Tenant Health',
                'Your tenant is in good health with ' + healthScore + '% overall score.',
                null, null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Renders the Quick Stats tab.
     */
    function renderStatsTab(container) {
        container.textContent = '';

        // Donut charts row
        var chartsGrid = el('div', 'overview-charts-grid');
        var s = overviewState.summary;

        // Secure Score donut
        var secureScore = overviewState.secureScore;
        if (secureScore && secureScore.scorePct !== undefined) {
            var pct = secureScore.scorePct;
            var scoreColor = pct >= 70 ? C.green : (pct >= 40 ? C.yellow : C.red);
            var scoreSegments = [
                { value: pct, label: 'Achieved', color: scoreColor },
                { value: 100 - pct, label: 'Remaining', color: C.gray }
            ];
            var scoreCard = DashboardCharts.createChartCard(
                'Secure Score', scoreSegments,
                pct + '%', 'of 100'
            );

            if (secureScore.controlScores && secureScore.controlScores.length > 0) {
                var list = el('ul', 'secure-score-actions');
                var top3 = secureScore.controlScores.slice(0, 3);
                for (var i = 0; i < top3.length; i++) {
                    var li = el('li', null, top3[i].description);
                    list.appendChild(li);
                }
                scoreCard.appendChild(list);
            }
            chartsGrid.appendChild(scoreCard);
        }

        // User Composition donut
        var userSegments = [
            { value: s.employeeCount, label: 'Employees', color: C.blue },
            { value: s.studentCount, label: 'Students', color: C.teal },
            { value: s.guestCount, label: 'Guests', color: C.purple },
            { value: s.otherCount, label: 'Other', color: C.gray }
        ];
        chartsGrid.appendChild(DashboardCharts.createChartCard(
            'User Composition', userSegments,
            String(s.totalUsers), 'total users'
        ));

        // MFA Status donut
        var mfaSegments = [
            { value: s.mfaRegisteredCount, label: 'Enrolled', color: C.green },
            { value: s.noMfaUsers, label: 'Not Enrolled', color: C.red }
        ];
        chartsGrid.appendChild(DashboardCharts.createChartCard(
            'MFA Status', mfaSegments,
            s.mfaPct + '%', 'coverage'
        ));

        // Device Compliance donut
        var deviceSegments = [
            { value: s.compliantDevices, label: 'Compliant', color: C.green },
            { value: s.nonCompliantDevices, label: 'Non-Compliant', color: C.red },
            { value: s.unknownDevices, label: 'Unknown', color: C.gray }
        ];
        chartsGrid.appendChild(DashboardCharts.createChartCard(
            'Device Compliance', deviceSegments,
            s.compliancePct + '%', 'compliant'
        ));

        container.appendChild(chartsGrid);

        // License utilization section
        renderLicenseUtilization(container);

        // Recent activity section
        renderRecentActivity(container);
    }

    /**
     * Renders the license utilization section.
     */
    function renderLicenseUtilization(container) {
        var licenses = DataLoader.getData('licenseSkus');
        if (!licenses || licenses.length === 0) return;

        var sorted = licenses.slice().sort(function(a, b) {
            return (b.utilizationPercent || 0) - (a.utilizationPercent || 0);
        });

        var panel = el('div', 'license-grid');
        panel.appendChild(el('div', 'license-grid-title', 'License Utilization'));

        var summary = overviewState.summary;
        if (summary.totalWasteMonthlyCost > 0) {
            var costCallout = el('div', 'license-waste-callout');
            var sym = summary.currency === 'NOK' ? 'kr' : summary.currency === 'USD' ? '$' : '';
            costCallout.textContent = sym + ' ' + summary.totalWasteMonthlyCost.toLocaleString() + '/mo wasted';
            panel.appendChild(costCallout);
        }

        for (var i = 0; i < sorted.length; i++) {
            var sku = sorted[i];
            var pct = sku.utilizationPercent || 0;

            var row = el('div', 'license-row');

            var name = el('div', 'license-name', sku.skuName);
            name.title = sku.skuName;
            row.appendChild(name);

            var barWrap = el('div', 'license-bar');
            var bar = el('div', 'progress-bar');
            var fill = el('div', 'progress-fill');
            if (pct >= 80) fill.className += ' success';
            else if (pct >= 40) fill.className += ' warning';
            else fill.className += ' critical';
            fill.style.width = pct + '%';
            bar.appendChild(fill);
            barWrap.appendChild(bar);
            row.appendChild(barWrap);

            var stats = el('div', 'license-stats', sku.totalAssigned + ' / ' + sku.totalPurchased);
            var pctSpan = el('span', 'license-pct');
            if (pct >= 80) pctSpan.className += ' text-success';
            else if (pct >= 40) pctSpan.className += ' text-warning';
            else pctSpan.className += ' text-critical';
            pctSpan.textContent = pct + '%';
            stats.appendChild(pctSpan);
            row.appendChild(stats);

            panel.appendChild(row);
        }

        container.appendChild(panel);
    }

    /**
     * Renders the recent activity panels.
     */
    function renderRecentActivity(container) {
        var grid = el('div', 'activity-grid');

        // PIM Activity panel
        var pimData = DataLoader.getData('pimActivity');
        var requests = pimData.filter(function(e) { return e.entryType === 'request'; });
        var recentPim = requests.slice(0, 5);

        var pimPanel = el('div', 'activity-panel');
        pimPanel.appendChild(el('div', 'activity-panel-title', 'Recent PIM Activity'));

        if (recentPim.length > 0) {
            var pimTable = el('table', 'activity-table');
            var pimHead = el('thead');
            var pimHeadRow = el('tr');
            ['User', 'Role', 'Action', 'Status'].forEach(function(h) {
                pimHeadRow.appendChild(el('th', null, h));
            });
            pimHead.appendChild(pimHeadRow);
            pimTable.appendChild(pimHead);

            var pimBody = el('tbody');
            recentPim.forEach(function(entry) {
                var tr = el('tr');
                tr.appendChild(el('td', null, entry.principalDisplayName || '--'));
                tr.appendChild(el('td', null, entry.roleName || '--'));
                tr.appendChild(el('td', null, formatActionLabel(entry.action)));
                tr.appendChild(el('td', null, entry.status || '--'));
                pimBody.appendChild(tr);
            });
            pimTable.appendChild(pimBody);
            pimPanel.appendChild(pimTable);
        } else {
            var emptyPim = el('div', 'text-muted', 'No recent PIM activity');
            emptyPim.style.fontSize = 'var(--font-size-xs)';
            pimPanel.appendChild(emptyPim);
        }

        var pimLink = el('a', 'activity-link', 'View all PIM activity');
        pimLink.addEventListener('click', function() { window.location.hash = 'pim'; });
        pimPanel.appendChild(pimLink);
        grid.appendChild(pimPanel);

        // Security Alerts panel
        var alerts = DataLoader.getData('defenderAlerts');
        var recentAlerts = alerts.slice(0, 5);

        var alertPanel = el('div', 'activity-panel');
        alertPanel.appendChild(el('div', 'activity-panel-title', 'Recent Security Alerts'));

        if (recentAlerts.length > 0) {
            var alertTable = el('table', 'activity-table');
            var alertHead = el('thead');
            var alertHeadRow = el('tr');
            ['Title', 'Severity', 'Status'].forEach(function(h) {
                alertHeadRow.appendChild(el('th', null, h));
            });
            alertHead.appendChild(alertHeadRow);
            alertTable.appendChild(alertHead);

            var alertBody = el('tbody');
            recentAlerts.forEach(function(alert) {
                var tr = el('tr');
                tr.appendChild(el('td', null, alert.title || alert.alertDisplayName || '--'));
                tr.appendChild(el('td', null, alert.severity || '--'));
                tr.appendChild(el('td', null, alert.status || '--'));
                alertBody.appendChild(tr);
            });
            alertTable.appendChild(alertBody);
            alertPanel.appendChild(alertTable);
        } else {
            var emptyAlert = el('div', 'text-muted', 'No recent alerts');
            emptyAlert.style.fontSize = 'var(--font-size-xs)';
            alertPanel.appendChild(emptyAlert);
        }

        var alertLink = el('a', 'activity-link', 'View all security details');
        alertLink.addEventListener('click', function() { window.location.hash = 'security'; });
        alertPanel.appendChild(alertLink);
        grid.appendChild(alertPanel);

        container.appendChild(grid);
    }

    /**
     * Creates a summary card.
     */
    function createSummaryCard(label, value, valueClass, cardClass, navigateTo) {
        var card = el('div', 'card' + (cardClass ? ' ' + cardClass : ''));
        if (navigateTo) {
            card.dataset.navigate = navigateTo;
            card.style.cursor = 'pointer';
        }
        card.appendChild(el('div', 'card-label', label));
        card.appendChild(el('div', 'card-value' + (valueClass ? ' ' + valueClass : ''), String(value)));
        return card;
    }

    /**
     * Maps PIM action keys to readable labels.
     */
    function formatActionLabel(action) {
        var labels = {
            'selfActivate': 'Self Activate',
            'adminAssign': 'Admin Assign',
            'adminRemove': 'Admin Remove',
            'selfDeactivate': 'Self Deactivate',
            'selfExtend': 'Self Extend',
            'selfRenew': 'Self Renew',
            'adminExtend': 'Admin Extend',
            'adminRenew': 'Admin Renew'
        };
        return labels[action] || action || '--';
    }

    /**
     * Renders the Analysis Agents tab with quick-launch analysis perspectives.
     */
    function renderAgentsTab(container) {
        container.textContent = '';

        var html = '';

        // Header
        html += '<div class="analytics-section">';
        html += '<h3>Quick Navigation</h3>';
        html += '<p style="color:var(--color-text-muted);margin-bottom:var(--spacing-lg)">Jump directly to specialized analysis views. Each shortcut takes you to the relevant page for that focus area.</p>';
        html += '</div>';

        // Agent Cards Grid
        html += '<div class="agent-grid">';

        // Security View
        html += '<div class="agent-card agent-card--security" data-agent="security">';
        html += '<div class="agent-icon">\uD83D\uDEE1</div>';
        html += '<h4>Security View</h4>';
        html += '<p>Examine identity risks, conditional access gaps, MFA coverage, and threat detections.</p>';
        html += '<div class="agent-focus">Focus: Identity, Access, Threats</div>';
        html += '<button class="agent-btn" onclick="PageOverview.launchAgent(\'security\')">View</button>';
        html += '</div>';

        // Cost Optimization View
        html += '<div class="agent-card agent-card--cost" data-agent="cost">';
        html += '<div class="agent-icon">\uD83D\uDCB0</div>';
        html += '<h4>Cost Optimization</h4>';
        html += '<p>Find license waste, overlap opportunities, and potential savings across your tenant.</p>';
        html += '<div class="agent-focus">Focus: Licenses, Waste, Savings</div>';
        html += '<button class="agent-btn" onclick="PageOverview.launchAgent(\'cost\')">View</button>';
        html += '</div>';

        // Compliance View
        html += '<div class="agent-card agent-card--compliance" data-agent="compliance">';
        html += '<div class="agent-icon">\u2705</div>';
        html += '<h4>Compliance View</h4>';
        html += '<p>Review policy configurations, access reviews, and regulatory compliance posture.</p>';
        html += '<div class="agent-focus">Focus: Policies, Reviews, Standards</div>';
        html += '<button class="agent-btn" onclick="PageOverview.launchAgent(\'compliance\')">View</button>';
        html += '</div>';

        // Endpoint View
        html += '<div class="agent-card agent-card--endpoint" data-agent="endpoint">';
        html += '<div class="agent-icon">\uD83D\uDCBB</div>';
        html += '<h4>Endpoint View</h4>';
        html += '<p>Analyze device compliance, encryption status, update health, and endpoint risks.</p>';
        html += '<div class="agent-focus">Focus: Devices, Compliance, Updates</div>';
        html += '<button class="agent-btn" onclick="PageOverview.launchAgent(\'endpoint\')">View</button>';
        html += '</div>';

        // Data Quality View
        html += '<div class="agent-card agent-card--quality" data-agent="quality">';
        html += '<div class="agent-icon">\uD83D\uDCCA</div>';
        html += '<h4>Data Quality</h4>';
        html += '<p>Find stale accounts, duplicates, naming issues, and data completeness gaps.</p>';
        html += '<div class="agent-focus">Focus: Users, Data, Hygiene</div>';
        html += '<button class="agent-btn" onclick="PageOverview.launchAgent(\'quality\')">View</button>';
        html += '</div>';

        // Executive Report View
        html += '<div class="agent-card agent-card--executive" data-agent="executive">';
        html += '<div class="agent-icon">\uD83D\uDCC8</div>';
        html += '<h4>Executive Report</h4>';
        html += '<p>High-level KPIs, trends, and summary metrics for leadership reporting.</p>';
        html += '<div class="agent-focus">Focus: KPIs, Trends, Summary</div>';
        html += '<button class="agent-btn" onclick="PageOverview.launchAgent(\'executive\')">View</button>';
        html += '</div>';

        html += '</div>'; // agent-grid

        // Quick Actions Section
        html += '<div class="analytics-section" style="margin-top:var(--spacing-xl)">';
        html += '<h3>Quick Links</h3>';
        html += '<div class="quick-actions-grid">';

        html += '<button class="quick-action-btn" onclick="PageOverview.launchAgent(\'full-audit\')">';
        html += '<span class="quick-action-icon">\uD83D\uDD0D</span>';
        html += '<span class="quick-action-text">Security Overview</span>';
        html += '</button>';

        html += '<button class="quick-action-btn" onclick="PageOverview.launchAgent(\'risk-scan\')">';
        html += '<span class="quick-action-icon">\u26A0</span>';
        html += '<span class="quick-action-text">Identity Risks</span>';
        html += '</button>';

        html += '<button class="quick-action-btn" onclick="PageOverview.launchAgent(\'savings-report\')">';
        html += '<span class="quick-action-icon">\uD83D\uDCB5</span>';
        html += '<span class="quick-action-text">License Analysis</span>';
        html += '</button>';

        html += '<button class="quick-action-btn" onclick="PageOverview.launchAgent(\'health-check\')">';
        html += '<span class="quick-action-icon">\uD83C\uDFE5</span>';
        html += '<span class="quick-action-text">Device Health</span>';
        html += '</button>';

        html += '</div>'; // quick-actions-grid
        html += '</div>'; // analytics-section

        container.innerHTML = html;
    }

    /**
     * Renders the Executive Summary tab with high-level KPIs for leadership.
     */
    function renderExecutiveTab(container) {
        container.textContent = '';
        var summary = overviewState.summary;

        var html = '';

        // Executive Header
        html += '<div class="executive-header">';
        html += '<h3>Tenant Health Executive Summary</h3>';
        html += '<p style="color:var(--color-text-muted)">High-level metrics and KPIs for leadership reporting. Data as of ' + new Date().toLocaleDateString() + '</p>';
        html += '</div>';

        // Key Performance Indicators
        html += '<div class="analytics-section">';
        html += '<h3>Key Performance Indicators</h3>';
        html += '<div class="kpi-grid">';

        // Security Score KPI
        var secureScore = overviewState.secureScore;
        var secScorePct = secureScore ? secureScore.scorePct : 0;
        var secScoreClass = secScorePct >= 70 ? 'success' : secScorePct >= 40 ? 'warning' : 'critical';
        html += '<div class="kpi-card">';
        html += '<div class="kpi-value text-' + secScoreClass + '">' + secScorePct + '%</div>';
        html += '<div class="kpi-label">Microsoft Secure Score</div>';
        html += '<div class="kpi-target">Target: 70%+</div>';
        html += '</div>';

        // Compliance Rate KPI
        var compPct = summary.compliancePct || 0;
        var compClass = compPct >= 90 ? 'success' : compPct >= 70 ? 'warning' : 'critical';
        html += '<div class="kpi-card">';
        html += '<div class="kpi-value text-' + compClass + '">' + compPct + '%</div>';
        html += '<div class="kpi-label">Device Compliance</div>';
        html += '<div class="kpi-target">Target: 90%+</div>';
        html += '</div>';

        // MFA Coverage KPI
        var mfaPct = summary.mfaRegisteredPct || 0;
        var mfaClass = mfaPct >= 95 ? 'success' : mfaPct >= 80 ? 'warning' : 'critical';
        html += '<div class="kpi-card">';
        html += '<div class="kpi-value text-' + mfaClass + '">' + mfaPct + '%</div>';
        html += '<div class="kpi-label">MFA Registration</div>';
        html += '<div class="kpi-target">Target: 95%+</div>';
        html += '</div>';

        // Active Alerts KPI
        var alerts = summary.activeAlerts || 0;
        var alertClass = alerts === 0 ? 'success' : alerts <= 5 ? 'warning' : 'critical';
        html += '<div class="kpi-card">';
        html += '<div class="kpi-value text-' + alertClass + '">' + alerts + '</div>';
        html += '<div class="kpi-label">Active Security Alerts</div>';
        html += '<div class="kpi-target">Target: 0</div>';
        html += '</div>';

        // License Utilization
        var licenseStats = overviewState.licenseStats;
        var utilPct = licenseStats ? Math.round(licenseStats.totalAssigned / Math.max(1, licenseStats.totalAvailable) * 100) : 0;
        utilPct = Math.min(utilPct, 100);
        var utilClass = utilPct >= 70 && utilPct <= 95 ? 'success' : utilPct < 50 ? 'warning' : 'warning';
        html += '<div class="kpi-card">';
        html += '<div class="kpi-value">' + utilPct + '%</div>';
        html += '<div class="kpi-label">License Utilization</div>';
        html += '<div class="kpi-target">Target: 70-95%</div>';
        html += '</div>';

        // Risk Users
        var identityRisk = DataLoader.getData('identityRisk');
        var riskyUsers = identityRisk && identityRisk.summary ? identityRisk.summary.totalRiskyUsers || 0 : 0;
        var riskClass = riskyUsers === 0 ? 'success' : riskyUsers <= 5 ? 'warning' : 'critical';
        html += '<div class="kpi-card">';
        html += '<div class="kpi-value text-' + riskClass + '">' + riskyUsers + '</div>';
        html += '<div class="kpi-label">Risky User Accounts</div>';
        html += '<div class="kpi-target">Target: 0</div>';
        html += '</div>';

        html += '</div>'; // kpi-grid
        html += '</div>'; // analytics-section

        // Tenant Overview Numbers
        html += '<div class="analytics-section">';
        html += '<h3>Tenant At-a-Glance</h3>';
        html += '<div class="exec-stats-grid">';

        html += '<div class="exec-stat"><span class="exec-stat-value">' + (summary.totalUsers || 0) + '</span><span class="exec-stat-label">Total Users</span></div>';
        html += '<div class="exec-stat"><span class="exec-stat-value">' + (summary.enabledUsers || 0) + '</span><span class="exec-stat-label">Active Users</span></div>';
        html += '<div class="exec-stat"><span class="exec-stat-value">' + (summary.guestUsers || 0) + '</span><span class="exec-stat-label">Guest Users</span></div>';
        html += '<div class="exec-stat"><span class="exec-stat-value">' + (summary.totalDevices || 0) + '</span><span class="exec-stat-label">Managed Devices</span></div>';
        html += '<div class="exec-stat"><span class="exec-stat-value">' + (summary.totalApps || 0) + '</span><span class="exec-stat-label">Enterprise Apps</span></div>';
        html += '<div class="exec-stat"><span class="exec-stat-value">' + (summary.conditionalAccessPolicies || 0) + '</span><span class="exec-stat-label">CA Policies</span></div>';

        html += '</div>'; // exec-stats-grid
        html += '</div>'; // analytics-section

        // Status Summary
        html += '<div class="analytics-section">';
        html += '<h3>Status Summary</h3>';
        html += '<div class="status-summary-grid">';

        // Security Status
        var secSignals = securitySignals || aggregateSecuritySignals();
        var secStatus = secSignals.criticalCount > 0 ? 'critical' : secSignals.warningCount > 0 ? 'warning' : 'success';
        html += '<div class="status-item status-item--' + secStatus + '">';
        html += '<div class="status-icon">' + (secStatus === 'success' ? '\u2713' : secStatus === 'warning' ? '\u26A0' : '\u2717') + '</div>';
        html += '<div class="status-text">';
        html += '<div class="status-title">Security Posture</div>';
        html += '<div class="status-desc">' + (secStatus === 'success' ? 'No critical issues' : secSignals.criticalCount + ' critical, ' + secSignals.warningCount + ' warnings') + '</div>';
        html += '</div></div>';

        // Compliance Status
        var compStatus = compPct >= 90 ? 'success' : compPct >= 70 ? 'warning' : 'critical';
        html += '<div class="status-item status-item--' + compStatus + '">';
        html += '<div class="status-icon">' + (compStatus === 'success' ? '\u2713' : compStatus === 'warning' ? '\u26A0' : '\u2717') + '</div>';
        html += '<div class="status-text">';
        html += '<div class="status-title">Device Compliance</div>';
        html += '<div class="status-desc">' + (summary.compliantDevices || 0) + ' of ' + (summary.totalDevices || 0) + ' devices compliant</div>';
        html += '</div></div>';

        // Identity Status
        var idStatus = mfaPct >= 95 && riskyUsers === 0 ? 'success' : mfaPct >= 80 || riskyUsers <= 3 ? 'warning' : 'critical';
        html += '<div class="status-item status-item--' + idStatus + '">';
        html += '<div class="status-icon">' + (idStatus === 'success' ? '\u2713' : idStatus === 'warning' ? '\u26A0' : '\u2717') + '</div>';
        html += '<div class="status-text">';
        html += '<div class="status-title">Identity Security</div>';
        html += '<div class="status-desc">' + mfaPct + '% MFA coverage, ' + riskyUsers + ' risky users</div>';
        html += '</div></div>';

        // Cost Status
        var wasteCount = licenseStats ? licenseStats.totalWaste || 0 : 0;
        var costStatus = wasteCount < 10 ? 'success' : wasteCount < 50 ? 'warning' : 'critical';
        html += '<div class="status-item status-item--' + costStatus + '">';
        html += '<div class="status-icon">' + (costStatus === 'success' ? '\u2713' : costStatus === 'warning' ? '\u26A0' : '\u2717') + '</div>';
        html += '<div class="status-text">';
        html += '<div class="status-title">License Efficiency</div>';
        html += '<div class="status-desc">' + wasteCount + ' unused licenses identified</div>';
        html += '</div></div>';

        html += '</div>'; // status-summary-grid
        html += '</div>'; // analytics-section

        // Footer with data freshness
        html += '<div class="exec-footer">';
        html += '<p>Report generated: ' + new Date().toLocaleString() + '</p>';
        html += '</div>';

        container.innerHTML = html;

        // Add usage stats if running in server mode and user has permission
        if (typeof UsageTracker !== 'undefined' && UsageTracker.isServer() && UsageTracker.canViewStats()) {
            renderUsageStats(container);
        }
    }

    /**
     * Renders usage statistics (only in server mode).
     */
    function renderUsageStats(container) {
        UsageTracker.getStats().then(function(stats) {
            if (stats.error) return;

            var section = el('div', 'analytics-section');
            section.style.marginTop = 'var(--spacing-xl)';

            var header = el('h3', null, 'Dashboard Usage');
            section.appendChild(header);

            var desc = el('p');
            desc.style.color = 'var(--color-text-muted)';
            desc.style.marginBottom = 'var(--spacing-md)';
            desc.textContent = 'Track who is using this dashboard and how often.';
            section.appendChild(desc);

            var grid = el('div', 'signal-cards');

            // Today
            var todayCard = el('div', 'signal-card signal-card--info');
            todayCard.appendChild(el('div', 'signal-card-value', String(stats.activity.today || 0)));
            todayCard.appendChild(el('div', 'signal-card-label', 'Sessions Today'));
            grid.appendChild(todayCard);

            // This Week
            var weekCard = el('div', 'signal-card signal-card--info');
            weekCard.appendChild(el('div', 'signal-card-value', String(stats.activity.thisWeek || 0)));
            weekCard.appendChild(el('div', 'signal-card-label', 'This Week'));
            grid.appendChild(weekCard);

            // Unique Users
            var usersCard = el('div', 'signal-card signal-card--success');
            usersCard.appendChild(el('div', 'signal-card-value', String(stats.summary.uniqueUsers || 0)));
            usersCard.appendChild(el('div', 'signal-card-label', 'Unique Users'));
            grid.appendChild(usersCard);

            // Total Sessions
            var totalCard = el('div', 'signal-card signal-card--info');
            totalCard.appendChild(el('div', 'signal-card-value', String(stats.summary.totalSessions || 0)));
            totalCard.appendChild(el('div', 'signal-card-label', 'Total Sessions'));
            grid.appendChild(totalCard);

            section.appendChild(grid);

            // Top users table
            if (stats.topUsers && stats.topUsers.length > 0) {
                var tableSection = el('div');
                tableSection.style.marginTop = 'var(--spacing-lg)';

                var tableTitle = el('h4', null, 'Active Users (Last 7 Days)');
                tableTitle.style.marginBottom = 'var(--spacing-sm)';
                tableSection.appendChild(tableTitle);

                var table = el('table', 'data-table');
                var thead = el('thead');
                var headerRow = el('tr');
                ['User', 'Sessions', 'Page Views'].forEach(function(h) {
                    headerRow.appendChild(el('th', null, h));
                });
                thead.appendChild(headerRow);
                table.appendChild(thead);

                var tbody = el('tbody');
                stats.topUsers.forEach(function(user) {
                    var row = el('tr');
                    row.appendChild(el('td', null, user.username || 'Unknown'));
                    row.appendChild(el('td', 'cell-right', String(user.sessionCount || 0)));
                    row.appendChild(el('td', 'cell-right', String(user.totalPageViews || 0)));
                    tbody.appendChild(row);
                });
                table.appendChild(tbody);

                var tableWrap = el('div', 'table-container');
                tableWrap.appendChild(table);
                tableSection.appendChild(tableWrap);
                section.appendChild(tableSection);
            }

            container.appendChild(section);
        }).catch(function() {
            // Silent fail
        });
    }

    /**
     * Launches a specific analysis agent/perspective.
     */
    function launchAgent(agentType) {
        // Navigate to the appropriate page based on agent type
        var nav = {
            'security': 'identity-risk',
            'cost': 'license-analysis',
            'compliance': 'compliance',
            'endpoint': 'devices',
            'quality': 'data-quality',
            'executive': 'report',
            'full-audit': 'security',
            'risk-scan': 'identity-risk',
            'savings-report': 'license-analysis',
            'health-check': 'devices'
        };

        var targetPage = nav[agentType] || 'overview';

        // Navigate using hash (most reliable method)
        window.location.hash = targetPage;

        // Show a notification
        if (typeof showToast === 'function') {
            var labels = {
                'security': 'Security Analyst',
                'cost': 'Cost Optimizer',
                'compliance': 'Compliance Auditor',
                'endpoint': 'Endpoint Specialist',
                'quality': 'Data Quality Inspector',
                'executive': 'Executive Reporter',
                'full-audit': 'Full Tenant Audit',
                'risk-scan': 'Quick Risk Scan',
                'savings-report': 'Savings Report',
                'health-check': 'Health Check'
            };
            showToast('Navigating to ' + (labels[agentType] || agentType) + '...');
        }
    }

    /**
     * Renders the overview page content.
     */
    function render(container) {
        var summary = DataLoader.getSummary();

        // Recompute summary from department-filtered data if active
        if (typeof DepartmentFilter !== 'undefined' && DepartmentFilter.getSelected()) {
            var fUsers = DepartmentFilter.filterData(DataLoader.getData('users'), 'department');
            var fDevices = DepartmentFilter.filterByUPN(DataLoader.getData('devices'), 'userPrincipalName');
            var compliant = fDevices.filter(function(d) { return d.complianceState === 'compliant'; }).length;
            var mfaReg = fUsers.filter(function(u) { return u.mfaRegistered; }).length;
            summary = Object.assign({}, summary, {
                totalUsers: fUsers.length,
                employeeCount: fUsers.filter(function(u) { return u.domain === 'employee'; }).length,
                studentCount: fUsers.filter(function(u) { return u.domain === 'student'; }).length,
                otherCount: fUsers.filter(function(u) { return u.domain === 'other'; }).length,
                mfaRegisteredCount: mfaReg,
                noMfaUsers: fUsers.length - mfaReg,
                mfaPct: fUsers.length > 0 ? Math.round((mfaReg / fUsers.length) * 100) : 0,
                totalDevices: fDevices.length,
                compliantDevices: compliant,
                compliancePct: fDevices.length > 0 ? Math.round((compliant / fDevices.length) * 100) : 0
            });
        }

        // License stats
        var licenses = DataLoader.getData('licenseSkus') || [];
        var licenseStats = {
            totalSkus: licenses.length,
            avgUtilization: licenses.length > 0 ? Math.round(licenses.reduce(function(s, l) { return s + (l.utilizationPercent || 0); }, 0) / licenses.length) : 0,
            totalWaste: licenses.reduce(function(s, l) { return s + (l.wasteCount || 0); }, 0),
            wastePct: 0
        };
        var totalAssigned = licenses.reduce(function(s, l) { return s + (l.totalAssigned || 0); }, 0);
        if (totalAssigned > 0) {
            licenseStats.wastePct = Math.round((licenseStats.totalWaste / totalAssigned) * 100);
        }

        // Cache state
        overviewState = {
            summary: summary,
            licenseStats: licenseStats,
            secureScore: DataLoader.getData('secureScore'),
            serviceAnnouncements: DataLoader.getData('serviceAnnouncements')
        };

        container.textContent = '';

        // Page header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Overview'));
        header.appendChild(el('p', 'page-description', 'Summary of your Microsoft 365 tenant health and status'));
        container.appendChild(header);

        // Summary cards
        var cardsGrid = el('div', 'summary-cards');

        var userCard = createSummaryCard('Total Users', summary.totalUsers, null, null, 'users');
        var userChange = el('div', 'card-change', summary.employeeCount + ' employees, ' + summary.studentCount + ' students');
        userCard.appendChild(userChange);
        cardsGrid.appendChild(userCard);

        var mfaClass = summary.mfaPct >= 90 ? 'card-success' : (summary.mfaPct >= 70 ? 'card-warning' : 'card-critical');
        var mfaValClass = summary.mfaPct >= 90 ? 'success' : (summary.mfaPct >= 70 ? 'warning' : 'critical');
        var mfaCard = createSummaryCard('MFA Coverage', summary.mfaPct + '%', mfaValClass, mfaClass, 'security');
        mfaCard.appendChild(el('div', 'card-change', summary.noMfaUsers + ' users without MFA'));
        cardsGrid.appendChild(mfaCard);

        var compClass = summary.compliancePct >= 90 ? 'card-success' : (summary.compliancePct >= 70 ? 'card-warning' : 'card-critical');
        var compValClass = summary.compliancePct >= 90 ? 'success' : (summary.compliancePct >= 70 ? 'warning' : 'critical');
        var compCard = createSummaryCard('Device Compliance', summary.compliancePct + '%', compValClass, compClass, 'devices');
        compCard.appendChild(el('div', 'card-change', summary.compliantDevices + ' of ' + summary.totalDevices + ' devices'));
        cardsGrid.appendChild(compCard);

        var alertClass = summary.activeAlerts > 0 ? 'card-critical' : 'card-success';
        var alertValClass = summary.activeAlerts > 0 ? 'critical' : 'success';
        var alertCard = createSummaryCard('Active Alerts', summary.activeAlerts, alertValClass, alertClass, 'security');
        alertCard.appendChild(el('div', 'card-change', summary.activeAlerts > 0 ? 'Requires attention' : 'All clear'));
        cardsGrid.appendChild(alertCard);

        container.appendChild(cardsGrid);

        // Add trend indicators if available
        if (typeof TrendHelper !== 'undefined') {
            var history = DataLoader.getData('trendHistory');
            if (history && history.length > 0) {
                var cards = container.querySelectorAll('.card[data-navigate]');
                var trendMetrics = [
                    { key: 'totalUsers', value: summary.totalUsers },
                    { key: 'mfaPct', value: summary.mfaPct },
                    { key: 'compliancePct', value: summary.compliancePct },
                    { key: 'activeAlerts', value: summary.activeAlerts }
                ];
                cards.forEach(function(card, idx) {
                    if (trendMetrics[idx]) {
                        var trend = TrendHelper.getTrend(trendMetrics[idx].value, history, trendMetrics[idx].key);
                        if (trend) {
                            var indicator = TrendHelper.createIndicator(trend);
                            var valEl = card.querySelector('.card-value');
                            if (valEl) valEl.appendChild(indicator);
                        }
                    }
                });
            }
        }

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { id: 'overview', label: 'Overview' },
            { id: 'cockpit', label: 'Security Cockpit' },
            { id: 'executive', label: 'Executive Summary' },
            { id: 'agents', label: 'Quick Access' },
            { id: 'stats', label: 'Quick Stats' }
        ];
        tabs.forEach(function(t) {
            var btn = el('button', 'tab-btn' + (t.id === 'overview' ? ' active' : ''));
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            tabBar.appendChild(btn);
        });
        container.appendChild(tabBar);

        // Content area
        var contentArea = el('div', 'content-area');
        contentArea.id = 'overview-content';
        container.appendChild(contentArea);

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        // Card navigation
        container.querySelectorAll('.card[data-navigate]').forEach(function(card) {
            card.addEventListener('click', function() {
                window.location.hash = card.dataset.navigate;
            });
        });

        currentTab = 'overview';
        renderContent();
    }

    // Public API
    return {
        render: render,
        launchAgent: launchAgent
    };

})();

// Register page
window.PageOverview = PageOverview;
