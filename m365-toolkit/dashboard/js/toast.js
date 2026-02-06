/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * TOAST NOTIFICATION MODULE
 *
 * Provides non-blocking notifications for user feedback on operations.
 * Supports success, error, warning, and info toast types.
 *
 * Usage:
 *   Toast.success('Operation completed', 'Your changes have been saved.');
 *   Toast.error('Error', 'Failed to load data.');
 */

const Toast = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Container element for toasts */
    let container = null;

    /** Default duration in milliseconds */
    const DEFAULT_DURATION = 5000;

    /** Currently active toasts */
    const activeToasts = [];

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Ensures the toast container exists.
     */
    function ensureContainer() {
        if (!container) {
            container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                container.className = 'toast-container';
                container.setAttribute('role', 'alert');
                container.setAttribute('aria-live', 'polite');
                document.body.appendChild(container);
            }
        }
        return container;
    }

    /**
     * Creates an SVG icon for the toast type.
     * @param {string} type - Toast type
     * @returns {SVGElement} SVG icon element
     */
    function createIcon(type) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');

        let path;
        switch (type) {
            case 'success':
                path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M22 11.08V12a10 10 0 1 1-5.93-9.14');
                svg.appendChild(path);
                const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', '22 4 12 14.01 9 11.01');
                svg.appendChild(polyline);
                break;

            case 'error':
                const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle1.setAttribute('cx', '12');
                circle1.setAttribute('cy', '12');
                circle1.setAttribute('r', '10');
                svg.appendChild(circle1);
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '15');
                line1.setAttribute('y1', '9');
                line1.setAttribute('x2', '9');
                line1.setAttribute('y2', '15');
                svg.appendChild(line1);
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '9');
                line2.setAttribute('y1', '9');
                line2.setAttribute('x2', '15');
                line2.setAttribute('y2', '15');
                svg.appendChild(line2);
                break;

            case 'warning':
                path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z');
                svg.appendChild(path);
                const line3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line3.setAttribute('x1', '12');
                line3.setAttribute('y1', '9');
                line3.setAttribute('x2', '12');
                line3.setAttribute('y2', '13');
                svg.appendChild(line3);
                const line4 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line4.setAttribute('x1', '12');
                line4.setAttribute('y1', '17');
                line4.setAttribute('x2', '12.01');
                line4.setAttribute('y2', '17');
                svg.appendChild(line4);
                break;

            case 'info':
            default:
                const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle2.setAttribute('cx', '12');
                circle2.setAttribute('cy', '12');
                circle2.setAttribute('r', '10');
                svg.appendChild(circle2);
                const line5 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line5.setAttribute('x1', '12');
                line5.setAttribute('y1', '16');
                line5.setAttribute('x2', '12');
                line5.setAttribute('y2', '12');
                svg.appendChild(line5);
                const line6 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line6.setAttribute('x1', '12');
                line6.setAttribute('y1', '8');
                line6.setAttribute('x2', '12.01');
                line6.setAttribute('y2', '8');
                svg.appendChild(line6);
                break;
        }

        return svg;
    }

    /**
     * Shows a toast notification.
     * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
     * @param {string} title - Toast title
     * @param {string} message - Toast message
     * @param {object} options - Additional options
     * @returns {HTMLElement} The toast element
     */
    function showToast(type, title, message, options) {
        const opts = Object.assign({
            duration: DEFAULT_DURATION,
            closeable: true
        }, options || {});

        ensureContainer();

        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.setAttribute('role', 'alert');

        // Icon
        const iconDiv = document.createElement('div');
        iconDiv.className = 'toast-icon';
        iconDiv.appendChild(createIcon(type));
        toast.appendChild(iconDiv);

        // Content
        const content = document.createElement('div');
        content.className = 'toast-content';

        const titleEl = document.createElement('div');
        titleEl.className = 'toast-title';
        titleEl.textContent = title;
        content.appendChild(titleEl);

        if (message) {
            const messageEl = document.createElement('div');
            messageEl.className = 'toast-message';
            messageEl.textContent = message;
            content.appendChild(messageEl);
        }

        toast.appendChild(content);

        // Close button
        if (opts.closeable) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.type = 'button';
            closeBtn.textContent = '\u00D7';
            closeBtn.setAttribute('aria-label', 'Close notification');
            closeBtn.addEventListener('click', function() {
                dismissToast(toast);
            });
            toast.appendChild(closeBtn);
        }

        // Add to container
        container.appendChild(toast);
        activeToasts.push(toast);

        // Auto-dismiss after duration
        if (opts.duration > 0) {
            toast.dismissTimeout = setTimeout(function() {
                dismissToast(toast);
            }, opts.duration);
        }

        return toast;
    }

    /**
     * Dismisses a toast notification.
     * @param {HTMLElement} toast - Toast element to dismiss
     */
    function dismissToast(toast) {
        if (!toast || !toast.parentNode) return;

        // Clear timeout if exists
        if (toast.dismissTimeout) {
            clearTimeout(toast.dismissTimeout);
        }

        // Add exit animation
        toast.classList.add('toast-exit');

        // Remove after animation
        setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }

            // Remove from active toasts
            const index = activeToasts.indexOf(toast);
            if (index > -1) {
                activeToasts.splice(index, 1);
            }
        }, 300);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Shows a success toast.
         * @param {string} title - Toast title
         * @param {string} message - Toast message (optional)
         * @param {object} options - Additional options (optional)
         * @returns {HTMLElement} The toast element
         */
        success: function(title, message, options) {
            return showToast('success', title, message, options);
        },

        /**
         * Shows an error toast.
         * @param {string} title - Toast title
         * @param {string} message - Toast message (optional)
         * @param {object} options - Additional options (optional)
         * @returns {HTMLElement} The toast element
         */
        error: function(title, message, options) {
            return showToast('error', title, message, Object.assign({
                duration: 8000 // Errors stay longer
            }, options || {}));
        },

        /**
         * Shows a warning toast.
         * @param {string} title - Toast title
         * @param {string} message - Toast message (optional)
         * @param {object} options - Additional options (optional)
         * @returns {HTMLElement} The toast element
         */
        warning: function(title, message, options) {
            return showToast('warning', title, message, Object.assign({
                duration: 6000
            }, options || {}));
        },

        /**
         * Shows an info toast.
         * @param {string} title - Toast title
         * @param {string} message - Toast message (optional)
         * @param {object} options - Additional options (optional)
         * @returns {HTMLElement} The toast element
         */
        info: function(title, message, options) {
            return showToast('info', title, message, options);
        },

        /**
         * Dismisses all active toasts.
         */
        dismissAll: function() {
            activeToasts.slice().forEach(function(toast) {
                dismissToast(toast);
            });
        },

        /**
         * Dismisses a specific toast.
         * @param {HTMLElement} toast - Toast element to dismiss
         */
        dismiss: function(toast) {
            dismissToast(toast);
        }
    };

})();

// Export for use in other modules
window.Toast = Toast;
