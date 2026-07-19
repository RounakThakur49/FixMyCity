// =============================================================================
// activityFilter.js — per-admin activity attribution
// =============================================================================
// The superadmin activity dashboard must show EACH admin only the status updates
// THEY performed. Every complaint carries an updates[] array; since July 2026
// each entry stamps the acting admin under `byId` (their JWT sub). This module
// holds the pure attribution logic so it can be unit-tested without a live DB —
// the route (routes/superadmin.js) uses the same functions it exercises.
// =============================================================================

/**
 * Filter one complaint's updates[] down to the entries a specific admin made,
 * projecting each into the activity-log shape the frontend renders.
 *
 * Only entries whose `byId` matches adminId are returned. Legacy entries written
 * before actor tracking have no `byId` and are correctly excluded (they can't be
 * attributed to anyone) — this is what makes each admin's log distinct rather
 * than every admin seeing the same lumped-together list (the original bug).
 *
 * @param {object} complaint - a complaint doc (needs id, title, updates[], updatedAt)
 * @param {string} adminId   - the admin's _id as a string
 * @returns {Array<{title,description,dateTime,complaintId}>}
 */
function activityForAdmin(complaint, adminId) {
  const target = String(adminId || '');
  if (!target) return [];
  const updates = Array.isArray(complaint?.updates) ? complaint.updates : [];
  return updates
    .filter(u => String(u.byId || '') === target)
    .map(u => ({
      title:       `Updated "${complaint.title}" → ${u.label}`,
      description: u.note || '',
      dateTime:    u.at || complaint.updatedAt || '',
      complaintId: complaint.id,
    }));
}

/**
 * Flatten many complaints into one admin's activity feed, newest first.
 * @param {Array<object>} complaints
 * @param {string} adminId
 */
function buildAdminActivity(complaints, adminId) {
  const activity = [];
  for (const c of (complaints || [])) {
    activity.push(...activityForAdmin(c, adminId));
  }
  activity.sort((a, b) => (b.dateTime || '').localeCompare(a.dateTime || ''));
  return activity;
}

module.exports = { activityForAdmin, buildAdminActivity };
