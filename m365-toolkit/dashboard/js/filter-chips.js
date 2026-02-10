/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * FILTER CHIPS MODULE
 *
 * Provides visual feedback for active filters by displaying removable chips.
 * Shows users exactly what filters are applied and allows quick removal.
 *
 * Usage:
 *   FilterChips.init('container-id', onFilterChange);
 *   FilterChips.update({ search: 'term', status: 'active' });
 */

const FilterChips = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Container element for chips */
    let chipContainer = null;

    /** Callback function when a chip is removed */
    let onRemoveCallback = null;

    /** Current active filters */
    let activeFilters = {};

    /** Human-readable labels for filter keys */
    const filterLabels = {
        search: 'Search',
        domain: 'Domain',
        status: 'Status',
        accountEnabled: 'Account Status',
        mfaRegistered: 'MFA Status',
        isInactive: 'Activity',
        complianceState: 'Compliance',
        department: 'Department',
        userType: 'User Type',
        visibility: 'Visibility',
        isStale: 'Stale',
        hasNoOwner: 'Ownership',
        hasGuests: 'Guest Access',
        isArchived: 'Archived',
        isPersonalSite: 'Site Type',
        hasExternalSharing: 'External Sharing',
        severity: 'Severity',
        category: 'Category',
        riskLevel: 'Risk Level',
        state: 'State',
        dateRange: 'Date Range',
        group: 'Group'
    };

    /** Human-readable values for common filter values */
    const valueLabels = {
        // Boolean values
        'true': 'Yes',
        'false': 'No',

        // Account status
        'enabled': 'Enabled',
        'disabled': 'Disabled',

        // Domain
        'employee': 'Employee',
        'student': 'Student',
        'other': 'Other',

        // Compliance
        'compliant': 'Compliant',
        'noncompliant': 'Non-Compliant',
        'unknown': 'Unknown',

        // Visibility
        'Public': 'Public',
        'Private': 'Private',

        // Common
        'all': 'All'
    };

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Gets a human-readable label for a filter key.
     * @param {string} key - The filter key
     * @returns {string} Human-readable label
     */
    function getFilterLabel(key) {
        return filterLabels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    }

    /**
     * Gets a human-readable label for a filter value.
     * @param {any} value - The filter value
     * @returns {string} Human-readable label
     */
    function getValueLabel(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        const strValue = String(value);
        return valueLabels[strValue] || strValue;
    }

    /**
     * Creates a filter icon SVG element.
     * @returns {SVGElement} Filter icon
     */
    function createFilterIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('aria-hidden', 'true');

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3');
        svg.appendChild(polygon);

        return svg;
    }

    /**
     * Creates a single chip element.
     * @param {string} key - Filter key
     * @param {any} value - Filter value
     * @returns {HTMLElement} Chip element
     */
    function createChip(key, value) {
        const chip = document.createElement('span');
        chip.className = 'filter-chip';
        chip.dataset.filterKey = key;

        const label = document.createElement('span');
        label.className = 'filter-chip-label';
        label.textContent = getFilterLabel(key);

        const valueSpan = document.createElement('span');
        valueSpan.className = 'filter-chip-value';

        // Handle different value types
        if (typeof value === 'object' && value !== null) {
            if (value.from || value.to) {
                // Date range
                const parts = [];
                if (value.from) parts.push(value.from);
                if (value.to) parts.push(value.to);
                valueSpan.textContent = parts.join(' - ');
            } else if (Array.isArray(value)) {
                valueSpan.textContent = value.map(v => getValueLabel(v)).join(', ');
            } else {
                valueSpan.textContent = JSON.stringify(value);
            }
        } else {
            valueSpan.textContent = getValueLabel(value);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'filter-chip-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '\u00D7'; // multiplication sign (x)
        removeBtn.title = 'Remove filter';
        removeBtn.setAttribute('aria-label', 'Remove ' + getFilterLabel(key) + ' filter');
        removeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            removeFilter(key);
        });

        chip.appendChild(label);
        chip.appendChild(valueSpan);
        chip.appendChild(removeBtn);

        return chip;
    }

    /**
     * Removes a filter and triggers the callback.
     * @param {string} key - Filter key to remove
     */
    function removeFilter(key) {
        delete activeFilters[key];
        render();

        if (onRemoveCallback) {
            onRemoveCallback(key, activeFilters);
        }
    }

    /**
     * Renders the chip container with current active filters.
     */
    function render() {
        if (!chipContainer) return;

        // Clear existing chips
        while (chipContainer.firstChild) {
            chipContainer.removeChild(chipContainer.firstChild);
        }

        // Count active filters
        const activeCount = Object.keys(activeFilters).filter(function(key) {
            const value = activeFilters[key];
            return value !== null &&
                   value !== '' &&
                   value !== 'all' &&
                   !(typeof value === 'object' && value !== null && !value.from && !value.to && (!Array.isArray(value) || value.length === 0));
        }).length;

        if (activeCount === 0) {
            chipContainer.classList.add('hidden');
            return;
        }

        chipContainer.classList.remove('hidden');

        // Add filter icon and count
        const header = document.createElement('span');
        header.className = 'filter-chips-header';
        header.appendChild(createFilterIcon());
        const headerText = document.createTextNode(' Active filters (' + activeCount + '):');
        header.appendChild(headerText);
        chipContainer.appendChild(header);

        // Create chips for each active filter
        for (const key in activeFilters) {
            if (!activeFilters.hasOwnProperty(key)) continue;

            const value = activeFilters[key];

            // Skip empty/default values
            if (value === null || value === '' || value === 'all') continue;
            if (typeof value === 'object' && value !== null) {
                if (!value.from && !value.to && (!Array.isArray(value) || value.length === 0)) continue;
            }

            const chip = createChip(key, value);
            chipContainer.appendChild(chip);
        }

        // Add clear all button if multiple filters
        if (activeCount > 1) {
            const clearAll = document.createElement('button');
            clearAll.className = 'filter-chips-clear';
            clearAll.type = 'button';
            clearAll.textContent = 'Clear all';
            clearAll.addEventListener('click', function(e) {
                e.preventDefault();
                clearAllFilters();
            });
            chipContainer.appendChild(clearAll);
        }
    }

    /**
     * Clears all filters.
     */
    function clearAllFilters() {
        const keys = Object.keys(activeFilters);
        activeFilters = {};
        render();

        if (onRemoveCallback) {
            onRemoveCallback(null, activeFilters, keys);
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Initializes the filter chips system.
         * @param {string} containerId - ID of container element (or creates one)
         * @param {Function} onRemove - Callback when filter is removed: (removedKey, remainingFilters, allRemovedKeys?)
         * @returns {HTMLElement} The chip container element
         */
        init: function(containerId, onRemove) {
            onRemoveCallback = onRemove;

            // Try to find existing container or create new one
            chipContainer = document.getElementById(containerId);

            if (!chipContainer) {
                chipContainer = document.createElement('div');
                chipContainer.id = containerId;
            }

            chipContainer.className = 'filter-chips-container hidden';
            chipContainer.setAttribute('role', 'status');
            chipContainer.setAttribute('aria-live', 'polite');
            chipContainer.setAttribute('aria-label', 'Active filters');

            return chipContainer;
        },

        /**
         * Updates the displayed filters.
         * @param {object} filters - Object with filter key-value pairs
         */
        update: function(filters) {
            activeFilters = Object.assign({}, filters);
            render();
        },

        /**
         * Adds or updates a single filter.
         * @param {string} key - Filter key
         * @param {any} value - Filter value
         */
        setFilter: function(key, value) {
            activeFilters[key] = value;
            render();
        },

        /**
         * Removes a single filter.
         * @param {string} key - Filter key to remove
         */
        removeFilter: function(key) {
            removeFilter(key);
        },

        /**
         * Clears all filters.
         */
        clearAll: function() {
            clearAllFilters();
        },

        /**
         * Gets the current active filters.
         * @returns {object} Active filter object
         */
        getFilters: function() {
            return Object.assign({}, activeFilters);
        },

        /**
         * Gets the container element.
         * @returns {HTMLElement} Container element
         */
        getContainer: function() {
            return chipContainer;
        }
    };

})();

// Export for use in other modules
window.FilterChips = FilterChips;
