/**
 * Unit tests for the per-admin activity attribution logic (utils/activityFilter.js).
 *
 * The bug this guards against: the superadmin "admin activity log" used to ignore
 * the requested admin id entirely and lump EVERY admin's status updates together,
 * so every admin's dialog showed the identical cross-admin list. Attribution now
 * keys on updates[].byId (stamped from the acting admin's JWT). These tests prove
 * each admin sees ONLY their own updates, and legacy (unattributed) updates are
 * excluded rather than leaking into everyone's log.
 *
 * Hermetic — no DB, no server. Run: node test_activity_filter.js
 */

const assert = require('assert');
const { buildAdminActivity } = require('./utils/activityFilter');

let passed = 0, failed = 0;
function check(desc, fn) {
  try { fn(); console.log(`  [PASS] ${desc}`); passed++; }
  catch (e) { console.log(`  [FAIL] ${desc}\n         ${e.message}`); failed++; }
}

// Two admins act on a shared set of complaints. Each update carries the acting
// admin's byId (as the real route now stamps it).
const ADMIN_A = '64f000000000000000000001';
const ADMIN_B = '64f000000000000000000002';

const complaints = [
  {
    id: 'CMP-1001', title: 'Pothole on Main St',
    updates: [
      { label: 'Submitted', note: 'registered', at: '2026-07-01 09:00', byId: '' },              // citizen — no actor
      { label: 'In Review', note: 'A inspecting', at: '2026-07-02 10:00', byId: ADMIN_A },
      { label: 'Resolved',  note: 'B closed it',  at: '2026-07-04 15:00', byId: ADMIN_B },
    ],
  },
  {
    id: 'CMP-1002', title: 'Broken streetlight',
    updates: [
      { label: 'Submitted', note: 'registered', at: '2026-07-01 08:00', byId: '' },
      { label: 'Forwarded', note: 'A forwarded', at: '2026-07-03 11:00', byId: ADMIN_A },
    ],
  },
  {
    id: 'CMP-1003', title: 'Legacy complaint',
    updates: [
      // Pre-attribution data — a real status change but no byId. Must NOT surface
      // in ANY admin's per-admin log (can't attribute it).
      { label: 'In Review', note: 'old update', at: '2026-06-01 12:00' },
    ],
  },
];

check('Admin A sees only A\'s two updates', () => {
  const a = buildAdminActivity(complaints, ADMIN_A);
  assert.strictEqual(a.length, 2, `expected 2, got ${a.length}`);
  assert.ok(a.every(x => /A (inspecting|forwarded)/.test(x.description)), 'A got a non-A update');
});

check('Admin B sees only B\'s single update', () => {
  const b = buildAdminActivity(complaints, ADMIN_B);
  assert.strictEqual(b.length, 1, `expected 1, got ${b.length}`);
  assert.strictEqual(b[0].complaintId, 'CMP-1001');
  assert.ok(/B closed it/.test(b[0].description));
});

check('A and B logs are DIFFERENT (the core bug)', () => {
  const a = buildAdminActivity(complaints, ADMIN_A);
  const b = buildAdminActivity(complaints, ADMIN_B);
  assert.notDeepStrictEqual(a, b, 'admin logs are identical — attribution broke');
});

check('Legacy update with no byId leaks into NO admin log', () => {
  const a = buildAdminActivity(complaints, ADMIN_A);
  const b = buildAdminActivity(complaints, ADMIN_B);
  const all = [...a, ...b];
  assert.ok(!all.some(x => x.complaintId === 'CMP-1003'), 'unattributed legacy update leaked');
});

check('Unknown admin id yields an empty log (not everything)', () => {
  const none = buildAdminActivity(complaints, '64fffffffffffffffffffffff');
  assert.strictEqual(none.length, 0, `expected 0, got ${none.length}`);
});

check('Activity is sorted newest-first by dateTime', () => {
  const a = buildAdminActivity(complaints, ADMIN_A);
  // A's updates: Forwarded @ 07-03 and In Review @ 07-02 → 07-03 must come first
  assert.strictEqual(a[0].dateTime, '2026-07-03 11:00');
  assert.strictEqual(a[1].dateTime, '2026-07-02 10:00');
});

check('Each activity entry names the complaint + new label', () => {
  const b = buildAdminActivity(complaints, ADMIN_B);
  assert.ok(b[0].title.includes('Broken streetlight') || b[0].title.includes('Pothole'),
    'title should reference the complaint');
  assert.ok(b[0].title.includes('Resolved'), 'title should reference the new status label');
});

check('Empty / missing inputs are safe', () => {
  assert.deepStrictEqual(buildAdminActivity([], ADMIN_A), []);
  assert.deepStrictEqual(buildAdminActivity(null, ADMIN_A), []);
  assert.deepStrictEqual(buildAdminActivity(complaints, ''), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
