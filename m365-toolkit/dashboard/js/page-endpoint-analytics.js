/**
 * TenantScope - Endpoint Analytics Page
 * Exposes the collected Endpoint Analytics datasets without requiring another collector.
 * Author: Robel (https://github.com/Thugney)
 */

const PageEndpointAnalytics = (function() {
    'use strict';

    var SF = window.SharedFormatters || {};

    var colSelector = null;
    var currentTab = 'overview';

    function formatCount(value, options) {
        if (SF.formatCount) return SF.formatCount(value, options);
        if (value === null || value === undefined || value === '') return '--';
        return String(value);
    }

    function formatBoolean(value) {
        if (SF.formatBoolean) return SF.formatBoolean(value);
        if (value === true) return '<span class="text-success font-bold">Yes</span>';
        if (value === false) return '<span class="text-critical">No</span>';
        return '<span class="text-muted">--</span>';
    }

    function formatHealthStatus(value) {
        if (!value) return '<span class="text-muted">--</span>';
        if (SF.formatHealthStatus) return SF.formatHealthStatus(value);

        var status = String(value);
        var lower = status.toLowerCase();
        var cls = lower === 'excellent' || lower === 'good' || lower === 'meetinggoals'
            ? 'badge-success'
            : lower === 'fair' || lower === 'needsattention'
                ? 'badge-warning'
                : lower === 'poor' || lower === 'critical'
                    ? 'badge-critical'
                    : 'badge-neutral';
        return '<span class="badge ' + cls + '">' + status + '</span>';
    }

    function hasNumber(value) {
        return value !== null && value !== undefined && value !== '' && !isNaN(Number(value));
    }

    function hasAnyValue(values) {
        for (var i = 0; i < values.length; i++) {
            var value = values[i];
            if (value === null || value === undefined || value === '') continue;
            if (Array.isArray(value) && value.length === 0) continue;
            return true;
        }
        return false;
    }

    function roundNumber(value, digits) {
        if (!hasNumber(value)) return null;
        var precision = Math.pow(10, digits === undefined ? 0 : digits);
        return Math.round(Number(value) * precision) / precision;
    }

    function normalizeDeviceKey(value) {
        return (value || '').toString().trim().toLowerCase();
    }

    function buildModelKey(model, manufacturer) {
        return [
            (model || '').toString().trim().toLowerCase(),
            (manufacturer || '').toString().trim().toLowerCase()
        ].join('|');
    }

    function getArray(rawData, key) {
        return rawData && Array.isArray(rawData[key]) ? rawData[key] : [];
    }

    function averageBy(items, selector) {
        var total = 0;
        var count = 0;

        items.forEach(function(item) {
            var value = selector(item);
            if (!hasNumber(value)) return;
            total += Number(value);
            count++;
        });

        return count > 0 ? total / count : null;
    }

    function createNamedMap(items, nameSelector) {
        var map = {};
        items.forEach(function(item) {
            var key = normalizeDeviceKey(nameSelector(item));
            if (!key) return;
            map[key] = item;
        });
        return map;
    }

    function createModelMap(items) {
        var map = {};
        items.forEach(function(item) {
            var key = buildModelKey(item.model, item.manufacturer);
            if (!key || key === '|') return;
            map[key] = item;
        });
        return map;
    }

    function extractDevices(rawData) {
        if (Array.isArray(rawData)) return rawData;
        if (!rawData) return [];

        var devices = getArray(rawData, 'deviceScores');
        var perfMap = createNamedMap(getArray(rawData, 'devicePerformance'), function(item) { return item.deviceName; });
        var batteryMap = createNamedMap(getArray(rawData, 'batteryHealth'), function(item) { return item.deviceName; });
        var appHealthMap = createNamedMap(getArray(rawData, 'deviceAppHealth'), function(item) {
            return item.deviceName || item.deviceDisplayName;
        });
        var workFromAnywhereMap = createModelMap(getArray(rawData, 'workFromAnywhere'));

        return devices.map(function(device) {
            var key = normalizeDeviceKey(device.deviceName);
            var perf = perfMap[key] || {};
            var battery = batteryMap[key] || {};
            var appHealth = appHealthMap[key] || {};

            var manufacturer = device.manufacturer || perf.manufacturer || battery.manufacturer || null;
            var model = device.model || perf.model || battery.model || null;
            var wfa = workFromAnywhereMap[buildModelKey(model, manufacturer)] || {};

            return {
                id: device.id,
                deviceName: device.deviceName,
                manufacturer: manufacturer,
                model: model,
                healthScore: hasNumber(device.healthScore) ? Number(device.healthScore) :
                    hasNumber(device.endpointAnalyticsScore) ? Number(device.endpointAnalyticsScore) : 0,
                startupScore: hasNumber(device.startupScore) ? Number(device.startupScore) :
                    hasNumber(device.startupPerformanceScore) ? Number(device.startupPerformanceScore) :
                        hasNumber(perf.startupPerformanceScore) ? Number(perf.startupPerformanceScore) : 0,
                appReliabilityScore: hasNumber(device.appReliabilityScore) ? Number(device.appReliabilityScore) : null,
                workFromAnywhereScore: hasNumber(device.workFromAnywhereScore) ? Number(device.workFromAnywhereScore) :
                    hasNumber(wfa.workFromAnywhereScore) ? Number(wfa.workFromAnywhereScore) : null,
                bootTimeSeconds: hasNumber(perf.coreBootTimeInMs) ? Math.round(Number(perf.coreBootTimeInMs) / 1000) : null,
                loginTimeSeconds: hasNumber(perf.loginTimeInMs) ? Math.round(Number(perf.loginTimeInMs) / 1000) : null,
                gpBootSeconds: hasNumber(perf.groupPolicyBootTimeInMs) ? Math.round(Number(perf.groupPolicyBootTimeInMs) / 1000) : null,
                gpLoginSeconds: hasNumber(perf.groupPolicyLoginTimeInMs) ? Math.round(Number(perf.groupPolicyLoginTimeInMs) / 1000) : null,
                healthStatus: device.healthStatus,
                needsAttention: !!device.needsAttention,
                blueScreenCount: hasNumber(perf.blueScreenCount) ? Number(perf.blueScreenCount) : 0,
                restartCount: hasNumber(perf.restartCount) ? Number(perf.restartCount) : 0,
                bootScore: hasNumber(perf.bootScore) ? Number(perf.bootScore) : null,
                loginScore: hasNumber(perf.loginScore) ? Number(perf.loginScore) : null,
                batteryHealthPercentage: hasNumber(battery.batteryHealthPercentage) ? Number(battery.batteryHealthPercentage) : null,
                maxCapacityPercentage: hasNumber(battery.maxCapacityPercentage) ? Number(battery.maxCapacityPercentage) : null,
                batteryAgeInDays: hasNumber(battery.batteryAgeInDays) ? Number(battery.batteryAgeInDays) : null,
                fullBatteryDrainCount: hasNumber(battery.fullBatteryDrainCount) ? Number(battery.fullBatteryDrainCount) : null,
                estimatedBatteryCapacity: hasNumber(battery.estimatedBatteryCapacity) ? Number(battery.estimatedBatteryCapacity) : null,
                appCrashCount: hasNumber(appHealth.appCrashCount) ? Number(appHealth.appCrashCount) : null,
                appHangCount: hasNumber(appHealth.appHangCount) ? Number(appHealth.appHangCount) : null,
                crashedAppCount: hasNumber(appHealth.crashedAppCount) ? Number(appHealth.crashedAppCount) : null,
                meanTimeToFailure: hasNumber(appHealth.meanTimeToFailure) ? Number(appHealth.meanTimeToFailure) : null,
                deviceAppHealthScore: hasNumber(appHealth.deviceAppHealthScore) ? Number(appHealth.deviceAppHealthScore) : null,
                deviceAppHealthStatus: appHealth.healthStatus || null,
                cloudManagementScore: hasNumber(wfa.cloudManagementScore) ? Number(wfa.cloudManagementScore) : null,
                cloudIdentityScore: hasNumber(wfa.cloudIdentityScore) ? Number(wfa.cloudIdentityScore) : null,
                cloudProvisioningScore: hasNumber(wfa.cloudProvisioningScore) ? Number(wfa.cloudProvisioningScore) : null,
                windowsScore: hasNumber(wfa.windowsScore) ? Number(wfa.windowsScore) : null
            };
        });
    }

    function computeSummary(devices) {
        var total = devices.length;
        if (total === 0) {
            return {
                total: 0,
                avgHealth: 0,
                avgStartup: 0,
                excellent: 0,
                good: 0,
                fair: 0,
                poor: 0,
                needsAttention: 0
            };
        }

        var totalHealth = 0;
        var totalStartup = 0;
        var excellent = 0;
        var good = 0;
        var fair = 0;
        var poor = 0;
        var needsAttention = 0;

        devices.forEach(function(device) {
            totalHealth += device.healthScore || 0;
            totalStartup += device.startupScore || 0;

            if (device.healthScore >= 80) excellent++;
            else if (device.healthScore >= 60) good++;
            else if (device.healthScore >= 40) fair++;
            else poor++;

            if (device.needsAttention || device.healthScore < 50) needsAttention++;
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
        document.querySelectorAll('.tab-btn').forEach(function(button) {
            button.classList.toggle('active', button.dataset.tab === tab);
        });
        renderTabContent();
    }

    function renderTabContent() {
        var rawData = DataLoader.getData('endpointAnalytics') || {};
        var container = document.getElementById('analytics-content');
        if (!container) return;

        if (currentTab === 'overview') renderOverview(container, rawData);
        else if (currentTab === 'models') renderModelComparison(container, rawData);
        else if (currentTab === 'apps') renderAppReliability(container, rawData);
        else if (currentTab === 'battery') renderBatteryHealth(container, rawData);
        else if (currentTab === 'startup') renderStartup(container, rawData);
        else if (currentTab === 'device-health') renderDeviceAppHealth(container, rawData);
        else if (currentTab === 'devices') renderDeviceList(container, rawData);
    }

    function renderOverview(container, rawData) {
        var devices = extractDevices(rawData);
        var insights = getArray(rawData, 'insights').slice();
        var needsAttentionList = devices.filter(function(device) {
            return device.needsAttention || device.healthScore < 50;
        });
        var batteryIssues = getArray(rawData, 'batteryHealth').filter(function(item) {
            return hasNumber(item.batteryHealthPercentage) && Number(item.batteryHealthPercentage) < 60;
        });
        var slowLoginDevices = getArray(rawData, 'devicePerformance').filter(function(item) {
            return hasNumber(item.loginTimeInMs) && Number(item.loginTimeInMs) > 60000;
        });
        var highImpactProcesses = getArray(rawData, 'startupProcesses').filter(function(item) {
            return hasNumber(item.avgStartupImpactMs) && Number(item.avgStartupImpactMs) > 5000;
        });

        var severityOrder = { critical: 0, high: 1, medium: 2, info: 3 };
        insights.sort(function(a, b) {
            return (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9);
        });

        var html = '<div class="analytics-grid">';
        html += '<div class="analytics-card"><h4>Needs Attention</h4><div class="model-highlight">' + formatCount(needsAttentionList.length) + '</div><div class="model-stats">Devices with poor scores or active flags</div></div>';
        html += '<div class="analytics-card' + (batteryIssues.length > 0 ? ' card-warning' : '') + '"><h4>Battery Issues</h4><div class="model-highlight">' + formatCount(batteryIssues.length) + '</div><div class="model-stats">Devices below 60% battery health</div></div>';
        html += '<div class="analytics-card' + (slowLoginDevices.length > 0 ? ' card-warning' : '') + '"><h4>Slow Logins</h4><div class="model-highlight">' + formatCount(slowLoginDevices.length) + '</div><div class="model-stats">Devices taking more than 60 seconds to sign in</div></div>';
        html += '<div class="analytics-card' + (highImpactProcesses.length > 0 ? ' card-danger' : '') + '"><h4>Startup Drag</h4><div class="model-highlight">' + formatCount(highImpactProcesses.length) + '</div><div class="model-stats">Processes adding more than 5 seconds to startup</div></div>';
        html += '</div>';

        if (insights.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Actionable Insights</h3>';
            html += '<div class="analytics-grid">';

            insights.forEach(function(insight) {
                html += '<div class="analytics-card">';
                html += '<h4>' + (insight.title || 'Insight') + ' ' + formatSeverityBadge(insight.severity) + '</h4>';
                html += '<div class="model-stats">' + (insight.description || '--') + '</div>';
                if (hasNumber(insight.impactedDevices)) {
                    html += '<div class="model-stats"><strong>Impacted Devices:</strong> ' + formatCount(insight.impactedDevices) + '</div>';
                }
                if (insight.recommendedAction) {
                    html += '<div class="model-recommendation">' + insight.recommendedAction + '</div>';
                }
                html += '</div>';
            });

            html += '</div>';
            html += '</div>';
        }

        if (needsAttentionList.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Devices Needing Attention (' + needsAttentionList.length + ')</h3>';
            html += '<table class="data-table"><thead><tr><th>Device</th><th>Model</th><th>Health</th><th>Startup</th><th>Boot</th><th>Status</th></tr></thead><tbody>';

            needsAttentionList
                .slice()
                .sort(function(a, b) { return (a.healthScore || 0) - (b.healthScore || 0); })
                .slice(0, 10)
                .forEach(function(device) {
                    html += '<tr>';
                    html += '<td><strong>' + (device.deviceName || '--') + '</strong></td>';
                    html += '<td>' + (device.model || '--') + '</td>';
                    html += '<td>' + formatHealthScoreBadge(device.healthScore) + '</td>';
                    html += '<td>' + formatStartupScoreBadge(device.startupScore) + '</td>';
                    html += '<td>' + formatDurationSeconds(device.bootTimeSeconds, 30, 60) + '</td>';
                    html += '<td>' + formatHealthStatus(device.healthStatus || (device.healthScore < 50 ? 'Poor' : 'Fair')) + '</td>';
                    html += '</tr>';
                });

            html += '</tbody></table>';

            if (needsAttentionList.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + needsAttentionList.length + ' devices. Open All Devices for the full list.</p>';
            }

            html += '</div>';
        } else {
            html += renderEmptyState('No Devices Need Attention', 'The collected Endpoint Analytics data does not currently flag any devices for urgent review.');
        }

        container.innerHTML = html;
    }

    function renderModelComparison(container, rawData) {
        var devices = extractDevices(rawData);
        var modelInsights = getArray(rawData, 'modelInsights');
        var wfaEntries = getArray(rawData, 'workFromAnywhere');
        var wfaMap = createModelMap(wfaEntries);

        var models = [];
        if (modelInsights.length > 0) {
            models = modelInsights.map(function(modelInsight) {
                var wfa = wfaMap[buildModelKey(modelInsight.model, modelInsight.manufacturer)] || {};
                return {
                    model: modelInsight.model,
                    manufacturer: modelInsight.manufacturer || 'Unknown',
                    count: modelInsight.deviceCount || 0,
                    avgHealth: roundNumber(modelInsight.avgHealthScore, 0),
                    avgStartup: roundNumber(modelInsight.avgStartupScore, 0),
                    avgAppReliability: roundNumber(modelInsight.avgAppReliabilityScore, 0),
                    poorDevices: modelInsight.poorDevices || 0,
                    avgWfa: roundNumber(wfa.workFromAnywhereScore, 0),
                    cloudManagementScore: roundNumber(wfa.cloudManagementScore, 0),
                    cloudIdentityScore: roundNumber(wfa.cloudIdentityScore, 0),
                    cloudProvisioningScore: roundNumber(wfa.cloudProvisioningScore, 0),
                    windowsScore: roundNumber(wfa.windowsScore, 0),
                    recommendation: modelInsight.recommendation || ''
                };
            });
        } else {
            var modelStats = {};

            devices.forEach(function(device) {
                var model = device.model || 'Unknown';
                if (!modelStats[model]) {
                    modelStats[model] = {
                        count: 0,
                        totalHealth: 0,
                        totalStartup: 0,
                        totalAppHealth: 0,
                        appScoreCount: 0,
                        poorDevices: 0,
                        manufacturer: device.manufacturer || 'Unknown'
                    };
                }

                modelStats[model].count++;
                modelStats[model].totalHealth += device.healthScore || 0;
                modelStats[model].totalStartup += device.startupScore || 0;

                if (hasNumber(device.appReliabilityScore)) {
                    modelStats[model].totalAppHealth += Number(device.appReliabilityScore);
                    modelStats[model].appScoreCount++;
                }

                if ((device.healthScore || 0) < 50 || device.needsAttention) {
                    modelStats[model].poorDevices++;
                }
            });

            models = Object.keys(modelStats).map(function(modelName) {
                var stats = modelStats[modelName];
                var wfa = wfaMap[buildModelKey(modelName, stats.manufacturer)] || {};
                return {
                    model: modelName,
                    manufacturer: stats.manufacturer || 'Unknown',
                    count: stats.count,
                    avgHealth: Math.round(stats.totalHealth / stats.count),
                    avgStartup: Math.round(stats.totalStartup / stats.count),
                    avgAppReliability: stats.appScoreCount > 0 ? Math.round(stats.totalAppHealth / stats.appScoreCount) : null,
                    poorDevices: stats.poorDevices,
                    avgWfa: roundNumber(wfa.workFromAnywhereScore, 0),
                    cloudManagementScore: roundNumber(wfa.cloudManagementScore, 0),
                    cloudIdentityScore: roundNumber(wfa.cloudIdentityScore, 0),
                    cloudProvisioningScore: roundNumber(wfa.cloudProvisioningScore, 0),
                    windowsScore: roundNumber(wfa.windowsScore, 0),
                    recommendation: ''
                };
            });
        }

        models.sort(function(a, b) { return (b.avgHealth || 0) - (a.avgHealth || 0); });

        if (models.length === 0) {
            container.innerHTML = renderEmptyState('No Model Data', 'Model comparison needs Endpoint Analytics device or model data.');
            return;
        }

        var html = '<div class="analytics-section">';
        html += '<h3>Model Performance Comparison</h3>';
        html += '<p class="section-description">Compare models by health, startup, and work-from-anywhere readiness.</p>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Model</th><th>Manufacturer</th><th>Devices</th><th>Avg Health</th><th>Avg Startup</th><th>Avg WFA</th><th>Poor Devices</th><th>Recommendation</th>';
        html += '</tr></thead><tbody>';

        models.forEach(function(model) {
            html += '<tr>';
            html += '<td><strong>' + (model.model || '--') + '</strong></td>';
            html += '<td>' + (model.manufacturer || '--') + '</td>';
            html += '<td>' + formatCount(model.count) + '</td>';
            html += '<td>' + formatHealthScoreBadge(model.avgHealth) + '</td>';
            html += '<td>' + formatStartupScoreText(model.avgStartup) + '</td>';
            html += '<td>' + formatScoreText(model.avgWfa) + '</td>';
            html += '<td>' + formatCount(model.poorDevices, { zeroIsGood: true }) + '</td>';
            html += '<td class="cell-truncate">' + (model.recommendation || '--') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        var weakWfaModels = models.filter(function(model) {
            return hasNumber(model.avgWfa) && Number(model.avgWfa) < 60;
        });
        var best = models[0];
        var worst = models[models.length - 1];

        html += '<div class="analytics-grid">';
        html += '<div class="analytics-card card-success"><h4>Best Performing Model</h4><div class="model-highlight">' + (best.model || '--') + '</div><div class="model-stats">Avg Health: <strong>' + (best.avgHealth || '--') + '</strong> | Devices: ' + formatCount(best.count) + '</div></div>';
        html += '<div class="analytics-card card-danger"><h4>Needs Improvement</h4><div class="model-highlight">' + (worst.model || '--') + '</div><div class="model-stats">Avg Health: <strong>' + (worst.avgHealth || '--') + '</strong> | Poor Devices: ' + formatCount(worst.poorDevices) + '</div></div>';

        if (weakWfaModels.length > 0) {
            var weakModel = weakWfaModels[0];
            html += '<div class="analytics-card card-warning"><h4>Weak Remote Readiness</h4><div class="model-highlight">' + (weakModel.model || '--') + '</div><div class="model-stats">WFA: <strong>' + (weakModel.avgWfa === null ? '--' : weakModel.avgWfa) + '</strong> | Cloud Mgmt: ' + (weakModel.cloudManagementScore === null ? '--' : weakModel.cloudManagementScore) + '</div></div>';
        }

        html += '</div>';

        container.innerHTML = html;
    }

    function renderAppReliability(container, rawData) {
        var apps = getArray(rawData, 'appReliability');

        if (apps.length === 0) {
            container.innerHTML = renderEmptyState('No App Reliability Data', 'App reliability data shows which applications are causing the most issues.');
            return;
        }

        apps = apps.slice().sort(function(a, b) {
            return (b.appCrashCount || 0) - (a.appCrashCount || 0);
        });

        var html = '<div class="analytics-section">';
        html += '<h3>Application Reliability</h3>';
        html += '<p class="section-description">Applications sorted by crash frequency. Focus on apps with high crash counts to improve user experience.</p>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Application</th><th>Publisher</th><th>Version</th><th>Crashes</th><th>Hangs</th><th>MTTF (min)</th><th>Devices</th><th>Health</th><th>Trend</th>';
        html += '</tr></thead><tbody>';

        apps.forEach(function(app) {
            var crashClass = (app.appCrashCount || 0) > 50 ? 'text-critical font-bold' :
                (app.appCrashCount || 0) > 20 ? 'text-warning' : 'text-muted';
            var trend = (app.trend || 'stable').toString().toLowerCase();
            var trendBadge = trend === 'improving' ? '<span class="badge badge-success">Improving</span>' :
                trend === 'degrading' ? '<span class="badge badge-critical">Degrading</span>' :
                    '<span class="badge badge-neutral">Stable</span>';

            html += '<tr>';
            html += '<td><strong>' + (app.appName || '--') + '</strong></td>';
            html += '<td>' + (app.appPublisher || '--') + '</td>';
            html += '<td><span class="badge badge-neutral">' + (app.appVersion || '--') + '</span></td>';
            html += '<td><span class="' + crashClass + '">' + formatCount(app.appCrashCount || 0, { zeroIsGood: true }) + '</span></td>';
            html += '<td>' + formatCount(app.appHangCount || 0, { zeroIsGood: true }) + '</td>';
            html += '<td>' + formatDurationMinutes(app.meanTimeToFailure) + '</td>';
            html += '<td>' + formatCount(app.activeDeviceCount) + '</td>';
            html += '<td>' + formatHealthScoreBadge(app.healthScore) + '</td>';
            html += '<td>' + trendBadge + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        var problemApps = apps.filter(function(app) {
            return (app.appCrashCount || 0) > 20 || (app.healthScore || 100) < 50;
        });

        if (problemApps.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Apps Requiring Attention (' + problemApps.length + ')</h3>';
            html += '<div class="problem-apps">';

            problemApps.slice(0, 5).forEach(function(app) {
                var trend = (app.trend || 'stable').toString().toLowerCase();
                var trendNote = trend === 'degrading' ? ' (Getting Worse)' : '';
                html += '<div class="problem-app-card">';
                html += '<strong>' + (app.appName || 'Unknown') + '</strong>' + trendNote;
                html += '<div class="app-issue">Crashes: <span class="text-critical">' + (app.appCrashCount || 0) + '</span> | MTTF: ' + formatDurationMinutes(app.meanTimeToFailure) + ' | Health: ' + (app.healthScore || '--') + '</div>';
                html += '</div>';
            });

            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    function renderBatteryHealth(container, rawData) {
        var batteries = getArray(rawData, 'batteryHealth').slice();

        if (batteries.length === 0) {
            container.innerHTML = renderEmptyState('No Battery Health Data', 'Battery health data requires supported mobile hardware and the relevant Intune licensing.');
            return;
        }

        batteries.sort(function(a, b) {
            return (a.batteryHealthPercentage || 101) - (b.batteryHealthPercentage || 101);
        });

        var batteryIssues = batteries.filter(function(item) {
            return hasNumber(item.batteryHealthPercentage) && Number(item.batteryHealthPercentage) < 60;
        });
        var averageBatteryHealth = roundNumber(averageBy(batteries, function(item) {
            return item.batteryHealthPercentage;
        }), 1);
        var highDrainDevices = batteries.filter(function(item) {
            return hasNumber(item.fullBatteryDrainCount) && Number(item.fullBatteryDrainCount) > 200;
        });

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + formatCount(batteries.length) + '</div><div class="summary-label">Battery Devices</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + (averageBatteryHealth === null ? '--' : averageBatteryHealth) + '%</div><div class="summary-label">Avg Battery Health</div></div>';
        html += '<div class="summary-card' + (batteryIssues.length > 0 ? ' card-warning' : ' card-success') + '"><div class="summary-value">' + formatCount(batteryIssues.length) + '</div><div class="summary-label">Below 60%</div></div>';
        html += '<div class="summary-card' + (highDrainDevices.length > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + formatCount(highDrainDevices.length) + '</div><div class="summary-label">High Drain Count</div></div>';
        html += '</div>';

        html += '<div class="analytics-section">';
        html += '<h3>Battery Health by Device</h3>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Device</th><th>Model</th><th>Battery Health</th><th>Max Capacity</th><th>Age (days)</th><th>Full Drains</th><th>Estimated Capacity</th>';
        html += '</tr></thead><tbody>';

        batteries.forEach(function(item) {
            html += '<tr>';
            html += '<td><strong>' + (item.deviceName || '--') + '</strong></td>';
            html += '<td>' + (item.model || '--') + '</td>';
            html += '<td>' + formatBatteryHealth(item.batteryHealthPercentage) + '</td>';
            html += '<td>' + formatPercentageText(item.maxCapacityPercentage, 80, 60) + '</td>';
            html += '<td>' + formatDays(item.batteryAgeInDays) + '</td>';
            html += '<td>' + formatCount(item.fullBatteryDrainCount) + '</td>';
            html += '<td>' + formatCapacity(item.estimatedBatteryCapacity) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        if (batteryIssues.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Devices Requiring Battery Review</h3>';
            html += '<div class="problem-apps">';

            batteryIssues.slice(0, 5).forEach(function(item) {
                html += '<div class="problem-app-card">';
                html += '<strong>' + (item.deviceName || 'Unknown Device') + '</strong>';
                html += '<div class="app-issue">Health: <span class="text-critical">' + (item.batteryHealthPercentage || '--') + '%</span> | Max Capacity: ' + (item.maxCapacityPercentage || '--') + '% | Full Drains: ' + formatCount(item.fullBatteryDrainCount) + '</div>';
                html += '</div>';
            });

            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    function renderStartup(container, rawData) {
        var performance = getArray(rawData, 'devicePerformance').slice();
        var startupProcesses = getArray(rawData, 'startupProcesses').slice();

        if (performance.length === 0 && startupProcesses.length === 0) {
            container.innerHTML = renderEmptyState('No Startup Data', 'Startup performance and startup process data are not available in the current collection.');
            return;
        }

        performance.sort(function(a, b) {
            return (a.startupPerformanceScore || 101) - (b.startupPerformanceScore || 101);
        });
        startupProcesses.sort(function(a, b) {
            return (b.avgStartupImpactMs || 0) - (a.avgStartupImpactMs || 0);
        });

        var slowBootDevices = performance.filter(function(item) {
            return hasNumber(item.coreBootTimeInMs) && Number(item.coreBootTimeInMs) > 90000;
        });
        var slowLoginDevices = performance.filter(function(item) {
            return hasNumber(item.loginTimeInMs) && Number(item.loginTimeInMs) > 60000;
        });
        var avgGpLoginMs = roundNumber(averageBy(performance, function(item) {
            return item.groupPolicyLoginTimeInMs;
        }), 0);

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + formatCount(performance.length) + '</div><div class="summary-label">Performance Records</div></div>';
        html += '<div class="summary-card' + (slowBootDevices.length > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + formatCount(slowBootDevices.length) + '</div><div class="summary-label">Slow Boots</div></div>';
        html += '<div class="summary-card' + (slowLoginDevices.length > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + formatCount(slowLoginDevices.length) + '</div><div class="summary-label">Slow Logins</div></div>';
        html += '<div class="summary-card' + (avgGpLoginMs !== null && avgGpLoginMs > 15000 ? ' card-warning' : '') + '"><div class="summary-value">' + formatMillisecondsCompact(avgGpLoginMs) + '</div><div class="summary-label">Avg GP Login Overhead</div></div>';
        html += '<div class="summary-card' + (startupProcesses.length > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + formatCount(startupProcesses.length) + '</div><div class="summary-label">Tracked Startup Processes</div></div>';
        html += '</div>';

        if (performance.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Slowest Devices</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Device</th><th>Model</th><th>Startup</th><th>Boot Time</th><th>Login Time</th><th>GP Login</th><th>Blue Screens</th>';
            html += '</tr></thead><tbody>';

            performance.slice(0, 10).forEach(function(item) {
                html += '<tr>';
                html += '<td><strong>' + (item.deviceName || '--') + '</strong></td>';
                html += '<td>' + (item.model || '--') + '</td>';
                html += '<td>' + formatStartupScoreBadge(item.startupPerformanceScore) + '</td>';
                html += '<td>' + formatMilliseconds(item.coreBootTimeInMs, 30000, 60000) + '</td>';
                html += '<td>' + formatMilliseconds(item.loginTimeInMs, 15000, 45000) + '</td>';
                html += '<td>' + formatMilliseconds(item.groupPolicyLoginTimeInMs, 5000, 15000) + '</td>';
                html += '<td>' + formatCount(item.blueScreenCount, { zeroIsGood: true }) + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';
        }

        if (startupProcesses.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Highest Impact Startup Processes</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Process</th><th>Publisher</th><th>Devices</th><th>Avg Impact</th><th>Total Impact</th>';
            html += '</tr></thead><tbody>';

            startupProcesses.slice(0, 15).forEach(function(item) {
                html += '<tr>';
                html += '<td><strong>' + (item.processName || '--') + '</strong></td>';
                html += '<td>' + (item.publisher || '--') + '</td>';
                html += '<td>' + formatCount(item.deviceCount) + '</td>';
                html += '<td>' + formatMilliseconds(item.avgStartupImpactMs, 2000, 5000) + '</td>';
                html += '<td>' + formatMillisecondsCompact(item.totalStartupImpactMs) + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table></div>';
        }

        container.innerHTML = html;
    }

    function renderDeviceAppHealth(container, rawData) {
        var deviceAppHealth = getArray(rawData, 'deviceAppHealth').slice();

        if (deviceAppHealth.length === 0) {
            container.innerHTML = renderEmptyState('No Device App Health Data', 'Device-level app health data is not available in the current collection.');
            return;
        }

        deviceAppHealth.sort(function(a, b) {
            var aScore = hasNumber(a.deviceAppHealthScore) ? Number(a.deviceAppHealthScore) : 101;
            var bScore = hasNumber(b.deviceAppHealthScore) ? Number(b.deviceAppHealthScore) : 101;
            return aScore - bScore;
        });

        var poorDevices = deviceAppHealth.filter(function(item) {
            return hasNumber(item.deviceAppHealthScore) && Number(item.deviceAppHealthScore) < 50;
        });
        var totalCrashes = deviceAppHealth.reduce(function(total, item) {
            return total + (hasNumber(item.appCrashCount) ? Number(item.appCrashCount) : 0);
        }, 0);
        var totalHangs = deviceAppHealth.reduce(function(total, item) {
            return total + (hasNumber(item.appHangCount) ? Number(item.appHangCount) : 0);
        }, 0);

        var html = '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + formatCount(deviceAppHealth.length) + '</div><div class="summary-label">Devices</div></div>';
        html += '<div class="summary-card' + (poorDevices.length > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value">' + formatCount(poorDevices.length) + '</div><div class="summary-label">Poor App Health</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + formatCount(totalCrashes) + '</div><div class="summary-label">Total Crashes</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + formatCount(totalHangs) + '</div><div class="summary-label">Total Hangs</div></div>';
        html += '</div>';

        html += '<div class="analytics-section">';
        html += '<h3>Device App Health</h3>';
        html += '<table class="data-table"><thead><tr>';
        html += '<th>Device</th><th>Crash Count</th><th>Hang Count</th><th>Crashed Apps</th><th>MTTF</th><th>Score</th><th>Status</th>';
        html += '</tr></thead><tbody>';

        deviceAppHealth.forEach(function(item) {
            html += '<tr>';
            html += '<td><strong>' + (item.deviceName || item.deviceDisplayName || '--') + '</strong></td>';
            html += '<td>' + formatCount(item.appCrashCount, { zeroIsGood: true }) + '</td>';
            html += '<td>' + formatCount(item.appHangCount, { zeroIsGood: true }) + '</td>';
            html += '<td>' + formatCount(item.crashedAppCount, { zeroIsGood: true }) + '</td>';
            html += '<td>' + formatDurationMinutes(item.meanTimeToFailure) + '</td>';
            html += '<td>' + formatHealthScoreBadge(item.deviceAppHealthScore) + '</td>';
            html += '<td>' + formatHealthStatus(item.healthStatus) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

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

        colSelector = ColumnSelector.create({
            containerId: 'analytics-colselector',
            storageKey: 'tenantscope-analytics-cols-v2',
            allColumns: [
                { key: 'deviceName', label: 'Device Name' },
                { key: 'model', label: 'Model' },
                { key: 'manufacturer', label: 'Manufacturer' },
                { key: 'healthScore', label: 'Health Score' },
                { key: 'startupScore', label: 'Startup Score' },
                { key: 'appReliabilityScore', label: 'App Reliability' },
                { key: 'deviceAppHealthScore', label: 'Device App Health' },
                { key: 'workFromAnywhereScore', label: 'WFA Score' },
                { key: 'batteryHealthPercentage', label: 'Battery Health' },
                { key: 'bootTimeSeconds', label: 'Boot Time' },
                { key: 'loginTimeSeconds', label: 'Login Time' },
                { key: 'healthStatus', label: 'Health Status' },
                { key: 'blueScreenCount', label: 'Blue Screens' },
                { key: 'restartCount', label: 'Restarts' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['deviceName', 'model', 'healthScore', 'startupScore', 'deviceAppHealthScore', 'batteryHealthPercentage', 'bootTimeSeconds', 'healthStatus', '_adminLinks'],
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
        var healthFilter = Filters.getValue('analytics-health');

        if (healthFilter === 'poor') filteredData = filteredData.filter(function(device) { return device.healthScore < 50; });
        else if (healthFilter === 'fair') filteredData = filteredData.filter(function(device) { return device.healthScore >= 40 && device.healthScore < 60; });
        else if (healthFilter === 'good') filteredData = filteredData.filter(function(device) { return device.healthScore >= 60 && device.healthScore < 80; });
        else if (healthFilter === 'excellent') filteredData = filteredData.filter(function(device) { return device.healthScore >= 80; });

        renderDevicesTable(filteredData);
    }

    function renderDevicesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['deviceName', 'model', 'healthScore', 'startupScore', 'bootTimeSeconds', 'healthStatus'];

        var allDefs = [
            { key: 'deviceName', label: 'Device Name', formatter: function(value) {
                if (!value) return '--';
                return '<a href="#devices?search=' + encodeURIComponent(value) + '" class="entity-link"><strong>' + value + '</strong></a>';
            }},
            { key: 'model', label: 'Model' },
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'healthScore', label: 'Health Score', formatter: formatHealthScoreBadge },
            { key: 'startupScore', label: 'Startup Score', formatter: formatStartupScoreBadge },
            { key: 'appReliabilityScore', label: 'App Reliability', formatter: formatScoreText },
            { key: 'deviceAppHealthScore', label: 'Device App Health', formatter: formatScoreText },
            { key: 'workFromAnywhereScore', label: 'WFA Score', formatter: formatScoreText },
            { key: 'batteryHealthPercentage', label: 'Battery Health', formatter: formatBatteryHealth },
            { key: 'bootTimeSeconds', label: 'Boot Time', formatter: function(value) { return formatDurationSeconds(value, 30, 60); } },
            { key: 'loginTimeSeconds', label: 'Login Time', formatter: function(value) { return formatDurationSeconds(value, 15, 45); } },
            { key: 'healthStatus', label: 'Health Status', formatter: formatHealthStatus },
            { key: 'blueScreenCount', label: 'Blue Screens', formatter: function(value) { return formatCount(value, { zeroIsGood: true }); } },
            { key: 'restartCount', label: 'Restarts', formatter: function(value) { return formatCount(value); } },
            { key: '_adminLinks', label: 'Admin', formatter: function(value, row) {
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
            columns: allDefs.filter(function(column) { return visible.indexOf(column.key) !== -1; }),
            pageSize: 50,
            onRowClick: showDeviceDetails
        });
    }

    function formatHealthScoreBadge(value) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(value));
        var cls = score >= 80 ? 'badge-success' : score >= 60 ? 'badge-info' : score >= 40 ? 'badge-warning' : 'badge-critical';
        return '<span class="badge ' + cls + '">' + score + '</span>';
    }

    function formatStartupScoreBadge(value) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(value));
        var cls = score >= 70 ? 'badge-success' : score >= 50 ? 'badge-warning' : 'badge-critical';
        return '<span class="badge ' + cls + '">' + score + '</span>';
    }

    function formatStartupScoreText(value) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(value));
        var cls = score >= 70 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + score + '</span>';
    }

    function formatScoreText(value) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var score = Math.round(Number(value));
        var cls = score >= 70 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + score + '</span>';
    }

    function formatBatteryHealth(value) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var pct = Math.round(Number(value));
        var cls = pct >= 80 ? 'text-success' : pct >= 60 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + pct + '%</span>';
    }

    function formatPercentageText(value, goodThreshold, warningThreshold) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var pct = Math.round(Number(value));
        var cls = pct >= goodThreshold ? 'text-success' : pct >= warningThreshold ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + pct + '%</span>';
    }

    function formatDurationSeconds(value, goodMax, warningMax) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var seconds = Math.round(Number(value));
        var cls = seconds <= goodMax ? 'text-success' : seconds <= warningMax ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + seconds + 's</span>';
    }

    function formatMilliseconds(value, goodMax, warningMax) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        return formatDurationSeconds(Math.round(Number(value) / 1000), Math.round(goodMax / 1000), Math.round(warningMax / 1000));
    }

    function formatMillisecondsCompact(value) {
        if (!hasNumber(value)) return '--';
        var milliseconds = Math.round(Number(value));
        if (milliseconds >= 60000) {
            return roundNumber(milliseconds / 60000, 1) + 'm';
        }
        return Math.round(milliseconds / 1000) + 's';
    }

    function formatDurationMinutes(value) {
        if (!hasNumber(value)) return '--';
        var minutes = Math.round(Number(value));
        if (minutes >= 1440) return roundNumber(minutes / 1440, 1) + 'd';
        if (minutes >= 60) return roundNumber(minutes / 60, 1) + 'h';
        return minutes + 'm';
    }

    function formatDays(value) {
        if (!hasNumber(value)) return '<span class="text-muted">--</span>';
        var days = Math.round(Number(value));
        var cls = days >= 1400 ? 'text-warning' : '';
        return '<span class="' + cls + '">' + days + 'd</span>';
    }

    function formatCapacity(value) {
        if (!hasNumber(value)) return '--';
        return Number(value).toLocaleString() + ' mWh';
    }

    function formatSeverityBadge(value) {
        if (!value) return '';
        var lower = String(value).toLowerCase();
        var cls = lower === 'critical' ? 'badge-critical' :
            lower === 'high' ? 'badge-warning' :
                lower === 'medium' ? 'badge-info' : 'badge-neutral';
        var label = lower.charAt(0).toUpperCase() + lower.slice(1);
        return '<span class="badge ' + cls + '">' + label + '</span>';
    }

    function renderEmptyState(title, description) {
        return '<div class="empty-state"><div class="empty-state-title">' + title + '</div><p>' + description + '</p></div>';
    }

    function showDeviceDetails(device) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = device.deviceName || 'Device Analytics Details';

        var html = '<div class="detail-grid">';

        html += '<div class="detail-section"><h4>Device Information</h4><dl class="detail-list">';
        html += '<dt>Device Name</dt><dd>' + (device.deviceName || '--') + '</dd>';
        html += '<dt>Manufacturer</dt><dd>' + (device.manufacturer || '--') + '</dd>';
        html += '<dt>Model</dt><dd>' + (device.model || '--') + '</dd>';
        html += '</dl></div>';

        html += '<div class="detail-section"><h4>Health Scores</h4><dl class="detail-list">';
        html += '<dt>Overall Health Score</dt><dd>' + formatHealthScoreBadge(device.healthScore) + '</dd>';
        html += '<dt>Startup Score</dt><dd>' + formatStartupScoreBadge(device.startupScore) + '</dd>';
        html += '<dt>App Reliability Score</dt><dd>' + formatScoreText(device.appReliabilityScore) + '</dd>';
        html += '<dt>Device App Health Score</dt><dd>' + formatScoreText(device.deviceAppHealthScore) + '</dd>';
        html += '<dt>Work From Anywhere Score</dt><dd>' + formatScoreText(device.workFromAnywhereScore) + '</dd>';
        html += '<dt>Health Status</dt><dd>' + formatHealthStatus(device.healthStatus) + '</dd>';
        html += '</dl></div>';

        html += '<div class="detail-section"><h4>Performance Metrics</h4><dl class="detail-list">';
        html += '<dt>Boot Time</dt><dd>' + formatDurationSeconds(device.bootTimeSeconds, 30, 60) + '</dd>';
        html += '<dt>Login Time</dt><dd>' + formatDurationSeconds(device.loginTimeSeconds, 15, 45) + '</dd>';
        html += '<dt>Boot Score</dt><dd>' + formatScoreText(device.bootScore) + '</dd>';
        html += '<dt>Login Score</dt><dd>' + formatScoreText(device.loginScore) + '</dd>';
        html += '<dt>GP Boot Overhead</dt><dd>' + formatDurationSeconds(device.gpBootSeconds, 5, 15) + '</dd>';
        html += '<dt>GP Login Overhead</dt><dd>' + formatDurationSeconds(device.gpLoginSeconds, 5, 15) + '</dd>';
        html += '<dt>Blue Screen Count</dt><dd>' + formatCount(device.blueScreenCount, { zeroIsGood: true }) + '</dd>';
        html += '<dt>Restart Count</dt><dd>' + formatCount(device.restartCount) + '</dd>';
        html += '</dl></div>';

        if (hasAnyValue([device.batteryHealthPercentage, device.maxCapacityPercentage, device.batteryAgeInDays, device.fullBatteryDrainCount])) {
            html += '<div class="detail-section"><h4>Battery Health</h4><dl class="detail-list">';
            html += '<dt>Battery Health</dt><dd>' + formatBatteryHealth(device.batteryHealthPercentage) + '</dd>';
            html += '<dt>Max Capacity</dt><dd>' + formatPercentageText(device.maxCapacityPercentage, 80, 60) + '</dd>';
            html += '<dt>Battery Age</dt><dd>' + formatDays(device.batteryAgeInDays) + '</dd>';
            html += '<dt>Full Drains</dt><dd>' + formatCount(device.fullBatteryDrainCount) + '</dd>';
            html += '<dt>Estimated Capacity</dt><dd>' + formatCapacity(device.estimatedBatteryCapacity) + '</dd>';
            html += '</dl></div>';
        }

        if (hasAnyValue([device.appCrashCount, device.appHangCount, device.crashedAppCount, device.meanTimeToFailure])) {
            html += '<div class="detail-section"><h4>App Health Detail</h4><dl class="detail-list">';
            html += '<dt>App Crash Count</dt><dd>' + formatCount(device.appCrashCount, { zeroIsGood: true }) + '</dd>';
            html += '<dt>App Hang Count</dt><dd>' + formatCount(device.appHangCount, { zeroIsGood: true }) + '</dd>';
            html += '<dt>Crashed Apps</dt><dd>' + formatCount(device.crashedAppCount, { zeroIsGood: true }) + '</dd>';
            html += '<dt>Mean Time To Failure</dt><dd>' + formatDurationMinutes(device.meanTimeToFailure) + '</dd>';
            html += '<dt>App Health Status</dt><dd>' + formatHealthStatus(device.deviceAppHealthStatus) + '</dd>';
            html += '</dl></div>';
        }

        if (hasAnyValue([device.cloudManagementScore, device.cloudIdentityScore, device.cloudProvisioningScore, device.windowsScore])) {
            html += '<div class="detail-section"><h4>Remote Readiness</h4><dl class="detail-list">';
            html += '<dt>Cloud Management</dt><dd>' + formatScoreText(device.cloudManagementScore) + '</dd>';
            html += '<dt>Cloud Identity</dt><dd>' + formatScoreText(device.cloudIdentityScore) + '</dd>';
            html += '<dt>Cloud Provisioning</dt><dd>' + formatScoreText(device.cloudProvisioningScore) + '</dd>';
            html += '<dt>Windows Readiness</dt><dd>' + formatScoreText(device.windowsScore) + '</dd>';
            html += '</dl></div>';
        }

        html += '<div class="detail-section"><h4>Status</h4><dl class="detail-list">';
        html += '<dt>Needs Attention</dt><dd>' + formatBoolean(device.needsAttention) + '</dd>';
        html += '<dt>Device ID</dt><dd style="font-size:0.8em">' + (device.id || '--') + '</dd>';
        html += '</dl></div>';

        html += '</div>';

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function render(container) {
        var rawData = DataLoader.getData('endpointAnalytics') || {};
        var devices = extractDevices(rawData);
        var overview = rawData.overview || {};
        var apps = getArray(rawData, 'appReliability');
        var batteries = getArray(rawData, 'batteryHealth');
        var insights = getArray(rawData, 'insights');
        var summary = computeSummary(devices);

        var total = summary.total;
        var avgHealth = overview.overallScore || summary.avgHealth;
        var avgStartup = overview.startupPerformanceScore || summary.avgStartup;
        var avgWfa = hasNumber(overview.workFromAnywhereScore) ? Number(overview.workFromAnywhereScore) :
            roundNumber(averageBy(getArray(rawData, 'workFromAnywhere'), function(item) { return item.workFromAnywhereScore; }), 0);
        var batteryIssues = batteries.filter(function(item) {
            return hasNumber(item.batteryHealthPercentage) && Number(item.batteryHealthPercentage) < 60;
        }).length;
        var problemApps = apps.filter(function(app) {
            return (app.appCrashCount || 0) > 20;
        }).length;
        var criticalInsights = insights.filter(function(insight) {
            var severity = (insight.severity || '').toString().toLowerCase();
            return severity === 'critical' || severity === 'high';
        }).length;

        var healthClass = avgHealth >= 70 ? '' : avgHealth >= 50 ? ' card-warning' : ' card-danger';
        var avgHealthTextClass = avgHealth >= 70 ? 'text-success' : avgHealth >= 50 ? 'text-warning' : 'text-critical';
        var wfaCardClass = avgWfa >= 70 ? '' : avgWfa >= 50 ? ' card-warning' : ' card-danger';

        var html = '<div class="page-header"><h2>Endpoint Analytics</h2></div>';

        html += '<div class="summary-cards">';
        html += '<div class="summary-card card-info"><div class="summary-value">' + formatCount(total) + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card' + healthClass + '"><div class="summary-value ' + avgHealthTextClass + '">' + avgHealth + '</div><div class="summary-label">Avg Health Score</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + avgStartup + '</div><div class="summary-label">Avg Startup Score</div></div>';
        html += '<div class="summary-card' + wfaCardClass + '"><div class="summary-value">' + (avgWfa === null ? '--' : avgWfa) + '</div><div class="summary-label">Avg WFA Score</div></div>';
        html += '<div class="summary-card' + (batteryIssues > 0 ? ' card-warning' : ' card-success') + '"><div class="summary-value">' + batteryIssues + '</div><div class="summary-label">Battery Issues</div></div>';
        html += '<div class="summary-card' + (problemApps > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + problemApps + '</div><div class="summary-label">Problem Apps</div></div>';
        html += '<div class="summary-card' + (criticalInsights > 0 ? ' card-danger' : ' card-success') + '"><div class="summary-value">' + criticalInsights + '</div><div class="summary-label">Critical Insights</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="models">Model Comparison</button>';
        html += '<button class="tab-btn" data-tab="apps">App Reliability</button>';
        html += '<button class="tab-btn" data-tab="battery">Battery Health</button>';
        html += '<button class="tab-btn" data-tab="startup">Startup</button>';
        html += '<button class="tab-btn" data-tab="device-health">Device App Health</button>';
        html += '<button class="tab-btn" data-tab="devices">All Devices (' + total + ')</button>';
        html += '</div>';
        html += '<div class="content-area" id="analytics-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(button) {
            button.addEventListener('click', function() {
                switchTab(button.dataset.tab);
            });
        });

        currentTab = 'overview';
        renderTabContent();
    }

    return { render: render };
})();

window.PageEndpointAnalytics = PageEndpointAnalytics;
