/**
 * ============================================================================
 * M365 Tenant Toolkit
 * Author: Robe (https://github.com/Thugney)
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
        'lifecycle': PageLifecycle
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
        console.log('M365 Tenant Toolkit: Initializing...');

        // Setup event handlers
        setupModalHandlers();
        setupNavigation();

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
                            Run the data collection script first:<br>
                            <code>./Invoke-DataCollection.ps1</code>
                        </div>
                    </div>
                `;
            }
            return;
        }

        // Render initial page
        renderCurrentPage();

        console.log('M365 Tenant Toolkit: Ready');
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
