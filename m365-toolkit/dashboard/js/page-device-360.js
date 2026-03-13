/**
 * ============================================================================
 * TenantScope - Device 360
 * ============================================================================
 *
 * Dedicated device-centric profile page. Keeps investigation inside the local
 * dashboard and moves external portal links into a separate Take Action area.
 */

const PageDevice360 = (function() {
    'use strict';

    var AU = window.ActionUtils || {};

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        var div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function formatDate(value) {
        if (!value) return '--';
        if (typeof DataLoader !== 'undefined' && DataLoader.formatDate) {
            return DataLoader.formatDate(value);
        }
        var dt = new Date(value);
        if (isNaN(dt.getTime())) return '--';
        return dt.toLocaleDateString();
    }

    function getHashParams() {
        var hash = window.location.hash || '';
        var idx = hash.indexOf('?');
        if (idx === -1) return {};
        var query = hash.substring(idx + 1);
        var params = new URLSearchParams(query);
        var result = {};
        params.forEach(function(value, key) {
            result[key] = value;
        });
        return result;
    }

    function getDevicesData() {
        var raw = typeof DataLoader !== 'undefined' && DataLoader.getRawData
            ? DataLoader.getRawData('devices')
            : (typeof DataLoader !== 'undefined' ? DataLoader.getData('devices') : []);
        if (Array.isArray(raw)) return raw;
        return raw && Array.isArray(raw.devices) ? raw.devices : [];
    }

    function ensureIndex() {
        if (typeof EntityIndex === 'undefined') return null;
        var state = EntityIndex.getState && EntityIndex.getState();
        if (!state && EntityIndex.buildFromDataLoader) {
            try {
                EntityIndex.buildFromDataLoader();
            } catch (err) {
                console.warn('Device360: Entity index build failed', err.message || err);
            }
        }
        return EntityIndex.getState ? EntityIndex.getState() : null;
    }

    function resolveDevice(params) {
        params = params || {};
        var id = params.id || params.deviceId || '';
        var name = params.name || params.device || params.deviceName || params.search || '';

        ensureIndex();
        if (typeof EntityIndex !== 'undefined' && EntityIndex.getDevice) {
            if (id) {
                var byId = EntityIndex.getDevice(id);
                if (byId) return byId;
            }
            if (name) {
                var byName = EntityIndex.getDevice(name);
                if (byName) return byName;
            }
        }

        var devices = getDevicesData();
        if (id) {
            var idLower = String(id).toLowerCase();
            var exactById = devices.find(function(device) {
                return device && (
                    String(device.id || '').toLowerCase() === idLower ||
                    String(device.deviceId || '').toLowerCase() === idLower ||
                    String(device.azureAdDeviceId || '').toLowerCase() === idLower
                );
            });
            if (exactById) return exactById;
        }

        if (name) {
            var nameLower = String(name).toLowerCase();
            return devices.find(function(device) {
                if (!device) return false;
                return [
                    device.deviceName,
                    device.displayName,
                    device.managedDeviceName,
                    device.serialNumber,
                    device.azureAdDeviceId,
                    device.id
                ].some(function(value) {
                    return value && String(value).toLowerCase() === nameLower;
                });
            }) || null;
        }

        return null;
    }

    function getUserProfileHref(target) {
        if (AU.getUserProfileHash) return AU.getUserProfileHash(target);
        var value = typeof target === 'string'
            ? target
            : (target && (target.userPrincipalName || target.mail || target.displayName || ''));
        return value ? '#users?search=' + encodeURIComponent(value) : '#users';
    }

    function createSummaryCard(label, value, variant) {
        var card = el('div', 'summary-card' + (variant ? ' card-' + variant : ''));
        card.appendChild(el('div', 'summary-value', String(value)));
        card.appendChild(el('div', 'summary-label', label));
        return card;
    }

    function createDetailSection(title, html) {
        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, title));
        var body = el('div');
        body.innerHTML = html;
        section.appendChild(body);
        return section;
    }

    function renderEmpty(container, message) {
        container.innerHTML =
            '<div class="empty-state">' +
            '<div class="empty-state-title">Device Not Found</div>' +
            '<p>' + escapeHtml(message || 'Provide a device id or name in the URL, e.g. #device-360?name=LAPTOP-001') + '</p>' +
            '</div>';
    }

    function renderActionSection(adminUrls) {
        adminUrls = adminUrls || {};
        var actions = [];

        if (adminUrls.intune) actions.push({ href: adminUrls.intune, label: 'Open in Intune', primary: true });
        if (adminUrls.intuneCompliance) actions.push({ href: adminUrls.intuneCompliance, label: 'Compliance' });
        if (adminUrls.intuneBitLocker) actions.push({ href: adminUrls.intuneBitLocker, label: 'BitLocker Keys' });
        if (adminUrls.intuneSync) actions.push({ href: adminUrls.intuneSync, label: 'Sync Device' });
        if (adminUrls.entra) actions.push({ href: adminUrls.entra, label: 'Entra Device' });
        if (adminUrls.defender) actions.push({ href: adminUrls.defender, label: 'Defender' });

        if (actions.length === 0) return null;

        var section = el('div', 'analytics-section');
        section.appendChild(el('h3', null, 'Take Action'));

        var wrap = el('div', 'admin-portal-links');
        wrap.style.display = 'flex';
        wrap.style.flexWrap = 'wrap';
        wrap.style.gap = '0.5rem';

        actions.forEach(function(action) {
            var anchor = el('a', action.primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm', action.label);
            anchor.href = action.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener';
            wrap.appendChild(anchor);
        });

        section.appendChild(wrap);
        return section;
    }

    function buildInfoGrid(rows) {
        var html = '<div class="detail-list">';
        rows.forEach(function(row) {
            html += '<span class="detail-label">' + escapeHtml(row.label) + ':</span><span class="detail-value">' + row.value + '</span>';
        });
        html += '</div>';
        return html;
    }

    function buildTable(headers, rowsHtml) {
        return '<table class="data-table"><thead><tr>' +
            headers.map(function(header) { return '<th>' + escapeHtml(header) + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    }

    function render(container) {
        var params = getHashParams();
        var device = resolveDevice(params);

        if (!device) {
            renderEmpty(container);
            return;
        }

        var profile = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceProfile
            ? DataRelationships.getDeviceProfile(device.id || device.deviceName || device.displayName)
            : null;
        var primaryUser = profile ? profile.primaryUser : null;
        var bitlocker = profile ? profile.bitlocker : {};
        var windowsUpdate = profile ? profile.windowsUpdate : {};
        var vulnerabilities = profile ? profile.vulnerabilities : [];
        var signIns = profile ? profile.signIns : [];
        var alerts = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceAlerts
            ? DataRelationships.getDeviceAlerts(device.deviceName)
            : [];
        var adminUrls = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceAdminUrls
            ? DataRelationships.getDeviceAdminUrls(device)
            : {};
        var autopilot = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceAutopilot
            ? DataRelationships.getDeviceAutopilot(device)
            : null;
        var configProfiles = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceConfigProfiles
            ? DataRelationships.getDeviceConfigProfiles(device.deviceName)
            : { profiles: [], failedCount: 0 };
        var appDeployments = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceAppDeployments
            ? DataRelationships.getDeviceAppDeployments(device.deviceName)
            : { apps: [], failedCount: 0 };
        var compliancePolicies = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceCompliancePolicies
            ? DataRelationships.getDeviceCompliancePolicies(device.deviceName)
            : { policies: [], nonCompliantCount: 0 };
        var endpointAnalytics = typeof DataRelationships !== 'undefined' && DataRelationships.getDeviceEndpointAnalytics
            ? DataRelationships.getDeviceEndpointAnalytics(device.deviceName)
            : null;

        container.textContent = '';

        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', device.deviceName || device.displayName || 'Device'));
        header.appendChild(el(
            'p',
            'page-description',
            [device.userPrincipalName || device.primaryUserDisplayName, device.windowsType || device.os || device.operatingSystem]
                .filter(Boolean)
                .join(' • ') || '--'
        ));
        container.appendChild(header);

        var cards = el('div', 'summary-cards');
        cards.appendChild(createSummaryCard('Compliance', device.complianceState || '--', device.complianceState === 'compliant' ? 'success' : (device.complianceState === 'noncompliant' ? 'critical' : 'warning')));
        cards.appendChild(createSummaryCard('Encryption', bitlocker.encrypted === true || device.isEncrypted === true ? 'Encrypted' : (bitlocker.encrypted === false || device.isEncrypted === false ? 'Not Encrypted' : 'Unknown'), (bitlocker.encrypted === true || device.isEncrypted === true) ? 'success' : ((bitlocker.encrypted === false || device.isEncrypted === false) ? 'critical' : 'warning')));
        cards.appendChild(createSummaryCard('Alerts', alerts.length, alerts.length > 0 ? 'warning' : 'success'));
        cards.appendChild(createSummaryCard('Vulnerabilities', vulnerabilities.length, vulnerabilities.length > 0 ? 'critical' : 'success'));
        container.appendChild(cards);

        var actionsSection = renderActionSection(adminUrls);
        if (actionsSection) {
            container.appendChild(actionsSection);
        }

        container.appendChild(createDetailSection('Identity & Management', buildInfoGrid([
            { label: 'Device Name', value: escapeHtml(device.deviceName || device.displayName || '--') },
            { label: 'Managed Name', value: escapeHtml(device.managedDeviceName || '--') },
            { label: 'Primary User', value: primaryUser ? ('<a href="' + getUserProfileHref(primaryUser) + '" class="entity-link">' + escapeHtml(primaryUser.displayName || primaryUser.userPrincipalName || '--') + '</a>') : escapeHtml(device.userPrincipalName || '--') },
            { label: 'UPN', value: escapeHtml(device.userPrincipalName || '--') },
            { label: 'Manufacturer', value: escapeHtml(device.manufacturer || '--') },
            { label: 'Model', value: escapeHtml(device.model || '--') },
            { label: 'Serial Number', value: escapeHtml(device.serialNumber || '--') },
            { label: 'Ownership', value: escapeHtml(device.ownership || '--') },
            { label: 'Management Source', value: escapeHtml(device.managementSource || '--') },
            { label: 'Management Agent', value: escapeHtml(device.managementAgent || '--') },
            { label: 'Join Type', value: escapeHtml(device.joinType || '--') },
            { label: 'Last Sync', value: escapeHtml(formatDate(device.lastSync)) }
        ])));

        container.appendChild(createDetailSection('Security & Compliance', buildInfoGrid([
            { label: 'Threat State', value: escapeHtml(device.threatStateDisplay || '--') },
            { label: 'Threat Severity', value: escapeHtml(device.threatSeverity || '--') },
            { label: 'BitLocker', value: escapeHtml(bitlocker.status || bitlocker.encryptionState || '--') },
            { label: 'Recovery Keys', value: escapeHtml(String(bitlocker.recoveryKeyCount || 0)) },
            { label: 'Windows Update Ring', value: escapeHtml(windowsUpdate.ring || '--') },
            { label: 'Windows Update Status', value: escapeHtml(windowsUpdate.status || '--') },
            { label: 'Pending Updates', value: escapeHtml(String(windowsUpdate.pendingUpdates || 0)) },
            { label: 'Non-Compliant Policies', value: escapeHtml(String(compliancePolicies.nonCompliantCount || 0)) },
            { label: 'Endpoint Health', value: escapeHtml(endpointAnalytics && endpointAnalytics.healthStatus ? endpointAnalytics.healthStatus : '--') },
            { label: 'Endpoint Score', value: escapeHtml(endpointAnalytics && endpointAnalytics.endpointAnalyticsScore !== null && endpointAnalytics.endpointAnalyticsScore !== undefined ? String(endpointAnalytics.endpointAnalyticsScore) : '--') },
            { label: 'Autopilot', value: autopilot ? '<span class="text-success">Registered</span>' : (device.autopilotEnrolled ? '<span class="text-success">Yes</span>' : '--') },
            { label: 'Windows Supported', value: device.windowsSupported === true ? '<span class="text-success">Yes</span>' : (device.windowsSupported === false ? '<span class="text-critical">No</span>' : '--') }
        ])));

        if (primaryUser) {
            container.appendChild(createDetailSection('Primary User', buildInfoGrid([
                { label: 'Display Name', value: '<a href="' + getUserProfileHref(primaryUser) + '" class="entity-link"><strong>' + escapeHtml(primaryUser.displayName || '--') + '</strong></a>' },
                { label: 'UPN', value: '<a href="' + getUserProfileHref(primaryUser) + '" class="entity-link">' + escapeHtml(primaryUser.userPrincipalName || '--') + '</a>' },
                { label: 'Department', value: escapeHtml(primaryUser.department || '--') },
                { label: 'Job Title', value: escapeHtml(primaryUser.jobTitle || '--') },
                { label: 'Manager', value: escapeHtml(primaryUser.manager || '--') },
                { label: 'Account Enabled', value: primaryUser.accountEnabled === false ? '<span class="text-critical">No</span>' : '<span class="text-success">Yes</span>' }
            ])));
        }

        if (vulnerabilities.length > 0) {
            var vulnerabilityRows = '';
            vulnerabilities.slice(0, 20).forEach(function(vuln) {
                vulnerabilityRows += '<tr>' +
                    '<td>' + escapeHtml(vuln.name || vuln.id || '--') + '</td>' +
                    '<td>' + escapeHtml(vuln.severity || '--') + '</td>' +
                    '<td>' + escapeHtml(vuln.cvssScore !== undefined && vuln.cvssScore !== null ? String(vuln.cvssScore) : '--') + '</td>' +
                    '<td>' + (vuln.exploitedInWild ? '<span class="text-critical">Yes</span>' : 'No') + '</td>' +
                    '<td>' + (vuln.patchAvailable ? '<span class="text-success">Yes</span>' : '<span class="text-warning">No</span>') + '</td>' +
                    '</tr>';
            });
            container.appendChild(createDetailSection('Vulnerabilities', buildTable(['CVE', 'Severity', 'CVSS', 'Exploited', 'Patch'], vulnerabilityRows)));
        }

        if (alerts.length > 0) {
            var alertRows = '';
            alerts.slice(0, 15).forEach(function(alert) {
                alertRows += '<tr>' +
                    '<td>' + escapeHtml(alert.title || '--') + '</td>' +
                    '<td>' + escapeHtml(alert.severity || '--') + '</td>' +
                    '<td>' + escapeHtml(alert.status || '--') + '</td>' +
                    '<td>' + escapeHtml(formatDate(alert.createdDateTime)) + '</td>' +
                    '</tr>';
            });
            container.appendChild(createDetailSection('Defender Alerts', buildTable(['Alert', 'Severity', 'Status', 'Date'], alertRows)));
        }

        if (compliancePolicies.policies && compliancePolicies.policies.length > 0) {
            var complianceRows = '';
            compliancePolicies.policies.slice(0, 20).forEach(function(policy) {
                complianceRows += '<tr>' +
                    '<td>' + escapeHtml(policy.displayName || '--') + '</td>' +
                    '<td>' + escapeHtml(policy.platform || '--') + '</td>' +
                    '<td>' + escapeHtml(policy.category || '--') + '</td>' +
                    '<td>' + escapeHtml(policy.isNonCompliant ? 'Non-Compliant' : (policy.isError ? 'Error' : 'Compliant')) + '</td>' +
                    '</tr>';
            });
            container.appendChild(createDetailSection('Compliance Policies', buildTable(['Policy', 'Platform', 'Category', 'Status'], complianceRows)));
        }

        if (configProfiles.profiles && configProfiles.profiles.length > 0) {
            var profileRows = '';
            configProfiles.profiles.slice(0, 20).forEach(function(profileRow) {
                profileRows += '<tr>' +
                    '<td>' + escapeHtml(profileRow.displayName || '--') + '</td>' +
                    '<td>' + escapeHtml(profileRow.profileType || '--') + '</td>' +
                    '<td>' + escapeHtml(profileRow.category || '--') + '</td>' +
                    '<td>' + escapeHtml(profileRow.hasError ? 'Error' : (profileRow.hasConflict ? 'Conflict' : 'Success')) + '</td>' +
                    '</tr>';
            });
            container.appendChild(createDetailSection('Configuration Profiles', buildTable(['Profile', 'Type', 'Category', 'Status'], profileRows)));
        }

        if (appDeployments.apps && appDeployments.apps.length > 0) {
            var appRows = '';
            appDeployments.apps.slice(0, 20).forEach(function(app) {
                appRows += '<tr>' +
                    '<td>' + escapeHtml(app.displayName || '--') + '</td>' +
                    '<td>' + escapeHtml(app.version || '--') + '</td>' +
                    '<td>' + escapeHtml(app.appType || '--') + '</td>' +
                    '<td>' + escapeHtml(app.isFailed ? 'Failed' : 'Installed') + '</td>' +
                    '</tr>';
            });
            container.appendChild(createDetailSection('App Deployments', buildTable(['App', 'Version', 'Type', 'Status'], appRows)));
        }

        if (signIns.length > 0) {
            var signInRows = '';
            signIns.slice(0, 20).forEach(function(signIn) {
                var userCell = signIn.userPrincipalName
                    ? '<a href="' + getUserProfileHref(signIn.userPrincipalName) + '" class="entity-link">' + escapeHtml(signIn.userPrincipalName) + '</a>'
                    : '--';
                var statusText = signIn.status && signIn.status.errorCode === 0
                    ? 'Success'
                    : (signIn.status && signIn.status.failureReason ? signIn.status.failureReason : 'Unknown');
                signInRows += '<tr>' +
                    '<td>' + escapeHtml(formatDate(signIn.createdDateTime)) + '</td>' +
                    '<td>' + userCell + '</td>' +
                    '<td>' + escapeHtml(signIn.appDisplayName || '--') + '</td>' +
                    '<td>' + escapeHtml(statusText) + '</td>' +
                    '<td>' + escapeHtml(signIn.location ? ((signIn.location.city || '') + ', ' + (signIn.location.countryOrRegion || '')).replace(/^,\s*|\s*,\s*$/g, '') : '--') + '</td>' +
                    '</tr>';
            });
            container.appendChild(createDetailSection('Recent Sign-Ins', buildTable(['Date', 'User', 'App', 'Status', 'Location'], signInRows)));
        }
    }

    return {
        render: render
    };
})();

window.PageDevice360 = PageDevice360;
