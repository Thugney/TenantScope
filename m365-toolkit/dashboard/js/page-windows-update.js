/**
 * TenantScope - Windows Update Status Page
 * Shows update rings, feature updates, quality updates, and driver updates
 * Author: Robel (https://github.com/Thugney)
 */

const PageWindowsUpdate = (function() {
    'use strict';

    /**
     * Escapes HTML special characters to prevent XSS
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Reference to SharedFormatters
    var SF = window.SharedFormatters || {};

    var currentTab = 'overview';
    var colSelectorRings = null;
    var colSelectorFeature = null;
    var colSelectorQuality = null;
    var colSelectorDrivers = null;

    // Extract data from both array and object formats
    function extractData(rawData) {
        if (!rawData) {
            return {
                updateRings: [],
                featureUpdates: [],
                qualityUpdates: [],
                driverUpdates: [],
                deviceCompliance: [],
                summary: computeSummary([], [], [], [])
            };
        }
        return {
            updateRings: rawData.updateRings || [],
            featureUpdates: rawData.featureUpdates || [],
            qualityUpdates: rawData.qualityUpdates || [],
            driverUpdates: rawData.driverUpdates || [],
            deviceCompliance: rawData.deviceCompliance || [],
            summary: rawData.summary || computeSummary(
                rawData.updateRings || [],
                rawData.featureUpdates || [],
                rawData.qualityUpdates || [],
                rawData.driverUpdates || []
            )
        };
    }

    function computeSummary(rings, featureUpdates, qualityUpdates, driverUpdates) {
        var totalDevices = 0, upToDate = 0, pending = 0, errors = 0;
        rings.forEach(function(r) {
            totalDevices += r.totalDevices || 0;
            upToDate += r.successDevices || 0;
            pending += r.pendingDevices || 0;
            errors += r.errorDevices || 0;
        });

        var complianceRate = totalDevices > 0 ? Math.round((upToDate / totalDevices) * 100 * 10) / 10 : 0;
        var pausedRings = rings.filter(function(r) { return r.qualityUpdatesPaused || r.featureUpdatesPaused; }).length;
        var expeditedCount = qualityUpdates.filter(function(q) { return q.isExpedited || q.expeditedUpdateSettings; }).length;
        var pendingApproval = driverUpdates.filter(function(d) { return d.approvalStatus === 'needs_review'; }).length;

        return {
            totalRings: rings.length,
            totalFeaturePolicies: featureUpdates.length,
            totalQualityPolicies: qualityUpdates.length,
            totalDriverUpdates: driverUpdates.length,
            totalManagedDevices: totalDevices,
            devicesUpToDate: upToDate,
            devicesPendingUpdate: pending,
            devicesWithErrors: errors,
            complianceRate: complianceRate,
            pausedRings: pausedRings,
            expeditedUpdatesActive: expeditedCount,
            driversNeedingReview: pendingApproval
        };
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var data = extractData(DataLoader.getData('windowsUpdateStatus'));
        var container = document.getElementById('update-content');
        if (!container) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, data);
                break;
            case 'rings':
                renderRingsTab(container, data.updateRings);
                break;
            case 'feature':
                renderFeatureTab(container, data.featureUpdates);
                break;
            case 'quality':
                renderQualityTab(container, data.qualityUpdates);
                break;
            case 'drivers':
                renderDriversTab(container, data.driverUpdates);
                break;
        }
    }

    function renderOverview(container, data) {
        var deviceCompliance = data.deviceCompliance || [];
        var errorDevices = deviceCompliance.filter(function(d) { return d.updateStatus === 'error'; });

        var html = '';
        if (errorDevices.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Devices with Update Errors (' + errorDevices.length + ')</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Device</th><th>User</th><th>Ring</th><th>Error Details</th><th>Last Sync</th>';
            html += '</tr></thead><tbody>';

            errorDevices.slice(0, 10).forEach(function(d) {
                html += '<tr>';
                html += '<td><a href="#devices?search=' + encodeURIComponent(d.deviceName || '') + '" class="entity-link"><strong>' + escapeHtml(d.deviceName || '--') + '</strong></a></td>';
                html += '<td class="cell-truncate"><a href="#users?search=' + encodeURIComponent(d.userPrincipalName || '') + '" class="entity-link">' + escapeHtml(d.userPrincipalName || '--') + '</a></td>';
                html += '<td>' + escapeHtml(d.updateRing || '--') + '</td>';
                html += '<td class="text-critical">' + escapeHtml(d.errorDetails || 'Unknown error') + '</td>';
                html += '<td>' + SF.formatDate(d.lastSyncDateTime) + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (errorDevices.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + errorDevices.length + ' devices with errors.</p>';
            }
            html += '</div>';
        } else {
            html = '<div class="empty-state"><p>No devices with update errors.</p></div>';
        }

        container.innerHTML = html;
    }

    function generateInsights(data) {
        var insights = [];
        var summary = data.summary;

        // Low compliance rate
        if (summary.complianceRate < 70) {
            insights.push({
                severity: 'critical',
                category: 'Compliance',
                description: 'Update compliance is at ' + Math.round(summary.complianceRate) + '%, which is below the recommended 70% threshold.',
                recommendedAction: 'Review update ring configurations and investigate devices with errors or pending updates.'
            });
        } else if (summary.complianceRate < 90) {
            insights.push({
                severity: 'medium',
                category: 'Compliance',
                description: 'Update compliance is at ' + Math.round(summary.complianceRate) + '%. Consider targeting 90% or higher.',
                recommendedAction: 'Identify devices with pending updates and ensure they have connectivity.'
            });
        }

        // Paused rings
        if (summary.pausedRings > 0) {
            insights.push({
                severity: 'high',
                category: 'Update Rings',
                description: summary.pausedRings + ' update ring(s) have updates paused, which may delay security patches.',
                recommendedAction: 'Review paused rings and resume updates if no longer needed.'
            });
        }

        // High error rate
        if (summary.devicesWithErrors > 0) {
            var errorPct = summary.totalManagedDevices > 0 ? Math.round((summary.devicesWithErrors / summary.totalManagedDevices) * 100) : 0;
            if (errorPct > 5) {
                insights.push({
                    severity: 'high',
                    category: 'Update Errors',
                    description: summary.devicesWithErrors + ' devices (' + errorPct + '%) have update errors.',
                    recommendedAction: 'Investigate common error patterns and remediate affected devices.'
                });
            }
        }

        // Drivers needing review
        if (summary.driversNeedingReview > 0) {
            insights.push({
                severity: 'medium',
                category: 'Driver Updates',
                description: summary.driversNeedingReview + ' driver update(s) require review before deployment.',
                recommendedAction: 'Review pending driver updates and approve or decline as appropriate.'
            });
        }

        return insights;
    }

    function renderRingsTab(container, rings) {
        if (rings.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Update Rings Configured</div><p>Configure Windows Update for Business rings in Intune to manage update deployment.</p></div>';
            return;
        }

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="rings-search" placeholder="Search rings...">';
        html += '<select class="filter-select" id="rings-status"><option value="all">All Status</option>';
        html += '<option value="active">Active</option><option value="paused">Paused</option></select>';
        html += '<div id="rings-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="rings-table"></div>';
        container.innerHTML = html;

        colSelectorRings = ColumnSelector.create({
            containerId: 'rings-colselector',
            storageKey: 'tenantscope-winupdate-cols-v1',
            allColumns: [
                { key: 'displayName', label: 'Ring Name' },
                { key: 'description', label: 'Description' },
                { key: 'qualityUpdatesDeferralDays', label: 'Quality Deferral' },
                { key: 'featureUpdatesDeferralDays', label: 'Feature Deferral' },
                { key: 'deadlineForQualityUpdates', label: 'Quality Deadline' },
                { key: 'deadlineForFeatureUpdates', label: 'Feature Deadline' },
                { key: 'status', label: 'Status' },
                { key: 'totalDevices', label: 'Total Devices' },
                { key: 'successDevices', label: 'Success' },
                { key: 'pendingDevices', label: 'Pending' },
                { key: 'errorDevices', label: 'Errors' },
                { key: 'complianceRate', label: 'Compliance' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'qualityUpdatesDeferralDays', 'featureUpdatesDeferralDays', 'status', 'totalDevices', 'successDevices', 'pendingDevices', 'errorDevices', 'complianceRate', '_adminLinks'],
            onColumnsChanged: function() { applyRingsFilters(); }
        });

        Filters.setup('rings-search', applyRingsFilters);
        Filters.setup('rings-status', applyRingsFilters);
        applyRingsFilters();
    }

    function applyRingsFilters() {
        var data = extractData(DataLoader.getData('windowsUpdateStatus'));
        var rings = data.updateRings;

        var filterConfig = {
            search: Filters.getValue('rings-search'),
            searchFields: ['displayName', 'description']
        };

        var filtered = Filters.apply(rings, filterConfig);

        // Status filter
        var statusFilter = Filters.getValue('rings-status');
        if (statusFilter && statusFilter !== 'all') {
            filtered = filtered.filter(function(r) {
                var isPaused = r.qualityUpdatesPaused || r.featureUpdatesPaused;
                return statusFilter === 'paused' ? isPaused : !isPaused;
            });
        }

        renderRingsTable(filtered);
    }

    function renderRingsTable(data) {
        var visible = colSelectorRings ? colSelectorRings.getVisible() : ['displayName', 'qualityUpdatesDeferralDays', 'featureUpdatesDeferralDays', 'status', 'totalDevices', 'successDevices', 'pendingDevices', 'errorDevices', 'complianceRate'];

        // Add computed fields
        data = data.map(function(r) {
            var total = r.totalDevices || 0;
            var success = r.successDevices || 0;
            r.complianceRate = total > 0 ? Math.round((success / total) * 100) : 0;
            r.status = (r.qualityUpdatesPaused || r.featureUpdatesPaused) ? 'paused' : 'active';
            return r;
        });

        var allDefs = [
            { key: 'displayName', label: 'Ring Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'description', label: 'Description', className: 'cell-truncate' },
            { key: 'qualityUpdatesDeferralDays', label: 'Quality Deferral', formatter: function(v) { return (v || 0) + ' days'; }},
            { key: 'featureUpdatesDeferralDays', label: 'Feature Deferral', formatter: function(v) { return (v || 0) + ' days'; }},
            { key: 'deadlineForQualityUpdates', label: 'Quality Deadline', formatter: function(v) { return v ? v + ' days' : '--'; }},
            { key: 'deadlineForFeatureUpdates', label: 'Feature Deadline', formatter: function(v) { return v ? v + ' days' : '--'; }},
            { key: 'status', label: 'Status', formatter: formatPausedStatus },
            { key: 'totalDevices', label: 'Total Devices', formatter: function(v) { return SF.formatCount(v); }},
            { key: 'successDevices', label: 'Success', formatter: function(v) { return '<span class="text-success font-bold">' + (v || 0) + '</span>'; }},
            { key: 'pendingDevices', label: 'Pending', formatter: function(v) { return '<span class="text-warning">' + (v || 0) + '</span>'; }},
            { key: 'errorDevices', label: 'Errors', formatter: function(v) { return SF.formatCount(v, { zeroIsGood: true }); }},
            { key: 'complianceRate', label: 'Compliance', formatter: function(v) { return SF.formatComplianceRate(v); }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesWindowsMenu/~/updateRings" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'rings-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showRingDetails
        });
    }

    function renderFeatureTab(container, updates) {
        if (!updates || updates.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Feature Update Policies</div><p>Feature update policies control when devices receive major Windows updates.</p></div>';
            return;
        }

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="feature-search" placeholder="Search feature updates...">';
        html += '<div id="feature-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="feature-table"></div>';
        container.innerHTML = html;

        colSelectorFeature = ColumnSelector.create({
            containerId: 'feature-colselector',
            storageKey: 'tenantscope-winupdate-feature-cols-v1',
            allColumns: [
                { key: 'displayName', label: 'Policy Name' },
                { key: 'featureUpdateVersion', label: 'Target Version' },
                { key: 'endOfSupportDate', label: 'End of Support' },
                { key: 'succeeded', label: 'Succeeded' },
                { key: 'pending', label: 'Pending' },
                { key: 'failed', label: 'Failed' },
                { key: 'progress', label: 'Progress' },
                { key: 'lastModifiedDateTime', label: 'Last Modified' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'featureUpdateVersion', 'endOfSupportDate', 'succeeded', 'pending', 'failed', 'progress', '_adminLinks'],
            onColumnsChanged: function() { applyFeatureFilters(); }
        });

        Filters.setup('feature-search', applyFeatureFilters);
        applyFeatureFilters();
    }

    function applyFeatureFilters() {
        var data = extractData(DataLoader.getData('windowsUpdateStatus'));
        var updates = data.featureUpdates;

        var filterConfig = {
            search: Filters.getValue('feature-search'),
            searchFields: ['displayName', 'featureUpdateVersion', 'description']
        };

        var filtered = Filters.apply(updates, filterConfig);
        renderFeatureTable(filtered);
    }

    function renderFeatureTable(data) {
        var visible = colSelectorFeature ? colSelectorFeature.getVisible() : ['displayName', 'featureUpdateVersion', 'endOfSupportDate', 'succeeded', 'pending', 'failed', 'progress'];

        // Flatten deployment state
        data = data.map(function(u) {
            var state = u.deploymentState || {};
            u.succeeded = state.succeeded || 0;
            u.pending = state.pending || 0;
            u.failed = state.failed || 0;
            u.total = state.total || 0;
            u.progress = u.total > 0 ? Math.round((u.succeeded / u.total) * 100) : 0;
            return u;
        });

        var allDefs = [
            { key: 'displayName', label: 'Policy Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'featureUpdateVersion', label: 'Target Version', formatter: function(v) { return '<span class="badge badge-info">' + (v || '--') + '</span>'; }},
            { key: 'endOfSupportDate', label: 'End of Support', formatter: function(v) { return SF.formatDate(v); }},
            { key: 'succeeded', label: 'Succeeded', formatter: function(v) { return '<span class="text-success font-bold">' + v + '</span>'; }},
            { key: 'pending', label: 'Pending', formatter: function(v) { return '<span class="text-warning">' + v + '</span>'; }},
            { key: 'failed', label: 'Failed', formatter: function(v) { return SF.formatCount(v, { zeroIsGood: true }); }},
            { key: 'progress', label: 'Progress', formatter: function(v) { return SF.formatComplianceRate(v); }},
            { key: 'lastModifiedDateTime', label: 'Last Modified', formatter: function(v) { return SF.formatDate(v); }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesWindowsMenu/~/featureUpdates" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'feature-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showFeatureDetails
        });
    }

    function renderQualityTab(container, updates) {
        if (!updates || updates.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Quality Update Policies</div><p>Quality update policies (expedited updates) allow pushing critical security updates faster.</p></div>';
            return;
        }

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="quality-search" placeholder="Search quality updates...">';
        html += '<select class="filter-select" id="quality-type"><option value="all">All Types</option>';
        html += '<option value="expedited">Expedited Only</option><option value="standard">Standard Only</option></select>';
        html += '<div id="quality-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="quality-table"></div>';
        container.innerHTML = html;

        colSelectorQuality = ColumnSelector.create({
            containerId: 'quality-colselector',
            storageKey: 'tenantscope-winupdate-quality-cols-v1',
            allColumns: [
                { key: 'displayName', label: 'Policy Name' },
                { key: 'releaseDateDisplayName', label: 'Release' },
                { key: 'qualityUpdateClassification', label: 'Classification' },
                { key: 'isExpedited', label: 'Expedited' },
                { key: 'succeeded', label: 'Succeeded' },
                { key: 'pending', label: 'Pending' },
                { key: 'failed', label: 'Failed' },
                { key: 'progress', label: 'Progress' },
                { key: 'lastModifiedDateTime', label: 'Last Modified' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'releaseDateDisplayName', 'qualityUpdateClassification', 'isExpedited', 'succeeded', 'pending', 'failed', 'progress', '_adminLinks'],
            onColumnsChanged: function() { applyQualityFilters(); }
        });

        Filters.setup('quality-search', applyQualityFilters);
        Filters.setup('quality-type', applyQualityFilters);
        applyQualityFilters();
    }

    function applyQualityFilters() {
        var data = extractData(DataLoader.getData('windowsUpdateStatus'));
        var updates = data.qualityUpdates;

        var filterConfig = {
            search: Filters.getValue('quality-search'),
            searchFields: ['displayName', 'releaseDateDisplayName', 'description']
        };

        var filtered = Filters.apply(updates, filterConfig);

        // Type filter
        var typeFilter = Filters.getValue('quality-type');
        if (typeFilter && typeFilter !== 'all') {
            filtered = filtered.filter(function(u) {
                var isExpedited = u.isExpedited || u.expeditedUpdateSettings;
                return typeFilter === 'expedited' ? isExpedited : !isExpedited;
            });
        }

        renderQualityTable(filtered);
    }

    function renderQualityTable(data) {
        var visible = colSelectorQuality ? colSelectorQuality.getVisible() : ['displayName', 'releaseDateDisplayName', 'qualityUpdateClassification', 'isExpedited', 'succeeded', 'pending', 'failed', 'progress'];

        // Flatten deployment state
        data = data.map(function(u) {
            var state = u.deploymentState || {};
            u.succeeded = state.succeeded || 0;
            u.pending = state.pending || 0;
            u.failed = state.failed || 0;
            u.total = state.total || (u.succeeded + u.pending + u.failed);
            u.progress = u.total > 0 ? Math.round((u.succeeded / u.total) * 100) : 0;
            u.isExpedited = u.isExpedited || !!u.expeditedUpdateSettings;
            return u;
        });

        var allDefs = [
            { key: 'displayName', label: 'Policy Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'releaseDateDisplayName', label: 'Release' },
            { key: 'qualityUpdateClassification', label: 'Classification', formatter: formatClassification },
            { key: 'isExpedited', label: 'Expedited', formatter: function(v) { return SF.formatBoolean(v); }},
            { key: 'succeeded', label: 'Succeeded', formatter: function(v) { return '<span class="text-success font-bold">' + v + '</span>'; }},
            { key: 'pending', label: 'Pending', formatter: function(v) { return '<span class="text-warning">' + v + '</span>'; }},
            { key: 'failed', label: 'Failed', formatter: function(v) { return SF.formatCount(v, { zeroIsGood: true }); }},
            { key: 'progress', label: 'Progress', formatter: function(v) { return SF.formatComplianceRate(v); }},
            { key: 'lastModifiedDateTime', label: 'Last Modified', formatter: function(v) { return SF.formatDate(v); }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesWindowsMenu/~/qualityUpdates" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'quality-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showQualityDetails
        });
    }

    function renderDriversTab(container, drivers) {
        if (!drivers || drivers.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Driver Updates</div><p>Windows Update for Business driver management is not configured or no drivers are available.</p></div>';
            return;
        }

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="drivers-search" placeholder="Search drivers...">';
        html += '<select class="filter-select" id="drivers-approval"><option value="all">All Approval Status</option>';
        html += '<option value="approved">Approved</option><option value="needs_review">Needs Review</option><option value="declined">Declined</option></select>';
        html += '<div id="drivers-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="drivers-table"></div>';
        container.innerHTML = html;

        colSelectorDrivers = ColumnSelector.create({
            containerId: 'drivers-colselector',
            storageKey: 'tenantscope-winupdate-drivers-cols-v1',
            allColumns: [
                { key: 'displayName', label: 'Driver Name' },
                { key: 'driverClass', label: 'Class' },
                { key: 'manufacturer', label: 'Manufacturer' },
                { key: 'version', label: 'Version' },
                { key: 'releaseDateTime', label: 'Release Date' },
                { key: 'approvalStatus', label: 'Approval' },
                { key: 'applicableDeviceCount', label: 'Applicable' },
                { key: 'succeeded', label: 'Succeeded' },
                { key: 'pending', label: 'Pending' },
                { key: 'failed', label: 'Failed' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'driverClass', 'manufacturer', 'version', 'approvalStatus', 'succeeded', 'pending', 'failed', '_adminLinks'],
            onColumnsChanged: function() { applyDriversFilters(); }
        });

        Filters.setup('drivers-search', applyDriversFilters);
        Filters.setup('drivers-approval', applyDriversFilters);
        applyDriversFilters();
    }

    function applyDriversFilters() {
        var data = extractData(DataLoader.getData('windowsUpdateStatus'));
        var drivers = data.driverUpdates;

        var filterConfig = {
            search: Filters.getValue('drivers-search'),
            searchFields: ['displayName', 'manufacturer', 'driverClass', 'version']
        };

        var filtered = Filters.apply(drivers, filterConfig);

        // Approval filter
        var approvalFilter = Filters.getValue('drivers-approval');
        if (approvalFilter && approvalFilter !== 'all') {
            filtered = filtered.filter(function(d) {
                return d.approvalStatus === approvalFilter;
            });
        }

        renderDriversTable(filtered);
    }

    function renderDriversTable(data) {
        var visible = colSelectorDrivers ? colSelectorDrivers.getVisible() : ['displayName', 'driverClass', 'manufacturer', 'version', 'approvalStatus', 'succeeded', 'pending', 'failed'];

        // Flatten deployment state
        data = data.map(function(d) {
            var state = d.deploymentState || {};
            d.succeeded = state.succeeded || 0;
            d.pending = state.pending || 0;
            d.failed = state.failed || 0;
            return d;
        });

        var allDefs = [
            { key: 'displayName', label: 'Driver Name', formatter: function(v) { return '<strong>' + (v || '--') + '</strong>'; }},
            { key: 'driverClass', label: 'Class' },
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'version', label: 'Version' },
            { key: 'releaseDateTime', label: 'Release Date', formatter: function(v) { return SF.formatDate(v); }},
            { key: 'approvalStatus', label: 'Approval', formatter: formatApprovalStatus },
            { key: 'applicableDeviceCount', label: 'Applicable', formatter: function(v) { return SF.formatCount(v); }},
            { key: 'succeeded', label: 'Succeeded', formatter: function(v) { return '<span class="text-success font-bold">' + v + '</span>'; }},
            { key: 'pending', label: 'Pending', formatter: function(v) { return '<span class="text-warning">' + v + '</span>'; }},
            { key: 'failed', label: 'Failed', formatter: function(v) { return SF.formatCount(v, { zeroIsGood: true }); }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesWindowsMenu/~/driverUpdates" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'drivers-table',
            data: data,
            columns: allDefs.filter(function(col) { return visible.indexOf(col.key) !== -1; }),
            pageSize: 50,
            onRowClick: showDriverDetails
        });
    }

    // Formatters
    function formatPausedStatus(value) {
        if (value === 'paused') return '<span class="badge badge-warning">Paused</span>';
        return '<span class="badge badge-success">Active</span>';
    }

    function formatClassification(value) {
        var map = {
            'Critical': 'badge-critical',
            'Security': 'badge-info',
            'Driver': 'badge-neutral',
            'FeaturePack': 'badge-info',
            'ServicePack': 'badge-info',
            'Tools': 'badge-neutral',
            'UpdateRollup': 'badge-info',
            'Updates': 'badge-neutral'
        };
        return '<span class="badge ' + (map[value] || 'badge-neutral') + '">' + (value || 'Unknown') + '</span>';
    }

    function formatApprovalStatus(value) {
        var map = {
            'approved': { badge: 'badge-success', label: 'Approved' },
            'needs_review': { badge: 'badge-warning', label: 'Needs Review' },
            'declined': { badge: 'badge-critical', label: 'Declined' }
        };
        var state = map[value] || { badge: 'badge-neutral', label: (value || 'Unknown').replace(/_/g, ' ') };
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    // Detail modals
    function showRingDetails(ring) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = ring.displayName || 'Update Ring Details';

        var html = '<div class="detail-grid">';

        // Ring Configuration
        html += '<div class="detail-section"><h4>Ring Configuration</h4><dl class="detail-list">';
        html += '<dt>Name</dt><dd>' + (ring.displayName || '--') + '</dd>';
        html += '<dt>Description</dt><dd>' + (ring.description || '--') + '</dd>';
        html += '<dt>Created</dt><dd>' + SF.formatDateTime(ring.createdDateTime) + '</dd>';
        html += '<dt>Last Modified</dt><dd>' + SF.formatDateTime(ring.lastModifiedDateTime) + '</dd>';
        html += '</dl></div>';

        // Deferral Settings
        html += '<div class="detail-section"><h4>Deferral Settings</h4><dl class="detail-list">';
        html += '<dt>Quality Updates Deferral</dt><dd>' + (ring.qualityUpdatesDeferralDays || 0) + ' days</dd>';
        html += '<dt>Feature Updates Deferral</dt><dd>' + (ring.featureUpdatesDeferralDays || 0) + ' days</dd>';
        html += '<dt>Quality Updates Paused</dt><dd>' + SF.formatBoolean(ring.qualityUpdatesPaused) + '</dd>';
        html += '<dt>Feature Updates Paused</dt><dd>' + SF.formatBoolean(ring.featureUpdatesPaused) + '</dd>';
        html += '</dl></div>';

        // Deadline Settings
        html += '<div class="detail-section"><h4>Deadline Settings</h4><dl class="detail-list">';
        html += '<dt>Quality Deadline</dt><dd>' + (ring.deadlineForQualityUpdates || '--') + ' days</dd>';
        html += '<dt>Feature Deadline</dt><dd>' + (ring.deadlineForFeatureUpdates || '--') + ' days</dd>';
        html += '<dt>Grace Period</dt><dd>' + (ring.deadlineGracePeriod || '--') + ' days</dd>';
        html += '</dl></div>';

        // Device Status
        html += '<div class="detail-section"><h4>Device Status</h4><dl class="detail-list">';
        html += '<dt>Total Devices</dt><dd>' + (ring.totalDevices || 0) + '</dd>';
        html += '<dt>Success</dt><dd><span class="text-success font-bold">' + (ring.successDevices || 0) + '</span></dd>';
        html += '<dt>Pending</dt><dd><span class="text-warning">' + (ring.pendingDevices || 0) + '</span></dd>';
        html += '<dt>Errors</dt><dd>' + SF.formatCount(ring.errorDevices, { zeroIsGood: true }) + '</dd>';
        var compRate = ring.totalDevices > 0 ? Math.round((ring.successDevices / ring.totalDevices) * 100) : 0;
        html += '<dt>Compliance Rate</dt><dd>' + SF.formatComplianceRate(compRate) + '</dd>';
        html += '</dl></div>';

        // Additional Settings
        html += '<div class="detail-section"><h4>Additional Settings</h4><dl class="detail-list">';
        html += '<dt>Auto Update Mode</dt><dd>' + (ring.automaticUpdateMode || '--') + '</dd>';
        html += '<dt>MS Update Service</dt><dd>' + SF.formatBoolean(ring.microsoftUpdateServiceAllowed) + '</dd>';
        html += '<dt>Drivers Excluded</dt><dd>' + SF.formatBoolean(ring.driversExcluded) + '</dd>';
        html += '<dt>Allow Win11 Upgrade</dt><dd>' + SF.formatBoolean(ring.allowWindows11Upgrade) + '</dd>';
        html += '</dl></div>';

        // Assigned Groups
        if (ring.assignedGroups && ring.assignedGroups.length > 0) {
            html += '<div class="detail-section"><h4>Assigned Groups</h4><ul class="detail-list-simple">';
            ring.assignedGroups.forEach(function(g) {
                html += '<li>' + g + '</li>';
            });
            html += '</ul></div>';
        }

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function showFeatureDetails(update) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = update.displayName || 'Feature Update Details';

        var state = update.deploymentState || {};
        var html = '<div class="detail-grid">';

        // Update Information
        html += '<div class="detail-section"><h4>Update Information</h4><dl class="detail-list">';
        html += '<dt>Name</dt><dd>' + (update.displayName || '--') + '</dd>';
        html += '<dt>Description</dt><dd>' + (update.description || '--') + '</dd>';
        html += '<dt>Target Version</dt><dd><span class="badge badge-info">' + (update.featureUpdateVersion || '--') + '</span></dd>';
        html += '<dt>End of Support</dt><dd>' + SF.formatDate(update.endOfSupportDate) + '</dd>';
        html += '</dl></div>';

        // Rollout Settings
        if (update.rolloutSettings) {
            html += '<div class="detail-section"><h4>Rollout Settings</h4><dl class="detail-list">';
            html += '<dt>Start Date</dt><dd>' + SF.formatDateTime(update.rolloutSettings.offerStartDateTimeInUTC) + '</dd>';
            html += '<dt>End Date</dt><dd>' + SF.formatDateTime(update.rolloutSettings.offerEndDateTimeInUTC) + '</dd>';
            html += '<dt>Interval</dt><dd>' + (update.rolloutSettings.offerIntervalInDays || '--') + ' days</dd>';
            html += '</dl></div>';
        }

        // Deployment Status
        html += '<div class="detail-section"><h4>Deployment Status</h4><dl class="detail-list">';
        html += '<dt>Total Devices</dt><dd>' + (state.total || 0) + '</dd>';
        html += '<dt>Succeeded</dt><dd><span class="text-success font-bold">' + (state.succeeded || 0) + '</span></dd>';
        html += '<dt>Pending</dt><dd><span class="text-warning">' + (state.pending || 0) + '</span></dd>';
        html += '<dt>Failed</dt><dd>' + SF.formatCount(state.failed, { zeroIsGood: true }) + '</dd>';
        html += '<dt>Not Applicable</dt><dd>' + (state.notApplicable || 0) + '</dd>';
        var progress = state.total > 0 ? Math.round((state.succeeded / state.total) * 100) : 0;
        html += '<dt>Progress</dt><dd>' + SF.formatComplianceRate(progress) + '</dd>';
        html += '</dl></div>';

        // Dates
        html += '<div class="detail-section"><h4>Dates</h4><dl class="detail-list">';
        html += '<dt>Created</dt><dd>' + SF.formatDateTime(update.createdDateTime) + '</dd>';
        html += '<dt>Last Modified</dt><dd>' + SF.formatDateTime(update.lastModifiedDateTime) + '</dd>';
        html += '</dl></div>';

        // Assigned Groups
        if (update.assignedGroups && update.assignedGroups.length > 0) {
            html += '<div class="detail-section"><h4>Assigned Groups</h4><ul class="detail-list-simple">';
            update.assignedGroups.forEach(function(g) {
                html += '<li>' + g + '</li>';
            });
            html += '</ul></div>';
        }

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function showQualityDetails(update) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = update.displayName || 'Quality Update Details';

        var state = update.deploymentState || {};
        var html = '<div class="detail-grid">';

        // Update Information
        html += '<div class="detail-section"><h4>Update Information</h4><dl class="detail-list">';
        html += '<dt>Name</dt><dd>' + (update.displayName || '--') + '</dd>';
        html += '<dt>Description</dt><dd>' + (update.description || '--') + '</dd>';
        html += '<dt>Release</dt><dd>' + (update.releaseDateDisplayName || '--') + '</dd>';
        html += '<dt>Classification</dt><dd>' + formatClassification(update.qualityUpdateClassification) + '</dd>';
        html += '<dt>Expedited</dt><dd>' + SF.formatBoolean(update.isExpedited || !!update.expeditedUpdateSettings) + '</dd>';
        html += '</dl></div>';

        // Expedited Settings
        if (update.expeditedUpdateSettings) {
            html += '<div class="detail-section"><h4>Expedited Settings</h4><dl class="detail-list">';
            html += '<dt>Cadence</dt><dd>' + (update.expeditedUpdateSettings.qualityUpdateCadence || '--') + '</dd>';
            html += '<dt>Days Until Forced Reboot</dt><dd>' + (update.expeditedUpdateSettings.daysUntilForcedReboot || '--') + '</dd>';
            html += '</dl></div>';
        }

        // Deployment Status
        html += '<div class="detail-section"><h4>Deployment Status</h4><dl class="detail-list">';
        var total = state.total || (state.succeeded || 0) + (state.pending || 0) + (state.failed || 0);
        html += '<dt>Total Devices</dt><dd>' + total + '</dd>';
        html += '<dt>Succeeded</dt><dd><span class="text-success font-bold">' + (state.succeeded || 0) + '</span></dd>';
        html += '<dt>Pending</dt><dd><span class="text-warning">' + (state.pending || 0) + '</span></dd>';
        html += '<dt>Failed</dt><dd>' + SF.formatCount(state.failed, { zeroIsGood: true }) + '</dd>';
        var progress = total > 0 ? Math.round((state.succeeded / total) * 100) : 0;
        html += '<dt>Progress</dt><dd>' + SF.formatComplianceRate(progress) + '</dd>';
        html += '</dl></div>';

        // Dates
        html += '<div class="detail-section"><h4>Dates</h4><dl class="detail-list">';
        html += '<dt>Created</dt><dd>' + SF.formatDateTime(update.createdDateTime) + '</dd>';
        html += '<dt>Last Modified</dt><dd>' + SF.formatDateTime(update.lastModifiedDateTime) + '</dd>';
        html += '</dl></div>';

        // Assigned Groups
        if (update.assignedGroups && update.assignedGroups.length > 0) {
            html += '<div class="detail-section"><h4>Assigned Groups</h4><ul class="detail-list-simple">';
            update.assignedGroups.forEach(function(g) {
                html += '<li>' + g + '</li>';
            });
            html += '</ul></div>';
        }

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function showDriverDetails(driver) {
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalTitle || !modalBody || !modalOverlay) return;

        modalTitle.textContent = driver.displayName || 'Driver Update Details';

        var state = driver.deploymentState || {};
        var html = '<div class="detail-grid">';

        // Driver Information
        html += '<div class="detail-section"><h4>Driver Information</h4><dl class="detail-list">';
        html += '<dt>Name</dt><dd>' + (driver.displayName || '--') + '</dd>';
        html += '<dt>Class</dt><dd>' + (driver.driverClass || '--') + '</dd>';
        html += '<dt>Manufacturer</dt><dd>' + (driver.manufacturer || '--') + '</dd>';
        html += '<dt>Version</dt><dd>' + (driver.version || '--') + '</dd>';
        html += '<dt>Release Date</dt><dd>' + SF.formatDate(driver.releaseDateTime) + '</dd>';
        html += '</dl></div>';

        // Approval Status
        html += '<div class="detail-section"><h4>Approval Status</h4><dl class="detail-list">';
        html += '<dt>Status</dt><dd>' + formatApprovalStatus(driver.approvalStatus) + '</dd>';
        html += '<dt>Applicable Devices</dt><dd>' + (driver.applicableDeviceCount || 0) + '</dd>';
        html += '<dt>Profile</dt><dd>' + (driver.profileName || '--') + '</dd>';
        html += '</dl></div>';

        // Deployment Status
        html += '<div class="detail-section"><h4>Deployment Status</h4><dl class="detail-list">';
        html += '<dt>Total</dt><dd>' + (state.total || 0) + '</dd>';
        html += '<dt>Succeeded</dt><dd><span class="text-success font-bold">' + (state.succeeded || 0) + '</span></dd>';
        html += '<dt>Pending</dt><dd><span class="text-warning">' + (state.pending || 0) + '</span></dd>';
        html += '<dt>Failed</dt><dd>' + SF.formatCount(state.failed, { zeroIsGood: true }) + '</dd>';
        html += '</dl></div>';

        html += '</div>'; // end detail-grid

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function render(container) {
        var data = extractData(DataLoader.getData('windowsUpdateStatus'));
        var summary = data.summary;

        var rateClass = summary.complianceRate >= 90 ? 'text-success' : summary.complianceRate >= 70 ? 'text-warning' : 'text-critical';

        var html = '<div class="page-header"><h2>Windows Update Status</h2></div>';

        // Summary cards
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + summary.totalManagedDevices + '</div><div class="summary-label">Total Devices</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + summary.devicesUpToDate + '</div><div class="summary-label">Up to Date</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + summary.devicesPendingUpdate + '</div><div class="summary-label">Pending</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + summary.devicesWithErrors + '</div><div class="summary-label">Errors</div></div>';
        html += '<div class="summary-card"><div class="summary-value ' + rateClass + '">' + Math.round(summary.complianceRate) + '%</div><div class="summary-label">Compliance Rate</div></div>';
        html += '</div>';

        // Tab bar
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="rings">Update Rings (' + summary.totalRings + ')</button>';
        html += '<button class="tab-btn" data-tab="feature">Feature Updates (' + summary.totalFeaturePolicies + ')</button>';
        html += '<button class="tab-btn" data-tab="quality">Quality Updates (' + summary.totalQualityPolicies + ')</button>';
        html += '<button class="tab-btn" data-tab="drivers">Driver Updates (' + summary.totalDriverUpdates + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="update-content"></div>';
        container.innerHTML = html;

        // Tab handlers
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();

window.PageWindowsUpdate = PageWindowsUpdate;
