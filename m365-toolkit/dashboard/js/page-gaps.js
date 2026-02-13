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

    var currentFilter = 'defender';
    var cachedData = null;

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
            // Include unknown status as a gap (can't verify LAPS coverage)
            var hasLapsGap = d.status && d.status !== 'healthy';
            var localAdminSeen = d.localAdminObserved === true;
            return hasLapsGap || localAdminSeen;
        });
        var patchIssues = updateDevices.filter(function(d) {
            return d.qualityUpdateAgeStatus === 'stale' || d.qualityUpdateAgeStatus === 'error' || d.updateStatus === 'error';
        });
        var hardeningIssues = hardeningDevices.filter(function(d) { return d.hasIssues; });

        // Cache data for filter switching
        cachedData = {
            defenderIssues: defenderIssues,
            asrCoverageRows: null,
            endpointIssues: endpointIssues,
            endpointColumns: null,
            lapsIssues: lapsIssues,
            lapsRaw: lapsRaw,
            hardeningIssues: hardeningIssues,
            patchIssues: patchIssues,
            signatureThreshold: signatureThreshold,
            defenderSummary: defenderSummary,
            asrNoiseThreshold: asrNoiseThreshold
        };

        // Build page structure using DOM methods
        var pageHeader = el('div', 'page-header');
        var title = el('h2', 'page-title', 'Coverage Gaps');
        var desc = el('p', 'page-description', 'High-value gaps across Defender, ASR telemetry, endpoint security, LAPS, and patch currency.');
        pageHeader.appendChild(title);
        pageHeader.appendChild(desc);

        var summaryCards = el('div', 'summary-cards');
        var cardData = [
            { value: defenderIssues.length, label: 'Defender Sensor Gaps' },
            { value: asrNoTelemetry.length, label: 'ASR No Telemetry' },
            { value: endpointIssues.length, label: 'Endpoint Security Issues' },
            { value: lapsIssues.length, label: 'LAPS Gaps' },
            { value: hardeningIssues.length, label: 'Hardening Gaps' },
            { value: patchIssues.length, label: 'Patch Currency Gaps' }
        ];
        cardData.forEach(function(c) {
            var card = el('div', 'summary-card');
            card.appendChild(el('div', 'summary-value', String(c.value)));
            card.appendChild(el('div', 'summary-label', c.label));
            summaryCards.appendChild(card);
        });

        // Filter button group
        var filterGroup = el('div', 'filter-button-group');
        filterGroup.style.marginBottom = '1rem';
        var filters = [
            { key: 'defender', label: 'Defender', count: defenderIssues.length },
            { key: 'asr', label: 'ASR Telemetry', count: asrNoTelemetry.length },
            { key: 'endpoint', label: 'Endpoint Security', count: endpointIssues.length },
            { key: 'laps', label: 'LAPS', count: lapsIssues.length },
            { key: 'hardening', label: 'Hardening', count: hardeningIssues.length },
            { key: 'patch', label: 'Patch Currency', count: patchIssues.length }
        ];
        filters.forEach(function(f) {
            var btn = el('button', 'filter-btn' + (f.key === currentFilter ? ' active' : ''));
            btn.setAttribute('data-filter', f.key);
            btn.textContent = f.label + ' (' + f.count + ')';
            filterGroup.appendChild(btn);
        });

        // Single section for filtered content
        var section = el('div', 'analytics-section');
        var sectionTitle = el('h3');
        sectionTitle.id = 'gap-section-title';
        sectionTitle.textContent = 'Defender Device Health Gaps';
        var tableContainer = el('div');
        tableContainer.id = 'gap-table';
        section.appendChild(sectionTitle);
        section.appendChild(tableContainer);

        container.textContent = '';
        container.appendChild(pageHeader);
        container.appendChild(summaryCards);
        container.appendChild(filterGroup);
        container.appendChild(section);

        // Build ASR coverage rows and cache
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
        cachedData.asrCoverageRows = asrCoverageRows;

        // Build endpoint columns and cache
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
        cachedData.endpointColumns = endpointColumns;

        // Attach filter button handlers
        filterGroup.addEventListener('click', function(e) {
            var btn = e.target.closest('.filter-btn');
            if (!btn) return;
            var filter = btn.getAttribute('data-filter');
            if (filter && filter !== currentFilter) {
                currentFilter = filter;
                filterGroup.querySelectorAll('.filter-btn').forEach(function(b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                renderFilteredTable();
            }
        });

        // Render initial table
        renderFilteredTable();
    }

    function renderFilteredTable() {
        if (!cachedData) return;

        var titleEl = document.getElementById('gap-section-title');
        var titles = {
            defender: 'Defender Device Health Gaps',
            asr: 'ASR Telemetry Coverage',
            endpoint: 'Endpoint Security Policy Compliance',
            laps: 'Local Admin / LAPS Coverage',
            hardening: 'Credential Guard & Memory Integrity',
            patch: 'Patch Currency Gaps'
        };
        if (titleEl) titleEl.textContent = titles[currentFilter] || 'Coverage Gaps';

        var emptyMessages = {
            defender: 'No Defender device health gaps detected.',
            asr: 'No ASR telemetry gaps detected.',
            endpoint: 'No endpoint security policy gaps detected.',
            laps: 'No LAPS gaps detected.',
            hardening: 'No device hardening gaps detected.',
            patch: 'No patch currency gaps detected.'
        };

        var data, columns;
        var signatureThreshold = cachedData.signatureThreshold;
        var defenderSummary = cachedData.defenderSummary;
        var asrNoiseThreshold = cachedData.asrNoiseThreshold;
        var lapsRaw = cachedData.lapsRaw;

        if (currentFilter === 'defender') {
            data = cachedData.defenderIssues;
            columns = [
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
            ];
        } else if (currentFilter === 'asr') {
            data = cachedData.asrCoverageRows;
            columns = [
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
            ];
        } else if (currentFilter === 'endpoint') {
            data = cachedData.endpointIssues;
            columns = cachedData.endpointColumns;
        } else if (currentFilter === 'laps') {
            data = cachedData.lapsIssues;
            columns = [
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
            ];
        } else if (currentFilter === 'hardening') {
            data = cachedData.hardeningIssues;
            columns = [
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
            ];
        } else if (currentFilter === 'patch') {
            data = cachedData.patchIssues;
            columns = [
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
            ];
        }

        renderTableOrEmpty('gap-table', data, columns, emptyMessages[currentFilter]);
    }

    return { render: render };
})();

window.PageGaps = PageGaps;
