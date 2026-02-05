/**
 * ============================================================================
 * TenantScope
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * TABLES MODULE
 *
 * Provides generic table rendering with sorting, pagination, per-column
 * filtering, and row expansion. All tables in the dashboard use this module.
 *
 * Usage:
 *   Tables.render({
 *       containerId: 'my-table',
 *       data: [...],
 *       columns: [...],
 *       pageSize: 50
 *   });
 *
 * Column filtering:
 *   Set filterable: true on a column to enable per-column filtering.
 *   The filter type is auto-detected:
 *   - Columns with few unique values get checkbox lists
 *   - Others get a text search input
 *
 * NOTE: innerHTML is used intentionally throughout this module for rendering
 * table cell content. The data source is locally-collected JSON from Graph API
 * collectors, not user-submitted content. All string values pass through
 * escapeHtml() before rendering.
 */

const Tables = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Default number of rows per page */
    const DEFAULT_PAGE_SIZE = 50;

    /** Max unique values for checkbox filter (otherwise text search) */
    const CHECKBOX_THRESHOLD = 20;

    /** Table state storage (pagination, sort, column filters) by container ID */
    const tableStates = {};

    /** SVG for the filter icon in column headers */
    const FILTER_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>';

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Gets a value from a nested object path.
     */
    function getNestedValue(obj, path) {
        if (!path) return obj;
        return path.split('.').reduce((o, k) => (o || {})[k], obj);
    }

    /**
     * Compares two values for sorting.
     */
    function compareValues(a, b, desc) {
        if (a === null || a === undefined) a = '';
        if (b === null || b === undefined) b = '';
        if (typeof a === 'string') a = a.toLowerCase();
        if (typeof b === 'string') b = b.toLowerCase();

        let result = 0;
        if (a < b) result = -1;
        else if (a > b) result = 1;

        return desc ? -result : result;
    }

    /**
     * Formats a cell value based on column configuration.
     * All string values are escaped via escapeHtml() to prevent injection.
     * Data source is locally-collected JSON, not user input.
     */
    function formatCell(value, column, row) {
        if (column.formatter) {
            return column.formatter(value, row);
        }
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return '<span class="text-muted">--</span>';
            return value.map(v => '<span class="flag flag-' + escapeHtml(String(v)) + '">' + escapeHtml(String(v)) + '</span>').join(' ');
        }
        if (typeof value === 'boolean') {
            return value
                ? '<span class="text-success">Yes</span>'
                : '<span class="text-critical">No</span>';
        }
        return escapeHtml(String(value));
    }

    /**
     * Escapes HTML special characters to prevent XSS.
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Applies per-column filters to data.
     */
    function applyColumnFilters(data, columns, columnFilters) {
        if (!columnFilters || Object.keys(columnFilters).length === 0) return data;

        return data.filter(row => {
            for (const [key, filter] of Object.entries(columnFilters)) {
                if (!filter || (!filter.text && (!filter.selected || filter.selected.length === 0))) {
                    continue;
                }

                const value = getNestedValue(row, key);

                // Text search filter
                if (filter.text) {
                    const searchTerm = filter.text.toLowerCase();
                    const strValue = value === null || value === undefined ? '' : String(value).toLowerCase();
                    if (!strValue.includes(searchTerm)) return false;
                }

                // Checkbox selection filter
                if (filter.selected && filter.selected.length > 0) {
                    const strValue = value === null || value === undefined ? '(empty)' : String(value);
                    if (Array.isArray(value)) {
                        const hasMatch = value.some(v => filter.selected.includes(String(v)));
                        if (!hasMatch) return false;
                    } else {
                        if (!filter.selected.includes(strValue)) return false;
                    }
                }
            }
            return true;
        });
    }

    /**
     * Gets unique values for a column from the data set.
     */
    function getUniqueValues(data, key) {
        const values = new Set();
        data.forEach(row => {
            const value = getNestedValue(row, key);
            if (Array.isArray(value)) {
                value.forEach(v => values.add(String(v)));
            } else if (value === null || value === undefined) {
                values.add('(empty)');
            } else {
                values.add(String(value));
            }
        });
        return Array.from(values).sort();
    }

    /**
     * Creates a column filter dropdown element.
     */
    function createColumnFilterDropdown(col, data, state, config, renderFn) {
        const uniqueValues = getUniqueValues(data, col.key);
        const useCheckboxes = uniqueValues.length <= CHECKBOX_THRESHOLD;
        const currentFilter = (state.columnFilters || {})[col.key] || {};

        const dropdown = document.createElement('div');
        dropdown.className = 'col-filter-dropdown';

        if (useCheckboxes) {
            // Checkbox list mode
            const optionsDiv = document.createElement('div');
            optionsDiv.className = 'col-filter-options';

            uniqueValues.forEach(val => {
                const label = document.createElement('label');
                label.className = 'col-filter-option';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = val;
                checkbox.checked = currentFilter.selected ? currentFilter.selected.includes(val) : false;

                checkbox.addEventListener('change', () => {
                    if (!state.columnFilters) state.columnFilters = {};
                    if (!state.columnFilters[col.key]) state.columnFilters[col.key] = {};

                    const checked = optionsDiv.querySelectorAll('input:checked');
                    state.columnFilters[col.key].selected = Array.from(checked).map(cb => cb.value);

                    if (state.columnFilters[col.key].selected.length === 0) {
                        delete state.columnFilters[col.key];
                    }

                    state.currentPage = 1;
                    renderFn(config);
                });

                const text = document.createTextNode(' ' + val);
                label.appendChild(checkbox);
                label.appendChild(text);
                optionsDiv.appendChild(label);
            });

            dropdown.appendChild(optionsDiv);
        } else {
            // Text search mode
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Filter...';
            input.value = currentFilter.text || '';

            let debounceTimer;
            input.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (!state.columnFilters) state.columnFilters = {};
                    if (input.value.trim()) {
                        state.columnFilters[col.key] = { text: input.value.trim() };
                    } else {
                        delete state.columnFilters[col.key];
                    }
                    state.currentPage = 1;
                    renderFn(config);
                }, 300);
            });

            // Prevent sort trigger when clicking in the input
            input.addEventListener('click', (e) => e.stopPropagation());

            dropdown.appendChild(input);
        }

        // Actions row
        const actions = document.createElement('div');
        actions.className = 'col-filter-actions';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'col-filter-clear';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.columnFilters) {
                delete state.columnFilters[col.key];
            }
            state.currentPage = 1;
            renderFn(config);
        });

        actions.appendChild(clearBtn);
        dropdown.appendChild(actions);

        return dropdown;
    }

    /**
     * Counts active column filters.
     */
    function getActiveFilterCount(columnFilters) {
        if (!columnFilters) return 0;
        return Object.keys(columnFilters).length;
    }

    /**
     * Creates pagination controls.
     */
    function createPagination(state, totalItems, onPageChange) {
        const totalPages = Math.ceil(totalItems / state.pageSize);
        const currentPage = state.currentPage;

        const pagination = document.createElement('div');
        pagination.className = 'pagination';

        const info = document.createElement('span');
        info.className = 'pagination-info';
        const start = (currentPage - 1) * state.pageSize + 1;
        const end = Math.min(currentPage * state.pageSize, totalItems);
        info.textContent = 'Showing ' + start + '-' + end + ' of ' + totalItems;
        pagination.appendChild(info);

        const controls = document.createElement('div');
        controls.className = 'pagination-controls';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-btn';
        prevBtn.textContent = 'Previous';
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
        controls.appendChild(prevBtn);

        const maxButtons = 5;
        var startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        var endPage = Math.min(totalPages, startPage + maxButtons - 1);

        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        for (var i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = 'pagination-btn' + (i === currentPage ? ' active' : '');
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', ((page) => () => onPageChange(page))(i));
            controls.appendChild(pageBtn);
        }

        const nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-btn';
        nextBtn.textContent = 'Next';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
        controls.appendChild(nextBtn);

        pagination.appendChild(controls);

        return pagination;
    }

    // ========================================================================
    // GLOBAL: Close filter dropdowns when clicking outside
    // ========================================================================

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.col-filter-trigger') && !e.target.closest('.col-filter-dropdown')) {
            document.querySelectorAll('.col-filter-dropdown.visible').forEach(d => {
                d.classList.remove('visible');
            });
        }
    });

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Renders a data table with sorting, pagination, and optional column filters.
         *
         * @param {object} config - Table configuration
         * @param {string} config.containerId - ID of container element
         * @param {Array} config.data - Array of data objects
         * @param {object[]} config.columns - Column definitions
         * @param {string} config.columns[].key - Data key (supports dot notation)
         * @param {string} config.columns[].label - Column header text
         * @param {boolean} [config.columns[].sortable] - Enable sorting (default true)
         * @param {boolean} [config.columns[].filterable] - Enable per-column filter
         * @param {Function} [config.columns[].formatter] - Custom cell formatter
         * @param {string} [config.columns[].className] - CSS class for cells
         * @param {number} [config.pageSize] - Rows per page (default 50)
         * @param {string} [config.title] - Table title
         * @param {Function} [config.onRowClick] - Row click callback
         * @param {Function} [config.getRowClass] - Function to get row CSS class
         */
        render(config) {
            const container = document.getElementById(config.containerId);
            if (!container) {
                console.error('Tables.render: Container not found:', config.containerId);
                return;
            }

            // Initialize or get table state
            if (!tableStates[config.containerId]) {
                tableStates[config.containerId] = {
                    currentPage: 1,
                    pageSize: config.pageSize || DEFAULT_PAGE_SIZE,
                    sortKey: null,
                    sortDesc: false,
                    columnFilters: {}
                };
            }
            const state = tableStates[config.containerId];

            // Apply column filters first
            var filteredData = applyColumnFilters(config.data, config.columns, state.columnFilters);

            // Sort data if needed
            var sortedData = filteredData.slice();
            if (state.sortKey) {
                sortedData.sort((a, b) => {
                    const aVal = getNestedValue(a, state.sortKey);
                    const bVal = getNestedValue(b, state.sortKey);
                    return compareValues(aVal, bVal, state.sortDesc);
                });
            }

            // Paginate data
            const totalItems = sortedData.length;
            const startIndex = (state.currentPage - 1) * state.pageSize;
            const pageData = sortedData.slice(startIndex, startIndex + state.pageSize);

            // Clear container
            container.textContent = '';

            // Create table container
            const tableContainer = document.createElement('div');
            tableContainer.className = 'table-container';

            // Table header with title
            if (config.title) {
                const tableHeader = document.createElement('div');
                tableHeader.className = 'table-header';

                const title = document.createElement('h3');
                title.className = 'table-title';
                title.textContent = config.title;
                tableHeader.appendChild(title);

                // Show active filter count
                const activeCount = getActiveFilterCount(state.columnFilters);
                if (activeCount > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'col-filter-count';
                    badge.textContent = activeCount + ' filter' + (activeCount > 1 ? 's' : '');
                    badge.style.marginLeft = '8px';
                    badge.style.cursor = 'pointer';
                    badge.title = 'Click to clear all column filters';
                    badge.addEventListener('click', () => {
                        state.columnFilters = {};
                        state.currentPage = 1;
                        this.render(config);
                    });
                    title.appendChild(badge);
                }

                tableContainer.appendChild(tableHeader);
            }

            // Table wrapper (for scroll)
            const tableWrapper = document.createElement('div');
            tableWrapper.className = 'table-wrapper';

            // Create table
            const table = document.createElement('table');
            table.className = 'data-table';

            // Create header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');

            config.columns.forEach(col => {
                const th = document.createElement('th');

                // Label text
                const labelSpan = document.createElement('span');
                labelSpan.textContent = col.label;
                th.appendChild(labelSpan);

                // Sort indicator and click handler
                if (col.sortable !== false) {
                    th.style.cursor = 'pointer';

                    if (state.sortKey === col.key) {
                        th.className = state.sortDesc ? 'sorted-desc' : 'sorted-asc';
                    }

                    th.addEventListener('click', (e) => {
                        // Don't sort if clicking filter trigger/dropdown
                        if (e.target.closest('.col-filter-trigger') || e.target.closest('.col-filter-dropdown')) {
                            return;
                        }
                        if (state.sortKey === col.key) {
                            state.sortDesc = !state.sortDesc;
                        } else {
                            state.sortKey = col.key;
                            state.sortDesc = false;
                        }
                        state.currentPage = 1;
                        this.render(config);
                    });
                }

                // Column filter trigger
                if (col.filterable) {
                    const isActive = state.columnFilters && state.columnFilters[col.key];

                    const trigger = document.createElement('span');
                    trigger.className = 'col-filter-trigger' + (isActive ? ' active' : '');
                    // Using DOM approach for the SVG icon
                    const iconWrapper = document.createElement('span');
                    iconWrapper.innerHTML = FILTER_ICON_SVG; // Safe: static SVG constant, not user data
                    while (iconWrapper.firstChild) {
                        trigger.appendChild(iconWrapper.firstChild);
                    }
                    trigger.addEventListener('click', (e) => {
                        e.stopPropagation();

                        // Close other open dropdowns
                        document.querySelectorAll('.col-filter-dropdown.visible').forEach(d => {
                            if (d.parentElement !== th) d.classList.remove('visible');
                        });

                        // Toggle this dropdown
                        var dropdown = th.querySelector('.col-filter-dropdown');
                        if (!dropdown) {
                            dropdown = createColumnFilterDropdown(col, config.data, state, config, this.render.bind(this));
                            th.appendChild(dropdown);
                        }
                        dropdown.classList.toggle('visible');

                        // Focus input if present
                        const input = dropdown.querySelector('input[type="text"]');
                        if (input) setTimeout(() => input.focus(), 50);
                    });

                    th.appendChild(trigger);
                }

                headerRow.appendChild(th);
            });

            thead.appendChild(headerRow);
            table.appendChild(thead);

            // Create body
            const tbody = document.createElement('tbody');

            if (pageData.length === 0) {
                const emptyRow = document.createElement('tr');
                const emptyCell = document.createElement('td');
                emptyCell.colSpan = config.columns.length;
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'empty-state';
                const emptyIcon = document.createElement('div');
                emptyIcon.className = 'empty-state-icon';
                emptyIcon.textContent = '\uD83D\uDD0D';
                const emptyTitle = document.createElement('div');
                emptyTitle.className = 'empty-state-title';
                emptyTitle.textContent = 'No data found';
                const emptyDesc = document.createElement('div');
                emptyDesc.className = 'empty-state-description';
                emptyDesc.textContent = 'Try adjusting your filters';
                emptyDiv.appendChild(emptyIcon);
                emptyDiv.appendChild(emptyTitle);
                emptyDiv.appendChild(emptyDesc);
                emptyCell.appendChild(emptyDiv);
                emptyRow.appendChild(emptyCell);
                tbody.appendChild(emptyRow);
            } else {
                pageData.forEach(row => {
                    const tr = document.createElement('tr');

                    if (config.getRowClass) {
                        const rowClass = config.getRowClass(row);
                        if (rowClass) tr.className = rowClass;
                    }

                    if (config.onRowClick) {
                        tr.style.cursor = 'pointer';
                        tr.addEventListener('click', () => config.onRowClick(row));
                    }

                    config.columns.forEach(col => {
                        const td = document.createElement('td');
                        const value = getNestedValue(row, col.key);
                        // formatCell returns escaped HTML for display
                        // Data source is local JSON from Graph API, not user input
                        td.innerHTML = formatCell(value, col, row);

                        if (col.className) {
                            td.className = col.className;
                        }

                        tr.appendChild(td);
                    });

                    tbody.appendChild(tr);
                });
            }

            table.appendChild(tbody);
            tableWrapper.appendChild(table);
            tableContainer.appendChild(tableWrapper);

            // Add pagination
            if (totalItems > state.pageSize) {
                const pagination = createPagination(state, totalItems, (newPage) => {
                    state.currentPage = newPage;
                    this.render(config);
                });
                tableContainer.appendChild(pagination);
            }

            container.appendChild(tableContainer);

            // Store reference to current data for export
            container.dataset.tableData = JSON.stringify(sortedData);
            container.dataset.tableColumns = JSON.stringify(config.columns);
        },

        /**
         * Resets a table's state (pagination, sorting, column filters).
         *
         * @param {string} containerId - ID of the table container
         */
        reset(containerId) {
            if (tableStates[containerId]) {
                tableStates[containerId].currentPage = 1;
                tableStates[containerId].sortKey = null;
                tableStates[containerId].sortDesc = false;
                tableStates[containerId].columnFilters = {};
            }
        },

        /**
         * Gets the current data from a rendered table.
         *
         * @param {string} containerId - ID of the table container
         * @returns {Array} The table's current data
         */
        getData(containerId) {
            const container = document.getElementById(containerId);
            if (!container || !container.dataset.tableData) return [];
            return JSON.parse(container.dataset.tableData);
        },

        /**
         * Gets the column configuration from a rendered table.
         *
         * @param {string} containerId - ID of the table container
         * @returns {Array} The table's column configuration
         */
        getColumns(containerId) {
            const container = document.getElementById(containerId);
            if (!container || !container.dataset.tableColumns) return [];
            return JSON.parse(container.dataset.tableColumns);
        },

        /**
         * Common cell formatters for reuse.
         * Formatters return HTML strings for display. Data comes from
         * locally-collected Graph API JSON, not user input.
         */
        formatters: {
            date(value) {
                if (!value) return '<span class="text-muted">--</span>';
                try {
                    const date = new Date(value);
                    return escapeHtml(date.toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    }));
                } catch {
                    return '<span class="text-muted">--</span>';
                }
            },

            datetime(value) {
                if (!value) return '<span class="text-muted">--</span>';
                try {
                    const date = new Date(value);
                    return escapeHtml(date.toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    }));
                } catch {
                    return '<span class="text-muted">--</span>';
                }
            },

            enabledStatus(value) {
                return value
                    ? '<span class="status-dot enabled"></span>Enabled'
                    : '<span class="status-dot disabled"></span>Disabled';
            },

            compliance(value) {
                const classes = {
                    'compliant': 'badge-success',
                    'noncompliant': 'badge-critical',
                    'unknown': 'badge-neutral'
                };
                return '<span class="badge ' + (classes[value] || 'badge-neutral') + '">' + escapeHtml(value || 'unknown') + '</span>';
            },

            severity(value) {
                const classes = {
                    'high': 'badge-critical',
                    'medium': 'badge-warning',
                    'low': 'badge-neutral',
                    'informational': 'badge-info'
                };
                return '<span class="badge ' + (classes[value] || 'badge-neutral') + '">' + escapeHtml(value || 'unknown') + '</span>';
            },

            percentage(value) {
                if (value === null || value === undefined) return '--';
                const num = Number(value);
                var colorClass = 'success';
                if (num < 50) colorClass = 'critical';
                else if (num < 75) colorClass = 'warning';

                return '<div style="display: flex; align-items: center; gap: 8px;">' +
                    '<div class="progress-bar" style="flex: 1;">' +
                    '<div class="progress-fill ' + colorClass + '" style="width: ' + num + '%;"></div>' +
                    '</div>' +
                    '<span>' + num + '%</span>' +
                    '</div>';
            },

            flags(value) {
                if (!value || !Array.isArray(value) || value.length === 0) {
                    return '<span class="text-muted">--</span>';
                }
                return value.map(f => '<span class="flag flag-' + escapeHtml(f) + '">' + escapeHtml(f) + '</span>').join(' ');
            },

            inactiveDays(value) {
                if (value === null || value === undefined) {
                    return '<span class="text-muted">--</span>';
                }
                var colorClass = '';
                if (value >= 90) colorClass = 'text-critical';
                else if (value >= 60) colorClass = 'text-warning';
                return '<span class="' + colorClass + '">' + escapeHtml(String(value)) + '</span>';
            },

            resultStatus(value) {
                const classes = {
                    'success': 'badge-success',
                    'failure': 'badge-critical',
                    'timeout': 'badge-warning'
                };
                return '<span class="badge ' + (classes[value] || 'badge-neutral') + '">' + escapeHtml(value || 'unknown') + '</span>';
            }
        }
    };

})();

// Export for use in other modules
window.Tables = Tables;
