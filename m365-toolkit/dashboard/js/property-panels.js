/**
 * ============================================================================
 * TenantScope - Drill-Down Property Panels Module
 * ============================================================================
 *
 * Provides clickable, drill-down property rendering for all entity detail views.
 * Every property value becomes a link that navigates to the relevant page
 * filtered by that value, enabling rapid investigation without portal-hopping.
 *
 * Usage:
 *   DrillDown.link('IT', 'users', 'department', 'IT')
 *   DrillDown.entityLink('John Doe', 'user', 'user-id-123')
 *   DrillDown.badge('Compliant', 'success', 'devices', 'complianceState', 'compliant')
 *   DrillDown.init(containerElement)
 */

var DrillDown = (function() {
    'use strict';

    // ========================================================================
    // HELPERS
    // ========================================================================

    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Page display name mapping for tooltip text.
     */
    var pageNames = {
        'users': 'Users',
        'devices': 'Devices',
        'licenses': 'Licenses',
        'license-analysis': 'License Analysis',
        'groups': 'Groups',
        'guests': 'Guests',
        'teams': 'Teams',
        'sharepoint': 'SharePoint',
        'security': 'Security',
        'signin-logs': 'Sign-In Logs',
        'conditional-access': 'Conditional Access',
        'identity-risk': 'Identity Risk',
        'oauth-consent': 'OAuth Consent',
        'pim': 'PIM',
        'audit-logs': 'Audit Logs',
        'compliance-policies': 'Compliance Policies',
        'configuration-profiles': 'Config Profiles',
        'windows-update': 'Windows Update',
        'bitlocker': 'BitLocker',
        'app-deployments': 'App Deployments',
        'endpoint-analytics': 'Endpoint Analytics',
        'enterprise-apps': 'Enterprise Apps',
        'credential-expiry': 'Credential Expiry',
        'asr-rules': 'ASR Rules',
        'vulnerabilities': 'Vulnerabilities',
        'lifecycle': 'Lifecycle',
        'problems': 'Problems',
        'compliance': 'Data Governance',
        'overview': 'Overview'
    };

    // ========================================================================
    // LINK GENERATORS
    // ========================================================================

    /**
     * Create a clickable property value that navigates to a filtered page.
     *
     * @param {string} displayText - Text to display
     * @param {string} page - Target page hash (e.g., 'users', 'devices')
     * @param {string} filterKey - Filter parameter name
     * @param {string} filterValue - Filter value (defaults to displayText)
     * @param {Object} [options] - Optional: { badge: true, badgeType: 'success' }
     * @returns {string} HTML string
     */
    function link(displayText, page, filterKey, filterValue, options) {
        if (!displayText || displayText === '--' || displayText === 'N/A') {
            return '<span class="text-muted">' + (displayText || '--') + '</span>';
        }

        options = options || {};
        filterValue = filterValue !== undefined ? filterValue : displayText;
        var pageName = pageNames[page] || page;
        var classes = 'drill-link';

        var html = '<a class="' + classes + '" href="#' + esc(page) +
            '?' + encodeURIComponent(filterKey) + '=' + encodeURIComponent(filterValue) + '"' +
            ' data-drill-page="' + esc(page) + '"' +
            ' data-drill-key="' + esc(filterKey) + '"' +
            ' data-drill-value="' + esc(filterValue) + '"' +
            ' title="Go to ' + esc(pageName) + ' → ' + esc(filterKey) + ': ' + esc(String(filterValue)) + '">';

        if (options.badge) {
            html += '<span class="status-badge status-' + (options.badgeType || 'default') + '">' + displayText + '</span>';
        } else {
            html += displayText;
        }

        html += '<span class="drill-arrow" aria-hidden="true">&#8250;</span></a>';
        return html;
    }

    /**
     * Create a clickable link that opens an entity detail panel.
     *
     * @param {string} displayText - Text to display
     * @param {string} entityType - 'user' or 'device'
     * @param {string} entityId - Entity ID or lookup key (userId, deviceId, UPN)
     * @returns {string} HTML string
     */
    function entityLink(displayText, entityType, entityId) {
        if (!displayText || displayText === '--') {
            return '<span class="text-muted">' + (displayText || '--') + '</span>';
        }
        if (!entityId) {
            return esc(displayText);
        }

        var typeLabel = entityType === 'user' ? 'user' : entityType === 'device' ? 'device' : entityType;

        return '<a class="drill-link drill-entity" href="javascript:void(0)"' +
            ' data-drill-entity="' + esc(entityType) + '"' +
            ' data-drill-entity-id="' + esc(entityId) + '"' +
            ' title="Open ' + esc(typeLabel) + ' details">' +
            esc(displayText) +
            '<span class="drill-arrow" aria-hidden="true">&#8250;</span></a>';
    }

    /**
     * Create a status badge that is also a drill-down link.
     *
     * @param {string} displayText - Badge text
     * @param {string} statusType - Badge type: success, danger, warning, info, default
     * @param {string} [page] - Target page (if omitted, badge is non-clickable)
     * @param {string} [filterKey] - Filter key
     * @param {string} [filterValue] - Filter value
     * @returns {string} HTML string
     */
    function badge(displayText, statusType, page, filterKey, filterValue) {
        if (!page) {
            return '<span class="status-badge status-' + (statusType || 'default') + '">' + displayText + '</span>';
        }

        filterValue = filterValue !== undefined ? filterValue : '';
        var pageName = pageNames[page] || page;

        return '<a class="drill-link drill-badge-link" href="#' + esc(page) +
            '?' + encodeURIComponent(filterKey) + '=' + encodeURIComponent(filterValue) + '"' +
            ' data-drill-page="' + esc(page) + '"' +
            ' data-drill-key="' + esc(filterKey) + '"' +
            ' data-drill-value="' + esc(filterValue) + '"' +
            ' title="Go to ' + esc(pageName) + ' → ' + esc(filterKey) + ': ' + esc(String(filterValue)) + '">' +
            '<span class="status-badge status-' + (statusType || 'default') + '">' + displayText + '</span>' +
            '<span class="drill-arrow" aria-hidden="true">&#8250;</span></a>';
    }

    /**
     * Wrap a value as a clickable property row in a detail-list.
     *
     * @param {string} label - Property label
     * @param {string} valueHtml - Pre-built HTML for the value (can be a link, badge, etc.)
     * @returns {string} HTML for label + value pair
     */
    function prop(label, valueHtml) {
        return '<span class="detail-label">' + esc(label) + ':</span>' +
               '<span class="detail-value">' + (valueHtml || '<span class="text-muted">--</span>') + '</span>';
    }

    /**
     * Create a detail-list property with a drill-down link value.
     *
     * @param {string} label - Property label
     * @param {string} displayText - Display text
     * @param {string} page - Target page
     * @param {string} filterKey - Filter key
     * @param {string} [filterValue] - Filter value
     * @returns {string} HTML
     */
    function propLink(label, displayText, page, filterKey, filterValue) {
        return prop(label, link(displayText, page, filterKey, filterValue));
    }

    /**
     * Create a detail-list property with an entity link value.
     */
    function propEntity(label, displayText, entityType, entityId) {
        return prop(label, entityLink(displayText, entityType, entityId));
    }

    /**
     * Create a dt/dd property with a drill-down link value (for dl-based layouts).
     */
    function dtLink(label, displayText, page, filterKey, filterValue) {
        return '<dt>' + esc(label) + '</dt><dd>' + link(displayText, page, filterKey, filterValue) + '</dd>';
    }

    /**
     * Create a dt/dd property with an entity link value.
     */
    function dtEntity(label, displayText, entityType, entityId) {
        return '<dt>' + esc(label) + '</dt><dd>' + entityLink(displayText, entityType, entityId) + '</dd>';
    }

    /**
     * Create a dt/dd property with a badge drill-down link.
     */
    function dtBadge(label, displayText, statusType, page, filterKey, filterValue) {
        return '<dt>' + esc(label) + '</dt><dd>' + badge(displayText, statusType, page, filterKey, filterValue) + '</dd>';
    }

    // ========================================================================
    // EVENT HANDLING
    // ========================================================================

    /**
     * Initialize drill-down event handlers on a container.
     * Handles entity link clicks (opening detail panels within the modal).
     * Navigation links use href and are handled by browser hash navigation.
     *
     * @param {HTMLElement} container - Container to bind events on
     */
    function init(container) {
        if (!container) return;

        container.addEventListener('click', function(e) {
            var target = e.target.closest('.drill-entity');
            if (target) {
                e.preventDefault();
                e.stopPropagation();
                var entityType = target.dataset.drillEntity;
                var entityId = target.dataset.drillEntityId;
                openEntityPanel(entityType, entityId);
                return;
            }

            // For navigation links, close the modal first
            var navLink = e.target.closest('.drill-link:not(.drill-entity)');
            if (navLink && navLink.href && navLink.href.indexOf('#') >= 0) {
                e.preventDefault();
                // Close modal
                var modal = document.getElementById('modal-overlay');
                if (modal) modal.classList.remove('visible');

                // Navigate
                var href = navLink.getAttribute('href');
                window.location.hash = href.substring(href.indexOf('#') + 1);
            }
        });
    }

    // ========================================================================
    // ENTITY PANEL OPENING
    // ========================================================================

    /**
     * Open an entity detail panel by type and ID.
     * This calls the appropriate page's showDetails function.
     */
    function openEntityPanel(entityType, entityId) {
        if (!entityType || !entityId) return;

        if (typeof DataRelationships === 'undefined') return;
        DataRelationships.buildIndexes();

        if (entityType === 'user') {
            var userProfile = DataRelationships.getUserProfile(entityId);
            if (userProfile && userProfile.user) {
                if (typeof PageUsers !== 'undefined' && PageUsers.showUserDetails) {
                    PageUsers.showUserDetails(userProfile.user);
                }
            }
        } else if (entityType === 'device') {
            var deviceProfile = DataRelationships.getDeviceProfile(entityId);
            if (deviceProfile && deviceProfile.device) {
                if (typeof PageDevices !== 'undefined' && PageDevices.showDeviceDetails) {
                    PageDevices.showDeviceDetails(deviceProfile.device);
                }
            }
        }
    }

    // ========================================================================
    // URL PARAMETER SUPPORT
    // ========================================================================

    /**
     * Parse hash parameters from current URL.
     * E.g., #devices?complianceState=compliant → { complianceState: 'compliant' }
     *
     * @returns {Object} Key-value pairs
     */
    function getHashParams() {
        var hash = window.location.hash.slice(1);
        var parts = hash.split('?');
        if (parts.length < 2) return {};

        var params = {};
        var queryString = parts[1];
        queryString.split('&').forEach(function(pair) {
            var eqIndex = pair.indexOf('=');
            if (eqIndex > 0) {
                var key = decodeURIComponent(pair.substring(0, eqIndex));
                var value = decodeURIComponent(pair.substring(eqIndex + 1));
                params[key] = value;
            }
        });
        return params;
    }

    /**
     * Clear hash parameters (replace URL without params).
     * Called after a page has consumed its incoming filter params.
     */
    function clearHashParams() {
        var hash = window.location.hash.slice(1);
        var page = hash.split('?')[0];
        if (window.location.hash !== '#' + page) {
            history.replaceState(null, '', '#' + page);
        }
    }

    /**
     * Apply drill-down filter parameters to a page.
     * Called at the start of each page's render() function.
     *
     * Looks for a 'search' param and sets the search input value.
     * Looks for specific filter params and applies them via the Filters API.
     *
     * @param {HTMLElement} container - Page container
     * @param {Object} params - Hash params from getHashParams()
     * @param {Object} [filterConfig] - Optional: { searchInputId: 'user-search', onFilter: fn }
     * @returns {Object} The params for further processing by the page
     */
    function applyPageFilters(container, params, filterConfig) {
        if (!params || Object.keys(params).length === 0) return params;

        filterConfig = filterConfig || {};

        // Apply search parameter to the search input after the page renders
        if (params.search) {
            setTimeout(function() {
                var searchInput = container.querySelector('.filter-input[type="text"], .filter-input[type="search"], input[id$="-search"]');
                if (searchInput) {
                    searchInput.value = params.search;
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, 100);
        }

        // Show a filter notification
        var filterKeys = Object.keys(params);
        if (filterKeys.length > 0) {
            setTimeout(function() {
                if (typeof Toast !== 'undefined' && Toast.info) {
                    var filterDesc = filterKeys.map(function(k) { return k + ': ' + params[k]; }).join(', ');
                    Toast.info('Filtered View', 'Showing results for ' + filterDesc);
                }
            }, 300);
        }

        // Clear the params from URL to prevent re-application on page refresh
        clearHashParams();

        return params;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        // Link generators
        link: link,
        entityLink: entityLink,
        badge: badge,

        // Property helpers (for detail-list layouts)
        prop: prop,
        propLink: propLink,
        propEntity: propEntity,

        // Property helpers (for dl/dt/dd layouts)
        dtLink: dtLink,
        dtEntity: dtEntity,
        dtBadge: dtBadge,

        // Event handling
        init: init,
        openEntityPanel: openEntityPanel,

        // URL parameter support
        getHashParams: getHashParams,
        clearHashParams: clearHashParams,
        applyPageFilters: applyPageFilters,

        // Helpers
        esc: esc,
        pageNames: pageNames
    };
})();

// Export for use
if (typeof window !== 'undefined') {
    window.DrillDown = DrillDown;
}
