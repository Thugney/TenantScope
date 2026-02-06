/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * FILTERS MODULE
 *
 * Provides generic filtering functionality for data tables.
 * Supports text search (debounced), dropdowns, and multi-select checkboxes.
 * Filter state is maintained in URL parameters for shareability.
 *
 * Usage:
 *   const filteredData = Filters.apply(data, filterConfig);
 */

const Filters = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Debounce timeout reference for search input */
    let searchTimeout = null;

    /** Debounce delay in milliseconds */
    const DEBOUNCE_MS = 300;

    /** Current active filter callbacks by page */
    const filterCallbacks = {};

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Debounces a function call.
     *
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    function debounce(fn, delay) {
        return function(...args) {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    /**
     * Gets a value from a nested object path.
     *
     * @param {object} obj - The object to search
     * @param {string} path - Dot-separated path (e.g., 'user.name')
     * @returns {any} The value at the path, or undefined
     */
    function getNestedValue(obj, path) {
        if (!path) return obj;
        return path.split('.').reduce((o, k) => (o || {})[k], obj);
    }

    /**
     * Checks if a string contains the search term (case-insensitive).
     *
     * @param {string} value - The value to search in
     * @param {string} term - The search term
     * @returns {boolean} True if value contains term
     */
    function containsText(value, term) {
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(term.toLowerCase());
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Applies filters to a data array.
         *
         * @param {Array} data - Array of objects to filter
         * @param {object} filterConfig - Filter configuration
         * @param {string} [filterConfig.search] - Text to search for
         * @param {string[]} [filterConfig.searchFields] - Fields to search in
         * @param {object} [filterConfig.exact] - Exact match filters {field: value}
         * @param {object} [filterConfig.includes] - Array contains filters {field: [values]}
         * @param {object} [filterConfig.boolean] - Boolean filters {field: true/false}
         * @param {object} [filterConfig.range] - Range filters {field: {min, max}}
         * @returns {Array} Filtered data array
         */
        apply(data, filterConfig) {
            if (!data || !Array.isArray(data)) return [];
            if (!filterConfig) return data;

            return data.filter(item => {
                // Text search filter
                if (filterConfig.search && filterConfig.searchFields) {
                    const searchTerm = filterConfig.search.trim();
                    if (searchTerm) {
                        const matchesSearch = filterConfig.searchFields.some(field => {
                            const value = getNestedValue(item, field);
                            return containsText(value, searchTerm);
                        });
                        if (!matchesSearch) return false;
                    }
                }

                // Exact match filters
                if (filterConfig.exact) {
                    for (const [field, expected] of Object.entries(filterConfig.exact)) {
                        if (expected === null || expected === '' || expected === 'all') continue;
                        const value = getNestedValue(item, field);
                        if (String(value) !== String(expected)) return false;
                    }
                }

                // Array includes filters (item field contains one of the expected values)
                if (filterConfig.includes) {
                    for (const [field, expectedValues] of Object.entries(filterConfig.includes)) {
                        if (!expectedValues || expectedValues.length === 0) continue;
                        const value = getNestedValue(item, field);

                        // If the item's field is an array, check for intersection
                        if (Array.isArray(value)) {
                            const hasMatch = expectedValues.some(ev => value.includes(ev));
                            if (!hasMatch) return false;
                        } else {
                            // Otherwise check if value is in expected values
                            if (!expectedValues.includes(value)) return false;
                        }
                    }
                }

                // Boolean filters
                if (filterConfig.boolean) {
                    for (const [field, expected] of Object.entries(filterConfig.boolean)) {
                        if (expected === null) continue;
                        const value = getNestedValue(item, field);
                        if (Boolean(value) !== Boolean(expected)) return false;
                    }
                }

                // Range filters (numeric)
                if (filterConfig.range) {
                    for (const [field, range] of Object.entries(filterConfig.range)) {
                        const value = getNestedValue(item, field);
                        if (value === null || value === undefined) continue;
                        if (range.min !== undefined && value < range.min) return false;
                        if (range.max !== undefined && value > range.max) return false;
                    }
                }

                // Date range filters (ISO string comparison)
                if (filterConfig.dateRange) {
                    for (const [field, range] of Object.entries(filterConfig.dateRange)) {
                        if ((!range.from || range.from === '') && (!range.to || range.to === '')) continue;
                        const value = getNestedValue(item, field);
                        if (value === null || value === undefined || value === '') {
                            return false;
                        }
                        const dateStr = String(value).substring(0, 10);
                        if (range.from && range.from !== '' && dateStr < range.from) return false;
                        if (range.to && range.to !== '' && dateStr > range.to) return false;
                    }
                }

                return true;
            });
        },

        /**
         * Creates a filter bar element with specified controls.
         *
         * @param {object} config - Filter bar configuration
         * @param {string} config.containerId - ID of container element
         * @param {object[]} config.controls - Array of control configurations
         * @param {Function} config.onFilter - Callback when filters change
         * @returns {HTMLElement} The filter bar element
         */
        createFilterBar(config) {
            const container = document.getElementById(config.containerId);
            if (!container) return null;

            const filterBar = document.createElement('div');
            filterBar.className = 'filter-bar';

            config.controls.forEach(control => {
                const group = document.createElement('div');
                group.className = 'filter-group';

                if (control.label) {
                    const label = document.createElement('label');
                    label.className = 'filter-label';
                    label.textContent = control.label;
                    group.appendChild(label);
                }

                if (control.type === 'search') {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'filter-input';
                    input.placeholder = control.placeholder || 'Search...';
                    input.id = control.id;

                    // Debounced search handler
                    input.addEventListener('input', debounce(() => {
                        config.onFilter();
                    }, DEBOUNCE_MS));

                    group.appendChild(input);
                }
                else if (control.type === 'select') {
                    const select = document.createElement('select');
                    select.className = 'filter-select';
                    select.id = control.id;

                    control.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        select.appendChild(option);
                    });

                    select.addEventListener('change', config.onFilter);
                    group.appendChild(select);
                }
                else if (control.type === 'date-range') {
                    const rangeWrap = document.createElement('div');
                    rangeWrap.className = 'filter-date-range';
                    rangeWrap.id = control.id;

                    const fromInput = document.createElement('input');
                    fromInput.type = 'date';
                    fromInput.className = 'filter-date-input';
                    fromInput.dataset.role = 'from';
                    fromInput.title = 'From date';
                    fromInput.addEventListener('change', config.onFilter);

                    const sep = document.createElement('span');
                    sep.className = 'filter-date-sep';
                    sep.textContent = 'to';

                    const toInput = document.createElement('input');
                    toInput.type = 'date';
                    toInput.className = 'filter-date-input';
                    toInput.dataset.role = 'to';
                    toInput.title = 'To date';
                    toInput.addEventListener('change', config.onFilter);

                    rangeWrap.appendChild(fromInput);
                    rangeWrap.appendChild(sep);
                    rangeWrap.appendChild(toInput);
                    group.appendChild(rangeWrap);
                }
                else if (control.type === 'checkbox-group') {
                    const checkboxGroup = document.createElement('div');
                    checkboxGroup.className = 'filter-checkbox-group';
                    checkboxGroup.id = control.id;

                    control.options.forEach(opt => {
                        const wrapper = document.createElement('label');
                        wrapper.className = 'filter-checkbox';

                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.value = opt.value;
                        checkbox.checked = opt.checked || false;
                        checkbox.addEventListener('change', config.onFilter);

                        const text = document.createTextNode(opt.label);

                        wrapper.appendChild(checkbox);
                        wrapper.appendChild(text);
                        checkboxGroup.appendChild(wrapper);
                    });

                    group.appendChild(checkboxGroup);
                }

                filterBar.appendChild(group);
            });

            // Add export button
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'filter-actions';

            const exportBtn = document.createElement('button');
            exportBtn.className = 'btn btn-secondary btn-sm';
            exportBtn.textContent = 'Export CSV';
            exportBtn.id = config.containerId + '-export';
            actionsDiv.appendChild(exportBtn);

            filterBar.appendChild(actionsDiv);

            container.appendChild(filterBar);

            // Store callback reference
            filterCallbacks[config.containerId] = config.onFilter;

            return filterBar;
        },

        /**
         * Sets up event listeners on an existing filter element.
         * This is a convenience method for pages that create their own filter HTML.
         *
         * @param {string} controlId - ID of the filter control element
         * @param {Function} callback - Function to call when filter value changes
         */
        setup(controlId, callback) {
            const element = document.getElementById(controlId);
            if (!element) {
                console.warn('Filters.setup: Element not found:', controlId);
                return;
            }

            if (element.tagName === 'INPUT' && element.type === 'text') {
                // Text input - debounce
                element.addEventListener('input', debounce(callback, DEBOUNCE_MS));
            } else if (element.tagName === 'SELECT') {
                // Select - immediate
                element.addEventListener('change', callback);
            } else if (element.tagName === 'INPUT' && element.type === 'checkbox') {
                // Checkbox - immediate
                element.addEventListener('change', callback);
            }
        },

        /**
         * Gets the current value of a filter control.
         *
         * @param {string} controlId - ID of the filter control
         * @returns {string|string[]|boolean} Current value
         */
        getValue(controlId) {
            const element = document.getElementById(controlId);
            if (!element) return null;

            if (element.classList.contains('filter-date-range')) {
                const fromInput = element.querySelector('[data-role="from"]');
                const toInput = element.querySelector('[data-role="to"]');
                return {
                    from: fromInput ? fromInput.value : '',
                    to: toInput ? toInput.value : ''
                };
            }
            else if (element.type === 'checkbox') {
                return element.checked;
            }
            else if (element.classList.contains('filter-checkbox-group')) {
                const checked = element.querySelectorAll('input:checked');
                return Array.from(checked).map(cb => cb.value);
            }
            else {
                return element.value;
            }
        },

        /**
         * Sets the value of a filter control.
         *
         * @param {string} controlId - ID of the filter control
         * @param {any} value - Value to set
         */
        setValue(controlId, value) {
            const element = document.getElementById(controlId);
            if (!element) return;

            if (element.type === 'checkbox') {
                element.checked = Boolean(value);
            }
            else if (element.classList.contains('filter-checkbox-group')) {
                const checkboxes = element.querySelectorAll('input');
                checkboxes.forEach(cb => {
                    cb.checked = Array.isArray(value) && value.includes(cb.value);
                });
            }
            else {
                element.value = value;
            }
        },

        /**
         * Resets all filters in a filter bar to their default values.
         *
         * @param {string} containerId - ID of the filter bar container
         */
        reset(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const inputs = container.querySelectorAll('.filter-input');
            inputs.forEach(input => input.value = '');

            const selects = container.querySelectorAll('.filter-select');
            selects.forEach(select => select.selectedIndex = 0);

            const dateInputs = container.querySelectorAll('.filter-date-input');
            dateInputs.forEach(input => input.value = '');

            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);

            // Trigger filter callback
            if (filterCallbacks[containerId]) {
                filterCallbacks[containerId]();
            }
        },

        /**
         * Saves current filter state to URL parameters.
         *
         * @param {object} filterState - Object with filter key-value pairs
         */
        saveToUrl(filterState) {
            const params = new URLSearchParams(window.location.search);

            for (const [key, value] of Object.entries(filterState)) {
                if (value && value !== '' && value !== 'all') {
                    if (Array.isArray(value)) {
                        params.set(key, value.join(','));
                    } else {
                        params.set(key, value);
                    }
                } else {
                    params.delete(key);
                }
            }

            const newUrl = `${window.location.pathname}${window.location.hash}${params.toString() ? '?' + params.toString() : ''}`;
            history.replaceState(null, '', newUrl);
        },

        /**
         * Loads filter state from URL parameters.
         *
         * @returns {object} Filter state object
         */
        loadFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const state = {};

            for (const [key, value] of params.entries()) {
                if (value.includes(',')) {
                    state[key] = value.split(',');
                } else {
                    state[key] = value;
                }
            }

            return state;
        }
    };

})();

// Export for use in other modules
window.Filters = Filters;
