/**
 * ============================================================================
 * TenantScope - Action Utilities
 * ============================================================================
 * Shared helpers for action buttons (copying commands, escaping values).
 */

const ActionUtils = (function() {
    'use strict';

    function escapeSingleQuotes(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/'/g, "''");
    }

    function copyText(text) {
        if (!text) {
            return Promise.reject(new Error('No text to copy'));
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise(function(resolve, reject) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.top = '-1000px';
                textarea.style.left = '-1000px';
                document.body.appendChild(textarea);
                textarea.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (ok) resolve();
                else reject(new Error('Copy failed'));
            } catch (err) {
                reject(err);
            }
        });
    }

    return {
        copyText: copyText,
        escapeSingleQuotes: escapeSingleQuotes
    };
})();

window.ActionUtils = ActionUtils;
