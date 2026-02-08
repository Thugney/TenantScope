/**
 * ============================================================================
 * TenantScope - Problem Summary Page
 * ============================================================================
 *
 * Aggregates critical issues across all data types into a single prioritized
 * view for endpoint security specialists. Shows:
 * - Non-compliant devices
 * - Users without MFA
 * - Risky users
 * - Ownerless Teams
 * - Externally shared SharePoint sites
 * - Active vulnerability exploits
 * - Stale devices
 * - Admin accounts without phishing-resistant MFA
 *
 * Author: Robel (https://github.com/Thugney)
 */

const PageProblems = (function() {
    'use strict';

    /**
     * Helper to create DOM elements
     */
    function el(tag, className, textContent) {
        var elem = document.createElement(tag);
        if (className) elem.className = className;
        if (textContent !== undefined) elem.textContent = textContent;
        return elem;
    }

    /**
     * Collects all problems from across the tenant data
     */
    function collectProblems() {
        var problems = {
            critical: [],
            high: [],
            medium: [],
            low: []
        };

        // ===== DEVICE PROBLEMS =====
        var devicesRaw = DataLoader.getData('devices') || [];
        var devices = Array.isArray(devicesRaw) ? devicesRaw : (devicesRaw.devices || []);

        // Non-compliant devices
        var nonCompliant = devices.filter(function(d) { return d.complianceState === 'noncompliant'; });
        if (nonCompliant.length > 0) {
            problems.critical.push({
                category: 'Devices',
                title: 'Non-Compliant Devices',
                count: nonCompliant.length,
                description: nonCompliant.length + ' devices are not meeting compliance policies',
                action: 'Review device compliance and remediate issues',
                link: '#devices?compliance=noncompliant',
                items: nonCompliant.slice(0, 5).map(function(d) {
                    return { name: d.deviceName, detail: d.userPrincipalName || '--' };
                })
            });
        }

        // Unencrypted devices
        var unencrypted = devices.filter(function(d) { return d.isEncrypted === false; });
        if (unencrypted.length > 0) {
            problems.high.push({
                category: 'Devices',
                title: 'Unencrypted Devices',
                count: unencrypted.length,
                description: unencrypted.length + ' devices are not encrypted with BitLocker',
                action: 'Enable BitLocker encryption on these devices',
                link: '#devices?tab=devices',
                items: unencrypted.slice(0, 5).map(function(d) {
                    return { name: d.deviceName, detail: d.userPrincipalName || '--' };
                })
            });
        }

        // Stale devices (90+ days)
        var stale = devices.filter(function(d) { return d.isStale === true; });
        if (stale.length > 0) {
            problems.medium.push({
                category: 'Devices',
                title: 'Stale Devices',
                count: stale.length,
                description: stale.length + ' devices have not synced in 90+ days',
                action: 'Review stale devices and remove if no longer in use',
                link: '#devices?tab=devices',
                items: stale.slice(0, 5).map(function(d) {
                    return { name: d.deviceName, detail: d.daysSinceSync + ' days since sync' };
                })
            });
        }

        // Unsupported Windows
        var unsupportedWin = devices.filter(function(d) { return d.windowsSupported === false; });
        if (unsupportedWin.length > 0) {
            problems.high.push({
                category: 'Devices',
                title: 'Unsupported Windows Versions',
                count: unsupportedWin.length,
                description: unsupportedWin.length + ' devices running unsupported Windows versions',
                action: 'Upgrade devices to supported Windows versions',
                link: '#devices?tab=windows',
                items: unsupportedWin.slice(0, 5).map(function(d) {
                    return { name: d.deviceName, detail: (d.windowsType || 'Windows') + ' ' + (d.windowsRelease || '') };
                })
            });
        }

        // Expired certificates
        var expiredCerts = devices.filter(function(d) { return d.certStatus === 'expired'; });
        if (expiredCerts.length > 0) {
            problems.critical.push({
                category: 'Devices',
                title: 'Expired Certificates',
                count: expiredCerts.length,
                description: expiredCerts.length + ' devices have expired management certificates',
                action: 'Renew device certificates or re-enroll devices',
                link: '#devices?tab=certificates',
                items: expiredCerts.slice(0, 5).map(function(d) {
                    return { name: d.deviceName, detail: 'Expired' };
                })
            });
        }

        // ===== USER PROBLEMS =====
        var usersRaw = DataLoader.getData('users') || [];
        var users = Array.isArray(usersRaw) ? usersRaw : (usersRaw.users || []);

        // Users without MFA
        var noMfa = users.filter(function(u) { return u.mfaRegistered === false && u.accountEnabled !== false; });
        if (noMfa.length > 0) {
            problems.critical.push({
                category: 'Identity',
                title: 'Users Without MFA',
                count: noMfa.length,
                description: noMfa.length + ' active users have not registered for MFA',
                action: 'Require MFA registration for all users',
                link: '#users?tab=security',
                items: noMfa.slice(0, 5).map(function(u) {
                    return { name: u.displayName, detail: u.userPrincipalName };
                })
            });
        }

        // Risky users
        var riskData = DataLoader.getData('identityRiskData') || {};
        var riskyUsers = riskData.riskyUsers || [];
        var highRiskUsers = riskyUsers.filter(function(u) {
            return u.riskLevel === 'high' || u.riskLevel === 'critical';
        });
        if (highRiskUsers.length > 0) {
            problems.critical.push({
                category: 'Identity',
                title: 'High-Risk Users',
                count: highRiskUsers.length,
                description: highRiskUsers.length + ' users flagged with high or critical identity risk',
                action: 'Investigate and remediate identity risks immediately',
                link: '#users?tab=risky',
                items: highRiskUsers.slice(0, 5).map(function(u) {
                    return { name: u.userDisplayName || u.userPrincipalName, detail: u.riskLevel + ' risk' };
                })
            });
        }

        // Admin accounts without phishing-resistant MFA
        var mfaStatus = DataLoader.getData('mfaStatus') || [];
        var adminRoles = DataLoader.getData('adminRoles') || [];
        var adminIds = {};
        adminRoles.forEach(function(role) {
            (role.members || []).forEach(function(m) {
                if (m.id) adminIds[m.id] = true;
            });
        });
        var adminsNoPhishResistant = mfaStatus.filter(function(m) {
            return adminIds[m.id] && !m.hasPhishingResistantMethod;
        });
        if (adminsNoPhishResistant.length > 0) {
            problems.high.push({
                category: 'Identity',
                title: 'Admins Without Phishing-Resistant MFA',
                count: adminsNoPhishResistant.length,
                description: adminsNoPhishResistant.length + ' admin accounts lack FIDO2/Windows Hello',
                action: 'Deploy phishing-resistant MFA for all admin accounts',
                link: '#users?tab=admins',
                items: adminsNoPhishResistant.slice(0, 5).map(function(m) {
                    return { name: m.userPrincipalName || m.id, detail: 'No FIDO2/WHfB' };
                })
            });
        }

        // ===== TEAMS PROBLEMS =====
        var teams = DataLoader.getData('teams') || [];

        // Ownerless teams
        var ownerless = teams.filter(function(t) { return t.hasNoOwner; });
        if (ownerless.length > 0) {
            problems.high.push({
                category: 'Collaboration',
                title: 'Ownerless Teams',
                count: ownerless.length,
                description: ownerless.length + ' Teams have no active owner',
                action: 'Assign owners or consider archiving inactive Teams',
                link: '#teams',
                items: ownerless.slice(0, 5).map(function(t) {
                    return { name: t.displayName, detail: t.memberCount + ' members' };
                })
            });
        }

        // Teams with guests
        var teamsWithGuests = teams.filter(function(t) { return t.hasGuests && t.guestCount > 0; });
        if (teamsWithGuests.length > 0) {
            problems.medium.push({
                category: 'Collaboration',
                title: 'Teams with External Guests',
                count: teamsWithGuests.length,
                description: teamsWithGuests.length + ' Teams have external guest members',
                action: 'Review guest access policies and audit guest permissions',
                link: '#teams',
                items: teamsWithGuests.slice(0, 5).map(function(t) {
                    return { name: t.displayName, detail: t.guestCount + ' guests' };
                })
            });
        }

        // Inactive teams
        var inactiveTeams = teams.filter(function(t) { return t.isInactive; });
        if (inactiveTeams.length > 0) {
            problems.low.push({
                category: 'Collaboration',
                title: 'Inactive Teams',
                count: inactiveTeams.length,
                description: inactiveTeams.length + ' Teams have no activity in 90+ days',
                action: 'Consider archiving or deleting inactive Teams',
                link: '#teams',
                items: inactiveTeams.slice(0, 5).map(function(t) {
                    return { name: t.displayName, detail: (t.daysSinceActivity || 'N/A') + ' days inactive' };
                })
            });
        }

        // ===== SHAREPOINT PROBLEMS =====
        var sites = DataLoader.getData('sharepointSites') || [];
        var nonPersonalSites = sites.filter(function(s) { return !s.isPersonalSite; });

        // Sites with anonymous links
        var anonymousSites = nonPersonalSites.filter(function(s) { return (s.anonymousLinkCount || 0) > 0; });
        if (anonymousSites.length > 0) {
            problems.high.push({
                category: 'SharePoint',
                title: 'Sites with Anonymous Links',
                count: anonymousSites.length,
                description: anonymousSites.length + ' SharePoint sites have anonymous sharing links',
                action: 'Review and remove unnecessary anonymous links',
                link: '#sharepoint',
                items: anonymousSites.slice(0, 5).map(function(s) {
                    return { name: s.displayName, detail: s.anonymousLinkCount + ' anonymous links' };
                })
            });
        }

        // Externally shared sites
        var externalSites = nonPersonalSites.filter(function(s) { return s.hasExternalSharing; });
        if (externalSites.length > 0) {
            problems.medium.push({
                category: 'SharePoint',
                title: 'Externally Shared Sites',
                count: externalSites.length,
                description: externalSites.length + ' SharePoint sites allow external sharing',
                action: 'Review external sharing settings and audit guest access',
                link: '#sharepoint',
                items: externalSites.slice(0, 5).map(function(s) {
                    return { name: s.displayName, detail: s.externalSharing };
                })
            });
        }

        // ===== VULNERABILITY PROBLEMS =====
        var vulnData = DataLoader.getData('vulnerabilities') || {};
        var vulns = vulnData.vulnerabilities || [];

        // Actively exploited vulnerabilities
        var exploited = vulns.filter(function(v) { return v.exploitedInWild; });
        if (exploited.length > 0) {
            problems.critical.push({
                category: 'Security',
                title: 'Actively Exploited CVEs',
                count: exploited.length,
                description: exploited.length + ' vulnerabilities are being actively exploited',
                action: 'Prioritize patching these vulnerabilities immediately',
                link: '#vulnerabilities?tab=exploited',
                items: exploited.slice(0, 5).map(function(v) {
                    return { name: v.id, detail: (v.affectedDevices || 0) + ' devices affected' };
                })
            });
        }

        // Critical severity vulnerabilities
        var criticalVulns = vulns.filter(function(v) { return v.severity === 'critical' && !v.exploitedInWild; });
        if (criticalVulns.length > 0) {
            problems.high.push({
                category: 'Security',
                title: 'Critical Vulnerabilities',
                count: criticalVulns.length,
                description: criticalVulns.length + ' critical severity CVEs affecting devices',
                action: 'Patch critical vulnerabilities within SLA',
                link: '#vulnerabilities',
                items: criticalVulns.slice(0, 5).map(function(v) {
                    return { name: v.id, detail: 'CVSS ' + (v.cvssScore || 'N/A') };
                })
            });
        }

        // ===== DEFENDER ALERTS =====
        var defenderAlerts = DataLoader.getData('defenderAlerts') || [];
        var activeAlerts = defenderAlerts.filter(function(a) { return a.status !== 'resolved'; });

        // High severity active alerts
        var highAlerts = activeAlerts.filter(function(a) { return a.severity === 'high'; });
        if (highAlerts.length > 0) {
            problems.critical.push({
                category: 'Security',
                title: 'High Severity Defender Alerts',
                count: highAlerts.length,
                description: highAlerts.length + ' high severity security alerts require immediate attention',
                action: 'Investigate and remediate high severity alerts',
                link: '#security',
                items: highAlerts.slice(0, 5).map(function(a) {
                    return { name: a.title, detail: a.affectedUser || a.affectedDevice || 'Unknown target' };
                })
            });
        }

        // Medium severity active alerts
        var mediumAlerts = activeAlerts.filter(function(a) { return a.severity === 'medium'; });
        if (mediumAlerts.length > 0) {
            problems.high.push({
                category: 'Security',
                title: 'Medium Severity Defender Alerts',
                count: mediumAlerts.length,
                description: mediumAlerts.length + ' medium severity security alerts need investigation',
                action: 'Review and triage medium severity alerts',
                link: '#security',
                items: mediumAlerts.slice(0, 5).map(function(a) {
                    return { name: a.title, detail: a.affectedUser || a.affectedDevice || 'Unknown target' };
                })
            });
        }

        // Low severity active alerts (informational)
        var lowAlerts = activeAlerts.filter(function(a) { return a.severity === 'low'; });
        if (lowAlerts.length > 0) {
            problems.low.push({
                category: 'Security',
                title: 'Low Severity Defender Alerts',
                count: lowAlerts.length,
                description: lowAlerts.length + ' low severity alerts for awareness',
                action: 'Review low severity alerts when time permits',
                link: '#security',
                items: lowAlerts.slice(0, 5).map(function(a) {
                    return { name: a.title, detail: a.affectedUser || a.affectedDevice || 'Unknown target' };
                })
            });
        }

        return problems;
    }

    /**
     * Renders a problem card
     */
    function renderProblemCard(problem, severity) {
        var card = el('div', 'problem-card problem-card--' + severity);

        var header = el('div', 'problem-card-header');
        var categoryBadge = el('span', 'badge badge-' + severity, problem.category);
        header.appendChild(categoryBadge);
        var countBadge = el('span', 'problem-count', String(problem.count));
        header.appendChild(countBadge);
        card.appendChild(header);

        card.appendChild(el('h4', 'problem-title', problem.title));
        card.appendChild(el('p', 'problem-description', problem.description));

        if (problem.items && problem.items.length > 0) {
            var itemsList = el('ul', 'problem-items');
            problem.items.forEach(function(item) {
                var li = el('li');
                li.appendChild(el('strong', null, item.name));
                li.appendChild(document.createTextNode(' - ' + item.detail));
                itemsList.appendChild(li);
            });
            card.appendChild(itemsList);
            if (problem.count > 5) {
                card.appendChild(el('p', 'problem-more', '...and ' + (problem.count - 5) + ' more'));
            }
        }

        var actionDiv = el('div', 'problem-action');
        actionDiv.appendChild(el('strong', null, 'Action: '));
        actionDiv.appendChild(document.createTextNode(problem.action));
        card.appendChild(actionDiv);

        if (problem.link) {
            var linkBtn = el('a', 'btn btn-secondary btn-sm', 'View Details');
            linkBtn.href = problem.link;
            card.appendChild(linkBtn);
        }

        return card;
    }

    /**
     * Renders the Problem Summary page
     */
    function render(container) {
        container.textContent = '';

        // Page Header
        var header = el('div', 'page-header');
        header.appendChild(el('h2', 'page-title', 'Problem Summary'));
        header.appendChild(el('p', 'page-description', 'Prioritized security and compliance issues across the tenant'));
        container.appendChild(header);

        var problems = collectProblems();

        // Count totals
        var criticalCount = problems.critical.length;
        var highCount = problems.high.length;
        var mediumCount = problems.medium.length;
        var lowCount = problems.low.length;
        var totalCount = criticalCount + highCount + mediumCount + lowCount;

        // Summary Cards
        var cards = el('div', 'summary-cards');

        var totalCard = el('div', 'summary-card');
        totalCard.appendChild(el('div', 'summary-value', String(totalCount)));
        totalCard.appendChild(el('div', 'summary-label', 'Total Issues'));
        cards.appendChild(totalCard);

        var critCard = el('div', 'summary-card' + (criticalCount > 0 ? ' card-critical' : ' card-success'));
        critCard.appendChild(el('div', 'summary-value' + (criticalCount > 0 ? ' text-critical' : ' text-success'), String(criticalCount)));
        critCard.appendChild(el('div', 'summary-label', 'Critical'));
        cards.appendChild(critCard);

        var highCard = el('div', 'summary-card' + (highCount > 0 ? ' card-warning' : ''));
        highCard.appendChild(el('div', 'summary-value' + (highCount > 0 ? ' text-warning' : ''), String(highCount)));
        highCard.appendChild(el('div', 'summary-label', 'High'));
        cards.appendChild(highCard);

        var medCard = el('div', 'summary-card');
        medCard.appendChild(el('div', 'summary-value', String(mediumCount)));
        medCard.appendChild(el('div', 'summary-label', 'Medium'));
        cards.appendChild(medCard);

        var lowCard = el('div', 'summary-card');
        lowCard.appendChild(el('div', 'summary-value', String(lowCount)));
        lowCard.appendChild(el('div', 'summary-label', 'Low'));
        cards.appendChild(lowCard);

        container.appendChild(cards);

        // No problems state
        if (totalCount === 0) {
            var emptyState = el('div', 'empty-state');
            emptyState.appendChild(el('div', 'empty-state-icon', '\u2713'));
            emptyState.appendChild(el('div', 'empty-state-title', 'No Issues Detected'));
            emptyState.appendChild(el('div', 'empty-state-description', 'No critical security or compliance issues found across the tenant.'));
            container.appendChild(emptyState);
            return;
        }

        // Critical Issues Section
        if (problems.critical.length > 0) {
            var critSection = el('div', 'analytics-section');
            critSection.appendChild(el('h3', null, 'Critical Issues (' + problems.critical.length + ')'));
            var critGrid = el('div', 'problems-grid');
            problems.critical.forEach(function(p) {
                critGrid.appendChild(renderProblemCard(p, 'critical'));
            });
            critSection.appendChild(critGrid);
            container.appendChild(critSection);
        }

        // High Issues Section
        if (problems.high.length > 0) {
            var highSection = el('div', 'analytics-section');
            highSection.appendChild(el('h3', null, 'High Priority Issues (' + problems.high.length + ')'));
            var highGrid = el('div', 'problems-grid');
            problems.high.forEach(function(p) {
                highGrid.appendChild(renderProblemCard(p, 'warning'));
            });
            highSection.appendChild(highGrid);
            container.appendChild(highSection);
        }

        // Medium Issues Section
        if (problems.medium.length > 0) {
            var medSection = el('div', 'analytics-section');
            medSection.appendChild(el('h3', null, 'Medium Priority Issues (' + problems.medium.length + ')'));
            var medGrid = el('div', 'problems-grid');
            problems.medium.forEach(function(p) {
                medGrid.appendChild(renderProblemCard(p, 'info'));
            });
            medSection.appendChild(medGrid);
            container.appendChild(medSection);
        }

        // Low Issues Section
        if (problems.low.length > 0) {
            var lowSection = el('div', 'analytics-section');
            lowSection.appendChild(el('h3', null, 'Low Priority Issues (' + problems.low.length + ')'));
            var lowGrid = el('div', 'problems-grid');
            problems.low.forEach(function(p) {
                lowGrid.appendChild(renderProblemCard(p, 'neutral'));
            });
            lowSection.appendChild(lowGrid);
            container.appendChild(lowSection);
        }
    }

    return { render: render };
})();

window.PageProblems = PageProblems;
