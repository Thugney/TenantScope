/**
 * ============================================================================
 * M365 Tenant Toolkit
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * TABLES MODULE
 *
 * Provides generic table rendering with sorting, pagination, and row expansion.
 * All tables in the dashboard use this module for consistent behavior.
 *
 * Usage:
 *   Tables.render({
 *       containerId: 'my-table',
 *       data: [...],
 *       columns: [...],
 *       pageSize: 50
 *   });
 */

const Tables = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Default number of rows per page */
    const DEFAULT_PAGE_SIZE = 50;

    /** Table state storage (pagination, sort) by container ID */
    const tableStates = {};

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

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
     * Compares two values for sorting.
     *
     * @param {any} a - First value
     * @param {any} b - Second value
     * @param {boolean} desc - Sort descending if true
     * @returns {number} Comparison result (-1, 0, 1)
     */
    function compareValues(a, b, desc) {
        // Handle null/undefined
        if (a === null || a === undefined) a = '';
        if (b === null || b === undefined) b = '';

        // Compare strings case-insensitively
        if (typeof a === 'string') a = a.toLowerCase();
        if (typeof b === 'string') b = b.toLowerCase();

        let result = 0;
        if (a < b) result = -1;
        else if (a > b) result = 1;

        return desc ? -result : result;
    }

    /**
     * Formats a cell value based on column configuration.
     *
     * @param {any} value - The raw value
     * @param {object} column - Column configuration
     * @param {object} row - The entire row data
     * @returns {string} HTML string for the cell content
     */
    function formatCell(value, column, row) {
        // Use custom formatter if provided
        if (column.formatter) {
            return column.formatter(value, row);
        }

        // Handle null/undefined
        if (value === null || value === undefined) {
            return '<span class="text-muted">--</span>';
        }

        // Handle arrays (like flags)
        if (Array.isArray(value)) {
            if (value.length === 0) return '<span class="text-muted">--</span>';
            return value.map(v => `<span class="flag flag-${v}">${v}</span>`).join(' ');
        }

        // Handle booleans
        if (typeof value === 'boolean') {
            return value
                ? '<span class="text-success">Yes</span>'
                : '<span class="text-critical">No</span>';
        }

        // Default: escape HTML and return
        return escapeHtml(String(value));
    }

    /**
     * Escapes HTML special characters to prevent XSS.
     *
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Creates pagination controls.
     *
     * @param {object} state - Current table state
     * @param {number} totalItems - Total number of items
     * @param {Function} onPageChange - Callback when page changes
     * @returns {HTMLElement} Pagination element
     */
    function createPagination(state, totalItems, onPageChange) {
        const totalPages = Math.ceil(totalItems / state.pageSize);
        const currentPage = state.currentPage;

        const pagination = document.createElement('div');
        pagination.className = 'pagination';

        // Info text
        const info = document.createElement('span');
        info.className = 'pagination-info';
        const start = (currentPage - 1) * state.pageSize + 1;
        const end = Math.min(currentPage * state.pageSize, totalItems);
        info.textContent = `Showing ${start}-${end} of ${totalItems}`;
        pagination.appendChild(info);

        // Page controls
        const controls = document.createElement('div');
        controls.className = 'pagination-controls';

        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-btn';
        prevBtn.textContent = 'Previous';
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
        controls.appendChild(prevBtn);

        // Page number buttons (show max 5)
        const maxButtons = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);

        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = 'pagination-btn' + (i === currentPage ? ' active' : '');
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => onPageChange(i));
            controls.appendChild(pageBtn);
        }

        // Next button
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
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Renders a data table with sorting and pagination.
         *
         * @param {object} config - Table configuration
         * @param {string} config.containerId - ID of container element
         * @param {Array} config.data - Array of data objects
         * @param {object[]} config.columns - Column definitions
         * @param {string} config.columns[].key - Data key (supports dot notation)
         * @param {string} config.columns[].label - Column header text
         * @param {boolean} [config.columns[].sortable] - Enable sorting
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
                    sortDesc: false
                };
            }
            const state = tableStates[config.containerId];

            // Sort data if needed
            let sortedData = [...config.data];
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
            container.innerHTML = '';

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
                th.textContent = col.label;

                if (col.sortable !== false) {
                    th.style.cursor = 'pointer';

                    if (state.sortKey === col.key) {
                        th.className = state.sortDesc ? 'sorted-desc' : 'sorted-asc';
                    }

                    th.addEventListener('click', () => {
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
                emptyCell.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">&#128269;</div>
                        <div class="empty-state-title">No data found</div>
                        <div class="empty-state-description">Try adjusting your filters</div>
                    </div>
                `;
                emptyRow.appendChild(emptyCell);
                tbody.appendChild(emptyRow);
            } else {
                pageData.forEach(row => {
                    const tr = document.createElement('tr');

                    // Add custom row class if provided
                    if (config.getRowClass) {
                        const rowClass = config.getRowClass(row);
                        if (rowClass) tr.className = rowClass;
                    }

                    // Add row click handler
                    if (config.onRowClick) {
                        tr.style.cursor = 'pointer';
                        tr.addEventListener('click', () => config.onRowClick(row));
                    }

                    config.columns.forEach(col => {
                        const td = document.createElement('td');
                        const value = getNestedValue(row, col.key);
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
         * Resets a table's state (pagination, sorting).
         *
         * @param {string} containerId - ID of the table container
         */
        reset(containerId) {
            if (tableStates[containerId]) {
                tableStates[containerId].currentPage = 1;
                tableStates[containerId].sortKey = null;
                tableStates[containerId].sortDesc = false;
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
         */
        formatters: {
            /**
             * Formats a date string.
             */
            date(value) {
                if (!value) return '<span class="text-muted">--</span>';
                try {
                    const date = new Date(value);
                    return date.toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                } catch {
                    return '<span class="text-muted">--</span>';
                }
            },

            /**
             * Formats a datetime string.
             */
            datetime(value) {
                if (!value) return '<span class="text-muted">--</span>';
                try {
                    const date = new Date(value);
                    return date.toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } catch {
                    return '<span class="text-muted">--</span>';
                }
            },

            /**
             * Formats an account enabled status.
             */
            enabledStatus(value) {
                return value
                    ? '<span class="status-dot enabled"></span>Enabled'
                    : '<span class="status-dot disabled"></span>Disabled';
            },

            /**
             * Formats compliance state with badge.
             */
            compliance(value) {
                const classes = {
                    'compliant': 'badge-success',
                    'noncompliant': 'badge-critical',
                    'unknown': 'badge-neutral'
                };
                return `<span class="badge ${classes[value] || 'badge-neutral'}">${value || 'unknown'}</span>`;
            },

            /**
             * Formats severity level with badge.
             */
            severity(value) {
                const classes = {
                    'high': 'badge-critical',
                    'medium': 'badge-warning',
                    'low': 'badge-neutral',
                    'informational': 'badge-info'
                };
                return `<span class="badge ${classes[value] || 'badge-neutral'}">${value || 'unknown'}</span>`;
            },

            /**
             * Formats a percentage as a progress bar.
             */
            percentage(value) {
                if (value === null || value === undefined) return '--';
                const num = Number(value);
                let colorClass = 'success';
                if (num < 50) colorClass = 'critical';
                else if (num < 75) colorClass = 'warning';

                return `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div class="progress-bar" style="flex: 1;">
                            <div class="progress-fill ${colorClass}" style="width: ${num}%;"></div>
                        </div>
                        <span>${num}%</span>
                    </div>
                `;
            },

            /**
             * Formats flags array.
             */
            flags(value) {
                if (!value || !Array.isArray(value) || value.length === 0) {
                    return '<span class="text-muted">--</span>';
                }
                return value.map(f => `<span class="flag flag-${f}">${f}</span>`).join(' ');
            },

            /**
             * Formats a number with optional coloring for inactive days.
             */
            inactiveDays(value) {
                if (value === null || value === undefined) {
                    return '<span class="text-muted">--</span>';
                }
                let colorClass = '';
                if (value >= 90) colorClass = 'text-critical';
                else if (value >= 60) colorClass = 'text-warning';
                return `<span class="${colorClass}">${value}</span>`;
            }
        }
    };

})();

// Export for use in other modules
window.Tables = Tables;
