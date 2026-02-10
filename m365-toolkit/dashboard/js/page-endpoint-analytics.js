/**
 * TenantScope - Endpoint Analytics Page
 * Shows device health scores, model comparisons, and app reliability
 * Author: Robel (https://github.com/Thugney)
 */

const PageEndpointAnalytics = (function() {
    'use strict';

    // Import SharedFormatters
    var SF = window.SharedFormatters || {};

    var colSelector = null;
    var currentTab = 'overview';

    // Extract and normalize devices from nested structure
    function extractDevices(rawData) {
        if (Array.isArray(rawData)) return rawData;
        if (!rawData) return [];
        var devices = rawData.deviceScores || [];
        var perfMap = {};
        if (rawData.devicePerformance) {
            rawData.devicePerformance.forEach(function(p) {
                if (p.deviceName) {
                    perfMap[p.deviceName] = {
                        bootTimeMs: p.coreBootTimeInMs,
                        loginTimeMs: p.loginTimeInMs,
                        blueScreenCount: p.blueScreenCount || 0,
                        restartCount: p.restartCount || 0
                    };
                }
            });
        }
        return devices.map(function(d) {
            var perf = perfMap[d.deviceName] || {};
            return {
                id: d.id,
                deviceName: d.deviceName,
                manufacturer: d.manufacturer,
                model: d.model,
                healthScore: d.healthScore || d.endpointAnalyticsScore || 0,
                startupScore: d.startupScore || d.startupPerformanceScore || 0,
                appReliabilityScore: d.appReliabilityScore || 0,
                workFromAnywhereScore: d.workFromAnywhereScore || 0,
                bootTimeSeconds: d.bootTimeSeconds || (perf.bootTimeMs ? Math.round(perf.bootTimeMs / 1000) : null),
                healthStatus: d.healthStatus,
                needsAttention: d.needsAttention,
                blueScreenCount: perf.blueScreenCount || 0,
                restartCount: perf.restartCount || 0
            };
        });
    }

    // Compute summary from devices
    function computeSummary(devices) {
        var total = devices.length;
        if (total === 0) return { total: 0, avgHealth: 0, avgStartup: 0, excellent: 0, good: 0, fair: 0, poor: 0, needsAttention: 0 };

        var totalHealth = 0, totalStartup = 0;
        var excellent = 0, good = 0, fair = 0, poor = 0, needsAttention = 0;

        devices.forEach(function(d) {
            totalHealth += d.healthScore || 0;
            totalStartup += d.startupScore || 0;

            if (d.healthScore >= 80) excellent++;
            else if (d.healthScore >= 60) good++;
            else if (d.healthScore >= 40) fair++;
            else poor++;

            if (d.needsAttention || d.healthScore < 50) needsAttention++;
        });

        return {
            total: total,
            avgHealth: total > 0 ? Math.round(totalHealth / total) : 0,
            avgStartup: total > 0 ? Math.round(totalStartup / total) : 0,
            excellent: excellent,
            good: good,
            fair: fair,
            poor: poor,
            needsAttention: needsAttention
        };
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.toggle('active', btn.dataset.tab === tab); });
        renderTabContent();
    }

    function renderTabContent() {
        var rawData = DataLoader.getData('endpointAnalytics') || {};
        var container = document.getElementById('analytics-content');
        if (currentTab === 'overview') renderOverview(container, rawData);
        else if (currentTab === 'models') renderModelComparison(container, rawData);
        else if (currentTab === 'apps') renderAppReliability(container, rawData);
        else if (currentTab === 'devices') renderDeviceList(container, rawData);
    }

    function renderOverview(container, rawData) {
        var devices = extractDevices(rawData);
        var needsAttentionList = devices.filter(function(d) { return d.needsAttention || d.healthScore < 50; });
        var html = '';
        if (needsAttentionList.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Devices Needing Attention (' + needsAttentionList.length + ')</h3>';
            html += '<table class="data-table"><thead><tr><th>Device</th><th>Model</th><th>Health Score</th><th>Status</th></tr></thead><tbody>';
            needsAttentionList.slice(0, 10).forEach(function(d) {
                html += '<tr>';
                html += '<td><strong>' + (d.deviceName || '--') + '</strong></td>';
                html += '<td>' + (d.model || '--') + '</td>';
                html += '<td>' + formatHealthScoreBadge(d.healthScore) + '</td>';
                html += '<td>' + SF.formatHealthStatus(d.healthStatus || (d.healthScore < 50 ? 'poor' : 'fair')) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            if (needsAttentionList.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + needsAttentionList.length + ' devices. View the All Devices tab for complete list.</p>';
            }
            html += '</div>';
        } else {
            html = '<div class="empty-state"><p>No devices needing attention.</p></div>';
        }

        container.innerHTML = html;
    }

    function renderModelComparison(container, rawData) {
        var devices = extractDevices(rawData);
        var modelInsights = rawData.modelInsights || [];

        // Use pre-computed model insights if available, otherwise aggregate
        var models = [];
        if (modelInsights.length > 0) {
            models = modelInsights.map(function(m) {
                return {
                    model: m.model,
                    manufacturer: m.manufacturer || 'Unknown',
                    count: m.deviceCount || 0,
                    avgHealth: Math.round(m.avgHealthScore || 0),
                    avgStartup: Math.round(m.avgStartupScore || 0),
                    recommendation: m.recommendation || ''
                };
            });
        } else {
            // Aggregate by model from devices
            var modelStats = {};
            devices.forEach(function(d) {
                var model = d.model || 'Unknown';
                if (!modelStats[model]) {
                    modelStats[model] = { count: 0, totalHealth: 0, totalStartup: 0, manufacturer: d.manufacturer };
                }
                modelStats[model].count++;
                modelStats[model].totalHealth += d.healthScore || 0;
                modelStats[model].totalStartup += d.startupScore || 0;
            });

            models = Object.keys(modelStats).map(function(model) {
                var stats = modelStats[model];
                return {
                    model: model,
                    manufacturer: stats.manufacturer || 'Unknown',
                    count: stats.count,
                    avgHealth: Math.round(stats.totalHealth / stats.count),
                    avgStartup: Math.round(stats.totalStartup / stats.count),
                    recommendation: ''
                };
            });
        }

        // Sort by average health score descending
        models.sort(function(a, b) { return b.avgHealth - a.avgHealth; });

        if (models.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Model Data</div><p>Model comparison requires device analytics data.</p></div>';
            return;
        }

        var html = '<div class="analytics-section">';
        html += '<h3>Model Performance Comparison</h3>';
        html += '<p class="section-description">Compare device models by their average health and startup scores. Higher scores indicate better performance.</p>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Model</th><th>Manufacturer</th><th>Devices</th><th>Avg Health</th><th>Avg Startup</th><th>Rating</th><th>Recommendation</th>';
        html += '</tr></thead><tbody>';

        models.forEach(function(m) {
            var rating = m.avgHealth >= 80 ? '<span class="badge badge-success">Excellent</span>' :
                         m.avgHealth >= 60 ? '<span class="badge badge-info">Good</span>' :
                         m.avgHealth >= 40 ? '<span class="badge badge-warning">Fair</span>' :
                         '<span class="badge badge-critical">Poor</span>';

            html += '<tr>';
            html += '<td><strong>' + m.model + '</strong></td>';
            html += '<td>' + m.manufacturer + '</td>';
            html += '<td>' + SF.formatCount(m.count) + '</td>';
            html += '<td>' + formatHealthScoreBadge(m.avgHealth) + '</td>';
            html += '<td>' + formatStartupScoreText(m.avgStartup) + '</td>';
            html += '<td>' + rating + '</td>';
            html += '<td class="cell-truncate">' + (m.recommendation || '--') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        // Best and Worst Models summary
        if (models.length >= 2) {
            var best = models[0];
            var worst = models[models.length - 1];

            html += '<div class="analytics-grid">';
            html += '<div class="analytics-card card-success">';
            html += '<h4>Best Performing Model</h4>';
            html += '<div class="model-highlight">' + best.model + '</div>';
            html += '<div class="model-stats">Avg Score: <strong>' + best.avgHealth + '</strong> | Devices: ' + best.count + '</div>';
            if (best.recommendation) html += '<div class="model-recommendation">' + best.recommendation + '</div>';
            html += '</div>';

            html += '<div class="analytics-card card-danger">';
            html += '<h4>Needs Improvement</h4>';
            html += '<div class="model-highlight">' + worst.model + '</div>';
            html += '<div class="model-stats">Avg Score: <strong>' + worst.avgHealth + '</strong> | Devices: ' + worst.count + '</div>';
            if (worst.recommendation) html += '<div class="model-recommendation">' + worst.recommendation + '</div>';
            html += '</div>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function renderAppReliability(container, rawData) {
        var apps = rawData.appReliability || [];

        if (apps.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No App Reliability Data</div><p>App reliability data shows which applications are causing the most issues.</p></div>';
            return;
        }

        // Sort by crash count descending
        apps = apps.slice().sort(function(a, b) { return (b.appCrashCount || 0) - (a.appCrashCount || 0); });

        var html = '<div class="analytics-section">';
        html += '<h3>Application Reliability</h3>';
        html += '<p class="section-description">Applications sorted by crash frequency. Focus on apps with high crash counts to improve user experience.</p>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Application</th><th>Publisher</th><th>Version</th><th>Crashes</th><th>Hangs</th><th>MTTF (min)</th><th>Devices</th><th>Health</th><th>Trend</th>';
        html += '</tr></thead><tbody>';

        apps.forEach(function(app) {
            var crashClass = (app.appCrashCount || 0) > 50 ? 'text-critical font-bold' : (app.appCrashCount || 0) > 20 ? 'text-warning' : 'text-muted';
            var trend = app.trend || 'stable';
            var trendBadge = trend === 'improving' ? '<span class="badge badge-success">Improving</span>' :
                             trend === 'degrading' ? '<span class="badge badge-critical">Degrading</span>' :
                             '<span class="badge badge-neutral">Stable</span>';

            html += '<tr>';
            html += '<td><strong>' + (app.appName || '--') + '</strong></td>';
            html += '<td>' + (app.appPublisher || '--') + '</td>';
            html += '<td><span class="badge badge-neutral">' + (app.appVersion || '--') + '</span></td>';
            html += '<td><span class="' + crashClass + '">' + SF.formatCount(app.appCrashCount || 0, { zeroIsGood: true }) + '</span></td>';
            html += '<td>' + SF.formatCount(app.appHangCount || 0, { zeroIsGood: true }) + '</td>';
            html += '<td>' + (app.meanTimeToFailure || '--') + '</td>';
            html += '<td>' + SF.formatCount(app.activeDeviceCount) + '</td>';
            html += '<td>' + formatHealthScoreBadge(app.healthScore) + '</td>';
            html += '<td>' + trendBadge + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        // Problem Apps highlight
        var problemApps = apps.filter(function(a) { return (a.appCrashCount || 0) > 20 || (a.healthScore || 100) < 50; });
        if (problemApps.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Apps Requiring Attention (' + problemApps.length + ')</h3>';
            html += '<div class="problem-apps">';
            problemApps.slice(0, 5).forEach(function(app) {
                var trend = app.trend || 'stable';
                var trendIcon = trend === 'degrading' ? ' (Getting Worse)' : '';
                html += '<div class="problem-app-card">';
                html += '<strong>' + (app.appName || 'Unknown') + '</strong>' + trendIcon;
                html += '<div class="app-issue">Crashes: <span class="text-critical">' + (app.appCrashCount || 0) + '</span> | MTTF: ' + (app.meanTimeToFailure || '--') + ' min | Health: ' + (app.healthScore || '--') + '</div>';
                html += '</div>';
            });
            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    function renderDeviceList(container, rawData) {
        var devices = extractDevices(rawData);

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="analytics-search" placeholder="Search devices...">';
        html += '<select class="filter-select" id="analytics-health">';
        html += '<option value="all">All Health</option>';
        html += '<option value="excellent">Excellent (80+)</option>';
        html += '<option value="good">Good (60-79)</option>';
        html += '<option value="fair">Fair (40-59)</option>';
        html += '<option value="poor">Poor (<50)</option>';
        html += '</select>';
        html += '<div id="analytics-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="device-table"></div>';
        container.innerHTML = html;

        // Initialize column selector for devices tab
        colSelector = ColumnSelector.create({
            containerId: 'analytics-colselector',
            storageKey: 'tenantscope-analytics-cols-v1',
            allColumns: [
                { key: 'deviceName', label: 'Device Name' },
                { key: 'model', label: 'Model' },
                { key: 'manufacturer', label: 'Manufacturer' },
                { key: 'healthScore', label: 'Health Score' },
                { key: 'startupScore', label: 'Startup Score' },
                { key: 'appReliabilityScore', label: 'App Reliability' },
                { key: 'workFromAnywhereScore', label: 'WFA Score' },
                { key: 'bootTimeSeconds', label: 'Boot Time' },
                { key: 'healthStatus', label: 'Health Status' },
                { key: 'blueScreenCount', label: 'Blue Screens' },
                { key: 'restartCount', label: 'Restarts' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['deviceName', 'model', 'healthScore', 'startupScore', 'bootTimeSeconds', 'healthStatus', '_adminLinks'],
            onColumnsChanged: function() { applyDeviceFilters(); }
        });

        Filters.setup('analytics-search', applyDeviceFilters);
        Filters.setup('analytics-health', applyDeviceFilters);
        applyDeviceFilters();
    }

    function applyDeviceFilters() {
        var rawData = DataLoader.getData('endpointAnalytics') || {};
        var devices = extractDevices(rawData);

        var filterConfig = {
            search: Filters.getValue('analytics-search'),
            searchFields: ['deviceName', 'model', 'manufacturer'],
            exact: {}
        };

        var filteredData = Filters.apply(devices, filterConfig);

        // Apply health filter
        var healthFilter = Filters.getValue('analytics-health');
        if (healthFilter === 'poor') filteredData = filteredData.filter(function(d) { return d.healthScore < 50; });
        else if (healthFilter === 'fair') filteredData = filteredData.filter(function(d) { return d.healthScore >= 40 && d.healthScore < 60; });
        else if (healthFilter === 'good') filteredData = filteredData.filter(function(d) { return d.healthScore >= 60 && d.healthScore < 80; });
        else if (healthFilter === 'excellent') filteredData = filteredData.filter(function(d) { return d.healthScore >= 80; });

        renderDevicesTable(filteredData);
    }

    function renderDevicesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'model', 'healthScore', 'startupScore', 'bootTimeSeconds', 'healthStatus'];

        var allDefs = [
            { key: 'deviceName', label: 'Device Name', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + v + '</strong></a>';
            }},
            { key: 'model', label: 'Model' },
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'healthScore', label: 'Health Score', formatter: formatHealthScoreBadge },
            { key: 'startupScore', label: 'Startup Score', formatter: formatStartupScoreBadge },
            { key: 'appReliabilityScore', label: 'App Reliability', formatter: formatScoreText },
            { key: 'workFromAnywhereScore', label: 'WFA Score', formatter: formatScoreText },
            { key: 'bootTimeSeconds', label: 'Boot Time', formatter: formatBootTime },
            { key: 'healthStatus', label: 'Health Status', formatter: function(v) { return SF.formatHealthStatus(v); }},
            { key: 'blueScreenCount', label: 'Blue Screens', formatter: function(v) { return SF.formatCount(v, { zeroIsGood: true }); }},
            { key: 'restartCount', label: 'Restarts', formatter: function(v) { return SF.formatCount(v); }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                if (row.id || row.deviceId) {
                    var id = row.id || row.deviceId;
                    return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsBlade/deviceId/' + encodeURIComponent(id) + '" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
                }
                return '--';
            }}
        ];

        Tables.render({
            containerId: 'device-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showDeviceDetails
        });
    }

    // ========================================================================
    // FORMATTERS (using SharedFormatters patterns)
    // ========================================================================

    function formatHealthScoreBadge(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(v));
        var cls = score >= 80 ? 'badge-success' : score >= 60 ? 'badge-info' : score >= 40 ? 'badge-warning' : 'badge-critical';
        return '<span class="badge ' + cls + '">' + score + '</span>';
    }

    function formatStartupScoreBadge(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(v));
        var cls = score >= 70 ? 'badge-success' : score >= 50 ? 'badge-warning' : 'badge-critical';
        return '<span class="badge ' + cls + '">' + score + '</span>';
    }

    function formatStartupScoreText(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(v));
        var cls = score >= 70 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + score + '</span>';
    }

    function formatScoreText(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(v));
        var cls = score >= 70 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + score + '</span>';
    }

    function formatBootTime(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
        var seconds = Math.round(Number(v));
        var cls = seconds <= 60 ? 'text-success' : seconds <= 120 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + seconds + 's</span>';
    }

    // ========================================================================
    // DETAIL MODAL
    // ========================================================================

    function showDeviceDetails(device) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = device.deviceName || 'Device Analytics Details';

        var html = '<div class="detail-grid">';

        // Device Information
        html += '<div class="detail-section"><h4>Device Information</h4><dl class="detail-list">';
        html += '<dt>Device Name</dt><dd>' + (device.deviceName || '--') + '</dd>';
        html += '<dt>Manufacturer</dt><dd>' + (device.manufacturer || '--') + '</dd>';
        html += '<dt>Model</dt><dd>' + (device.model || '--') + '</dd>';
        html += '</dl></div>';

        // Health Scores
        html += '<div class="detail-section"><h4>Health Scores</h4><dl class="detail-list">';
        html += '<dt>Overall Health Score</dt><dd>' + formatHealthScoreBadge(device.healthScore) + '</dd>';
        html += '<dt>Startup Score</dt><dd>' + formatStartupScoreBadge(device.startupScore) + '</dd>';
        html += '<dt>App Reliability Score</dt><dd>' + formatScoreText(device.appReliabilityScore) + '</dd>';
        html += '<dt>Work From Anywhere Score</dt><dd>' + formatScoreText(device.workFromAnywhereScore) + '</dd>';
        html += '<dt>Health Status</dt><dd>' + SF.formatHealthStatus(device.healthStatus) + '</dd>';
        html += '</dl></div>';

        // Performance Metrics
        html += '<div class="detail-section"><h4>Performance Metrics</h4><dl class="detail-list">';
        html += '<dt>Boot Time</dt><dd>' + formatBootTime(device.bootTimeSeconds) + '</dd>';
        html += '<dt>Blue Screen Count</dt><dd>' + SF.formatCount(device.blueScreenCount, { zeroIsGood: true }) + '</dd>';
        html += '<dt>Restart Count</dt><dd>' + SF.formatCount(device.restartCount) + '</dd>';
        html += '</dl></div>';

        // Status
        html += '<div class="detail-section"><h4>Status</h4><dl class="detail-list">';
        html += '<dt>Needs Attention</dt><dd>' + SF.formatBoolean(device.needsAttention) + '</dd>';
        html += '<dt>Device ID</dt><dd style="font-size:0.8em">' + (device.id || '--') + '</dd>';
        html += '</dl></div>';

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    // ========================================================================
    // MAIN RENDER
    // ========================================================================

    function render(container) {
        var rawData = DataLoader.getData('endpointAnalytics') || {};
        var devices = extractDevices(rawData);
        var overview = rawData.overview || {};
        var apps = rawData.appReliability || [];
        var summary = computeSummary(devices);

        var total = summary.total;
        var avgHealth = overview.overallScore || summary.avgHealth;
        var avgStartup = overview.startupPerformanceScore || summary.avgStartup;
        var poorHealth = summary.poor;
        var problemApps = apps.filter(function(a) { return (a.appCrashCount || 0) > 20; }).length;

        var healthClass = avgHealth >= 70 ? '' : avgHealth >= 50 ? ' card-warning' : ' card-danger';
        var avgHealthTextClass = avgHealth >= 70 ? 'text-success' : avgHealth >= 50 ? 'text-warning' : 'text-critical';

        var html = '<div class="page-header"><h2>Endpoint Analytics</h2></div>';

        // Summary cards with standard patterns
        html += '<div class="summary-cards">';
        html += '<div class="summary-card card-info"><div class="summary-value">' + SF.formatCount(total) + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card' + healthClass + '"><div class="summary-value ' + avgHealthTextClass + '">' + avgHealth + '</div><div class="summary-label">Avg Health Score</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + avgStartup + '</div><div class="summary-label">Avg Startup Score</div></div>';
        html += '<div class="summary-card' + (poorHealth > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value">' + poorHealth + '</div><div class="summary-label">Poor Health</div></div>';
        html += '<div class="summary-card' + (problemApps > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + problemApps + '</div><div class="summary-label">Problem Apps</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="models">Model Comparison</button>';
        html += '<button class="tab-btn" data-tab="apps">App Reliability</button>';
        html += '<button class="tab-btn" data-tab="devices">All Devices (' + total + ')</button>';
        html += '</div>';
        html += '<div class="content-area" id="analytics-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderTabContent();
    }

    return { render: render };
})();

window.PageEndpointAnalytics = PageEndpointAnalytics;
