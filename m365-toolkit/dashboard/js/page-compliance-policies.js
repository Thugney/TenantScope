/**
 * TenantScope - Compliance Policies Page
 * Shows Intune compliance policies with device compliance, platform breakdown, and insights
 * Author: Robel (https://github.com/Thugney)
 */

const PageCompliancePolicies = (function() {
    'use strict';

    // Reference to SharedFormatters
    var Formatters = window.SharedFormatters || {};

    /**
     * Escapes HTML special characters to prevent XSS
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var colSelector = null;
    var currentTab = 'overview';

    // Extract data from nested structure
    function extractData(rawData) {
        // Handle both flat array (old) and nested structure (new)
        if (Array.isArray(rawData)) {
            return {
                policies: rawData.map(mapPolicy),
                nonCompliantDevices: [],
                settingFailures: [],
                insights: [],
                summary: computeSummaryFromArray(rawData)
            };
        }
        return {
            policies: (rawData.policies || []).map(mapPolicy),
            nonCompliantDevices: rawData.nonCompliantDevices || [],
            settingFailures: rawData.settingFailures || [],
            insights: rawData.insights || [],
            summary: rawData.summary || computeSummaryFromArray(rawData.policies || [])
        };
    }

    function computeSummaryFromArray(policies) {
        var totalCompliant = 0, totalNonCompliant = 0, totalError = 0;
        var criticalCount = 0;
        var platformBreakdown = {};

        policies.forEach(function(p) {
            var compliant = p.compliantDevices || p.compliantCount || 0;
            var nonCompliant = p.nonCompliantDevices || p.nonCompliantCount || 0;
            var error = p.errorDevices || 0;

            totalCompliant += compliant;
            totalNonCompliant += nonCompliant;
            totalError += error;

            if (p.isCritical) criticalCount++;

            // Platform breakdown
            var platform = p.platform || 'Unknown';
            if (!platformBreakdown[platform]) {
                platformBreakdown[platform] = { policies: 0, compliant: 0, nonCompliant: 0 };
            }
            platformBreakdown[platform].policies++;
            platformBreakdown[platform].compliant += compliant;
            platformBreakdown[platform].nonCompliant += nonCompliant;
        });

        var total = totalCompliant + totalNonCompliant + totalError;
        return {
            totalPolicies: policies.length,
            totalDevices: total,
            compliantDevices: totalCompliant,
            nonCompliantDevices: totalNonCompliant,
            errorDevices: totalError,
            criticalPolicies: criticalCount,
            overallComplianceRate: total > 0 ? Math.round((totalCompliant / total) * 100 * 10) / 10 : 0,
            platformBreakdown: platformBreakdown
        };
    }

    // Map collector field names to display field names
    function mapPolicy(p) {
        return {
            id: p.id,
            displayName: p.displayName,
            description: p.description,
            platform: p.platform,
            category: p.category || 'General',
            isCritical: p.isCritical || false,
            odataType: p.odataType || p['@odata.type'] || null,
            createdDateTime: p.createdDateTime,
            lastModified: p.lastModifiedDateTime || p.lastModified,
            version: p.version || 1,
            assignments: p.assignments || [],
            assignmentCount: p.assignmentCount || (p.assignments ? p.assignments.length : 0),
            compliantCount: p.compliantDevices || p.compliantCount || 0,
            nonCompliantCount: p.nonCompliantDevices || p.nonCompliantCount || 0,
            errorCount: p.errorDevices || p.errorCount || 0,
            conflictCount: p.conflictDevices || p.conflictCount || 0,
            notApplicableCount: p.notApplicableDevices || p.notApplicableCount || 0,
            totalDevices: p.totalDevices || 0,
            complianceRate: p.complianceRate,
            hasIssues: p.hasIssues,
            deviceStatuses: p.deviceStatuses || [],
            settingStatuses: p.settingStatuses || []
        };
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderTabContent();
    }

    function renderTabContent() {
        var data = extractData(DataLoader.getData('compliancePolicies'));
        var container = document.getElementById('compliance-content');
        if (!container) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, data);
                break;
            case 'policies':
                renderPoliciesTab(container, data.policies);
                break;
            case 'devices':
                renderDevicesTab(container, data.nonCompliantDevices);
                break;
            case 'settings':
                renderSettingsTab(container, data.settingFailures);
                break;
        }
    }

    function renderOverview(container, data) {
        var summary = data.summary;
        var policies = data.policies;
        var insights = data.insights;

        var html = '<div class="analytics-section">';
        html += '<h3>Compliance Overview</h3>';

        // Compliance donut chart
        html += '<div class="compliance-overview">';
        html += '<div class="compliance-chart">';
        var rate = summary.overallComplianceRate || 0;
        var compliant = summary.compliantDevices || 0;
        var nonCompliant = summary.nonCompliantDevices || 0;
        var error = summary.errorDevices || 0;
        var rateClass = rate >= 90 ? 'text-success' : rate >= 70 ? 'text-warning' : 'text-critical';

        var radius = 40;
        var circumference = 2 * Math.PI * radius;
        var totalForChart = compliant + nonCompliant + error;
        var compliantDash = totalForChart > 0 ? (compliant / totalForChart) * circumference : 0;
        var nonCompliantDash = totalForChart > 0 ? (nonCompliant / totalForChart) * circumference : 0;
        var errorDash = totalForChart > 0 ? (error / totalForChart) * circumference : 0;

        html += '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        var offset = 0;
        if (compliant > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-success)" stroke-width="10" stroke-dasharray="' + compliantDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += compliantDash;
        }
        if (nonCompliant > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-critical)" stroke-width="10" stroke-dasharray="' + nonCompliantDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
            offset += nonCompliantDash;
        }
        if (error > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-warning)" stroke-width="10" stroke-dasharray="' + errorDash + ' ' + circumference + '" stroke-dashoffset="-' + offset + '" stroke-linecap="round"/>';
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value ' + rateClass + '">' + Math.round(rate) + '%</span><span class="donut-label">Compliant</span></div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="compliance-legend">';
        html += '<div class="legend-item"><span class="legend-dot bg-success"></span> Compliant: <strong>' + Formatters.formatCount ? compliant : compliant + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-critical"></span> Non-Compliant: <strong>' + nonCompliant + '</strong></div>';
        html += '<div class="legend-item"><span class="legend-dot bg-warning"></span> Errors: <strong>' + error + '</strong></div>';
        html += '</div></div></div>';

        // Analytics Grid
        html += '<div class="analytics-grid">';

        // Platform breakdown with mini bars
        html += '<div class="analytics-card">';
        html += '<h4>Platform Breakdown</h4>';
        var platformBreakdown = summary.platformBreakdown || {};
        if (Object.keys(platformBreakdown).length > 0) {
            html += '<div class="platform-list">';
            Object.keys(platformBreakdown).sort().forEach(function(platform) {
                var p = platformBreakdown[platform];
                var total = p.compliant + p.nonCompliant;
                var pRate = total > 0 ? Math.round((p.compliant / total) * 100) : 0;
                html += '<div class="platform-row">';
                html += '<span class="platform-name">' + platform + '</span>';
                html += '<span class="platform-policies">' + p.policies + ' policies</span>';
                html += '<div class="mini-bar"><div class="mini-bar-fill bg-success" style="width:' + pRate + '%"></div></div>';
                html += '<span class="platform-rate">' + pRate + '%</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            // Compute from policies
            var platforms = {};
            policies.forEach(function(p) {
                var plat = p.platform || 'Unknown';
                if (!platforms[plat]) platforms[plat] = { compliant: 0, nonCompliant: 0, count: 0 };
                platforms[plat].compliant += p.compliantCount;
                platforms[plat].nonCompliant += p.nonCompliantCount;
                platforms[plat].count++;
            });
            html += '<div class="platform-list">';
            Object.keys(platforms).sort().forEach(function(platform) {
                var p = platforms[platform];
                var total = p.compliant + p.nonCompliant;
                var pRate = total > 0 ? Math.round((p.compliant / total) * 100) : 0;
                html += '<div class="platform-row">';
                html += '<span class="platform-name">' + platform + '</span>';
                html += '<span class="platform-policies">' + p.count + ' policies</span>';
                html += '<div class="mini-bar"><div class="mini-bar-fill bg-success" style="width:' + pRate + '%"></div></div>';
                html += '<span class="platform-rate">' + pRate + '%</span>';
                html += '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        // Policy categories
        html += '<div class="analytics-card">';
        html += '<h4>Policy Categories</h4>';
        var categories = {};
        policies.forEach(function(p) {
            var cat = p.category || 'General';
            if (!categories[cat]) categories[cat] = { count: 0, issues: 0 };
            categories[cat].count++;
            if (p.hasIssues) categories[cat].issues++;
        });
        html += '<div class="category-list">';
        Object.keys(categories).sort().forEach(function(cat) {
            var c = categories[cat];
            var badgeClass = c.issues > 0 ? 'badge-warning' : 'badge-success';
            html += '<div class="category-row">';
            html += '<span class="category-icon">' + getCategoryIcon(cat) + '</span>';
            html += '<span class="category-name">' + cat + '</span>';
            html += '<span class="badge ' + badgeClass + '">' + c.count + ' policies</span>';
            if (c.issues > 0) html += '<span class="text-warning">(' + c.issues + ' with issues)</span>';
            html += '</div>';
        });
        html += '</div></div>';

        // Compliance by critical status
        html += '<div class="analytics-card">';
        html += '<h4>Critical vs Standard Policies</h4>';
        var criticalPolicies = policies.filter(function(p) { return p.isCritical; });
        var standardPolicies = policies.filter(function(p) { return !p.isCritical; });
        var criticalCompliant = 0, criticalNonCompliant = 0;
        var standardCompliant = 0, standardNonCompliant = 0;
        criticalPolicies.forEach(function(p) {
            criticalCompliant += p.compliantCount;
            criticalNonCompliant += p.nonCompliantCount;
        });
        standardPolicies.forEach(function(p) {
            standardCompliant += p.compliantCount;
            standardNonCompliant += p.nonCompliantCount;
        });
        var criticalTotal = criticalCompliant + criticalNonCompliant;
        var standardTotal = standardCompliant + standardNonCompliant;
        var criticalRate = criticalTotal > 0 ? Math.round((criticalCompliant / criticalTotal) * 100) : 0;
        var standardRate = standardTotal > 0 ? Math.round((standardCompliant / standardTotal) * 100) : 0;

        html += '<div class="platform-list">';
        html += '<div class="platform-row">';
        html += '<span class="platform-name"><span class="badge badge-warning">Critical</span></span>';
        html += '<span class="platform-policies">' + criticalPolicies.length + ' policies</span>';
        html += '<div class="mini-bar"><div class="mini-bar-fill ' + (criticalRate >= 90 ? 'bg-success' : criticalRate >= 70 ? 'bg-warning' : 'bg-critical') + '" style="width:' + criticalRate + '%"></div></div>';
        html += '<span class="platform-rate">' + criticalRate + '%</span>';
        html += '</div>';
        html += '<div class="platform-row">';
        html += '<span class="platform-name"><span class="badge badge-neutral">Standard</span></span>';
        html += '<span class="platform-policies">' + standardPolicies.length + ' policies</span>';
        html += '<div class="mini-bar"><div class="mini-bar-fill ' + (standardRate >= 90 ? 'bg-success' : standardRate >= 70 ? 'bg-warning' : 'bg-critical') + '" style="width:' + standardRate + '%"></div></div>';
        html += '<span class="platform-rate">' + standardRate + '%</span>';
        html += '</div>';
        html += '</div></div>';

        html += '</div>'; // end analytics-grid

        // Insight cards section
        if (insights.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Compliance Insights</h3>';
            html += '<div class="insight-cards">';
            insights.forEach(function(insight) {
                var severityClass = 'insight-' + (insight.severity || 'info');
                var badgeHtml = Formatters.formatSeverity ? Formatters.formatSeverity(insight.severity) : '<span class="badge badge-' + getSeverityBadge(insight.severity) + '">' + (insight.severity || 'info').toUpperCase() + '</span>';
                html += '<div class="insight-card ' + severityClass + '">';
                html += '<div class="insight-header">';
                html += badgeHtml;
                html += '<span class="insight-category">' + (insight.category || '') + '</span>';
                html += '</div>';
                html += '<p class="insight-description">' + insight.description + '</p>';
                if (insight.recommendedAction) {
                    html += '<p class="insight-action"><strong>Action:</strong> ' + insight.recommendedAction + '</p>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        }

        // Policies needing attention
        var problemPolicies = policies.filter(function(p) { return p.isCritical && p.hasIssues; });
        if (problemPolicies.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Critical Policies Needing Attention</h3>';
            html += '<div class="problem-policies">';
            problemPolicies.slice(0, 5).forEach(function(p) {
                var policyRate = p.complianceRate !== null && p.complianceRate !== undefined ? Math.round(p.complianceRate) : null;
                html += '<div class="problem-policy-card">';
                html += '<div class="policy-header">';
                html += '<span class="policy-name">' + escapeHtml(p.displayName) + '</span>';
                html += (Formatters.formatPlatform ? Formatters.formatPlatform(p.platform) : '<span class="badge badge-info">' + escapeHtml(p.platform) + '</span>');
                html += '</div>';
                html += '<div class="policy-stats">';
                html += '<span class="text-critical">' + (Formatters.formatCount ? Formatters.formatCount(p.nonCompliantCount, { zeroIsGood: true }) : p.nonCompliantCount) + ' non-compliant</span>';
                html += '<span class="text-muted">' + p.compliantCount + ' compliant</span>';
                html += '<span>' + (Formatters.formatComplianceRate ? Formatters.formatComplianceRate(policyRate) : (policyRate !== null ? policyRate + '%' : '--')) + '</span>';
                html += '</div></div>';
            });
            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    function getCategoryIcon(category) {
        var icons = {
            'Password': '&#128273;',
            'Encryption': '&#128274;',
            'Security': '&#128737;',
            'OS Version': '&#128187;',
            'Device Health': '&#10084;',
            'General': '&#128203;'
        };
        return icons[category] || '&#128203;';
    }

    function getSeverityBadge(severity) {
        var badges = { 'critical': 'critical', 'high': 'warning', 'medium': 'info', 'low': 'neutral' };
        return badges[severity] || 'neutral';
    }

    function renderPoliciesTab(container, policies) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="policy-search" placeholder="Search policies...">';
        html += '<select class="filter-select" id="policy-platform"><option value="all">All Platforms</option>';
        var platforms = {};
        policies.forEach(function(p) { platforms[p.platform || 'Unknown'] = true; });
        Object.keys(platforms).sort().forEach(function(p) { html += '<option value="' + p + '">' + p + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="policy-category"><option value="all">All Categories</option>';
        var cats = {};
        policies.forEach(function(p) { cats[p.category || 'General'] = true; });
        Object.keys(cats).sort().forEach(function(c) { html += '<option value="' + c + '">' + c + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="policy-critical"><option value="all">All Policies</option>';
        html += '<option value="critical">Critical Only</option><option value="standard">Standard Only</option></select>';
        html += '<div id="policy-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="policies-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'policy-colselector',
            storageKey: 'tenantscope-compliance-cols-v1',
            allColumns: [
                { key: 'displayName', label: 'Policy Name' },
                { key: 'platform', label: 'Platform' },
                { key: 'category', label: 'Category' },
                { key: 'isCritical', label: 'Critical' },
                { key: 'version', label: 'Version' },
                { key: 'assignmentCount', label: 'Assignments' },
                { key: 'compliantCount', label: 'Compliant' },
                { key: 'nonCompliantCount', label: 'Non-Compliant' },
                { key: 'errorCount', label: 'Errors' },
                { key: 'conflictCount', label: 'Conflicts' },
                { key: 'notApplicableCount', label: 'N/A' },
                { key: 'totalDevices', label: 'Total Devices' },
                { key: 'complianceRate', label: 'Compliance %' },
                { key: 'createdDateTime', label: 'Created' },
                { key: 'lastModified', label: 'Modified' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'platform', 'category', 'isCritical', 'compliantCount', 'nonCompliantCount', 'complianceRate', 'totalDevices', '_adminLinks'],
            onColumnsChanged: function() { applyPolicyFilters(); }
        });

        Filters.setup('policy-search', applyPolicyFilters);
        Filters.setup('policy-platform', applyPolicyFilters);
        Filters.setup('policy-category', applyPolicyFilters);
        Filters.setup('policy-critical', applyPolicyFilters);
        applyPolicyFilters();
    }

    function applyPolicyFilters() {
        var data = extractData(DataLoader.getData('compliancePolicies'));
        var policies = data.policies;
        var filterConfig = {
            search: Filters.getValue('policy-search'),
            searchFields: ['displayName', 'description', 'platform'],
            exact: {}
        };

        var platformFilter = Filters.getValue('policy-platform');
        if (platformFilter && platformFilter !== 'all') filterConfig.exact.platform = platformFilter;

        var categoryFilter = Filters.getValue('policy-category');
        if (categoryFilter && categoryFilter !== 'all') filterConfig.exact.category = categoryFilter;

        var filtered = Filters.apply(policies, filterConfig);

        // Critical filter
        var criticalFilter = Filters.getValue('policy-critical');
        if (criticalFilter === 'critical') {
            filtered = filtered.filter(function(p) { return p.isCritical === true; });
        } else if (criticalFilter === 'standard') {
            filtered = filtered.filter(function(p) { return p.isCritical !== true; });
        }

        renderPoliciesTable(filtered);
    }

    function renderPoliciesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'platform', 'category', 'isCritical', 'compliantCount', 'nonCompliantCount', 'complianceRate', 'totalDevices'];

        var allDefs = [
            { key: 'displayName', label: 'Policy Name', formatter: function(v, row) {
                var icon = row.isCritical ? '<span class="critical-icon" title="Critical Policy">&#9888;</span> ' : '';
                return icon + '<strong>' + (v || '--') + '</strong>';
            }},
            { key: 'platform', label: 'Platform', formatter: function(v) {
                return Formatters.formatPlatform ? Formatters.formatPlatform(v) : '<span class="badge badge-info">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'category', label: 'Category', formatter: function(v) {
                return '<span class="badge badge-neutral">' + (v || 'General') + '</span>';
            }},
            { key: 'isCritical', label: 'Critical', formatter: function(v) {
                return Formatters.formatSeverity ? (v ? Formatters.formatSeverity('critical') : '<span class="text-muted">No</span>') : (v ? '<span class="badge badge-warning">Yes</span>' : '<span class="text-muted">No</span>');
            }},
            { key: 'version', label: 'Version', formatter: function(v) {
                return v ? 'v' + v : '--';
            }},
            { key: 'assignmentCount', label: 'Assignments', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v) : (v || 0);
            }},
            { key: 'compliantCount', label: 'Compliant', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v) : (v ? '<span class="text-success">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'nonCompliantCount', label: 'Non-Compliant', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'errorCount', label: 'Errors', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-warning">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'conflictCount', label: 'Conflicts', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-warning">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'notApplicableCount', label: 'N/A', formatter: function(v) {
                return v ? '<span class="text-muted">' + v + '</span>' : '<span class="text-muted">0</span>';
            }},
            { key: 'totalDevices', label: 'Total Devices', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v) : (v || 0);
            }},
            { key: 'complianceRate', label: 'Compliance %', formatter: function(v) {
                return Formatters.formatComplianceRate ? Formatters.formatComplianceRate(v) : formatComplianceRateFallback(v);
            }},
            { key: 'createdDateTime', label: 'Created', formatter: function(v) {
                return Formatters.formatDate ? Formatters.formatDate(v) : formatDateFallback(v);
            }},
            { key: 'lastModified', label: 'Modified', formatter: function(v) {
                return Formatters.formatDate ? Formatters.formatDate(v) : formatDateFallback(v);
            }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesComplianceMenu/~/policies" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'policies-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showPolicyDetails
        });
    }

    function renderDevicesTab(container, devices) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="device-search" placeholder="Search devices...">';
        html += '</div>';
        html += '<div class="table-container" id="devices-table"></div>';
        container.innerHTML = html;

        Filters.setup('device-search', function() {
            var search = Filters.getValue('device-search') || '';
            var filtered = devices.filter(function(d) {
                var deviceName = d.deviceName || '';
                return deviceName.toLowerCase().indexOf(search.toLowerCase()) !== -1 ||
                       (d.userName && d.userName.toLowerCase().indexOf(search.toLowerCase()) !== -1);
            });
            renderNonCompliantDevicesTable(filtered);
        });

        renderNonCompliantDevicesTable(devices);
    }

    function renderNonCompliantDevicesTable(data) {
        var columns = [
            { key: 'deviceName', label: 'Device Name', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + v + '</strong></a>';
            }},
            { key: 'userName', label: 'User', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link">' + v + '</a>';
            }},
            { key: 'failedPolicyCount', label: 'Failed Policies', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v, { zeroIsGood: true }) : (v > 2 ? '<span class="text-critical font-bold">' + v + '</span>' : v > 0 ? '<span class="text-warning">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'failedPolicies', label: 'Policy Names', formatter: function(v) {
                if (!v || !Array.isArray(v) || v.length === 0) return '--';
                return v.slice(0, 3).join(', ') + (v.length > 3 ? ' (+' + (v.length - 3) + ' more)' : '');
            }}
        ];

        Tables.render({
            containerId: 'devices-table',
            data: data,
            columns: columns,
            pageSize: 50
        });

        // Add click handlers for device links to navigate to devices page
        document.querySelectorAll('.device-link').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var deviceName = this.dataset.deviceName;
                if (deviceName && window.navigateToPage) {
                    // Navigate to devices page with search filter
                    window.navigateToPage('devices', { search: deviceName });
                } else if (deviceName) {
                    // Fallback: use hash navigation
                    window.location.hash = '#devices?search=' + encodeURIComponent(deviceName);
                }
            });
        });
    }

    function renderSettingsTab(container, settings) {
        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="setting-search" placeholder="Search settings...">';
        html += '</div>';
        html += '<div class="table-container" id="settings-table"></div>';
        container.innerHTML = html;

        Filters.setup('setting-search', function() {
            var search = Filters.getValue('setting-search') || '';
            var filtered = settings.filter(function(s) {
                var settingName = s.settingName || '';
                var policyName = s.policyName || '';
                return settingName.toLowerCase().indexOf(search.toLowerCase()) !== -1 ||
                       policyName.toLowerCase().indexOf(search.toLowerCase()) !== -1;
            });
            renderSettingsTable(filtered);
        });

        renderSettingsTable(settings);
    }

    function renderSettingsTable(data) {
        var columns = [
            { key: 'settingName', label: 'Setting', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'policyName', label: 'Policy' },
            { key: 'platform', label: 'Platform', formatter: function(v) {
                return Formatters.formatPlatform ? Formatters.formatPlatform(v) : '<span class="badge badge-info">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'nonCompliantCount', label: 'Non-Compliant', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'errorCount', label: 'Errors', formatter: function(v) {
                return Formatters.formatCount ? Formatters.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-warning">' + v + '</span>' : '<span class="text-muted">0</span>');
            }}
        ];

        Tables.render({
            containerId: 'settings-table',
            data: data,
            columns: columns,
            pageSize: 50
        });
    }

    // Fallback formatters if SharedFormatters not available
    function formatComplianceRateFallback(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var pct = Math.round(value);
        var cls = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + pct + '%</span>';
    }

    function formatDateFallback(value) {
        if (!value) return '<span class="text-muted">--</span>';
        try {
            var date = new Date(value);
            return date.toLocaleDateString();
        } catch (e) {
            return '<span class="text-muted">--</span>';
        }
    }

    function showPolicyDetails(policy) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = policy.displayName || 'Policy Details';
        var html = '<div class="detail-grid">';

        // Policy Information
        html += '<div class="detail-section"><h4>Policy Information</h4><dl class="detail-list">';
        html += '<dt>Name</dt><dd>' + (policy.displayName || '--') + '</dd>';
        if (policy.description) {
            html += '<dt>Description</dt><dd>' + policy.description + '</dd>';
        }
        html += '<dt>Platform</dt><dd>' + (Formatters.formatPlatform ? Formatters.formatPlatform(policy.platform) : (policy.platform || '--')) + '</dd>';
        html += '<dt>Category</dt><dd><span class="badge badge-neutral">' + (policy.category || 'General') + '</span></dd>';
        html += '<dt>Critical</dt><dd>' + (policy.isCritical ? (Formatters.formatSeverity ? Formatters.formatSeverity('critical') : '<span class="badge badge-warning">Yes</span>') : 'No') + '</dd>';
        if (policy.odataType) {
            var policyType = policy.odataType.replace('#microsoft.graph.', '').replace('CompliancePolicy', '');
            html += '<dt>Policy Type</dt><dd>' + policyType + '</dd>';
        }
        html += '<dt>Version</dt><dd>' + (policy.version || 1) + '</dd>';
        html += '</dl></div>';

        // Dates Section
        html += '<div class="detail-section"><h4>Timeline</h4><dl class="detail-list">';
        if (policy.createdDateTime) {
            html += '<dt>Created</dt><dd>' + (Formatters.formatDateTime ? Formatters.formatDateTime(policy.createdDateTime) : new Date(policy.createdDateTime).toLocaleString()) + '</dd>';
        }
        if (policy.lastModified) {
            html += '<dt>Last Modified</dt><dd>' + (Formatters.formatDateTime ? Formatters.formatDateTime(policy.lastModified) : new Date(policy.lastModified).toLocaleString()) + '</dd>';
        }
        html += '</dl></div>';

        // Compliance Status
        html += '<div class="detail-section"><h4>Compliance Status</h4><dl class="detail-list">';
        html += '<dt>Compliant</dt><dd>' + (Formatters.formatCount ? Formatters.formatCount(policy.compliantCount) : '<span class="text-success">' + (policy.compliantCount || 0) + '</span>') + '</dd>';
        html += '<dt>Non-Compliant</dt><dd>' + (Formatters.formatCount ? Formatters.formatCount(policy.nonCompliantCount, { zeroIsGood: true }) : '<span class="text-critical">' + (policy.nonCompliantCount || 0) + '</span>') + '</dd>';
        html += '<dt>Errors</dt><dd>' + (Formatters.formatCount ? Formatters.formatCount(policy.errorCount, { zeroIsGood: true }) : '<span class="text-warning">' + (policy.errorCount || 0) + '</span>') + '</dd>';
        html += '<dt>Conflicts</dt><dd>' + (policy.conflictCount || 0) + '</dd>';
        html += '<dt>Not Applicable</dt><dd class="text-muted">' + (policy.notApplicableCount || 0) + '</dd>';
        html += '<dt>Total Devices</dt><dd>' + (Formatters.formatCount ? Formatters.formatCount(policy.totalDevices) : (policy.totalDevices || 0)) + '</dd>';
        html += '<dt>Compliance Rate</dt><dd>' + (Formatters.formatComplianceRate ? Formatters.formatComplianceRate(policy.complianceRate) : formatComplianceRateFallback(policy.complianceRate)) + '</dd>';
        html += '</dl></div>';

        html += '</div>'; // end detail-grid

        // Assignments
        if (policy.assignments && policy.assignments.length > 0) {
            html += '<div class="detail-section"><h4>Assignments (' + policy.assignments.length + ')</h4>';
            html += '<ul class="assignment-list">';
            policy.assignments.forEach(function(a) {
                var icon = a.type === 'AllDevices' ? '&#128421;' : a.type === 'AllUsers' ? '&#128101;' : '&#128193;';
                html += '<li>' + icon + ' ' + (a.name || a.type || 'Unknown') + '</li>';
            });
            html += '</ul></div>';
        }

        // Device Statuses (non-compliant devices)
        if (policy.deviceStatuses && policy.deviceStatuses.length > 0) {
            html += '<div class="detail-section"><h4>Non-Compliant Devices (' + policy.deviceStatuses.length + ')</h4>';
            html += '<table class="detail-table"><thead><tr><th>Device</th><th>User</th><th>Status</th><th>Last Reported</th></tr></thead><tbody>';
            policy.deviceStatuses.forEach(function(d) {
                var statusBadge = d.status === 'nonCompliant' ? '<span class="badge badge-critical">Non-Compliant</span>' :
                                  d.status === 'error' ? '<span class="badge badge-warning">Error</span>' :
                                  '<span class="badge badge-neutral">' + (d.status || '--') + '</span>';
                html += '<tr>';
                html += '<td>' + (d.deviceName || '--') + '</td>';
                html += '<td>' + (d.userName || '--') + '</td>';
                html += '<td>' + statusBadge + '</td>';
                html += '<td>' + (d.lastReportedDateTime ? (Formatters.formatDate ? Formatters.formatDate(d.lastReportedDateTime) : new Date(d.lastReportedDateTime).toLocaleDateString()) : '--') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        // Setting Statuses
        if (policy.settingStatuses && policy.settingStatuses.length > 0) {
            html += '<div class="detail-section"><h4>Setting Status (' + policy.settingStatuses.length + ')</h4>';
            html += '<table class="detail-table"><thead><tr><th>Setting</th><th>Compliant</th><th>Non-Compliant</th><th>Errors</th><th>Conflicts</th></tr></thead><tbody>';
            policy.settingStatuses.forEach(function(s) {
                html += '<tr>';
                html += '<td>' + (s.settingName || '--') + '</td>';
                html += '<td>' + (Formatters.formatCount ? Formatters.formatCount(s.compliantDeviceCount) : '<span class="text-success">' + (s.compliantDeviceCount || 0) + '</span>') + '</td>';
                html += '<td>' + (Formatters.formatCount ? Formatters.formatCount(s.nonCompliantDeviceCount, { zeroIsGood: true }) : '<span class="text-critical">' + (s.nonCompliantDeviceCount || 0) + '</span>') + '</td>';
                html += '<td>' + (Formatters.formatCount ? Formatters.formatCount(s.errorDeviceCount, { zeroIsGood: true }) : '<span class="text-warning">' + (s.errorDeviceCount || 0) + '</span>') + '</td>';
                html += '<td>' + (s.conflictDeviceCount || 0) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function render(container) {
        var data = extractData(DataLoader.getData('compliancePolicies'));
        var summary = data.summary;

        var html = '<div class="page-header"><h2>Compliance Policies</h2></div>';

        // Summary cards with consistent CSS classes
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + (summary.totalPolicies || data.policies.length) + '</div><div class="summary-label">Total Policies</div></div>';

        var rate = summary.overallComplianceRate || 0;
        var rateClass = rate >= 90 ? 'card-success' : rate >= 70 ? 'card-warning' : 'card-danger';
        html += '<div class="summary-card ' + rateClass + '"><div class="summary-value">' + Math.round(rate) + '%</div><div class="summary-label">Overall Compliance</div></div>';

        html += '<div class="summary-card card-success"><div class="summary-value">' + (Formatters.formatCount ? summary.compliantDevices : summary.compliantDevices || 0) + '</div><div class="summary-label">Compliant</div></div>';

        var nonCompliantCardClass = (summary.nonCompliantDevices || 0) > 0 ? 'card-danger' : '';
        html += '<div class="summary-card ' + nonCompliantCardClass + '"><div class="summary-value">' + (summary.nonCompliantDevices || 0) + '</div><div class="summary-label">Non-Compliant</div></div>';

        var criticalCardClass = (summary.criticalPolicies || 0) > 0 ? 'card-warning' : '';
        html += '<div class="summary-card ' + criticalCardClass + '"><div class="summary-value">' + (summary.criticalPolicies || 0) + '</div><div class="summary-label">Critical Policies</div></div>';
        html += '</div>';

        // Tabs
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="policies">Policies (' + data.policies.length + ')</button>';
        html += '<button class="tab-btn" data-tab="devices">Non-Compliant Devices (' + data.nonCompliantDevices.length + ')</button>';
        html += '<button class="tab-btn" data-tab="settings">Setting Failures (' + data.settingFailures.length + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="compliance-content"></div>';
        container.innerHTML = html;

        // Set up tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchTab(this.dataset.tab);
            });
        });

        // Render initial tab
        currentTab = 'overview';
        renderTabContent();
    }

    return { render: render };
})();

window.PageCompliancePolicies = PageCompliancePolicies;
