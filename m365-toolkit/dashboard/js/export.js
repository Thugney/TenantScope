/**
 * ============================================================================
 * M365 Tenant Toolkit
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * EXPORT MODULE
 *
 * Provides CSV export functionality for data tables.
 * Exports the current filtered view with proper escaping.
 *
 * Usage:
 *   Export.toCSV(data, columns, filename);
 */

const Export = (function() {
    'use strict';

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
     * Escapes a value for CSV format.
     * - Wraps in quotes if contains comma, quote, or newline
     * - Escapes internal quotes by doubling them
     *
     * @param {any} value - Value to escape
     * @returns {string} CSV-safe string
     */
    function escapeCSV(value) {
        if (value === null || value === undefined) {
            return '';
        }

        // Convert arrays to comma-separated string
        if (Array.isArray(value)) {
            value = value.join(', ');
        }

        // Convert to string
        let str = String(value);

        // Check if escaping is needed
        const needsQuotes = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r');

        if (needsQuotes) {
            // Escape internal quotes by doubling them
            str = str.replace(/"/g, '""');
            // Wrap in quotes
            str = `"${str}"`;
        }

        return str;
    }

    /**
     * Generates a filename with current date.
     *
     * @param {string} baseName - Base name for the file
     * @returns {string} Filename with date suffix
     */
    function generateFilename(baseName) {
        const date = new Date();
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        return `${baseName}-${dateStr}.csv`;
    }

    /**
     * Triggers a file download in the browser.
     *
     * @param {string} content - File content
     * @param {string} filename - File name
     * @param {string} mimeType - MIME type
     */
    function downloadFile(content, filename, mimeType) {
        // Create blob with BOM for Excel compatibility
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + content], { type: mimeType + ';charset=utf-8' });

        // Create download link
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;

        // Trigger download
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Exports data to CSV file and triggers download.
         *
         * @param {Array} data - Array of data objects to export
         * @param {object[]} columns - Column definitions with key and label
         * @param {string} [filename] - Custom filename (without extension)
         */
        toCSV(data, columns, filename) {
            if (!data || !Array.isArray(data) || data.length === 0) {
                console.warn('Export.toCSV: No data to export');
                alert('No data to export');
                return;
            }

            if (!columns || !Array.isArray(columns) || columns.length === 0) {
                console.warn('Export.toCSV: No columns defined');
                return;
            }

            // Build header row
            const headers = columns.map(col => escapeCSV(col.label));
            const headerRow = headers.join(',');

            // Build data rows
            const dataRows = data.map(item => {
                return columns.map(col => {
                    const value = getNestedValue(item, col.key);
                    return escapeCSV(value);
                }).join(',');
            });

            // Combine into CSV content
            const csvContent = [headerRow, ...dataRows].join('\r\n');

            // Generate filename and download
            const finalFilename = generateFilename(filename || 'm365-export');
            downloadFile(csvContent, finalFilename, 'text/csv');

            console.log(`Export.toCSV: Exported ${data.length} rows to ${finalFilename}`);
        },

        /**
         * Exports the current data from a rendered table.
         *
         * @param {string} tableContainerId - ID of the table container
         * @param {string} [filename] - Custom filename (without extension)
         */
        fromTable(tableContainerId, filename) {
            const data = Tables.getData(tableContainerId);
            const columns = Tables.getColumns(tableContainerId);

            if (!data || data.length === 0) {
                alert('No data to export');
                return;
            }

            // Filter columns to only exportable ones (exclude internal columns)
            const exportColumns = columns.filter(col => col.key && col.label);

            this.toCSV(data, exportColumns, filename);
        },

        /**
         * Binds export button to a table.
         * Looks for button with ID: {tableContainerId}-export
         *
         * @param {string} tableContainerId - ID of the table container
         * @param {string} [filename] - Custom filename (without extension)
         */
        bindExportButton(tableContainerId, filename) {
            const buttonId = tableContainerId.replace('-table', '') + '-filter-export';
            const button = document.getElementById(buttonId);

            if (button) {
                button.addEventListener('click', () => {
                    this.fromTable(tableContainerId, filename);
                });
            }
        },

        /**
         * Exports raw data object to JSON file.
         *
         * @param {any} data - Data to export
         * @param {string} [filename] - Custom filename (without extension)
         */
        toJSON(data, filename) {
            const content = JSON.stringify(data, null, 2);
            const finalFilename = generateFilename(filename || 'm365-export') + '.json';
            downloadFile(content, finalFilename, 'application/json');
        }
    };

})();

// Export for use in other modules
window.Export = Export;
