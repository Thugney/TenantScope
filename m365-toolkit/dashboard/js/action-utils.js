/**
 * ============================================================================
 * TenantScope - Action Utilities
 * ============================================================================
 * Shared helpers for action buttons (copying commands, escaping values).
 */

const ActionUtils = (function() {
    'use strict';

    var profileRoutingInitialized = false;

    function normalize(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function isGuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalize(value));
    }

    function isLikelyUpn(value) {
        var text = normalize(value);
        return text.indexOf('@') > 0 && !/\s/.test(text);
    }

    function ensureEntityIndex() {
        if (typeof EntityIndex === 'undefined') return null;
        var state = EntityIndex.getState ? EntityIndex.getState() : null;
        if (!state && EntityIndex.buildFromDataLoader) {
            try {
                EntityIndex.buildFromDataLoader();
            } catch (err) {
                console.warn('ActionUtils: Failed to build entity index', err && err.message ? err.message : err);
            }
        }
        return EntityIndex.getState ? EntityIndex.getState() : null;
    }

    function escapeSingleQuotes(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/'/g, "''");
    }

    function getUserProfileTarget(target, options) {
        options = options || {};
        if (!target) return null;

        if (typeof target === 'string') {
            var cleaned = normalize(target);
            if (!cleaned) return null;

            ensureEntityIndex();
            if (typeof EntityIndex !== 'undefined' && EntityIndex.getUser) {
                var matchedUser = EntityIndex.getUser(cleaned);
                if (matchedUser) {
                    return getUserProfileTarget(matchedUser, options);
                }
            }

            if (isGuid(cleaned)) return { param: 'id', value: cleaned };
            if (isLikelyUpn(cleaned)) return { param: 'upn', value: cleaned };
            return options.exactOnly ? null : { param: 'search', value: cleaned };
        }

        var id = normalize(target.id || target.userId);
        var upn = normalize(target.userPrincipalName || target.mail || target.upn);
        var displayName = normalize(target.displayName || target.name);

        if (id) return { param: 'id', value: id };
        if (upn) return { param: 'upn', value: upn };
        if (!options.exactOnly && displayName) return { param: 'search', value: displayName };
        return null;
    }

    function getDeviceProfileTarget(target, options) {
        options = options || {};
        if (!target) return null;

        if (typeof target === 'string') {
            var cleaned = normalize(target);
            if (!cleaned) return null;

            ensureEntityIndex();
            if (typeof EntityIndex !== 'undefined' && EntityIndex.getDevice) {
                var matchedDevice = EntityIndex.getDevice(cleaned);
                if (matchedDevice) {
                    return getDeviceProfileTarget(matchedDevice, options);
                }
            }

            if (isGuid(cleaned)) return { param: 'id', value: cleaned };
            return options.exactOnly ? null : { param: 'search', value: cleaned };
        }

        var id = normalize(target.id || target.deviceId);
        var name = normalize(target.deviceName || target.displayName || target.managedDeviceName);
        var azureAdDeviceId = normalize(target.azureAdDeviceId);
        var serialNumber = normalize(target.serialNumber);

        if (id) return { param: 'id', value: id };
        if (name) return { param: 'name', value: name };
        if (!options.exactOnly && azureAdDeviceId) return { param: 'search', value: azureAdDeviceId };
        if (!options.exactOnly && serialNumber) return { param: 'search', value: serialNumber };
        return null;
    }

    function getUserProfileHash(target, options) {
        var resolved = getUserProfileTarget(target, options);
        if (!resolved) return '#users';
        return '#user-360?' + resolved.param + '=' + encodeURIComponent(resolved.value);
    }

    function getDeviceProfileHash(target, options) {
        var resolved = getDeviceProfileTarget(target, options);
        if (!resolved) return '#devices';
        return '#device-360?' + resolved.param + '=' + encodeURIComponent(resolved.value);
    }

    function getLegacySearchValue(params) {
        if (!params) return '';
        return params.get('search') || params.get('user') || params.get('upn') || params.get('device') || params.get('name') || '';
    }

    function handleLegacyProfileLinkClick(event) {
        var link = event.target.closest('a[href^="#users?"], a[href^="#devices?"]');
        if (!link) return;

        var href = link.getAttribute('href') || '';
        var hash = href.replace(/^#/, '');
        var page = hash.split('?')[0];
        if (page !== 'users' && page !== 'devices') return;

        var idx = href.indexOf('?');
        if (idx === -1) return;

        var params = new URLSearchParams(href.substring(idx + 1));
        if (params.get('view') === 'list' || params.get('no360') === '1') return;

        var value = getLegacySearchValue(params);
        if (!value) return;

        var destination = page === 'users'
            ? getUserProfileHash(value, { exactOnly: true })
            : getDeviceProfileHash(value, { exactOnly: true });

        if (!destination || destination === '#users' || destination === '#devices' || destination === href) return;

        event.preventDefault();
        event.stopPropagation();
        window.location.hash = destination;
    }

    function initProfileRouting() {
        if (profileRoutingInitialized) return;
        document.addEventListener('click', handleLegacyProfileLinkClick, true);
        profileRoutingInitialized = true;
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
        escapeSingleQuotes: escapeSingleQuotes,
        getUserProfileTarget: getUserProfileTarget,
        getDeviceProfileTarget: getDeviceProfileTarget,
        getUserProfileHash: getUserProfileHash,
        getDeviceProfileHash: getDeviceProfileHash,
        initProfileRouting: initProfileRouting
    };
})();

window.ActionUtils = ActionUtils;
