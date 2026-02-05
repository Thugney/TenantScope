/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * TREND HELPER MODULE
 *
 * Compares current metric values against historical snapshots to show
 * improvement/degradation with directional arrows and delta values.
 */

var TrendHelper = (function() {
    'use strict';

    // Metrics where "up" is good
    var upIsGood = {
        totalUsers: true,
        mfaPct: true,
        compliancePct: true,
        secureScore: true
    };

    // Metrics where "down" is good
    var downIsGood = {
        activeAlerts: true,
        totalWasteMonthlyCost: true
    };

    /**
     * Computes trend direction by comparing current value to most recent snapshot.
     *
     * @param {number} currentValue - Current metric value
     * @param {Array} history - Array of snapshot objects
     * @param {string} metricKey - Key name in snapshot objects
     * @returns {object|null} { direction, delta, isGood } or null if no history
     */
    function getTrend(currentValue, history, metricKey) {
        if (!history || history.length === 0) return null;
        if (currentValue === null || currentValue === undefined) return null;

        // Get most recent snapshot
        var prev = history[history.length - 1];
        var prevValue = prev[metricKey];

        if (prevValue === null || prevValue === undefined) return null;

        var delta = currentValue - prevValue;
        var direction = 'flat';

        if (delta > 0) direction = 'up';
        else if (delta < 0) direction = 'down';

        var isGood = false;
        if (direction === 'up' && upIsGood[metricKey]) isGood = true;
        if (direction === 'down' && downIsGood[metricKey]) isGood = true;
        if (direction === 'up' && downIsGood[metricKey]) isGood = false;
        if (direction === 'down' && upIsGood[metricKey]) isGood = false;
        if (direction === 'flat') isGood = true;

        return {
            direction: direction,
            delta: delta,
            absDelta: Math.abs(delta),
            isGood: isGood
        };
    }

    /**
     * Creates a DOM element showing trend direction and delta.
     *
     * @param {object} trend - Result from getTrend()
     * @returns {HTMLElement} Span element with arrow and delta text
     */
    function createIndicator(trend) {
        var span = document.createElement('span');
        span.className = 'trend-indicator';

        if (!trend) return span;

        var arrow = '';
        var cls = 'trend-flat';

        if (trend.direction === 'up') {
            arrow = '\u2191'; // up arrow
            cls = trend.isGood ? 'trend-up-good' : 'trend-up-bad';
        } else if (trend.direction === 'down') {
            arrow = '\u2193'; // down arrow
            cls = trend.isGood ? 'trend-down-good' : 'trend-down-bad';
        } else {
            arrow = '\u2192'; // right arrow (flat)
        }

        span.className += ' ' + cls;

        var arrowSpan = document.createElement('span');
        arrowSpan.className = 'trend-arrow';
        arrowSpan.textContent = arrow;
        span.appendChild(arrowSpan);

        if (trend.absDelta > 0) {
            var deltaSpan = document.createElement('span');
            deltaSpan.className = 'trend-delta';
            var prefix = trend.direction === 'up' ? '+' : '';
            deltaSpan.textContent = prefix + trend.delta;
            span.appendChild(deltaSpan);
        }

        return span;
    }

    return {
        getTrend: getTrend,
        createIndicator: createIndicator
    };

})();

window.TrendHelper = TrendHelper;
