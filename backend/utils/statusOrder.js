// =============================================================================
// statusOrder.js — monotonic complaint-status lifecycle rules (no backtracking)
// =============================================================================
// A complaint may only move FORWARD through its lifecycle. The 4 stored enum
// values collapse to 3 citizen-visible stages (the frontend maps BOTH "In Review"
// and "Forwarded" → the single "work-on-progress" state), so we rank by stage:
//
//   Submitted = 0 (pending)
//   In Review = 1 (in progress)   ┐ same stage — lateral moves allowed
//   Forwarded = 1 (in progress)   ┘ (forwarding is legitimate in-progress work)
//   Resolved  = 2 (complete)      → TERMINAL
//
// Rules enforced by canTransition():
//   • Resolved is TERMINAL — once complete, NO further status change at all.
//   • A move to a LOWER stage is rejected (can't revert in progress→pending, etc.).
//   • Same-stage moves (In Review ⇄ Forwarded) are allowed.
//   • Forward moves are allowed.
//
// This is the single source of truth. The status-PATCH route imports it (server
// enforcement, 409 on violation) and the frontend mirrors the same ranks in the
// UI so an admin can't even pick an invalid transition.
// =============================================================================

const STATUS_RANK = Object.freeze({
  'Submitted': 0,
  'In Review': 1,
  'Forwarded': 1,
  'Resolved':  2,
});

/**
 * Decide whether a complaint may move from `current` status to `next` status.
 * @param {string} current  the complaint's stored status
 * @param {string} next     the requested new status
 * @returns {{ allowed: boolean, reason: string }}
 *          allowed=true  → transition is legal
 *          allowed=false → `reason` is a citizen/admin-facing explanation
 */
function canTransition(current, next) {
  const currentRank = STATUS_RANK[current] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;

  // Resolved is terminal — reject every change, including a no-op re-Resolve,
  // so a completed complaint is provably immutable.
  if (current === 'Resolved') {
    return {
      allowed: false,
      reason: 'This complaint is already resolved. Resolved complaints are final and cannot be reopened or changed.',
    };
  }

  if (nextRank < currentRank) {
    return {
      allowed: false,
      reason: `Cannot move status backward from "${current}" to "${next}". Status can only progress forward (Submitted → In Review / Forwarded → Resolved).`,
    };
  }

  return { allowed: true, reason: '' };
}

module.exports = { STATUS_RANK, canTransition };
