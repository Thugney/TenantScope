/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: CIS BENCHMARKS
 *
 * Renders the CIS M365 Benchmark audit results page with:
 * - Overall compliance score ring
 * - Summary stat cards
 * - Per-section score breakdown with progress bars
 * - Filterable controls table with tabs
 * - Remediation panel for failed controls
 *
 * Data source: DataLoader.getData('cisBenchmark')
 * All dynamic content is escaped via escapeHtml() before rendering.
 */

const PageBenchmarks = (function() {
    'use strict';

    var currentTab = 'all';
    var expandedControls = {};

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
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        try {
            return new Date(dateStr).toLocaleDateString('en-GB', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
        } catch (e) { return '--'; }
    }

    /**
     * Returns a color based on score thresholds.
     * green >= 80, yellow >= 60, red < 60
     */
    function scoreColor(score) {
        if (score >= 80) return '#3fb950';
        if (score >= 60) return '#d29922';
        return '#f85149';
    }

    /**
     * Returns a CSS class suffix based on score thresholds.
     */
    function scoreClass(score) {
        if (score >= 80) return 'success';
        if (score >= 60) return 'warning';
        return 'critical';
    }

    /**
     * Returns a color for severity badges.
     */
    function severityColor(severity) {
        var colors = {
            'critical': '#dc3545',
            'high': '#fd7e14',
            'medium': '#ffc107',
            'low': '#17a2b8'
        };
        return colors[(severity || '').toLowerCase()] || '#484f58';
    }

    /**
     * Returns a color for status badges.
     */
    function statusColor(status) {
        var colors = {
            'pass': '#3fb950',
            'passed': '#3fb950',
            'fail': '#f85149',
            'failed': '#f85149',
            'warning': '#d29922',
            'manual': '#58a6ff',
            'no-data': '#484f58',
            'nodata': '#484f58',
            'error': '#f85149'
        };
        return colors[(status || '').toLowerCase()] || '#484f58';
    }

    /**
     * Returns the badge CSS class for status values.
     */
    function statusBadgeClass(status) {
        var classes = {
            'pass': 'badge-success',
            'passed': 'badge-success',
            'fail': 'badge-critical',
            'failed': 'badge-critical',
            'warning': 'badge-warning',
            'manual': 'badge-info',
            'no-data': 'badge-neutral',
            'nodata': 'badge-neutral',
            'error': 'badge-critical'
        };
        return classes[(status || '').toLowerCase()] || 'badge-neutral';
    }

    /**
     * Returns the badge CSS class for severity values.
     */
    function severityBadgeClass(severity) {
        var classes = {
            'critical': 'badge-critical',
            'high': 'badge-warning',
            'medium': 'badge-info',
            'low': 'badge-neutral'
        };
        return classes[(severity || '').toLowerCase()] || 'badge-neutral';
    }

    // ========================================================================
    // TAB MANAGEMENT
    // ========================================================================

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('#benchmarks-tab-bar .tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderControlsTable();
    }

    // ========================================================================
    // RENDER: MAIN
    // ========================================================================

    function render(container) {
        var data = DataLoader.getData('cisBenchmark');

        container.textContent = '';

        // Handle empty / null data
        if (!data || !data.summary) {
            var empty = el('div', 'empty-state');
            empty.appendChild(el('div', 'empty-state-title', 'No Benchmark Data'));
            empty.appendChild(el('div', 'empty-state-description',
                'No benchmark data available. Run Invoke-CISBenchmarkAudit.ps1 to generate CIS Benchmark audit results.'));
            container.appendChild(empty);
            return;
        }

        var summary = data.summary || {};
        var sectionScores = data.sectionScores || {};
        var controls = data.controls || [];
        var benchmarkVersion = data.benchmarkVersion || '--';
        var auditDate = data.auditDate || null;
        var complianceScore = summary.complianceScore || 0;

        // Reset expanded state
        expandedControls = {};

        // 1. Page Header
        renderPageHeader(container, benchmarkVersion, auditDate, data.includesLevel2);

        // 2. Score Ring + Summary Cards row
        renderScoreAndSummary(container, summary, complianceScore);

        // 3. Section Scores
        renderSectionScores(container, sectionScores);

        // 4. Controls Table with Tabs
        renderControlsSection(container, controls);

        // 5. Remediation Panel
        renderRemediationPanel(container, controls);
    }

    // ========================================================================
    // RENDER: PAGE HEADER
    // ========================================================================

    function renderPageHeader(container, benchmarkVersion, auditDate, includesLevel2) {
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'CIS M365 Benchmark'));

        var subtitle = 'Version ' + escapeHtml(benchmarkVersion);
        if (auditDate) {
            subtitle += '  \u2022  Audit Date: ' + formatDate(auditDate);
        }
        if (includesLevel2) {
            subtitle += '  \u2022  Includes Level 2 Controls';
        }
        header.appendChild(el('p', 'page-description', subtitle));

        container.appendChild(header);
    }

    // ========================================================================
    // RENDER: SCORE RING + SUMMARY CARDS
    // ========================================================================

    function renderScoreAndSummary(container, summary, complianceScore) {
        var wrapper = el('div', 'benchmark-score-section');
        wrapper.style.display = 'flex';
        wrapper.style.gap = '24px';
        wrapper.style.alignItems = 'flex-start';
        wrapper.style.marginBottom = '24px';
        wrapper.style.flexWrap = 'wrap';

        // Score Ring
        var ringContainer = el('div', 'benchmark-score-ring');
        ringContainer.style.flexShrink = '0';
        ringContainer.style.display = 'flex';
        ringContainer.style.justifyContent = 'center';
        ringContainer.style.alignItems = 'center';

        var ringSize = 160;
        var radius = 62;
        var circumference = 2 * Math.PI * radius;
        var dashLength = (complianceScore / 100) * circumference;
        var color = scoreColor(complianceScore);

        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', String(ringSize));
        svg.setAttribute('height', String(ringSize));
        svg.setAttribute('viewBox', '0 0 ' + ringSize + ' ' + ringSize);
        svg.style.display = 'block';

        // Background circle
        var bgCircle = document.createElementNS(svgNS, 'circle');
        bgCircle.setAttribute('cx', String(ringSize / 2));
        bgCircle.setAttribute('cy', String(ringSize / 2));
        bgCircle.setAttribute('r', String(radius));
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.08)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        // Score arc
        var scoreCircle = document.createElementNS(svgNS, 'circle');
        scoreCircle.setAttribute('cx', String(ringSize / 2));
        scoreCircle.setAttribute('cy', String(ringSize / 2));
        scoreCircle.setAttribute('r', String(radius));
        scoreCircle.setAttribute('fill', 'none');
        scoreCircle.setAttribute('stroke', color);
        scoreCircle.setAttribute('stroke-width', '12');
        scoreCircle.setAttribute('stroke-linecap', 'round');
        scoreCircle.setAttribute('stroke-dasharray', dashLength + ' ' + circumference);
        scoreCircle.setAttribute('stroke-dashoffset', String(circumference * 0.25));
        scoreCircle.setAttribute('transform', 'rotate(-90 ' + (ringSize / 2) + ' ' + (ringSize / 2) + ')');
        svg.appendChild(scoreCircle);

        // Center text
        var scoreText = document.createElementNS(svgNS, 'text');
        scoreText.setAttribute('x', String(ringSize / 2));
        scoreText.setAttribute('y', String(ringSize / 2 - 6));
        scoreText.setAttribute('text-anchor', 'middle');
        scoreText.setAttribute('dominant-baseline', 'middle');
        scoreText.setAttribute('fill', color);
        scoreText.setAttribute('font-size', '32');
        scoreText.setAttribute('font-weight', '700');
        scoreText.textContent = Math.round(complianceScore) + '%';
        svg.appendChild(scoreText);

        var labelText = document.createElementNS(svgNS, 'text');
        labelText.setAttribute('x', String(ringSize / 2));
        labelText.setAttribute('y', String(ringSize / 2 + 18));
        labelText.setAttribute('text-anchor', 'middle');
        labelText.setAttribute('dominant-baseline', 'middle');
        labelText.setAttribute('fill', '#8b949e');
        labelText.setAttribute('font-size', '12');
        labelText.textContent = 'Compliance';
        svg.appendChild(labelText);

        ringContainer.appendChild(svg);
        wrapper.appendChild(ringContainer);

        // Summary Cards
        var cardsContainer = el('div', 'summary-cards');
        cardsContainer.style.flex = '1';

        var passed = summary.passed || 0;
        var failed = summary.failed || 0;
        var warnings = summary.warnings || 0;
        var manual = summary.manual || 0;
        var noData = summary.noData || 0;
        var errors = summary.errors || 0;

        // Passed card
        var passedCard = el('div', 'summary-card card-success');
        passedCard.appendChild(el('div', 'summary-value text-success', String(passed)));
        passedCard.appendChild(el('div', 'summary-label', 'Passed'));
        cardsContainer.appendChild(passedCard);

        // Failed card
        var failedCard = el('div', 'summary-card card-danger');
        failedCard.appendChild(el('div', 'summary-value text-critical', String(failed)));
        failedCard.appendChild(el('div', 'summary-label', 'Failed'));
        cardsContainer.appendChild(failedCard);

        // Warnings card
        var warningsCard = el('div', 'summary-card card-warning');
        warningsCard.appendChild(el('div', 'summary-value text-warning', String(warnings)));
        warningsCard.appendChild(el('div', 'summary-label', 'Warnings'));
        cardsContainer.appendChild(warningsCard);

        // Manual card
        var manualCard = el('div', 'summary-card card-info');
        manualCard.appendChild(el('div', 'summary-value', String(manual)));
        manualCard.style.cssText = '';
        var manualValue = manualCard.querySelector('.summary-value');
        if (manualValue) manualValue.style.color = '#58a6ff';
        manualCard.appendChild(el('div', 'summary-label', 'Manual'));
        cardsContainer.appendChild(manualCard);

        // No Data card
        var noDataCard = el('div', 'summary-card');
        var noDataValue = el('div', 'summary-value', String(noData + errors));
        noDataValue.style.color = '#484f58';
        noDataCard.appendChild(noDataValue);
        noDataCard.appendChild(el('div', 'summary-label', 'No Data / Errors'));
        cardsContainer.appendChild(noDataCard);

        // Compliance % card
        var compCard = el('div', 'summary-card');
        var compValue = el('div', 'summary-value', Math.round(complianceScore) + '%');
        compValue.style.color = scoreColor(complianceScore);
        compCard.appendChild(compValue);
        compCard.appendChild(el('div', 'summary-label', 'Compliance Score'));
        cardsContainer.appendChild(compCard);

        wrapper.appendChild(cardsContainer);
        container.appendChild(wrapper);
    }

    // ========================================================================
    // RENDER: SECTION SCORES
    // ========================================================================

    function renderSectionScores(container, sectionScores) {
        var sectionNames = Object.keys(sectionScores);
        if (sectionNames.length === 0) return;

        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Section Scores'));

        var scoresContainer = el('div', 'section-scores');
        scoresContainer.style.display = 'flex';
        scoresContainer.style.flexDirection = 'column';
        scoresContainer.style.gap = '8px';

        sectionNames.forEach(function(name) {
            var s = sectionScores[name];
            var score = s.score || 0;
            var passed = s.passed || 0;
            var total = s.total || 0;
            var color = scoreColor(score);

            var row = el('div', 'section-score-row');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '12px';
            row.style.padding = '8px 12px';
            row.style.background = 'rgba(255,255,255,0.03)';
            row.style.borderRadius = '6px';

            // Section name
            var nameEl = el('div', 'section-score-name');
            nameEl.textContent = name;
            nameEl.style.flex = '0 0 260px';
            nameEl.style.color = '#e6edf3';
            nameEl.style.fontSize = '0.9em';
            nameEl.style.whiteSpace = 'nowrap';
            nameEl.style.overflow = 'hidden';
            nameEl.style.textOverflow = 'ellipsis';
            nameEl.title = name;
            row.appendChild(nameEl);

            // Progress bar
            var barWrap = el('div', 'section-score-bar');
            barWrap.style.flex = '1';
            barWrap.style.height = '8px';
            barWrap.style.background = 'rgba(255,255,255,0.06)';
            barWrap.style.borderRadius = '4px';
            barWrap.style.overflow = 'hidden';

            var barFill = el('div');
            barFill.style.height = '100%';
            barFill.style.width = Math.round(score) + '%';
            barFill.style.background = color;
            barFill.style.borderRadius = '4px';
            barFill.style.transition = 'width 0.3s ease';
            barWrap.appendChild(barFill);
            row.appendChild(barWrap);

            // Score percentage
            var scorePct = el('div', 'section-score-pct');
            scorePct.textContent = Math.round(score) + '%';
            scorePct.style.flex = '0 0 50px';
            scorePct.style.textAlign = 'right';
            scorePct.style.fontWeight = '600';
            scorePct.style.color = color;
            row.appendChild(scorePct);

            // Pass count / total
            var countEl = el('div', 'section-score-count');
            countEl.textContent = passed + ' / ' + total;
            countEl.style.flex = '0 0 60px';
            countEl.style.textAlign = 'right';
            countEl.style.color = '#8b949e';
            countEl.style.fontSize = '0.85em';
            row.appendChild(countEl);

            scoresContainer.appendChild(row);
        });

        section.appendChild(scoresContainer);
        container.appendChild(section);
    }

    // ========================================================================
    // RENDER: CONTROLS TABLE
    // ========================================================================

    function renderControlsSection(container, controls) {
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Controls'));

        // Tab bar
        var tabBar = el('div', 'tab-bar');
        tabBar.id = 'benchmarks-tab-bar';

        var failedCount = controls.filter(function(c) { return c.status === 'fail' || c.status === 'failed'; }).length;
        var warningCount = controls.filter(function(c) { return c.status === 'warning'; }).length;
        var passedCount = controls.filter(function(c) { return c.status === 'pass' || c.status === 'passed'; }).length;
        var manualCount = controls.filter(function(c) { return c.status === 'manual'; }).length;

        var tabs = [
            { id: 'all', label: 'All (' + controls.length + ')' },
            { id: 'failed', label: 'Failed (' + failedCount + ')' },
            { id: 'warnings', label: 'Warnings (' + warningCount + ')' },
            { id: 'passed', label: 'Passed (' + passedCount + ')' },
            { id: 'manual', label: 'Manual (' + manualCount + ')' }
        ];

        tabs.forEach(function(t) {
            var btn = el('button', 'tab-btn' + (t.id === currentTab ? ' active' : ''));
            btn.dataset.tab = t.id;
            btn.textContent = t.label;
            btn.addEventListener('click', function() { switchTab(t.id); });
            tabBar.appendChild(btn);
        });

        section.appendChild(tabBar);

        // Table container
        var tableArea = el('div', 'content-area');
        tableArea.id = 'benchmarks-controls-content';
        section.appendChild(tableArea);

        container.appendChild(section);

        // Render initial tab
        currentTab = 'all';
        renderControlsTable();
    }

    function renderControlsTable() {
        var tableArea = document.getElementById('benchmarks-controls-content');
        if (!tableArea) return;

        var data = DataLoader.getData('cisBenchmark');
        if (!data || !data.controls) return;

        var controls = data.controls || [];

        // Filter based on current tab
        var filtered;
        switch (currentTab) {
            case 'failed':
                filtered = controls.filter(function(c) { return c.status === 'fail' || c.status === 'failed'; });
                break;
            case 'warnings':
                filtered = controls.filter(function(c) { return c.status === 'warning'; });
                break;
            case 'passed':
                filtered = controls.filter(function(c) { return c.status === 'pass' || c.status === 'passed'; });
                break;
            case 'manual':
                filtered = controls.filter(function(c) { return c.status === 'manual'; });
                break;
            default:
                filtered = controls;
        }

        tableArea.textContent = '';

        if (filtered.length === 0) {
            var empty = el('div', 'empty-state');
            empty.appendChild(el('div', 'empty-state-title', 'No controls match this filter'));
            empty.appendChild(el('div', 'empty-state-description', 'Try selecting a different tab.'));
            tableArea.appendChild(empty);
            return;
        }

        // Use Tables.render() if available
        if (typeof Tables !== 'undefined' && Tables.render) {
            var tableDiv = el('div');
            tableDiv.id = 'benchmarks-controls-table';
            tableArea.appendChild(tableDiv);

            Tables.render({
                containerId: 'benchmarks-controls-table',
                data: filtered,
                columns: [
                    { key: 'id', label: 'ID', sortable: true, filterable: false },
                    { key: 'title', label: 'Title', sortable: true, filterable: false, className: 'cell-truncate' },
                    { key: 'section', label: 'Section', sortable: true, filterable: true },
                    { key: 'level', label: 'Level', sortable: true, filterable: true,
                        formatter: function(v) {
                            if (!v) return '<span class="text-muted">--</span>';
                            var cls = v === 'L1' || v === '1' || v === 'Level 1' ? 'badge-info' : 'badge-warning';
                            return '<span class="badge ' + cls + '">' + escapeHtml(String(v)) + '</span>';
                        }
                    },
                    { key: 'severity', label: 'Severity', sortable: true, filterable: true,
                        formatter: function(v) {
                            if (!v) return '<span class="text-muted">--</span>';
                            return '<span class="badge ' + severityBadgeClass(v) + '">' + escapeHtml(String(v)).toUpperCase() + '</span>';
                        }
                    },
                    { key: 'status', label: 'Status', sortable: true, filterable: true,
                        formatter: function(v) {
                            if (!v) return '<span class="text-muted">--</span>';
                            return '<span class="badge ' + statusBadgeClass(v) + '">' + escapeHtml(String(v)).toUpperCase() + '</span>';
                        }
                    },
                    { key: 'details', label: 'Details', sortable: false, filterable: false, className: 'cell-truncate',
                        formatter: function(v) {
                            if (!v) return '<span class="text-muted">--</span>';
                            var text = String(v);
                            if (text.length > 80) text = text.substring(0, 80) + '...';
                            return escapeHtml(text);
                        }
                    }
                ],
                pageSize: 25,
                onRowClick: function(control) {
                    showControlDetail(control);
                },
                getRowClass: function(row) {
                    var st = (row.status || '').toLowerCase();
                    if (st === 'fail' || st === 'failed') return 'row-critical';
                    if (st === 'warning') return 'row-warning';
                    return '';
                }
            });
        } else {
            // Fallback: simple table
            renderSimpleTable(tableArea, filtered);
        }
    }

    /**
     * Fallback table rendering when Tables module is not available.
     */
    function renderSimpleTable(container, controls) {
        var tableWrap = el('div', 'table-container');
        var table = el('table', 'data-table');

        var thead = el('thead');
        var headerRow = el('tr');
        ['ID', 'Title', 'Section', 'Level', 'Severity', 'Status', 'Details'].forEach(function(h) {
            headerRow.appendChild(el('th', null, h));
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = el('tbody');
        controls.forEach(function(c) {
            var row = el('tr');
            var st = (c.status || '').toLowerCase();
            if (st === 'fail' || st === 'failed') row.className = 'row-critical';
            else if (st === 'warning') row.className = 'row-warning';

            row.style.cursor = 'pointer';
            row.addEventListener('click', function() {
                showControlDetail(c);
            });

            row.appendChild(el('td', null, c.id || '--'));

            var titleCell = el('td', 'cell-truncate');
            titleCell.textContent = c.title || '--';
            row.appendChild(titleCell);

            row.appendChild(el('td', null, c.section || '--'));

            // Level badge
            var levelCell = el('td');
            if (c.level) {
                var levelBadge = el('span', 'badge badge-info');
                levelBadge.textContent = c.level;
                levelCell.appendChild(levelBadge);
            } else {
                levelCell.textContent = '--';
            }
            row.appendChild(levelCell);

            // Severity badge
            var sevCell = el('td');
            if (c.severity) {
                var sevBadge = el('span', 'badge ' + severityBadgeClass(c.severity));
                sevBadge.textContent = c.severity.toUpperCase();
                sevCell.appendChild(sevBadge);
            } else {
                sevCell.textContent = '--';
            }
            row.appendChild(sevCell);

            // Status badge
            var statCell = el('td');
            if (c.status) {
                var statBadge = el('span', 'badge ' + statusBadgeClass(c.status));
                statBadge.textContent = c.status.toUpperCase();
                statCell.appendChild(statBadge);
            } else {
                statCell.textContent = '--';
            }
            row.appendChild(statCell);

            // Details (truncated)
            var detailCell = el('td', 'cell-truncate');
            var detailText = c.details || '--';
            if (detailText.length > 80) detailText = detailText.substring(0, 80) + '...';
            detailCell.textContent = detailText;
            row.appendChild(detailCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        container.appendChild(tableWrap);
    }

    // ========================================================================
    // CONTROL DETAIL MODAL
    // ========================================================================

    function showControlDetail(control) {
        var overlay = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!overlay || !title || !body) return;

        title.textContent = (control.id || 'Control') + ' - ' + (control.title || 'Details');
        body.textContent = '';

        var details = el('div', 'detail-list');

        // ID
        var idLabel = el('span', 'detail-label', 'Control ID:');
        var idValue = el('span', 'detail-value', control.id || '--');
        details.appendChild(idLabel);
        details.appendChild(idValue);

        // Section
        var secLabel = el('span', 'detail-label', 'Section:');
        var secValue = el('span', 'detail-value', control.section || '--');
        details.appendChild(secLabel);
        details.appendChild(secValue);

        // Level
        var lvlLabel = el('span', 'detail-label', 'Level:');
        var lvlValue = el('span', 'detail-value', control.level || '--');
        details.appendChild(lvlLabel);
        details.appendChild(lvlValue);

        // Severity
        var sevLabel = el('span', 'detail-label', 'Severity:');
        var sevValue = el('span', 'detail-value');
        if (control.severity) {
            var sevBadge = el('span', 'badge ' + severityBadgeClass(control.severity));
            sevBadge.textContent = control.severity.toUpperCase();
            sevValue.appendChild(sevBadge);
        } else {
            sevValue.textContent = '--';
        }
        details.appendChild(sevLabel);
        details.appendChild(sevValue);

        // Status
        var stLabel = el('span', 'detail-label', 'Status:');
        var stValue = el('span', 'detail-value');
        if (control.status) {
            var stBadge = el('span', 'badge ' + statusBadgeClass(control.status));
            stBadge.textContent = control.status.toUpperCase();
            stValue.appendChild(stBadge);
        } else {
            stValue.textContent = '--';
        }
        details.appendChild(stLabel);
        details.appendChild(stValue);

        // Details
        var detLabel = el('span', 'detail-label', 'Details:');
        var detValue = el('span', 'detail-value', control.details || '--');
        details.appendChild(detLabel);
        details.appendChild(detValue);

        body.appendChild(details);

        // Remediation block
        if (control.remediation) {
            var remSection = el('div');
            remSection.style.marginTop = '16px';

            var remTitle = el('h4', null, 'Remediation');
            remTitle.style.color = '#e6edf3';
            remTitle.style.marginBottom = '8px';
            remSection.appendChild(remTitle);

            var remBlock = el('pre');
            remBlock.style.background = '#161b22';
            remBlock.style.color = '#c9d1d9';
            remBlock.style.padding = '12px 16px';
            remBlock.style.borderRadius = '6px';
            remBlock.style.border = '1px solid rgba(255,255,255,0.1)';
            remBlock.style.fontSize = '0.85em';
            remBlock.style.fontFamily = '"Cascadia Code", "Fira Code", "Consolas", monospace';
            remBlock.style.whiteSpace = 'pre-wrap';
            remBlock.style.wordBreak = 'break-word';
            remBlock.style.overflowX = 'auto';
            remBlock.style.maxHeight = '300px';
            remBlock.style.overflowY = 'auto';
            remBlock.textContent = control.remediation;
            remSection.appendChild(remBlock);

            body.appendChild(remSection);
        }

        overlay.classList.add('visible');
    }

    // ========================================================================
    // RENDER: REMEDIATION PANEL
    // ========================================================================

    function renderRemediationPanel(container, controls) {
        var failed = controls.filter(function(c) {
            var st = (c.status || '').toLowerCase();
            return st === 'fail' || st === 'failed';
        });

        if (failed.length === 0) return;

        var section = el('div', 'analytics-section');
        section.style.marginTop = '24px';
        section.appendChild(el('h3', null, 'Remediation Guidance'));

        var desc = el('p', 'section-description',
            'Failed controls requiring remediation (' + failed.length + ' items)');
        desc.style.color = '#8b949e';
        desc.style.marginBottom = '12px';
        section.appendChild(desc);

        failed.forEach(function(control) {
            var card = el('div', 'remediation-card');
            card.style.background = 'rgba(255,255,255,0.03)';
            card.style.border = '1px solid rgba(255,255,255,0.06)';
            card.style.borderRadius = '8px';
            card.style.marginBottom = '8px';
            card.style.overflow = 'hidden';

            // Card header (always visible)
            var header = el('div', 'remediation-header');
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.gap = '12px';
            header.style.padding = '12px 16px';
            header.style.cursor = 'pointer';

            // Expand/collapse indicator
            var expandIcon = el('span', 'expand-icon');
            var isExpanded = expandedControls[control.id] || false;
            expandIcon.textContent = isExpanded ? '\u25BC' : '\u25B6';
            expandIcon.style.color = '#8b949e';
            expandIcon.style.fontSize = '0.75em';
            expandIcon.style.flexShrink = '0';
            header.appendChild(expandIcon);

            // Control ID
            var idSpan = el('span', null, control.id || '--');
            idSpan.style.fontWeight = '600';
            idSpan.style.color = '#e6edf3';
            idSpan.style.flexShrink = '0';
            header.appendChild(idSpan);

            // Title
            var titleSpan = el('span', null, control.title || '--');
            titleSpan.style.flex = '1';
            titleSpan.style.color = '#e6edf3';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.style.whiteSpace = 'nowrap';
            header.appendChild(titleSpan);

            // Severity badge
            if (control.severity) {
                var sevBadge = el('span', 'badge ' + severityBadgeClass(control.severity));
                sevBadge.textContent = control.severity.toUpperCase();
                sevBadge.style.flexShrink = '0';
                header.appendChild(sevBadge);
            }

            // Status badge
            var failBadge = el('span', 'badge badge-critical');
            failBadge.textContent = 'FAILED';
            failBadge.style.flexShrink = '0';
            header.appendChild(failBadge);

            card.appendChild(header);

            // Card body (expandable)
            var body = el('div', 'remediation-body');
            body.style.display = isExpanded ? 'block' : 'none';
            body.style.padding = '0 16px 16px 42px';

            // Details text
            if (control.details) {
                var detailP = el('p', null, control.details);
                detailP.style.color = '#8b949e';
                detailP.style.marginBottom = '12px';
                detailP.style.lineHeight = '1.5';
                body.appendChild(detailP);
            }

            // Remediation code block
            if (control.remediation) {
                var remLabel = el('div', null, 'Remediation:');
                remLabel.style.color = '#e6edf3';
                remLabel.style.fontWeight = '600';
                remLabel.style.marginBottom = '6px';
                body.appendChild(remLabel);

                var remBlock = el('pre');
                remBlock.style.background = '#0d1117';
                remBlock.style.color = '#c9d1d9';
                remBlock.style.padding = '12px 16px';
                remBlock.style.borderRadius = '6px';
                remBlock.style.border = '1px solid rgba(255,255,255,0.1)';
                remBlock.style.fontSize = '0.85em';
                remBlock.style.fontFamily = '"Cascadia Code", "Fira Code", "Consolas", monospace';
                remBlock.style.whiteSpace = 'pre-wrap';
                remBlock.style.wordBreak = 'break-word';
                remBlock.style.overflowX = 'auto';
                remBlock.style.maxHeight = '300px';
                remBlock.style.overflowY = 'auto';
                remBlock.style.margin = '0';
                remBlock.textContent = control.remediation;
                body.appendChild(remBlock);
            } else {
                var noRem = el('p', 'text-muted', 'No remediation guidance available for this control.');
                noRem.style.fontStyle = 'italic';
                body.appendChild(noRem);
            }

            card.appendChild(body);

            // Toggle expand/collapse on header click
            header.addEventListener('click', (function(ctrl, bodyEl, iconEl) {
                return function() {
                    var expanded = bodyEl.style.display !== 'none';
                    bodyEl.style.display = expanded ? 'none' : 'block';
                    iconEl.textContent = expanded ? '\u25B6' : '\u25BC';
                    expandedControls[ctrl.id] = !expanded;
                };
            })(control, body, expandIcon));

            section.appendChild(card);
        });

        container.appendChild(section);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        render: render
    };

})();

// Register page
window.PageBenchmarks = PageBenchmarks;
