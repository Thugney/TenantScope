/**
 * TenantScope - Credential Expiry Page
 */

const PageCredentialExpiry = (function() {
    'use strict';

    var colSelector = null;
    var currentTab = 'overview';
    var credState = null;

    // Extract flat credentials from nested structure
    function extractCredentials(rawData) {
        if (Array.isArray(rawData)) return rawData;
        if (!rawData || !rawData.applications) return [];
        var creds = [];
        rawData.applications.forEach(function(app) {
            (app.secrets || []).forEach(function(s) {
                creds.push({
                    appDisplayName: app.displayName,
                    credentialType: 'secret',
                    status: s.status,
                    daysUntilExpiry: s.daysUntilExpiry,
                    expiryDate: s.endDateTime
                });
            });
            (app.certificates || []).forEach(function(c) {
                creds.push({
                    appDisplayName: app.displayName,
                    credentialType: 'certificate',
                    status: c.status,
                    daysUntilExpiry: c.daysUntilExpiry,
                    expiryDate: c.endDateTime
                });
            });
        });
        return creds;
    }

    function applyFilters() {
        var creds = extractCredentials(DataLoader.getData('servicePrincipalSecrets'));
        var filterConfig = { search: Filters.getValue('creds-search'), searchFields: ['appDisplayName', 'credentialType'], exact: {} };
        var typeFilter = Filters.getValue('creds-type');
        if (typeFilter && typeFilter !== 'all') filterConfig.exact.credentialType = typeFilter;
        var filteredData = Filters.apply(creds, filterConfig);
        var statusFilter = Filters.getValue('creds-status');
        if (statusFilter && statusFilter !== 'all') filteredData = filteredData.filter(function(c) { return c.status === statusFilter; });
        renderTable(filteredData);
    }

    function renderTable(data) {
        var visible = colSelector ? colSelector.getVisible() : ['appDisplayName', 'credentialType', 'status', 'daysUntilExpiry', 'expiryDate'];
        var allDefs = [
            { key: 'appDisplayName', label: 'Application' },
            { key: 'credentialType', label: 'Type', formatter: function(v) {
                return v === 'secret' ? '<span class="badge badge-warning">Secret</span>' : '<span class="badge badge-info">Certificate</span>';
            }},
            { key: 'status', label: 'Status', formatter: function(v) {
                var statuses = { 'expired': 'badge-critical', 'critical': 'badge-critical', 'warning': 'badge-warning', 'healthy': 'badge-success' };
                return '<span class="badge ' + (statuses[v] || 'badge-neutral') + '">' + (v || 'Unknown') + '</span>';
            }},
            { key: 'daysUntilExpiry', label: 'Days Left', formatter: function(v) {
                if (v === null || v === undefined || isNaN(Number(v))) return '<span class="text-muted">--</span>';
                var numVal = Number(v);
                var cls = numVal < 0 ? 'text-critical font-bold' : numVal <= 30 ? 'text-critical' : numVal <= 60 ? 'text-warning' : 'text-success';
                return '<span class="' + cls + '">' + numVal + '</span>';
            }},
            { key: 'expiryDate', label: 'Expiry Date', formatter: Tables.formatters.date }
        ];
        Tables.render({ containerId: 'creds-table', data: data, columns: allDefs.filter(function(c) { return visible.indexOf(c.key) !== -1; }), pageSize: 50 });
    }

    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        renderContent();
    }

    function renderContent() {
        var container = document.getElementById('creds-content');
        if (!container || !credState) return;

        switch (currentTab) {
            case 'overview':
                renderOverview(container, credState);
                break;
            case 'credentials':
                renderCredentialsTab(container, credState);
                break;
        }
    }

    function renderOverview(container, state) {
        var creds = state.creds;
        var total = state.total;

        // Calculate health percentage
        var healthyPct = total > 0 ? Math.round((state.healthy / total) * 100) : 0;
        var expiredPct = total > 0 ? Math.round((state.expired / total) * 100) : 0;
        var criticalPct = total > 0 ? Math.round((state.critical / total) * 100) : 0;
        var warningPct = total > 0 ? Math.round((state.warning / total) * 100) : 0;

        // Calculate type breakdown
        var secrets = creds.filter(function(c) { return c.credentialType === 'secret'; });
        var certificates = creds.filter(function(c) { return c.credentialType === 'certificate'; });

        // Calculate app breakdown
        var appStats = {};
        creds.forEach(function(c) {
            var app = c.appDisplayName || 'Unknown';
            if (!appStats[app]) {
                appStats[app] = { total: 0, expired: 0, critical: 0 };
            }
            appStats[app].total++;
            if (c.status === 'expired') appStats[app].expired++;
            if (c.status === 'critical') appStats[app].critical++;
        });

        container.textContent = '';

        // Build analytics section with donut chart
        var section = document.createElement('div');
        section.className = 'analytics-section';

        var sectionTitle = document.createElement('h3');
        sectionTitle.textContent = 'Credential Health Overview';
        section.appendChild(sectionTitle);

        var complianceOverview = document.createElement('div');
        complianceOverview.className = 'compliance-overview';

        // Donut chart
        var chartContainer = document.createElement('div');
        chartContainer.className = 'compliance-chart';
        var donutDiv = document.createElement('div');
        donutDiv.className = 'donut-chart';

        var circumference = 2 * Math.PI * 40;
        var healthyDash = (healthyPct / 100) * circumference;
        var warningDash = (warningPct / 100) * circumference;
        var criticalDash = (criticalPct / 100) * circumference;
        var expiredDash = (expiredPct / 100) * circumference;

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'donut');

        var bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '40');
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
        bgCircle.setAttribute('stroke-width', '12');
        svg.appendChild(bgCircle);

        var offset = 0;
        if (healthyPct > 0) {
            var healthyCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            healthyCircle.setAttribute('cx', '50');
            healthyCircle.setAttribute('cy', '50');
            healthyCircle.setAttribute('r', '40');
            healthyCircle.setAttribute('fill', 'none');
            healthyCircle.setAttribute('stroke', 'var(--color-success)');
            healthyCircle.setAttribute('stroke-width', '12');
            healthyCircle.setAttribute('stroke-dasharray', healthyDash + ' ' + circumference);
            healthyCircle.setAttribute('stroke-dashoffset', String(-offset));
            healthyCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(healthyCircle);
            offset += healthyDash;
        }
        if (warningPct > 0) {
            var warningCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            warningCircle.setAttribute('cx', '50');
            warningCircle.setAttribute('cy', '50');
            warningCircle.setAttribute('r', '40');
            warningCircle.setAttribute('fill', 'none');
            warningCircle.setAttribute('stroke', 'var(--color-warning)');
            warningCircle.setAttribute('stroke-width', '12');
            warningCircle.setAttribute('stroke-dasharray', warningDash + ' ' + circumference);
            warningCircle.setAttribute('stroke-dashoffset', String(-offset));
            warningCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(warningCircle);
            offset += warningDash;
        }
        if (criticalPct > 0) {
            var critCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            critCircle.setAttribute('cx', '50');
            critCircle.setAttribute('cy', '50');
            critCircle.setAttribute('r', '40');
            critCircle.setAttribute('fill', 'none');
            critCircle.setAttribute('stroke', 'var(--color-orange)');
            critCircle.setAttribute('stroke-width', '12');
            critCircle.setAttribute('stroke-dasharray', criticalDash + ' ' + circumference);
            critCircle.setAttribute('stroke-dashoffset', String(-offset));
            critCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(critCircle);
            offset += criticalDash;
        }
        if (expiredPct > 0) {
            var expCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            expCircle.setAttribute('cx', '50');
            expCircle.setAttribute('cy', '50');
            expCircle.setAttribute('r', '40');
            expCircle.setAttribute('fill', 'none');
            expCircle.setAttribute('stroke', 'var(--color-critical)');
            expCircle.setAttribute('stroke-width', '12');
            expCircle.setAttribute('stroke-dasharray', expiredDash + ' ' + circumference);
            expCircle.setAttribute('stroke-dashoffset', String(-offset));
            expCircle.setAttribute('transform', 'rotate(-90 50 50)');
            svg.appendChild(expCircle);
        }

        donutDiv.appendChild(svg);

        var donutCenter = document.createElement('div');
        donutCenter.className = 'donut-center';
        var donutValue = document.createElement('span');
        donutValue.className = 'donut-value';
        donutValue.textContent = healthyPct + '%';
        var donutLabel = document.createElement('span');
        donutLabel.className = 'donut-label';
        donutLabel.textContent = 'Healthy';
        donutCenter.appendChild(donutValue);
        donutCenter.appendChild(donutLabel);
        donutDiv.appendChild(donutCenter);
        chartContainer.appendChild(donutDiv);
        complianceOverview.appendChild(chartContainer);

        // Legend
        var legend = document.createElement('div');
        legend.className = 'compliance-legend';
        var legendItems = [
            { cls: 'bg-success', label: 'Healthy', value: state.healthy },
            { cls: 'bg-warning', label: 'Warning (< 60 days)', value: state.warning },
            { cls: 'bg-orange', label: 'Critical (< 30 days)', value: state.critical },
            { cls: 'bg-critical', label: 'Expired', value: state.expired }
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
        var metricItem = document.createElement('div');
        metricItem.className = 'legend-item';
        metricItem.appendChild(document.createTextNode('Total Credentials: '));
        var totalStrong = document.createElement('strong');
        totalStrong.textContent = total;
        metricItem.appendChild(totalStrong);
        legend.appendChild(metricItem);
        complianceOverview.appendChild(legend);
        section.appendChild(complianceOverview);
        container.appendChild(section);

        // Analytics grid
        var analyticsGrid = document.createElement('div');
        analyticsGrid.className = 'analytics-grid';

        // Credential Status card with mini-bars
        analyticsGrid.appendChild(createPlatformCard('Credential Status', [
            { name: 'Healthy', count: state.healthy, pct: healthyPct, cls: 'bg-success' },
            { name: 'Warning', count: state.warning, pct: warningPct, cls: 'bg-warning' },
            { name: 'Critical', count: state.critical, pct: criticalPct, cls: 'bg-orange' },
            { name: 'Expired', count: state.expired, pct: expiredPct, cls: 'bg-critical' }
        ]));

        // By Credential Type card
        var secretsExpired = secrets.filter(function(s) { return s.status === 'expired' || s.status === 'critical'; }).length;
        var certsExpired = certificates.filter(function(c) { return c.status === 'expired' || c.status === 'critical'; }).length;
        var maxTypeCount = Math.max(secrets.length, certificates.length, 1);
        analyticsGrid.appendChild(createPlatformCard('By Credential Type', [
            { name: 'Secrets', count: secrets.length + ' (' + secretsExpired + ' need attention)', pct: Math.round((secrets.length / maxTypeCount) * 100), cls: secretsExpired > 0 ? 'bg-warning' : 'bg-success', showCount: true },
            { name: 'Certificates', count: certificates.length + ' (' + certsExpired + ' need attention)', pct: Math.round((certificates.length / maxTypeCount) * 100), cls: certsExpired > 0 ? 'bg-warning' : 'bg-success', showCount: true }
        ]));

        // Apps Needing Attention card
        var appsNeedingAttention = Object.keys(appStats).filter(function(app) {
            return appStats[app].expired > 0 || appStats[app].critical > 0;
        }).sort(function(a, b) {
            return (appStats[b].expired + appStats[b].critical) - (appStats[a].expired + appStats[a].critical);
        }).slice(0, 4);

        var appRows = [];
        if (appsNeedingAttention.length > 0) {
            var maxAppIssues = appStats[appsNeedingAttention[0]].expired + appStats[appsNeedingAttention[0]].critical;
            appRows = appsNeedingAttention.map(function(app) {
                var count = appStats[app].expired + appStats[app].critical;
                return { name: app, count: count + ' credential' + (count !== 1 ? 's' : ''), pct: Math.round((count / maxAppIssues) * 100), cls: 'bg-critical', showCount: true };
            });
        } else {
            appRows = [{ name: 'All apps healthy', count: '', pct: 100, cls: 'bg-success' }];
        }
        analyticsGrid.appendChild(createPlatformCard('Apps Needing Attention', appRows));

        // Expiry Timeline card
        var thirtyDays = creds.filter(function(c) { return c.daysUntilExpiry !== null && c.daysUntilExpiry > 0 && c.daysUntilExpiry <= 30; }).length;
        var sixtyDays = creds.filter(function(c) { return c.daysUntilExpiry !== null && c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 60; }).length;
        var ninetyDays = creds.filter(function(c) { return c.daysUntilExpiry !== null && c.daysUntilExpiry > 60 && c.daysUntilExpiry <= 90; }).length;
        var beyondNinety = creds.filter(function(c) { return c.daysUntilExpiry !== null && c.daysUntilExpiry > 90; }).length;
        var maxTimeline = Math.max(thirtyDays, sixtyDays, ninetyDays, beyondNinety, 1);
        analyticsGrid.appendChild(createPlatformCard('Expiry Timeline', [
            { name: 'Next 30 days', count: thirtyDays, pct: Math.round((thirtyDays / maxTimeline) * 100), cls: 'bg-critical', showCount: true },
            { name: '31-60 days', count: sixtyDays, pct: Math.round((sixtyDays / maxTimeline) * 100), cls: 'bg-warning', showCount: true },
            { name: '61-90 days', count: ninetyDays, pct: Math.round((ninetyDays / maxTimeline) * 100), cls: 'bg-info', showCount: true },
            { name: 'Beyond 90 days', count: beyondNinety, pct: Math.round((beyondNinety / maxTimeline) * 100), cls: 'bg-success', showCount: true }
        ]));

        container.appendChild(analyticsGrid);

        // Insights section
        var insightsList = document.createElement('div');
        insightsList.className = 'insights-list';

        // Expired credentials insight
        if (state.expired > 0) {
            insightsList.appendChild(createInsightCard('critical', 'EXPIRED', 'Credential Expiration',
                state.expired + ' credential' + (state.expired !== 1 ? 's have' : ' has') + ' already expired. These may be causing authentication failures.',
                'Immediately renew or rotate expired credentials to restore service functionality.'));
        }

        // Critical credentials insight
        if (state.critical > 0) {
            insightsList.appendChild(createInsightCard('warning', 'EXPIRING SOON', 'Critical Credentials',
                state.critical + ' credential' + (state.critical !== 1 ? 's' : '') + ' will expire within 30 days. Plan rotation to avoid service disruption.',
                'Schedule credential rotation before expiration to prevent outages.'));
        }

        // Warning credentials
        if (state.warning > 0) {
            insightsList.appendChild(createInsightCard('info', 'ATTENTION', 'Upcoming Expirations',
                state.warning + ' credential' + (state.warning !== 1 ? 's' : '') + ' will expire within 60 days. Add these to your maintenance schedule.',
                'Plan credential renewals during upcoming maintenance windows.'));
        }

        // Healthy status
        if (state.expired === 0 && state.critical === 0) {
            insightsList.appendChild(createInsightCard('success', 'HEALTHY', 'Credential Status',
                'No expired or critical credentials detected. All credentials have at least 30 days before expiration.',
                null));
        }

        container.appendChild(insightsList);

        // Credentials Requiring Action table
        var actionRequired = creds.filter(function(c) { return c.status === 'expired' || c.status === 'critical'; });
        if (actionRequired.length > 0) {
            var actionSection = document.createElement('div');
            actionSection.className = 'analytics-section';
            var actionTitle = document.createElement('h3');
            actionTitle.textContent = 'Credentials Requiring Action (' + actionRequired.length + ')';
            actionSection.appendChild(actionTitle);
            var actionTableDiv = document.createElement('div');
            actionTableDiv.id = 'creds-action-table';
            actionSection.appendChild(actionTableDiv);
            container.appendChild(actionSection);

            Tables.render({
                containerId: 'creds-action-table',
                data: actionRequired.slice(0, 15),
                columns: [
                    { key: 'appDisplayName', label: 'Application' },
                    { key: 'credentialType', label: 'Type', formatter: function(v) {
                        return '<span class="badge ' + (v === 'secret' ? 'badge-warning' : 'badge-info') + '">' + v + '</span>';
                    }},
                    { key: 'status', label: 'Status', formatter: function(v) {
                        return '<span class="badge ' + (v === 'expired' ? 'badge-critical' : 'badge-warning') + '">' + v + '</span>';
                    }},
                    { key: 'daysUntilExpiry', label: 'Days Left', formatter: function(v) {
                        if (v === null || v === undefined) return '--';
                        var cls = v < 0 ? 'text-critical font-bold' : 'text-critical';
                        return '<span class="' + cls + '">' + v + '</span>';
                    }},
                    { key: 'expiryDate', label: 'Expiry Date', formatter: Tables.formatters.date }
                ],
                pageSize: 15
            });
        }
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

    function renderCredentialsTab(container, state) {
        var html = '<div class="filter-bar"><input type="text" class="filter-input" id="creds-search" placeholder="Search applications...">';
        html += '<select class="filter-select" id="creds-type"><option value="all">All Types</option><option value="secret">Secrets</option><option value="certificate">Certificates</option></select>';
        html += '<select class="filter-select" id="creds-status"><option value="all">All Statuses</option><option value="expired">Expired</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>';
        html += '<div id="creds-colselector"></div></div>';
        html += '<div class="table-container" id="creds-table"></div>';
        container.innerHTML = html;

        colSelector = ColumnSelector.create({
            containerId: 'creds-colselector',
            storageKey: 'tenantscope-creds-cols',
            allColumns: [
                { key: 'appDisplayName', label: 'Application' },
                { key: 'credentialType', label: 'Type' },
                { key: 'status', label: 'Status' },
                { key: 'daysUntilExpiry', label: 'Days Left' },
                { key: 'expiryDate', label: 'Expiry Date' }
            ],
            defaultVisible: ['appDisplayName', 'credentialType', 'status', 'daysUntilExpiry', 'expiryDate'],
            onColumnsChanged: function() { applyFilters(); }
        });

        Filters.setup('creds-search', applyFilters);
        Filters.setup('creds-type', applyFilters);
        Filters.setup('creds-status', applyFilters);
        applyFilters();
    }

    function render(container) {
        var creds = extractCredentials(DataLoader.getData('servicePrincipalSecrets'));
        var total = creds.length;
        var expired = creds.filter(function(c) { return c.status === 'expired'; }).length;
        var critical = creds.filter(function(c) { return c.status === 'critical'; }).length;
        var warning = creds.filter(function(c) { return c.status === 'warning'; }).length;
        var healthy = creds.filter(function(c) { return c.status === 'healthy'; }).length;

        credState = {
            creds: creds,
            total: total,
            expired: expired,
            critical: critical,
            warning: warning,
            healthy: healthy
        };

        var html = '<div class="page-header"><h2>Credential Expiry</h2></div>';
        html += '<div class="summary-cards">';
        html += '<div class="summary-card"><div class="summary-value">' + total + '</div><div class="summary-label">Total Credentials</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + expired + '</div><div class="summary-label">Expired</div></div>';
        html += '<div class="summary-card card-danger"><div class="summary-value">' + critical + '</div><div class="summary-label">Critical</div></div>';
        html += '<div class="summary-card card-warning"><div class="summary-value">' + warning + '</div><div class="summary-label">Warning</div></div>';
        html += '<div class="summary-card card-success"><div class="summary-value">' + healthy + '</div><div class="summary-label">Healthy</div></div>';
        html += '</div>';

        html += '<div class="tab-bar">';
        html += '<button class="tab-btn active" data-tab="overview">Overview</button>';
        html += '<button class="tab-btn" data-tab="credentials">Credentials (' + total + ')</button>';
        html += '</div>';

        html += '<div class="content-area" id="creds-content"></div>';
        container.innerHTML = html;

        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
        });

        currentTab = 'overview';
        renderContent();
    }

    return { render: render };
})();
