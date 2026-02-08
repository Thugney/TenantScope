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
        slot.appendChild(wrapper);
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

    function scoreDateKey(key) {
        if (!key) return 0;
        var name = String(key).toLowerCase();
        var score = 0;
        if (name.indexOf('created') >= 0) score += 3;
        if (name.indexOf('last') >= 0 || name.indexOf('updated') >= 0 || name.indexOf('modified') >= 0) score += 2;
        if (name.indexOf('date') >= 0 || name.indexOf('time') >= 0) score += 1;
        return score;
    }

    function findBestDateField(items) {
        var counts = {};
        var keys = [];
        var limit = Math.min(items.length, 10);

        for (var i = 0; i < limit; i++) {
            var item = items[i];
            if (!item || typeof item !== 'object') continue;
            Object.keys(item).forEach(function(key) {
                var value = item[key];
                if (!value) return;
                if (typeof value === 'string' || value instanceof Date) {
                    var parsed = parseDate(value);
                    if (parsed) {
                        counts[key] = (counts[key] || 0) + 1;
                        if (keys.indexOf(key) === -1) keys.push(key);
                    }
                }
            });
        }

        var bestKey = null;
        var bestCount = 0;
        keys.forEach(function(key) {
            var count = counts[key] || 0;
            if (count > bestCount) {
                bestCount = count;
                bestKey = key;
            } else if (count === bestCount && bestKey) {
                if (scoreDateKey(key) > scoreDateKey(bestKey)) {
                    bestKey = key;
                }
            }
        });

        return bestKey;
    }

    function filterArrayByGuess(items, range) {
        if (!Array.isArray(items) || items.length === 0) return items || [];
        if (typeof items[0] !== 'object') return items;
        var field = findBestDateField(items);
        if (!field) return items;
        return filterArrayByFields(items, field, range);
    }

    function applyGeneric(data, range) {
        if (Array.isArray(data)) {
            return filterArrayByGuess(data, range);
        }
        if (!data || typeof data !== 'object') return data;

        var result = Object.assign({}, data);
        Object.keys(result).forEach(function(key) {
            if (Array.isArray(result[key])) {
                result[key] = filterArrayByGuess(result[key], range);
            }
        });

        return result;
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
                return applyGeneric(data, range);
        }
    }

    return {
        init: init,
        getDays: getDays,
        getRange: getRange,
        isActive: isActive,
        applyToType: applyToType
    };

})();

window.TimeRangeFilter = TimeRangeFilter;
