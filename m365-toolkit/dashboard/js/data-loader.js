/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
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
        licenseSkus: [],
        guests: [],
        mfaStatus: [],
        adminRoles: [],
        deletedUsers: [],
        // Security & risk
        riskySignins: [],
        signinLogs: null,
        defenderAlerts: [],
        vulnerabilities: null,
        secureScore: null,
        conditionalAccess: [],
        asrRules: null,
        oauthConsentGrants: null,
        namedLocations: null,
        identityRisk: null,
        // Device management
        devices: [],
        autopilot: [],
        compliancePolicies: [],
        configurationProfiles: [],
        windowsUpdateStatus: null,
        bitlockerStatus: null,
        appDeployments: null,
        endpointAnalytics: null,
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
     * Mapping of data types to their JSON file paths
     */
    const dataFiles = {
        // Core identity & licensing
        users: 'data/users.json',
        licenseSkus: 'data/license-skus.json',
        guests: 'data/guests.json',
        mfaStatus: 'data/mfa-status.json',
        adminRoles: 'data/admin-roles.json',
        deletedUsers: 'data/deleted-users.json',
        // Security & risk
        riskySignins: 'data/risky-signins.json',
        signinLogs: 'data/signin-logs.json',
        defenderAlerts: 'data/defender-alerts.json',
        vulnerabilities: 'data/vulnerabilities.json',
        secureScore: 'data/secure-score.json',
        conditionalAccess: 'data/conditional-access.json',
        asrRules: 'data/asr-rules.json',
        oauthConsentGrants: 'data/oauth-consent-grants.json',
        namedLocations: 'data/named-locations.json',
        identityRisk: 'data/identity-risk-data.json',
        // Device management
        devices: 'data/devices.json',
        autopilot: 'data/autopilot.json',
        compliancePolicies: 'data/compliance-policies.json',
        configurationProfiles: 'data/configuration-profiles.json',
        windowsUpdateStatus: 'data/windows-update-status.json',
        bitlockerStatus: 'data/bitlocker-status.json',
        appDeployments: 'data/app-deployments.json',
        endpointAnalytics: 'data/endpoint-analytics.json',
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
                    Object.keys(dataStore).forEach(key => {
                        if (window.__M365_DATA[key] !== undefined) {
                            dataStore[key] = window.__M365_DATA[key];
                        }
                    });
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
                // Teams data may come in nested format with metadata wrapper
                if (dataStore.teams && !Array.isArray(dataStore.teams) && dataStore.teams.teams) {
                    console.log('DataLoader: Extracting teams from nested structure');
                    dataStore.teams = dataStore.teams.teams;
                }

                // Log what was loaded
                Object.entries(dataStore).forEach(([key, data]) => {
                    console.log(`DataLoader: ${key} (${Array.isArray(data) ? data.length + ' items' : (data ? 'object' : 'null')})`);
                });

                // Check if any meaningful data was loaded
                const hasData = dataStore.users.length > 0 ||
                    dataStore.devices.length > 0 ||
                    dataStore.guests.length > 0 ||
                    (dataStore.teams && dataStore.teams.length > 0);

                isLoaded = true;
                loadError = null;

                // Update header with last updated time
                this.updateLastUpdated();

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
            return data || [];
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

            return {
                totalUsers: users.length,
                employeeCount: users.filter(u => u.domain === 'employee').length,
                studentCount: users.filter(u => u.domain === 'student').length,
                otherCount: users.filter(u => u.domain === 'other').length,
                disabledUsers: users.filter(u => !u.accountEnabled).length,
                inactiveUsers: users.filter(u => u.isInactive).length,
                noMfaUsers: noMfa,
                mfaRegisteredCount: mfaRegistered,
                mfaPct: users.length > 0 ? Math.round((mfaRegistered / users.length) * 100) : 0,
                adminCount: users.filter(u => u.flags && u.flags.includes('admin')).length,
                guestCount: guests.length,
                staleGuests: guests.filter(g => g.isStale).length,
                totalDevices: devices.length,
                compliantDevices: compliantDevices,
                nonCompliantDevices: devices.filter(d => d.complianceState === 'noncompliant').length,
                unknownDevices: devices.filter(d => d.complianceState !== 'compliant' && d.complianceState !== 'noncompliant').length,
                staleDevices: staleDevices,
                compliancePct: devices.length > 0 ? Math.round((compliantDevices / devices.length) * 100) : 0,
                activeAlerts: alerts.filter(a => a.status !== 'resolved').length,

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
        }
    };

})();

// Export for use in other modules
window.DataLoader = DataLoader;
