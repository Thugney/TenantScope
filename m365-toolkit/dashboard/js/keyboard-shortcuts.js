/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * KEYBOARD SHORTCUTS MODULE
 *
 * Provides keyboard navigation shortcuts for power users.
 * Press '?' to show available shortcuts.
 *
 * Shortcuts:
 *   Ctrl+K / Cmd+K - Open global search
 *   g then o - Go to Overview
 *   g then u - Go to Users
 *   g then d - Go to Devices
 *   g then l - Go to Licenses
 *   g then s - Go to Security
 *   g then t - Go to Teams
 *   ? - Show shortcuts help
 *   Escape - Close modals/overlays
 */

const KeyboardShortcuts = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Pending 'g' key for navigation */
    let pendingNav = false;

    /** Timeout for pending navigation */
    let navTimeout = null;

    /** Help modal element */
    let helpModal = null;

    /** Whether shortcuts are enabled */
    let enabled = true;

    /**
     * Navigation shortcuts (press 'g' then the key).
     */
    const navShortcuts = {
        'o': { page: 'overview', label: 'Overview' },
        'u': { page: 'users', label: 'Users' },
        'd': { page: 'devices', label: 'Devices' },
        'l': { page: 'licenses', label: 'Licenses' },
        's': { page: 'security', label: 'Security' },
        't': { page: 'teams', label: 'Teams' },
        'g': { page: 'guests', label: 'Guests' },
        'p': { page: 'sharepoint', label: 'SharePoint' },
        'a': { page: 'audit-logs', label: 'Audit Logs' },
        'r': { page: 'report', label: 'Report' }
    };

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Checks if an element is an input field.
     * @param {Element} element - The element to check
     * @returns {boolean} True if element is an input field
     */
    function isInputField(element) {
        if (!element) return false;
        var tagName = element.tagName.toLowerCase();
        return tagName === 'input' ||
               tagName === 'textarea' ||
               tagName === 'select' ||
               element.isContentEditable;
    }

    /**
     * Creates the help modal.
     */
    function createHelpModal() {
        helpModal = document.createElement('div');
        helpModal.id = 'keyboard-shortcuts-modal';
        helpModal.className = 'keyboard-shortcuts-modal';
        helpModal.setAttribute('role', 'dialog');
        helpModal.setAttribute('aria-modal', 'true');
        helpModal.setAttribute('aria-labelledby', 'shortcuts-title');

        var backdrop = document.createElement('div');
        backdrop.className = 'keyboard-shortcuts-backdrop';
        backdrop.addEventListener('click', hideHelp);
        helpModal.appendChild(backdrop);

        var dialog = document.createElement('div');
        dialog.className = 'keyboard-shortcuts-dialog';

        var header = document.createElement('div');
        header.className = 'keyboard-shortcuts-header';

        var title = document.createElement('h2');
        title.id = 'shortcuts-title';
        title.className = 'keyboard-shortcuts-title';
        title.textContent = 'Keyboard Shortcuts';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'keyboard-shortcuts-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '\u00D7';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', hideHelp);
        header.appendChild(closeBtn);

        dialog.appendChild(header);

        var content = document.createElement('div');
        content.className = 'keyboard-shortcuts-content';

        // Global shortcuts section
        var globalSection = createSection('Global', [
            { keys: ['Ctrl', 'K'], desc: 'Open search' },
            { keys: ['?'], desc: 'Show this help' },
            { keys: ['Esc'], desc: 'Close modals' }
        ]);
        content.appendChild(globalSection);

        // Navigation shortcuts section
        var navItems = Object.keys(navShortcuts).map(function(key) {
            return { keys: ['g', key], desc: 'Go to ' + navShortcuts[key].label };
        });
        var navSection = createSection('Navigation', navItems);
        content.appendChild(navSection);

        dialog.appendChild(content);
        helpModal.appendChild(dialog);
        document.body.appendChild(helpModal);
    }

    /**
     * Creates a shortcuts section.
     * @param {string} title - Section title
     * @param {Array} items - Array of {keys: [], desc: string}
     * @returns {HTMLElement} Section element
     */
    function createSection(title, items) {
        var section = document.createElement('div');
        section.className = 'keyboard-shortcuts-section';

        var sectionTitle = document.createElement('h3');
        sectionTitle.className = 'keyboard-shortcuts-section-title';
        sectionTitle.textContent = title;
        section.appendChild(sectionTitle);

        var list = document.createElement('dl');
        list.className = 'keyboard-shortcuts-list';

        items.forEach(function(item) {
            var row = document.createElement('div');
            row.className = 'keyboard-shortcuts-row';

            var dt = document.createElement('dt');
            dt.className = 'keyboard-shortcuts-keys';
            item.keys.forEach(function(key, index) {
                var kbd = document.createElement('kbd');
                kbd.textContent = key;
                dt.appendChild(kbd);
                if (index < item.keys.length - 1) {
                    var plus = document.createTextNode(' + ');
                    dt.appendChild(plus);
                }
            });
            row.appendChild(dt);

            var dd = document.createElement('dd');
            dd.className = 'keyboard-shortcuts-desc';
            dd.textContent = item.desc;
            row.appendChild(dd);

            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    /**
     * Shows the help modal.
     */
    function showHelp() {
        if (!helpModal) {
            createHelpModal();
        }
        helpModal.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hides the help modal.
     */
    function hideHelp() {
        if (helpModal) {
            helpModal.classList.remove('visible');
            document.body.style.overflow = '';
        }
    }

    /**
     * Handles keydown events.
     * @param {KeyboardEvent} e - Keyboard event
     */
    function handleKeyDown(e) {
        if (!enabled) return;

        // Ignore if typing in an input field
        if (isInputField(e.target)) return;

        // Check for pending navigation
        if (pendingNav) {
            clearTimeout(navTimeout);
            pendingNav = false;

            var shortcut = navShortcuts[e.key.toLowerCase()];
            if (shortcut) {
                e.preventDefault();
                window.location.hash = '#' + shortcut.page;
            }
            return;
        }

        // Handle shortcuts
        switch (e.key) {
            case '?':
                e.preventDefault();
                showHelp();
                break;

            case 'g':
                // Start navigation sequence
                pendingNav = true;
                navTimeout = setTimeout(function() {
                    pendingNav = false;
                }, 1000);
                break;

            case 'Escape':
                // Close help modal if visible
                if (helpModal && helpModal.classList.contains('visible')) {
                    e.preventDefault();
                    hideHelp();
                }
                break;
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Initializes keyboard shortcuts.
         */
        init: function() {
            document.addEventListener('keydown', handleKeyDown);
        },

        /**
         * Shows the help modal.
         */
        showHelp: showHelp,

        /**
         * Hides the help modal.
         */
        hideHelp: hideHelp,

        /**
         * Enables keyboard shortcuts.
         */
        enable: function() {
            enabled = true;
        },

        /**
         * Disables keyboard shortcuts.
         */
        disable: function() {
            enabled = false;
        }
    };

})();

// Export for use in other modules
window.KeyboardShortcuts = KeyboardShortcuts;
