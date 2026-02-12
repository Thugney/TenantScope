/**
 * TenantScope - Configuration Profiles Page
 * Enhanced with tabs, insights, and rich analytics
 * Follows device page patterns with SharedFormatters integration
 * Author: Robel (https://github.com/Thugney)
 */

const PageConfigurationProfiles = (function() {
    'use strict';

    // SharedFormatters reference
    var SF = window.SharedFormatters || {};

    /**
     * Escapes HTML special characters to prevent XSS
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var colSelector = null;
    var rawData = null;
    var activeTab = 'overview';

    // Extract data from nested structure
    function getData() {
        var data = DataLoader.getData('configurationProfiles');
        if (!data) return null;

        // Handle nested structure from collector
        if (data.profiles) {
            return data;
        }

        // Handle legacy flat array (old sample data)
        if (Array.isArray(data)) {
            return {
                profiles: data.map(mapProfile),
                failedDevices: [],
                settingFailures: [],
                insights: [],
                summary: buildSummaryFromArray(data)
            };
        }

        return null;
    }

    // Map collector field names to display field names
    function mapProfile(p) {
        return {
            id: p.id,
            displayName: p.displayName,
            description: p.description,
            profileType: p.profileType,
            platform: p.platform,
            category: p.category || 'General',
            source: p.source,
            assignments: p.assignments || [],
            assignmentCount: p.assignmentCount || (p.assignments ? p.assignments.length : 0),
            successCount: p.successDevices || p.successCount || 0,
            errorCount: p.errorDevices || p.errorCount || 0,
            conflictCount: p.conflictDevices || p.conflictCount || 0,
            pendingCount: p.pendingDevices || p.pendingCount || 0,
            totalDevices: p.totalDevices || 0,
            successRate: p.successRate,
            deviceStatuses: p.deviceStatuses || [],
            settingStatuses: p.settingStatuses || [],
            createdDateTime: p.createdDateTime,
            lastModified: p.lastModifiedDateTime || p.lastModified,
            hasErrors: p.hasErrors,
            hasConflicts: p.hasConflicts,
            needsAttention: p.needsAttention
        };
    }

    // Build summary from flat array (legacy support)
    function buildSummaryFromArray(profiles) {
        var totalDevices = 0, successDevices = 0, errorDevices = 0, conflictDevices = 0, pendingDevices = 0;
        var platformBreakdown = {}, typeBreakdown = {};
        var profilesWithErrors = 0, profilesWithConflicts = 0;

        profiles.forEach(function(p) {
            var success = p.successDevices || p.successCount || 0;
            var errors = p.errorDevices || p.errorCount || 0;
            var conflicts = p.conflictDevices || 0;
            var pending = p.pendingDevices || 0;
            var total = p.totalDevices || (success + errors + conflicts + pending);

            totalDevices += total;
            successDevices += success;
            errorDevices += errors;
            conflictDevices += conflicts;
            pendingDevices += pending;

            if (errors > 0) profilesWithErrors++;
            if (conflicts > 0) profilesWithConflicts++;

            var platform = p.platform || 'Unknown';
            if (!platformBreakdown[platform]) {
                platformBreakdown[platform] = { profiles: 0, success: 0, errors: 0 };
            }
            platformBreakdown[platform].profiles++;
            platformBreakdown[platform].success += success;
            platformBreakdown[platform].errors += errors;

            var pType = p.profileType || 'Unknown';
            if (!typeBreakdown[pType]) {
                typeBreakdown[pType] = { profiles: 0, success: 0, errors: 0 };
            }
            typeBreakdown[pType].profiles++;
            typeBreakdown[pType].success += success;
            typeBreakdown[pType].errors += errors;
        });

        var overallSuccessRate = totalDevices > 0 ? Math.round((successDevices / totalDevices) * 1000) / 10 : 0;

        return {
            totalProfiles: profiles.length,
            totalDevices: totalDevices,
            successDevices: successDevices,
            errorDevices: errorDevices,
            conflictDevices: conflictDevices,
            pendingDevices: pendingDevices,
            overallSuccessRate: overallSuccessRate,
            profilesWithErrors: profilesWithErrors,
            profilesWithConflicts: profilesWithConflicts,
            platformBreakdown: platformBreakdown,
            typeBreakdown: typeBreakdown
        };
    }

    function switchTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderTabContent(tab);
    }

    function renderOverviewTab(container, data) {
        var profiles = data.profiles || [];
        // Profiles Needing Attention
        var problemProfiles = profiles.filter(function(p) {
            var mapped = typeof p.errorCount !== 'undefined' ? p : mapProfile(p);
            return (mapped.errorCount || 0) > 0 || (mapped.conflictCount || 0) > 0;
        }).slice(0, 10);

        var html = '';
        if (problemProfiles.length > 0) {
            html += '<div class="analytics-section">';
            html += '<h3>Profiles Needing Attention (' + problemProfiles.length + ')</h3>';
            html += '<table class="data-table"><thead><tr>';
            html += '<th>Profile Name</th><th>Platform</th><th>Type</th><th>Errors</th><th>Conflicts</th><th>Success Rate</th>';
            html += '</tr></thead><tbody>';

            problemProfiles.forEach(function(profile) {
                var pProfile = typeof profile.errorCount !== 'undefined' ? profile : mapProfile(profile);
                html += '<tr class="clickable-row" data-profile-id="' + escapeHtml(pProfile.id) + '">';
                html += '<td><strong>' + escapeHtml(pProfile.displayName || 'Unnamed') + '</strong></td>';
                html += '<td>' + (SF.formatPlatform ? SF.formatPlatform(pProfile.platform) : '<span class="badge badge-neutral">' + escapeHtml(pProfile.platform || 'Unknown') + '</span>') + '</td>';
                html += '<td><span class="badge badge-info">' + escapeHtml(pProfile.profileType || 'Unknown') + '</span></td>';
                html += '<td>' + (SF.formatCount ? SF.formatCount(pProfile.errorCount, { zeroIsGood: true }) : (pProfile.errorCount > 0 ? '<span class="text-critical font-bold">' + pProfile.errorCount + '</span>' : '<span class="text-muted">0</span>')) + '</td>';
                html += '<td>' + (pProfile.conflictCount > 0 ? '<span class="text-warning font-bold">' + pProfile.conflictCount + '</span>' : '<span class="text-muted">0</span>') + '</td>';
                html += '<td>' + (SF.formatPercentage ? SF.formatPercentage(pProfile.successRate, { inverse: true }) : formatSuccessRate(pProfile.successRate)) + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (problemProfiles.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + problemProfiles.length + ' profiles. View the Profiles tab for complete list.</p>';
            }
            html += '</div>';
        } else {
            html = '<div class="empty-state"><p>No profiles needing attention.</p></div>';
        }

        container.innerHTML = html;

        // Add click handlers for problem profiles table rows
        container.querySelectorAll('.clickable-row[data-profile-id]').forEach(function(row) {
            row.addEventListener('click', function() {
                showProfileDetail(this.dataset.profileId);
            });
        });
    }

    function formatSuccessRate(value) {
        if (value === null || value === undefined || isNaN(Number(value))) return '<span class="text-muted">N/A</span>';
        var numVal = Number(value);
        var cls = numVal >= 90 ? 'text-success' : numVal >= 70 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + ' font-bold">' + Math.round(numVal) + '%</span>';
    }

    function renderProfilesTab(container, data) {
        var profiles = (data.profiles || []).map(mapProfile);

        var platforms = {}, types = {}, categories = {};
        profiles.forEach(function(p) {
            platforms[p.platform || 'Unknown'] = 1;
            types[p.profileType || 'Unknown'] = 1;
            categories[p.category || 'General'] = 1;
        });

        var html = '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="profiles-search" placeholder="Search profiles...">';
        html += '<select class="filter-select" id="profiles-platform"><option value="all">All Platforms</option>';
        Object.keys(platforms).sort().forEach(function(p) { html += '<option value="' + p + '">' + p + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="profiles-type"><option value="all">All Types</option>';
        Object.keys(types).sort().forEach(function(t) { html += '<option value="' + t + '">' + t + '</option>'; });
        html += '</select>';
        html += '<select class="filter-select" id="profiles-category"><option value="all">All Categories</option>';
        Object.keys(categories).sort().forEach(function(c) { html += '<option value="' + c + '">' + c + '</option>'; });
        html += '</select>';
        html += '<div id="profiles-colselector"></div>';
        html += '</div>';
        html += '<div class="table-container" id="profiles-table"></div>';

        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'profiles-colselector',
            storageKey: 'tenantscope-configprofiles-cols-v1',
            allColumns: [
                { key: 'displayName', label: 'Profile Name' },
                { key: 'profileType', label: 'Type' },
                { key: 'platform', label: 'Platform' },
                { key: 'category', label: 'Category' },
                { key: 'assignmentCount', label: 'Assignments' },
                { key: 'successCount', label: 'Success' },
                { key: 'errorCount', label: 'Errors' },
                { key: 'conflictCount', label: 'Conflicts' },
                { key: 'pendingCount', label: 'Pending' },
                { key: 'successRate', label: 'Success Rate' },
                { key: 'lastModified', label: 'Last Modified' },
                { key: '_adminLinks', label: 'Admin' }
            ],
            defaultVisible: ['displayName', 'profileType', 'platform', 'successCount', 'errorCount', 'successRate', '_adminLinks'],
            onColumnsChanged: function() { applyProfilesFilters(); }
        });

        Filters.setup('profiles-search', applyProfilesFilters);
        Filters.setup('profiles-platform', applyProfilesFilters);
        Filters.setup('profiles-type', applyProfilesFilters);
        Filters.setup('profiles-category', applyProfilesFilters);
        applyProfilesFilters();
    }

    function applyProfilesFilters() {
        if (!rawData) return;
        var profiles = (rawData.profiles || []).map(mapProfile);

        var filterConfig = {
            search: Filters.getValue('profiles-search'),
            searchFields: ['displayName', 'description', 'platform', 'profileType', 'category'],
            exact: {}
        };

        var platformFilter = Filters.getValue('profiles-platform');
        if (platformFilter && platformFilter !== 'all') filterConfig.exact.platform = platformFilter;
        var typeFilter = Filters.getValue('profiles-type');
        if (typeFilter && typeFilter !== 'all') filterConfig.exact.profileType = typeFilter;
        var categoryFilter = Filters.getValue('profiles-category');
        if (categoryFilter && categoryFilter !== 'all') filterConfig.exact.category = categoryFilter;

        renderProfilesTable(Filters.apply(profiles, filterConfig));
    }

    function renderProfilesTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['displayName', 'profileType', 'platform', 'successCount', 'errorCount', 'successRate'];

        var allDefs = [
            { key: 'displayName', label: 'Profile Name', formatter: function(v, row) {
                return '<a href="#" class="profile-link" data-id="' + row.id + '"><strong>' + (v || 'Unnamed') + '</strong></a>';
            }},
            { key: 'profileType', label: 'Type', formatter: function(v) {
                return '<span class="badge badge-info">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'platform', label: 'Platform', formatter: function(v) {
                return SF.formatPlatform ? SF.formatPlatform(v) : '<span class="badge badge-neutral">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'category', label: 'Category', formatter: function(v) {
                return '<span class="badge badge-neutral">' + (v || 'General') + '</span>';
            }},
            { key: 'assignmentCount', label: 'Assignments', formatter: function(v) {
                return SF.formatCount ? SF.formatCount(v) : (v || 0);
            }},
            { key: 'successCount', label: 'Success', formatter: function(v) {
                return SF.formatCount ? SF.formatCount(v) : '<span class="text-success">' + (v || 0) + '</span>';
            }},
            { key: 'errorCount', label: 'Errors', formatter: function(v) {
                return SF.formatCount ? SF.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'conflictCount', label: 'Conflicts', formatter: function(v) {
                return v ? '<span class="text-warning font-bold">' + v + '</span>' : '<span class="text-muted">0</span>';
            }},
            { key: 'pendingCount', label: 'Pending', formatter: function(v) {
                return v ? '<span class="text-info">' + v + '</span>' : '<span class="text-muted">0</span>';
            }},
            { key: 'successRate', label: 'Success Rate', formatter: function(v) {
                return SF.formatPercentage ? SF.formatPercentage(v, { inverse: true }) : formatSuccessRate(v);
            }},
            { key: 'lastModified', label: 'Last Modified', formatter: function(v) {
                return SF.formatDate ? SF.formatDate(v) : Tables.formatters.date(v);
            }},
            { key: '_adminLinks', label: 'Admin', formatter: function(v, row) {
                return '<a href="https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesComplianceMenu/~/policies" target="_blank" rel="noopener" class="admin-link" title="Open in Intune">Intune</a>';
            }}
        ];

        Tables.render({
            containerId: 'profiles-table',
            data: data,
            columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }),
            pageSize: 50,
            onRowClick: function(row) { showProfileDetail(row.id); }
        });

        // Add click handlers for profile links
        document.querySelectorAll('.profile-link').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                showProfileDetail(this.dataset.id);
            });
        });
    }

    function renderFailedDevicesTab(container, data) {
        var failedDevices = data.failedDevices || [];

        var html = '<div class="section-header">';
        html += '<h3>Devices with Profile Failures</h3>';
        html += '<p class="text-muted">Devices failing one or more configuration profiles</p>';
        html += '</div>';

        if (failedDevices.length === 0) {
            html += '<div class="empty-state"><div class="empty-state-title">No Failed Devices</div><p>No devices with profile failures detected.</p></div>';
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
            { key: 'deviceName', label: 'Device Name', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + v + '</strong></a>';
            }},
            { key: 'userName', label: 'User', className: 'cell-truncate', formatter: function(v) {
                if (!v) return '--';
                return '<a href="#users?search=' + encodeURIComponent(v) + '" class="entity-link">' + v + '</a>';
            }},
            { key: 'failedProfileCount', label: 'Failed Profiles', formatter: function(v) {
                var cls = v >= 3 ? 'text-critical font-bold' : v >= 2 ? 'text-warning font-bold' : 'text-warning';
                return '<span class="' + cls + '">' + (v || 0) + '</span>';
            }},
            { key: 'errorCount', label: 'Errors', formatter: function(v) {
                return SF.formatCount ? SF.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-critical">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'conflictCount', label: 'Conflicts', formatter: function(v) {
                return v ? '<span class="text-warning">' + v + '</span>' : '<span class="text-muted">0</span>';
            }},
            { key: 'failedProfiles', label: 'Failing Profiles', formatter: function(v) {
                if (!v || !Array.isArray(v) || v.length === 0) return '<span class="text-muted">None</span>';
                return v.slice(0, 3).map(function(p) {
                    return '<span class="badge badge-neutral">' + p + '</span>';
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

    function renderSettingFailuresTab(container, data) {
        var settingFailures = data.settingFailures || [];

        var html = '<div class="section-header">';
        html += '<h3>Setting-Level Failures</h3>';
        html += '<p class="text-muted">Configuration settings with deployment errors or conflicts</p>';
        html += '</div>';

        if (settingFailures.length === 0) {
            html += '<div class="empty-state"><div class="empty-state-title">No Setting Failures</div><p>No setting-level failures detected.</p></div>';
            container.innerHTML = html;
            return;
        }

        html += '<div class="filter-bar">';
        html += '<input type="text" class="filter-input" id="setting-failures-search" placeholder="Search settings...">';
        html += '</div>';
        html += '<div class="table-container" id="setting-failures-table"></div>';

        container.innerHTML = html;

        Filters.setup('setting-failures-search', function() {
            var search = Filters.getValue('setting-failures-search');
            var filtered = settingFailures;
            if (search) {
                search = search.toLowerCase();
                filtered = settingFailures.filter(function(s) {
                    return (s.settingName || '').toLowerCase().indexOf(search) !== -1 ||
                           (s.profileName || '').toLowerCase().indexOf(search) !== -1;
                });
            }
            renderSettingFailuresTable(filtered);
        });

        renderSettingFailuresTable(settingFailures);
    }

    function renderSettingFailuresTable(data) {
        var columns = [
            { key: 'settingName', label: 'Setting Name', formatter: function(v) {
                return '<strong>' + (v || 'Unknown') + '</strong>';
            }},
            { key: 'profileName', label: 'Profile' },
            { key: 'platform', label: 'Platform', formatter: function(v) {
                return SF.formatPlatform ? SF.formatPlatform(v) : '<span class="badge badge-neutral">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'errorCount', label: 'Errors', formatter: function(v) {
                return SF.formatCount ? SF.formatCount(v, { zeroIsGood: true }) : (v ? '<span class="text-critical font-bold">' + v + '</span>' : '<span class="text-muted">0</span>');
            }},
            { key: 'conflictCount', label: 'Conflicts', formatter: function(v) {
                return v ? '<span class="text-warning font-bold">' + v + '</span>' : '<span class="text-muted">0</span>';
            }}
        ];

        Tables.render({
            containerId: 'setting-failures-table',
            data: data,
            columns: columns,
            pageSize: 50
        });
    }

    function showProfileDetail(profileId) {
        if (!rawData) return;
        var profiles = rawData.profiles || [];
        var profile = profiles.find(function(p) { return p.id === profileId; });
        if (!profile) return;

        profile = mapProfile(profile);

        // Use standard modal-overlay pattern
        var modalTitle = document.getElementById('modal-title');
        var modalBody = document.getElementById('modal-body');
        var modalOverlay = document.getElementById('modal-overlay');

        if (!modalTitle || !modalBody || !modalOverlay) {
            // Fallback to dynamic modal if standard modal not available
            showDynamicModal(profile);
            return;
        }

        modalTitle.textContent = profile.displayName || 'Profile Details';

        var html = '<div class="detail-grid">';

        // Profile Information
        html += '<div class="detail-section"><h4>Profile Information</h4><dl class="detail-list">';
        html += '<dt>Type</dt><dd><span class="badge badge-info">' + (profile.profileType || 'Unknown') + '</span></dd>';
        html += '<dt>Platform</dt><dd>' + (SF.formatPlatform ? SF.formatPlatform(profile.platform) : '<span class="badge badge-neutral">' + (profile.platform || 'Unknown') + '</span>') + '</dd>';
        html += '<dt>Category</dt><dd>' + (profile.category || 'General') + '</dd>';
        html += '<dt>Assignments</dt><dd>' + (profile.assignmentCount || 0) + '</dd>';
        if (profile.description) {
            html += '<dt>Description</dt><dd>' + profile.description + '</dd>';
        }
        html += '</dl></div>';

        // Deployment Status
        html += '<div class="detail-section"><h4>Deployment Status</h4><dl class="detail-list">';
        html += '<dt>Success</dt><dd><span class="text-success font-bold">' + (profile.successCount || 0) + '</span></dd>';
        html += '<dt>Errors</dt><dd>' + (SF.formatCount ? SF.formatCount(profile.errorCount, { zeroIsGood: true }) : (profile.errorCount > 0 ? '<span class="text-critical font-bold">' + profile.errorCount + '</span>' : '0')) + '</dd>';
        html += '<dt>Conflicts</dt><dd>' + (profile.conflictCount > 0 ? '<span class="text-warning font-bold">' + profile.conflictCount + '</span>' : '0') + '</dd>';
        html += '<dt>Pending</dt><dd>' + (profile.pendingCount || 0) + '</dd>';
        html += '<dt>Success Rate</dt><dd>' + (SF.formatPercentage ? SF.formatPercentage(profile.successRate, { inverse: true }) : formatSuccessRate(profile.successRate)) + '</dd>';
        html += '</dl></div>';

        // Timestamps
        html += '<div class="detail-section"><h4>Timestamps</h4><dl class="detail-list">';
        html += '<dt>Created</dt><dd>' + (SF.formatDate ? SF.formatDate(profile.createdDateTime) : (profile.createdDateTime ? new Date(profile.createdDateTime).toLocaleDateString() : '--')) + '</dd>';
        html += '<dt>Last Modified</dt><dd>' + (SF.formatDate ? SF.formatDate(profile.lastModified) : (profile.lastModified ? new Date(profile.lastModified).toLocaleDateString() : '--')) + '</dd>';
        html += '</dl></div>';

        html += '</div>'; // end detail-grid

        // Assignments
        if (profile.assignments && profile.assignments.length > 0) {
            html += '<div class="detail-section"><h4>Assignments (' + profile.assignments.length + ')</h4>';
            html += '<div class="assignment-tags">';
            profile.assignments.forEach(function(a) {
                html += '<span class="badge badge-neutral">' + escapeHtml(a.name || a.type || 'Unknown') + '</span> ';
            });
            html += '</div></div>';
        }

        // Device Statuses (if available)
        if (profile.deviceStatuses && profile.deviceStatuses.length > 0) {
            html += '<div class="detail-section"><h4>Device Issues (' + profile.deviceStatuses.length + ')</h4>';
            html += '<table class="data-table"><thead><tr><th>Device</th><th>User</th><th>Status</th><th>Last Reported</th></tr></thead><tbody>';
            profile.deviceStatuses.slice(0, 10).forEach(function(ds) {
                var statusBadge = ds.status === 'error' ? 'badge-critical' : ds.status === 'conflict' ? 'badge-warning' : 'badge-neutral';
                html += '<tr>';
                html += '<td>' + escapeHtml(ds.deviceName || 'Unknown') + '</td>';
                html += '<td class="cell-truncate">' + escapeHtml(ds.userName || 'Unknown') + '</td>';
                html += '<td><span class="badge ' + statusBadge + '">' + escapeHtml(ds.status || 'Unknown') + '</span></td>';
                html += '<td>' + (SF.formatDate ? SF.formatDate(ds.lastReportedDateTime) : Tables.formatters.date(ds.lastReportedDateTime)) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            if (profile.deviceStatuses.length > 10) {
                html += '<p class="text-muted">Showing 10 of ' + profile.deviceStatuses.length + ' devices with issues</p>';
            }
            html += '</div>';
        }

        // Setting Statuses (if available)
        if (profile.settingStatuses && profile.settingStatuses.length > 0) {
            html += '<div class="detail-section"><h4>Setting Failures</h4>';
            html += '<table class="data-table"><thead><tr><th>Setting</th><th>Errors</th><th>Conflicts</th></tr></thead><tbody>';
            profile.settingStatuses.forEach(function(ss) {
                html += '<tr>';
                html += '<td>' + (ss.settingName || 'Unknown') + '</td>';
                html += '<td>' + (ss.errorCount ? '<span class="text-critical">' + ss.errorCount + '</span>' : '0') + '</td>';
                html += '<td>' + (ss.conflictCount ? '<span class="text-warning">' + ss.conflictCount + '</span>' : '0') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            html += '</div>';
        }

        modalBody.innerHTML = html;
        modalOverlay.classList.add('visible');
    }

    function showDynamicModal(profile) {
        // Fallback dynamic modal for compatibility
        var html = '<div class="modal-header">';
        html += '<h3>' + (profile.displayName || 'Profile Details') + '</h3>';
        html += '<button class="modal-close" onclick="PageConfigurationProfiles.closeModal()">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        // Profile Info
        html += '<div class="detail-section">';
        html += '<h4>Profile Information</h4>';
        html += '<div class="detail-grid">';
        html += '<div class="detail-item"><span class="detail-label">Type</span><span class="detail-value"><span class="badge badge-info">' + escapeHtml(profile.profileType || 'Unknown') + '</span></span></div>';
        html += '<div class="detail-item"><span class="detail-label">Platform</span><span class="detail-value">' + (SF.formatPlatform ? SF.formatPlatform(profile.platform) : '<span class="badge badge-neutral">' + escapeHtml(profile.platform || 'Unknown') + '</span>') + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Category</span><span class="detail-value">' + escapeHtml(profile.category || 'General') + '</span></div>';
        html += '<div class="detail-item"><span class="detail-label">Assignments</span><span class="detail-value">' + (profile.assignmentCount || 0) + '</span></div>';
        html += '</div>';
        if (profile.description) {
            html += '<p class="detail-description">' + escapeHtml(profile.description) + '</p>';
        }
        html += '</div>';

        // Deployment Status
        html += '<div class="detail-section">';
        html += '<h4>Deployment Status</h4>';
        html += '<div class="summary-cards" style="margin-bottom:0">';
        html += '<div class="summary-card card-success"><div class="summary-value">' + (profile.successCount || 0) + '</div><div class="summary-label">Success</div></div>';
        html += '<div class="summary-card' + (profile.errorCount > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + (profile.errorCount || 0) + '</div><div class="summary-label">Errors</div></div>';
        html += '<div class="summary-card' + (profile.conflictCount > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + (profile.conflictCount || 0) + '</div><div class="summary-label">Conflicts</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + (profile.pendingCount || 0) + '</div><div class="summary-label">Pending</div></div>';
        html += '</div>';
        html += '</div>';

        html += '</div>';

        // Show modal
        var modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.id = 'profile-detail-modal';
        modal.innerHTML = '<div class="modal-content">' + html + '</div>';
        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeModal();
        });
        document.body.appendChild(modal);
    }

    function closeModal() {
        // Try standard modal first
        var modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay && modalOverlay.classList.contains('visible')) {
            modalOverlay.classList.remove('visible');
            return;
        }
        // Fallback to dynamic modal
        var modal = document.getElementById('profile-detail-modal');
        if (modal) modal.remove();
    }

    function getPlatformIcon(platform) {
        switch ((platform || '').toLowerCase()) {
            case 'windows': return '\uD83D\uDDA5\uFE0F';
            case 'ios/ipados': case 'ios': return '\uD83D\uDCF1';
            case 'macos': return '\uD83C\uDF4E';
            case 'android': return '\uD83E\uDD16';
            default: return '\uD83D\uDCBB';
        }
    }

    function getTypeIcon(pType) {
        if (pType.match(/endpoint|security|firewall/i)) return '\uD83D\uDEE1\uFE0F';
        if (pType.match(/vpn|wi-fi|network/i)) return '\uD83C\uDF10';
        if (pType.match(/certificate/i)) return '\uD83D\uDD10';
        if (pType.match(/update/i)) return '\u2B06\uFE0F';
        if (pType.match(/kiosk|shared/i)) return '\uD83D\uDDA5\uFE0F';
        if (pType.match(/restriction/i)) return '\uD83D\uDEAB';
        return '\u2699\uFE0F';
    }

    function render(container) {
        rawData = getData();

        if (!rawData) {
            container.innerHTML = '<div class="page-header"><h2>Configuration Profiles</h2></div><div class="empty-state"><div class="empty-state-title">No Data Available</div><p>No configuration profile data available.</p></div>';
            return;
        }

        var summary = rawData.summary || {};
        var profiles = rawData.profiles || [];
        var totalProfiles = summary.totalProfiles || profiles.length;
        var totalSuccess = summary.successDevices || 0;
        var totalErrors = summary.errorDevices || 0;
        var totalConflicts = summary.conflictDevices || 0;
        var overallSuccessRate = summary.overallSuccessRate || 0;
        var rateClass = overallSuccessRate >= 90 ? 'text-success' : overallSuccessRate >= 70 ? 'text-warning' : 'text-critical';

        var failedDevicesCount = (rawData.failedDevices || []).length;
        var settingFailuresCount = (rawData.settingFailures || []).length;

        var html = '<div class="page-header"><h2>Configuration Profiles</h2></div>';

        // Summary Cards
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + totalProfiles + '</div><div class="summary-label">Total Profiles</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + totalSuccess.toLocaleString() + '</div><div class="summary-label">Successful</div></div>';
        html += '<div class="summary-card' + (totalErrors > 0 ? ' card-danger' : '') + '"><div class="summary-value">' + totalErrors.toLocaleString() + '</div><div class="summary-label">Errors</div></div>';
        html += '<div class="summary-card' + (totalConflicts > 0 ? ' card-warning' : '') + '"><div class="summary-value">' + totalConflicts.toLocaleString() + '</div><div class="summary-label">Conflicts</div></div>';
        html += '<div class="summary-card"><div class="summary-value ' + rateClass + '">' + Math.round(overallSuccessRate) + '%</div><div class="summary-label">Success Rate</div></div>';
        html += '</div>';

        // Tab bar
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="profiles">Profiles (' + totalProfiles + ')</button>';
        html += '<button class="tab-btn" data-tab="failed-devices">Failed Devices' + (failedDevicesCount > 0 ? ' (' + failedDevicesCount + ')' : '') + '</button>';
        html += '<button class="tab-btn" data-tab="setting-failures">Setting Failures' + (settingFailuresCount > 0 ? ' (' + settingFailuresCount + ')' : '') + '</button>';
        html += '</div>';

        html += '<div class="content-area" id="configprofiles-content"></div>';
        container.innerHTML = html;

        // Setup tab switching
        container.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                switchTab(btn.dataset.tab);
            });
        });

        // Render initial tab
        activeTab = 'overview';
        renderTabContent('overview');
    }

    function renderTabContent(tab) {
        if (!rawData) return;

        var tabContainer = document.getElementById('configprofiles-content');
        if (!tabContainer) return;

        // Update tab button states
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        switch (tab) {
            case 'overview':
                renderOverviewTab(tabContainer, rawData);
                break;
            case 'profiles':
                renderProfilesTab(tabContainer, rawData);
                break;
            case 'failed-devices':
                renderFailedDevicesTab(tabContainer, rawData);
                break;
            case 'setting-failures':
                renderSettingFailuresTab(tabContainer, rawData);
                break;
        }
    }

    return {
        render: render,
        showProfileDetail: showProfileDetail,
        closeModal: closeModal
    };
})();

window.PageConfigurationProfiles = PageConfigurationProfiles;
