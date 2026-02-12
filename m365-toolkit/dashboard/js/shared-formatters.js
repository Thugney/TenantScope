/**
 * TenantScope - Shared Formatters Module
 * Reusable formatter functions for dashboard tables and displays
 * Author: Robel (https://github.com/Thugney)
 *
 * CSS classes used:
 * - Badges: .badge, .badge-success, .badge-warning, .badge-critical, .badge-neutral, .badge-info
 * - Text: .text-success, .text-warning, .text-critical, .text-muted, .text-info
 * - Font: .font-bold
 */

const SharedFormatters = (function() {
    'use strict';

    // ========================================================================
    // COMPLIANCE & STATUS FORMATTERS
    // ========================================================================

    /**
     * Format compliance state with appropriate badge
     * @param {string} value - Compliance state (compliant, noncompliant, unknown)
     * @returns {string} HTML badge
     */
    function formatCompliance(value) {
        var map = {
            'compliant': { badge: 'badge-success', label: 'Compliant' },
            'noncompliant': { badge: 'badge-critical', label: 'Non-Compliant' },
            'unknown': { badge: 'badge-neutral', label: 'Unknown' }
        };
        var state = map[value] || map['unknown'];
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    /**
     * Format boolean value as Yes/No with color coding
     * @param {boolean|null} value - Boolean value
     * @returns {string} HTML formatted Yes/No
     */
    function formatBoolean(value) {
        if (value === true) return '<span class="text-success font-bold">Yes</span>';
        if (value === false) return '<span class="text-critical">No</span>';
        return '<span class="text-muted">--</span>';
    }

    /**
     * Alias for formatBoolean - formats boolean as Yes/No
     * @param {boolean|null} value - Boolean value
     * @returns {string} HTML formatted Yes/No
     */
    function formatYesNo(value) {
        return formatBoolean(value);
    }

    /**
     * Format certificate status with appropriate badge
     * @param {string} value - Certificate status (expired, critical, warning, healthy, unknown)
     * @returns {string} HTML badge
     */
    function formatCertStatus(value) {
        var map = {
            'expired': { badge: 'badge-critical', label: 'Expired' },
            'critical': { badge: 'badge-critical', label: 'Critical' },
            'warning': { badge: 'badge-warning', label: 'Warning' },
            'healthy': { badge: 'badge-success', label: 'Healthy' },
            'unknown': { badge: 'badge-neutral', label: 'Unknown' }
        };
        var state = map[value] || map['unknown'];
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    // ========================================================================
    // OPERATING SYSTEM FORMATTERS
    // ========================================================================

    /**
     * Format operating system with appropriate badge
     * @param {string} value - OS name (Windows, macOS, iOS, Android)
     * @returns {string} HTML badge
     */
    function formatOS(value) {
        var colors = {
            'Windows': 'badge-info',
            'macOS': 'badge-neutral',
            'iOS': 'badge-success',
            'Android': 'badge-success',
            'Linux': 'badge-neutral'
        };
        return '<span class="badge ' + (colors[value] || 'badge-neutral') + '">' + (value || 'Unknown') + '</span>';
    }

    /**
     * Format Windows type (Windows 10/11) with appropriate badge
     * @param {string} value - Windows type
     * @returns {string} HTML badge or muted text
     */
    function formatWindowsType(value) {
        if (!value) return '<span class="text-muted">--</span>';
        if (value === 'Windows 11') return '<span class="badge badge-info">Win 11</span>';
        if (value === 'Windows 10') return '<span class="badge badge-neutral">Win 10</span>';
        return '<span class="badge badge-neutral">' + value + '</span>';
    }

    // ========================================================================
    // OWNERSHIP & ENROLLMENT FORMATTERS
    // ========================================================================

    /**
     * Format device ownership with appropriate badge
     * @param {string} value - Ownership type (corporate, personal)
     * @returns {string} HTML badge
     */
    function formatOwnership(value) {
        if (value === 'corporate') return '<span class="badge badge-info">Corporate</span>';
        if (value === 'personal') return '<span class="badge badge-neutral">Personal</span>';
        return '<span class="badge badge-neutral">' + (value || 'Unknown') + '</span>';
    }

    // ========================================================================
    // DATE & TIME FORMATTERS
    // ========================================================================

    /**
     * Format ISO date string to localized date
     * @param {string} isoDate - ISO date string
     * @returns {string} Localized date or muted '--'
     */
    function formatDate(isoDate) {
        if (!isoDate) return '<span class="text-muted">--</span>';
        try {
            var date = new Date(isoDate);
            if (isNaN(date.getTime())) return '<span class="text-muted">--</span>';
            return date.toLocaleDateString();
        } catch (e) {
            return '<span class="text-muted">--</span>';
        }
    }

    /**
     * Format ISO date string to localized date and time
     * @param {string} isoDate - ISO date string
     * @returns {string} Localized date and time or muted '--'
     */
    function formatDateTime(isoDate) {
        if (!isoDate) return '<span class="text-muted">--</span>';
        try {
            var date = new Date(isoDate);
            if (isNaN(date.getTime())) return '<span class="text-muted">--</span>';
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '<span class="text-muted">--</span>';
        }
    }

    // ========================================================================
    // NUMERIC / DAYS FORMATTERS
    // ========================================================================

    /**
     * Format a number as days with 'd' suffix
     * @param {number|null} value - Number of days
     * @returns {string} Formatted days or muted '--'
     */
    function formatDays(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        return value + 'd';
    }

    /**
     * Format days since last sync with color coding
     * @param {number|null} value - Days since sync
     * @returns {string} HTML formatted days with appropriate color
     */
    function formatDaysSinceSync(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var cls = '';
        if (value >= 90) cls = 'text-critical font-bold';
        else if (value >= 30) cls = 'text-warning';
        return '<span class="' + cls + '">' + value + 'd</span>';
    }

    /**
     * Format days until certificate expiry with color coding
     * @param {number|null} value - Days until expiry
     * @returns {string} HTML formatted days with appropriate color
     */
    function formatDaysUntilExpiry(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var cls = '';
        if (value < 0) cls = 'text-critical font-bold';
        else if (value <= 30) cls = 'text-critical';
        else if (value <= 60) cls = 'text-warning';
        return '<span class="' + cls + '">' + value + '</span>';
    }

    // ========================================================================
    // PERCENTAGE & STORAGE FORMATTERS
    // ========================================================================

    /**
     * Format percentage value with optional color coding
     * @param {number|null} value - Percentage value (0-100)
     * @param {object} [options] - Optional thresholds { warning: 70, critical: 90 }
     * @returns {string} HTML formatted percentage
     */
    function formatPercentage(value, options) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var opts = options || {};
        var cls = '';
        if (opts.inverse) {
            // For compliance rates: higher is better
            if (value < (opts.critical || 70)) cls = 'text-critical';
            else if (value < (opts.warning || 90)) cls = 'text-warning';
            else cls = 'text-success';
        } else if (opts.warning !== undefined || opts.critical !== undefined) {
            // For storage usage: higher is worse
            if (value >= (opts.critical || 90)) cls = 'text-critical';
            else if (value >= (opts.warning || 80)) cls = 'text-warning';
        }
        return '<span class="' + cls + '">' + Math.round(value) + '%</span>';
    }

    /**
     * Format storage used percentage with color coding
     * Warning at 80%, Critical at 90%
     * @param {number|null} value - Storage used percentage
     * @returns {string} HTML formatted percentage
     */
    function formatStorageUsed(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var cls = '';
        if (value >= 90) cls = 'text-critical';
        else if (value >= 80) cls = 'text-warning';
        return '<span class="' + cls + '">' + value + '%</span>';
    }

    // ========================================================================
    // ENCRYPTION & HEALTH FORMATTERS
    // ========================================================================

    /**
     * Format BitLocker encryption state with appropriate badge
     * @param {string} value - Encryption state (encrypted, notEncrypted, encryptionInProgress, unknown)
     * @returns {string} HTML badge
     */
    function formatEncryptionState(value) {
        var states = {
            'encrypted': { badge: 'badge-success', label: 'Encrypted' },
            'notEncrypted': { badge: 'badge-critical', label: 'Not Encrypted' },
            'encryptionInProgress': { badge: 'badge-warning', label: 'In Progress' },
            'unknown': { badge: 'badge-neutral', label: 'Unknown' }
        };
        var state = states[value] || states['unknown'];
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    /**
     * Format health status with appropriate badge
     * @param {string} value - Health status (excellent, good, fair, poor, needsAttention, unknown)
     * @returns {string} HTML badge
     */
    function formatHealthStatus(value) {
        var states = {
            'excellent': { badge: 'badge-success', label: 'Excellent' },
            'good': { badge: 'badge-success', label: 'Good' },
            'fair': { badge: 'badge-warning', label: 'Fair' },
            'poor': { badge: 'badge-critical', label: 'Poor' },
            'needsAttention': { badge: 'badge-warning', label: 'Needs Attention' },
            'unknown': { badge: 'badge-neutral', label: 'Unknown' }
        };
        // Handle camelCase and lowercase variations - ensure value is a string
        var key = 'unknown';
        if (value && typeof value === 'string') {
            key = value.toLowerCase().replace(/\s+/g, '');
            if (key === 'needsattention') key = 'needsAttention';
        }
        var state = states[key] || states['unknown'];
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    // ========================================================================
    // GENERIC BADGE FORMATTER
    // ========================================================================

    /**
     * Format value with a custom color map
     * @param {string} value - Value to format
     * @param {object} colorMap - Map of value to badge class and optional label
     *                           { 'value1': 'badge-success', 'value2': { badge: 'badge-critical', label: 'Custom Label' } }
     * @param {string} [defaultBadge] - Default badge class if value not found (default: 'badge-neutral')
     * @returns {string} HTML badge
     */
    function formatBadge(value, colorMap, defaultBadge) {
        if (!value) return '<span class="badge ' + (defaultBadge || 'badge-neutral') + '">Unknown</span>';

        var mapping = colorMap[value];
        if (!mapping) {
            return '<span class="badge ' + (defaultBadge || 'badge-neutral') + '">' + value + '</span>';
        }

        // Handle both simple string badge class and object with badge/label
        if (typeof mapping === 'string') {
            return '<span class="badge ' + mapping + '">' + value + '</span>';
        }

        return '<span class="badge ' + mapping.badge + '">' + (mapping.label || value) + '</span>';
    }

    // ========================================================================
    // ADDITIONAL UTILITY FORMATTERS
    // ========================================================================

    /**
     * Format stale device status
     * @param {boolean} value - Is device stale
     * @returns {string} HTML badge or muted text
     */
    function formatStale(value) {
        if (value === true) return '<span class="badge badge-warning">Stale</span>';
        return '<span class="text-muted">No</span>';
    }

    /**
     * Format platform/OS with info badge
     * @param {string} value - Platform name
     * @returns {string} HTML badge
     */
    function formatPlatform(value) {
        return '<span class="badge badge-info">' + (value || 'Unknown') + '</span>';
    }

    /**
     * Format compliance rate with color coding (higher is better)
     * @param {number|null} value - Compliance rate percentage
     * @returns {string} HTML formatted percentage
     */
    function formatComplianceRate(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        var pct = Math.round(value);
        var cls = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-critical';
        return '<span class="' + cls + '">' + pct + '%</span>';
    }

    /**
     * Format enrollment state with appropriate badge
     * @param {string} value - Enrollment state
     * @returns {string} HTML badge
     */
    function formatEnrollmentState(value) {
        var map = {
            'enrolled': { badge: 'badge-success', label: 'Enrolled' },
            'notContacted': { badge: 'badge-warning', label: 'Not Contacted' },
            'failed': { badge: 'badge-critical', label: 'Failed' },
            'pending': { badge: 'badge-neutral', label: 'Pending' }
        };
        var state = map[value] || { badge: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    /**
     * Format severity level with appropriate badge
     * @param {string} value - Severity level (critical, high, medium, low, info)
     * @returns {string} HTML badge
     */
    function formatSeverity(value) {
        var map = {
            'critical': { badge: 'badge-critical', label: 'Critical' },
            'high': { badge: 'badge-warning', label: 'High' },
            'medium': { badge: 'badge-info', label: 'Medium' },
            'low': { badge: 'badge-neutral', label: 'Low' },
            'info': { badge: 'badge-info', label: 'Info' }
        };
        var state = map[value] || { badge: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    /**
     * Format numeric count with success/warning/critical color based on whether non-zero is good or bad
     * @param {number|null} value - Count value
     * @param {object} [options] - { zeroIsGood: true } to show non-zero as warning/critical
     * @returns {string} HTML formatted count
     */
    function formatCount(value, options) {
        if (value === null || value === undefined) return '<span class="text-muted">0</span>';
        var opts = options || {};
        if (opts.zeroIsGood) {
            // Non-zero values are bad (e.g., error counts, non-compliant counts)
            if (value > 0) {
                return '<span class="text-critical font-bold">' + value + '</span>';
            }
            return '<span class="text-muted">0</span>';
        } else {
            // Non-zero values are good (e.g., compliant counts)
            if (value > 0) {
                return '<span class="text-success">' + value + '</span>';
            }
            return '<span class="text-muted">0</span>';
        }
    }

    /**
     * Format storage size in GB
     * @param {number|null} value - Storage in GB
     * @returns {string} Formatted storage with unit
     */
    function formatStorageGB(value) {
        if (value === null || value === undefined) return '<span class="text-muted">--</span>';
        return value + ' GB';
    }

    /**
     * Format risk level with appropriate badge
     * @param {string} value - Risk level (high, medium, low, none)
     * @returns {string} HTML badge
     */
    function formatRiskLevel(value) {
        var map = {
            'high': { badge: 'badge-critical', label: 'High Risk' },
            'medium': { badge: 'badge-warning', label: 'Medium Risk' },
            'low': { badge: 'badge-info', label: 'Low Risk' },
            'none': { badge: 'badge-success', label: 'No Risk' }
        };
        var state = map[value] || { badge: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    /**
     * Format ASR rule action mode with appropriate badge
     * @param {string} value - Action mode (block, audit, warn, off)
     * @returns {string} HTML badge
     */
    function formatActionMode(value) {
        var map = {
            'block': { badge: 'badge-success', label: 'Block' },
            'audit': { badge: 'badge-info', label: 'Audit' },
            'warn': { badge: 'badge-warning', label: 'Warn' },
            'off': { badge: 'badge-neutral', label: 'Off' },
            'notConfigured': { badge: 'badge-neutral', label: 'Not Configured' }
        };
        var state = map[value] || { badge: 'badge-neutral', label: value || 'Unknown' };
        return '<span class="badge ' + state.badge + '">' + state.label + '</span>';
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        // Compliance & Status
        formatCompliance: formatCompliance,
        formatBoolean: formatBoolean,
        formatYesNo: formatYesNo,
        formatCertStatus: formatCertStatus,
        formatStale: formatStale,

        // Operating System
        formatOS: formatOS,
        formatWindowsType: formatWindowsType,
        formatPlatform: formatPlatform,

        // Ownership & Enrollment
        formatOwnership: formatOwnership,
        formatEnrollmentState: formatEnrollmentState,

        // Date & Time
        formatDate: formatDate,
        formatDateTime: formatDateTime,

        // Numeric / Days
        formatDays: formatDays,
        formatDaysSinceSync: formatDaysSinceSync,
        formatDaysUntilExpiry: formatDaysUntilExpiry,
        formatCount: formatCount,

        // Percentage & Storage
        formatPercentage: formatPercentage,
        formatStorageUsed: formatStorageUsed,
        formatStorageGB: formatStorageGB,
        formatComplianceRate: formatComplianceRate,

        // Encryption & Health
        formatEncryptionState: formatEncryptionState,
        formatHealthStatus: formatHealthStatus,

        // Severity & Risk
        formatSeverity: formatSeverity,
        formatRiskLevel: formatRiskLevel,
        formatActionMode: formatActionMode,

        // Generic Badge
        formatBadge: formatBadge
    };
})();

// Export for global access
window.SharedFormatters = SharedFormatters;
