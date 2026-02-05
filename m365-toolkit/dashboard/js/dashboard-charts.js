/**
 * ============================================================================
 * TenantScope
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * DASHBOARD CHARTS MODULE
 *
 * Reusable SVG donut chart renderer. No external dependencies.
 * Uses stroke-dasharray/stroke-dashoffset on SVG circles.
 */

const DashboardCharts = (function() {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var CIRCUMFERENCE = 2 * Math.PI * 80; // r=80, C ~= 502.65

    /**
     * Renders a donut chart into the given container.
     *
     * @param {HTMLElement} container - DOM element to render into
     * @param {Array} segments - Array of { value: number, label: string, color: string }
     * @param {string} centerText - Large center text (e.g., "85%")
     * @param {string} centerSubtext - Small label below center text
     * @param {object} [opts] - Optional settings
     * @param {number} [opts.size=160] - SVG display size in px
     * @param {number} [opts.strokeWidth=24] - Donut ring thickness
     */
    function createDonutChart(container, segments, centerText, centerSubtext, opts) {
        opts = opts || {};
        var size = opts.size || 160;
        var strokeWidth = opts.strokeWidth || 24;

        var total = 0;
        for (var i = 0; i < segments.length; i++) {
            total += segments[i].value;
        }

        // Wrapper
        var wrapper = document.createElement('div');
        wrapper.className = 'chart-svg-wrapper';

        // SVG element
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 200 200');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('class', 'chart-svg');

        // Background circle (track)
        var bgCircle = document.createElementNS(SVG_NS, 'circle');
        bgCircle.setAttribute('cx', '100');
        bgCircle.setAttribute('cy', '100');
        bgCircle.setAttribute('r', '80');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', '#e5e7eb');
        bgCircle.setAttribute('stroke-width', String(strokeWidth));
        svg.appendChild(bgCircle);

        // Draw segments
        if (total > 0) {
            var offset = 0;
            for (var j = 0; j < segments.length; j++) {
                var seg = segments[j];
                if (seg.value <= 0) continue;

                var segLength = (seg.value / total) * CIRCUMFERENCE;
                var circle = document.createElementNS(SVG_NS, 'circle');
                circle.setAttribute('cx', '100');
                circle.setAttribute('cy', '100');
                circle.setAttribute('r', '80');
                circle.setAttribute('fill', 'none');
                circle.setAttribute('stroke', seg.color);
                circle.setAttribute('stroke-width', String(strokeWidth));
                circle.setAttribute('stroke-dasharray', segLength + ' ' + (CIRCUMFERENCE - segLength));
                circle.setAttribute('stroke-dashoffset', String(-offset));
                circle.setAttribute('transform', 'rotate(-90 100 100)');
                circle.setAttribute('stroke-linecap', 'butt');
                svg.appendChild(circle);

                offset += segLength;
            }
        }

        wrapper.appendChild(svg);

        // Center text overlay
        var center = document.createElement('div');
        center.className = 'chart-center';

        var mainText = document.createElement('div');
        mainText.className = 'chart-center-text';
        mainText.textContent = centerText;
        center.appendChild(mainText);

        if (centerSubtext) {
            var subText = document.createElement('div');
            subText.className = 'chart-center-subtext';
            subText.textContent = centerSubtext;
            center.appendChild(subText);
        }

        wrapper.appendChild(center);
        container.appendChild(wrapper);

        // Legend
        var legend = document.createElement('div');
        legend.className = 'chart-legend';

        for (var k = 0; k < segments.length; k++) {
            var item = document.createElement('div');
            item.className = 'chart-legend-item';

            var dot = document.createElement('span');
            dot.className = 'chart-legend-dot';
            dot.style.backgroundColor = segments[k].color;
            item.appendChild(dot);

            var label = document.createElement('span');
            label.textContent = segments[k].label;
            item.appendChild(label);

            var count = document.createElement('span');
            count.className = 'chart-legend-count';
            count.textContent = String(segments[k].value);
            item.appendChild(count);

            legend.appendChild(item);
        }

        container.appendChild(legend);
    }

    /**
     * Creates a complete chart card with title, donut, and legend.
     *
     * @param {string} title - Chart card title
     * @param {Array} segments - Donut segments
     * @param {string} centerText - Center display text
     * @param {string} centerSubtext - Center sub-label
     * @param {object} [opts] - Chart options
     * @returns {HTMLElement} The chart container element
     */
    function createChartCard(title, segments, centerText, centerSubtext, opts) {
        var card = document.createElement('div');
        card.className = 'chart-container';

        var titleEl = document.createElement('div');
        titleEl.className = 'chart-title';
        titleEl.textContent = title;
        card.appendChild(titleEl);

        createDonutChart(card, segments, centerText, centerSubtext, opts);

        return card;
    }

    // Chart color palette using CSS variable values
    var colors = {
        blue: '#2563eb',
        green: '#16a34a',
        red: '#dc2626',
        yellow: '#f59e0b',
        gray: '#6b7280',
        purple: '#7c3aed',
        teal: '#0d9488',
        orange: '#ea580c',
        indigo: '#4f46e5',
        pink: '#db2777'
    };

    return {
        createDonutChart: createDonutChart,
        createChartCard: createChartCard,
        colors: colors
    };

})();

window.DashboardCharts = DashboardCharts;
