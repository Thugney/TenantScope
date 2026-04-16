/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/tenantscope
 * License: MIT
 * ============================================================================
 *
 * DATA LOADER MODULE
 *
 * Loads all JSON data files from the dashboard/data/ directory into memory.
 * Provides a central data store accessible by all page modules.
 *
 * Usage:
 *   await DataLoader.loadAll();
 *   const users = DataLoader.getData('users');
 */

const DataLoader = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /**
     * Central data store holding all loaded JSON data
     * Key: data type name (e.g., 'users', 'devices')
     * Value: parsed JSON array/object
     */
    const dataStore = {
        // Core identity & licensing
        users: [],
        groups: [],
        licenseSkus: [],
        guests: [],
        mfaStatus: [],
        adminRoles: [],
        deletedUsers: [],
        // Security & risk
        riskySignins: [],
        signinLogs: null,
        defenderAlerts: [],
        defenderDeviceHealth: null,
        deviceHardening: null,
        vulnerabilities: null,
        secureScore: null,
        conditionalAccess: [],
        asrRules: null,
        asrAuditEvents: null,
        oauthConsentGrants: null,
        namedLocations: null,
        identityRisk: null,
        // Device management
        devices: [],
        autopilot: [],
        compliancePolicies: [],
        configurationProfiles: [],
        endpointSecurityStates: null,
        windowsUpdateStatus: null,
        bitlockerStatus: null,
        appDeployments: null,
        endpointAnalytics: null,
        lapsCoverage: null,
        // Applications & governance
        enterpriseApps: [],
        servicePrincipalSecrets: null,
        auditLogs: [],
        pimActivity: [],
        accessReviews: null,
        // Collaboration
        teams: [],
        sharepointSites: [],
        serviceAnnouncements: null,
        appSignins: [],
        // Compliance & data protection
        retentionData: null,
        ediscoveryData: null,
        sensitivityLabels: null,
        // Metadata
        trendHistory: [],
        metadata: null
    };

    /**
     * Collector error map keyed by data type.
     */
    const dataErrors = {};

    /**
     * Mapping of data types to their JSON file paths
     */
    const dataFiles = {
        // Core identity & licensing
        users: 'data/users.json',
        groups: 'data/groups.json',
        licenseSkus: 'data/license-skus.json',
        guests: 'data/guests.json',
        mfaStatus: 'data/mfa-status.json',
        adminRoles: 'data/admin-roles.json',
        deletedUsers: 'data/deleted-users.json',
        // Security & risk
        riskySignins: 'data/risky-signins.json',
        signinLogs: 'data/signin-logs.json',
        defenderAlerts: 'data/defender-alerts.json',
        defenderDeviceHealth: 'data/defender-device-health.json',
        deviceHardening: 'data/device-hardening.json',
        vulnerabilities: 'data/vulnerabilities.json',
        secureScore: 'data/secure-score.json',
        conditionalAccess: 'data/conditional-access.json',
        asrRules: 'data/asr-rules.json',
        asrAuditEvents: 'data/asr-audit-events.json',
        oauthConsentGrants: 'data/oauth-consent-grants.json',
        namedLocations: 'data/named-locations.json',
        identityRisk: 'data/identity-risk-data.json',
        // Device management
        devices: 'data/devices.json',
        autopilot: 'data/autopilot.json',
        compliancePolicies: 'data/compliance-policies.json',
        configurationProfiles: 'data/configuration-profiles.json',
        endpointSecurityStates: 'data/endpoint-security-states.json',
        windowsUpdateStatus: 'data/windows-update-status.json',
        bitlockerStatus: 'data/bitlocker-status.json',
        appDeployments: 'data/app-deployments.json',
        endpointAnalytics: 'data/endpoint-analytics.json',
        lapsCoverage: 'data/laps-coverage.json',
        // Applications & governance
        enterpriseApps: 'data/enterprise-apps.json',
        servicePrincipalSecrets: 'data/service-principal-secrets.json',
        auditLogs: 'data/audit-logs.json',
        pimActivity: 'data/pim-activity.json',
        accessReviews: 'data/access-review-data.json',
        // Collaboration
        teams: 'data/teams.json',
        sharepointSites: 'data/sharepoint-sites.json',
        serviceAnnouncements: 'data/service-announcements.json',
        appSignins: 'data/app-signins.json',
        // Compliance & data protection
        retentionData: 'data/retention-data.json',
        ediscoveryData: 'data/ediscovery-data.json',
        sensitivityLabels: 'data/sensitivity-labels-data.json',
        // Metadata
        trendHistory: 'data/trend-history.json',
        metadata: 'data/collection-metadata.json'
    };

    /** Track loading state */
    let isLoaded = false;
    let loadError = null;

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Fetches and parses a single JSON file.
     *
     * @param {string} url - Path to the JSON file
     * @returns {Promise<any>} Parsed JSON data, or empty array if fetch fails
     */
    async function fetchJSON(url) {
        try {
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`Failed to load ${url}: HTTP ${response.status}`);
                return null;
            }

            const text = await response.text();

            // Handle empty files
            if (!text || text.trim() === '') {
                console.warn(`Empty file: ${url}`);
                return null;
            }

            return JSON.parse(text);
        } catch (error) {
            console.warn(`Error loading ${url}:`, error.message);
            return null;
        }
    }

    /**
     * Builds collector error mapping from collection metadata.
     */
    function buildCollectorErrors() {
        Object.keys(dataErrors).forEach(function(key) {
            delete dataErrors[key];
        });

        const metadata = dataStore.metadata;
        if (!metadata || !Array.isArray(metadata.collectors)) return;

        const outputToType = {};
        Object.entries(dataFiles).forEach(([type, path]) => {
            const file = path.split('/').pop();
            outputToType[file] = type;
        });

        metadata.collectors.forEach(c => {
            if (!c) return;
            const hasErrors = (c.success === false) || (Array.isArray(c.errors) && c.errors.length > 0);
            if (!hasErrors) return;

            const output = c.output || '';
            const type = output ? outputToType[output] : null;
            const entry = {
                name: c.name || 'Unknown Collector',
                output: output || null,
                script: c.script || null,
                errors: Array.isArray(c.errors) ? c.errors : []
            };

            if (type) {
                dataErrors[type] = entry;
            } else {
                dataErrors[c.name || ('collector-' + Object.keys(dataErrors).length)] = entry;
            }
        });
    }

    /**
     * Formats a date string into a readable format.
     *
     * @param {string|null} dateString - ISO 8601 date string
     * @returns {string} Formatted date or '--' if null
     */
    function formatDate(dateString) {
        if (!dateString) return '--';

        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-GB', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '--';
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Loads all data files into the data store.
         * Shows loading overlay while fetching.
         *
         * @returns {Promise<boolean>} True if at least some data loaded
         */
        async loadAll() {
            console.log('DataLoader: Starting data load...');

            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.classList.remove('hidden');
            }

            try {
                // Check for bundled data first (generated by Build-Dashboard.ps1)
                // This bypasses fetch/CORS issues when opening via file:// protocol
                if (window.__M365_DATA) {
                    console.log('DataLoader: Using bundled data (data-bundle.js)');
                    const bundleKeys = Object.keys(window.__M365_DATA);
                    const expectedKeys = Object.keys(dataStore);
                    const missingKeys = expectedKeys.filter(k => !bundleKeys.includes(k));
                    const emptyBundleKeys = [];

                    Object.keys(dataStore).forEach(key => {
                        if (window.__M365_DATA[key] !== undefined) {
                            const bundleData = window.__M365_DATA[key];
                            dataStore[key] = bundleData;

                            // Check for empty data
                            const isEmpty = bundleData === null ||
                                (Array.isArray(bundleData) && bundleData.length === 0) ||
                                (typeof bundleData === 'object' && bundleData !== null && Object.keys(bundleData).length === 0);

                            if (isEmpty) {
                                emptyBundleKeys.push(key);
                            }
                        }
                    });

                    if (missingKeys.length > 0) {
                        console.warn('DataLoader: Bundle missing keys:', missingKeys.join(', '));
                    }
                    if (emptyBundleKeys.length > 0) {
                        console.warn('DataLoader: Bundle has empty data for:', emptyBundleKeys.join(', '));
                    }
                    console.log('DataLoader: Loaded', bundleKeys.length, 'data types from bundle');
                } else {
                    // Fallback: fetch JSON files individually (works over HTTP)
                    console.log('DataLoader: Fetching data files via HTTP...');
                    const loadPromises = Object.entries(dataFiles).map(async ([key, path]) => {
                        const data = await fetchJSON(path);
                        const defaultValue = (dataStore[key] === null) ? null : [];
                        dataStore[key] = (data === null || data === undefined) ? defaultValue : data;
                    });
                    await Promise.all(loadPromises);
                }

                // Post-process nested data structures
                // Data may come in nested format with metadata wrapper (e.g., { metadata: {...}, teams: [...] })
                const normalizeDataArray = (key, nestedKey) => {
                    const data = dataStore[key];
                    if (data && !Array.isArray(data)) {
                        // Log the structure we're trying to normalize
                        const dataKeys = Object.keys(data);
                        console.log(`DataLoader: Normalizing ${key} - object with keys: [${dataKeys.slice(0, 5).join(', ')}${dataKeys.length > 5 ? '...' : ''}]`);

                        // Check for nested array with the same name or common names
                        // Also check if the nested property exists but is empty array (still valid)
                        const targetKey = nestedKey || key;
                        let arrayKey = null;

                        if (targetKey in data && Array.isArray(data[targetKey])) {
                            arrayKey = targetKey;
                        } else if ('items' in data && Array.isArray(data.items)) {
                            arrayKey = 'items';
                        } else if ('value' in data && Array.isArray(data.value)) {
                            arrayKey = 'value';
                        } else if ('data' in data && Array.isArray(data.data)) {
                            arrayKey = 'data';
                        }

                        if (arrayKey) {
                            console.log(`DataLoader: Extracting ${key} from nested structure (${arrayKey}) - ${data[arrayKey].length} items`);
                            dataStore[key] = data[arrayKey];
                        } else {
                            console.warn(`DataLoader: ${key} is not an array and has no extractable array property (keys: ${dataKeys.join(', ')})`);
                            dataStore[key] = [];
                        }
                    }
                };

                // Normalize all expected array data stores (extract arrays from wrapper objects)
                normalizeDataArray('teams', 'teams');
                normalizeDataArray('users', 'users');
                normalizeDataArray('devices', 'devices');
                normalizeDataArray('groups', 'groups');
                normalizeDataArray('guests', 'guests');

                // Ensure object-type data stores have expected structure
                // This handles cases where collectors output different formats
                // Uses aliases to find data under different property names

                // Key aliases - maps expected key to possible alternatives
                const keyAliases = {
                    devices: ['devices', 'deviceList', 'managedDevices', 'items', 'data', 'value'],
                    policies: ['policies', 'policyList', 'compliancePolicies', 'items', 'data', 'value'],
                    profiles: ['profiles', 'configurationProfiles', 'profileList', 'items', 'data', 'value'],
                    apps: ['apps', 'applications', 'appList', 'mobileApps', 'items', 'data', 'value'],
                    users: ['users', 'riskyUsers', 'userList', 'items', 'data', 'value'],
                    riskyUsers: ['riskyUsers', 'users', 'atRiskUsers', 'items', 'data', 'value'],
                    riskDetections: ['riskDetections', 'detections', 'riskEvents', 'items', 'data', 'value'],
                    deviceScores: ['deviceScores', 'scores', 'devices', 'items', 'data', 'value'],
                    devicePerformance: ['devicePerformance', 'performance', 'startupPerformance', 'items', 'data'],
                    batteryHealth: ['batteryHealth', 'batteries', 'batteryStatus', 'items', 'data'],
                    updateRings: ['updateRings', 'rings', 'windowsUpdateRings', 'items', 'data', 'value'],
                    featureUpdates: ['featureUpdates', 'featureUpdatePolicies', 'items', 'data'],
                    qualityUpdates: ['qualityUpdates', 'qualityUpdatePolicies', 'items', 'data'],
                    driverUpdates: ['driverUpdates', 'drivers', 'driverUpdateProfiles', 'items', 'data'],
                    deviceCompliance: ['deviceCompliance', 'complianceDevices', 'devices', 'items', 'data'],
                    grants: ['grants', 'oauthGrants', 'consentGrants', 'items', 'data', 'value'],
                    reviews: ['reviews', 'accessReviews', 'items', 'data', 'value'],
                    cases: ['cases', 'ediscoveryCases', 'items', 'data', 'value'],
                    labels: ['labels', 'sensitivityLabels', 'items', 'data', 'value'],
                    rules: ['rules', 'asrRules', 'attackSurfaceReductionRules', 'items', 'data'],
                    rulesArray: ['rulesArray', 'rules', 'asrRules', 'items', 'data'],
                    events: ['events', 'auditEvents', 'asrEvents', 'items', 'data'],
                    nonCompliantDevices: ['nonCompliantDevices', 'noncompliantDevices', 'failedDevices', 'devices'],
                    settingFailures: ['settingFailures', 'settingStatuses', 'failedSettings'],
                    failedDevices: ['failedDevices', 'failures', 'errorDevices'],
                    insights: ['insights', 'recommendations', 'suggestions'],
                    summary: ['summary', 'overview', 'stats', 'statistics', 'metadata'],
                    overview: ['overview', 'summary', 'stats', 'metadata']
                };

                const ensureObjectStructure = (key, expectedKeys) => {
                    let data = dataStore[key];

                    // Helper to get default value for a key (summary/overview = object, others = array)
                    const getDefault = (k) => {
                        return (k === 'summary' || k === 'overview') ? {} : [];
                    };

                    // Helper to find array data using aliases
                    const findArrayByAliases = (obj, targetKey) => {
                        const aliases = keyAliases[targetKey] || [targetKey];
                        for (const alias of aliases) {
                            if (alias in obj && Array.isArray(obj[alias])) {
                                if (alias !== targetKey) {
                                    console.log(`DataLoader: ${key}.${targetKey} found as ${alias}`);
                                }
                                return obj[alias];
                            }
                        }
                        return null;
                    };

                    // Helper to find object data using aliases
                    const findObjectByAliases = (obj, targetKey) => {
                        const aliases = keyAliases[targetKey] || [targetKey];
                        for (const alias of aliases) {
                            if (alias in obj && typeof obj[alias] === 'object' && !Array.isArray(obj[alias]) && obj[alias] !== null) {
                                if (alias !== targetKey) {
                                    console.log(`DataLoader: ${key}.${targetKey} found as ${alias}`);
                                }
                                return obj[alias];
                            }
                        }
                        return null;
                    };

                    // If null/undefined, create empty structure
                    if (data === null || data === undefined) {
                        const emptyObj = {};
                        expectedKeys.forEach(k => { emptyObj[k] = getDefault(k); });
                        dataStore[key] = emptyObj;
                        console.log(`DataLoader: ${key} was null, created empty structure`);
                        return;
                    }

                    // If array (legacy format), wrap it
                    if (Array.isArray(data)) {
                        const wrappedObj = {};
                        wrappedObj[expectedKeys[0]] = data; // Use first expected key
                        expectedKeys.slice(1).forEach(k => { wrappedObj[k] = getDefault(k); });
                        dataStore[key] = wrappedObj;
                        console.log(`DataLoader: ${key} was array, wrapped as {${expectedKeys[0]}: [${data.length}]}`);
                        return;
                    }

                    // If object, ensure all expected keys exist (using aliases to find data)
                    if (typeof data === 'object') {
                        let modified = false;
                        expectedKeys.forEach(k => {
                            if (!(k in data)) {
                                // Try to find data using aliases
                                const isObjectKey = (k === 'summary' || k === 'overview');
                                const found = isObjectKey ? findObjectByAliases(data, k) : findArrayByAliases(data, k);

                                if (found !== null) {
                                    data[k] = found;
                                } else {
                                    data[k] = getDefault(k);
                                }
                                modified = true;
                            }
                        });
                        if (modified) {
                            console.log(`DataLoader: ${key} structure normalized`);
                        }
                    }
                };

                // Define expected structures for object-type data stores
                // These match what the page extractData functions expect
                ensureObjectStructure('bitlockerStatus', ['devices', 'summary']);
                ensureObjectStructure('compliancePolicies', ['policies', 'nonCompliantDevices', 'settingFailures', 'insights', 'summary']);
                ensureObjectStructure('configurationProfiles', ['profiles', 'deviceStatuses', 'summary']);
                ensureObjectStructure('windowsUpdateStatus', ['updateRings', 'featureUpdates', 'qualityUpdates', 'driverUpdates', 'deviceCompliance', 'summary']);
                ensureObjectStructure('appDeployments', ['apps', 'failedDevices', 'insights', 'summary']);
                ensureObjectStructure('endpointAnalytics', ['deviceScores', 'devicePerformance', 'batteryHealth', 'deviceAppHealth', 'workFromAnywhere', 'overview']);
                ensureObjectStructure('identityRisk', ['riskyUsers', 'riskDetections', 'insights', 'summary']);
                ensureObjectStructure('lapsCoverage', ['devices', 'summary']);
                ensureObjectStructure('defenderDeviceHealth', ['devices', 'summary']);
                ensureObjectStructure('deviceHardening', ['devices', 'summary']);
                ensureObjectStructure('asrRules', ['rulesArray', 'profiles']);
                ensureObjectStructure('asrAuditEvents', ['rules', 'events']);
                ensureObjectStructure('endpointSecurityStates', ['devices', 'policies']);
                ensureObjectStructure('oauthConsentGrants', ['grants']);
                ensureObjectStructure('accessReviews', ['reviews', 'summary']);
                ensureObjectStructure('retentionData', ['policies', 'summary']);
                ensureObjectStructure('ediscoveryData', ['cases', 'summary']);
                ensureObjectStructure('sensitivityLabels', ['labels', 'summary']);

                // Log what was loaded
                Object.entries(dataStore).forEach(([key, data]) => {
                    console.log(`DataLoader: ${key} (${Array.isArray(data) ? data.length + ' items' : (data ? 'object' : 'null')})`);
                });

                // Build collector error map from metadata
                buildCollectorErrors();

                // Build entity index (raw data, no filters)
                if (typeof EntityIndex !== 'undefined' && EntityIndex.buildFromDataLoader) {
                    try {
                        EntityIndex.buildFromDataLoader();
                    } catch (err) {
                        console.warn('DataLoader: Entity index build failed', err.message || err);
                    }
                }

                // Check if any meaningful data was loaded
                const hasData = dataStore.users.length > 0 ||
                    dataStore.devices.length > 0 ||
                    dataStore.guests.length > 0 ||
                    (dataStore.teams && dataStore.teams.length > 0);

                isLoaded = true;
                loadError = null;

                // Update header with last updated time
                this.updateLastUpdated();

                // Notify if any collectors failed
                if (Object.keys(dataErrors).length > 0 && window.Toast) {
                    const failedCount = Object.keys(dataErrors).length;
                    window.Toast.warning(
                        'Collection issues detected',
                        failedCount + ' collector' + (failedCount > 1 ? 's' : '') + ' reported errors. See Overview for details.'
                    );
                }

                if (!hasData) {
                    console.warn('DataLoader: No data found. Run Build-Dashboard.ps1 after data collection.');
                    // Show user-friendly error message
                    this.showNoDataMessage();
                    return false;
                }

                console.log('DataLoader: All data loaded successfully');
                return true;

            } catch (error) {
                console.error('DataLoader: Failed to load data', error);
                loadError = error;
                return false;

            } finally {
                // Hide loading overlay with a slight delay for smooth transition
                setTimeout(() => {
                    if (loadingOverlay) {
                        loadingOverlay.classList.add('hidden');
                    }
                }, 300);
            }
        },

        /**
         * Gets data from the store by type.
         *
         * @param {string} type - Data type key (e.g., 'users', 'devices')
         * @returns {any} The requested data, or empty array if not found
         */
        getData(type) {
            if (!isLoaded) {
                console.warn('DataLoader: Data not yet loaded');
            }
            var data = dataStore[type];
            if (typeof TimeRangeFilter !== 'undefined' && TimeRangeFilter.isActive && TimeRangeFilter.isActive()) {
                try {
                    data = TimeRangeFilter.applyToType(type, data);
                } catch (err) {
                    console.warn('DataLoader: Time range filter failed for', type, err.message || err);
                }
            }
            if (typeof DepartmentFilter !== 'undefined' && DepartmentFilter.isActive && DepartmentFilter.isActive()) {
                try {
                    data = DepartmentFilter.applyToType(type, data);
                } catch (err) {
                    console.warn('DataLoader: Department filter failed for', type, err.message || err);
                }
            }
            return data || [];
        },

        /**
         * Gets raw data without global filters applied.
         *
         * @param {string} type - Data type key
         * @returns {any} Raw data
         */
        getRawData(type) {
            return dataStore[type] || [];
        },

        /**
         * Gets the collection metadata.
         *
         * @returns {object|null} Metadata object or null if not available
         */
        getMetadata() {
            return dataStore.metadata;
        },

        /**
         * Gets collection errors by data type.
         *
         * @param {string} type - Data type key
         * @returns {object|null} Error entry or null
         */
        getDataError(type) {
            return dataErrors[type] || null;
        },

        /**
         * Gets all collection errors.
         *
         * @returns {Array} Array of error entries
         */
        getCollectionErrors() {
            return Object.values(dataErrors);
        },

        /**
         * Checks if data has been loaded.
         *
         * @returns {boolean} True if loadAll() has completed
         */
        isDataLoaded() {
            return isLoaded;
        },

        /**
         * Gets the last load error, if any.
         *
         * @returns {Error|null} The error or null
         */
        getLoadError() {
            return loadError;
        },

        /**
         * Updates the "Last updated" display in the header.
         */
        updateLastUpdated() {
            const lastUpdatedEl = document.getElementById('last-updated');
            const metadata = dataStore.metadata;

            if (lastUpdatedEl && metadata && metadata.endTime) {
                lastUpdatedEl.textContent = `Last updated: ${formatDate(metadata.endTime)}`;
            } else if (lastUpdatedEl) {
                lastUpdatedEl.textContent = 'Last updated: --';
            }
        },

        /**
         * Gets summary statistics from metadata.
         *
         * @returns {object} Summary object with counts
         */
        getSummary() {
            // Always compute from raw data to ensure all fields are present
            const users = Array.isArray(dataStore.users) ? dataStore.users : [];
            const guests = Array.isArray(dataStore.guests) ? dataStore.guests : [];
            const devices = Array.isArray(dataStore.devices) ? dataStore.devices : [];
            const alerts = Array.isArray(this.getData('defenderAlerts')) ? this.getData('defenderAlerts') : [];
            const licenseSkus = Array.isArray(dataStore.licenseSkus) ? dataStore.licenseSkus : [];
            const thresholds = (dataStore.metadata && dataStore.metadata.thresholds) ? dataStore.metadata.thresholds : {};
            const spHighStorageThreshold = (typeof thresholds.highStorageThresholdGB === 'number' && thresholds.highStorageThresholdGB > 0)
                ? thresholds.highStorageThresholdGB
                : 20;
            const serviceAnnouncements = this.getData('serviceAnnouncements') || {};
            const messageCenter = Array.isArray(serviceAnnouncements.messageCenter) ? serviceAnnouncements.messageCenter : [];
            const serviceHealth = Array.isArray(serviceAnnouncements.serviceHealth) ? serviceAnnouncements.serviceHealth : [];
            const healthIssues = serviceHealth.reduce((sum, h) => sum + ((h.issues || []).length), 0);
            const activeHealthIssues = serviceHealth.reduce((sum, h) => sum + ((h.issues || []).filter(i => i.status && i.status.toLowerCase() !== 'resolved').length), 0);

            const compliantDevices = devices.filter(d => d.complianceState === 'compliant').length;
            const staleDevices = devices.filter(d => d.isStale).length;
            const mfaRegistered = users.filter(u => u.mfaRegistered).length;
            const noMfa = users.filter(u => !u.mfaRegistered).length;
            const enabledUsers = users.filter(u => u.accountEnabled !== false).length;
            const enabledUsersWithMfa = users.filter(u => u.accountEnabled !== false && u.mfaRegistered).length;
            const enterpriseApps = Array.isArray(dataStore.enterpriseApps) ? dataStore.enterpriseApps : [];
            const conditionalAccessPolicies = Array.isArray(dataStore.conditionalAccess) ? dataStore.conditionalAccess : [];

            return {
                totalUsers: users.length,
                employeeCount: users.filter(u => u.domain === 'employee').length,
                studentCount: users.filter(u => u.domain === 'student').length,
                otherCount: users.filter(u => u.domain === 'other').length,
                enabledUsers: enabledUsers,
                disabledUsers: users.filter(u => !u.accountEnabled).length,
                inactiveUsers: users.filter(u => u.isInactive).length,
                noMfaUsers: noMfa,
                mfaRegisteredCount: mfaRegistered,
                mfaPct: users.length > 0 ? Math.round((mfaRegistered / users.length) * 100) : 0,
                mfaRegisteredPct: enabledUsers > 0 ? Math.round((enabledUsersWithMfa / enabledUsers) * 100) : 0,
                adminCount: users.filter(u => u.flags && u.flags.includes('admin')).length,
                guestCount: guests.length,
                guestUsers: guests.length,
                staleGuests: guests.filter(g => g.isStale).length,
                totalDevices: devices.length,
                compliantDevices: compliantDevices,
                nonCompliantDevices: devices.filter(d => d.complianceState === 'noncompliant').length,
                noncompliantDevices: devices.filter(d => d.complianceState === 'noncompliant').length,
                unknownDevices: devices.filter(d => d.complianceState !== 'compliant' && d.complianceState !== 'noncompliant').length,
                staleDevices: staleDevices,
                compliancePct: devices.length > 0 ? Math.round((compliantDevices / devices.length) * 100) : 0,
                activeAlerts: alerts.filter(a => a.status !== 'resolved').length,
                totalApps: enterpriseApps.length,
                conditionalAccessPolicies: conditionalAccessPolicies.length,

                // Teams (governance-focused)
                totalTeams: (dataStore.teams || []).length,
                activeTeams: (dataStore.teams || []).filter(t => !t.isInactive).length,
                inactiveTeams: (dataStore.teams || []).filter(t => t.isInactive).length,
                ownerlessTeams: (dataStore.teams || []).filter(t => t.hasNoOwner).length,
                teamsWithGuests: (dataStore.teams || []).filter(t => t.hasGuests).length,
                publicTeams: (dataStore.teams || []).filter(t => t.visibility === 'Public').length,
                privateTeams: (dataStore.teams || []).filter(t => t.visibility === 'Private').length,

                // SharePoint
                totalSites: (dataStore.sharepointSites || []).filter(s => !s.isPersonalSite).length,
                activeSites: (dataStore.sharepointSites || []).filter(s => !s.isInactive && !s.isPersonalSite).length,
                inactiveSites: (dataStore.sharepointSites || []).filter(s => s.isInactive && !s.isPersonalSite).length,
                totalStorageGB: Math.round(((dataStore.sharepointSites || []).reduce((sum, s) => sum + (s.storageUsedGB || 0), 0)) * 10) / 10,
                groupConnectedSites: (dataStore.sharepointSites || []).filter(s => s.isGroupConnected).length,
                highStorageSites: (dataStore.sharepointSites || []).filter(s =>
                    !s.isPersonalSite && ((s.flags && s.flags.includes('high-storage')) || (s.storageUsedGB || 0) >= spHighStorageThreshold)
                ).length,
                externalSharingSites: (dataStore.sharepointSites || []).filter(s => !s.isPersonalSite && s.hasExternalSharing).length,
                anonymousLinkSites: (dataStore.sharepointSites || []).filter(s => !s.isPersonalSite && (s.anonymousLinkCount || 0) > 0).length,
                noLabelSites: (dataStore.sharepointSites || []).filter(s => !s.isPersonalSite && !s.sensitivityLabelId).length,

                // Admin Center (Message Center + Service Health)
                messageCenterCount: messageCenter.length,
                messageCenterHigh: messageCenter.filter(m => (m.severity || '').toLowerCase() === 'high' || (m.severity || '').toLowerCase() === 'critical').length,
                messageCenterActionRequired: messageCenter.filter(m => !!m.actionRequiredByDateTime).length,
                serviceHealthServices: serviceHealth.length,
                serviceHealthIssues: healthIssues,
                serviceHealthActiveIssues: activeHealthIssues,

                // License costs
                totalWasteMonthlyCost: licenseSkus.reduce((sum, l) => sum + (l.wasteMonthlyCost || 0), 0),
                totalWasteAnnualCost: licenseSkus.reduce((sum, l) => sum + (l.wasteMonthlyCost || 0), 0) * 12,
                totalEstimatedMonthlyCost: licenseSkus.reduce((sum, l) => sum + (l.estimatedMonthlyCost || 0), 0),
                currency: (licenseSkus.find(l => l.currency) || {}).currency || 'NOK'
            };
        },

        /**
         * Utility: Format date for display
         */
        formatDate: formatDate,

        /**
         * Shows a user-friendly message when no data is available.
         * Provides clear next steps for the user.
         */
        showNoDataMessage: function() {
            const pageContainer = document.getElementById('page-container');
            if (!pageContainer) return;

            // Clear existing content
            while (pageContainer.firstChild) {
                pageContainer.removeChild(pageContainer.firstChild);
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'error-state';

            const icon = document.createElement('div');
            icon.className = 'error-state-icon';
            icon.textContent = '!';
            wrapper.appendChild(icon);

            const title = document.createElement('h2');
            title.className = 'error-state-title';
            title.textContent = 'No Data Available';
            wrapper.appendChild(title);

            const desc = document.createElement('p');
            desc.className = 'error-state-description';
            desc.textContent = 'The dashboard has no data to display. Please run data collection first.';
            wrapper.appendChild(desc);

            const steps = document.createElement('div');
            steps.className = 'error-state-details';
            steps.style.maxWidth = '500px';
            steps.style.margin = '1rem auto 0';
            steps.style.textAlign = 'left';

            const stepsTitle = document.createElement('strong');
            stepsTitle.textContent = 'To collect data:';
            steps.appendChild(stepsTitle);

            const stepsList = document.createElement('ol');
            stepsList.style.margin = '0.5rem 0 0 1rem';
            stepsList.style.padding = '0';

            var stepItems = [
                'Update config.json with your tenant ID',
                'Run: .\\Invoke-DataCollection.ps1',
                'The dashboard will automatically open when complete'
            ];

            stepItems.forEach(function(text) {
                var li = document.createElement('li');
                li.style.marginBottom = '0.25rem';
                li.textContent = text;
                stepsList.appendChild(li);
            });

            steps.appendChild(stepsList);
            wrapper.appendChild(steps);

            pageContainer.appendChild(wrapper);

            // Also show a toast notification if available
            if (window.Toast) {
                window.Toast.warning(
                    'No data found',
                    'Run Invoke-DataCollection.ps1 to collect tenant data.'
                );
            }
        },

        /**
         * Shows an error state in the page container with details.
         * @param {string} title - Error title
         * @param {string} message - Error message
         * @param {string} details - Technical details (optional)
         */
        showError: function(title, message, details) {
            const pageContainer = document.getElementById('page-container');
            if (!pageContainer) return;

            // Clear existing content
            while (pageContainer.firstChild) {
                pageContainer.removeChild(pageContainer.firstChild);
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'error-state';

            const icon = document.createElement('div');
            icon.className = 'error-state-icon';
            icon.textContent = 'X';
            wrapper.appendChild(icon);

            const titleEl = document.createElement('h2');
            titleEl.className = 'error-state-title';
            titleEl.textContent = title || 'Error';
            wrapper.appendChild(titleEl);

            const desc = document.createElement('p');
            desc.className = 'error-state-description';
            desc.textContent = message || 'An unexpected error occurred.';
            wrapper.appendChild(desc);

            if (details) {
                const detailsEl = document.createElement('pre');
                detailsEl.className = 'error-state-details';
                detailsEl.textContent = details;
                wrapper.appendChild(detailsEl);
            }

            pageContainer.appendChild(wrapper);

            // Also show a toast notification if available
            if (window.Toast) {
                window.Toast.error(title || 'Error', message);
            }
        },

        /**
         * Diagnoses data loading issues by showing structure of all data stores.
         * Call from browser console: DataLoader.diagnoseData()
         *
         * @returns {object} Diagnostic report object
         */
        diagnoseData() {
            console.log('=== DataLoader Diagnostic Report ===');
            console.log('Data loaded:', isLoaded);
            console.log('Load error:', loadError);
            console.log('');

            const report = {
                isLoaded: isLoaded,
                loadError: loadError,
                dataTypes: {},
                emptyArrays: [],
                nullValues: [],
                objectsWithData: [],
                collectorsWithErrors: Object.keys(dataErrors)
            };

            // Analyze each data store
            Object.entries(dataStore).forEach(([key, data]) => {
                let status = 'unknown';
                let details = '';

                if (data === null) {
                    status = 'null';
                    report.nullValues.push(key);
                } else if (data === undefined) {
                    status = 'undefined';
                } else if (Array.isArray(data)) {
                    status = data.length === 0 ? 'empty-array' : 'array';
                    details = data.length + ' items';
                    if (data.length === 0) {
                        report.emptyArrays.push(key);
                    }
                } else if (typeof data === 'object') {
                    const keys = Object.keys(data);
                    status = 'object';
                    details = 'keys: ' + keys.slice(0, 5).join(', ') + (keys.length > 5 ? '...' : '');

                    // Check for nested arrays
                    const arrayKeys = keys.filter(k => Array.isArray(data[k]));
                    if (arrayKeys.length > 0) {
                        const arraySizes = arrayKeys.map(k => k + '=' + data[k].length).join(', ');
                        details += ' | arrays: ' + arraySizes;
                    }

                    // Check if object has any meaningful data
                    const hasData = keys.some(k => {
                        const v = data[k];
                        if (Array.isArray(v)) return v.length > 0;
                        if (typeof v === 'object' && v !== null) return Object.keys(v).length > 0;
                        return v !== null && v !== undefined;
                    });

                    if (hasData) {
                        report.objectsWithData.push(key);
                    }
                }

                report.dataTypes[key] = { status, details };

                const icon = status === 'array' || status === 'object' ? '✓' :
                            status === 'empty-array' || status === 'null' ? '⚠' : '✗';
                console.log(`${icon} ${key}: ${status} ${details ? '(' + details + ')' : ''}`);
            });

            console.log('');
            console.log('=== Summary ===');
            console.log('Empty arrays:', report.emptyArrays.length > 0 ? report.emptyArrays.join(', ') : 'none');
            console.log('Null values:', report.nullValues.length > 0 ? report.nullValues.join(', ') : 'none');
            console.log('Objects with data:', report.objectsWithData.length > 0 ? report.objectsWithData.join(', ') : 'none');
            console.log('Collectors with errors:', report.collectorsWithErrors.length > 0 ? report.collectorsWithErrors.join(', ') : 'none');
            console.log('');
            console.log('Tip: If you see empty arrays for data that should exist, check:');
            console.log('  1. Collection metadata for errors: DataLoader.getMetadata()');
            console.log('  2. Collector errors: DataLoader.getCollectionErrors()');
            console.log('  3. Raw data: DataLoader.getRawData("dataType")');

            return report;
        },

        /**
         * Inspects a specific data type in detail.
         * Call from browser console: DataLoader.inspectData('bitlockerStatus')
         *
         * @param {string} type - Data type key to inspect
         * @returns {object} Detailed structure info
         */
        inspectData(type) {
            const data = dataStore[type];
            console.log(`=== Inspecting: ${type} ===`);

            if (data === null) {
                console.log('Value: null');
                return { type, value: null };
            }

            if (data === undefined) {
                console.log('Value: undefined');
                return { type, value: undefined };
            }

            if (Array.isArray(data)) {
                console.log('Type: Array');
                console.log('Length:', data.length);
                if (data.length > 0) {
                    console.log('First item keys:', Object.keys(data[0]).join(', '));
                    console.log('Sample item:', JSON.stringify(data[0], null, 2).slice(0, 500));
                }
                return { type, isArray: true, length: data.length, sample: data[0] };
            }

            if (typeof data === 'object') {
                const keys = Object.keys(data);
                console.log('Type: Object');
                console.log('Keys:', keys.join(', '));

                // Analyze each key
                keys.forEach(key => {
                    const value = data[key];
                    if (Array.isArray(value)) {
                        console.log(`  ${key}: Array[${value.length}]`);
                        if (value.length > 0) {
                            console.log(`    First item keys: ${Object.keys(value[0]).join(', ')}`);
                        }
                    } else if (typeof value === 'object' && value !== null) {
                        console.log(`  ${key}: Object {${Object.keys(value).slice(0, 5).join(', ')}${Object.keys(value).length > 5 ? '...' : ''}}`);
                    } else {
                        const displayValue = typeof value === 'string' && value.length > 50
                            ? value.slice(0, 50) + '...'
                            : value;
                        console.log(`  ${key}: ${typeof value} = ${displayValue}`);
                    }
                });

                return { type, isObject: true, keys, structure: data };
            }

            console.log('Value:', data);
            return { type, value: data };
        }
    };

})();

// Export for use in other modules
window.DataLoader = DataLoader;

