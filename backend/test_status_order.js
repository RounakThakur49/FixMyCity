/**
 * Unit tests for the monotonic status-ordering rule (backtracking fix, July 2026).
 *
 * Pure-logic tests — no DB, no server, no network. Exercises the exact module the
 * PATCH /api/complaints/:id/status route uses (backend/utils/statusOrder.js), so a
 * pass here proves the route's decision behaviour without an Atlas connection.
 *
 * Run:  node test_status_order.js   (from backend/)
 */

const assert = require('assert');
const { canTransition, STATUS_RANK } = require('./utils/statusOrder');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`  [FAIL] ${name}\n         ${e.message}`);
    failed++;
  }
}

console.log('\nStatus-ordering rule — unit tests');
console.log('==================================');

// ── Forward moves: allowed ──────────────────────────────────────────────────
check('Submitted → In Review (pending → in-progress) allowed', () => {
  assert.strictEqual(canTransition('Submitted', 'In Review').allowed, true);
});
check('Submitted → Forwarded (pending → in-progress) allowed', () => {
  assert.strictEqual(canTransition('Submitted', 'Forwarded').allowed, true);
});
check('Submitted → Resolved (skip straight to complete) allowed', () => {
  assert.strictEqual(canTransition('Submitted', 'Resolved').allowed, true);
});
check('In Review → Resolved (in-progress → complete) allowed', () => {
  assert.strictEqual(canTransition('In Review', 'Resolved').allowed, true);
});
check('Forwarded → Resolved (in-progress → complete) allowed', () => {
  assert.strictEqual(canTransition('Forwarded', 'Resolved').allowed, true);
});

// ── Same-stage lateral moves: allowed (both map to citizen "in progress") ────
check('In Review → Forwarded (same stage, lateral) allowed', () => {
  assert.strictEqual(canTransition('In Review', 'Forwarded').allowed, true);
});
check('Forwarded → In Review (same stage, lateral) allowed', () => {
  assert.strictEqual(canTransition('Forwarded', 'In Review').allowed, true);
});

// ── Idempotent same-status: allowed (re-save with same stage) ────────────────
check('In Review → In Review (no-op) allowed', () => {
  assert.strictEqual(canTransition('In Review', 'In Review').allowed, true);
});

// ── Backward moves: REJECTED (the bug being fixed) ───────────────────────────
check('In Review → Submitted (in-progress → pending) REJECTED', () => {
  const r = canTransition('In Review', 'Submitted');
  assert.strictEqual(r.allowed, false);
  assert.ok(/forward|backward/i.test(r.reason), 'reason should mention direction');
});
check('Forwarded → Submitted (in-progress → pending) REJECTED', () => {
  assert.strictEqual(canTransition('Forwarded', 'Submitted').allowed, false);
});
check('Resolved → In Review (complete → in-progress) REJECTED', () => {
  assert.strictEqual(canTransition('Resolved', 'In Review').allowed, false);
});
check('Resolved → Submitted (complete → pending) REJECTED', () => {
  assert.strictEqual(canTransition('Resolved', 'Submitted').allowed, false);
});

// ── Resolved is terminal: even Resolved → Resolved is blocked ────────────────
check('Resolved → Resolved (already final) REJECTED with terminal reason', () => {
  const r = canTransition('Resolved', 'Resolved');
  assert.strictEqual(r.allowed, false);
  assert.ok(/final|resolved|reopen/i.test(r.reason), 'reason should mention finality');
});
check('Resolved → Forwarded (complete → in-progress) REJECTED', () => {
  assert.strictEqual(canTransition('Resolved', 'Forwarded').allowed, false);
});

// ── Rank sanity: In Review and Forwarded share a rank ────────────────────────
check('In Review and Forwarded have equal rank (same citizen stage)', () => {
  assert.strictEqual(STATUS_RANK['In Review'], STATUS_RANK['Forwarded']);
});
check('Ranks strictly increase Submitted < In Review < Resolved', () => {
  assert.ok(STATUS_RANK['Submitted'] < STATUS_RANK['In Review']);
  assert.ok(STATUS_RANK['In Review'] < STATUS_RANK['Resolved']);
});

// ── Unknown/empty current status: treat as pending (rank 0), never crash ─────
check('empty current status → In Review allowed (defaults to pending)', () => {
  assert.strictEqual(canTransition('', 'In Review').allowed, true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
