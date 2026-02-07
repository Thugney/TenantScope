/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: GUESTS
 *
 * Renders the guest accounts page showing external users and their status.
 * Highlights stale guests and pending invitations.
 */

const PageGuests = (function() {
    'use strict';

    /** Column selector instance */
    var colSelector = null;

    /** Current breakdown dimension */
    var currentBreakdown = 'sourceDomain';

    /**
     * Applies current filters and re-renders the table.
     */
    function applyFilters() {
        const guests = DataLoader.getData('guests');

        // Build filter configuration
        const filterConfig = {
            search: Filters.getValue('guests-search'),
            searchFields: ['displayName', 'mail', 'sourceDomain']
        };

        // Apply filters
        let filteredData = Filters.apply(guests, filterConfig);

        // Status filter
        const status = Filters.getValue('guests-status');
        if (status && status !== 'all') {
            switch (status) {
                case 'active':
                    filteredData = filteredData.filter(g => !g.isStale && !g.neverSignedIn && g.invitationState === 'Accepted');
                    break;
                case 'stale':
                    filteredData = filteredData.filter(g => g.isStale);
                    break;
                case 'never':
                    filteredData = filteredData.filter(g => g.neverSignedIn);
                    break;
                case 'pending':
                    filteredData = filteredData.filter(g => g.invitationState === 'PendingAcceptance');
                    break;
            }
        }

        // Date range filters
        var createdRange = Filters.getValue('guests-created-range');
        if (createdRange && (createdRange.from || createdRange.to)) {
            filteredData = filteredData.filter(function(g) {
                if (!g.createdDateTime) return false;
                var dt = new Date(g.createdDateTime);
                if (createdRange.from && dt < new Date(createdRange.from)) return false;
                if (createdRange.to && dt > new Date(createdRange.to + 'T23:59:59')) return false;
                return true;
            });
        }

        var signinRange = Filters.getValue('guests-signin-range');
        if (signinRange && (signinRange.from || signinRange.to)) {
            filteredData = filteredData.filter(function(g) {
                if (!g.lastSignIn) return !signinRange.from;
                var dt = new Date(g.lastSignIn);
                if (signinRange.from && dt < new Date(signinRange.from)) return false;
                if (signinRange.to && dt > new Date(signinRange.to + 'T23:59:59')) return false;
                return true;
            });
        }

        // Render Focus/Breakdown tables
        renderFocusBreakdown(filteredData);

        // Render table
        renderTable(filteredData);
    }

    /**
     * Renders the guests table.
     *
     * @param {Array} data - Filtered guest data
     */
    function renderTable(data) {
        // Get visible columns from Column Selector
        var visible = colSelector ? colSelector.getVisible() : [
            'displayName', 'mail', 'sourceDomain', 'createdDateTime',
            'invitationState', 'lastSignIn', 'daysSinceLastSignIn', 'isStale'
        ];

        // All column definitions
        var allDefs = [
            { key: 'displayName', label: 'Name' },
            { key: 'mail', label: 'Email', className: 'cell-truncate' },
            { key: 'sourceDomain', label: 'Source Domain' },
            { key: 'createdDateTime', label: 'Invited', formatter: Tables.formatters.date },
            { key: 'invitationState', label: 'Invitation', formatter: formatInvitationState },
            { key: 'lastSignIn', label: 'Last Sign-In', formatter: Tables.formatters.date },
            { key: 'daysSinceLastSignIn', label: 'Days Inactive', formatter: Tables.formatters.inactiveDays },
            { key: 'isStale', label: 'Status', formatter: formatGuestStatus },
            { key: 'neverSignedIn', label: 'Never Signed In', formatter: function(v) { return v ? 'Yes' : 'No'; } }
        ];

        // Filter to visible columns only
        var columns = allDefs.filter(function(col) {
            return visible.indexOf(col.key) !== -1;
        });

        Tables.render({
            containerId: 'guests-table',
            data: data,
            columns: columns,
            pageSize: 50,
            onRowClick: showGuestDetails,
            getRowClass: (row) => {
                if (row.isStale) return 'row-warning';
                if (row.neverSignedIn) return 'row-muted';
                return '';
            }
        });
    }

    /**
     * Formats invitation state with badge.
     */
    function formatInvitationState(value) {
        if (value === 'Accepted') {
            return '<span class="badge badge-success">Accepted</span>';
        }
        return '<span class="badge badge-warning">Pending</span>';
    }

    /**
     * Formats guest status.
     */
    function formatGuestStatus(value, row) {
        if (row.invitationState === 'PendingAcceptance') {
            return '<span class="badge badge-warning">Pending</span>';
        }
        if (row.neverSignedIn) {
            return '<span class="badge badge-neutral">Never Signed In</span>';
        }
        if (row.isStale) {
            return '<span class="badge badge-critical">Stale</span>';
        }
        return '<span class="badge badge-success">Active</span>';
    }

    /**
     * Renders Focus/Breakdown tables for guest analysis.
     *
     * @param {Array} guests - Filtered guest data
     */
    function renderFocusBreakdown(guests) {
        var focusContainer = document.getElementById('guests-focus-table');
        var breakdownContainer = document.getElementById('guests-breakdown-table');
        var breakdownFilterContainer = document.getElementById('guests-breakdown-filter');

        if (!focusContainer || !breakdownContainer) return;

        // Breakdown dimension options
        var breakdownDimensions = [
            { key: 'sourceDomain', label: 'Source Domain' },
            { key: 'invitationState', label: 'Invitation State' }
        ];

        // Render breakdown filter
        if (breakdownFilterContainer && typeof FocusTables !== 'undefined') {
            FocusTables.renderBreakdownFilter({
                containerId: 'guests-breakdown-filter',
                dimensions: breakdownDimensions,
                selected: currentBreakdown,
                onChange: function(newDim) {
                    currentBreakdown = newDim;
                    renderFocusBreakdown(guests);
                }
            });
        }

        // Derive guest status for focus grouping
        var guestsWithStatus = guests.map(function(g) {
            var guestStatus = 'Active';
            if (g.invitationState === 'PendingAcceptance') guestStatus = 'Pending';
            else if (g.neverSignedIn) guestStatus = 'Never Signed In';
            else if (g.isStale) guestStatus = 'Stale';
            return Object.assign({}, g, { guestStatus: guestStatus });
        });

        // Render Focus Table: group by status
        if (typeof FocusTables !== 'undefined') {
            FocusTables.renderFocusTable({
                containerId: 'guests-focus-table',
                data: guestsWithStatus,
                groupByKey: 'guestStatus',
                groupByLabel: 'Status',
                countLabel: 'Guests'
            });

            // Render Breakdown Table: status x breakdown dimension
            FocusTables.renderBreakdownTable({
                containerId: 'guests-breakdown-table',
                data: guestsWithStatus,
                primaryKey: 'guestStatus',
                breakdownKey: currentBreakdown,
                primaryLabel: 'Status',
                breakdownLabel: breakdownDimensions.find(function(d) { return d.key === currentBreakdown; }).label
            });
        }
    }

    /**
     * Shows detailed modal for a guest.
     *
     * @param {object} guest - Guest data object
     */
    function showGuestDetails(guest) {
        const modal = document.getElementById('modal-overlay');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = guest.displayName;

        body.innerHTML = `
            <div class="detail-list">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${guest.mail || '--'}</span>

                <span class="detail-label">Source Domain:</span>
                <span class="detail-value">${guest.sourceDomain}</span>

                <span class="detail-label">Invitation State:</span>
                <span class="detail-value">${guest.invitationState}</span>

                <span class="detail-label">Invited:</span>
                <span class="detail-value">${DataLoader.formatDate(guest.createdDateTime)}</span>

                <span class="detail-label">Last Sign-In:</span>
                <span class="detail-value">${DataLoader.formatDate(guest.lastSignIn)}</span>

                <span class="detail-label">Days Since Sign-In:</span>
                <span class="detail-value">${guest.daysSinceLastSignIn !== null ? guest.daysSinceLastSignIn : '--'}</span>

                <span class="detail-label">Is Stale:</span>
                <span class="detail-value">${guest.isStale ? 'Yes' : 'No'}</span>

                <span class="detail-label">Never Signed In:</span>
                <span class="detail-value">${guest.neverSignedIn ? 'Yes' : 'No'}</span>

                <span class="detail-label">Guest ID:</span>
                <span class="detail-value" style="font-size: 0.8em;">${guest.id}</span>
            </div>
        `;

        modal.classList.add('visible');
    }

    /**
     * Creates a summary card element.
     */
    function createSummaryCard(label, value, variant, subtext) {
        var card = document.createElement('div');
        card.className = 'card' + (variant ? ' card-' + variant : '');
        var labelDiv = document.createElement('div');
        labelDiv.className = 'card-label';
        labelDiv.textContent = label;
        var valueDiv = document.createElement('div');
        valueDiv.className = 'card-value' + (variant ? ' ' + variant : '');
        valueDiv.textContent = value;
        card.appendChild(labelDiv);
        card.appendChild(valueDiv);
        if (subtext) {
            var changeDiv = document.createElement('div');
            changeDiv.className = 'card-change';
            changeDiv.textContent = subtext;
            card.appendChild(changeDiv);
        }
        return card;
    }

    /**
     * Creates a platform-style analytics card with mini-bars.
     */
    function createPlatformCard(title, rows) {
        var card = document.createElement('div');
        card.className = 'analytics-card';
        var h4 = document.createElement('h4');
        h4.textContent = title;
        card.appendChild(h4);
        var list = document.createElement('div');
        list.className = 'platform-list';
        rows.forEach(function(row) {
            var rowDiv = document.createElement('div');
            rowDiv.className = 'platform-row';
            var name = document.createElement('span');
            name.className = 'platform-name';
            name.textContent = row.name;
            rowDiv.appendChild(name);
            var policies = document.createElement('span');
            policies.className = 'platform-policies';
            policies.textContent = row.count;
            rowDiv.appendChild(policies);
            var miniBar = document.createElement('div');
            miniBar.className = 'mini-bar';
            var fill = document.createElement('div');
            fill.className = 'mini-bar-fill ' + row.cls;
            fill.style.width = row.pct + '%';
            miniBar.appendChild(fill);
            rowDiv.appendChild(miniBar);
            var rate = document.createElement('span');
            rate.className = 'platform-rate';
            rate.textContent = row.showCount ? row.count : (row.pct + '%');
            rowDiv.appendChild(rate);
            list.appendChild(rowDiv);
        });
        card.appendChild(list);
        return card;
    }

    /**
     * Creates an insight card with badge, description, and action.
     */
    function createInsightCard(type, badge, category, description, action) {
        var card = document.createElement('div');
        card.className = 'insight-card insight-' + type;
        var header = document.createElement('div');
        header.className = 'insight-header';
        var badgeSpan = document.createElement('span');
        badgeSpan.className = 'badge badge-' + type;
        badgeSpan.textContent = badge;
        header.appendChild(badgeSpan);
        var catSpan = document.createElement('span');
        catSpan.className = 'insight-category';
        catSpan.textContent = category;
        header.appendChild(catSpan);
        card.appendChild(header);
        var descP = document.createElement('p');
        descP.className = 'insight-description';
        descP.textContent = description;
        card.appendChild(descP);
        if (action) {
            var actionP = document.createElement('p');
            actionP.className = 'insight-action';
            var strong = document.createElement('strong');
            strong.textContent = 'Action: ';
            actionP.appendChild(strong);
            actionP.appendChild(document.createTextNode(action));
            card.appendChild(actionP);
        }
        return card;
    }

    /**
     * Renders the guests overview section with ASR Rules pattern.
     */
    function renderGuestsOverview(container, stats) {
        container.textContent = '';

        // Build analytics section with donut chart
        var section = document.createElement('div');
        section.className = 'analytics-section';

        var sectionTitle = document.createElement('h3');
        sectionTitle.textContent = 'Guest Health Overview';
        section.appendChild(sectionTitle);

        var complianceOverview = document.createElement('div');
        complianceOverview.className = 'compliance-overview';

        // Donut chart showing active rate
        var chartContainer = document.createElement('div');
        chartContainer.className = 'compliance-chart';
        var donutDiv = document.createElement('div');
        donutDiv.className = 'donut-chart';

        var circumference = 2 * Math.PI * 40;
        var activeDash = (stats.activePct / 100) * circumference;
        var staleDash = (stats.stalePct / 100) * circumference;
        var pendingDash = (stats.pendingPct / 100) * circumference;
        var neverDash = (stats.neverPct / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        var offset = 0;
        if (stats.activePct > 0) {
            var activeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            activeCircle.setAttribute('cx', '50');
            activeCircle.setAttribute('cy', '50');
            activeCircle.setAttribute('r', '40');
            activeCircle.setAttribute('fill', 'none');
            activeCircle.setAttribute('stroke', 'var(--success)');
            activeCircle.setAttribute('stroke-width', '12');
            activeCircle.setAttribute('stroke-dasharray', activeDash + ' ' + circumference);
            activeCircle.setAttribute('stroke-dashoffset', String(-offset));
            activeCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(activeCircle);
            offset += activeDash;
        }
        if (stats.stalePct > 0) {
            var staleCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            staleCircle.setAttribute('cx', '50');
            staleCircle.setAttribute('cy', '50');
            staleCircle.setAttribute('r', '40');
            staleCircle.setAttribute('fill', 'none');
            staleCircle.setAttribute('stroke', 'var(--warning)');
            staleCircle.setAttribute('stroke-width', '12');
            staleCircle.setAttribute('stroke-dasharray', staleDash + ' ' + circumference);
            staleCircle.setAttribute('stroke-dashoffset', String(-offset));
            staleCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(staleCircle);
            offset += staleDash;
        }
        if (stats.pendingPct > 0) {
            var pendCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            pendCircle.setAttribute('cx', '50');
            pendCircle.setAttribute('cy', '50');
            pendCircle.setAttribute('r', '40');
            pendCircle.setAttribute('fill', 'none');
            pendCircle.setAttribute('stroke', 'var(--orange)');
            pendCircle.setAttribute('stroke-width', '12');
            pendCircle.setAttribute('stroke-dasharray', pendingDash + ' ' + circumference);
            pendCircle.setAttribute('stroke-dashoffset', String(-offset));
            pendCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(pendCircle);
            offset += pendingDash;
        }
        if (stats.neverPct > 0) {
            var neverCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            neverCircle.setAttribute('cx', '50');
            neverCircle.setAttribute('cy', '50');
            neverCircle.setAttribute('r', '40');
            neverCircle.setAttribute('fill', 'none');
            neverCircle.setAttribute('stroke', 'var(--critical)');
            neverCircle.setAttribute('stroke-width', '12');
            neverCircle.setAttribute('stroke-dasharray', neverDash + ' ' + circumference);
            neverCircle.setAttribute('stroke-dashoffset', String(-offset));
            neverCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(neverCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = document.createElement('div');
        donutCenter.className = 'donut-center';
        var donutValue = document.createElement('span');
        donutValue.className = 'donut-value';
        donutValue.textContent = stats.activePct + '%';
        var donutLabel = document.createElement('span');
        donutLabel.className = 'donut-label';
        donutLabel.textContent = 'Active';
        donutCenter.appendChild(donutValue);
        donutCenter.appendChild(donutLabel);
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = document.createElement('div');
        legend.className = 'compliance-legend';
        var legendItems = [
            { cls: 'bg-success', label: 'Active', value: stats.activeCount },
            { cls: 'bg-warning', label: 'Stale (60+ days)', value: stats.staleCount },
            { cls: 'bg-orange', label: 'Pending', value: stats.pendingCount },
            { cls: 'bg-critical', label: 'Never Signed In', value: stats.neverSignedInCount },
            { cls: 'bg-info', label: 'Total Guests', value: stats.total }
        ];
        legendItems.forEach(function(item) {
            var legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            var dot = document.createElement('span');
            dot.className = 'legend-dot ' + item.cls;
            legendItem.appendChild(dot);
            legendItem.appendChild(document.createTextNode(' ' + item.label + ': '));
            var strong = document.createElement('strong');
            strong.textContent = item.value;
            legendItem.appendChild(strong);
            legend.appendChild(legendItem);
        });
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = document.createElement('div');
        analyticsGrid.className = 'analytics-grid';

        // Guest Status card
        analyticsGrid.appendChild(createPlatformCard('Guest Status', [
            { name: 'Active', count: stats.activeCount, pct: stats.activePct, cls: 'bg-success' },
            { name: 'Stale', count: stats.staleCount, pct: stats.stalePct, cls: 'bg-warning' },
            { name: 'Pending', count: stats.pendingCount, pct: stats.pendingPct, cls: 'bg-orange' },
            { name: 'Never Signed In', count: stats.neverSignedInCount, pct: stats.neverPct, cls: 'bg-critical' }
        ]));

        // Invitation State card
        var acceptedPct = stats.total > 0 ? Math.round((stats.acceptedCount / stats.total) * 100) : 0;
        analyticsGrid.appendChild(createPlatformCard('Invitation State', [
            { name: 'Accepted', count: stats.acceptedCount, pct: acceptedPct, cls: 'bg-success' },
            { name: 'Pending', count: stats.pendingCount, pct: stats.pendingPct, cls: 'bg-warning' }
        ]));

        // Top Source Domains card
        var topDomains = stats.topDomains.slice(0, 4);
        var maxDomain = topDomains.length > 0 ? topDomains[0].count : 1;
        var domainRows = topDomains.map(function(d) {
            return { name: d.domain, count: d.count, pct: Math.round((d.count / maxDomain) * 100), cls: 'bg-info', showCount: true };
        });
        if (domainRows.length === 0) {
            domainRows = [{ name: 'No domains', count: '--', pct: 0, cls: 'bg-neutral' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Top Source Domains', domainRows));

        // Cleanup Candidates card
        var cleanupTotal = stats.staleCount + stats.neverSignedInCount + stats.pendingCount;
        var cleanupPct = stats.total > 0 ? Math.round((cleanupTotal / stats.total) * 100) : 0;
        analyticsGrid.appendChild(createPlatformCard('Cleanup Candidates', [
            { name: 'Stale Guests', count: stats.staleCount, pct: stats.stalePct, cls: 'bg-warning' },
            { name: 'Never Signed In', count: stats.neverSignedInCount, pct: stats.neverPct, cls: 'bg-critical' },
            { name: 'Pending Invites', count: stats.pendingCount, pct: stats.pendingPct, cls: 'bg-orange' }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = document.createElement('div');
        insightsList.className = 'insights-list';

        // Stale guests insight
        if (stats.staleCount > 0) {
            insightsList.appendChild(createInsightCard('warning', 'CLEANUP', 'Stale Guests',
                stats.staleCount + ' guest' + (stats.staleCount !== 1 ? 's have' : ' has') + ' not signed in for 60+ days. These accounts should be reviewed for removal.',
                'Run an access review or remove stale guest accounts to reduce external exposure.'));
        }

        // Pending invitations insight
        if (stats.pendingCount > 0) {
            insightsList.appendChild(createInsightCard('info', 'PENDING', 'Invitation Status',
                stats.pendingCount + ' invitation' + (stats.pendingCount !== 1 ? 's are' : ' is') + ' still pending acceptance. Consider resending or revoking old invitations.',
                'Review pending invitations and resend or revoke as appropriate.'));
        }

        // Never signed in insight
        if (stats.neverSignedInCount > 0) {
            insightsList.appendChild(createInsightCard('warning', 'REVIEW', 'Never Signed In',
                stats.neverSignedInCount + ' guest' + (stats.neverSignedInCount !== 1 ? 's have' : ' has') + ' accepted but never signed in. These may be candidates for removal.',
                'Verify these guests still need access or remove their accounts.'));
        }

        // Healthy state
        if (stats.staleCount === 0 && stats.pendingCount === 0 && stats.neverSignedInCount === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Guest Status',
                'All guests are active with no stale accounts or pending invitations. Guest lifecycle is well-managed.',
                null));
        }

        container.appendChild(insightsList);
    }

    /**
     * Renders the guests page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        var guests = DataLoader.getData('guests');

        // Calculate stats
        var activeCount = guests.filter(function(g) { return !g.isStale && !g.neverSignedIn && g.invitationState === 'Accepted'; }).length;
        var staleCount = guests.filter(function(g) { return g.isStale; }).length;
        var neverSignedInCount = guests.filter(function(g) { return g.neverSignedIn; }).length;
        var pendingCount = guests.filter(function(g) { return g.invitationState === 'PendingAcceptance'; }).length;
        var acceptedCount = guests.filter(function(g) { return g.invitationState === 'Accepted'; }).length;

        var total = guests.length;
        var activePct = total > 0 ? Math.round((activeCount / total) * 100) : 0;
        var stalePct = total > 0 ? Math.round((staleCount / total) * 100) : 0;
        var pendingPct = total > 0 ? Math.round((pendingCount / total) * 100) : 0;
        var neverPct = total > 0 ? Math.round((neverSignedInCount / total) * 100) : 0;

        // Get top source domains
        var domainCounts = {};
        guests.forEach(function(g) {
            var domain = g.sourceDomain || 'Unknown';
            domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        });
        var topDomains = Object.entries(domainCounts).map(function(e) {
            return { domain: e[0], count: e[1] };
        }).sort(function(a, b) { return b.count - a.count; });

        // Build page structure using DOM methods
        container.textContent = '';

        // Page header
        var header = document.createElement('div');
        header.className = 'page-header';
        var h2 = document.createElement('h2');
        h2.className = 'page-title';
        h2.textContent = 'Guest Accounts';
        header.appendChild(h2);
        var desc = document.createElement('p');
        desc.className = 'page-description';
        desc.textContent = 'External users with access to your tenant';
        header.appendChild(desc);
        container.appendChild(header);

        // Summary cards
        var cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';
        cardsGrid.appendChild(createSummaryCard('Total Guests', total, ''));
        cardsGrid.appendChild(createSummaryCard('Active', activeCount, 'success'));
        cardsGrid.appendChild(createSummaryCard('Stale', staleCount, staleCount > 0 ? 'warning' : '', '60+ days inactive'));
        cardsGrid.appendChild(createSummaryCard('Pending', pendingCount, pendingCount > 0 ? 'warning' : '', 'Awaiting acceptance'));
        container.appendChild(cardsGrid);

        // Overview section
        var overviewDiv = document.createElement('div');
        overviewDiv.id = 'guests-overview';
        container.appendChild(overviewDiv);

        // Render overview with ASR Rules pattern
        renderGuestsOverview(overviewDiv, {
            total: total,
            activeCount: activeCount,
            staleCount: staleCount,
            pendingCount: pendingCount,
            neverSignedInCount: neverSignedInCount,
            acceptedCount: acceptedCount,
            activePct: activePct,
            stalePct: stalePct,
            pendingPct: pendingPct,
            neverPct: neverPct,
            topDomains: topDomains
        });

        // Focus/Breakdown section
        var sectionHeader = document.createElement('div');
        sectionHeader.className = 'section-header';
        var analysisH3 = document.createElement('h3');
        analysisH3.textContent = 'Guest Analysis';
        sectionHeader.appendChild(analysisH3);
        var breakdownFilter = document.createElement('div');
        breakdownFilter.id = 'guests-breakdown-filter';
        sectionHeader.appendChild(breakdownFilter);
        container.appendChild(sectionHeader);

        var fbRow = document.createElement('div');
        fbRow.className = 'focus-breakdown-row';
        var focusTable = document.createElement('div');
        focusTable.id = 'guests-focus-table';
        fbRow.appendChild(focusTable);
        var breakdownTable = document.createElement('div');
        breakdownTable.id = 'guests-breakdown-table';
        fbRow.appendChild(breakdownTable);
        container.appendChild(fbRow);

        // Filters
        var filterDiv = document.createElement('div');
        filterDiv.id = 'guests-filter';
        container.appendChild(filterDiv);

        // Table toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'table-toolbar';
        var colSelectorDiv = document.createElement('div');
        colSelectorDiv.id = 'guests-col-selector';
        toolbar.appendChild(colSelectorDiv);
        var exportBtn = document.createElement('button');
        exportBtn.className = 'btn btn-secondary btn-sm';
        exportBtn.id = 'export-guests-table';
        exportBtn.textContent = 'Export CSV';
        toolbar.appendChild(exportBtn);
        container.appendChild(toolbar);

        // Data table
        var tableDiv = document.createElement('div');
        tableDiv.id = 'guests-table';
        container.appendChild(tableDiv);

        // Create filter bar
        Filters.createFilterBar({
            containerId: 'guests-filter',
            controls: [
                {
                    type: 'search',
                    id: 'guests-search',
                    label: 'Search',
                    placeholder: 'Search guests...'
                },
                {
                    type: 'select',
                    id: 'guests-status',
                    label: 'Status',
                    options: [
                        { value: 'all', label: 'All Status' },
                        { value: 'active', label: 'Active' },
                        { value: 'stale', label: 'Stale' },
                        { value: 'never', label: 'Never Signed In' },
                        { value: 'pending', label: 'Pending' }
                    ]
                },
                {
                    type: 'date-range',
                    id: 'guests-created-range',
                    label: 'Invited'
                },
                {
                    type: 'date-range',
                    id: 'guests-signin-range',
                    label: 'Last Sign-In'
                }
            ],
            onFilter: applyFilters
        });

        // Setup Column Selector
        if (typeof ColumnSelector !== 'undefined') {
            colSelector = ColumnSelector.create({
                containerId: 'guests-col-selector',
                storageKey: 'guests-columns',
                allColumns: [
                    { key: 'displayName', label: 'Name' },
                    { key: 'mail', label: 'Email' },
                    { key: 'sourceDomain', label: 'Source Domain' },
                    { key: 'createdDateTime', label: 'Invited' },
                    { key: 'invitationState', label: 'Invitation' },
                    { key: 'lastSignIn', label: 'Last Sign-In' },
                    { key: 'daysSinceLastSignIn', label: 'Days Inactive' },
                    { key: 'isStale', label: 'Status' },
                    { key: 'neverSignedIn', label: 'Never Signed In' }
                ],
                defaultVisible: [
                    'displayName', 'mail', 'sourceDomain', 'createdDateTime',
                    'invitationState', 'lastSignIn', 'daysSinceLastSignIn', 'isStale'
                ],
                onColumnsChanged: applyFilters
            });
        }

        // Bind export button
        Export.bindExportButton('guests-table', 'guests');

        // Initial render
        applyFilters();
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageGuests = PageGuests;
