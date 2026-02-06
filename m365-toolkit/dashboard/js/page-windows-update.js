/**
 * TenantScope - Windows Update Status Page
 */

const PageWindowsUpdate = (function() {
    'use strict';

    var currentTab = 'rings';

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.toggle('active', btn.dataset.tab === tab); });
        renderContent();
    }

    function renderContent() {
        var data = DataLoader.getData('windowsUpdateStatus') || {};
        var container = document.getElementById('update-content');
        if (currentTab === 'rings') renderRings(container, data.updateRings || []);
        else if (currentTab === 'feature') renderFeature(container, data.featureUpdates || []);
        else if (currentTab === 'quality') renderQuality(container, data.qualityUpdates || []);
    }

    function renderRings(container, rings) {
        if (rings.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Update Rings</div></div>'; return; }
        var html = '<table class="data-table"><thead><tr><th>Ring Name</th><th>Deferral (Days)</th><th>Assigned</th></tr></thead><tbody>';
        rings.forEach(function(r) {
            html += '<tr><td>' + (r.displayName || '--') + '</td>';
            html += '<td>' + (r.qualityUpdatesDeferralPeriodInDays || 0) + ' / ' + (r.featureUpdatesDeferralPeriodInDays || 0) + '</td>';
            html += '<td>' + (r.assignedCount || 0) + '</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function renderFeature(container, updates) {
        if (updates.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Feature Updates</div></div>'; return; }
        var html = '<table class="data-table"><thead><tr><th>Policy</th><th>Target Version</th><th>Assigned</th></tr></thead><tbody>';
        updates.forEach(function(u) {
            html += '<tr><td>' + (u.displayName || '--') + '</td>';
            html += '<td><span class="badge badge-info">' + (u.featureUpdateVersion || '--') + '</span></td>';
            html += '<td>' + (u.assignedCount || 0) + '</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function renderQuality(container, updates) {
        if (updates.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Quality Updates</div></div>'; return; }
        var html = '<table class="data-table"><thead><tr><th>Policy</th><th>Release</th><th>Assigned</th></tr></thead><tbody>';
        updates.forEach(function(u) {
            html += '<tr><td>' + (u.displayName || '--') + '</td>';
            html += '<td>' + (u.releaseDateDisplayName || '--') + '</td>';
            html += '<td>' + (u.assignedCount || 0) + '</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function render(container) {
        var data = DataLoader.getData('windowsUpdateStatus') || {};
        var rings = data.updateRings || [];
        var feature = data.featureUpdates || [];
        var quality = data.qualityUpdates || [];

        var html = '<div class="page-header"><h2>Windows Update Status</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + rings.length + '</div><div class="summary-label">Update Rings</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + feature.length + '</div><div class="summary-label">Feature Updates</div></div>';
        html += '<div class="summary-card"><div class="summary-value">' + quality.length + '</div><div class="summary-label">Quality Updates</div></div>';
        html += '</div>';
        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="rings">Update Rings</button>';
        html += '<button class="tab-btn" data-tab="feature">Feature Updates</button>';
        html += '<button class="tab-btn" data-tab="quality">Quality Updates</button>';
        html += '</div>';
        html += '<div class="table-container" id="update-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });
        currentTab = 'rings';
        renderContent();
    }

    return { render: render };
})();
