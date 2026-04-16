/**
 * ============================================================================
 * TenantScope - Field Resolver
 * ============================================================================
 * Provides adaptive field access for data that may have varying property names.
 * Instead of hardcoding exact field names, this resolver tries multiple aliases
 * to find the data, making the dashboard resilient to collector output variations.
 *
 * Usage:
 *   const name = FieldResolver.get(device, 'deviceName');
 *   const status = FieldResolver.get(device, 'complianceState');
 */

const FieldResolver = (function() {
    'use strict';

    // ========================================================================
    // FIELD ALIASES
    // ========================================================================
    // Maps logical field names to arrays of possible property names.
    // The resolver tries each alias in order until it finds a value.

    const aliases = {
        // Device identification
        deviceName: ['deviceName', 'name', 'displayName', 'device', 'computerName', 'hostName'],
        deviceId: ['deviceId', 'id', 'managedDeviceId', 'azureADDeviceId'],
        serialNumber: ['serialNumber', 'serial', 'serialNo'],

        // User identification
        userName: ['userName', 'userPrincipalName', 'upn', 'user', 'displayName', 'principalDisplayName'],
        userPrincipalName: ['userPrincipalName', 'upn', 'email', 'mail', 'userName'],
        userId: ['userId', 'id', 'userObjectId', 'objectId'],
        displayName: ['displayName', 'name', 'fullName', 'userName'],

        // Compliance and status
        complianceState: ['complianceState', 'compliance', 'status', 'state', 'complianceStatus'],
        healthState: ['healthState', 'health', 'healthStatus', 'status', 'state'],
        riskLevel: ['riskLevel', 'risk', 'riskState', 'riskScore'],
        riskState: ['riskState', 'riskLevel', 'risk', 'state'],

        // Dates
        lastSyncDateTime: ['lastSyncDateTime', 'lastSync', 'lastSyncTime', 'lastCheckin', 'lastCheckInDateTime'],
        createdDateTime: ['createdDateTime', 'created', 'createDate', 'creationDate', 'createdDate'],
        modifiedDateTime: ['modifiedDateTime', 'modified', 'lastModified', 'lastModifiedDateTime', 'updatedDateTime'],
        lastSignInDateTime: ['lastSignInDateTime', 'lastSignIn', 'lastLogin', 'lastActivityDate'],

        // Device properties
        operatingSystem: ['operatingSystem', 'os', 'osType', 'platform'],
        osVersion: ['osVersion', 'operatingSystemVersion', 'version', 'osVersionNumber'],
        manufacturer: ['manufacturer', 'make', 'vendor'],
        model: ['model', 'deviceModel', 'productName'],

        // Counts and metrics
        totalDevices: ['totalDevices', 'deviceCount', 'total', 'count'],
        compliantDevices: ['compliantDevices', 'compliant', 'successCount', 'successDevices'],
        nonCompliantDevices: ['nonCompliantDevices', 'nonCompliant', 'noncompliant', 'failedCount', 'failedDevices'],
        errorDevices: ['errorDevices', 'error', 'errors', 'errorCount'],

        // Policy fields
        policyName: ['policyName', 'displayName', 'name', 'title'],
        policyId: ['policyId', 'id', 'policyIdentifier'],
        policyType: ['policyType', 'type', 'category', 'odataType', '@odata.type'],

        // App fields
        appName: ['appName', 'displayName', 'name', 'applicationName'],
        appId: ['appId', 'id', 'applicationId'],
        appVersion: ['appVersion', 'version', 'displayVersion', 'committedContentVersion'],

        // Encryption
        isEncrypted: ['isEncrypted', 'encrypted', 'encryptionState', 'bitlockerEnabled'],
        encryptionState: ['encryptionState', 'encryption', 'isEncrypted', 'status'],

        // Scores
        healthScore: ['healthScore', 'score', 'endpointAnalyticsScore', 'overallScore'],
        startupScore: ['startupScore', 'startupPerformanceScore', 'bootScore'],

        // Generic fallbacks
        status: ['status', 'state', 'complianceState', 'healthState', 'result'],
        description: ['description', 'desc', 'details', 'notes', 'summary'],
        category: ['category', 'type', 'classification', 'group'],
        enabled: ['enabled', 'isEnabled', 'active', 'isActive', 'accountEnabled'],
        count: ['count', 'total', 'length', 'size', 'number']
    };

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Gets a field value from an object, trying multiple aliases.
         *
         * @param {object} obj - The object to get the field from
         * @param {string} fieldName - The logical field name (key in aliases)
         * @param {*} defaultValue - Value to return if field not found (default: null)
         * @returns {*} The field value or defaultValue
         */
        get(obj, fieldName, defaultValue = null) {
            if (!obj || typeof obj !== 'object') {
                return defaultValue;
            }

            // Get aliases for this field, or use fieldName as single alias
            const fieldAliases = aliases[fieldName] || [fieldName];

            // Try each alias until we find a non-null/undefined value
            for (const alias of fieldAliases) {
                if (alias in obj && obj[alias] !== undefined && obj[alias] !== null) {
                    return obj[alias];
                }
            }

            // Also try the exact fieldName if not in aliases
            if (!(fieldName in aliases) && fieldName in obj) {
                return obj[fieldName];
            }

            return defaultValue;
        },

        /**
         * Gets a field value with a specific default for display.
         *
         * @param {object} obj - The object to get the field from
         * @param {string} fieldName - The logical field name
         * @param {string} defaultDisplay - Display value if not found (default: '--')
         * @returns {*} The field value or defaultDisplay
         */
        getDisplay(obj, fieldName, defaultDisplay = '--') {
            const value = this.get(obj, fieldName, null);
            if (value === null || value === undefined || value === '') {
                return defaultDisplay;
            }
            return value;
        },

        /**
         * Gets a numeric field value.
         *
         * @param {object} obj - The object to get the field from
         * @param {string} fieldName - The logical field name
         * @param {number} defaultValue - Default if not found or not a number (default: 0)
         * @returns {number} The numeric value or defaultValue
         */
        getNumber(obj, fieldName, defaultValue = 0) {
            const value = this.get(obj, fieldName, null);
            if (value === null || value === undefined) {
                return defaultValue;
            }
            const num = Number(value);
            return isNaN(num) ? defaultValue : num;
        },

        /**
         * Gets a boolean field value.
         *
         * @param {object} obj - The object to get the field from
         * @param {string} fieldName - The logical field name
         * @param {boolean} defaultValue - Default if not found (default: false)
         * @returns {boolean} The boolean value or defaultValue
         */
        getBool(obj, fieldName, defaultValue = false) {
            const value = this.get(obj, fieldName, null);
            if (value === null || value === undefined) {
                return defaultValue;
            }
            if (typeof value === 'boolean') {
                return value;
            }
            if (typeof value === 'string') {
                const lower = value.toLowerCase();
                if (['true', 'yes', '1', 'enabled', 'on', 'active'].includes(lower)) {
                    return true;
                }
                if (['false', 'no', '0', 'disabled', 'off', 'inactive'].includes(lower)) {
                    return false;
                }
            }
            return Boolean(value);
        },

        /**
         * Gets an array field value.
         *
         * @param {object} obj - The object to get the field from
         * @param {string} fieldName - The logical field name
         * @returns {Array} The array value or empty array
         */
        getArray(obj, fieldName) {
            const value = this.get(obj, fieldName, null);
            if (Array.isArray(value)) {
                return value;
            }
            return [];
        },

        /**
         * Gets a date field value as Date object.
         *
         * @param {object} obj - The object to get the field from
         * @param {string} fieldName - The logical field name
         * @returns {Date|null} The Date object or null
         */
        getDate(obj, fieldName) {
            const value = this.get(obj, fieldName, null);
            if (!value) {
                return null;
            }
            if (value instanceof Date) {
                return value;
            }
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date;
        },

        /**
         * Checks if a field exists and has a non-empty value.
         *
         * @param {object} obj - The object to check
         * @param {string} fieldName - The logical field name
         * @returns {boolean} True if field has a value
         */
        has(obj, fieldName) {
            const value = this.get(obj, fieldName, null);
            if (value === null || value === undefined) {
                return false;
            }
            if (typeof value === 'string' && value.trim() === '') {
                return false;
            }
            if (Array.isArray(value) && value.length === 0) {
                return false;
            }
            return true;
        },

        /**
         * Gets all available aliases for a field name.
         *
         * @param {string} fieldName - The logical field name
         * @returns {Array} Array of aliases
         */
        getAliases(fieldName) {
            return aliases[fieldName] || [fieldName];
        },

        /**
         * Adds custom aliases for a field name.
         * Useful for page-specific field mappings.
         *
         * @param {string} fieldName - The logical field name
         * @param {Array} newAliases - Array of additional aliases
         */
        addAliases(fieldName, newAliases) {
            if (!Array.isArray(newAliases)) {
                newAliases = [newAliases];
            }
            if (aliases[fieldName]) {
                aliases[fieldName] = [...new Set([...aliases[fieldName], ...newAliases])];
            } else {
                aliases[fieldName] = newAliases;
            }
        },

        /**
         * Extracts multiple fields from an object at once.
         *
         * @param {object} obj - The object to extract from
         * @param {Array} fieldNames - Array of logical field names
         * @returns {object} Object with fieldName: value pairs
         */
        extract(obj, fieldNames) {
            const result = {};
            for (const fieldName of fieldNames) {
                result[fieldName] = this.get(obj, fieldName, null);
            }
            return result;
        },

        /**
         * Finds which alias actually exists in an object for a field.
         * Useful for debugging.
         *
         * @param {object} obj - The object to check
         * @param {string} fieldName - The logical field name
         * @returns {string|null} The actual property name found, or null
         */
        findActualKey(obj, fieldName) {
            if (!obj || typeof obj !== 'object') {
                return null;
            }
            const fieldAliases = aliases[fieldName] || [fieldName];
            for (const alias of fieldAliases) {
                if (alias in obj && obj[alias] !== undefined) {
                    return alias;
                }
            }
            return null;
        },

        /**
         * Diagnoses what fields are available in an object.
         * Useful for debugging collector output.
         *
         * @param {object} obj - The object to diagnose
         * @returns {object} Diagnostic info
         */
        diagnose(obj) {
            if (!obj || typeof obj !== 'object') {
                return { error: 'Not an object', value: obj };
            }

            const availableKeys = Object.keys(obj);
            const mappedFields = {};

            for (const [fieldName, fieldAliases] of Object.entries(aliases)) {
                const found = fieldAliases.find(alias => alias in obj && obj[alias] !== undefined);
                if (found) {
                    mappedFields[fieldName] = { key: found, value: obj[found] };
                }
            }

            return {
                availableKeys,
                mappedFields,
                unmappedKeys: availableKeys.filter(k => {
                    return !Object.values(aliases).flat().includes(k);
                })
            };
        }
    };

})();

// Export for use in other modules
window.FieldResolver = FieldResolver;
