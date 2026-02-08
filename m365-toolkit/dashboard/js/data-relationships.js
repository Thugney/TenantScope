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
                   b.id === device.id ||
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

        // Extract volume types from recovery keys
        var recoveryKeys = match.recoveryKeys || [];
        var volumeTypes = recoveryKeys.map(function(k) { return k.volumeType || 'Unknown'; });

        return {
            encrypted: match.isEncrypted || match.encryptionState === 'encrypted',
            encryptionState: match.encryptionState,
            recoveryKeyEscrowed: match.recoveryKeyEscrowed || match.hasRecoveryKey || false,
            recoveryKeyCount: match.recoveryKeyCount || recoveryKeys.length || 0,
            recoveryKeys: recoveryKeys,
            volumeTypes: volumeTypes,
            encryptionMethod: match.encryptionMethod,
            needsEncryption: match.needsEncryption || false,
            complianceState: match.complianceState,
            lastSyncDateTime: match.lastSyncDateTime,
            status: match.encryptionState || match.status || (match.isEncrypted ? 'encrypted' : 'not-encrypted')
        };
    }

    /**
     * Get Windows Update status for device.
     */
    function getDeviceWindowsUpdate(device) {
        var updateData = DataStore.windowsUpdateStatus || {};
        // Check both devices and deviceCompliance arrays (collector uses deviceCompliance)
        var devices = updateData.deviceCompliance || updateData.devices || [];

        var match = devices.find(function(u) {
            return u.deviceId === device.id || u.deviceName === device.deviceName;
        });

        if (!match) {
            return { ring: 'Unknown', status: 'Unknown' };
        }

        return {
            ring: match.updateRing || match.deploymentRing || 'Unknown',
            ringAssignments: match.updateRingAssignments || [],
            featureUpdateStatus: match.featureUpdateStatus,
            featureUpdateVersion: match.featureUpdateVersion,
            qualityUpdateStatus: match.qualityUpdateStatus,
            lastScanTime: match.lastScanTime || match.lastSyncDateTime,
            status: match.updateStatus || match.complianceStatus || match.status || 'Unknown',
            statusSource: match.updateStatusSource,
            pendingUpdates: match.pendingUpdates || 0,
            failedUpdates: match.failedUpdates || 0,
            errorDetails: match.errorDetails
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
        var deviceId = device.id || '';
        var azureAdDeviceId = device.azureAdDeviceId || '';
        return {
            intune: deviceId ?
                'https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsBlade/deviceId/' + encodeURIComponent(deviceId) : null,
            intuneCompliance: deviceId ?
                'https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsBlade/deviceId/' + encodeURIComponent(deviceId) + '/complianceState' : null,
            intuneSync: deviceId ?
                'https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsBlade/deviceId/' + encodeURIComponent(deviceId) + '/sync' : null,
            intuneBitLocker: deviceId ?
                'https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsBlade/deviceId/' + encodeURIComponent(deviceId) + '/bitLockerKeys' : null,
            entra: azureAdDeviceId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_Devices/DeviceDetailsMenuBlade/deviceId/' + encodeURIComponent(azureAdDeviceId) : null,
            defender: device.deviceName ?
                'https://security.microsoft.com/machines/' + encodeURIComponent(device.deviceName) : null
        };
    }

    /**
     * Get admin portal URLs for a user.
     * @param {Object} user - User object
     * @returns {Object} URLs for Entra, Defender
     */
    function getUserAdminUrls(user) {
        if (!user) return {};
        var userId = user.id || '';
        var upn = user.userPrincipalName || '';
        return {
            entra: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) : null,
            entraAuth: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) + '/AuthenticationMethods' : null,
            entraDevices: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) + '/Devices' : null,
            entraGroups: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) + '/Groups' : null,
            entraRoles: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) + '/DirectoryRoles' : null,
            defender: userId ?
                'https://security.microsoft.com/users/' + encodeURIComponent(userId) : null,
            pim: userId ?
                'https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/provider/aadroles' : null,
            resetPassword: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) + '/ResetPassword' : null,
            revokeAccess: userId ?
                'https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/userId/' + encodeURIComponent(userId) + '/SignInActivity' : null
        };
    }

    // ========================================================================
    // CONDITIONAL ACCESS
    // ========================================================================

    /**
     * Get Conditional Access policies that apply to a user.
     * @param {Object} user - User object
     * @param {Array} userAdminRoles - Admin roles the user has
     * @returns {Array} Policies that apply to this user
     */
    function getUserConditionalAccessPolicies(user, userAdminRoles) {
        if (!user) return [];
        var policies = DataStore.conditionalAccess || [];
        userAdminRoles = userAdminRoles || [];

        // Get user's role IDs for matching
        var userRoleIds = userAdminRoles.map(function(r) {
            return r.roleId || r.id || '';
        });

        return policies.filter(function(policy) {
            // Only consider enabled policies
            if (policy.state !== 'enabled') return false;

            // Check if user is explicitly excluded
            var excludedIds = policy.excludedUserIds || [];
            if (excludedIds.indexOf(user.id) >= 0) return false;

            // Policy applies if:
            // 1. includesAllUsers is true
            if (policy.includesAllUsers) return true;

            // 2. User has a role that's included
            var includedRoles = policy.includedRoleIds || [];
            if (includedRoles.length > 0) {
                var hasMatchingRole = userRoleIds.some(function(roleId) {
                    return includedRoles.indexOf(roleId) >= 0;
                });
                if (hasMatchingRole) return true;
            }

            // Note: We can't check group membership without additional data
            // Policy might apply via group but we can't determine that here

            return false;
        }).map(function(policy) {
            return {
                id: policy.id,
                displayName: policy.displayName,
                state: policy.state,
                requiresMfa: policy.requiresMfa,
                requiresCompliantDevice: policy.requiresCompliantDevice,
                blockAccess: policy.blockAccess,
                blocksLegacyAuth: policy.blocksLegacyAuth,
                policyType: policy.policyType
            };
        });
    }

    // ========================================================================
    // ASR RULES
    // ========================================================================

    /**
     * Get ASR policies summary for a Windows device.
     * Note: ASR policies are applied tenant-wide via Intune, not per-device.
     * Returns deployed ASR rules that would apply to managed Windows devices.
     */
    function getDeviceAsrPolicies() {
        var asrData = DataStore.asrRules || {};
        var policies = asrData.policies || [];
        var rulesArray = asrData.rulesArray || [];

        // Get deployed rules (have at least one policy using them)
        var deployedRules = rulesArray.filter(function(r) { return r.isDeployed; });

        return {
            policies: policies.filter(function(p) { return p.isAssigned; }),
            deployedRules: deployedRules,
            totalRules: rulesArray.length,
            deployedCount: deployedRules.length
        };
    }

    // ========================================================================
    // AUTOPILOT
    // ========================================================================

    /**
     * Get Autopilot info for a device by serial number.
     * @param {Object} device - Device object with serialNumber
     * @returns {Object|null} Autopilot record or null
     */
    function getDeviceAutopilot(device) {
        if (!device || !device.serialNumber) return null;
        var autopilotDevices = DataStore.autopilot || [];
        var serialLower = device.serialNumber.toLowerCase();

        return autopilotDevices.find(function(ap) {
            return ap.serialNumber && ap.serialNumber.toLowerCase() === serialLower;
        }) || null;
    }

    // ========================================================================
    // OAUTH CONSENT GRANTS
    // ========================================================================

    /**
     * Get OAuth consent grants for a user.
     * Includes admin-consented apps (AllPrincipals) and user-specific consents.
     * @param {Object} user - User object
     * @returns {Array} Consent grants affecting this user
     */
    function getUserOAuthConsents(user) {
        if (!user) return [];
        var consentData = DataStore.oauthConsentGrants || {};
        var grants = consentData.grants || [];

        return grants.filter(function(grant) {
            // Admin consent applies to all users
            if (grant.consentType === 'AllPrincipals') return true;
            // User-specific consent
            if (grant.principalId === user.id) return true;
            return false;
        }).map(function(grant) {
            return {
                appDisplayName: grant.appDisplayName,
                appPublisher: grant.appPublisher,
                isVerifiedPublisher: grant.isVerifiedPublisher,
                consentType: grant.consentType === 'AllPrincipals' ? 'Admin Consent' : 'User Consent',
                riskLevel: grant.riskLevel,
                scopeCount: grant.scopeCount,
                highRiskScopes: grant.highRiskScopes || [],
                grantedDateTime: grant.grantedDateTime
            };
        });
    }

    // ========================================================================
    // AUDIT LOGS
    // ========================================================================

    /**
     * Get audit logs where user was the initiator or target.
     * @param {Object} user - User object
     * @returns {Array} Audit log entries (most recent 15)
     */
    function getUserAuditLogs(user) {
        if (!user) return [];
        var logs = DataStore.auditLogs || [];
        var upn = (user.userPrincipalName || '').toLowerCase();

        return logs.filter(function(log) {
            var initiator = (log.initiatedBy || '').toLowerCase();
            var target = (log.targetResource || '').toLowerCase();
            return initiator === upn || target === upn;
        }).sort(function(a, b) {
            return new Date(b.activityDateTime) - new Date(a.activityDateTime);
        }).slice(0, 15);
    }

    // ========================================================================
    // CONFIGURATION PROFILES
    // ========================================================================

    /**
     * Get configuration profiles assigned to a device with deployment status.
     * @param {string} deviceName - Device name
     * @returns {Object} Object with profiles array and failed profiles
     */
    function getDeviceConfigProfiles(deviceName) {
        if (!deviceName) return { profiles: [], failedProfiles: [], successCount: 0, failedCount: 0 };

        var configData = DataStore.configurationProfiles || {};
        var profiles = configData.profiles || [];
        var failedDevices = configData.failedDevices || [];
        var deviceNameLower = deviceName.toLowerCase();

        // Find this device in failedDevices list
        var deviceFailure = failedDevices.find(function(d) {
            return (d.deviceName || '').toLowerCase() === deviceNameLower;
        });

        var failedProfileNames = deviceFailure ? (deviceFailure.failedProfiles || []) : [];

        // Get profiles that apply to this device (checking deviceStatuses)
        var deviceProfiles = [];
        profiles.forEach(function(profile) {
            var deviceStatuses = profile.deviceStatuses || [];
            var deviceStatus = deviceStatuses.find(function(ds) {
                return (ds.deviceName || '').toLowerCase() === deviceNameLower;
            });

            if (deviceStatus) {
                deviceProfiles.push({
                    id: profile.id,
                    displayName: profile.displayName,
                    profileType: profile.profileType,
                    platform: profile.platform,
                    category: profile.category,
                    status: deviceStatus.status,
                    lastReported: deviceStatus.lastReportedDateTime,
                    hasError: deviceStatus.status === 'error',
                    hasConflict: deviceStatus.status === 'conflict'
                });
            }
        });

        // Also add profiles from failedProfiles list that weren't in deviceStatuses
        failedProfileNames.forEach(function(profileName) {
            var alreadyAdded = deviceProfiles.some(function(p) {
                return p.displayName === profileName;
            });
            if (!alreadyAdded) {
                var profile = profiles.find(function(p) { return p.displayName === profileName; });
                if (profile) {
                    deviceProfiles.push({
                        id: profile.id,
                        displayName: profile.displayName,
                        profileType: profile.profileType,
                        platform: profile.platform,
                        category: profile.category,
                        status: 'failed',
                        lastReported: null,
                        hasError: true,
                        hasConflict: false
                    });
                }
            }
        });

        var failedCount = deviceProfiles.filter(function(p) { return p.hasError || p.hasConflict; }).length;
        var successCount = deviceProfiles.length - failedCount;

        return {
            profiles: deviceProfiles,
            failedProfiles: failedProfileNames,
            successCount: successCount,
            failedCount: failedCount,
            totalCount: deviceProfiles.length
        };
    }

    // ========================================================================
    // APP DEPLOYMENTS
    // ========================================================================

    /**
     * Get app deployments for a device with installation status.
     * @param {string} deviceName - Device name
     * @returns {Object} Object with apps array and failed apps
     */
    function getDeviceAppDeployments(deviceName) {
        if (!deviceName) return { apps: [], failedApps: [], installedCount: 0, failedCount: 0 };

        var appData = DataStore.appDeployments || {};
        var apps = appData.apps || [];
        var failedDevices = appData.failedDevices || [];
        var deviceNameLower = deviceName.toLowerCase();

        // Find this device in failedDevices list
        var deviceFailure = failedDevices.find(function(d) {
            return (d.deviceName || '').toLowerCase() === deviceNameLower;
        });

        var failedAppNames = deviceFailure ? (deviceFailure.failedApps || []) : [];

        // Get apps with status for this device
        var deviceApps = [];
        apps.forEach(function(app) {
            var deviceStatuses = app.deviceStatuses || [];
            var deviceStatus = deviceStatuses.find(function(ds) {
                return (ds.deviceName || '').toLowerCase() === deviceNameLower;
            });

            if (deviceStatus) {
                deviceApps.push({
                    id: app.id,
                    displayName: app.displayName,
                    publisher: app.publisher,
                    appType: app.appType,
                    version: app.version,
                    installState: deviceStatus.installState,
                    installStateDetail: deviceStatus.installStateDetail,
                    errorCode: deviceStatus.errorCode,
                    lastSync: deviceStatus.lastSyncDateTime,
                    isFailed: deviceStatus.installState === 'failed'
                });
            }
        });

        // Also add apps from failedApps list that weren't in deviceStatuses
        failedAppNames.forEach(function(appName) {
            var alreadyAdded = deviceApps.some(function(a) {
                return a.displayName === appName;
            });
            if (!alreadyAdded) {
                var app = apps.find(function(a) { return a.displayName === appName; });
                if (app) {
                    deviceApps.push({
                        id: app.id,
                        displayName: app.displayName,
                        publisher: app.publisher,
                        appType: app.appType,
                        version: app.version,
                        installState: 'failed',
                        installStateDetail: 'Failed',
                        errorCode: null,
                        lastSync: null,
                        isFailed: true
                    });
                }
            }
        });

        var failedCount = deviceApps.filter(function(a) { return a.isFailed; }).length;
        var installedCount = deviceApps.length - failedCount;

        return {
            apps: deviceApps,
            failedApps: failedAppNames,
            installedCount: installedCount,
            failedCount: failedCount,
            totalCount: deviceApps.length
        };
    }

    // ========================================================================
    // COMPLIANCE POLICY DETAILS
    // ========================================================================

    /**
     * Get compliance policies for a device with failure reasons.
     * @param {string} deviceName - Device name
     * @returns {Object} Object with policies array and failed settings
     */
    function getDeviceCompliancePolicies(deviceName) {
        if (!deviceName) return { policies: [], failedSettings: [], compliantCount: 0, nonCompliantCount: 0 };

        var complianceData = DataStore.compliancePolicies || {};
        var policies = complianceData.policies || [];
        var nonCompliantDevices = complianceData.nonCompliantDevices || [];
        var settingFailures = complianceData.settingFailures || [];
        var deviceNameLower = deviceName.toLowerCase();

        // Find this device in nonCompliantDevices list
        var deviceNonCompliance = nonCompliantDevices.find(function(d) {
            return (d.deviceName || '').toLowerCase() === deviceNameLower;
        });

        var failedPolicyNames = deviceNonCompliance ? (deviceNonCompliance.failedPolicies || []) : [];

        // Get policies with status for this device
        var devicePolicies = [];
        policies.forEach(function(policy) {
            var deviceStatuses = policy.deviceStatuses || [];
            var deviceStatus = deviceStatuses.find(function(ds) {
                return (ds.deviceName || '').toLowerCase() === deviceNameLower;
            });

            // Get setting failures for this policy
            var policySettingFailures = [];
            if (policy.settingStatuses) {
                policy.settingStatuses.forEach(function(ss) {
                    if (ss.nonCompliantDeviceCount > 0 || ss.errorDeviceCount > 0) {
                        policySettingFailures.push({
                            settingName: ss.settingName,
                            nonCompliant: ss.nonCompliantDeviceCount,
                            error: ss.errorDeviceCount
                        });
                    }
                });
            }

            var isNonCompliant = failedPolicyNames.indexOf(policy.displayName) >= 0;
            var status = deviceStatus ? deviceStatus.status : (isNonCompliant ? 'nonCompliant' : 'compliant');

            devicePolicies.push({
                id: policy.id,
                displayName: policy.displayName,
                platform: policy.platform,
                category: policy.category,
                isCritical: policy.isCritical,
                status: status,
                lastReported: deviceStatus ? deviceStatus.lastReportedDateTime : null,
                isNonCompliant: status === 'nonCompliant',
                isError: status === 'error',
                settingFailures: policySettingFailures
            });
        });

        var nonCompliantCount = devicePolicies.filter(function(p) { return p.isNonCompliant || p.isError; }).length;
        var compliantCount = devicePolicies.length - nonCompliantCount;

        return {
            policies: devicePolicies,
            failedPolicies: failedPolicyNames,
            compliantCount: compliantCount,
            nonCompliantCount: nonCompliantCount,
            totalCount: devicePolicies.length
        };
    }

    // ========================================================================
    // USER DIRECT REPORTS
    // ========================================================================

    /**
     * Get users who report to this user (direct reports).
     * Computed from manager relationships in user data.
     * @param {Object} user - User object
     * @returns {Array} Array of direct report user objects
     */
    function getUserDirectReports(user) {
        if (!user || !user.id) return [];

        var users = DataStore.getAllUsers ? DataStore.getAllUsers() : (DataStore.users || []);

        return users.filter(function(u) {
            return u.managerId === user.id;
        }).map(function(u) {
            return {
                id: u.id,
                displayName: u.displayName,
                userPrincipalName: u.userPrincipalName,
                jobTitle: u.jobTitle,
                department: u.department,
                mail: u.mail
            };
        });
    }

    /**
     * Get manager chain for a user (upward hierarchy).
     * @param {Object} user - User object
     * @returns {Array} Array of manager objects in order (direct manager first)
     */
    function getUserManagerChain(user) {
        if (!user) return [];
        buildIndexes();

        var chain = [];
        var currentUser = user;
        var maxDepth = 10; // Prevent infinite loops

        while (currentUser && currentUser.managerId && chain.length < maxDepth) {
            var manager = userIndex[currentUser.managerId];
            if (!manager) break;

            chain.push({
                id: manager.id,
                displayName: manager.displayName,
                userPrincipalName: manager.userPrincipalName,
                jobTitle: manager.jobTitle,
                department: manager.department
            });

            currentUser = manager;
        }

        return chain;
    }

    // ========================================================================
    // ENDPOINT ANALYTICS
    // ========================================================================

    /**
     * Get endpoint analytics data for a device.
     * @param {string} deviceName - Device name
     * @returns {Object|null} Endpoint analytics scores or null if not found
     */
    function getDeviceEndpointAnalytics(deviceName) {
        if (!deviceName) return null;

        var analyticsData = DataStore.endpointAnalytics || {};
        var deviceScores = analyticsData.deviceScores || [];
        var devicePerformance = analyticsData.devicePerformance || [];
        var deviceNameLower = deviceName.toLowerCase();

        // Find device in scores
        var deviceScore = deviceScores.find(function(d) {
            return (d.deviceName || '').toLowerCase() === deviceNameLower;
        });

        // Find device in performance data
        var devicePerf = devicePerformance.find(function(d) {
            return (d.deviceName || '').toLowerCase() === deviceNameLower;
        });

        if (!deviceScore && !devicePerf) return null;

        return {
            // Health scores
            endpointAnalyticsScore: deviceScore ? deviceScore.endpointAnalyticsScore : null,
            startupPerformanceScore: deviceScore ? deviceScore.startupPerformanceScore : null,
            appReliabilityScore: deviceScore ? deviceScore.appReliabilityScore : null,
            workFromAnywhereScore: deviceScore ? deviceScore.workFromAnywhereScore : null,
            healthStatus: deviceScore ? deviceScore.healthStatus : null,
            needsAttention: deviceScore ? deviceScore.needsAttention : false,
            manufacturer: deviceScore ? deviceScore.manufacturer : null,
            model: deviceScore ? deviceScore.model : null,

            // Performance metrics (if available)
            coreBootTimeInMs: devicePerf ? devicePerf.coreBootTimeInMs : null,
            loginTimeInMs: devicePerf ? devicePerf.loginTimeInMs : null,
            restartCount: devicePerf ? devicePerf.restartCount : null,
            blueScreenCount: devicePerf ? devicePerf.blueScreenCount : null,
            bootScore: devicePerf ? devicePerf.bootScore : null,
            loginScore: devicePerf ? devicePerf.loginScore : null
        };
    }

    // ========================================================================
    // RISKY SIGN-INS
    // ========================================================================

    /**
     * Get risky sign-ins for a user.
     * @param {Object} user - User object
     * @returns {Array} Array of risky sign-ins (high/medium risk)
     */
    function getUserRiskySignins(user) {
        if (!user) return [];
        var logs = DataStore.signinLogs || [];
        var upn = (user.userPrincipalName || '').toLowerCase();

        return logs.filter(function(log) {
            var logUpn = (log.userPrincipalName || '').toLowerCase();
            if (logUpn !== upn) return false;
            var risk = (log.riskLevel || '').toLowerCase();
            return risk === 'high' || risk === 'medium';
        }).sort(function(a, b) {
            return new Date(b.createdDateTime) - new Date(a.createdDateTime);
        }).slice(0, 20).map(function(log) {
            return {
                id: log.id,
                createdDateTime: log.createdDateTime,
                appDisplayName: log.appDisplayName,
                riskLevel: log.riskLevel,
                riskState: log.riskState,
                riskEventTypes: log.riskEventTypes || [],
                ipAddress: log.ipAddress,
                location: log.location,
                status: log.status,
                mfaSatisfied: log.mfaSatisfied
            };
        });
    }

    // ========================================================================
    // PIM ACTIVITY
    // ========================================================================

    /**
     * Get PIM (Privileged Identity Management) activity for a user.
     * @param {Object} user - User object
     * @returns {Object} Object with eligible roles and activation history
     */
    function getUserPimActivity(user) {
        if (!user || !user.userPrincipalName) return { eligibleRoles: [], activations: [], pendingApprovals: [] };

        var pimData = DataStore.pimActivity || [];
        var upnLower = user.userPrincipalName.toLowerCase();

        // Filter by user
        var userPimRecords = pimData.filter(function(p) {
            return (p.principalUpn || '').toLowerCase() === upnLower;
        });

        // Separate into categories
        var eligibleRoles = userPimRecords.filter(function(p) {
            return p.isEligible === true || p.entryType === 'eligible';
        });

        var activations = userPimRecords.filter(function(p) {
            return p.action === 'selfActivate' && p.status === 'Provisioned';
        }).sort(function(a, b) {
            return new Date(b.createdDateTime) - new Date(a.createdDateTime);
        });

        var pendingApprovals = userPimRecords.filter(function(p) {
            return p.status === 'PendingApproval';
        });

        return {
            eligibleRoles: eligibleRoles.map(function(r) {
                return {
                    roleName: r.roleName,
                    status: r.status,
                    startDateTime: r.scheduleStartDateTime,
                    endDateTime: r.scheduleEndDateTime
                };
            }),
            activations: activations.slice(0, 10).map(function(a) {
                return {
                    roleName: a.roleName,
                    createdDateTime: a.createdDateTime,
                    justification: a.justification,
                    startDateTime: a.scheduleStartDateTime,
                    endDateTime: a.scheduleEndDateTime,
                    status: a.status
                };
            }),
            pendingApprovals: pendingApprovals.map(function(p) {
                return {
                    roleName: p.roleName,
                    justification: p.justification,
                    createdDateTime: p.createdDateTime
                };
            }),
            totalEligible: eligibleRoles.length,
            totalActivations: activations.length,
            hasPendingApprovals: pendingApprovals.length > 0
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
        getUserAdminUrls: getUserAdminUrls,

        // Conditional Access
        getUserConditionalAccessPolicies: getUserConditionalAccessPolicies,

        // ASR Rules
        getDeviceAsrPolicies: getDeviceAsrPolicies,

        // Autopilot
        getDeviceAutopilot: getDeviceAutopilot,

        // OAuth Consent
        getUserOAuthConsents: getUserOAuthConsents,

        // Audit Logs
        getUserAuditLogs: getUserAuditLogs,

        // Configuration Profiles
        getDeviceConfigProfiles: getDeviceConfigProfiles,

        // App Deployments
        getDeviceAppDeployments: getDeviceAppDeployments,

        // Compliance Policies
        getDeviceCompliancePolicies: getDeviceCompliancePolicies,

        // User Hierarchy
        getUserDirectReports: getUserDirectReports,
        getUserManagerChain: getUserManagerChain,

        // Endpoint Analytics
        getDeviceEndpointAnalytics: getDeviceEndpointAnalytics,

        // PIM Activity
        getUserPimActivity: getUserPimActivity,

        // Risky Sign-Ins
        getUserRiskySignins: getUserRiskySignins
    };
})();

// Export for use
if (typeof window !== 'undefined') {
    window.DataRelationships = DataRelationships;
}
