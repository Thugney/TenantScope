/**
 * ============================================================================
 * TenantScope - Coverage Gaps
 * ============================================================================
 *
 * Consolidates coverage gaps across Defender, ASR telemetry, endpoint security,
 * LAPS, and patch currency into one actionable view.
 */

const PageGaps = (function() {
    'use strict';

    function el(tag, className, textContent) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (textContent !== undefined) node.textContent = textContent;
        return node;
    }

    function normalizeString(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function formatStatusBadge(value) {
        var v = normalizeString(value).toLowerCase();
        var cls = 'badge-neutral';
        var label = value || 'unknown';
        if (v === 'compliant' || v === 'healthy' || v === 'current') cls = 'badge-success';
        else if (v === 'noncompliant' || v === 'error' || v === 'critical' || v === 'stale') cls = 'badge-critical';
        else if (v === 'conflict' || v === 'pending' || v === 'warning') cls = 'badge-warning';
        else if (v === 'audit') cls = 'badge-info';
        return '<span class="badge ' + cls + '">' + Tables.escapeHtml(label) + '</span>';
    }

    function formatBool(value, positiveLabel, negativeLabel) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        var boolVal = value;
        if (typeof value === 'string') {
            var v = value.toLowerCase();
            if (['true', 'enabled', 'on', 'active'].indexOf(v) >= 0) boolVal = true;
            else if (['false', 'disabled', 'off', 'inactive'].indexOf(v) >= 0) boolVal = false;
        }
        return boolVal ? '<span class="badge badge-success">' + positiveLabel + '</span>' : '<span class="badge badge-critical">' + negativeLabel + '</span>';
    }

    function renderTableOrEmpty(containerId, data, columns, emptyMessage) {
        var container = document.getElementById(containerId);
        if (!container) return;
        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No gaps found</div><div class="empty-state-description">' +
                (emptyMessage || 'All items look healthy for this category.') + '</div></div>';
            return;
        }
        Tables.render({
            containerId: containerId,
            data: data,
            columns: columns,
            pageSize: 25
        });
    }

    function render(container) {
        var defenderRaw = DataLoader.getData('defenderDeviceHealth') || {};
        var defenderDevices = Array.isArray(defenderRaw) ? defenderRaw : (defenderRaw.devices || []);
        var defenderSummary = defenderRaw.summary || {};
        var signatureThreshold = defenderSummary.signatureAgeThresholdDays || 7;

        var asrEventsRaw = DataLoader.getData('asrAuditEvents') || {};
        var asrEvents = asrEventsRaw.rules || [];
        var asrNoiseThreshold = asrEventsRaw.noiseThreshold || 20;

        var asrRulesRaw = DataLoader.getData('asrRules') || {};
        var asrRules = asrRulesRaw.rulesArray || [];

        var endpointSecurityRaw = DataLoader.getData('endpointSecurityStates') || {};
        var endpointDevices = endpointSecurityRaw.devices || [];
        var endpointPolicies = endpointSecurityRaw.policies || [];

        var lapsRaw = DataLoader.getData('lapsCoverage') || {};
        var lapsDevices = lapsRaw.devices || [];

        var hardeningRaw = DataLoader.getData('deviceHardening') || {};
        var hardeningDevices = hardeningRaw.devices || [];

        var updatesRaw = DataLoader.getData('windowsUpdateStatus') || {};
        var updateDevices = updatesRaw.deviceCompliance || [];

        var defenderIssues = defenderDevices.filter(function(d) { return d.hasIssues || (d.issues && d.issues.length > 0); });

        var asrEventMap = {};
        asrEvents.forEach(function(r) {
            if (r.ruleId) asrEventMap[r.ruleId] = r;
        });
        var deployedAsr = asrRules.filter(function(r) { return r.isDeployed; });
        var asrNoTelemetry = deployedAsr.filter(function(r) {
            var ev = asrEventMap[r.ruleId];
            return !ev || !ev.totalEvents;
        });

        var asrNoisy = asrEvents.filter(function(r) { return r.noisy; });

        var endpointIssues = endpointDevices.filter(function(d) { return d.hasIssues; });
        var lapsIssues = lapsDevices.filter(function(d) {
            var hasLapsGap = d.status && d.status !== 'healthy' && d.status !== 'unknown';
            var localAdminSeen = d.localAdminObserved === true;
            return hasLapsGap || localAdminSeen;
        });
        var patchIssues = updateDevices.filter(function(d) {
            return d.qualityUpdateAgeStatus === 'stale' || d.qualityUpdateAgeStatus === 'error' || d.updateStatus === 'error';
        });
        var hardeningIssues = hardeningDevices.filter(function(d) { return d.hasIssues; });

        var html = '';
        html += '<div class="page-header">';
        html += '<h2 class="page-title">Coverage Gaps</h2>';
        html += '<p class="page-description">High-value gaps across Defender, ASR telemetry, endpoint security, LAPS, and patch currency.</p>';
        html += '</div>';

        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + defenderIssues.length + '</div><div class="summary-label">Defender Sensor Gaps</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + asrNoTelemetry.length + '</div><div class="summary-label">ASR No Telemetry</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + endpointIssues.length + '</div><div class="summary-label">Endpoint Security Issues</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + lapsIssues.length + '</div><div class="summary-label">LAPS Gaps</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + hardeningIssues.length + '</div><div class="summary-label">Hardening Gaps</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + patchIssues.length + '</div><div class="summary-label">Patch Currency Gaps</div></div>';
        html += '</div>';

        // Defender section
        html += '<div class="analytics-section">';
        html += '<h3>Defender Device Health Gaps</h3>';
        html += '<div id="gap-defender-table"></div>';
        html += '</div>';

        // ASR telemetry section
        html += '<div class="analytics-section">';
        html += '<h3>ASR Telemetry Coverage</h3>';
        html += '<div id="gap-asr-table"></div>';
        html += '</div>';

        // Endpoint Security section
        html += '<div class="analytics-section">';
        html += '<h3>Endpoint Security Policy Compliance</h3>';
        html += '<div id="gap-endpoint-security-table"></div>';
        html += '</div>';

        // LAPS section
        html += '<div class="analytics-section">';
        html += '<h3>Local Admin / LAPS Coverage</h3>';
        html += '<div id="gap-laps-table"></div>';
        html += '</div>';

        // Device hardening section
        html += '<div class="analytics-section">';
        html += '<h3>Credential Guard & Memory Integrity</h3>';
        html += '<div id="gap-hardening-table"></div>';
        html += '</div>';

        // Patch currency section
        html += '<div class="analytics-section">';
        html += '<h3>Patch Currency Gaps</h3>';
        html += '<div id="gap-patch-table"></div>';
        html += '</div>';

        container.innerHTML = html;

        renderTableOrEmpty('gap-defender-table', defenderIssues, [
            { key: 'deviceName', label: 'Device', formatter: function(v) {
                if (!v) return '<span class="text-muted">--</span>';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
            }},
            { key: 'onboardingStatus', label: 'Onboarding', formatter: formatStatusBadge },
            { key: 'sensorHealthState', label: 'Sensor', formatter: formatStatusBadge },
            { key: 'healthStatus', label: 'Health', formatter: formatStatusBadge },
            { key: 'tamperProtection', label: 'Tamper', formatter: function(v) { return formatBool(v, 'Enabled', 'Disabled'); } },
            { key: 'avMode', label: 'AV Mode', formatter: formatStatusBadge },
            { key: 'avSignatureAgeDays', label: 'Sig Age (Days)', className: 'cell-right', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v > signatureThreshold ? 'text-critical' : v > 3 ? 'text-warning' : 'text-success';
                return '<span class="' + cls + '">' + v + '</span>';
            }},
            { key: 'sensorLastSeenAgeDays', label: 'Sensor Age (Days)', className: 'cell-right', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var staleThreshold = defenderSummary.sensorStaleThresholdDays || 7;
                var cls = v > staleThreshold ? 'text-critical' : v > 2 ? 'text-warning' : 'text-success';
                return '<span class="' + cls + '">' + v + '</span>';
            }},
            { key: 'edrBlockModeStatus', label: 'EDR Block', formatter: function(v) { return formatBool(v, 'Enabled', 'Disabled'); } },
            { key: 'lastSeen', label: 'Last Seen', formatter: Tables.formatters.date },
            { key: 'issues', label: 'Issues', formatter: function(v) {
                if (!v || !v.length) return '<span class="text-muted">--</span>';
                return v.map(function(i) { return '<span class="badge badge-warning">' + Tables.escapeHtml(i) + '</span>'; }).join(' ');
            }}
        ], 'No Defender device health gaps detected.');

        var asrCoverageRows = deployedAsr.map(function(rule) {
            var ev = asrEventMap[rule.ruleId] || {};
            var deployedMode = rule.blockCount > 0 ? 'Block' : rule.auditCount > 0 ? 'Audit' : rule.warnCount > 0 ? 'Warn' : 'Disabled';
            var totalEvents = ev.totalEvents || 0;
            var noTelemetry = totalEvents === 0;
            var driftStatus = 'OK';
            if (noTelemetry) {
                driftStatus = 'No telemetry';
            } else if (deployedMode === 'Audit' && (ev.auditEvents || 0) >= asrNoiseThreshold) {
                driftStatus = 'Audit noisy';
            } else if (deployedMode === 'Warn' && (ev.warnEvents || 0) >= asrNoiseThreshold) {
                driftStatus = 'Warn noisy';
            } else if (deployedMode !== 'Block' && (ev.auditEvents || 0) > 0 && (ev.blockEvents || 0) === 0) {
                driftStatus = 'Not enforced';
            }
            return {
                ruleId: rule.ruleId,
                ruleName: rule.ruleName,
                deployedMode: deployedMode,
                totalEvents: totalEvents,
                auditEvents: ev.auditEvents || 0,
                blockEvents: ev.blockEvents || 0,
                warnEvents: ev.warnEvents || 0,
                deviceCount: ev.deviceCount || 0,
                lastSeen: ev.lastSeen || null,
                coverageStatus: noTelemetry ? 'No telemetry' : (ev.noisy ? 'Noisy' : 'OK'),
                driftStatus: driftStatus
            };
        });

        renderTableOrEmpty('gap-asr-table', asrCoverageRows, [
            { key: 'ruleName', label: 'Rule', formatter: function(v, row) {
                return '<span class="font-bold">' + Tables.escapeHtml(v || row.ruleId || '--') + '</span>';
            }},
            { key: 'deployedMode', label: 'Deployed Mode', formatter: formatStatusBadge },
            { key: 'auditEvents', label: 'Audit', className: 'cell-right' },
            { key: 'blockEvents', label: 'Block', className: 'cell-right' },
            { key: 'warnEvents', label: 'Warn', className: 'cell-right' },
            { key: 'deviceCount', label: 'Devices', className: 'cell-right' },
            { key: 'lastSeen', label: 'Last Seen', formatter: Tables.formatters.date },
            { key: 'coverageStatus', label: 'Coverage', formatter: function(v) {
                if (v === 'No telemetry') return '<span class="badge badge-critical">' + v + '</span>';
                if (v === 'Noisy') return '<span class="badge badge-warning">Noisy (>' + asrNoiseThreshold + ')</span>';
                return '<span class="badge badge-success">OK</span>';
            }},
            { key: 'driftStatus', label: 'Effectiveness', formatter: function(v) {
                if (v === 'No telemetry') return '<span class="badge badge-critical">' + v + '</span>';
                if (v === 'Audit noisy' || v === 'Warn noisy') return '<span class="badge badge-warning">' + v + '</span>';
                if (v === 'Not enforced') return '<span class="badge badge-warning">' + v + '</span>';
                return '<span class="badge badge-success">OK</span>';
            }}
        ], 'No ASR telemetry gaps detected.');

        var categoryOrder = ['Firewall', 'Antivirus', 'Disk Encryption', 'Attack Surface Reduction', 'Account Protection', 'Other'];
        var categorySet = {};
        endpointPolicies.forEach(function(p) {
            if (p.category) categorySet[p.category] = true;
        });
        endpointDevices.forEach(function(d) {
            Object.keys(d.categories || {}).forEach(function(k) { categorySet[k] = true; });
        });

        var categories = categoryOrder.filter(function(k) { return categorySet[k]; });
        Object.keys(categorySet).forEach(function(k) {
            if (categories.indexOf(k) === -1) categories.push(k);
        });

        var endpointColumns = [
            { key: 'deviceName', label: 'Device', formatter: function(v) {
                if (!v) return '<span class="text-muted">--</span>';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
            }},
            { key: 'userPrincipalName', label: 'User', formatter: function(v) { return v ? Tables.escapeHtml(v) : '<span class="text-muted">--</span>'; } }
        ];
        categories.forEach(function(cat) {
            endpointColumns.push({
                key: 'categories.' + cat,
                label: cat,
                formatter: function(v) { return formatStatusBadge(v || 'unknown'); }
            });
        });
        endpointColumns.push({ key: 'worstStatus', label: 'Worst', formatter: formatStatusBadge });

        renderTableOrEmpty('gap-endpoint-security-table', endpointIssues, endpointColumns, 'No endpoint security policy gaps detected.');

        renderTableOrEmpty('gap-laps-table', lapsIssues, [
            { key: 'deviceName', label: 'Device', formatter: function(v) {
                if (!v) return '<span class="text-muted">--</span>';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
            }},
            { key: 'userPrincipalName', label: 'User', formatter: function(v) { return v ? Tables.escapeHtml(v) : '<span class="text-muted">--</span>'; } },
            { key: 'lapsEnabled', label: 'LAPS', formatter: function(v) { return formatBool(v, 'Enabled', 'Missing'); } },
            { key: 'lastRotationDateTime', label: 'Last Rotation', formatter: Tables.formatters.date },
            { key: 'rotationAgeDays', label: 'Age (Days)', className: 'cell-right', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = v > (lapsRaw.summary ? lapsRaw.summary.rotationThresholdDays || 30 : 30) ? 'text-critical' : 'text-warning';
                return '<span class="' + cls + '">' + v + '</span>';
            }},
            { key: 'localAdminObserved', label: 'Local Admin Seen', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                return v ? '<span class="badge badge-warning">Yes</span>' : '<span class="badge badge-neutral">No</span>';
            }},
            { key: 'localAdminLastSeen', label: 'Local Admin Last Seen', formatter: Tables.formatters.date },
            { key: 'localAdminLogonCount', label: 'Local Admin Logons', className: 'cell-right', formatter: function(v) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                return '<span class="text-warning">' + v + '</span>';
            }},
            { key: 'status', label: 'Status', formatter: formatStatusBadge }
        ], 'No LAPS gaps detected.');

        renderTableOrEmpty('gap-hardening-table', hardeningIssues, [
            { key: 'deviceName', label: 'Device', formatter: function(v) {
                if (!v) return '<span class="text-muted">--</span>';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
            }},
            { key: 'credentialGuardStatus', label: 'Credential Guard', formatter: formatStatusBadge },
            { key: 'memoryIntegrityStatus', label: 'Memory Integrity', formatter: formatStatusBadge },
            { key: 'issues', label: 'Issues', formatter: function(v) {
                if (!v || !v.length) return '<span class="text-muted">--</span>';
                return v.map(function(i) { return '<span class="badge badge-warning">' + Tables.escapeHtml(i) + '</span>'; }).join(' ');
            }}
        ], 'No device hardening gaps detected.');

        renderTableOrEmpty('gap-patch-table', patchIssues, [
            { key: 'deviceName', label: 'Device', formatter: function(v) {
                if (!v) return '<span class="text-muted">--</span>';
                return '<a href="#devices?search=' + encodeURIComponent(v) + '" class="entity-link"><strong>' + Tables.escapeHtml(v) + '</strong></a>';
            }},
            { key: 'userPrincipalName', label: 'User', formatter: function(v) { return v ? Tables.escapeHtml(v) : '<span class="text-muted">--</span>'; } },
            { key: 'updateStatus', label: 'Update Status', formatter: formatStatusBadge },
            { key: 'qualityUpdateAgeDays', label: 'Update Age (Days)', className: 'cell-right', formatter: function(v, row) {
                if (v === null || v === undefined) return '<span class="text-muted">--</span>';
                var cls = row.qualityUpdateAgeStatus === 'stale' ? 'text-critical' : 'text-warning';
                return '<span class="' + cls + '">' + v + '</span>';
            }},
            { key: 'qualityUpdateAgeSource', label: 'Age Source', formatter: function(v) { return v ? Tables.escapeHtml(v) : '<span class="text-muted">--</span>'; } },
            { key: 'qualityUpdateLastEvent', label: 'Last Event', formatter: Tables.formatters.date },
            { key: 'updateRing', label: 'Ring', formatter: function(v) { return v ? Tables.escapeHtml(v) : '<span class="text-muted">--</span>'; } },
            { key: 'featureUpdateVersion', label: 'Feature Version', formatter: function(v) { return v ? Tables.escapeHtml(v) : '<span class="text-muted">--</span>'; } }
        ], 'No patch currency gaps detected.');
    }

    return { render: render };
})();

window.PageGaps = PageGaps;
