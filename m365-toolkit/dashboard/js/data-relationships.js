/**
 * ============================================================================
 * TenantScope - Data Relationships Module
 * ============================================================================
 *
 * Provides cross-entity lookups and relationship building.
 * Connects users, devices, vulnerabilities, policies, and other entities
 * to enable "single-pane-of-glass" detail views.
 *
 * Uses existing data from DataStore - no additional API calls.
 */

var DataRelationships = (function() {
    'use strict';

    // Index maps for O(1) lookups
    var userIndex = {};          // userId -> user object
    var userUpnIndex = {};       // userPrincipalName -> user object
    var deviceIndex = {};        // deviceId -> device object
    var deviceNameIndex = {};    // deviceName -> device object
    var mfaIndex = {};           // userId -> mfa status object
    var teamIndex = {};          // teamId -> team object
    var siteIndex = {};          // siteId -> sharepoint site object
    var siteGroupIndex = {};     // groupId -> sharepoint site object

    var indexesBuilt = false;

    /**
     * Build all index maps from DataStore data.
     * Call this after DataLoader.loadAll() completes.
     */
    function buildIndexes() {
        if (indexesBuilt) return;

        var users = DataStore.getAllUsers ? DataStore.getAllUsers() : (DataStore.users || []);
        var devices = DataStore.getAllDevices ? DataStore.getAllDevices() : (DataStore.devices || []);
        var mfaStatus = DataStore.mfaStatus || [];
        var teams = DataStore.teams || [];
        var sites = DataStore.sharepointSites || [];

        // Build user indexes
        users.forEach(function(user) {
            if (user.id) userIndex[user.id] = user;
            if (user.userPrincipalName) userUpnIndex[user.userPrincipalName.toLowerCase()] = user;
        });

        // Build device indexes
        devices.forEach(function(device) {
            if (device.id) deviceIndex[device.id] = device;
            if (device.deviceName) deviceNameIndex[device.deviceName.toLowerCase()] = device;
        });

        // Build MFA index
        mfaStatus.forEach(function(mfa) {
            if (mfa.id) mfaIndex[mfa.id] = mfa;
        });

        // Build team index
        teams.forEach(function(team) {
            if (team.id) teamIndex[team.id] = team;
        });

        // Build site indexes
        sites.forEach(function(site) {
            if (site.id) siteIndex[site.id] = site;
            if (site.groupId) siteGroupIndex[site.groupId] = site;
        });

        indexesBuilt = true;
        console.log('DataRelationships: Indexes built -',
            Object.keys(userIndex).length, 'users,',
            Object.keys(deviceIndex).length, 'devices,',
            Object.keys(teamIndex).length, 'teams,',
            Object.keys(siteIndex).length, 'sites');
    }

    // ========================================================================
    // USER RELATIONSHIPS
    // ========================================================================

    /**
     * Get complete user profile with all related data.
     * @param {string} userId - User ID or UPN
     * @returns {Object} User with devices, signIns, risks, roles, mfa, licenses
     */
    function getUserProfile(userId) {
        buildIndexes();

        var user = userIndex[userId] || userUpnIndex[(userId || '').toLowerCase()];
        if (!user) return null;

        return {
            user: user,
            devices: getUserDevices(user.id),
            signIns: getUserSignIns(user.id, user.userPrincipalName),
            risks: getUserRisks(user.id),
            adminRoles: getUserAdminRoles(user.id),
            mfa: getUserMfaDetails(user.id),
            teams: getUserTeams(user.userPrincipalName),
            licenses: getUserLicenseDetails(user)
        };
    }

    /**
     * Get devices owned/enrolled by user.
     */
    function getUserDevices(userId) {
        var devices = DataStore.getAllDevices ? DataStore.getAllDevices() : (DataStore.devices || []);
        return devices.filter(function(d) {
            return d.userId === userId || d.userPrincipalName === userId;
        });
    }

    /**
     * Get sign-in logs for user (last 20).
     */
    function getUserSignIns(userId, upn) {
        var logs = DataStore.signinLogs || [];
        var userLogs = logs.filter(function(log) {
            return log.userId === userId ||
                   (log.userPrincipalName && log.userPrincipalName.toLowerCase() === (upn || '').toLowerCase());
        });
        // Return most recent 20
        return userLogs.slice(0, 20);
    }

    /**
     * Get risk detections for user.
     */
    function getUserRisks(userId) {
        var riskData = DataStore.identityRiskData || {};
        var riskyUsers = riskData.riskyUsers || [];
        var riskDetections = riskData.riskDetections || [];

        var userRisk = riskyUsers.find(function(r) { return r.id === userId; });
        var userDetections = riskDetections.filter(function(d) { return d.userId === userId; });

        return {
            riskLevel: userRisk ? userRisk.riskLevel : 'none',
            riskState: userRisk ? userRisk.riskState : 'none',
            riskDetail: userRisk ? userRisk.riskDetail : null,
            detections: userDetections.slice(0, 10)
        };
    }

    /**
     * Get admin roles for user.
     */
    function getUserAdminRoles(userId) {
        var roles = DataStore.adminRoles || [];
        return roles.filter(function(role) {
            var members = role.members || [];
            return members.some(function(m) { return m.id === userId; });
        }).map(function(role) {
            return {
                displayName: role.displayName,
                description: role.description,
                isBuiltIn: role.isBuiltIn
            };
        });
    }

    /**
     * Get MFA details for user.
     */
    function getUserMfaDetails(userId) {
        buildIndexes();
        var mfa = mfaIndex[userId];
        if (!mfa) {
            return { registered: false, methods: [] };
        }
        return {
            registered: mfa.mfaRegistered || mfa.isMfaRegistered || false,
            methods: mfa.methods || mfa.authMethods || [],
            defaultMethod: mfa.defaultMethod || mfa.defaultMfaMethod || null,
            phoneNumber: mfa.phoneNumber || null,
            isPhishingResistant: mfa.hasPhishingResistantMethod || false
        };
    }

    /**
     * Get teams user is owner/member of.
     */
    function getUserTeams(upn) {
        if (!upn) return [];
        var teams = DataStore.teams || [];
        var upnLower = upn.toLowerCase();

        return teams.filter(function(team) {
            var owners = team.ownerUpns || [];
            return owners.some(function(o) { return o.toLowerCase() === upnLower; });
        }).map(function(team) {
            return {
                id: team.id,
                displayName: team.displayName,
                role: 'owner',
                visibility: team.visibility
            };
        });
    }

    /**
     * Get license details for user (expand SKU names).
     */
    function getUserLicenseDetails(user) {
        var skus = DataStore.licenseSkus || [];
        var userLicenses = user.assignedLicenses || [];
        var skuMap = {};

        skus.forEach(function(sku) {
            skuMap[sku.skuId] = sku;
        });

        return userLicenses.map(function(license) {
            var sku = skuMap[license.skuId] || {};
            return {
                skuId: license.skuId,
                skuPartNumber: sku.skuPartNumber || license.skuId,
                displayName: sku.displayName || sku.skuPartNumber || 'Unknown',
                assignedVia: license.assignedViaGroup ? 'Group' : 'Direct',
                disabledPlans: license.disabledPlans || []
            };
        });
    }

    // ========================================================================
    // DEVICE RELATIONSHIPS
    // ========================================================================

    /**
     * Get complete device profile with all related data.
     * @param {string} deviceId - Device ID or device name
     * @returns {Object} Device with user, vulnerabilities, policies, signIns
     */
    function getDeviceProfile(deviceId) {
        buildIndexes();

        var device = deviceIndex[deviceId] || deviceNameIndex[(deviceId || '').toLowerCase()];
        if (!device) return null;

        return {
            device: device,
            primaryUser: getDeviceUser(device),
            vulnerabilities: getDeviceVulnerabilities(device.deviceName),
            bitlocker: getDeviceBitLocker(device),
            windowsUpdate: getDeviceWindowsUpdate(device),
            signIns: getDeviceSignIns(device.deviceName),
            configProfiles: getDeviceConfigProfiles(device),
            appDeployments: getDeviceApps(device)
        };
    }

    /**
     * Get primary user for device.
     */
    function getDeviceUser(device) {
        if (!device || !device.userId) return null;
        buildIndexes();
        return userIndex[device.userId] || null;
    }

    /**
     * Get vulnerabilities affecting device.
     */
    function getDeviceVulnerabilities(deviceName) {
        if (!deviceName) return [];
        var vulns = DataStore.vulnerabilities || {};
        var vulnList = vulns.vulnerabilities || vulns.items || [];
        var deviceNameLower = deviceName.toLowerCase();

        return vulnList.filter(function(vuln) {
            var affected = vuln.affectedDevices || vuln.affectedDevicesList || [];
            return affected.some(function(d) {
                var name = d.deviceName || d;
                return (name || '').toLowerCase() === deviceNameLower;
            });
        }).map(function(vuln) {
            return {
                id: vuln.id,
                name: vuln.name || vuln.cveId,
                severity: vuln.severity,
                cvssScore: vuln.cvssScore,
                exploitedInWild: vuln.exploitedInWild || vuln.publicExploit,
                patchAvailable: vuln.patchAvailable
            };
        });
    }

    /**
     * Get BitLocker status for device.
     */
    function getDeviceBitLocker(device) {
        var bitlocker = DataStore.bitlockerStatus || {};
        var devices = bitlocker.devices || [];

        var match = devices.find(function(b) {
            return b.deviceId === device.id ||
                   b.deviceName === device.deviceName ||
                   b.azureAdDeviceId === device.azureAdDeviceId;
        });

        if (!match) {
            return {
                encrypted: device.isEncrypted || false,
                recoveryKeyEscrowed: false,
                status: device.isEncrypted ? 'encrypted' : 'not-encrypted'
            };
        }

        return {
            encrypted: match.isEncrypted || match.encryptionState === 'encrypted',
            recoveryKeyEscrowed: match.recoveryKeyEscrowed || match.hasRecoveryKey || false,
            encryptionMethod: match.encryptionMethod,
            status: match.status || (match.isEncrypted ? 'encrypted' : 'not-encrypted')
        };
    }

    /**
     * Get Windows Update status for device.
     */
    function getDeviceWindowsUpdate(device) {
        var updateData = DataStore.windowsUpdateStatus || {};
        var devices = updateData.devices || [];

        var match = devices.find(function(u) {
            return u.deviceId === device.id || u.deviceName === device.deviceName;
        });

        if (!match) {
            return { ring: 'Unknown', status: 'Unknown' };
        }

        return {
            ring: match.updateRing || match.deploymentRing || 'Unknown',
            featureUpdateStatus: match.featureUpdateStatus,
            qualityUpdateStatus: match.qualityUpdateStatus,
            lastScanTime: match.lastScanTime,
            status: match.complianceStatus || match.status || 'Unknown'
        };
    }

    /**
     * Get sign-ins from this device.
     */
    function getDeviceSignIns(deviceName) {
        if (!deviceName) return [];
        var logs = DataStore.signinLogs || [];
        var deviceNameLower = deviceName.toLowerCase();

        return logs.filter(function(log) {
            var detail = log.deviceDetail || {};
            var logDeviceName = detail.displayName || detail.deviceId || '';
            return logDeviceName.toLowerCase().indexOf(deviceNameLower) >= 0;
        }).slice(0, 15);
    }

    /**
     * Get configuration profiles assigned to device.
     */
    function getDeviceConfigProfiles(device) {
        var profiles = DataStore.configurationProfiles || [];
        // This would require per-device status in the profile data
        // For now, return profiles that might target this device
        return [];  // TODO: Implement when profile-device mapping is available
    }

    /**
     * Get app deployments for device.
     */
    function getDeviceApps(device) {
        var apps = DataStore.appDeployments || {};
        var appList = apps.apps || apps.deployments || [];
        // This would require per-device status
        return [];  // TODO: Implement when app-device mapping is available
    }

    // ========================================================================
    // TEAM RELATIONSHIPS
    // ========================================================================

    /**
     * Get complete team profile with SharePoint site.
     */
    function getTeamProfile(teamId) {
        buildIndexes();
        var team = teamIndex[teamId];
        if (!team) return null;

        return {
            team: team,
            sharePointSite: getTeamSharePointSite(team),
            owners: getTeamOwnerDetails(team),
            guestCount: team.guestCount || 0,
            externalDomains: team.externalDomains || []
        };
    }

    /**
     * Get SharePoint site linked to team.
     */
    function getTeamSharePointSite(team) {
        if (!team) return null;
        buildIndexes();

        // Try by linkedSharePointSiteId
        if (team.linkedSharePointSiteId) {
            var site = siteIndex[team.linkedSharePointSiteId];
            if (site) return site;
        }

        // Try by team ID (groupId)
        var siteByGroup = siteGroupIndex[team.id];
        if (siteByGroup) return siteByGroup;

        return null;
    }

    /**
     * Get owner user objects for team.
     */
    function getTeamOwnerDetails(team) {
        if (!team || !team.ownerUpns) return [];
        buildIndexes();

        return team.ownerUpns.map(function(upn) {
            var user = userUpnIndex[upn.toLowerCase()];
            return user || { userPrincipalName: upn, displayName: upn };
        });
    }

    // ========================================================================
    // SHAREPOINT RELATIONSHIPS
    // ========================================================================

    /**
     * Get team linked to SharePoint site.
     */
    function getSiteTeam(siteId) {
        buildIndexes();
        var site = siteIndex[siteId];
        if (!site || !site.groupId) return null;
        return teamIndex[site.groupId] || null;
    }

    // ========================================================================
    // VULNERABILITY RELATIONSHIPS
    // ========================================================================

    /**
     * Get devices affected by vulnerability.
     */
    function getVulnerabilityDevices(vulnId) {
        var vulns = DataStore.vulnerabilities || {};
        var vulnList = vulns.vulnerabilities || vulns.items || [];

        var vuln = vulnList.find(function(v) { return v.id === vulnId; });
        if (!vuln) return [];

        var affected = vuln.affectedDevices || vuln.affectedDevicesList || [];
        buildIndexes();

        return affected.map(function(d) {
            var name = d.deviceName || d;
            var device = deviceNameIndex[(name || '').toLowerCase()];
            return device || { deviceName: name };
        });
    }

    // ========================================================================
    // DEFENDER ALERTS
    // ========================================================================

    /**
     * Get Defender alerts for a device.
     * @param {string} deviceName - Device name
     * @returns {Array} Alerts affecting this device
     */
    function getDeviceAlerts(deviceName) {
        if (!deviceName) return [];
        var alerts = DataStore.defenderAlerts || [];
        var deviceNameLower = deviceName.toLowerCase();

        return alerts.filter(function(alert) {
            var affected = alert.affectedDevice || '';
            return affected.toLowerCase() === deviceNameLower;
        }).sort(function(a, b) {
            return new Date(b.createdDateTime) - new Date(a.createdDateTime);
        });
    }

    /**
     * Get Defender alerts for a user.
     * @param {string} upn - User principal name
     * @returns {Array} Alerts affecting this user
     */
    function getUserAlerts(upn) {
        if (!upn) return [];
        var alerts = DataStore.defenderAlerts || [];
        var upnLower = upn.toLowerCase();

        return alerts.filter(function(alert) {
            var affected = alert.affectedUser || '';
            return affected.toLowerCase() === upnLower;
        }).sort(function(a, b) {
            return new Date(b.createdDateTime) - new Date(a.createdDateTime);
        });
    }

    // ========================================================================
    // ADMIN PORTAL URLS
    // ========================================================================

    /**
     * Get admin portal URLs for a device.
     * @param {Object} device - Device object
     * @returns {Object} URLs for Intune, Entra
     */
    function getDeviceAdminUrls(device) {
        if (!device) return {};
        return {
            intune: device.id ?
                'https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsBlade/deviceId/' + encodeURIComponent(device.id) : null,
            entra: device.azureAdDeviceId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_Devices/DeviceDetailsMenuBlade/deviceId/' + encodeURIComponent(device.azureAdDeviceId) : null
        };
    }

    /**
     * Get admin portal URLs for a user.
     * @param {Object} user - User object
     * @returns {Object} URLs for Entra, Defender
     */
    function getUserAdminUrls(user) {
        if (!user) return {};
        return {
            entra: user.id ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(user.id) : null,
            defender: user.id ?
                'https://security.microsoft.com/users/' + encodeURIComponent(user.id) : null
        };
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        buildIndexes: buildIndexes,

        // User lookups
        getUserProfile: getUserProfile,
        getUserDevices: getUserDevices,
        getUserSignIns: getUserSignIns,
        getUserRisks: getUserRisks,
        getUserAdminRoles: getUserAdminRoles,
        getUserMfaDetails: getUserMfaDetails,
        getUserTeams: getUserTeams,
        getUserLicenseDetails: getUserLicenseDetails,

        // Device lookups
        getDeviceProfile: getDeviceProfile,
        getDeviceUser: getDeviceUser,
        getDeviceVulnerabilities: getDeviceVulnerabilities,
        getDeviceBitLocker: getDeviceBitLocker,
        getDeviceWindowsUpdate: getDeviceWindowsUpdate,
        getDeviceSignIns: getDeviceSignIns,

        // Team lookups
        getTeamProfile: getTeamProfile,
        getTeamSharePointSite: getTeamSharePointSite,
        getTeamOwnerDetails: getTeamOwnerDetails,

        // SharePoint lookups
        getSiteTeam: getSiteTeam,

        // Vulnerability lookups
        getVulnerabilityDevices: getVulnerabilityDevices,

        // Defender alerts
        getDeviceAlerts: getDeviceAlerts,
        getUserAlerts: getUserAlerts,

        // Admin portal URLs
        getDeviceAdminUrls: getDeviceAdminUrls,
        getUserAdminUrls: getUserAdminUrls
    };
})();

// Export for use
if (typeof window !== 'undefined') {
    window.DataRelationships = DataRelationships;
}
