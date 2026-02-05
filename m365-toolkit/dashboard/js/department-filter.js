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
            if (dept && dept.trim()) {
                deptSet[dept.trim()] = true;
            }
        }

        var departments = Object.keys(deptSet).sort();
        if (departments.length === 0) return;

        // Build UPN -> department map for device filtering
        upnToDeptMap = {};
        for (var j = 0; j < users.length; j++) {
            var u = users[j];
            if (u.userPrincipalName && u.department) {
                upnToDeptMap[u.userPrincipalName.toLowerCase()] = u.department.trim();
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
            return item[deptField] && item[deptField].trim() === selectedDepartment;
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
            if (!upn) return false;
            return upnToDeptMap[upn.toLowerCase()] === selectedDepartment;
        });
    }

    return {
        init: init,
        getSelected: getSelected,
        filterData: filterData,
        filterByUPN: filterByUPN
    };

})();

window.DepartmentFilter = DepartmentFilter;
