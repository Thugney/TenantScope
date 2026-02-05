/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * FOCUS TABLES MODULE
 *
 * Implements the BSURE-style analysis pattern:
 * - Focus Table: Aggregate summary grouped by one dimension
 * - Breakdown Table: 2D cross-tab (pivot) by a selectable dimension
 * - Breakdown Filter: Radio button row to switch the breakdown dimension
 */

const FocusTables = (function() {
    'use strict';

    /**
     * Escapes HTML special characters.
     */
    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Groups data by a key and returns a sorted array of { value, count }.
     */
    function groupBy(data, key) {
        var map = {};
        for (var i = 0; i < data.length; i++) {
            var val = data[i][key];
            var label = (val === null || val === undefined || val === '') ? '(empty)' : String(val);
            map[label] = (map[label] || 0) + 1;
        }
        var result = [];
        for (var k in map) {
            if (map.hasOwnProperty(k)) {
                result.push({ value: k, count: map[k] });
            }
        }
        result.sort(function(a, b) { return b.count - a.count; });
        return result;
    }

    /**
     * Renders a Focus Table: groups data by one dimension and shows count + %.
     *
     * @param {object} config
     * @param {string} config.containerId - DOM container ID
     * @param {Array}  config.data - Data array to aggregate
     * @param {string} config.groupByKey - Field to group by
     * @param {string} config.groupByLabel - Column header for the dimension
     * @param {string} config.countLabel - Column header for the count
     * @param {Function} [config.onGroupClick] - Click handler for a group row
     */
    function renderFocusTable(config) {
        var container = document.getElementById(config.containerId);
        if (!container) return;
        container.textContent = '';

        var groups = groupBy(config.data, config.groupByKey);
        var total = config.data.length;

        var wrapper = document.createElement('div');
        wrapper.className = 'focus-table-wrapper';

        var title = document.createElement('div');
        title.className = 'focus-table-title';
        title.textContent = 'Focus Table';
        wrapper.appendChild(title);

        var subtitle = document.createElement('div');
        subtitle.className = 'focus-table-subtitle';
        subtitle.textContent = 'Grouped by ' + (config.groupByLabel || config.groupByKey);
        wrapper.appendChild(subtitle);

        var table = document.createElement('table');
        table.className = 'focus-table';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        var th1 = document.createElement('th');
        th1.textContent = config.groupByLabel || 'Group';
        var th2 = document.createElement('th');
        th2.textContent = config.countLabel || 'Count';
        th2.className = 'cell-right';
        var th3 = document.createElement('th');
        th3.textContent = '% ' + (config.countLabel || 'Count');
        th3.className = 'cell-right';
        headRow.appendChild(th1);
        headRow.appendChild(th2);
        headRow.appendChild(th3);
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var pct = total > 0 ? Math.round((g.count / total) * 100) : 0;
            var tr = document.createElement('tr');
            if (config.onGroupClick) {
                tr.style.cursor = 'pointer';
                tr.dataset.groupValue = g.value;
                tr.addEventListener('click', (function(val) {
                    return function() { config.onGroupClick(val); };
                })(g.value));
            }

            var td1 = document.createElement('td');
            td1.textContent = g.value;
            var td2 = document.createElement('td');
            td2.className = 'cell-right';
            td2.textContent = g.count.toLocaleString();
            var td3 = document.createElement('td');
            td3.className = 'cell-right';
            td3.textContent = pct + '%';
            tr.appendChild(td1);
            tr.appendChild(td2);
            tr.appendChild(td3);
            tbody.appendChild(tr);
        }

        // Totals row
        var totalRow = document.createElement('tr');
        totalRow.className = 'focus-table-total';
        var ttd1 = document.createElement('td');
        ttd1.textContent = 'Total';
        var ttd2 = document.createElement('td');
        ttd2.className = 'cell-right';
        ttd2.textContent = total.toLocaleString();
        var ttd3 = document.createElement('td');
        ttd3.className = 'cell-right';
        ttd3.textContent = '100%';
        totalRow.appendChild(ttd1);
        totalRow.appendChild(ttd2);
        totalRow.appendChild(ttd3);
        tbody.appendChild(totalRow);

        table.appendChild(tbody);
        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Renders a Breakdown Table: 2D pivot with rows = focusKey, columns = breakdownKey.
     *
     * @param {object} config
     * @param {string} config.containerId - DOM container ID
     * @param {Array}  config.data - Data array
     * @param {string} config.primaryKey - Row dimension field
     * @param {string} config.breakdownKey - Column dimension field
     * @param {string} config.primaryLabel - Row header label
     * @param {string} config.breakdownLabel - Used in subtitle
     */
    function renderBreakdownTable(config) {
        var container = document.getElementById(config.containerId);
        if (!container) return;
        container.textContent = '';

        var data = config.data;
        var total = data.length;

        // Build 2D pivot: primary -> breakdown -> count
        var pivot = {};
        var breakdownValues = {};
        for (var i = 0; i < data.length; i++) {
            var pVal = data[i][config.primaryKey];
            var bVal = data[i][config.breakdownKey];
            var pLabel = (pVal === null || pVal === undefined || pVal === '') ? '(empty)' : String(pVal);
            var bLabel = (bVal === null || bVal === undefined || bVal === '') ? '(empty)' : String(bVal);

            if (!pivot[pLabel]) pivot[pLabel] = {};
            pivot[pLabel][bLabel] = (pivot[pLabel][bLabel] || 0) + 1;
            breakdownValues[bLabel] = (breakdownValues[bLabel] || 0) + 1;
        }

        // Sort breakdown columns by total count descending, limit to top 8
        var bCols = [];
        for (var bk in breakdownValues) {
            if (breakdownValues.hasOwnProperty(bk)) {
                bCols.push({ value: bk, total: breakdownValues[bk] });
            }
        }
        bCols.sort(function(a, b) { return b.total - a.total; });
        if (bCols.length > 8) bCols = bCols.slice(0, 8);

        // Sort primary rows by total count descending
        var pRows = [];
        for (var pk in pivot) {
            if (pivot.hasOwnProperty(pk)) {
                var rowTotal = 0;
                for (var rk in pivot[pk]) {
                    if (pivot[pk].hasOwnProperty(rk)) rowTotal += pivot[pk][rk];
                }
                pRows.push({ value: pk, total: rowTotal });
            }
        }
        pRows.sort(function(a, b) { return b.total - a.total; });

        var wrapper = document.createElement('div');
        wrapper.className = 'breakdown-table-wrapper';

        var title = document.createElement('div');
        title.className = 'breakdown-table-title';
        title.textContent = 'Breakdown Table';
        wrapper.appendChild(title);

        var subtitle = document.createElement('div');
        subtitle.className = 'breakdown-table-subtitle';
        subtitle.textContent = 'Customize data with breakdown filter';
        wrapper.appendChild(subtitle);

        var tableWrap = document.createElement('div');
        tableWrap.className = 'breakdown-table-scroll';

        var table = document.createElement('table');
        table.className = 'breakdown-table';

        // Header row
        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        var thPrimary = document.createElement('th');
        thPrimary.textContent = config.breakdownLabel || config.breakdownKey;
        headRow.appendChild(thPrimary);

        for (var c = 0; c < bCols.length; c++) {
            var th = document.createElement('th');
            th.className = 'cell-right';
            th.textContent = bCols[c].value;
            headRow.appendChild(th);
        }
        var thTotal = document.createElement('th');
        thTotal.className = 'cell-right';
        thTotal.textContent = 'Total';
        headRow.appendChild(thTotal);
        thead.appendChild(headRow);
        table.appendChild(thead);

        // Data rows
        var tbody = document.createElement('tbody');
        for (var r = 0; r < pRows.length; r++) {
            var row = pRows[r];
            var tr = document.createElement('tr');
            var tdName = document.createElement('td');
            tdName.textContent = row.value;
            tr.appendChild(tdName);

            for (var cc = 0; cc < bCols.length; cc++) {
                var count = (pivot[row.value] && pivot[row.value][bCols[cc].value]) || 0;
                var pct = row.total > 0 ? Math.round((count / row.total) * 100) : 0;
                var td = document.createElement('td');
                td.className = 'cell-right';
                td.textContent = count > 0 ? count.toLocaleString() : '';
                tr.appendChild(td);
            }

            var tdTotal = document.createElement('td');
            tdTotal.className = 'cell-right font-bold';
            tdTotal.textContent = row.total.toLocaleString();
            tr.appendChild(tdTotal);
            tbody.appendChild(tr);
        }

        // Totals footer row
        var footRow = document.createElement('tr');
        footRow.className = 'breakdown-table-total';
        var ftdName = document.createElement('td');
        ftdName.textContent = 'Total';
        footRow.appendChild(ftdName);
        for (var fc = 0; fc < bCols.length; fc++) {
            var ftd = document.createElement('td');
            ftd.className = 'cell-right';
            ftd.textContent = bCols[fc].total.toLocaleString();
            footRow.appendChild(ftd);
        }
        var ftdTotal = document.createElement('td');
        ftdTotal.className = 'cell-right font-bold';
        ftdTotal.textContent = total.toLocaleString();
        footRow.appendChild(ftdTotal);
        tbody.appendChild(footRow);

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        wrapper.appendChild(tableWrap);
        container.appendChild(wrapper);
    }

    /**
     * Renders the Breakdown Filter: radio buttons to switch breakdown dimension.
     *
     * @param {object} config
     * @param {string} config.containerId - DOM container ID
     * @param {Array}  config.dimensions - [{key, label}]
     * @param {string} config.selected - Currently selected dimension key
     * @param {Function} config.onChange - Called with selected key on change
     */
    function renderBreakdownFilter(config) {
        var container = document.getElementById(config.containerId);
        if (!container) return;
        container.textContent = '';

        var wrapper = document.createElement('div');
        wrapper.className = 'breakdown-filter';

        var label = document.createElement('span');
        label.className = 'breakdown-filter-label';
        label.textContent = 'Breakdown by:';
        wrapper.appendChild(label);

        var groupName = 'breakdown-' + config.containerId;

        for (var i = 0; i < config.dimensions.length; i++) {
            var dim = config.dimensions[i];
            var btn = document.createElement('label');
            btn.className = 'breakdown-filter-option';
            if (dim.key === config.selected) btn.classList.add('active');

            var radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = groupName;
            radio.value = dim.key;
            radio.checked = dim.key === config.selected;
            radio.addEventListener('change', (function(key) {
                return function() {
                    // Update active class
                    var options = wrapper.querySelectorAll('.breakdown-filter-option');
                    for (var j = 0; j < options.length; j++) {
                        options[j].classList.remove('active');
                    }
                    this.parentElement.classList.add('active');
                    config.onChange(key);
                };
            })(dim.key));

            var text = document.createTextNode(dim.label);
            btn.appendChild(radio);
            btn.appendChild(text);
            wrapper.appendChild(btn);
        }

        container.appendChild(wrapper);
    }

    /**
     * Renders the complete Focus/Breakdown panel with all three components.
     *
     * @param {object} config
     * @param {string} config.focusContainerId
     * @param {string} config.breakdownContainerId
     * @param {string} config.breakdownFilterContainerId
     * @param {Array}  config.data
     * @param {string} config.focusGroupKey
     * @param {string} config.focusGroupLabel
     * @param {string} config.countLabel
     * @param {Array}  config.breakdownDimensions - [{key, label}]
     * @param {string} config.defaultBreakdownKey
     * @param {Function} [config.onGroupClick]
     */
    function renderPanel(config) {
        var currentBreakdownKey = config.defaultBreakdownKey;

        function renderBreakdown(breakdownKey) {
            renderBreakdownTable({
                containerId: config.breakdownContainerId,
                data: config.data,
                primaryKey: config.focusGroupKey,
                breakdownKey: breakdownKey,
                primaryLabel: config.focusGroupLabel,
                breakdownLabel: (config.breakdownDimensions.find(function(d) { return d.key === breakdownKey; }) || {}).label || breakdownKey
            });
        }

        // Render focus table
        renderFocusTable({
            containerId: config.focusContainerId,
            data: config.data,
            groupByKey: config.focusGroupKey,
            groupByLabel: config.focusGroupLabel,
            countLabel: config.countLabel,
            onGroupClick: config.onGroupClick
        });

        // Render breakdown filter
        renderBreakdownFilter({
            containerId: config.breakdownFilterContainerId,
            dimensions: config.breakdownDimensions,
            selected: currentBreakdownKey,
            onChange: function(key) {
                currentBreakdownKey = key;
                renderBreakdown(key);
            }
        });

        // Render initial breakdown
        renderBreakdown(currentBreakdownKey);
    }

    return {
        renderFocusTable: renderFocusTable,
        renderBreakdownTable: renderBreakdownTable,
        renderBreakdownFilter: renderBreakdownFilter,
        renderPanel: renderPanel
    };

})();

window.FocusTables = FocusTables;
