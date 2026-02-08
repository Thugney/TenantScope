/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * TIME RANGE FILTER MODULE
 *
 * Provides a global time range filter in the header (last 7/30/90 days).
 * When selected, time-based datasets are filtered before rendering pages.
 */

var TimeRangeFilter = (function() {
    'use strict';

    var selectedDays = 0;
    var storageKey = 'tenantscope-time-range';
    var indicatorEl = null;

    var applicablePages = {
        'overview': true,
        'security': true,
        'signin-logs': true,
        'audit-logs': true,
        'pim': true,
        'app-usage': true,
        'identity-risk': true,
        'report': true
    };

    function init() {
        var slot = document.getElementById('time-range-filter-slot');
        if (!slot) return;

        var saved = localStorage.getItem(storageKey);
        if (saved !== null && saved !== '') {
            var parsed = parseInt(saved, 10);
            selectedDays = isNaN(parsed) ? 0 : parsed;
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'time-range-filter';

        var label = document.createElement('label');
        label.className = 'time-range-filter-label';
        label.textContent = 'Time range:';
        label.setAttribute('for', 'time-range-select');
        wrapper.appendChild(label);

        var select = document.createElement('select');
        select.id = 'time-range-select';
        select.className = 'time-range-filter-select';

        var options = [
            { value: '0', label: 'All data' },
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' }
        ];

        options.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });

        select.value = String(selectedDays || 0);

        select.addEventListener('change', function() {
            var next = parseInt(select.value, 10);
            selectedDays = isNaN(next) ? 0 : next;
            localStorage.setItem(storageKey, String(selectedDays));
            document.dispatchEvent(new CustomEvent('timeRangeChanged', {
                detail: { days: selectedDays }
            }));
        });

        wrapper.appendChild(select);

        indicatorEl = document.createElement('span');
        indicatorEl.id = 'time-range-indicator';
        indicatorEl.className = 'time-range-indicator';
        wrapper.appendChild(indicatorEl);

        slot.appendChild(wrapper);

        updateIndicator(getCurrentPage());
    }

    function getCurrentPage() {
        var hash = window.location.hash.slice(1);
        var pageName = hash.split('?')[0];
        return pageName || 'overview';
    }

    function updateIndicator(pageName) {
        if (!indicatorEl) return;
        var page = pageName || getCurrentPage();
        var applicable = !!applicablePages[page];
        indicatorEl.textContent = applicable ? 'Applies to time-based data on this page' : 'Not applicable on this page';
        indicatorEl.classList.toggle('is-inactive', !applicable);
    }

    function getDays() {
        return selectedDays || 0;
    }

    function isActive() {
        return selectedDays && selectedDays > 0;
    }

    function getRange() {
        if (!isActive()) return null;
        var now = new Date();
        var from = new Date(now.getTime() - (selectedDays * 24 * 60 * 60 * 1000));
        return { from: from, to: now };
    }

    function getNestedValue(obj, path) {
        if (!obj || !path) return null;
        return path.split('.').reduce(function(o, k) {
            return (o && o[k] !== undefined) ? o[k] : null;
        }, obj);
    }

    function parseDate(value) {
        if (!value) return null;
        if (value instanceof Date) return value;
        var date = new Date(value);
        if (isNaN(date.getTime())) return null;
        return date;
    }

    function resolveDate(item, fields) {
        if (!item || !fields) return null;
        if (typeof fields === 'function') return fields(item);
        var list = Array.isArray(fields) ? fields : [fields];
        for (var i = 0; i < list.length; i++) {
            var value = getNestedValue(item, list[i]);
            if (value) return value;
        }
        return null;
    }

    function isWithinRange(value, range) {
        if (!range) return true;
        var date = parseDate(value);
        if (!date) return true;
        return date >= range.from && date <= range.to;
    }

    function filterArrayByFields(items, fields, range) {
        if (!Array.isArray(items)) return [];
        return items.filter(function(item) {
            var value = resolveDate(item, fields);
            return isWithinRange(value, range);
        });
    }

    function filterServiceAnnouncements(data, range) {
        if (!data || typeof data !== 'object') return data;

        var messageCenter = filterArrayByFields(
            Array.isArray(data.messageCenter) ? data.messageCenter : [],
            ['lastModifiedDateTime', 'startDateTime', 'actionRequiredByDateTime'],
            range
        );

        var serviceHealth = Array.isArray(data.serviceHealth) ? data.serviceHealth.map(function(service) {
            var issues = filterArrayByFields(
                Array.isArray(service.issues) ? service.issues : [],
                ['lastModifiedDateTime', 'startDateTime'],
                range
            );
            return Object.assign({}, service, { issues: issues });
        }) : [];

        return Object.assign({}, data, {
            messageCenter: messageCenter,
            serviceHealth: serviceHealth
        });
    }

    function applyToType(type, data) {
        if (!isActive() || !type) return data;
        var range = getRange();
        if (!range) return data;

        switch (type) {
            case 'signinLogs':
                if (!data || !Array.isArray(data.signIns)) return data;
                return Object.assign({}, data, {
                    signIns: filterArrayByFields(data.signIns, ['createdDateTime'], range)
                });
            case 'identityRisk':
                if (!data || typeof data !== 'object') return data;
                return Object.assign({}, data, {
                    riskyUsers: filterArrayByFields(
                        Array.isArray(data.riskyUsers) ? data.riskyUsers : [],
                        ['riskLastUpdatedDateTime', 'lastUpdatedDateTime', 'createdDateTime'],
                        range
                    ),
                    riskDetections: filterArrayByFields(
                        Array.isArray(data.riskDetections) ? data.riskDetections : [],
                        ['detectedDateTime', 'lastUpdatedDateTime', 'createdDateTime'],
                        range
                    )
                });
            case 'serviceAnnouncements':
                return filterServiceAnnouncements(data, range);
            case 'defenderAlerts':
                return filterArrayByFields(
                    Array.isArray(data) ? data : [],
                    ['createdDateTime', 'alertCreationTime'],
                    range
                );
            case 'riskySignins':
                return filterArrayByFields(
                    Array.isArray(data) ? data : [],
                    ['detectedDateTime', 'createdDateTime'],
                    range
                );
            case 'auditLogs':
                return filterArrayByFields(
                    Array.isArray(data) ? data : [],
                    ['activityDateTime', 'createdDateTime'],
                    range
                );
            case 'pimActivity':
                return filterArrayByFields(
                    Array.isArray(data) ? data : [],
                    ['createdDateTime', 'startDateTime'],
                    range
                );
            case 'appSignins':
                return filterArrayByFields(
                    Array.isArray(data) ? data : [],
                    ['createdDateTime'],
                    range
                );
            default:
                return data;
        }
    }

    return {
        init: init,
        getDays: getDays,
        getRange: getRange,
        isActive: isActive,
        applyToType: applyToType,
        updateIndicator: updateIndicator
    };

})();

window.TimeRangeFilter = TimeRangeFilter;
