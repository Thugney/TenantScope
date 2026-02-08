/**
 * ============================================================================
 * TenantScope - Usage Tracker
 * ============================================================================
 *
 * Tracks dashboard usage when served via Start-DashboardServer.ps1
 * Captures page views, session duration, and user activity.
 */

const UsageTracker = (function() {
    'use strict';

    let currentUser = null;
    let sessionStart = new Date();
    let isServerMode = false;

    /**
     * Initialize the usage tracker.
     * Detects if running via server (http://) or file (file://)
     */
    function init() {
        isServerMode = window.location.protocol.startsWith('http');

        if (!isServerMode) {
            console.log('UsageTracker: Running in file mode, tracking disabled');
            return;
        }

        // Get current user info
        fetch('/api/whoami')
            .then(function(response) { return response.json(); })
            .then(function(data) {
                currentUser = data.username;
                console.log('UsageTracker: Initialized for', currentUser);
                trackPageView();
            })
            .catch(function(err) {
                console.log('UsageTracker: Could not get user info', err);
            });

        // Track navigation changes
        window.addEventListener('hashchange', trackPageView);

        // Track session end
        window.addEventListener('beforeunload', trackSessionEnd);
    }

    /**
     * Track a page view.
     */
    function trackPageView() {
        if (!isServerMode) return;

        var page = window.location.hash || '#overview';

        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: page,
                details: 'Navigation'
            })
        }).catch(function() {
            // Silent fail - don't interrupt user experience
        });
    }

    /**
     * Track session end.
     */
    function trackSessionEnd() {
        if (!isServerMode) return;

        var duration = Math.round((new Date() - sessionStart) / 1000);

        // Use sendBeacon for reliable delivery on page unload
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/log', JSON.stringify({
                page: 'session_end',
                details: 'Duration: ' + duration + 's'
            }));
        }
    }

    /**
     * Get usage statistics (for admin view).
     */
    function getStats() {
        if (!isServerMode) {
            return Promise.resolve({ error: 'Not in server mode' });
        }

        return fetch('/api/usage')
            .then(function(response) { return response.json(); });
    }

    /**
     * Get current user info.
     */
    function getCurrentUser() {
        return currentUser;
    }

    /**
     * Check if running in server mode.
     */
    function isServer() {
        return isServerMode;
    }

    return {
        init: init,
        trackPageView: trackPageView,
        getStats: getStats,
        getCurrentUser: getCurrentUser,
        isServer: isServer
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', UsageTracker.init);
} else {
    UsageTracker.init();
}

window.UsageTracker = UsageTracker;
