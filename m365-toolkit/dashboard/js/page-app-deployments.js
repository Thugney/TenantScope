/**
 * TenantScope - App Deployments Page
 * Enhanced with tabs, insights, and rich analytics matching Endpoint Analytics style
 */

const PageAppDeployments = (function() {
    'use strict';

    var colSelector = null;
    var rawData = null;
    var currentTab = 'overview';

    // Extract and normalize data from nested structure
    function getData() {
        var data = DataLoader.getData('appDeployments');
        if (!data) return null;

        // Handle nested structure from collector
        if (data.apps) {
            return data;
        }

        // Handle legacy flat array
        if (Array.isArray(data)) {
            return {
                apps: data.map(mapApp),
                failedDevices: [],
                insights: [],
                summary: buildSummaryFromArray(data)
            };
        }

        return null;
    }

    // Map collector field names to display field names
    function mapApp(a) {
        return {
            id: a.id,
            displayName: a.displayName,
            description: a.description,
            publisher: a.publisher,
            appType: a.appType,
            platform: a.platform,
            version: a.version,
            isFeatured: a.isFeatured,
            // Dates
            createdDateTime: a.createdDateTime,
            lastModifiedDateTime: a.lastModifiedDateTime,
            // URLs
            privacyInformationUrl: a.privacyInformationUrl,
            informationUrl: a.informationUrl,
            // Assignments
            assignments: a.assignments || [],
            assignmentCount: a.assignmentCount || (a.assignments ? a.assignments.length : 0),
            hasRequiredAssignment: a.hasRequiredAssignment,
            // Installation status
            installedCount: a.installedDevices || a.installedCount || 0,
            failedCount: a.failedDevices || a.failedCount || 0,
            pendingCount: a.pendingDevices || a.pendingCount || 0,
            notInstalledCount: a.notInstalledDevices || a.notInstalledCount || 0,
            notApplicableCount: a.notApplicableDevices || a.notApplicableCount || 0,
            totalDevices: a.totalDevices || 0,
            installRate: a.successRate || a.installRate || null,
            // Device statuses (failed only)
            deviceStatuses: a.deviceStatuses || [],
            // Health
            hasFailures: a.hasFailures || (a.failedDevices > 0) || (a.failedCount > 0),
            needsAttention: a.needsAttention
        };
    }

    // Build summary from flat array (legacy support)
    function buildSummaryFromArray(apps) {
        var totalInstalled = 0, totalFailed = 0, totalPending = 0;
        var platformBreakdown = {}, typeBreakdown = {};
        var appsWithFailures = 0;

        apps.forEach(function(a) {
            var installed = a.installedDevices || a.installedCount || 0;
            var failed = a.failedDevices || a.failedCount || 0;
            var pending = a.pendingDevices || a.pendingCount || 0;

            totalInstalled += installed;
            totalFailed += failed;
            totalPending += pending;
            if (failed > 0) appsWithFailures++;

            var platform = a.platform || 'Unknown';
            if (!platformBreakdown[platform]) {
                platformBreakdown[platform] = { apps: 0, installed: 0, failed: 0 };
            }
            platformBreakdown[platform].apps++;
            platformBreakdown[platform].installed += installed;
            platformBreakdown[platform].failed += failed;

            var appType = a.appType || 'Unknown';
            if (!typeBreakdown[appType]) {
                typeBreakdown[appType] = { apps: 0, installed: 0, failed: 0 };
            }
            typeBreakdown[appType].apps++;
            typeBreakdown[appType].installed += installed;
            typeBreakdown[appType].failed += failed;
        });

        var totalAttempted = totalInstalled + totalFailed + totalPending;
        var overallInstallRate = totalAttempted > 0 ? Math.round((totalInstalled / totalAttempted) * 1000) / 10 : 0;

        return {
            totalApps: apps.length,
            totalInstalled: totalInstalled,
            totalFailed: totalFailed,
            totalPending: totalPending,
            appsWithFailures: appsWithFailures,
            overallInstallRate: overallInstallRate,
            platformBreakdown: platformBreakdown,
            typeBreakdown: typeBreakdown
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
        var container = document.getElementById('app-content');
        if (!container || !rawData) return;

        switch (currentTab) {
            case 'overview':
                renderOverviewTab(container);
                break;
            case 'apps':
                renderAppsTab(container);
                break;
            case 'failed-devices':
                renderFailedDevicesTab(container);
                break;
        }
    }

    function renderOverviewTab(container) {
        var summary = rawData.summary || {};
        var apps = (rawData.apps || []).map(mapApp);
        var insights = rawData.insights || [];

        var totalInstalled = summary.totalInstalled || 0;
        var totalFailed = summary.totalFailed || 0;
        var totalPending = summary.totalPending || 0;
        var overallInstallRate = summary.overallInstallRate || 0;
        var platformBreakdown = summary.platformBreakdown || {};
        var typeBreakdown = summary.typeBreakdown || {};

        var total = totalInstalled + totalFailed + totalPending;
        var installedPct = total > 0 ? Math.round((totalInstalled / total) * 100) : 0;
        var failedPct = total > 0 ? Math.round((totalFailed / total) * 100) : 0;
        var pendingPct = total > 0 ? Math.round((totalPending / total) * 100) : 0;

        // Create SVG donut chart
        var radius = 45;
        var circumference = 2 * Math.PI * radius;
        var installedDash = (installedPct / 100) * circumference;
        var failedDash = (failedPct / 100) * circumference;
        var pendingDash = (pendingPct / 100) * circumference;

        var html = '<div class="analytics-grid">';

        // Overall Install Rate Card
        html += '<div class="analytics-card score-card">';
        html += '<h3>Overall Install Success</h3>';
        html += '<div class="donut-chart">';
        html += '<svg viewBox="0 0 100 100" class="donut">';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-bg-tertiary)" stroke-width="10"/>';
        html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-success)" stroke-width="10" ';
        html += 'stroke-dasharray="' + installedDash + ' ' + circumference + '"/>';
        if (failedPct > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-critical)" stroke-width="10" ';
            html += 'stroke-dasharray="' + failedDash + ' ' + circumference + '" stroke-dashoffset="-' + installedDash + '"/>';
        }
        if (pendingPct > 0) {
            html += '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--color-warning)" stroke-width="10" ';
            html += 'stroke-dasharray="' + pendingDash + ' ' + circumference + '" stroke-dashoffset="-' + (installedDash + failedDash) + '"/>';
        }
        html += '</svg>';
        html += '<div class="donut-center"><span class="donut-value">' + overallInstallRate + '%</span><span class="donut-label">Success</span></div>';
        html += '</div>';
        html += '<div class="status-legend">';
        html += '<div class="legend-item"><span class="legend-dot success"></span>Installed: ' + totalInstalled.toLocaleString() + '</div>';
        html += '<div class="legend-item"><span class="legend-dot error"></span>Failed: ' + totalFailed.toLocaleString() + '</div>';
        html += '<div class="legend-item"><span class="legend-dot warning"></span>Pending: ' + totalPending.toLocaleString() + '</div>';
        html += '</div>';
        html += '</div>';

        // Platform Breakdown
        html += '<div class="analytics-card">';
        html += '<h3>Platform Breakdown</h3>';
        html += '<div class="platform-list">';
        Object.keys(platformBreakdown).forEach(function(platform) {
            var stats = platformBreakdown[platform];
            var platformTotal = stats.installed + stats.failed;
            var platformPct = platformTotal > 0 ? Math.round((stats.installed / platformTotal) * 100) : 0;
            var platformIcon = getPlatformIcon(platform);
            html += '<div class="platform-item">';
            html += '<div class="platform-header"><span class="platform-icon">' + platformIcon + '</span><span class="platform-name">' + platform + '</span><span class="platform-count">' + stats.apps + ' apps</span></div>';
            html += '<div class="mini-bar"><div class="mini-bar-fill" style="width:' + platformPct + '%"></div></div>';
            html += '<div class="platform-stats"><span class="text-success">' + stats.installed + ' installed</span><span class="text-critical">' + stats.failed + ' failed</span></div>';
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';

        // App Types
        html += '<div class="analytics-card">';
        html += '<h3>App Types</h3>';
        html += '<div class="category-list scrollable">';
        Object.keys(typeBreakdown).forEach(function(appType) {
            var stats = typeBreakdown[appType];
            var typeTotal = stats.installed + stats.failed;
            var typePct = typeTotal > 0 ? Math.round((stats.installed / typeTotal) * 100) : 0;
            var typeIcon = getTypeIcon(appType);
            html += '<div class="category-item">';
            html += '<span class="category-icon">' + typeIcon + '</span>';
            html += '<span class="category-name">' + appType + '</span>';
            html += '<span class="category-count">' + stats.apps + '</span>';
            html += '<span class="category-rate ' + (typePct >= 90 ? 'text-success' : typePct >= 70 ? 'text-warning' : 'text-critical') + '">' + typePct + '%</span>';
            html += '</div>';
        });
        html += '</div>';
        html += '</div>';

        html += '</div>'; // analytics-grid

        // Insights Section
        if (insights.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Deployment Insights</h3>';
            html += '<div class="insights-list">';
            insights.forEach(function(insight) {
                var severityClass = insight.severity === 'critical' ? 'insight-critical' :
                                   insight.severity === 'high' ? 'insight-high' :
                                   insight.severity === 'info' ? 'insight-info' : 'insight-warning';
                var severityBadge = insight.severity === 'critical' ? '<span class="badge badge-critical">Critical</span>' :
                                   insight.severity === 'high' ? '<span class="badge badge-warning">High</span>' :
                                   insight.severity === 'info' ? '<span class="badge badge-info">Info</span>' :
                                   '<span class="badge badge-neutral">Medium</span>';
                html += '<div class="insight-card ' + severityClass + '">';
                html += '<div class="insight-header">';
                html += '<strong>' + (insight.title || 'Insight') + '</strong> ' + severityBadge;
                html += '</div>';
                html += '<div class="insight-description">' + (insight.description || '') + '</div>';
                if (insight.impactedApps) {
                    html += '<div class="insight-impact">Impacted: <strong>' + insight.impactedApps + ' apps</strong></div>';
                }
                if (insight.impactedDevices) {
                    html += '<div class="insight-impact">Devices: <strong>' + insight.impactedDevices + '</strong></div>';
                }
                if (insight.recommendedAction) {
                    html += '<div class="insight-action">Action: ' + insight.recommendedAction + '</div>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        }

        // Apps Needing Attention
        var problemApps = apps.filter(function(a) {
            return a.failedCount > 0 || (a.installRate && a.installRate < 80);
        }).slice(0, 5);

        if (problemApps.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Apps Needing Attention (' + problemApps.length + ')</h3>';
            html += '<div class="problem-apps">';
            problemApps.forEach(function(app) {
                html += '<div class="problem-app-card" onclick="PageAppDeployments.showAppDetail(\'' + app.id + '\')">';
                html += '<strong>' + (app.displayName || 'Unknown') + '</strong>';
                html += '<div class="app-badges"><span class="badge badge-neutral">' + (app.platform || 'Unknown') + '</span> <span class="badge badge-info">' + (app.appType || 'Unknown') + '</span></div>';
                html += '<div class="app-issue">';
                if (app.failedCount > 0) html += '<span class="text-critical">' + app.failedCount + ' failed</span> | ';
                html += '<span class="' + (app.installRate >= 90 ? 'text-success' : app.installRate >= 70 ? 'text-warning' : 'text-critical') + '">' + (app.installRate || 0) + '% success</span>';
                html += '</div>';
                html += '</div>';
            });
            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    function renderAppsTab(container) {
        var apps = (rawData.apps || []).map(mapApp);

        var types = {}, platforms = {};
        apps.forEach(function(a) {
            types[a.appType || 'Unknown'] = 1;
            platforms[a.platform || 'Unknown'] = 1;
        });

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="apps-search" placeholder="Search apps...">';
        html += '<select class="filter-select" id="apps-platform"><option value="all">All Platforms</option>';
        Object.keys(platforms).forEach(function(p) { html += '<option value="' + p + '">' + p + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="apps-type"><option value="all">All Types</option>';
        Object.keys(types).forEach(function(t) { html += '<option value="' + t + '">' + t + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="apps-status"><option value="all">All Status</option><option value="failing">With Failures</option><option value="pending">With Pending</option></select>';
        html += '<div id="apps-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="apps-table"></div>';

        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'apps-colselector',
            storageKey: 'tenantscope-apps-cols',
            allColumns: [
                { key: 'displayName', label: 'App Name' },
                { key: 'appType', label: 'Type' },
                { key: 'platform', label: 'Platform' },
                { key: 'publisher', label: 'Publisher' },
                { key: 'version', label: 'Version' },
                { key: 'assignmentCount', label: 'Assignments' },
                { key: 'hasRequiredAssignment', label: 'Required' },
                { key: 'totalDevices', label: 'Assigned Devices' },
                { key: 'installedCount', label: 'Installed' },
                { key: 'failedCount', label: 'Failed' },
                { key: 'pendingCount', label: 'Pending' },
                { key: 'notInstalledCount', label: 'Not Installed' },
                { key: 'notApplicableCount', label: 'Not Applicable' },
                { key: 'installRate', label: 'Success Rate' },
                { key: 'isFeatured', label: 'Featured' },
                { key: 'createdDateTime', label: 'Created' },
                { key: 'lastModifiedDateTime', label: 'Last Modified' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'appType', 'platform', 'installedCount', 'failedCount', 'installRate', '_adminLinks'],
            onColumnsChanged: function() { applyAppsFilters(); }
        });

        Filters.setup('apps-search', applyAppsFilters);
        Filters.setup('apps-platform', applyAppsFilters);
        Filters.setup('apps-type', applyAppsFilters);
        Filters.setup('apps-status', applyAppsFilters);
        applyAppsFilters();
    }

    function applyAppsFilters() {
        if (!rawData) return;
        var apps = (rawData.apps || []).map(mapApp);
        var totalApps = apps.length;

        var filterConfig = {
            search: Filters.getValue('apps-search'),
            searchFields: ['displayName', 'publisher', 'appType', 'platform'],
            exact: {}
        };

        var platformFilter = Filters.getValue('apps-platform');
        if (platformFilter && platformFilter !== 'all') filterConfig.exact.platform = platformFilter;
        var typeFilter = Filters.getValue('apps-type');
        if (typeFilter && typeFilter !== 'all') filterConfig.exact.appType = typeFilter;

        var filteredData = Filters.apply(apps, filterConfig);

        var statusFilter = Filters.getValue('apps-status');
        if (statusFilter === 'failing') filteredData = filteredData.filter(function(a) { return a.failedCount > 0; });
        else if (statusFilter === 'pending') filteredData = filteredData.filter(function(a) { return a.pendingCount > 0; });

        // Update summary cards with filtered counts
        updateAppsSummaryCards(filteredData, totalApps);

        renderAppsTable(filteredData);
    }

    function updateAppsSummaryCards(filteredApps, totalApps) {
        var filtered = filteredApps.length;
        var installed = filteredApps.reduce(function(sum, a) { return sum + (a.installedCount || 0); }, 0);
        var failed = filteredApps.reduce(function(sum, a) { return sum + (a.failedCount || 0); }, 0);
        var withFailures = filteredApps.filter(function(a) { return (a.failedCount || 0) > 0; }).length;

        var totalEl = document.getElementById('apps-total-value');
        var installedEl = document.getElementById('apps-installed-value');
        var failedEl = document.getElementById('apps-failed-value');
        var withFailuresEl = document.getElementById('apps-withfailures-value');

        if (totalEl) totalEl.textContent = filtered + (filtered !== totalApps ? ' / ' + totalApps : '');
        if (installedEl) installedEl.textContent = installed.toLocaleString();
        if (failedEl) failedEl.textContent = failed.toLocaleString();
        if (withFailuresEl) withFailuresEl.textContent = withFailures;
    }

    function renderAppsTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'appType', 'platform', 'installedCount', 'failedCount', 'installRate'];

        var allDefs = [
            { key: 'displayName', label: 'App Name', formatter: function(v, row) {
                return '<a href="#" class="app-link" data-id="' + row.id + '">' + (v || 'Unnamed') + '</a>';
            }},
            { key: 'appType', label: 'Type', formatter: function(v) { return '<span class="badge badge-info">' + (v || 'Unknown') + '</span>'; } },
            { key: 'platform', label: 'Platform', formatter: function(v) { return '<span class="badge badge-neutral">' + (v || 'Unknown') + '</span>'; } },
            { key: 'publisher', label: 'Publisher' },
            { key: 'version', label: 'Version', formatter: function(v) { return v ? '<span class="badge badge-outline">' + v + '</span>' : '<span class="text-muted">--</span>'; } },
            { key: 'assignmentCount', label: 'Assignments', formatter: function(v) { return v || 0; } },
            { key: 'hasRequiredAssignment', label: 'Required', formatter: function(v) {
                return v ? '<span class="badge badge-critical">Yes</span>' : '<span class="badge badge-neutral">No</span>';
            }},
            { key: 'totalDevices', label: 'Assigned Devices' },
            { key: 'installedCount', label: 'Installed', formatter: function(v) { return '<span class="text-success">' + (v || 0) + '</span>'; } },
            { key: 'failedCount', label: 'Failed', formatter: function(v) { return v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>'; } },
            { key: 'pendingCount', label: 'Pending', formatter: function(v) { return v ? '<span class="text-warning">' + v + '</span>' : '<span class="text-muted">0</span>'; } },
            { key: 'notInstalledCount', label: 'Not Installed', formatter: function(v) { return v ? '<span class="text-muted">' + v + '</span>' : '<span class="text-muted">0</span>'; } },
            { key: 'notApplicableCount', label: 'Not Applicable', formatter: function(v) { return v ? '<span class="text-muted">' + v + '</span>' : '<span class="text-muted">0</span>'; } },
            { key: 'installRate', label: 'Success Rate', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v >= 90 ? 'text-success' : v >= 70 ? 'text-warning' : 'text-critical';
                return '<span class="' + cls + ' font-bold">' + v + '%</span>';
            }},
            { key: 'isFeatured', label: 'Featured', formatter: function(v) {
                return v ? '<span class="badge badge-info">Featured</span>' : '<span class="text-muted">--</span>';
            }},
            { key: 'createdDateTime', label: 'Created', formatter: function(v) { return Tables.formatters.date(v); } },
            { key: 'lastModifiedDateTime', label: 'Last Modified', formatter: function(v) { return Tables.formatters.date(v); } },
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesComplianceMenu/~/policies" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'apps-table',
            data: data,
            columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }),
            pageSize: 50,
            onRowClick: function(row) { showAppDetail(row.id); }
        });

        // Add click handlers for app links
        document.querySelectorAll('.app-link').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                showAppDetail(this.dataset.id);
            });
        });
    }

    function renderFailedDevicesTab(container) {
        var failedDevices = rawData.failedDevices || [];

        var html = '<div class="section-header">';
        html += '<h3>Devices with App Installation Failures</h3>';
        html += '<p class="text-muted">Devices failing one or more app installations</p>';
        html += '</div>';

        if (failedDevices.length === 0) {
            html += '<div class="empty-state"><p>No devices with app installation failures</p></div>';
            container.innerHTML = html;
            return;
        }

        html += '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="failed-devices-search" placeholder="Search devices...">';
        html += '</div>';
        html += '<div class="table-container" id="failed-devices-table"></div>';

        container.innerHTML = html;

        Filters.setup('failed-devices-search', function() {
            var search = Filters.getValue('failed-devices-search');
            var filtered = failedDevices;
            if (search) {
                search = search.toLowerCase();
                filtered = failedDevices.filter(function(d) {
                    return (d.deviceName || '').toLowerCase().indexOf(search) !== -1 ||
                           (d.userName || '').toLowerCase().indexOf(search) !== -1;
                });
            }
            renderFailedDevicesTable(filtered);
        });

        renderFailedDevicesTable(failedDevices);
    }

    function renderFailedDevicesTable(data) {
        var columns = [
            { key: 'deviceName', label: 'Device Name' },
            { key: 'userName', label: 'User' },
            { key: 'failedAppCount', label: 'Failed Apps', formatter: function(v) {
                var cls = v >= 3 ? 'text-critical' : v >= 2 ? 'text-warning' : '';
                return '<span class="' + cls + ' font-bold">' + (v || 0) + '</span>';
            }},
            { key: 'failedApps', label: 'Failing Apps', formatter: function(v) {
                if (!v || !Array.isArray(v) || v.length === 0) return '<span class="text-muted">None</span>';
                return v.slice(0, 3).map(function(a) {
                    return '<span class="badge badge-outline">' + a + '</span>';
                }).join(' ') + (v.length > 3 ? ' <span class="text-muted">+' + (v.length - 3) + ' more</span>' : '');
            }}
        ];

        Tables.render({
            containerId: 'failed-devices-table',
            data: data,
            columns: columns,
            pageSize: 50
        });
    }

    function showAppDetail(appId) {
        if (!rawData) return;
        var apps = rawData.apps || [];
        var app = apps.find(function(a) { return a.id === appId; });
        if (!app) return;

        app = mapApp(app);

        var html = '<div class="modal-header">';
        html += '<h3>' + (app.displayName || 'App Details') + '</h3>';
        html += '<button class="modal-close" onclick="PageAppDeployments.closeModal()">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        // App Info
        html += '<div class="detail-section">';
        html += '<h4>Application Information</h4>';
        html += '<div class="detail-grid">';
        html += '<div class="detail-item"><span class="detail-label">Type</span><span class="detail-value"><span class="badge badge-info">' + (app.appType || 'Unknown') + '</span></span></div>';
        html += '<div class="detail-item"><span class="detail-label">Platform</span><span class="detail-value"><span class="badge badge-neutral">' + (app.platform || 'Unknown') + '</span></span></div>';
        html += '<div class="detail-item"><span class="detail-label">Publisher</span><span class="detail-value">' + (app.publisher || 'Unknown') + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Version</span><span class="detail-value">' + (app.version || 'N/A') + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Featured</span><span class="detail-value">' + (app.isFeatured ? '<span class="badge badge-info">Yes</span>' : 'No') + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Created</span><span class="detail-value">' + Tables.formatters.date(app.createdDateTime) + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Last Modified</span><span class="detail-value">' + Tables.formatters.date(app.lastModifiedDateTime) + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Assignments</span><span class="detail-value">' + (app.assignmentCount || 0) + ' assignment(s)</span></div>';
        html += '</div>';
        if (app.description) {
            html += '<p class="detail-description">' + app.description + '</p>';
        }
        // URLs
        if (app.informationUrl || app.privacyInformationUrl) {
            html += '<div class="detail-links">';
            if (app.informationUrl) {
                html += '<a href="' + app.informationUrl + '" target="_blank" class="detail-link">App Information</a>';
            }
            if (app.privacyInformationUrl) {
                html += '<a href="' + app.privacyInformationUrl + '" target="_blank" class="detail-link">Privacy Policy</a>';
            }
            html += '</div>';
        }
        html += '</div>';

        // Installation Status
        html += '<div class="detail-section">';
        html += '<h4>Installation Status</h4>';
        html += '<div class="status-cards">';
        html += '<div class="status-card success"><span class="status-value">' + (app.installedCount || 0) + '</span><span class="status-label">Installed</span></div>';
        html += '<div class="status-card error"><span class="status-value">' + (app.failedCount || 0) + '</span><span class="status-label">Failed</span></div>';
        html += '<div class="status-card warning"><span class="status-value">' + (app.pendingCount || 0) + '</span><span class="status-label">Pending</span></div>';
        html += '<div class="status-card neutral"><span class="status-value">' + (app.notInstalledCount || 0) + '</span><span class="status-label">Not Installed</span></div>';
        html += '</div>';
        html += '<div class="status-cards" style="margin-top: var(--spacing-sm);">';
        html += '<div class="status-card neutral"><span class="status-value">' + (app.notApplicableCount || 0) + '</span><span class="status-label">Not Applicable</span></div>';
        html += '<div class="status-card neutral"><span class="status-value">' + (app.totalDevices || 0) + '</span><span class="status-label">Total Devices</span></div>';
        var rateClass = (app.installRate || 0) >= 90 ? 'success' : (app.installRate || 0) >= 70 ? 'warning' : 'error';
        html += '<div class="status-card ' + rateClass + '"><span class="status-value">' + (app.installRate || 0) + '%</span><span class="status-label">Success Rate</span></div>';
        html += '</div>';
        html += '</div>';

        // Assignments
        if (app.assignments && app.assignments.length > 0) {
            html += '<div class="detail-section">';
            html += '<h4>Assignments</h4>';
            html += '<div class="assignment-list">';
            app.assignments.forEach(function(a) {
                var intentBadge = a.intent === 'Required' ? '<span class="badge badge-critical">Required</span>' : '<span class="badge badge-info">Available</span>';
                html += '<div class="assignment-item">' + intentBadge + ' <span class="badge badge-outline">' + (a.targetName || 'Unknown') + '</span></div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // Failed Device Statuses (if available)
        if (app.deviceStatuses && app.deviceStatuses.length > 0) {
            html += '<div class="detail-section">';
            html += '<h4>Failed Devices (' + app.deviceStatuses.length + ')</h4>';
            html += '<table class="detail-table"><thead><tr><th>Device</th><th>User</th><th>OS Version</th><th>Error Code</th><th>Detail</th><th>Last Sync</th></tr></thead><tbody>';
            app.deviceStatuses.slice(0, 10).forEach(function(ds) {
                html += '<tr>';
                html += '<td>' + (ds.deviceName || 'Unknown') + '</td>';
                html += '<td>' + (ds.userName || 'Unknown') + '</td>';
                html += '<td>' + (ds.osVersion || '--') + '</td>';
                html += '<td><span class="text-critical">' + (ds.errorCode || 'Unknown') + '</span></td>';
                html += '<td>' + (ds.installStateDetail || '--') + '</td>';
                html += '<td>' + Tables.formatters.date(ds.lastSyncDateTime) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            if (app.deviceStatuses.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + app.deviceStatuses.length + ' failed devices</p>';
            }
            html += '</div>';
        }

        html += '</div>';

        // Show modal
        var modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.id = 'app-detail-modal';
        modal.innerHTML = '<div class="modal-content">' + html + '</div>';
        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeModal();
        });
        document.body.appendChild(modal);
    }

    function closeModal() {
        var modal = document.getElementById('app-detail-modal');
        if (modal) modal.remove();
    }

    function getPlatformIcon(platform) {
        switch ((platform || '').toLowerCase()) {
            case 'windows': return '\uD83D\uDCBB';
            case 'ios': return '\uD83D\uDCF1';
            case 'macos': return '\uD83C\uDF4E';
            case 'android': return '\uD83E\uDD16';
            case 'cross-platform': return '\uD83C\uDF10';
            default: return '\uD83D\uDCBB';
        }
    }

    function getTypeIcon(appType) {
        if (appType.match(/Win32|MSI|MSIX|AppX/i)) return '\uD83D\uDCE6';
        if (appType.match(/Store/i)) return '\uD83C\uDFEA';
        if (appType.match(/365|Office/i)) return '\uD83D\uDCBC';
        if (appType.match(/Web|Link/i)) return '\uD83C\uDF10';
        if (appType.match(/LOB/i)) return '\uD83C\uDFED';
        if (appType.match(/VPP/i)) return '\uD83C\uDFF7';
        if (appType.match(/DMG|PKG/i)) return '\uD83D\uDCE5';
        if (appType.match(/Edge/i)) return '\uD83C\uDF10';
        if (appType.match(/Defender/i)) return '\uD83D\uDEE1';
        if (appType.match(/iOS/i)) return '\uD83D\uDCF1';
        if (appType.match(/Android|Managed/i)) return '\uD83E\uDD16';
        if (appType.match(/macOS/i)) return '\uD83C\uDF4E';
        return '\uD83D\uDCBB';
    }

    function render(container) {
        rawData = getData();

        if (!rawData) {
            container.innerHTML = '<div class="page-header"><h2>App Deployments</h2></div><div class="empty-state"><p>No app deployment data available</p></div>';
            return;
        }

        var summary = rawData.summary || {};
        var apps = rawData.apps || [];
        var totalApps = summary.totalApps || apps.length;
        var totalInstalled = summary.totalInstalled || 0;
        var totalFailed = summary.totalFailed || 0;
        var appsWithFailures = summary.appsWithFailures || apps.filter(function(a) { return (a.failedDevices || 0) > 0; }).length;

        var html = '<div class="page-header"><h2>App Deployments</h2></div>';

        // Summary Cards with IDs for filter updates
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value" id="apps-total-value">' + totalApps + '</div><div class="summary-label">Total Apps</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value" id="apps-installed-value">' + totalInstalled.toLocaleString() + '</div><div class="summary-label">Installed</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value" id="apps-failed-value">' + totalFailed.toLocaleString() + '</div><div class="summary-label">Failed</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value" id="apps-withfailures-value">' + appsWithFailures + '</div><div class="summary-label">Apps with Failures</div></div>';
        html += '</div>';

        // Tabs
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="apps">All Apps</button>';
        html += '<button class="tab-btn" data-tab="failed-devices">Failed Devices</button>';
        html += '</div>';

        // Tab Content Area
        html += '<div class="content-area" id="app-content"></div>';

        container.innerHTML = html;

        // Setup tab switching
        container.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchTab(this.dataset.tab);
            });
        });

        // Render initial tab
        currentTab = 'overview';
        renderTabContent();
    }

    return {
        render: render,
        showAppDetail: showAppDetail,
        closeModal: closeModal
    };
})();
