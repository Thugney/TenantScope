/**
 * ============================================================================
 * TenantScope
 * Author: Robel (https://github.com/Thugney)
 * Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
 * License: MIT
 * ============================================================================
 *
 * ENTITY INDEX MODULE
 *
 * Builds a normalized, cross-entity index for users, devices, groups, teams,
 * and SharePoint sites. Intended as a foundational layer for "single pane
 * of glass" navigation and correlation.
 *
 * This module does not render UI. It is safe to load even if unused.
 */

var EntityIndex = (function() {
    'use strict';

    var state = null;

    function normalize(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function normalizeLower(value) {
        var v = normalize(value);
        return v ? v.toLowerCase() : '';
    }

    function addToIndex(map, key, value) {
        if (!key) return;
        if (!map[key]) {
            map[key] = value;
        }
    }

    function addToList(map, key, value) {
        if (!key) return;
        if (!map[key]) map[key] = [];
        map[key].push(value);
    }

    function extractArray(maybeArray, nestedKey) {
        if (!maybeArray) return [];
        if (Array.isArray(maybeArray)) return maybeArray;
        if (nestedKey && maybeArray[nestedKey] && Array.isArray(maybeArray[nestedKey])) {
            return maybeArray[nestedKey];
        }
        return [];
    }

    function reset() {
        state = {
            usersById: {},
            usersByUpn: {},
            usersByMail: {},
            devicesById: {},
            devicesByName: {},
            groupsById: {},
            groupsByName: {},
            teamsById: {},
            teamsByMail: {},
            sitesById: {},
            sitesByGroupId: {},
            sitesByUrl: {},
            userDevicesById: {},
            userDevicesByUpn: {},
            userGroupsById: {},
            userGroupsByUpn: {},
            groupMembersById: {},
            groupOwnersById: {},
            builtAt: null
        };
    }

    function build(data) {
        reset();

        var users = extractArray(data && data.users, 'users');
        var devices = extractArray(data && data.devices, 'devices');
        var groups = extractArray(data && data.groups, 'groups');
        var teams = extractArray(data && data.teams, 'teams');
        var sites = extractArray(data && data.sharepointSites, 'sites');

        users.forEach(function(u) {
            if (!u) return;
            var id = normalize(u.id || u.userId);
            var upn = normalizeLower(u.userPrincipalName);
            var mail = normalizeLower(u.mail);
            if (id) addToIndex(state.usersById, id, u);
            if (upn) addToIndex(state.usersByUpn, upn, u);
            if (mail) addToIndex(state.usersByMail, mail, u);
        });

        devices.forEach(function(d) {
            if (!d) return;
            var id = normalize(d.id || d.deviceId);
            var name = normalizeLower(d.deviceName || d.displayName);
            if (id) addToIndex(state.devicesById, id, d);
            if (name) addToIndex(state.devicesByName, name, d);

            var userId = normalize(d.userId);
            var upn = normalizeLower(d.userPrincipalName || d.emailAddress || d.userUpn || d.upn);
            if (userId) addToList(state.userDevicesById, userId, d);
            if (upn) addToList(state.userDevicesByUpn, upn, d);
        });

        groups.forEach(function(g) {
            if (!g) return;
            var id = normalize(g.id || g.groupId);
            var name = normalizeLower(g.displayName);
            if (id) addToIndex(state.groupsById, id, g);
            if (name) addToIndex(state.groupsByName, name, g);

            var members = Array.isArray(g.members) ? g.members : [];
            var owners = Array.isArray(g.owners) ? g.owners : [];
            if (id) {
                state.groupMembersById[id] = members.slice(0);
                state.groupOwnersById[id] = owners.slice(0);
            }

            members.forEach(function(m) {
                if (!m) return;
                var memberId = normalize(m.id);
                var memberUpn = normalizeLower(m.userPrincipalName || m.mail);
                if (memberId) addToList(state.userGroupsById, memberId, g);
                if (memberUpn) addToList(state.userGroupsByUpn, memberUpn, g);
            });

            owners.forEach(function(o) {
                if (!o) return;
                var ownerId = normalize(o.id);
                var ownerUpn = normalizeLower(o.userPrincipalName || o.mail);
                if (ownerId) addToList(state.userGroupsById, ownerId, g);
                if (ownerUpn) addToList(state.userGroupsByUpn, ownerUpn, g);
            });
        });

        teams.forEach(function(t) {
            if (!t) return;
            var id = normalize(t.id || t.groupId);
            var mail = normalizeLower(t.mail);
            if (id) addToIndex(state.teamsById, id, t);
            if (mail) addToIndex(state.teamsByMail, mail, t);
        });

        sites.forEach(function(s) {
            if (!s) return;
            var id = normalize(s.id || s.siteId);
            var groupId = normalize(s.groupId);
            var url = normalizeLower(s.url || s.webUrl || s.siteUrl);
            if (id) addToIndex(state.sitesById, id, s);
            if (groupId) addToIndex(state.sitesByGroupId, groupId, s);
            if (url) addToIndex(state.sitesByUrl, url, s);
        });

        state.builtAt = new Date().toISOString();
        return state;
    }

    function buildFromDataLoader() {
        if (typeof DataLoader === 'undefined' || !DataLoader.getRawData) return null;
        return build({
            users: DataLoader.getRawData('users'),
            devices: DataLoader.getRawData('devices'),
            groups: DataLoader.getRawData('groups'),
            teams: DataLoader.getRawData('teams'),
            sharepointSites: DataLoader.getRawData('sharepointSites')
        });
    }

    function getState() {
        return state;
    }

    function getUser(idOrUpn) {
        if (!idOrUpn || !state) return null;
        var key = normalize(idOrUpn);
        var lower = key.toLowerCase();
        return state.usersById[key] || state.usersByUpn[lower] || state.usersByMail[lower] || null;
    }

    function getGroup(idOrName) {
        if (!idOrName || !state) return null;
        var key = normalize(idOrName);
        var lower = key.toLowerCase();
        return state.groupsById[key] || state.groupsByName[lower] || null;
    }

    return {
        build: build,
        buildFromDataLoader: buildFromDataLoader,
        getState: getState,
        getUser: getUser,
        getGroup: getGroup
    };
})();

window.EntityIndex = EntityIndex;
