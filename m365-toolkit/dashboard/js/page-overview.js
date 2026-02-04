/**
 * ============================================================================
 * M365 Tenant Toolkit
 * Author: Robe (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * PAGE: OVERVIEW
 *
 * Renders the overview/summary dashboard page with summary cards
 * grouped by category: Users, Risk, and Licenses/Devices.
 */

const PageOverview = (function() {
    'use strict';

    /**
     * Renders the overview page content.
     *
     * @param {HTMLElement} container - The page container element
     */
    function render(container) {
        const summary = DataLoader.getSummary();

        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">Overview</h2>
                <p class="page-description">Summary of your Microsoft 365 tenant health and status</p>
            </div>

            <!-- User Statistics -->
            <div class="section">
                <h3 class="section-title">Users</h3>
                <div class="cards-grid">
                    <div class="card" data-navigate="users">
                        <div class="card-label">Total Users</div>
                        <div class="card-value">${summary.totalUsers.toLocaleString()}</div>
                        <div class="card-change">${summary.employeeCount} employees, ${summary.studentCount} students</div>
                    </div>
                    <div class="card ${summary.disabledUsers > 0 ? 'card-warning' : ''}" data-navigate="users" data-filter="disabled">
                        <div class="card-label">Disabled Accounts</div>
                        <div class="card-value ${summary.disabledUsers > 0 ? 'warning' : ''}">${summary.disabledUsers}</div>
                        <div class="card-change">Accounts that cannot sign in</div>
                    </div>
                    <div class="card ${summary.inactiveUsers > 0 ? 'card-warning' : ''}" data-navigate="users" data-filter="inactive">
                        <div class="card-label">Inactive Users</div>
                        <div class="card-value ${summary.inactiveUsers > 0 ? 'warning' : ''}">${summary.inactiveUsers}</div>
                        <div class="card-change">No sign-in in 90+ days</div>
                    </div>
                    <div class="card" data-navigate="guests">
                        <div class="card-label">Guest Users</div>
                        <div class="card-value">${summary.guestCount}</div>
                        <div class="card-change">${summary.staleGuests} stale guests</div>
                    </div>
                </div>
            </div>

            <!-- Risk & Security Statistics -->
            <div class="section">
                <h3 class="section-title">Security & Risk</h3>
                <div class="cards-grid">
                    <div class="card ${summary.noMfaUsers > 0 ? 'card-critical' : 'card-success'}" data-navigate="security">
                        <div class="card-label">Users Without MFA</div>
                        <div class="card-value ${summary.noMfaUsers > 0 ? 'critical' : 'success'}">${summary.noMfaUsers}</div>
                        <div class="card-change">${summary.noMfaUsers > 0 ? 'Requires attention' : 'All users secured'}</div>
                    </div>
                    <div class="card" data-navigate="security">
                        <div class="card-label">Admin Accounts</div>
                        <div class="card-value">${summary.adminCount}</div>
                        <div class="card-change">Users with admin roles</div>
                    </div>
                    <div class="card ${summary.activeAlerts > 0 ? 'card-warning' : ''}" data-navigate="security">
                        <div class="card-label">Active Alerts</div>
                        <div class="card-value ${summary.activeAlerts > 0 ? 'warning' : ''}">${summary.activeAlerts}</div>
                        <div class="card-change">Security alerts pending</div>
                    </div>
                    <div class="card" data-navigate="guests" data-filter="stale">
                        <div class="card-label">Stale Guests</div>
                        <div class="card-value ${summary.staleGuests > 0 ? 'warning' : ''}">${summary.staleGuests}</div>
                        <div class="card-change">No sign-in in 60+ days</div>
                    </div>
                </div>
            </div>

            <!-- Device Statistics -->
            <div class="section">
                <h3 class="section-title">Devices</h3>
                <div class="cards-grid">
                    <div class="card" data-navigate="devices">
                        <div class="card-label">Total Devices</div>
                        <div class="card-value">${summary.totalDevices}</div>
                        <div class="card-change">Intune managed devices</div>
                    </div>
                    <div class="card card-success" data-navigate="devices" data-filter="compliant">
                        <div class="card-label">Compliant Devices</div>
                        <div class="card-value success">${summary.compliantDevices}</div>
                        <div class="card-change">${summary.totalDevices > 0 ? Math.round((summary.compliantDevices / summary.totalDevices) * 100) : 0}% compliance rate</div>
                    </div>
                    <div class="card ${(summary.totalDevices - summary.compliantDevices - summary.staleDevices) > 0 ? 'card-critical' : ''}" data-navigate="devices" data-filter="noncompliant">
                        <div class="card-label">Non-Compliant</div>
                        <div class="card-value ${(summary.totalDevices - summary.compliantDevices - summary.staleDevices) > 0 ? 'critical' : ''}">${Math.max(0, summary.totalDevices - summary.compliantDevices - summary.staleDevices)}</div>
                        <div class="card-change">Devices not meeting policy</div>
                    </div>
                    <div class="card ${summary.staleDevices > 0 ? 'card-warning' : ''}" data-navigate="devices" data-filter="stale">
                        <div class="card-label">Stale Devices</div>
                        <div class="card-value ${summary.staleDevices > 0 ? 'warning' : ''}">${summary.staleDevices}</div>
                        <div class="card-change">No sync in 90+ days</div>
                    </div>
                </div>
            </div>
        `;

        // Add click handlers for navigation cards
        const cards = container.querySelectorAll('.card[data-navigate]');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const page = card.dataset.navigate;
                const filter = card.dataset.filter;
                window.location.hash = filter ? `${page}?filter=${filter}` : page;
            });
        });
    }

    // Public API
    return {
        render: render
    };

})();

// Register page
window.PageOverview = PageOverview;
