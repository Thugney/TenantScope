import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const dashboardDataPath = path.join(repoRoot, 'dashboard', 'data', 'configuration-profiles.json');
const pageScriptPath = path.join(repoRoot, 'dashboard', 'js', 'page-configuration-profiles.js');

const sample = JSON.parse(fs.readFileSync(dashboardDataPath, 'utf8'));
const profiles = Array.isArray(sample.profiles) ? sample.profiles : [];
assert.ok(profiles.length > 0, 'Expected dashboard/data/configuration-profiles.json to contain profiles');

const script = fs.readFileSync(pageScriptPath, 'utf8');
const sandbox = {
  window: {},
  document: { querySelectorAll: () => [] },
  DataLoader: { getData: () => sample },
  ColumnSelector: { create: () => ({ getVisible: () => [] }) },
  Filters: { setup: () => {}, getValue: () => '', apply: (data) => data },
  Tables: { render: () => {}, formatters: { date: (value) => value || '--' } }
};
sandbox.window.SharedFormatters = {};
sandbox.window.PageConfigurationProfiles = null;
vm.createContext(sandbox);
vm.runInContext(`${script}\nwindow.PageConfigurationProfiles = PageConfigurationProfiles;`, sandbox);

const mapProfile = sandbox.window.PageConfigurationProfiles._test.mapProfile;

const existingFirst = mapProfile(profiles[0]);
assert.equal(existingFirst.statusMissing, true, 'Existing top-level dashboard data should be marked as missing status evidence, not real zero');
assert.equal(existingFirst.successCount, null, 'Missing status success count should stay null for -- rendering');

const nonZeroFixture = {
  ...profiles[0],
  statusAvailable: true,
  statusSource: 'reports/getCachedReport',
  rawStatusEvidence: {
    reportId: 'ConfigurationPolicyDeviceAggregatesV3',
    rawRows: 1,
    lastCollectedUtc: '2026-04-29T00:00:00.000Z'
  },
  status: {
    success: 12,
    errors: 2,
    conflicts: 1,
    pending: 3,
    notApplicable: 4,
    total: 22,
    successRate: 54.5
  }
};

const mapped = mapProfile(nonZeroFixture);
assert.equal(mapped.statusMissing, false);
assert.equal(mapped.successCount, 12);
assert.equal(mapped.errorCount, 2);
assert.equal(mapped.conflictCount, 1);
assert.equal(mapped.pendingCount, 3);
assert.equal(mapped.notApplicableCount, 4);
assert.equal(mapped.totalDevices, 22);
assert.equal(mapped.successRate, 54.5);

console.log(JSON.stringify({
  totalPolicies: profiles.length,
  existingDataStatus: 'missing-status-evidence',
  regressionFixture: {
    success: mapped.successCount,
    errors: mapped.errorCount,
    conflicts: mapped.conflictCount,
    pending: mapped.pendingCount,
    notApplicable: mapped.notApplicableCount,
    successRate: mapped.successRate
  }
}, null, 2));
