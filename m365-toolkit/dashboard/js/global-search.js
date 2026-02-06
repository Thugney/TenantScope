/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * GLOBAL SEARCH MODULE
 *
 * Provides a global search interface accessible via Ctrl+K (Cmd+K on Mac).
 * Searches across all data types and provides quick navigation to results.
 *
 * Usage:
 *   GlobalSearch.init();
 *   // User presses Ctrl+K to open search
 */

const GlobalSearch = (function() {
    'use strict';

    // ========================================================================
    // PRIVATE STATE
    // ========================================================================

    /** Search modal element */
    let modalEl = null;

    /** Search input element */
    let inputEl = null;

    /** Results container element */
    let resultsEl = null;

    /** Current search results */
    let currentResults = [];

    /** Currently selected result index */
    let selectedIndex = -1;

    /** Recent searches (stored in localStorage) */
    let recentSearches = [];

    /** Maximum recent searches to store */
    const MAX_RECENT = 5;

    /** Maximum results per category */
    const MAX_RESULTS_PER_CATEGORY = 5;

    /** Debounce timeout */
    let searchTimeout = null;

    /** Storage key for recent searches */
    const STORAGE_KEY = 'tenantscope-recent-searches';

    // ========================================================================
    // SEARCH CONFIGURATION
    // ========================================================================

    /**
     * Search categories configuration.
     * Each category defines what data to search and how to display results.
     */
    const searchCategories = [
        {
            key: 'users',
            label: 'Users',
            icon: 'user',
            dataKey: 'users',
            searchFields: ['displayName', 'userPrincipalName', 'mail', 'department', 'jobTitle'],
            displayField: 'displayName',
            subtitleField: 'userPrincipalName',
            page: 'users'
        },
        {
            key: 'guests',
            label: 'Guests',
            icon: 'user-plus',
            dataKey: 'guests',
            searchFields: ['displayName', 'mail', 'companyName'],
            displayField: 'displayName',
            subtitleField: 'mail',
            page: 'guests'
        },
        {
            key: 'devices',
            label: 'Devices',
            icon: 'monitor',
            dataKey: 'devices',
            searchFields: ['displayName', 'deviceName', 'operatingSystem', 'manufacturer', 'model'],
            displayField: 'displayName',
            subtitleField: 'operatingSystem',
            page: 'devices'
        },
        {
            key: 'teams',
            label: 'Teams',
            icon: 'users',
            dataKey: 'teams',
            searchFields: ['displayName', 'description', 'mailNickname'],
            displayField: 'displayName',
            subtitleField: 'description',
            page: 'teams'
        },
        {
            key: 'sharepoint',
            label: 'SharePoint Sites',
            icon: 'globe',
            dataKey: 'sharepointSites',
            searchFields: ['displayName', 'webUrl', 'description'],
            displayField: 'displayName',
            subtitleField: 'webUrl',
            page: 'sharepoint'
        },
        {
            key: 'apps',
            label: 'Enterprise Apps',
            icon: 'briefcase',
            dataKey: 'enterpriseApps',
            searchFields: ['displayName', 'appId'],
            displayField: 'displayName',
            subtitleField: 'appId',
            page: 'enterprise-apps'
        }
    ];

    /**
     * Navigation pages for quick access.
     */
    const navigationPages = [
        { key: 'overview', label: 'Overview', icon: 'grid' },
        { key: 'users', label: 'Users', icon: 'user' },
        { key: 'guests', label: 'Guests', icon: 'user-plus' },
        { key: 'devices', label: 'Devices', icon: 'monitor' },
        { key: 'licenses', label: 'Licenses', icon: 'key' },
        { key: 'security', label: 'Security', icon: 'shield' },
        { key: 'teams', label: 'Teams', icon: 'users' },
        { key: 'sharepoint', label: 'SharePoint', icon: 'globe' },
        { key: 'conditional-access', label: 'Conditional Access', icon: 'shield' },
        { key: 'pim', label: 'PIM', icon: 'shield' },
        { key: 'audit-logs', label: 'Audit Logs', icon: 'file-text' },
        { key: 'report', label: 'Executive Report', icon: 'file-text' }
    ];

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Creates an SVG icon element.
     * @param {string} name - Icon name
     * @returns {SVGElement} SVG element
     */
    function createIcon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');

        switch (name) {
            case 'search':
                var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '11');
                circle.setAttribute('cy', '11');
                circle.setAttribute('r', '8');
                svg.appendChild(circle);
                var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', '21');
                line.setAttribute('y1', '21');
                line.setAttribute('x2', '16.65');
                line.setAttribute('y2', '16.65');
                svg.appendChild(line);
                break;
            case 'user':
                var path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path1.setAttribute('d', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2');
                svg.appendChild(path1);
                var circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle2.setAttribute('cx', '12');
                circle2.setAttribute('cy', '7');
                circle2.setAttribute('r', '4');
                svg.appendChild(circle2);
                break;
            case 'user-plus':
                var path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path2.setAttribute('d', 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2');
                svg.appendChild(path2);
                var circle3 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle3.setAttribute('cx', '8.5');
                circle3.setAttribute('cy', '7');
                circle3.setAttribute('r', '4');
                svg.appendChild(circle3);
                var line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '20');
                line2.setAttribute('y1', '8');
                line2.setAttribute('x2', '20');
                line2.setAttribute('y2', '14');
                svg.appendChild(line2);
                var line3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line3.setAttribute('x1', '23');
                line3.setAttribute('y1', '11');
                line3.setAttribute('x2', '17');
                line3.setAttribute('y2', '11');
                svg.appendChild(line3);
                break;
            case 'monitor':
                var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', '2');
                rect.setAttribute('y', '3');
                rect.setAttribute('width', '20');
                rect.setAttribute('height', '14');
                rect.setAttribute('rx', '2');
                rect.setAttribute('ry', '2');
                svg.appendChild(rect);
                var line4 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line4.setAttribute('x1', '8');
                line4.setAttribute('y1', '21');
                line4.setAttribute('x2', '16');
                line4.setAttribute('y2', '21');
                svg.appendChild(line4);
                var line5 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line5.setAttribute('x1', '12');
                line5.setAttribute('y1', '17');
                line5.setAttribute('x2', '12');
                line5.setAttribute('y2', '21');
                svg.appendChild(line5);
                break;
            case 'users':
                var path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path3.setAttribute('d', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2');
                svg.appendChild(path3);
                var circle4 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle4.setAttribute('cx', '9');
                circle4.setAttribute('cy', '7');
                circle4.setAttribute('r', '4');
                svg.appendChild(circle4);
                var path4 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path4.setAttribute('d', 'M23 21v-2a4 4 0 0 0-3-3.87');
                svg.appendChild(path4);
                var path5 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path5.setAttribute('d', 'M16 3.13a4 4 0 0 1 0 7.75');
                svg.appendChild(path5);
                break;
            case 'globe':
                var circle5 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle5.setAttribute('cx', '12');
                circle5.setAttribute('cy', '12');
                circle5.setAttribute('r', '10');
                svg.appendChild(circle5);
                var line6 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line6.setAttribute('x1', '2');
                line6.setAttribute('y1', '12');
                line6.setAttribute('x2', '22');
                line6.setAttribute('y2', '12');
                svg.appendChild(line6);
                var path6 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path6.setAttribute('d', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z');
                svg.appendChild(path6);
                break;
            case 'briefcase':
                var rect2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect2.setAttribute('x', '2');
                rect2.setAttribute('y', '7');
                rect2.setAttribute('width', '20');
                rect2.setAttribute('height', '14');
                rect2.setAttribute('rx', '2');
                rect2.setAttribute('ry', '2');
                svg.appendChild(rect2);
                var path7 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path7.setAttribute('d', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16');
                svg.appendChild(path7);
                break;
            case 'grid':
                var rect3 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect3.setAttribute('x', '3');
                rect3.setAttribute('y', '3');
                rect3.setAttribute('width', '7');
                rect3.setAttribute('height', '7');
                svg.appendChild(rect3);
                var rect4 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect4.setAttribute('x', '14');
                rect4.setAttribute('y', '3');
                rect4.setAttribute('width', '7');
                rect4.setAttribute('height', '7');
                svg.appendChild(rect4);
                var rect5 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect5.setAttribute('x', '3');
                rect5.setAttribute('y', '14');
                rect5.setAttribute('width', '7');
                rect5.setAttribute('height', '7');
                svg.appendChild(rect5);
                var rect6 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect6.setAttribute('x', '14');
                rect6.setAttribute('y', '14');
                rect6.setAttribute('width', '7');
                rect6.setAttribute('height', '7');
                svg.appendChild(rect6);
                break;
            case 'key':
                var path8 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path8.setAttribute('d', 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4');
                svg.appendChild(path8);
                break;
            case 'shield':
                var path9 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path9.setAttribute('d', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
                svg.appendChild(path9);
                break;
            case 'file-text':
                var path10 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path10.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
                svg.appendChild(path10);
                var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', '14 2 14 8 20 8');
                svg.appendChild(polyline);
                var line7 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line7.setAttribute('x1', '16');
                line7.setAttribute('y1', '13');
                line7.setAttribute('x2', '8');
                line7.setAttribute('y2', '13');
                svg.appendChild(line7);
                var line8 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line8.setAttribute('x1', '16');
                line8.setAttribute('y1', '17');
                line8.setAttribute('x2', '8');
                line8.setAttribute('y2', '17');
                svg.appendChild(line8);
                break;
            case 'clock':
                var circle6 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle6.setAttribute('cx', '12');
                circle6.setAttribute('cy', '12');
                circle6.setAttribute('r', '10');
                svg.appendChild(circle6);
                var polyline2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline2.setAttribute('points', '12 6 12 12 16 14');
                svg.appendChild(polyline2);
                break;
            case 'arrow-right':
                var line9 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line9.setAttribute('x1', '5');
                line9.setAttribute('y1', '12');
                line9.setAttribute('x2', '19');
                line9.setAttribute('y2', '12');
                svg.appendChild(line9);
                var polyline3 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline3.setAttribute('points', '12 5 19 12 12 19');
                svg.appendChild(polyline3);
                break;
        }

        return svg;
    }

    /**
     * Loads recent searches from localStorage.
     */
    function loadRecentSearches() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                recentSearches = JSON.parse(stored);
            }
        } catch (e) {
            recentSearches = [];
        }
    }

    /**
     * Saves recent searches to localStorage.
     */
    function saveRecentSearches() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(recentSearches));
        } catch (e) {
            // Ignore storage errors
        }
    }

    /**
     * Adds a search term to recent searches.
     * @param {string} term - Search term
     */
    function addRecentSearch(term) {
        if (!term || term.trim().length < 2) return;

        term = term.trim();

        // Remove if already exists
        recentSearches = recentSearches.filter(function(s) {
            return s.toLowerCase() !== term.toLowerCase();
        });

        // Add to front
        recentSearches.unshift(term);

        // Limit size
        if (recentSearches.length > MAX_RECENT) {
            recentSearches = recentSearches.slice(0, MAX_RECENT);
        }

        saveRecentSearches();
    }

    /**
     * Creates the search modal DOM structure.
     */
    function createModal() {
        modalEl = document.createElement('div');
        modalEl.id = 'global-search-modal';
        modalEl.className = 'global-search-modal';
        modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');
        modalEl.setAttribute('aria-labelledby', 'global-search-title');

        // Backdrop
        var backdrop = document.createElement('div');
        backdrop.className = 'global-search-backdrop';
        backdrop.addEventListener('click', close);
        modalEl.appendChild(backdrop);

        // Dialog
        var dialog = document.createElement('div');
        dialog.className = 'global-search-dialog';

        // Header with search input
        var header = document.createElement('div');
        header.className = 'global-search-header';

        var searchIcon = document.createElement('span');
        searchIcon.className = 'global-search-icon';
        searchIcon.appendChild(createIcon('search'));
        header.appendChild(searchIcon);

        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'global-search-input';
        inputEl.placeholder = 'Search users, devices, teams, pages...';
        inputEl.id = 'global-search-input';
        inputEl.setAttribute('aria-label', 'Search');
        inputEl.addEventListener('input', handleSearchInput);
        inputEl.addEventListener('keydown', handleKeyDown);
        header.appendChild(inputEl);

        var shortcut = document.createElement('span');
        shortcut.className = 'global-search-shortcut';
        shortcut.textContent = 'ESC';
        header.appendChild(shortcut);

        dialog.appendChild(header);

        // Results container
        resultsEl = document.createElement('div');
        resultsEl.className = 'global-search-results';
        resultsEl.id = 'global-search-results';
        resultsEl.setAttribute('role', 'listbox');
        dialog.appendChild(resultsEl);

        // Footer
        var footer = document.createElement('div');
        footer.className = 'global-search-footer';

        var hint1 = document.createElement('span');
        hint1.className = 'global-search-hint';
        hint1.textContent = 'Use arrow keys to navigate';
        footer.appendChild(hint1);

        var hint2 = document.createElement('span');
        hint2.className = 'global-search-hint';
        hint2.textContent = 'Enter to select';
        footer.appendChild(hint2);

        dialog.appendChild(footer);

        modalEl.appendChild(dialog);
        document.body.appendChild(modalEl);
    }

    /**
     * Handles search input changes.
     */
    function handleSearchInput() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function() {
            var query = inputEl.value.trim();
            if (query.length < 2) {
                renderDefaultResults();
            } else {
                performSearch(query);
            }
        }, 150);
    }

    /**
     * Handles keyboard navigation.
     * @param {KeyboardEvent} e - Keyboard event
     */
    function handleKeyDown(e) {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectNext();
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectPrev();
                break;
            case 'Enter':
                e.preventDefault();
                activateSelected();
                break;
            case 'Escape':
                e.preventDefault();
                close();
                break;
        }
    }

    /**
     * Selects the next result.
     */
    function selectNext() {
        if (currentResults.length === 0) return;
        selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
        updateSelection();
    }

    /**
     * Selects the previous result.
     */
    function selectPrev() {
        if (currentResults.length === 0) return;
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
    }

    /**
     * Updates the visual selection.
     */
    function updateSelection() {
        var items = resultsEl.querySelectorAll('.global-search-item');
        items.forEach(function(item, index) {
            if (index === selectedIndex) {
                item.classList.add('selected');
                item.setAttribute('aria-selected', 'true');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
                item.setAttribute('aria-selected', 'false');
            }
        });
    }

    /**
     * Activates the currently selected result.
     */
    function activateSelected() {
        if (selectedIndex < 0 || selectedIndex >= currentResults.length) return;

        var result = currentResults[selectedIndex];
        if (result.type === 'page') {
            navigateToPage(result.page);
        } else if (result.type === 'recent') {
            inputEl.value = result.term;
            performSearch(result.term);
        } else {
            navigateToPage(result.page);
            // Add to recent searches
            addRecentSearch(inputEl.value);
        }
    }

    /**
     * Navigates to a page.
     * @param {string} page - Page key
     */
    function navigateToPage(page) {
        close();
        // Trigger navigation via hash change
        window.location.hash = '#' + page;
    }

    /**
     * Performs a search across all categories.
     * @param {string} query - Search query
     */
    function performSearch(query) {
        currentResults = [];
        var queryLower = query.toLowerCase();

        // Search navigation pages first
        navigationPages.forEach(function(page) {
            if (page.label.toLowerCase().includes(queryLower) ||
                page.key.toLowerCase().includes(queryLower)) {
                currentResults.push({
                    type: 'page',
                    page: page.key,
                    label: page.label,
                    icon: page.icon,
                    subtitle: 'Go to page'
                });
            }
        });

        // Search data categories
        searchCategories.forEach(function(category) {
            var data = DataLoader.getData(category.dataKey);
            if (!data || !Array.isArray(data)) return;

            var matches = data.filter(function(item) {
                return category.searchFields.some(function(field) {
                    var value = item[field];
                    if (!value) return false;
                    return String(value).toLowerCase().includes(queryLower);
                });
            }).slice(0, MAX_RESULTS_PER_CATEGORY);

            matches.forEach(function(item) {
                currentResults.push({
                    type: 'data',
                    category: category.key,
                    categoryLabel: category.label,
                    page: category.page,
                    label: item[category.displayField] || 'Unknown',
                    subtitle: item[category.subtitleField] || '',
                    icon: category.icon,
                    item: item
                });
            });
        });

        selectedIndex = currentResults.length > 0 ? 0 : -1;
        renderResults();
    }

    /**
     * Renders the default results (recent searches + quick navigation).
     */
    function renderDefaultResults() {
        currentResults = [];

        // Add recent searches
        recentSearches.forEach(function(term) {
            currentResults.push({
                type: 'recent',
                term: term,
                label: term,
                subtitle: 'Recent search',
                icon: 'clock'
            });
        });

        // Add quick navigation
        navigationPages.slice(0, 6).forEach(function(page) {
            currentResults.push({
                type: 'page',
                page: page.key,
                label: page.label,
                icon: page.icon,
                subtitle: 'Quick navigation'
            });
        });

        selectedIndex = currentResults.length > 0 ? 0 : -1;
        renderResults();
    }

    /**
     * Renders the search results.
     */
    function renderResults() {
        // Clear results
        while (resultsEl.firstChild) {
            resultsEl.removeChild(resultsEl.firstChild);
        }

        if (currentResults.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'global-search-empty';
            empty.textContent = 'No results found';
            resultsEl.appendChild(empty);
            return;
        }

        // Group results by type
        var groups = {};
        currentResults.forEach(function(result, index) {
            var groupKey = result.type === 'data' ? result.categoryLabel :
                          (result.type === 'recent' ? 'Recent' : 'Pages');
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push({ result: result, index: index });
        });

        // Render groups
        Object.keys(groups).forEach(function(groupKey) {
            var groupLabel = document.createElement('div');
            groupLabel.className = 'global-search-group-label';
            groupLabel.textContent = groupKey;
            resultsEl.appendChild(groupLabel);

            groups[groupKey].forEach(function(item) {
                var result = item.result;
                var index = item.index;

                var itemEl = document.createElement('div');
                itemEl.className = 'global-search-item';
                if (index === selectedIndex) {
                    itemEl.classList.add('selected');
                }
                itemEl.setAttribute('role', 'option');
                itemEl.setAttribute('aria-selected', index === selectedIndex ? 'true' : 'false');
                itemEl.dataset.index = index;

                var iconEl = document.createElement('span');
                iconEl.className = 'global-search-item-icon';
                iconEl.appendChild(createIcon(result.icon));
                itemEl.appendChild(iconEl);

                var contentEl = document.createElement('div');
                contentEl.className = 'global-search-item-content';

                var labelEl = document.createElement('span');
                labelEl.className = 'global-search-item-label';
                labelEl.textContent = result.label;
                contentEl.appendChild(labelEl);

                if (result.subtitle) {
                    var subtitleEl = document.createElement('span');
                    subtitleEl.className = 'global-search-item-subtitle';
                    subtitleEl.textContent = result.subtitle;
                    contentEl.appendChild(subtitleEl);
                }

                itemEl.appendChild(contentEl);

                var arrowEl = document.createElement('span');
                arrowEl.className = 'global-search-item-arrow';
                arrowEl.appendChild(createIcon('arrow-right'));
                itemEl.appendChild(arrowEl);

                itemEl.addEventListener('click', function() {
                    selectedIndex = index;
                    activateSelected();
                });

                itemEl.addEventListener('mouseenter', function() {
                    selectedIndex = index;
                    updateSelection();
                });

                resultsEl.appendChild(itemEl);
            });
        });
    }

    /**
     * Opens the search modal.
     */
    function open() {
        if (!modalEl) {
            createModal();
        }

        loadRecentSearches();
        modalEl.classList.add('visible');
        inputEl.value = '';
        inputEl.focus();
        renderDefaultResults();

        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    /**
     * Closes the search modal.
     */
    function close() {
        if (modalEl) {
            modalEl.classList.remove('visible');
        }

        // Restore body scroll
        document.body.style.overflow = '';
    }

    /**
     * Handles global keyboard shortcuts.
     * @param {KeyboardEvent} e - Keyboard event
     */
    function handleGlobalKeyDown(e) {
        // Ctrl+K or Cmd+K to open search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            open();
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        /**
         * Initializes the global search.
         */
        init: function() {
            // Listen for keyboard shortcut
            document.addEventListener('keydown', handleGlobalKeyDown);

            // Create search trigger button in header
            var headerMeta = document.querySelector('.header-meta');
            if (headerMeta) {
                var searchBtn = document.createElement('button');
                searchBtn.className = 'header-search-btn';
                searchBtn.type = 'button';
                searchBtn.setAttribute('aria-label', 'Search (Ctrl+K)');
                searchBtn.title = 'Search (Ctrl+K)';
                searchBtn.appendChild(createIcon('search'));

                var shortcutHint = document.createElement('span');
                shortcutHint.className = 'header-search-shortcut';
                shortcutHint.textContent = 'Ctrl+K';
                searchBtn.appendChild(shortcutHint);

                searchBtn.addEventListener('click', open);
                headerMeta.insertBefore(searchBtn, headerMeta.firstChild);
            }
        },

        /**
         * Opens the search modal.
         */
        open: open,

        /**
         * Closes the search modal.
         */
        close: close
    };

})();

// Export for use in other modules
window.GlobalSearch = GlobalSearch;
