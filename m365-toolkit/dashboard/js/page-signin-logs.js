/**
 * TenantScope - Sign-In Logs Page
 *
 * Investigation-first sign-in view. Keeps the raw evidence visible, but adds
 * triage queues, hotspots, and per-event drill-down.
 */

const PageSignInLogs = (function() {
    'use strict';

    var AU = window.ActionUtils || {};
    var state = {
        logs: [],
        filtered: []
    };
    var colSelector = null;

    function escapeHtml(value) {
        return Tables.escapeHtml(value === null || value === undefined ? '' : String(value));
    }

    function normalizeText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function formatLocation(item) {
        if (!item) return '';
        var parts = [item.city, item.country].filter(Boolean);
        if (parts.length > 0) return parts.join(', ');
        return normalizeText(item.location);
    }

    function normalizeStatus(status, errorCode) {
        var value = normalizeText(status).toLowerCase();
        if (value === 'failed') value = 'failure';
        if (value === 'succeeded') value = 'success';
        if (!value) {
            if (Number(errorCode) === 0) return 'success';
            if (Number(errorCode) > 0) return 'failure';
        }
        if (value === 'failure' && Number(errorCode) === 0) return 'success';
        return value || 'unknown';
    }

    function normalizeSignIns(rawData) {
        var list = Array.isArray(rawData) ? rawData : ((rawData && rawData.signIns) || []);

        return list.map(function(item) {
            var detail = item.deviceDetail || {};
            var riskLevel = normalizeText(item.riskLevel || 'none').toLowerCase();
            var riskState = normalizeText(item.riskState || 'none');
            var caStatus = normalizeText(item.caStatus || item.conditionalAccessStatus || '').toLowerCase();
            var mfaSatisfied = item.mfaSatisfied;
            var upn = normalizeText(item.userPrincipalName);

            if (mfaSatisfied === undefined) {
                mfaSatisfied = !!(item.mfaDetail && item.mfaDetail.authMethod);
            }

            return {
                id: item.id,
                createdDateTime: item.createdDateTime,
                userId: item.userId || item.user && item.user.id || '',
                userPrincipalName: upn,
                userDisplayName: item.userDisplayName || upn,
                appDisplayName: item.appDisplayName || '(unknown)',
                appId: item.appId || '',
                status: normalizeStatus(item.status, item.errorCode),
                errorCode: item.errorCode,
                failureReason: normalizeText(item.failureReason),
                riskLevel: riskLevel,
                riskState: riskState,
                clientAppUsed: normalizeText(item.clientAppUsed),
                ipAddress: normalizeText(item.ipAddress),
                location: formatLocation(item),
                isInteractive: item.isInteractive === true,
                mfaSatisfied: mfaSatisfied === true,
                mfaMethod: item.mfaDetail && item.mfaDetail.authMethod ? item.mfaDetail.authMethod : '',
                caStatus: caStatus || 'unknown',
                deviceName: normalizeText(detail.displayName || detail.deviceName || ''),
                deviceId: normalizeText(detail.deviceId || ''),
                browser: normalizeText(detail.browser),
                operatingSystem: normalizeText(detail.operatingSystem),
                isManaged: detail.isManaged === true,
                isCompliant: detail.isCompliant === true,
                trustType: normalizeText(detail.trustType),
                deviceDetail: detail,
                isGuest: upn.indexOf('#EXT#') >= 0 || (upn && upn.toLowerCase().indexOf('@contoso.com') === -1 && upn.toLowerCase().indexOf('@modum.') === -1)
            };
        }).sort(function(a, b) {
            return new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime();
        });
    }

    function getUserHref(target) {
        if (AU.getUserProfileHash) return AU.getUserProfileHash(target);
        var value = typeof target === 'string'
            ? target
            : target && (target.userPrincipalName || target.mail || target.displayName || '');
        return value ? '#users?search=' + encodeURIComponent(value) : '#users';
    }

    function getDeviceHref(target) {
        if (AU.getDeviceProfileHash) {
            var hash = AU.getDeviceProfileHash(target, { exactOnly: true });
            return hash !== '#devices' ? hash : '';
        }
        var value = typeof target === 'string'
            ? target
            : target && (target.deviceName || target.displayName || target.managedDeviceName || target.id || '');
        return value ? '#devices?search=' + encodeURIComponent(value) : '';
    }

    function getAppHref(target) {
        var value = typeof target === 'string'
            ? target
            : target && (target.appDisplayName || target.displayName || target.name || '');
        return value ? '#enterprise-apps?search=' + encodeURIComponent(value) : '#enterprise-apps';
    }

    function formatUserCell(value, row) {
        var label = row.userDisplayName && row.userDisplayName !== row.userPrincipalName
            ? '<strong>' + escapeHtml(row.userDisplayName) + '</strong><br><small>' + escapeHtml(row.userPrincipalName || '--') + '</small>'
            : '<strong>' + escapeHtml(row.userPrincipalName || row.userDisplayName || '--') + '</strong>';
        if (!row.userPrincipalName) return label;
        return '<a href="' + getUserHref(row.userPrincipalName) + '" class="entity-link" onclick="event.stopPropagation();">' + label + '</a>';
    }

    function formatAppCell(value, row) {
        if (!value) return '--';
        return '<a href="' + getAppHref(row) + '" class="entity-link" onclick="event.stopPropagation();"><strong>' + escapeHtml(value) + '</strong></a>';
    }

    function formatStatusBadge(value) {
        var map = {
            success: 'badge-success',
            failure: 'badge-critical',
            interrupted: 'badge-warning',
            unknown: 'badge-neutral'
        };
        return '<span class="badge ' + (map[value] || 'badge-neutral') + '">' + escapeHtml(value || 'unknown') + '</span>';
    }

    function formatRiskBadge(value) {
        var risk = normalizeText(value).toLowerCase();
        var map = {
            high: 'badge-critical',
            medium: 'badge-warning',
            low: 'badge-info',
            none: 'badge-success'
        };
        return '<span class="badge ' + (map[risk] || 'badge-neutral') + '">' + escapeHtml(risk || 'none') + '</span>';
    }

    function formatMfa(value, row) {
        if (value === true) {
            var title = row.mfaMethod ? ' title="' + escapeHtml(row.mfaMethod) + '"' : '';
            return '<span class="text-success"' + title + '>Satisfied</span>';
        }
        return '<span class="text-critical">Not Satisfied</span>';
    }

    function formatDevicePosture(value, row) {
        var parts = [];
        parts.push(row.isManaged ? '<span class="badge badge-success">Managed</span>' : '<span class="badge badge-warning">Unmanaged</span>');
        parts.push(row.isCompliant ? '<span class="badge badge-success">Compliant</span>' : '<span class="badge badge-critical">Non-Compliant</span>');
        if (row.trustType) parts.push('<span class="badge badge-neutral">' + escapeHtml(row.trustType) + '</span>');
        return parts.join(' ');
    }

    function formatActionCell(value, row) {
        var actions = [];
        if (row.userPrincipalName) {
            actions.push('<a href="' + getUserHref(row.userPrincipalName) + '" class="admin-link" onclick="event.stopPropagation();" title="Open user profile">User 360</a>');
        }
        if (row.deviceName || row.deviceId) {
            var deviceHref = getDeviceHref(row.deviceName || row.deviceId);
            if (deviceHref) {
                actions.push('<a href="' + deviceHref + '" class="admin-link" onclick="event.stopPropagation();" title="Open device profile">Device 360</a>');
            }
        }
        if (row.userId) {
            actions.push('<a href="https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(row.userId) + '/SignInActivity" target="_blank" rel="noopener" class="admin-link" onclick="event.stopPropagation();" title="Open in Entra">Entra</a>');
        }
        return actions.length ? actions.join(' ') : '--';
    }

    function priorityScore(item) {
        var score = 0;
        if (item.riskLevel === 'high') score += 50;
        else if (item.riskLevel === 'medium') score += 30;
        else if (item.riskLevel === 'low') score += 10;
        if (item.status === 'failure') score += 25;
        if (item.caStatus === 'failure') score += 20;
        if (!item.mfaSatisfied && item.isInteractive) score += 12;
        if (!item.isManaged) score += 10;
        if (!item.isCompliant) score += 8;
        if (item.isGuest) score += 5;
        return score;
    }

    function computeSummary(logs) {
        var uniqueUsers = {};
        var summary = {
            total: logs.length,
            success: 0,
            failure: 0,
            risky: 0,
            highRisk: 0,
            caFailure: 0,
            unmanaged: 0,
            nonCompliant: 0,
            guests: 0
        };

        logs.forEach(function(item) {
            if (item.userPrincipalName) uniqueUsers[item.userPrincipalName.toLowerCase()] = true;
            if (item.status === 'success') summary.success++;
            if (item.status === 'failure') summary.failure++;
            if (item.riskLevel && item.riskLevel !== 'none') summary.risky++;
            if (item.riskLevel === 'high') summary.highRisk++;
            if (item.caStatus === 'failure') summary.caFailure++;
            if (!item.isManaged) summary.unmanaged++;
            if (!item.isCompliant) summary.nonCompliant++;
            if (item.isGuest) summary.guests++;
        });

        summary.uniqueUsers = Object.keys(uniqueUsers).length;
        return summary;
    }

    function getPriorityEvents(logs) {
        return logs.filter(function(item) {
            return priorityScore(item) > 0;
        }).sort(function(a, b) {
            var scoreDiff = priorityScore(b) - priorityScore(a);
            if (scoreDiff !== 0) return scoreDiff;
            return new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime();
        });
    }

    function getTopCounts(logs, selector, limit) {
        var map = {};
        logs.forEach(function(item) {
            var key = selector(item);
            if (!key) return;
            map[key] = (map[key] || 0) + 1;
        });

        return Object.keys(map).map(function(key) {
            return { label: key, count: map[key] };
        }).sort(function(a, b) {
            return b.count - a.count;
        }).slice(0, limit || 5);
    }

    function buildHotspotCard(title, items, emptyMessage) {
        var html = '<div class="analytics-card">';
        html += '<h3>' + escapeHtml(title) + '</h3>';
        if (!items.length) {
            html += '<p class="text-muted">' + escapeHtml(emptyMessage) + '</p>';
        } else {
            html += '<div class="platform-list">';
            items.forEach(function(item) {
                html += '<div class="platform-row">';
                html += '<span class="platform-name">' + escapeHtml(item.label) + '</span>';
                html += '<span class="platform-rate">' + item.count + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function renderHotspots(logs) {
        var container = document.getElementById('signin-hotspots');
        if (!container) return;

        var failureReasons = getTopCounts(
            logs.filter(function(item) { return item.status === 'failure'; }),
            function(item) { return item.failureReason || ('Error ' + (item.errorCode || 'Unknown')); },
            5
        );
        var riskyIps = getTopCounts(
            logs.filter(function(item) { return item.riskLevel !== 'none' && item.ipAddress; }),
            function(item) { return item.ipAddress; },
            5
        );
        var failureApps = getTopCounts(
            logs.filter(function(item) { return item.status === 'failure'; }),
            function(item) { return item.appDisplayName; },
            5
        );

        container.innerHTML =
            '<div class="analytics-grid">' +
                buildHotspotCard('Top Failure Reasons', failureReasons, 'No failures in scope') +
                buildHotspotCard('Risky IP Addresses', riskyIps, 'No risky IPs in scope') +
                buildHotspotCard('Applications With Failures', failureApps, 'No failed applications in scope') +
            '</div>';
    }

    function getPriorityReason(row) {
        var reasons = [];
        if (row.riskLevel === 'high') reasons.push('High identity risk');
        else if (row.riskLevel === 'medium') reasons.push('Medium identity risk');
        if (row.status === 'failure') reasons.push(row.failureReason || 'Sign-in failure');
        if (row.caStatus === 'failure') reasons.push('Conditional Access blocked');
        if (!row.mfaSatisfied && row.isInteractive) reasons.push('No MFA satisfaction');
        if (!row.isManaged) reasons.push('Unmanaged device');
        if (!row.isCompliant) reasons.push('Non-compliant device');
        if (row.isGuest) reasons.push('Guest access');
        return reasons.join(' | ') || 'Recent sign-in';
    }

    function renderPriorityTable(logs) {
        Tables.render({
            containerId: 'signin-priority-table',
            data: logs.slice(0, 20),
            columns: [
                { key: 'createdDateTime', label: 'Time', formatter: Tables.formatters.datetime },
                { key: 'userPrincipalName', label: 'User', formatter: formatUserCell },
                { key: 'appDisplayName', label: 'Application', formatter: formatAppCell },
                { key: 'status', label: 'Status', formatter: formatStatusBadge },
                { key: 'riskLevel', label: 'Risk', formatter: formatRiskBadge },
                { key: '_devicePosture', label: 'Device Posture', formatter: formatDevicePosture },
                { key: '_reason', label: 'Why It Matters', formatter: function(v, row) { return escapeHtml(getPriorityReason(row)); } }
            ],
            pageSize: 20,
            onRowClick: showSignInDetails
        });
    }

    function wireQueueButtons() {
        var buttons = document.querySelectorAll('[data-signin-filter]');
        Array.prototype.forEach.call(buttons, function(button) {
            button.addEventListener('click', function() {
                applyNamedFilter(button.getAttribute('data-signin-filter'));
            });
        });
    }

    function setFilterValue(id, value) {
        var element = document.getElementById(id);
        if (element) element.value = value;
    }

    function applyNamedFilter(mode) {
        setFilterValue('signin-search', '');
        setFilterValue('signin-status', 'all');
        setFilterValue('signin-risk', 'all');
        setFilterValue('signin-ca', 'all');
        setFilterValue('signin-posture', 'all');

        if (mode === 'priority') {
            setFilterValue('signin-risk', 'high');
        } else if (mode === 'failures') {
            setFilterValue('signin-status', 'failure');
        } else if (mode === 'ca-blocked') {
            setFilterValue('signin-ca', 'failure');
        } else if (mode === 'unmanaged') {
            setFilterValue('signin-posture', 'unmanaged');
        } else if (mode === 'guest') {
            setFilterValue('signin-status', 'failure');
            setFilterValue('signin-search', '@');
        }

        applyFilters();
    }

    function getDateRangeValue(id, role) {
        var container = document.getElementById(id);
        if (!container) return '';
        var input = container.querySelector('[data-role="' + role + '"]');
        return input ? input.value : '';
    }

    function renderFilterSummary(filteredCount, totalCount) {
        var element = document.getElementById('signin-filter-summary');
        if (!element) return;
        if (filteredCount === totalCount) {
            element.innerHTML = '<span class="stat">Showing <strong>' + totalCount + '</strong> sign-ins</span>';
            return;
        }
        element.innerHTML = '<span class="stat">Showing <strong>' + filteredCount + '</strong> of <strong>' + totalCount + '</strong> sign-ins</span>';
    }

    function applyFilters() {
        var filterConfig = {
            search: Filters.getValue('signin-search'),
            searchFields: ['userPrincipalName', 'userDisplayName', 'appDisplayName', 'ipAddress', 'location', 'failureReason', 'deviceName']
        };
        var filtered = Filters.apply(state.logs, filterConfig);

        var status = Filters.getValue('signin-status');
        var risk = Filters.getValue('signin-risk');
        var ca = Filters.getValue('signin-ca');
        var posture = Filters.getValue('signin-posture');
        var fromDate = getDateRangeValue('signin-date-range', 'from');
        var toDate = getDateRangeValue('signin-date-range', 'to');

        if (status && status !== 'all') {
            filtered = filtered.filter(function(item) { return item.status === status; });
        }
        if (risk && risk !== 'all') {
            filtered = filtered.filter(function(item) { return item.riskLevel === risk; });
        }
        if (ca && ca !== 'all') {
            filtered = filtered.filter(function(item) { return item.caStatus === ca; });
        }
        if (posture === 'managed') {
            filtered = filtered.filter(function(item) { return item.isManaged; });
        } else if (posture === 'unmanaged') {
            filtered = filtered.filter(function(item) { return !item.isManaged; });
        } else if (posture === 'noncompliant') {
            filtered = filtered.filter(function(item) { return !item.isCompliant; });
        }
        if (fromDate || toDate) {
            filtered = filtered.filter(function(item) {
                var dateStr = normalizeText(item.createdDateTime).substring(0, 10);
                if (!dateStr) return false;
                if (fromDate && dateStr < fromDate) return false;
                if (toDate && dateStr > toDate) return false;
                return true;
            });
        }

        state.filtered = filtered;
        renderMainTable(filtered);
        renderFilterSummary(filtered.length, state.logs.length);
    }

    function renderMainTable(data) {
        var visible = colSelector ? colSelector.getVisible() : [
            'createdDateTime',
            'userPrincipalName',
            'appDisplayName',
            'status',
            'riskLevel',
            'mfaSatisfied',
            '_devicePosture',
            '_actions'
        ];

        var defs = {
            createdDateTime: { key: 'createdDateTime', label: 'Time', formatter: Tables.formatters.datetime },
            userPrincipalName: { key: 'userPrincipalName', label: 'User', formatter: formatUserCell },
            appDisplayName: { key: 'appDisplayName', label: 'Application', formatter: formatAppCell },
            status: { key: 'status', label: 'Status', formatter: formatStatusBadge },
            riskLevel: { key: 'riskLevel', label: 'Risk', formatter: formatRiskBadge },
            mfaSatisfied: { key: 'mfaSatisfied', label: 'MFA', formatter: formatMfa },
            caStatus: { key: 'caStatus', label: 'CA Result', formatter: function(v) { return formatStatusBadge(v || 'unknown'); } },
            location: { key: 'location', label: 'Location' },
            ipAddress: { key: 'ipAddress', label: 'IP Address' },
            clientAppUsed: { key: 'clientAppUsed', label: 'Client App' },
            _devicePosture: { key: '_devicePosture', label: 'Device Posture', formatter: formatDevicePosture },
            _actions: { key: '_actions', label: 'Take Action', formatter: formatActionCell }
        };

        var columns = visible.map(function(key) { return defs[key]; }).filter(Boolean);

        Tables.render({
            containerId: 'signin-table',
            data: data,
            columns: columns,
            pageSize: 100,
            onRowClick: showSignInDetails
        });
    }

    function renderSummary(summary) {
        var container = document.getElementById('signin-summary');
        if (!container) return;
        container.innerHTML =
            '<div class="summary-card"><div class="summary-value">' + summary.total + '</div><div class="summary-label">Total Sign-Ins</div></div>' +
            '<div class="summary-card card-danger"><div class="summary-value">' + summary.failure + '</div><div class="summary-label">Failures</div></div>' +
            '<div class="summary-card card-warning"><div class="summary-value">' + summary.highRisk + '</div><div class="summary-label">High Risk</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + summary.caFailure + '</div><div class="summary-label">CA Blocked</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + summary.unmanaged + '</div><div class="summary-label">Unmanaged</div></div>' +
            '<div class="summary-card"><div class="summary-value">' + summary.uniqueUsers + '</div><div class="summary-label">Users Seen</div></div>';
    }

    function buildQueueCard(title, value, subtitle, filterKey) {
        return (
            '<div class="signal-card signal-card--info">' +
                '<div class="signal-card-value">' + value + '</div>' +
                '<div class="signal-card-label">' + escapeHtml(title) + '</div>' +
                '<div class="signal-card-meta">' + escapeHtml(subtitle) + '</div>' +
                '<div class="signal-card-actions"><button class="btn btn-secondary btn-sm" data-signin-filter="' + filterKey + '">View in Table</button></div>' +
            '</div>'
        );
    }

    function renderQueues(summary) {
        var container = document.getElementById('signin-queues');
        if (!container) return;
        container.innerHTML =
            buildQueueCard('High Priority Events', getPriorityEvents(state.logs).length, 'high-signal sign-ins need triage first', 'priority') +
            buildQueueCard('Failed Sign-Ins', summary.failure, 'failed attempts and auth errors', 'failures') +
            buildQueueCard('CA Blocked', summary.caFailure, 'policy-driven blocks worth reviewing', 'ca-blocked') +
            buildQueueCard('Unmanaged or Non-Compliant', summary.unmanaged + summary.nonCompliant, 'access from weak device posture', 'unmanaged') +
            buildQueueCard('Guest Failures', summary.guests, 'external identities with sign-in activity', 'guest');
    }

    function exportFiltered() {
        Export.toCSV(state.filtered, [
            { key: 'createdDateTime', label: 'Time' },
            { key: 'userPrincipalName', label: 'User UPN' },
            { key: 'userDisplayName', label: 'User Display Name' },
            { key: 'appDisplayName', label: 'Application' },
            { key: 'status', label: 'Status' },
            { key: 'riskLevel', label: 'Risk Level' },
            { key: 'caStatus', label: 'CA Result' },
            { key: 'mfaSatisfied', label: 'MFA Satisfied' },
            { key: 'ipAddress', label: 'IP Address' },
            { key: 'location', label: 'Location' },
            { key: 'deviceName', label: 'Device Name' },
            { key: 'operatingSystem', label: 'Operating System' },
            { key: 'isManaged', label: 'Managed' },
            { key: 'isCompliant', label: 'Compliant' },
            { key: 'failureReason', label: 'Failure Reason' }
        ], 'signin-investigation.csv');
    }

    function getRelatedLogs(log, predicate, limit) {
        return state.logs.filter(function(item) {
            return item.id !== log.id && predicate(item);
        }).slice(0, limit || 5);
    }

    function renderRelatedList(title, items) {
        var html = '<div class="detail-section"><h4>' + escapeHtml(title) + '</h4>';
        if (!items.length) {
            html += '<p class="text-muted">No related events found.</p>';
        } else {
            html += '<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Application</th><th>Status</th></tr></thead><tbody>';
            items.forEach(function(item) {
                html += '<tr>';
                html += '<td>' + Tables.formatters.datetime(item.createdDateTime) + '</td>';
                html += '<td>' + formatUserCell(item.userPrincipalName, item) + '</td>';
                html += '<td>' + formatAppCell(item.appDisplayName, item) + '</td>';
                html += '<td>' + formatStatusBadge(item.status) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';
        return html;
    }

    function detailItem(label, value) {
        return '<div class="detail-item"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + value + '</span></div>';
    }

    function showSignInDetails(log) {
        var modal = document.getElementById('modal-overlay');
        var title = document.getElementById('modal-title');
        var body = document.getElementById('modal-body');
        if (!modal || !title || !body) return;

        var sameUser = getRelatedLogs(log, function(item) {
            return item.userPrincipalName && item.userPrincipalName === log.userPrincipalName;
        }, 5);
        var sameIp = getRelatedLogs(log, function(item) {
            return item.ipAddress && item.ipAddress === log.ipAddress;
        }, 5);
        var userHref = log.userPrincipalName ? getUserHref(log.userPrincipalName) : '';
        var deviceHref = getDeviceHref(log.deviceName || log.deviceId);
        var appHref = getAppHref(log);

        title.textContent = 'Sign-In Event';
        body.innerHTML =
            '<div class="detail-grid">' +
                detailItem('Time', Tables.formatters.datetime(log.createdDateTime)) +
                detailItem('User', userHref ? '<a href="' + userHref + '" class="entity-link">' + escapeHtml(log.userDisplayName || log.userPrincipalName) + '</a>' : escapeHtml(log.userDisplayName || log.userPrincipalName || '--')) +
                detailItem('UPN', escapeHtml(log.userPrincipalName || '--')) +
                detailItem('Application', '<a href="' + appHref + '" class="entity-link">' + escapeHtml(log.appDisplayName || '--') + '</a>') +
                detailItem('Status', formatStatusBadge(log.status)) +
                detailItem('Risk', formatRiskBadge(log.riskLevel)) +
                detailItem('Conditional Access', formatStatusBadge(log.caStatus || 'unknown')) +
                detailItem('MFA', formatMfa(log.mfaSatisfied, log)) +
                detailItem('Client App', escapeHtml(log.clientAppUsed || '--')) +
                detailItem('IP Address', escapeHtml(log.ipAddress || '--')) +
                detailItem('Location', escapeHtml(log.location || '--')) +
                detailItem('Failure Reason', escapeHtml(log.failureReason || '--')) +
                detailItem('Operating System', escapeHtml(log.operatingSystem || '--')) +
                detailItem('Browser', escapeHtml(log.browser || '--')) +
                detailItem('Trust Type', escapeHtml(log.trustType || '--')) +
                detailItem('Device Posture', formatDevicePosture('', log)) +
            '</div>' +
            '<div class="detail-section"><h4>Take Action</h4><div class="action-row">' +
                (userHref ? '<a href="' + userHref + '" class="btn btn-primary btn-sm">Open User 360</a>' : '') +
                (deviceHref ? '<a href="' + deviceHref + '" class="btn btn-secondary btn-sm">Open Device 360</a>' : '') +
                '<a href="' + appHref + '" class="btn btn-secondary btn-sm">Open App Context</a>' +
                (log.userId ? '<a href="https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(log.userId) + '/SignInActivity" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open in Entra</a>' : '') +
            '</div></div>' +
            renderRelatedList('Other Events From This User', sameUser) +
            renderRelatedList('Other Events From This IP', sameIp);

        modal.classList.add('visible');
    }

    function render(container) {
        state.logs = normalizeSignIns(DataLoader.getData('signinLogs'));
        state.filtered = state.logs.slice();

        var summary = computeSummary(state.logs);
        var priority = getPriorityEvents(state.logs);

        container.innerHTML =
            '<div class="page-header">' +
                '<h2 class="page-title">Sign-In Logs</h2>' +
                '<p class="page-description">Raw sign-in evidence with priority queues, hotspots, and exact investigation pivots.</p>' +
            '</div>' +
            '<div class="summary-cards" id="signin-summary"></div>' +
            '<div class="analytics-section">' +
                '<h3>Priority Queues</h3>' +
                '<div class="signal-cards" id="signin-queues"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Hotspots</h3>' +
                '<div id="signin-hotspots"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>Priority Events</h3>' +
                '<div id="signin-priority-table"></div>' +
            '</div>' +
            '<div class="analytics-section">' +
                '<h3>All Sign-In Events</h3>' +
                '<div id="signin-filters"></div>' +
                '<div id="signin-colselector" style="margin-bottom: 8px; text-align: right;"></div>' +
                '<div class="section-stats" id="signin-filter-summary"></div>' +
                '<div id="signin-table"></div>' +
            '</div>';

        renderSummary(summary);
        renderQueues(summary);
        renderHotspots(state.logs);
        renderPriorityTable(priority);

        Filters.createFilterBar({
            containerId: 'signin-filters',
            controls: [
                { type: 'search', id: 'signin-search', placeholder: 'Search users, apps, IPs, devices...' },
                {
                    type: 'select',
                    id: 'signin-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All Statuses' },
                        { value: 'success', label: 'Success' },
                        { value: 'failure', label: 'Failure' }
                    ]
                },
                {
                    type: 'select',
                    id: 'signin-risk',
                    label: 'Risk',
                    options: [
                        { value: 'all', label: 'All Risk Levels' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                        { value: 'none', label: 'None' }
                    ]
                },
                {
                    type: 'select',
                    id: 'signin-ca',
                    label: 'Conditional Access',
                    options: [
                        { value: 'all', label: 'All CA Results' },
                        { value: 'failure', label: 'Blocked' },
                        { value: 'success', label: 'Allowed' },
                        { value: 'notapplied', label: 'Not Applied' }
                    ]
                },
                {
                    type: 'select',
                    id: 'signin-posture',
                    label: 'Device Posture',
                    options: [
                        { value: 'all', label: 'All Devices' },
                        { value: 'managed', label: 'Managed' },
                        { value: 'unmanaged', label: 'Unmanaged' },
                        { value: 'noncompliant', label: 'Non-Compliant' }
                    ]
                },
                { type: 'date-range', id: 'signin-date-range', label: 'Date Range' }
            ],
            onFilter: applyFilters
        });

        colSelector = ColumnSelector.create({
            containerId: 'signin-colselector',
            storageKey: 'tenantscope-signin-cols-v2',
            allColumns: [
                { key: 'createdDateTime', label: 'Time' },
                { key: 'userPrincipalName', label: 'User' },
                { key: 'appDisplayName', label: 'Application' },
                { key: 'status', label: 'Status' },
                { key: 'riskLevel', label: 'Risk' },
                { key: 'mfaSatisfied', label: 'MFA' },
                { key: 'caStatus', label: 'CA Result' },
                { key: 'location', label: 'Location' },
                { key: 'ipAddress', label: 'IP Address' },
                { key: 'clientAppUsed', label: 'Client App' },
                { key: '_devicePosture', label: 'Device Posture' },
                { key: '_actions', label: 'Take Action' }
            ],
            defaultVisible: [
                'createdDateTime',
                'userPrincipalName',
                'appDisplayName',
                'status',
                'riskLevel',
                'mfaSatisfied',
                '_devicePosture',
                '_actions'
            ],
            onColumnsChanged: applyFilters
        });

        wireQueueButtons();

        var exportBtn = document.getElementById('signin-filters-export');
        if (exportBtn) exportBtn.addEventListener('click', exportFiltered);

        applyFilters();
    }

    return {
        render: render
    };
})();

window.PageSignInLogs = PageSignInLogs;
