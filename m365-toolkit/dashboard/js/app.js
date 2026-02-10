/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * APP.JS - Main Application Controller
 *
 * Handles application initialization, routing, and navigation.
 * This is the entry point that bootstraps the dashboard.
 */

(function() {
    'use strict';

    // ========================================================================
    // PAGE REGISTRY
    // Maps route names to their render functions
    // ========================================================================

    const pages = {
        'overview': PageOverview,
        'users': PageUsers,
        'licenses': PageLicenses,
        'guests': PageGuests,
        'security': PageSecurity,
        'devices': PageDevices,
        'enterprise-apps': PageEnterpriseApps,
        'lifecycle': PageLifecycle,
        'groups': PageGroups,
        'teams': PageTeams,
        'sharepoint': PageSharePoint,
        'audit-logs': PageAuditLogs,
        'pim': PagePIM,
        'report': PageReport,
        'data-quality': PageDataQuality,
        'app-usage': PageAppUsage,
        'conditional-access': PageConditionalAccess,
        'organization': PageOrganization,
        'license-analysis': PageLicenseAnalysis,
        // New v2.0 pages
        'compliance-policies': PageCompliancePolicies,
        'configuration-profiles': PageConfigurationProfiles,
        'windows-update': PageWindowsUpdate,
        'bitlocker': PageBitLocker,
        'app-deployments': PageAppDeployments,
        'endpoint-analytics': PageEndpointAnalytics,
        'credential-expiry': PageCredentialExpiry,
        'asr-rules': PageASRRules,
        'signin-logs': PageSignInLogs,
        // New security & compliance pages
        'identity-risk': PageIdentityRisk,
        'oauth-consent': PageOAuthConsent,
        'compliance': PageCompliance,
        'vulnerabilities': PageVulnerabilities,
        // Problem Summary page
        'problems': PageProblems
    };

    // ========================================================================
    // ROUTING
    // ========================================================================

    /**
     * Gets the current page name from the URL hash.
     *
     * @returns {string} Page name (e.g., 'overview', 'users')
     */
    function getCurrentPage() {
        const hash = window.location.hash.slice(1); // Remove #
        const pageName = hash.split('?')[0]; // Remove query params
        return pageName || 'overview';
    }

    /**
     * Gets hash query parameters (e.g., #users?tab=users&search=alice).
     *
     * @returns {object} Key/value map of hash params
     */
    function getHashParams() {
        const hash = window.location.hash || '';
        const idx = hash.indexOf('?');
        if (idx === -1) return {};
        const query = hash.substring(idx + 1);
        const params = new URLSearchParams(query);
        const result = {};
        params.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }

    function inferTabForSearch(pageName) {
        const buttons = Array.from(document.querySelectorAll('.tab-btn'));
        if (buttons.length === 0) return null;

        const allBtn = buttons.find(btn => /\ball\b/i.test((btn.textContent || '').trim()));
        if (allBtn && allBtn.dataset.tab) return allBtn.dataset.tab;

        const pageBtn = buttons.find(btn => btn.dataset.tab === pageName);
        if (pageBtn) return pageBtn.dataset.tab;

        const nonOverview = buttons.find(btn => btn.dataset.tab && btn.dataset.tab !== 'overview');
        if (nonOverview) return nonOverview.dataset.tab;

        return buttons[0].dataset.tab || null;
    }

    function applyHashParamsToPage(pageName) {
        const params = getHashParams();
        if (!params || Object.keys(params).length === 0) return;

        const searchValue = params.search || params.user || params.upn || params.device || params.group || '';
        let tabToSelect = params.tab;
        if (!tabToSelect && searchValue) {
            tabToSelect = inferTabForSearch(pageName);
        }

        if (tabToSelect) {
            const tabBtn = document.querySelector('.tab-btn[data-tab="' + tabToSelect + '"]');
            if (tabBtn && !tabBtn.classList.contains('active')) {
                tabBtn.click();
            }
        }

        if (searchValue) {
            setTimeout(() => {
                const content = document.querySelector('.content-area') || document;
                let input = content.querySelector('input.filter-input[id$="-search"]');
                if (!input) {
                    input = content.querySelector('input[type="text"][id$="-search"]');
                }
                if (!input && pageName) {
                    input = document.getElementById(pageName + '-search');
                }
                if (input) {
                    input.value = searchValue;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, 50);
        }
    }

    /**
     * Navigates to a specific page.
     *
     * @param {string} pageName - The page to navigate to
     */
    function navigateTo(pageName) {
        if (!pages[pageName]) {
            console.warn('App: Unknown page:', pageName);
            pageName = 'overview';
        }

        window.location.hash = pageName;
    }

    /**
     * Renders the current page based on the URL hash.
     */
    function renderCurrentPage() {
        const pageName = getCurrentPage();
        const page = pages[pageName];

        if (!page) {
            console.warn('App: Page not found:', pageName);
            navigateTo('overview');
            return;
        }

        // Update active nav link
        updateActiveNavLink(pageName);

        // Update page subtitle in header
        updateHeaderSubtitle(pageName);

        // Update time range indicator for page context
        if (typeof TimeRangeFilter !== 'undefined' && TimeRangeFilter.updateIndicator) {
            TimeRangeFilter.updateIndicator(pageName);
        }

        // Get page container
        const container = document.getElementById('page-container');
        if (!container) {
            console.error('App: Page container not found');
            return;
        }

        // Clear existing content
        container.innerHTML = '';

        // Render the page
        try {
            page.render(container);
            applyHashParamsToPage(pageName);
        } catch (error) {
            console.error('App: Error rendering page:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-title">Error Loading Page</div>
                    <div class="empty-state-description">${error.message}</div>
                </div>
            `;
        }
    }

    /**
     * Updates the active state on nav links.
     *
     * @param {string} activePage - The currently active page name
     */
    function updateActiveNavLink(activePage) {
        const navLinks = document.querySelectorAll('.nav-link');

        navLinks.forEach(link => {
            const linkPage = link.dataset.page;
            if (linkPage === activePage) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    /**
     * Updates the header subtitle to show current page.
     *
     * @param {string} pageName - The current page name
     */
    function updateHeaderSubtitle(pageName) {
        const subtitle = document.getElementById('header-subtitle');
        if (subtitle) {
            // Capitalize first letter
            subtitle.textContent = pageName.charAt(0).toUpperCase() + pageName.slice(1);
        }
    }

    // ========================================================================
    // MODAL HANDLING
    // ========================================================================

    /**
     * Sets up modal close handlers.
     */
    function setupModalHandlers() {
        const modalOverlay = document.getElementById('modal-overlay');
        const modalClose = document.getElementById('modal-close');

        if (modalClose) {
            modalClose.addEventListener('click', () => {
                modalOverlay.classList.remove('visible');
            });
        }

        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    modalOverlay.classList.remove('visible');
                }
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalOverlay.classList.contains('visible')) {
                modalOverlay.classList.remove('visible');
            }
        });
    }

    // ========================================================================
    // SIDEBAR TOGGLE
    // ========================================================================

    /**
     * Sets up the sidebar collapse/expand toggle.
     * Persists state in localStorage.
     */
    function setupSidebarToggle() {
        const sidebar = document.getElementById('sidebar');
        const toggleBtn = document.getElementById('sidebar-toggle');

        if (!sidebar || !toggleBtn) return;

        // Restore saved state
        const savedState = localStorage.getItem('tenantscope-sidebar-collapsed');
        if (savedState === 'true') {
            sidebar.classList.add('collapsed');
        }

        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('tenantscope-sidebar-collapsed', isCollapsed);
        });
    }

    // ========================================================================
    // MOBILE MENU
    // ========================================================================

    /**
     * Sets up mobile menu toggle functionality.
     */
    function setupMobileMenu() {
        const sidebar = document.getElementById('sidebar');
        const menuBtn = document.getElementById('mobile-menu-btn');
        const overlay = document.getElementById('sidebar-overlay');

        if (!sidebar || !menuBtn) return;

        function closeMobileMenu() {
            sidebar.classList.remove('mobile-open');
            if (overlay) overlay.classList.remove('visible');
        }

        function openMobileMenu() {
            sidebar.classList.add('mobile-open');
            if (overlay) overlay.classList.add('visible');
        }

        menuBtn.addEventListener('click', () => {
            if (sidebar.classList.contains('mobile-open')) {
                closeMobileMenu();
            } else {
                openMobileMenu();
            }
        });

        // Close when clicking overlay
        if (overlay) {
            overlay.addEventListener('click', closeMobileMenu);
        }

        // Close when clicking a nav link (on mobile)
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    closeMobileMenu();
                }
            });
        });
    }

    // ========================================================================
    // NAV GROUP COLLAPSE/EXPAND
    // ========================================================================

    /**
     * Sets up collapsible nav groups.
     * Persists collapsed state in localStorage.
     */
    function setupNavGroups() {
        const toggles = document.querySelectorAll('.nav-group-toggle');

        // Restore saved collapsed states
        const savedStates = JSON.parse(localStorage.getItem('tenantscope-nav-groups') || '{}');

        toggles.forEach(toggle => {
            const groupName = toggle.dataset.group;
            const group = toggle.closest('.nav-group');

            // Apply saved state (all expanded by default)
            if (savedStates[groupName] === true) {
                group.classList.add('collapsed');
            }

            toggle.addEventListener('click', () => {
                group.classList.toggle('collapsed');

                // Save state
                const states = JSON.parse(localStorage.getItem('tenantscope-nav-groups') || '{}');
                states[groupName] = group.classList.contains('collapsed');
                localStorage.setItem('tenantscope-nav-groups', JSON.stringify(states));
            });
        });
    }

    // ========================================================================
    // MOBILE BOTTOM NAVIGATION
    // ========================================================================

    /**
     * Sets up mobile bottom navigation.
     */
    function setupMobileBottomNav() {
        var bottomNav = document.getElementById('mobile-bottom-nav');
        var searchBtn = document.getElementById('mobile-search-btn');

        if (!bottomNav) return;

        // Handle search button
        if (searchBtn && typeof GlobalSearch !== 'undefined') {
            searchBtn.addEventListener('click', function(e) {
                e.preventDefault();
                GlobalSearch.open();
            });
        }

        // Update active state on navigation
        function updateMobileNavActive() {
            var currentPage = getCurrentPage();
            var items = bottomNav.querySelectorAll('.mobile-bottom-nav-item[data-page]');
            items.forEach(function(item) {
                if (item.dataset.page === currentPage) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }

        // Update on hash change
        window.addEventListener('hashchange', updateMobileNavActive);

        // Initial update
        updateMobileNavActive();
    }

    // ========================================================================
    // NAVIGATION HANDLERS
    // ========================================================================

    /**
     * Sets up navigation click handlers.
     */
    function setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                // Let the hash change trigger the page render
                // The link's href already has the hash
            });
        });

        // Listen for hash changes
        window.addEventListener('hashchange', () => {
            renderCurrentPage();
        });
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Initializes the application.
     */
    async function init() {
        console.log('TenantScope: Initializing...');

        // Setup event handlers
        setupModalHandlers();
        setupNavigation();
        setupSidebarToggle();
        setupMobileMenu();
        setupNavGroups();

        // Update version from build bundle
        if (window.__M365_VERSION) {
            var versionEl = document.querySelector('.sidebar-version');
            if (versionEl) {
                versionEl.textContent = 'v' + window.__M365_VERSION;
            }
        }

        // Load data
        const dataLoaded = await DataLoader.loadAll();

        if (!dataLoaded) {
            console.error('App: Failed to load data');
            const container = document.getElementById('page-container');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">&#9888;</div>
                        <div class="empty-state-title">No Data Available</div>
                        <div class="empty-state-description">
                            After collecting data, build the dashboard to make it viewable:<br><br>
                            <code>.\\scripts\\Build-Dashboard.ps1</code><br><br>
                            Or use sample data for testing:<br>
                            <code>.\\scripts\\Build-Dashboard.ps1 -UseSampleData</code>
                        </div>
                    </div>
                `;
            }
            return;
        }

        // Initialize department filter
        if (typeof DepartmentFilter !== 'undefined') {
            DepartmentFilter.init();
            document.addEventListener('departmentChanged', function() {
                renderCurrentPage();
            });
        }

        // Initialize time range filter
        if (typeof TimeRangeFilter !== 'undefined') {
            TimeRangeFilter.init();
            document.addEventListener('timeRangeChanged', function() {
                renderCurrentPage();
            });
        }

        // Initialize global search (Ctrl+K)
        if (typeof GlobalSearch !== 'undefined') {
            GlobalSearch.init();
        }

        // Initialize keyboard shortcuts
        if (typeof KeyboardShortcuts !== 'undefined') {
            KeyboardShortcuts.init();
        }

        // Setup mobile bottom nav
        setupMobileBottomNav();

        // Render initial page
        renderCurrentPage();

        console.log('TenantScope: Ready');
    }

    // Start the application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose navigation for programmatic use
    window.App = {
        navigateTo: navigateTo,
        refresh: renderCurrentPage
    };

})();
