/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * DEPARTMENT FILTER MODULE
 *
 * Provides a global department context filter in the header.
 * When a department is selected, all pages filter their data accordingly.
 * Devices are joined to users via userPrincipalName to determine department.
 */

var DepartmentFilter = (function() {
    'use strict';

    var selectedDepartment = null;
    var upnToDeptMap = null;

    function normalizeUpn(value) {
        if (!value || typeof value !== 'string') return null;
        var trimmed = value.trim();
        if (!trimmed) return null;
        if (trimmed.indexOf('<') >= 0 && trimmed.indexOf('>') >= 0) {
            var match = trimmed.match(/<([^>]+)>/);
            if (match && match[1]) trimmed = match[1];
        }
        trimmed = trimmed.replace(/^mailto:/i, '').replace(/^smtp:/i, '');
        return trimmed.toLowerCase();
    }

    function extractUpnCandidates(value) {
        if (!value) return [];
        if (Array.isArray(value)) {
            return value.map(function(v) { return normalizeUpn(v); }).filter(Boolean);
        }
        if (typeof value === 'string') {
            return value.split(/[;,]/).map(function(v) { return normalizeUpn(v); }).filter(Boolean);
        }
        return [];
    }

    function matchesDepartment(value) {
        if (!selectedDepartment || !upnToDeptMap) return false;
        var candidates = extractUpnCandidates(value);
        for (var i = 0; i < candidates.length; i++) {
            if (upnToDeptMap[candidates[i]] === selectedDepartment) {
                return true;
            }
        }
        return false;
    }

    function filterByUpnFields(data, fields) {
        if (!selectedDepartment || !data) return data;
        var list = Array.isArray(fields) ? fields : [fields];
        return data.filter(function(item) {
            if (!item) return false;
            for (var i = 0; i < list.length; i++) {
                var field = list[i];
                var value = item[field];
                if (matchesDepartment(value)) {
                    return true;
                }
            }
            return false;
        });
    }

    function filterGroupsByMembership(groups) {
        if (!selectedDepartment || !Array.isArray(groups)) return groups;
        return groups.filter(function(g) {
            var members = g && g.members ? g.members : [];
            var owners = g && g.owners ? g.owners : [];
            if (members.length === 0 && owners.length === 0) {
                return true; // keep when membership list is not available
            }
            var i;
            for (i = 0; i < members.length; i++) {
                if (matchesDepartment(members[i].userPrincipalName || members[i].mail || '')) return true;
            }
            for (i = 0; i < owners.length; i++) {
                if (matchesDepartment(owners[i].userPrincipalName || owners[i].mail || '')) return true;
            }
            return false;
        });
    }

    /**
     * Initializes the department filter.
     * Extracts unique departments from user data and renders the selector.
     */
    function init() {
        var users = DataLoader.getData('users');
        if (!users || users.length === 0) return;

        // Extract unique departments, sorted alphabetically
        var deptSet = {};
        for (var i = 0; i < users.length; i++) {
            var dept = users[i].department;
            if (dept && typeof dept === 'string' && dept.trim()) {
                deptSet[dept.trim()] = true;
            }
        }

        var departments = Object.keys(deptSet).sort();
        if (departments.length === 0) return;

        // Build UPN -> department map for device filtering
        upnToDeptMap = {};
        for (var j = 0; j < users.length; j++) {
            var u = users[j];
            if (u.userPrincipalName && typeof u.userPrincipalName === 'string' && u.department && typeof u.department === 'string') {
                upnToDeptMap[u.userPrincipalName.toLowerCase()] = u.department.trim();
            }
            if (u.mail && typeof u.mail === 'string' && u.department && typeof u.department === 'string') {
                upnToDeptMap[u.mail.toLowerCase()] = u.department.trim();
            }
        }

        // Render selector in header
        var slot = document.getElementById('department-filter-slot');
        if (!slot) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'department-filter';

        var label = document.createElement('label');
        label.className = 'department-filter-label';
        label.textContent = 'Department:';
        label.setAttribute('for', 'dept-select');
        wrapper.appendChild(label);

        var select = document.createElement('select');
        select.id = 'dept-select';
        select.className = 'department-filter-select';

        var allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'All departments';
        select.appendChild(allOpt);

        for (var k = 0; k < departments.length; k++) {
            var opt = document.createElement('option');
            opt.value = departments[k];
            opt.textContent = departments[k];
            select.appendChild(opt);
        }

        select.addEventListener('change', function() {
            selectedDepartment = select.value || null;
            updateBanner();
            // Dispatch event so pages re-render
            document.dispatchEvent(new CustomEvent('departmentChanged', {
                detail: { department: selectedDepartment }
            }));
        });

        wrapper.appendChild(select);
        slot.appendChild(wrapper);
    }

    /**
     * Shows/hides the department banner below the header.
     */
    function updateBanner() {
        var existing = document.getElementById('department-banner');
        if (existing) existing.remove();

        if (!selectedDepartment) return;

        var banner = document.createElement('div');
        banner.id = 'department-banner';
        banner.className = 'department-banner';
        banner.textContent = 'Showing data for: ' + selectedDepartment;

        var content = document.querySelector('.content');
        if (content) {
            content.insertBefore(banner, content.firstChild);
        }
    }

    /**
     * Returns the currently selected department, or null for all.
     */
    function getSelected() {
        return selectedDepartment;
    }

    function isActive() {
        return !!selectedDepartment;
    }

    /**
     * Filters an array by a department field.
     * Returns all items if no department is selected.
     *
     * @param {Array} data - Data array to filter
     * @param {string} deptField - Field name containing department
     * @returns {Array} Filtered array
     */
    function filterData(data, deptField) {
        if (!selectedDepartment || !data) return data;
        return data.filter(function(item) {
            var val = item[deptField];
            return val && typeof val === 'string' && val.trim() === selectedDepartment;
        });
    }

    /**
     * Filters an array by joining UPN to user department.
     * Used for devices which don't have a department field.
     *
     * @param {Array} data - Data array to filter
     * @param {string} upnField - Field name containing userPrincipalName
     * @returns {Array} Filtered array
     */
    function filterByUPN(data, upnField) {
        if (!selectedDepartment || !data || !upnToDeptMap) return data;
        return data.filter(function(item) {
            var upn = item[upnField];
            if (!upn || typeof upn !== 'string') return false;
            return upnToDeptMap[upn.toLowerCase()] === selectedDepartment;
        });
    }

    function applyToType(type, data) {
        if (!selectedDepartment) return data;

        switch (type) {
            case 'users':
                return filterData(data, 'department');
            case 'devices':
                return filterByUpnFields(data, ['userPrincipalName', 'emailAddress', 'userUpn', 'upn']);
            case 'guests':
                return filterByUpnFields(data, ['mail', 'userPrincipalName']);
            case 'sharepointSites':
                return filterByUpnFields(data, ['ownerPrincipalName']);
            case 'teams':
                return filterByUpnFields(data, ['ownerUpns', 'ownerUpn']);
            case 'signinLogs':
                if (!data || !data.signIns) return data;
                return Object.assign({}, data, {
                    signIns: filterByUpnFields(data.signIns, ['userPrincipalName', 'userUpn', 'user'])
                });
            case 'riskySignins':
                return filterByUpnFields(data, ['userPrincipalName', 'userUpn']);
            case 'defenderAlerts':
                return filterByUpnFields(data, ['affectedUser']);
            case 'auditLogs':
                return filterByUpnFields(data, ['initiatedBy', 'targetResource']);
            case 'pimActivity':
                return filterByUpnFields(data, ['principalUpn']);
            case 'identityRisk':
                if (!data || typeof data !== 'object') return data;
                return Object.assign({}, data, {
                    riskyUsers: filterByUpnFields(data.riskyUsers || [], ['userPrincipalName', 'userUpn']),
                    riskDetections: filterByUpnFields(data.riskDetections || [], ['userPrincipalName', 'userUpn'])
                });
            case 'appSignins':
                return filterByUpnFields(data, ['userPrincipalName', 'userUpn']);
            case 'groups':
                if (!data) return data;
                if (Array.isArray(data)) return filterGroupsByMembership(data);
                if (data.groups && Array.isArray(data.groups)) {
                    return Object.assign({}, data, { groups: filterGroupsByMembership(data.groups) });
                }
                return data;
            default:
                return data;
        }
    }

    return {
        init: init,
        getSelected: getSelected,
        isActive: isActive,
        filterData: filterData,
        filterByUPN: filterByUPN,
        applyToType: applyToType,
        refreshBanner: updateBanner
    };

})();

window.DepartmentFilter = DepartmentFilter;
