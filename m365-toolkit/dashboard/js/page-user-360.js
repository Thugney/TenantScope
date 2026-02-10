/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: USER 360
 *
 * Provides a single-pane, user-centric view aggregating identity, access,
 * devices, groups, sign-ins, risk, and licenses.
 */

const PageUser360 = (function() {
    'use strict';

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

    function ensureIndex() {
        if (typeof EntityIndex === 'undefined') return null;
        var state = EntityIndex.getState && EntityIndex.getState();
        if (!state && EntityIndex.buildFromDataLoader) {
            try {
                EntityIndex.buildFromDataLoader();
            } catch (err) {
                console.warn('User360: Entity index build failed', err.message || err);
            }
        }
        return EntityIndex.getState ? EntityIndex.getState() : null;
    }

    function resolveUser(params) {
        params = params || {};
        var id = params.id || params.userId || '';
        var upn = params.upn || params.user || params.search || '';

        var state = ensureIndex();
        if (state && typeof EntityIndex.getUser === 'function') {
            if (id) {
                var byId = EntityIndex.getUser(id);
                if (byId) return byId;
            }
            if (upn) {
                var byUpn = EntityIndex.getUser(upn);
                if (byUpn) return byUpn;
            }
        }

        var users = (typeof DataLoader !== 'undefined' && DataLoader.getRawData)
            ? DataLoader.getRawData('users') : [];

        if (id) {
            var matchById = users.find(function(u) { return u && (u.id === id || u.userId === id); });
            if (matchById) return matchById;
        }

        if (upn) {
            var upnLower = String(upn).toLowerCase();
            var exact = users.find(function(u) {
                return u && u.userPrincipalName && u.userPrincipalName.toLowerCase() === upnLower;
            });
            if (exact) return exact;
            var byMail = users.find(function(u) {
                return u && u.mail && u.mail.toLowerCase() === upnLower;
            });
            if (byMail) return byMail;
            var byName = users.find(function(u) {
                return u && u.displayName && u.displayName.toLowerCase() === upnLower;
            });
            if (byName) return byName;
        }

        return null;
    }

    function userMatches(user, member) {
        if (!user || !member) return false;
        if (user.id && member.id && user.id === member.id) return true;
        var upn = (user.userPrincipalName || user.mail || '').toLowerCase();
        var mupn = (member.userPrincipalName || member.mail || '').toLowerCase();
        return upn && mupn && upn === mupn;
    }

    function getUserDevices(user) {
        var state = ensureIndex();
        if (state) {
            if (user.id && state.userDevicesById[user.id]) {
                return state.userDevicesById[user.id];
            }
            var upn = (user.userPrincipalName || user.mail || '').toLowerCase();
            if (upn && state.userDevicesByUpn[upn]) return state.userDevicesByUpn[upn];
        }

        var devices = DataLoader.getData('devices') || [];
        return devices.filter(function(d) {
            return d.userId === user.id ||
                   (user.userPrincipalName && d.userPrincipalName === user.userPrincipalName);
        });
    }

    function getUserGroups(user) {
        var groups = DataLoader.getData('groups') || [];
        var list = [];
        groups.forEach(function(g) {
            if (!g) return;
            var members = Array.isArray(g.members) ? g.members : [];
            var owners = Array.isArray(g.owners) ? g.owners : [];
            var isOwner = owners.some(function(o) { return userMatches(user, o); });
            var isMember = members.some(function(m) { return userMatches(user, m); });
            if (isOwner || isMember) {
                list.push({
                    group: g,
                    role: isOwner ? 'Owner' : 'Member'
                });
            }
        });
        return list;
    }

    function getUserTeams(user) {
        var teams = DataLoader.getData('teams') || [];
        var upn = (user.userPrincipalName || '').toLowerCase();
        return teams.filter(function(t) {
            if (!upn || !t) return false;
            var owners = t.ownerUpns || t.ownerUpn || [];
            if (typeof owners === 'string') owners = [owners];
            return owners.some(function(o) {
                return String(o || '').toLowerCase() === upn;
            });
        });
    }

    function getUserSites(user) {
        var sites = DataLoader.getData('sharepointSites') || [];
        var upn = (user.userPrincipalName || '').toLowerCase();
        return sites.filter(function(s) {
            return s && s.ownerPrincipalName && s.ownerPrincipalName.toLowerCase() === upn;
        });
    }

    function getUserSignIns(user) {
        var logs = DataLoader.getData('signinLogs') || {};
        var list = Array.isArray(logs.signIns) ? logs.signIns : [];
        return list.filter(function(l) {
            return l.userId === user.id ||
                (user.userPrincipalName && l.userPrincipalName === user.userPrincipalName);
        }).sort(function(a, b) {
            return new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime();
        });
    }

    function getUserRiskySignIns(user) {
        var risks = DataLoader.getData('riskySignins') || [];
        return risks.filter(function(r) {
            return r.userId === user.id ||
                (user.userPrincipalName && r.userPrincipalName === user.userPrincipalName);
        }).sort(function(a, b) {
            return new Date(b.detectedDateTime).getTime() - new Date(a.detectedDateTime).getTime();
        });
    }

    function getIdentityRisk(user) {
        var riskData = DataLoader.getData('identityRisk') || {};
        var riskyUsers = Array.isArray(riskData.riskyUsers) ? riskData.riskyUsers : [];
        var detections = Array.isArray(riskData.riskDetections) ? riskData.riskDetections : [];
        return {
            riskyUsers: riskyUsers.filter(function(r) {
                return r.userId === user.id ||
                    (user.userPrincipalName && r.userPrincipalName === user.userPrincipalName);
            }),
            detections: detections.filter(function(d) {
                return d.userId === user.id ||
                    (user.userPrincipalName && d.userPrincipalName === user.userPrincipalName);
            })
        };
    }

    function getUserMfa(user) {
        var mfa = DataLoader.getData('mfaStatus') || [];
        var upn = (user.userPrincipalName || '').toLowerCase();
        return mfa.find(function(m) {
            return (m.userId && m.userId === user.id) ||
                   (m.userPrincipalName && m.userPrincipalName.toLowerCase() === upn);
        }) || null;
    }

    function getUserAdminRoles(user) {
        var roles = DataLoader.getData('adminRoles') || [];
        var upn = (user.userPrincipalName || '').toLowerCase();
        return roles.filter(function(role) {
            var members = Array.isArray(role.members) ? role.members : [];
            return members.some(function(m) {
                return (m.id && m.id === user.id) ||
                    (m.userPrincipalName && m.userPrincipalName.toLowerCase() === upn);
            });
        });
    }

    function getUserLicenses(user) {
        var licenses = Array.isArray(user.assignedLicenses) ? user.assignedLicenses : [];
        var skus = DataLoader.getData('licenseSkus') || [];
        var skuMap = {};
        skus.forEach(function(s) { if (s && s.skuId) skuMap[s.skuId] = s; });
        return licenses.map(function(l) {
            var sku = skuMap[l.skuId] || {};
            return {
                skuId: l.skuId,
                displayName: sku.displayName || sku.skuPartNumber || l.skuId,
                skuPartNumber: sku.skuPartNumber || '',
                assignedVia: l.assignmentSource || (l.assignedViaGroupId ? 'Group' : 'Direct'),
                state: l.state || 'Active',
                assignedViaGroupId: l.assignedViaGroupId || null
            };
        });
    }

    function renderEmpty(container, message) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-title">User Not Found</div><p>' +
            escapeHtml(message || 'Provide a user id or UPN in the URL, e.g. #user-360?upn=someone@domain.com') +
            '</p></div>';
    }

    function render(container) {
        var params = getHashParams();
        var user = resolveUser(params);

        if (!user) {
            renderEmpty(container);
            return;
        }

        var devices = getUserDevices(user);
        var groups = getUserGroups(user);
        var teams = getUserTeams(user);
        var sites = getUserSites(user);
        var signins = getUserSignIns(user);
        var risky = getUserRiskySignIns(user);
        var identityRisk = getIdentityRisk(user);
        var mfa = getUserMfa(user);
        var roles = getUserAdminRoles(user);
        var licenses = getUserLicenses(user);

        container.textContent = '';

        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', user.displayName || 'User'));
        header.appendChild(el('p', 'page-description', user.userPrincipalName || user.mail || '--'));
        container.appendChild(header);

        var cards = el('div', 'summary-cards');
        cards.appendChild(createSummaryCard('Status', user.accountEnabled === false ? 'Disabled' : 'Enabled', user.accountEnabled === false ? 'critical' : 'success'));
        cards.appendChild(createSummaryCard('MFA', mfa && mfa.isMfaRegistered ? 'Registered' : 'Not Registered', mfa && mfa.isMfaRegistered ? 'success' : 'warning'));
        cards.appendChild(createSummaryCard('Devices', devices.length, devices.length > 0 ? 'info' : ''));
        cards.appendChild(createSummaryCard('Groups', groups.length, groups.length > 0 ? 'info' : ''));
        container.appendChild(cards);

        // Identity section
        var identity = el('div', 'analytics-section');
        identity.appendChild(el('h3', null, 'Identity & Contact'));
        var list = el('div', 'detail-list');
        list.innerHTML =
            '<span class="detail-label">UPN:</span><span class="detail-value">' + escapeHtml(user.userPrincipalName || '--') + '</span>' +
            '<span class="detail-label">Email:</span><span class="detail-value">' + escapeHtml(user.mail || '--') + '</span>' +
            '<span class="detail-label">Department:</span><span class="detail-value">' + escapeHtml(user.department || '--') + '</span>' +
            '<span class="detail-label">Job Title:</span><span class="detail-value">' + escapeHtml(user.jobTitle || '--') + '</span>' +
            '<span class="detail-label">Manager:</span><span class="detail-value">' + escapeHtml(user.manager || user.managerUpn || '--') + '</span>' +
            '<span class="detail-label">User Type:</span><span class="detail-value">' + escapeHtml(user.userType || '--') + '</span>' +
            '<span class="detail-label">Source:</span><span class="detail-value">' + escapeHtml(user.userSource || '--') + '</span>' +
            '<span class="detail-label">Created:</span><span class="detail-value">' + formatDate(user.createdDateTime) + '</span>' +
            '<span class="detail-label">Last Sign-In:</span><span class="detail-value">' + formatDate(user.lastSignIn) + '</span>';
        identity.appendChild(list);
        container.appendChild(identity);

        // Access & Security
        var access = el('div', 'analytics-section');
        access.appendChild(el('h3', null, 'Access & Security'));
        var accessGrid = el('div', 'analytics-grid');

        var mfaCard = el('div', 'analytics-card');
        mfaCard.appendChild(el('h4', null, 'MFA'));
        mfaCard.appendChild(el('p', 'text-muted', mfa ? 'Methods: ' + (mfa.methods || []).length : 'No MFA record'));
        if (mfa && mfa.methods && mfa.methods.length > 0) {
            var methods = el('div', 'platform-list');
            mfa.methods.slice(0, 5).forEach(function(method) {
                methods.appendChild(el('div', 'platform-row', method));
            });
            mfaCard.appendChild(methods);
        }
        accessGrid.appendChild(mfaCard);

        var roleCard = el('div', 'analytics-card');
        roleCard.appendChild(el('h4', null, 'Admin Roles'));
        if (roles.length === 0) {
            roleCard.appendChild(el('p', 'text-muted', 'No admin roles found'));
        } else {
            var roleList = el('div', 'platform-list');
            roles.slice(0, 6).forEach(function(role) {
                roleList.appendChild(el('div', 'platform-row', role.roleName || role.displayName || '--'));
            });
            roleCard.appendChild(roleList);
        }
        accessGrid.appendChild(roleCard);

        var riskCard = el('div', 'analytics-card');
        riskCard.appendChild(el('h4', null, 'Risk Signals'));
        var riskCount = risky.length + (identityRisk.detections || []).length;
        riskCard.appendChild(el('p', 'text-muted', riskCount > 0 ? (riskCount + ' risk events') : 'No risk events found'));
        accessGrid.appendChild(riskCard);

        access.appendChild(accessGrid);
        container.appendChild(access);

        // Devices
        var devicesSection = el('div', 'analytics-section');
        devicesSection.appendChild(el('h3', null, 'Devices'));
        devicesSection.appendChild(renderDevicesTable(devices));
        container.appendChild(devicesSection);

        // Groups & Teams
        var groupSection = el('div', 'analytics-section');
        groupSection.appendChild(el('h3', null, 'Groups & Teams'));
        groupSection.appendChild(renderGroupsTable(groups));
        if (teams.length > 0) {
            var teamsList = el('div', 'platform-list');
            teams.slice(0, 6).forEach(function(t) {
                teamsList.appendChild(el('div', 'platform-row', t.displayName || '--'));
            });
            groupSection.appendChild(el('h4', null, 'Teams (Owner)'));
            groupSection.appendChild(teamsList);
        }
        if (sites.length > 0) {
            var sitesList = el('div', 'platform-list');
            sites.slice(0, 6).forEach(function(s) {
                sitesList.appendChild(el('div', 'platform-row', s.displayName || s.url || '--'));
            });
            groupSection.appendChild(el('h4', null, 'SharePoint Sites (Owner)'));
            groupSection.appendChild(sitesList);
        }
        container.appendChild(groupSection);

        // Licenses
        var licensesSection = el('div', 'analytics-section');
        licensesSection.appendChild(el('h3', null, 'Licenses'));
        licensesSection.appendChild(renderLicensesTable(licenses));
        container.appendChild(licensesSection);

        // Sign-ins
        var signinSection = el('div', 'analytics-section');
        signinSection.appendChild(el('h3', null, 'Recent Sign-Ins'));
        signinSection.appendChild(renderSigninsTable(signins));
        container.appendChild(signinSection);
    }

    function createSummaryCard(label, value, variant) {
        var card = el('div', 'summary-card' + (variant ? ' card-' + variant : ''));
        card.appendChild(el('div', 'summary-value', String(value)));
        card.appendChild(el('div', 'summary-label', label));
        return card;
    }

    function renderDevicesTable(devices) {
        if (!devices || devices.length === 0) {
            return el('div', 'text-muted', 'No devices found');
        }
        var table = el('table', 'data-table');
        table.innerHTML = '<thead><tr><th>Device</th><th>OS</th><th>Compliance</th><th>Last Sync</th><th>Ownership</th></tr></thead><tbody></tbody>';
        var body = table.querySelector('tbody');
        devices.slice(0, 15).forEach(function(d) {
            var tr = el('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(d.deviceName || d.displayName || '--') + '</td>' +
                '<td>' + escapeHtml(d.windowsType || d.os || d.operatingSystem || '--') + '</td>' +
                '<td>' + escapeHtml(d.complianceState || '--') + '</td>' +
                '<td>' + formatDate(d.lastSync) + '</td>' +
                '<td>' + escapeHtml(d.ownership || '--') + '</td>';
            body.appendChild(tr);
        });
        return table;
    }

    function renderGroupsTable(groups) {
        if (!groups || groups.length === 0) {
            return el('div', 'text-muted', 'No group memberships found or membership not collected');
        }
        var table = el('table', 'data-table');
        table.innerHTML = '<thead><tr><th>Group</th><th>Type</th><th>Role</th><th>Members</th></tr></thead><tbody></tbody>';
        var body = table.querySelector('tbody');
        groups.slice(0, 15).forEach(function(entry) {
            var g = entry.group || {};
            var tr = el('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(g.displayName || '--') + '</td>' +
                '<td>' + escapeHtml(g.groupType || '--') + '</td>' +
                '<td>' + escapeHtml(entry.role || '--') + '</td>' +
                '<td>' + escapeHtml(String(g.memberCount || 0)) + '</td>';
            body.appendChild(tr);
        });
        return table;
    }

    function renderLicensesTable(licenses) {
        if (!licenses || licenses.length === 0) {
            return el('div', 'text-muted', 'No licenses found');
        }
        var table = el('table', 'data-table');
        table.innerHTML = '<thead><tr><th>License</th><th>SKU</th><th>Assigned Via</th><th>Status</th></tr></thead><tbody></tbody>';
        var body = table.querySelector('tbody');
        licenses.slice(0, 15).forEach(function(l) {
            var tr = el('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(l.displayName || '--') + '</td>' +
                '<td>' + escapeHtml(l.skuPartNumber || l.skuId || '--') + '</td>' +
                '<td>' + escapeHtml(l.assignedVia || '--') + '</td>' +
                '<td>' + escapeHtml(l.state || '--') + '</td>';
            body.appendChild(tr);
        });
        return table;
    }

    function renderSigninsTable(signins) {
        if (!signins || signins.length === 0) {
            return el('div', 'text-muted', 'No sign-in logs found');
        }
        var table = el('table', 'data-table');
        table.innerHTML = '<thead><tr><th>App</th><th>Status</th><th>Location</th><th>When</th></tr></thead><tbody></tbody>';
        var body = table.querySelector('tbody');
        signins.slice(0, 10).forEach(function(s) {
            var location = [s.city, s.country].filter(Boolean).join(', ');
            var tr = el('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(s.appDisplayName || '--') + '</td>' +
                '<td>' + escapeHtml(s.status || s.conditionalAccessStatus || '--') + '</td>' +
                '<td>' + escapeHtml(location || '--') + '</td>' +
                '<td>' + formatDate(s.createdDateTime) + '</td>';
            body.appendChild(tr);
        });
        return table;
    }

    return {
        render: render
    };
})();

window.PageUser360 = PageUser360;
