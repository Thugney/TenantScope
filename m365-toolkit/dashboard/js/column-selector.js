/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * COLUMN SELECTOR MODULE
 *
 * Renders a "Columns" button that opens a checkbox dropdown panel for toggling
 * table column visibility. Persists selections to localStorage.
 */

const ColumnSelector = (function() {
    'use strict';

    /**
     * Creates a column selector control.
     *
     * @param {object} config
     * @param {string} config.containerId - DOM container ID to render into
     * @param {string} config.storageKey - localStorage key for persistence
     * @param {Array}  config.allColumns - [{key, label}] all available columns
     * @param {string[]} config.defaultVisible - Array of column keys visible by default
     * @param {Function} config.onColumnsChanged - Called with array of visible column keys
     * @returns {object} Controller with getVisible() method
     */
    function create(config) {
        var container = document.getElementById(config.containerId);
        if (!container) return { getVisible: function() { return config.defaultVisible; } };

        // Load saved state or use defaults
        var visible = loadState(config.storageKey, config.defaultVisible);

        var wrapper = document.createElement('div');
        wrapper.className = 'column-selector';

        // Toggle button
        var btn = document.createElement('button');
        btn.className = 'column-selector-btn';
        btn.type = 'button';
        btn.textContent = 'Columns';
        wrapper.appendChild(btn);

        // Dropdown panel
        var panel = document.createElement('div');
        panel.className = 'column-selector-panel';
        panel.style.display = 'none';

        // Select All / Deselect All row
        var actionsRow = document.createElement('div');
        actionsRow.className = 'column-selector-actions';

        var selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button';
        selectAllBtn.className = 'column-selector-action';
        selectAllBtn.textContent = 'Select All';
        selectAllBtn.addEventListener('click', function() {
            var checkboxes = panel.querySelectorAll('input[type="checkbox"]');
            for (var i = 0; i < checkboxes.length; i++) {
                checkboxes[i].checked = true;
            }
            updateVisible();
        });

        var deselectAllBtn = document.createElement('button');
        deselectAllBtn.type = 'button';
        deselectAllBtn.className = 'column-selector-action';
        deselectAllBtn.textContent = 'Deselect All';
        deselectAllBtn.addEventListener('click', function() {
            var checkboxes = panel.querySelectorAll('input[type="checkbox"]');
            for (var i = 0; i < checkboxes.length; i++) {
                checkboxes[i].checked = false;
            }
            updateVisible();
        });

        actionsRow.appendChild(selectAllBtn);
        actionsRow.appendChild(deselectAllBtn);
        panel.appendChild(actionsRow);

        // Column checkboxes
        for (var i = 0; i < config.allColumns.length; i++) {
            var col = config.allColumns[i];
            var label = document.createElement('label');
            label.className = 'column-selector-item';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = col.key;
            checkbox.checked = visible.indexOf(col.key) !== -1;
            checkbox.addEventListener('change', updateVisible);

            var text = document.createTextNode(col.label);
            label.appendChild(checkbox);
            label.appendChild(text);
            panel.appendChild(label);
        }

        wrapper.appendChild(panel);
        container.appendChild(wrapper);

        // Toggle panel visibility
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = panel.style.display !== 'none';
            panel.style.display = isOpen ? 'none' : 'block';
        });

        // Close panel when clicking outside
        document.addEventListener('click', function(e) {
            if (!wrapper.contains(e.target)) {
                panel.style.display = 'none';
            }
        });

        function updateVisible() {
            var checkboxes = panel.querySelectorAll('input[type="checkbox"]');
            var newVisible = [];
            for (var j = 0; j < checkboxes.length; j++) {
                if (checkboxes[j].checked) {
                    newVisible.push(checkboxes[j].value);
                }
            }
            visible = newVisible;
            saveState(config.storageKey, visible);
            if (config.onColumnsChanged) {
                config.onColumnsChanged(visible);
            }
        }

        // Notify initial state
        if (config.onColumnsChanged) {
            config.onColumnsChanged(visible);
        }

        return {
            getVisible: function() { return visible.slice(); },
            destroy: function() {
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
            }
        };
    }

    /**
     * Loads column visibility state from localStorage.
     */
    function loadState(storageKey, defaults) {
        if (!storageKey) return defaults.slice();
        try {
            var saved = localStorage.getItem(storageKey);
            if (saved) {
                var parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {
            // Ignore parse errors
        }
        return defaults.slice();
    }

    /**
     * Saves column visibility state to localStorage.
     */
    function saveState(storageKey, visible) {
        if (!storageKey) return;
        try {
            localStorage.setItem(storageKey, JSON.stringify(visible));
        } catch (e) {
            // Ignore storage errors
        }
    }

    return {
        create: create
    };

})();

window.ColumnSelector = ColumnSelector;
