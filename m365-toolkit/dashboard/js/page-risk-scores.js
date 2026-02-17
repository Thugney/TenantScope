/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: RISK SCORES
 *
 * Renders the cross-entity risk score dashboard with tenant-level overview,
 * risk distribution, top risk factors, and per-user risk breakdowns.
 * Data sourced from trusted Graph API collectors - not user input.
 */

const PageRiskScores = (function() {
    'use strict';

    // ========================================================================
    // CONSTANTS
    // ========================================================================

    var TIER_COLORS = {
        critical: '#f85149',
        high: '#fd7e14',
        medium: '#d29922',
        low: '#58a6ff',
        minimal: '#3fb950'
    };

    var GRADE_COLORS = {
        A: '#3fb950',
        B: '#56d364',
        C: '#d29922',
        D: '#fd7e14',
        F: '#f85149'
    };

    var TIER_ORDER = ['critical', 'high', 'medium', 'low', 'minimal'];

    var FACTOR_LABELS = {
        mfa: 'MFA',
        adminRole: 'Admin Role',
        deviceCompliance: 'Device Compliance',
        identityRisk: 'Identity Risk',
        signInRisk: 'Sign-In Risk',
        caCoverage: 'CA Coverage',
        oauthConsent: 'OAuth Consent'
    };

    var FACTOR_KEYS = ['mfa', 'adminRole', 'deviceCompliance', 'identityRisk', 'signInRisk', 'caCoverage', 'oauthConsent'];

    // ========================================================================
    // STATE
    // ========================================================================

    var currentTab = 'all';
    var expandedUserId = null;
    var state = {
        data: null,
        filteredUsers: []
    };

    // ========================================================================
    // HELPERS
    // ========================================================================

    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function(m) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        try {
            return new Date(dateStr).toLocaleDateString('en-GB', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return '--'; }
    }

    function getGradeColor(grade) {
        return GRADE_COLORS[grade] || GRADE_COLORS.C;
    }

    function getTierColor(tier) {
        return TIER_COLORS[tier] || TIER_COLORS.medium;
    }

    function getTierBadgeClass(tier) {
        var map = {
            critical: 'badge-critical',
            high: 'badge-warning',
            medium: 'badge-info',
            low: 'badge-neutral',
            minimal: 'badge-success'
        };
        return map[tier] || 'badge-neutral';
    }

    function getScoreColorClass(score) {
        if (score >= 70) return 'text-critical';
        if (score >= 50) return 'text-warning';
        if (score >= 25) return 'text-info';
        return 'text-success';
    }

    // ========================================================================
    // RENDER ENTRY POINT
    // ========================================================================

    function render(container) {
        var data = DataLoader.getData('riskScores');

        if (!data || !data.tenantRisk) {
            container.innerHTML = '';
            var emptyState = el('div', 'empty-state');
            emptyState.appendChild(el('div', 'empty-state-title', 'No Risk Score Data'));
            var desc = el('div', 'empty-state-description');
            desc.innerHTML = 'No risk score data available. Run <code>Invoke-TenantRiskScore.ps1</code> to generate cross-entity risk scores.';
            emptyState.appendChild(desc);
            container.appendChild(emptyState);
            return;
        }

        state.data = data;
        state.filteredUsers = data.users || [];
        currentTab = 'all';
        expandedUserId = null;

        var tenantRisk = data.tenantRisk;
        var users = data.users || [];

        // Page Header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Tenant Risk Score'));
        var subtitle = el('p', 'page-description');
        subtitle.textContent = 'Grade ' + (tenantRisk.grade || '--') + ' \u2022 Generated ' + formatDate(data.generatedAt);
        header.appendChild(subtitle);
        container.innerHTML = '';
        container.appendChild(header);

        // Summary Cards
        renderSummaryCards(container, tenantRisk, users);

        // Tenant Score Hero + Distribution
        var heroRow = el('div', 'analytics-grid');
        heroRow.style.gridTemplateColumns = '1fr 1fr';
        heroRow.style.gap = '24px';
        heroRow.style.marginBottom = '24px';
        renderScoreHero(heroRow, tenantRisk);
        renderDistributionCard(heroRow, tenantRisk);
        container.appendChild(heroRow);

        // Top Risk Factors
        if (tenantRisk.topRiskFactors && tenantRisk.topRiskFactors.length > 0) {
            renderTopRiskFactors(container, tenantRisk.topRiskFactors);
        }

        // User Risk Table with tab filters
        renderUserSection(container, users);
    }

    // ========================================================================
    // SUMMARY CARDS
    // ========================================================================

    function renderSummaryCards(container, tenantRisk, users) {
        var dist = tenantRisk.distribution || {};
        var critCount = dist.critical || 0;
        var highCount = dist.high || 0;

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value" style="color:' + escapeHtml(getGradeColor(tenantRisk.grade)) + '">' + escapeHtml(String(tenantRisk.overallScore)) + '</div><div class="summary-label">Overall Score</div></div>';
        html += '<div class="summary-card"><div class="summary-value" style="color:' + escapeHtml(getGradeColor(tenantRisk.grade)) + '">' + escapeHtml(tenantRisk.grade || '--') + '</div><div class="summary-label">Grade</div></div>';
        html += '<div class="summary-card' + (critCount > 0 ? ' card-danger' : '') + '"><div class="summary-value' + (critCount > 0 ? ' text-critical' : '') + '">' + critCount + '</div><div class="summary-label">Critical Users</div></div>';
        html += '<div class="summary-card' + (highCount > 0 ? ' card-warning' : '') + '"><div class="summary-value' + (highCount > 0 ? ' text-warning' : '') + '">' + highCount + '</div><div class="summary-label">High Risk Users</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + users.length + '</div><div class="summary-label">Total Users Scored</div></div>';
        html += '</div>';

        var wrapper = el('div');
        wrapper.innerHTML = html;
        while (wrapper.firstChild) {
            container.appendChild(wrapper.firstChild);
        }
    }

    // ========================================================================
    // SCORE HERO (SVG Ring)
    // ========================================================================

    function renderScoreHero(container, tenantRisk) {
        var card = el('div', 'analytics-card');
        card.appendChild(el('h3', null, 'Tenant Risk Score'));

        var heroWrap = el('div', 'risk-hero');
        heroWrap.style.display = 'flex';
        heroWrap.style.alignItems = 'center';
        heroWrap.style.gap = '32px';
        heroWrap.style.padding = '16px 0';

        // SVG Ring Chart
        var score = tenantRisk.overallScore || 0;
        var grade = tenantRisk.grade || '--';
        var gradeColor = getGradeColor(grade);

        var svgSize = 160;
        var svgNs = 'http://www.w3.org/2000/svg';
        var radius = 64;
        var circumference = 2 * Math.PI * radius;
        var scoreFraction = Math.min(score / 100, 1);
        var dashLength = scoreFraction * circumference;

        var svgWrap = el('div');
        svgWrap.style.position = 'relative';
        svgWrap.style.width = svgSize + 'px';
        svgWrap.style.height = svgSize + 'px';
        svgWrap.style.flexShrink = '0';

        var svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + svgSize + ' ' + svgSize);
        svg.setAttribute('width', String(svgSize));
        svg.setAttribute('height', String(svgSize));

        // Background track
        var bgCircle = document.createElementNS(svgNs, 'circle');
        bgCircle.setAttribute('cx', String(svgSize / 2));
        bgCircle.setAttribute('cy', String(svgSize / 2));
        bgCircle.setAttribute('r', String(radius));
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', '#e5e7eb');
        bgCircle.setAttribute('stroke-width', '14');
        svg.appendChild(bgCircle);

        // Score arc
        var scoreCircle = document.createElementNS(svgNs, 'circle');
        scoreCircle.setAttribute('cx', String(svgSize / 2));
        scoreCircle.setAttribute('cy', String(svgSize / 2));
        scoreCircle.setAttribute('r', String(radius));
        scoreCircle.setAttribute('fill', 'none');
        scoreCircle.setAttribute('stroke', gradeColor);
        scoreCircle.setAttribute('stroke-width', '14');
        scoreCircle.setAttribute('stroke-dasharray', dashLength + ' ' + (circumference - dashLength));
        scoreCircle.setAttribute('stroke-dashoffset', String(circumference * 0.25));
        scoreCircle.setAttribute('stroke-linecap', 'round');
        scoreCircle.setAttribute('transform', 'rotate(-90 ' + (svgSize / 2) + ' ' + (svgSize / 2) + ')');
        svg.appendChild(scoreCircle);

        svgWrap.appendChild(svg);

        // Center text overlay
        var centerText = el('div');
        centerText.style.position = 'absolute';
        centerText.style.top = '0';
        centerText.style.left = '0';
        centerText.style.width = '100%';
        centerText.style.height = '100%';
        centerText.style.display = 'flex';
        centerText.style.flexDirection = 'column';
        centerText.style.alignItems = 'center';
        centerText.style.justifyContent = 'center';

        var scoreNum = el('div', null, String(score));
        scoreNum.style.fontSize = '36px';
        scoreNum.style.fontWeight = '700';
        scoreNum.style.color = gradeColor;
        scoreNum.style.lineHeight = '1';
        centerText.appendChild(scoreNum);

        var scoreLabel = el('div', null, '/100');
        scoreLabel.style.fontSize = '12px';
        scoreLabel.style.color = 'var(--color-text-secondary)';
        scoreLabel.style.marginTop = '2px';
        centerText.appendChild(scoreLabel);

        svgWrap.appendChild(centerText);
        heroWrap.appendChild(svgWrap);

        // Stats panel
        var statsPanel = el('div');
        statsPanel.style.display = 'flex';
        statsPanel.style.flexDirection = 'column';
        statsPanel.style.gap = '12px';

        var gradeBadge = el('div');
        gradeBadge.style.display = 'inline-flex';
        gradeBadge.style.alignItems = 'center';
        gradeBadge.style.gap = '8px';
        var gradeSpan = el('span', null, 'Grade ' + grade);
        gradeSpan.style.fontSize = '24px';
        gradeSpan.style.fontWeight = '700';
        gradeSpan.style.color = gradeColor;
        gradeBadge.appendChild(gradeSpan);
        statsPanel.appendChild(gradeBadge);

        var avgRisk = tenantRisk.averageUserRisk;
        if (avgRisk !== undefined && avgRisk !== null) {
            var avgRow = el('div', 'score-categories');
            var avgItem = el('div', 'category-item');
            avgItem.appendChild(el('span', 'category-label', 'Avg User Risk'));
            var avgVal = el('span', 'category-score', String(Math.round(avgRisk * 10) / 10));
            avgItem.appendChild(avgVal);
            avgRow.appendChild(avgItem);
            statsPanel.appendChild(avgRow);
        }

        var dist = tenantRisk.distribution || {};
        var totalUsers = 0;
        TIER_ORDER.forEach(function(t) { totalUsers += (dist[t] || 0); });
        if (totalUsers > 0) {
            var usersRow = el('div', 'category-item');
            usersRow.appendChild(el('span', 'category-label', 'Users Scored'));
            usersRow.appendChild(el('span', 'category-score', String(totalUsers)));
            statsPanel.appendChild(usersRow);
        }

        heroWrap.appendChild(statsPanel);
        card.appendChild(heroWrap);
        container.appendChild(card);
    }

    // ========================================================================
    // RISK DISTRIBUTION BAR
    // ========================================================================

    function renderDistributionCard(container, tenantRisk) {
        var card = el('div', 'analytics-card');
        card.appendChild(el('h3', null, 'Risk Distribution'));

        var dist = tenantRisk.distribution || {};
        var total = 0;
        TIER_ORDER.forEach(function(t) { total += (dist[t] || 0); });

        if (total === 0) {
            card.appendChild(el('p', 'text-muted', 'No distribution data available'));
            container.appendChild(card);
            return;
        }

        // Stacked horizontal bar
        var barContainer = el('div');
        barContainer.style.marginTop = '16px';
        barContainer.style.marginBottom = '16px';

        var bar = el('div');
        bar.style.display = 'flex';
        bar.style.height = '40px';
        bar.style.borderRadius = '6px';
        bar.style.overflow = 'hidden';
        bar.style.width = '100%';

        TIER_ORDER.forEach(function(tier) {
            var count = dist[tier] || 0;
            if (count === 0) return;
            var pct = (count / total) * 100;

            var segment = el('div');
            segment.style.width = pct + '%';
            segment.style.backgroundColor = TIER_COLORS[tier];
            segment.style.display = 'flex';
            segment.style.alignItems = 'center';
            segment.style.justifyContent = 'center';
            segment.style.color = '#fff';
            segment.style.fontSize = '12px';
            segment.style.fontWeight = '600';
            segment.style.minWidth = '0';
            segment.style.overflow = 'hidden';
            segment.style.position = 'relative';
            segment.title = tier.charAt(0).toUpperCase() + tier.slice(1) + ': ' + count + ' users (' + Math.round(pct) + '%)';

            if (pct >= 8) {
                segment.textContent = String(count);
            }

            bar.appendChild(segment);
        });

        barContainer.appendChild(bar);
        card.appendChild(barContainer);

        // Legend
        var legend = el('div');
        legend.style.display = 'flex';
        legend.style.flexWrap = 'wrap';
        legend.style.gap = '16px';
        legend.style.marginTop = '8px';

        TIER_ORDER.forEach(function(tier) {
            var count = dist[tier] || 0;
            var item = el('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '6px';
            item.style.fontSize = '13px';

            var dot = el('span');
            dot.style.width = '10px';
            dot.style.height = '10px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = TIER_COLORS[tier];
            dot.style.flexShrink = '0';
            item.appendChild(dot);

            var label = tier.charAt(0).toUpperCase() + tier.slice(1);
            item.appendChild(el('span', null, label));

            var countSpan = el('span', null, String(count));
            countSpan.style.fontWeight = '600';
            item.appendChild(countSpan);

            var pct = total > 0 ? Math.round((count / total) * 100) : 0;
            var pctSpan = el('span', 'text-muted', '(' + pct + '%)');
            pctSpan.style.fontSize = '12px';
            item.appendChild(pctSpan);

            legend.appendChild(item);
        });

        card.appendChild(legend);
        container.appendChild(card);
    }

    // ========================================================================
    // TOP RISK FACTORS
    // ========================================================================

    function renderTopRiskFactors(container, topFactors) {
        var section = el('div', 'analytics-section');
        section.style.marginBottom = '24px';
        section.appendChild(el('h3', null, 'Top Risk Factors'));
        section.appendChild(el('p', 'section-description', 'Risk categories contributing most across all users'));

        // Sort by impact (affectedUsers * avgContribution)
        var sorted = topFactors.slice().sort(function(a, b) {
            var impactA = (a.affectedUsers || 0) * (a.avgContribution || 0);
            var impactB = (b.affectedUsers || 0) * (b.avgContribution || 0);
            return impactB - impactA;
        });

        var maxImpact = 0;
        sorted.forEach(function(f) {
            var impact = (f.affectedUsers || 0) * (f.avgContribution || 0);
            if (impact > maxImpact) maxImpact = impact;
        });

        var grid = el('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        grid.style.gap = '12px';

        sorted.forEach(function(factor) {
            var impact = (factor.affectedUsers || 0) * (factor.avgContribution || 0);
            var impactPct = maxImpact > 0 ? (impact / maxImpact) * 100 : 0;

            var factorCard = el('div', 'analytics-card');
            factorCard.style.padding = '16px';

            var header = el('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '8px';

            header.appendChild(el('strong', null, factor.label || factor.factor || 'Unknown'));

            var affected = el('span', 'badge badge-info', factor.affectedUsers + ' users');
            header.appendChild(affected);
            factorCard.appendChild(header);

            var avgLine = el('div');
            avgLine.style.fontSize = '13px';
            avgLine.style.color = 'var(--color-text-secondary)';
            avgLine.style.marginBottom = '8px';
            avgLine.textContent = 'Avg contribution: ' + (Math.round((factor.avgContribution || 0) * 10) / 10) + ' points';
            factorCard.appendChild(avgLine);

            // Impact bar
            var barTrack = el('div');
            barTrack.style.height = '6px';
            barTrack.style.borderRadius = '3px';
            barTrack.style.backgroundColor = 'var(--color-bg-tertiary, #e5e7eb)';
            barTrack.style.overflow = 'hidden';

            var barFill = el('div');
            barFill.style.height = '100%';
            barFill.style.borderRadius = '3px';
            barFill.style.width = Math.max(impactPct, 2) + '%';
            barFill.style.backgroundColor = impactPct >= 75 ? TIER_COLORS.critical : impactPct >= 50 ? TIER_COLORS.high : impactPct >= 25 ? TIER_COLORS.medium : TIER_COLORS.low;
            barFill.style.transition = 'width 0.3s ease';
            barTrack.appendChild(barFill);

            factorCard.appendChild(barTrack);
            grid.appendChild(factorCard);
        });

        section.appendChild(grid);
        container.appendChild(section);
    }

    // ========================================================================
    // USER RISK TABLE SECTION
    // ========================================================================

    function renderUserSection(container, users) {
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'User Risk Scores'));

        // Tab filter bar
        var tabBar = el('div', 'tab-bar');
        var tabs = [
            { key: 'all', label: 'All (' + users.length + ')' },
            { key: 'critical', label: 'Critical (' + countByTier(users, 'critical') + ')' },
            { key: 'high', label: 'High (' + countByTier(users, 'high') + ')' },
            { key: 'medium', label: 'Medium (' + countByTier(users, 'medium') + ')' },
            { key: 'low', label: 'Low (' + countByTier(users, 'low') + ')' }
        ];

        tabs.forEach(function(tab) {
            var btn = el('button', 'tab-btn' + (tab.key === currentTab ? ' active' : ''), tab.label);
            btn.dataset.tab = tab.key;
            btn.addEventListener('click', function() {
                currentTab = tab.key;
                tabBar.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.toggle('active', b.dataset.tab === currentTab);
                });
                filterAndRenderTable();
            });
            tabBar.appendChild(btn);
        });

        section.appendChild(tabBar);

        // Table container
        var tableArea = el('div', 'content-area');
        tableArea.id = 'risk-scores-content';
        section.appendChild(tableArea);

        container.appendChild(section);

        filterAndRenderTable();
    }

    function countByTier(users, tier) {
        var count = 0;
        for (var i = 0; i < users.length; i++) {
            if ((users[i].riskTier || '').toLowerCase() === tier) count++;
        }
        return count;
    }

    function filterAndRenderTable() {
        var data = state.data;
        if (!data) return;

        var users = data.users || [];
        if (currentTab !== 'all') {
            users = users.filter(function(u) {
                return (u.riskTier || '').toLowerCase() === currentTab;
            });
        }
        state.filteredUsers = users;

        var tableContainer = document.getElementById('risk-scores-content');
        if (!tableContainer) return;
        tableContainer.innerHTML = '';

        if (users.length === 0) {
            var emptyDiv = el('div', 'empty-state');
            emptyDiv.appendChild(el('div', 'empty-state-title', 'No users in this category'));
            emptyDiv.appendChild(el('div', 'empty-state-description', 'No users found with the selected risk tier.'));
            tableContainer.appendChild(emptyDiv);
            return;
        }

        var tableId = 'risk-scores-user-table';
        var tableWrap = el('div');
        tableWrap.id = tableId;
        tableContainer.appendChild(tableWrap);

        if (typeof Tables !== 'undefined' && Tables.render) {
            Tables.render({
                containerId: tableId,
                data: users,
                columns: [
                    {
                        key: 'displayName',
                        label: 'User',
                        filterable: true,
                        formatter: function(value, row) {
                            return '<div class="user-cell"><strong>' + escapeHtml(value || 'Unknown') + '</strong>' +
                                '<small>' + escapeHtml(row.userPrincipalName || '') + '</small></div>';
                        }
                    },
                    {
                        key: 'compositeScore',
                        label: 'Score',
                        formatter: function(value) {
                            var score = Number(value) || 0;
                            var color = score >= 70 ? TIER_COLORS.critical : score >= 50 ? TIER_COLORS.high : score >= 25 ? TIER_COLORS.medium : TIER_COLORS.minimal;
                            return '<strong style="color:' + color + '">' + score + '</strong>';
                        }
                    },
                    {
                        key: 'riskTier',
                        label: 'Tier',
                        filterable: true,
                        formatter: function(value) {
                            var tier = (value || 'unknown').toLowerCase();
                            var cls = getTierBadgeClass(tier);
                            return '<span class="badge ' + cls + '">' + escapeHtml(tier.charAt(0).toUpperCase() + tier.slice(1)) + '</span>';
                        }
                    },
                    {
                        key: 'factors.mfa.score',
                        label: 'MFA',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'mfa');
                        }
                    },
                    {
                        key: 'factors.adminRole.score',
                        label: 'Admin',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'adminRole');
                        }
                    },
                    {
                        key: 'factors.deviceCompliance.score',
                        label: 'Device',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'deviceCompliance');
                        }
                    },
                    {
                        key: 'factors.identityRisk.score',
                        label: 'Identity',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'identityRisk');
                        }
                    },
                    {
                        key: 'factors.signInRisk.score',
                        label: 'Sign-In',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'signInRisk');
                        }
                    },
                    {
                        key: 'factors.caCoverage.score',
                        label: 'CA',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'caCoverage');
                        }
                    },
                    {
                        key: 'factors.oauthConsent.score',
                        label: 'OAuth',
                        formatter: function(val, row) {
                            return formatFactorCell(row, 'oauthConsent');
                        }
                    }
                ],
                pageSize: 25,
                onRowClick: function(row) {
                    toggleUserDetail(row);
                },
                getRowClass: function(row) {
                    var tier = (row.riskTier || '').toLowerCase();
                    if (tier === 'critical') return 'row-critical';
                    if (tier === 'high') return 'row-warning';
                    return '';
                }
            });
        } else {
            renderFallbackTable(tableContainer, users);
        }
    }

    /**
     * Formats a factor cell with score/max and mini bar.
     * Data comes from local JSON, not user input.
     */
    function formatFactorCell(row, factorKey) {
        var factors = row.factors || {};
        var factor = factors[factorKey];
        if (!factor) return '<span class="text-muted">--</span>';

        var score = factor.score || 0;
        var maxScore = factor.maxScore || 1;
        var pct = Math.min((score / maxScore) * 100, 100);
        var color = score === 0 ? TIER_COLORS.minimal : pct >= 75 ? TIER_COLORS.critical : pct >= 50 ? TIER_COLORS.high : pct >= 25 ? TIER_COLORS.medium : TIER_COLORS.low;

        return '<div style="display:flex;align-items:center;gap:4px;min-width:70px;">' +
            '<div style="flex:1;height:4px;border-radius:2px;background:var(--color-bg-tertiary,#e5e7eb);overflow:hidden;">' +
            '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:2px;"></div>' +
            '</div>' +
            '<span style="font-size:11px;white-space:nowrap;color:' + color + ';">' + score + '/' + maxScore + '</span>' +
            '</div>';
    }

    /**
     * Fallback table for when Tables module is unavailable.
     */
    function renderFallbackTable(container, users) {
        var html = '<div class="table-container"><table class="data-table"><thead><tr>';
        html += '<th>User</th><th>Score</th><th>Tier</th>';
        FACTOR_KEYS.forEach(function(key) {
            html += '<th>' + escapeHtml(FACTOR_LABELS[key] || key) + '</th>';
        });
        html += '</tr></thead><tbody>';

        users.forEach(function(user) {
            var tier = (user.riskTier || '').toLowerCase();
            var rowClass = tier === 'critical' ? ' class="row-critical"' : tier === 'high' ? ' class="row-warning"' : '';
            html += '<tr' + rowClass + ' style="cursor:pointer;" data-user-id="' + escapeHtml(user.id || '') + '">';
            html += '<td><div class="user-cell"><strong>' + escapeHtml(user.displayName || 'Unknown') + '</strong><small>' + escapeHtml(user.userPrincipalName || '') + '</small></div></td>';
            var score = user.compositeScore || 0;
            var scoreColor = score >= 70 ? TIER_COLORS.critical : score >= 50 ? TIER_COLORS.high : score >= 25 ? TIER_COLORS.medium : TIER_COLORS.minimal;
            html += '<td><strong style="color:' + scoreColor + '">' + score + '</strong></td>';
            html += '<td><span class="badge ' + getTierBadgeClass(tier) + '">' + escapeHtml(tier.charAt(0).toUpperCase() + tier.slice(1)) + '</span></td>';

            FACTOR_KEYS.forEach(function(key) {
                html += '<td>' + formatFactorCell(user, key) + '</td>';
            });

            html += '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // Bind row clicks for fallback table
        container.querySelectorAll('tr[data-user-id]').forEach(function(tr) {
            tr.addEventListener('click', function() {
                var userId = tr.dataset.userId;
                var user = users.find(function(u) { return u.id === userId; });
                if (user) toggleUserDetail(user);
            });
        });
    }

    // ========================================================================
    // USER DETAIL EXPANSION
    // ========================================================================

    function toggleUserDetail(user) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        title.textContent = 'Risk Breakdown: ' + (user.displayName || 'Unknown');
        body.textContent = '';

        // User summary
        var summaryDiv = el('div', 'detail-list');
        summaryDiv.style.marginBottom = '16px';

        var fields = [
            ['User', user.displayName || 'Unknown'],
            ['UPN', user.userPrincipalName || '--'],
            ['Composite Score', String(user.compositeScore || 0) + ' / 100'],
            ['Risk Tier', (user.riskTier || 'unknown').charAt(0).toUpperCase() + (user.riskTier || 'unknown').slice(1)]
        ];
        fields.forEach(function(pair) {
            summaryDiv.appendChild(el('span', 'detail-label', pair[0] + ':'));
            summaryDiv.appendChild(el('span', 'detail-value', pair[1]));
        });
        body.appendChild(summaryDiv);

        // Factor breakdown heading
        body.appendChild(el('h4', 'mb-sm', 'Risk Factor Breakdown'));

        // Factor bars
        var factorsContainer = el('div');
        factorsContainer.style.display = 'flex';
        factorsContainer.style.flexDirection = 'column';
        factorsContainer.style.gap = '12px';

        var factors = user.factors || {};

        FACTOR_KEYS.forEach(function(key) {
            var factor = factors[key];
            if (!factor) return;

            var factorRow = el('div');
            factorRow.style.padding = '8px 12px';
            factorRow.style.borderRadius = '6px';
            factorRow.style.backgroundColor = 'var(--color-bg-secondary, #f3f4f6)';

            // Header line: name + score
            var headerLine = el('div');
            headerLine.style.display = 'flex';
            headerLine.style.justifyContent = 'space-between';
            headerLine.style.alignItems = 'center';
            headerLine.style.marginBottom = '4px';

            var nameSpan = el('strong', null, FACTOR_LABELS[key] || key);
            headerLine.appendChild(nameSpan);

            var score = factor.score || 0;
            var maxScore = factor.maxScore || 1;
            var pct = Math.min((score / maxScore) * 100, 100);
            var color = score === 0 ? TIER_COLORS.minimal : pct >= 75 ? TIER_COLORS.critical : pct >= 50 ? TIER_COLORS.high : pct >= 25 ? TIER_COLORS.medium : TIER_COLORS.low;

            var scoreSpan = el('span', null, score + ' / ' + maxScore);
            scoreSpan.style.fontWeight = '600';
            scoreSpan.style.color = color;
            headerLine.appendChild(scoreSpan);

            factorRow.appendChild(headerLine);

            // Bar
            var barTrack = el('div');
            barTrack.style.height = '8px';
            barTrack.style.borderRadius = '4px';
            barTrack.style.backgroundColor = 'var(--color-bg-tertiary, #e5e7eb)';
            barTrack.style.overflow = 'hidden';
            barTrack.style.marginBottom = '4px';

            var barFill = el('div');
            barFill.style.height = '100%';
            barFill.style.borderRadius = '4px';
            barFill.style.width = pct + '%';
            barFill.style.backgroundColor = color;
            barFill.style.transition = 'width 0.3s ease';
            barTrack.appendChild(barFill);

            factorRow.appendChild(barTrack);

            // Detail text
            if (factor.detail) {
                var detailSpan = el('div', null, factor.detail);
                detailSpan.style.fontSize = '12px';
                detailSpan.style.color = 'var(--color-text-secondary)';
                factorRow.appendChild(detailSpan);
            }

            factorsContainer.appendChild(factorRow);
        });

        body.appendChild(factorsContainer);

        // Radar-like visual: horizontal comparison chart
        body.appendChild(el('h4', 'mb-sm', 'Factor Comparison'));
        body.style.paddingBottom = '8px';

        var radarSvg = buildRadarChart(user);
        if (radarSvg) {
            body.appendChild(radarSvg);
        }

        modal.classList.add('visible');
    }

    /**
     * Builds a simple SVG radar/spider chart for user risk factors.
     */
    function buildRadarChart(user) {
        var factors = user.factors || {};
        var keys = FACTOR_KEYS.filter(function(k) { return factors[k]; });
        if (keys.length < 3) return null;

        var svgNs = 'http://www.w3.org/2000/svg';
        var size = 280;
        var center = size / 2;
        var maxRadius = 110;
        var levels = 4;

        var svgWrap = el('div');
        svgWrap.style.display = 'flex';
        svgWrap.style.justifyContent = 'center';
        svgWrap.style.padding = '8px 0';

        var svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));

        var n = keys.length;
        var angleStep = (2 * Math.PI) / n;

        // Draw grid levels
        for (var level = 1; level <= levels; level++) {
            var r = (level / levels) * maxRadius;
            var points = [];
            for (var i = 0; i < n; i++) {
                var angle = i * angleStep - Math.PI / 2;
                points.push((center + r * Math.cos(angle)).toFixed(1) + ',' + (center + r * Math.sin(angle)).toFixed(1));
            }
            var polygon = document.createElementNS(svgNs, 'polygon');
            polygon.setAttribute('points', points.join(' '));
            polygon.setAttribute('fill', 'none');
            polygon.setAttribute('stroke', 'var(--color-border, #d1d5db)');
            polygon.setAttribute('stroke-width', '0.5');
            polygon.setAttribute('opacity', '0.5');
            svg.appendChild(polygon);
        }

        // Draw axis lines
        for (var i = 0; i < n; i++) {
            var angle = i * angleStep - Math.PI / 2;
            var line = document.createElementNS(svgNs, 'line');
            line.setAttribute('x1', String(center));
            line.setAttribute('y1', String(center));
            line.setAttribute('x2', String(center + maxRadius * Math.cos(angle)));
            line.setAttribute('y2', String(center + maxRadius * Math.sin(angle)));
            line.setAttribute('stroke', 'var(--color-border, #d1d5db)');
            line.setAttribute('stroke-width', '0.5');
            line.setAttribute('opacity', '0.5');
            svg.appendChild(line);
        }

        // Draw data polygon
        var dataPoints = [];
        for (var i = 0; i < n; i++) {
            var factor = factors[keys[i]];
            var score = factor.score || 0;
            var maxScore = factor.maxScore || 1;
            var ratio = Math.min(score / maxScore, 1);
            var r = ratio * maxRadius;
            var angle = i * angleStep - Math.PI / 2;
            dataPoints.push((center + r * Math.cos(angle)).toFixed(1) + ',' + (center + r * Math.sin(angle)).toFixed(1));
        }

        var dataPolygon = document.createElementNS(svgNs, 'polygon');
        dataPolygon.setAttribute('points', dataPoints.join(' '));
        dataPolygon.setAttribute('fill', 'rgba(248, 81, 73, 0.15)');
        dataPolygon.setAttribute('stroke', TIER_COLORS.critical);
        dataPolygon.setAttribute('stroke-width', '2');
        svg.appendChild(dataPolygon);

        // Draw data points and labels
        for (var i = 0; i < n; i++) {
            var factor = factors[keys[i]];
            var score = factor.score || 0;
            var maxScore = factor.maxScore || 1;
            var ratio = Math.min(score / maxScore, 1);
            var r = ratio * maxRadius;
            var angle = i * angleStep - Math.PI / 2;
            var px = center + r * Math.cos(angle);
            var py = center + r * Math.sin(angle);

            // Data point dot
            var dot = document.createElementNS(svgNs, 'circle');
            dot.setAttribute('cx', px.toFixed(1));
            dot.setAttribute('cy', py.toFixed(1));
            dot.setAttribute('r', '4');
            dot.setAttribute('fill', TIER_COLORS.critical);
            svg.appendChild(dot);

            // Label
            var labelR = maxRadius + 18;
            var lx = center + labelR * Math.cos(angle);
            var ly = center + labelR * Math.sin(angle);
            var text = document.createElementNS(svgNs, 'text');
            text.setAttribute('x', lx.toFixed(1));
            text.setAttribute('y', ly.toFixed(1));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('fill', 'var(--color-text-secondary, #6b7280)');
            text.setAttribute('font-size', '10');
            text.textContent = FACTOR_LABELS[keys[i]] || keys[i];
            svg.appendChild(text);
        }

        svgWrap.appendChild(svg);
        return svgWrap;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        render: render
    };

})();

// Register page
window.PageRiskScores = PageRiskScores;
