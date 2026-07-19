// =============================================================================
// routes/superadmin.js — Super Admin management routes
// =============================================================================
// All routes require a valid JWT with role === 'superadmin'.
// Mounted in server.js via: app.use(require('./routes/superadmin'));
//
// Endpoints:
//   GET  /api/superadmin/stats           — Complaint analytics dashboard
//   GET  /api/superadmin/admins          — List all admins
//   POST /api/superadmin/admins          — Create a new admin (by superadmin)
//   DELETE /api/superadmin/admins/:id    — Delete an admin
//   GET  /api/superadmin/citizens        — List all citizens
//   GET  /api/superadmin/citizens/:id/activity — Complaint history for a citizen
// =============================================================================

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const Admin    = require('../models/Admin');
const User     = require('../models/User');
const Complaint = require('../models/Complaint');
const { requireSuperAdmin } = require('../middleware/auth');
const { issueToken } = require('../middleware/auth');
const { maskAadhar } = require('../utils/mask');
const { buildAdminActivity } = require('../utils/activityFilter');

// All superadmin routes require superadmin JWT
router.use(requireSuperAdmin);

// =============================================================================
// GET /api/superadmin/stats
// Usage analytics: complaint counts by status, hotspot, category, longest pending
// =============================================================================
router.get('/api/superadmin/stats', async (req, res) => {
  try {
    const [complaints, totalCitizens, totalAdmins] = await Promise.all([
      Complaint.find({}).select('status location type title createdAt').lean(),
      User.countDocuments({ role: 'citizen' }),
      Admin.countDocuments({ role: 'admin' }),
    ]);

    let pending   = 0;
    let inReview  = 0;
    let forwarded = 0;
    let resolved  = 0;

    const locationCounts = {};
    const categoryCounts = {};

    let longestPendingTitle = 'N/A';
    let longestPendingMs    = 0;

    for (const c of complaints) {
      // Status counts
      const st = (c.status || 'Submitted').toLowerCase();
      if      (st === 'submitted')  pending++;
      else if (st === 'in review')  inReview++;
      else if (st === 'forwarded')  forwarded++;
      else if (st === 'resolved')   resolved++;
      else                          pending++;

      // Location hotspot
      const loc = (c.location || '').trim();
      if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1;

      // Category distribution
      const cat = (c.type || 'Others').trim();
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

      // Longest pending (unresolved)
      if (st !== 'resolved') {
        try {
          const createdMs = new Date(c.createdAt).getTime();
          if (!isNaN(createdMs)) {
            const ageMs = Date.now() - createdMs;
            if (ageMs > longestPendingMs && (c.title || c.type)) {
              longestPendingMs    = ageMs;
              longestPendingTitle = c.title || c.type || 'Unknown';
            }
          }
        } catch (_) {}
      }
    }

    // Max location
    const maxLocation = Object.keys(locationCounts).reduce(
      (best, loc) => locationCounts[loc] > (locationCounts[best] || 0) ? loc : best,
      'N/A'
    );

    // Max category
    const maxCategory = Object.keys(categoryCounts).reduce(
      (best, cat) => categoryCounts[cat] > (categoryCounts[best] || 0) ? cat : best,
      'N/A'
    );

    res.json({
      registered: totalCitizens,
      totalAdmins,
      pending,
      inReview,
      forwarded,
      completed: resolved,
      total: complaints.length,
      maxLocation: maxLocation || 'N/A',
      longestPending: longestPendingTitle,
      maxCategory: maxCategory || 'N/A',
      categoryBreakdown: categoryCounts,
      locationBreakdown: locationCounts,
    });
  } catch (e) {
    console.error('[superadmin/stats] error:', e);
    res.status(500).json({ message: 'Failed to load stats.' });
  }
});

// =============================================================================
// GET /api/superadmin/admins
// List all regular admins (not the superadmin)
// =============================================================================
router.get('/api/superadmin/admins', async (req, res) => {
  try {
    const admins = await Admin.find({ role: 'admin' })
      .select('-password -otpHash -otpExpires -otpAttempts')
      .lean();

    res.json({
      admins: admins.map(a => ({
        id:        String(a._id),
        name:      a.name      || '',
        username:  a.username  || '',
        email:     a.email     || '',
        phone:     a.phone     || '',
        createdAt: a.createdAt || '',
        createdBy: a.createdBy || null,
      })),
    });
  } catch (e) {
    console.error('[superadmin/admins GET] error:', e);
    res.status(500).json({ message: 'Failed to load admin list.' });
  }
});

// =============================================================================
// POST /api/superadmin/admins
// Create a new admin account (only superadmin can do this)
// Body: { name, username, email, phone?, password }
// =============================================================================
router.post('/api/superadmin/admins', async (req, res) => {
  try {
    const { name, username, email, phone, password } = req.body;

    if (!name || typeof name !== 'string')
      return res.status(400).json({ message: 'Name is required.' });
    if (!username || typeof username !== 'string')
      return res.status(400).json({ message: 'Username is required.' });
    if (!password || typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    if (email && typeof email !== 'string')
      return res.status(400).json({ message: 'Invalid email.' });

    const existingUsername = await Admin.findOne({ username: username.trim() });
    if (existingUsername)
      return res.status(400).json({ message: 'Username already taken.' });

    if (email && email.trim()) {
      const existingEmail = await Admin.findOne({ email: email.trim().toLowerCase() });
      if (existingEmail)
        return res.status(400).json({ message: 'Email already in use by another admin.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const newAdmin = new Admin({
      name:      name.trim(),
      username:  username.trim(),
      email:     (email || '').trim().toLowerCase(),
      phone:     (phone || '').trim(),
      password:  hash,
      role:      'admin',
      createdBy: req.auth.sub,  // superadmin's _id from JWT
    });
    await newAdmin.save();

    res.status(201).json({
      message: 'Admin created successfully.',
      admin: {
        id:       String(newAdmin._id),
        name:     newAdmin.name,
        username: newAdmin.username,
        email:    newAdmin.email,
        phone:    newAdmin.phone,
        role:     newAdmin.role,
      },
    });
  } catch (e) {
    if (e.code === 11000) {
      const field = e.keyPattern?.username ? 'Username' : 'Email';
      return res.status(400).json({ message: `${field} already in use.` });
    }
    console.error('[superadmin/admins POST] error:', e);
    res.status(500).json({ message: 'Failed to create admin.' });
  }
});

// =============================================================================
// DELETE /api/superadmin/admins/:id
// Delete an admin account (cannot delete self or another superadmin)
// =============================================================================
router.delete('/api/superadmin/admins/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.auth.sub)
      return res.status(400).json({ message: 'You cannot delete your own account.' });

    const target = await Admin.findById(id);
    if (!target)
      return res.status(404).json({ message: 'Admin not found.' });
    if (target.role === 'superadmin')
      return res.status(403).json({ message: 'Cannot delete a super admin account.' });

    await Admin.findByIdAndDelete(id);
    res.json({ message: 'Admin deleted successfully.' });
  } catch (e) {
    console.error('[superadmin/admins DELETE] error:', e);
    res.status(500).json({ message: 'Failed to delete admin.' });
  }
});

// =============================================================================
// GET /api/superadmin/citizens
// List all citizens (paginated, no passwords)
// =============================================================================
router.get('/api/superadmin/citizens', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const skip  = (page - 1) * limit;

    const [citizens, total] = await Promise.all([
      User.find({ role: 'citizen' })
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments({ role: 'citizen' }),
    ]);

    res.json({
      citizens: citizens.map(u => ({
        id:        String(u._id),
        name:      u.name     || '',
        email:     u.email    || '',
        mobile:    u.phone    || '',
        phone:     u.phone    || '',
        aadhar:    maskAadhar(u.aadhar || ''),
        location:  '',           // citizens don't have a fixed home location field
        createdAt: u.createdAt || '',
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error('[superadmin/citizens GET] error:', e);
    res.status(500).json({ message: 'Failed to load citizens.' });
  }
});

// =============================================================================
// GET /api/superadmin/citizens/:id/activity
// Complaint activity log for a specific citizen
// =============================================================================
router.get('/api/superadmin/citizens/:id/activity', async (req, res) => {
  try {
    const citizen = await User.findById(req.params.id).select('-password').lean();
    if (!citizen)
      return res.status(404).json({ message: 'Citizen not found.' });

    // Complaints are owned via citizenPhone (the only owner key on the doc). Guard
    // against a blank/missing phone: matching { citizenPhone: '' } would collide —
    // it'd return EVERY phone-less citizen's complaints, making their activity logs
    // look identical. A citizen with no phone simply has no attributable activity.
    const phone = (citizen.phone || '').trim();
    const complaints = phone
      ? await Complaint.find({ citizenPhone: phone })
          .sort({ createdAt: -1 })
          .select('id title type status location createdAt updatedAt updates')
          .lean()
      : [];

    res.json({
      citizen: {
        id:    String(citizen._id),
        name:  citizen.name,
        phone: citizen.phone,
        email: citizen.email || '',
      },
      activity: complaints.map(c => ({
        id:          c.id,
        title:       c.title,
        type:        c.type,
        status:      c.status,
        location:    c.location,
        createdAt:   c.createdAt,
        updatedAt:   c.updatedAt,
        description: '',
        dateTime:    c.updatedAt || c.createdAt || '',
      })),
    });
  } catch (e) {
    console.error('[superadmin/citizens/activity] error:', e);
    res.status(500).json({ message: 'Failed to load citizen activity.' });
  }
});

// =============================================================================
// GET /api/superadmin/admins/:id/activity
// Status-update activity log for a specific admin
// Shows all complaints where this admin changed the status (tracked via updates[])
// =============================================================================
router.get('/api/superadmin/admins/:id/activity', async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id).select('-password -otpHash -otpExpires -otpAttempts').lean();
    if (!admin)
      return res.status(404).json({ message: 'Admin not found.' });

    // Per-admin activity: since July 2026 every status update stamps the acting
    // admin's _id under updates[].byId (from their verified JWT). Filter to only
    // the updates THIS admin made — scope the DB query to complaints that contain
    // at least one update by this admin, then pick out exactly those entries.
    const adminId = String(admin._id);
    const complaints = await Complaint.find({ 'updates.byId': adminId })
      .sort({ updatedAt: -1 })
      .select('id title type status location createdAt updatedAt updates')
      .lean();

    // Attribution + newest-first ordering live in the shared, unit-tested helper.
    const activity = buildAdminActivity(complaints, adminId);

    res.json({
      admin: {
        id:    String(admin._id),
        name:  admin.name,
        email: admin.email || '',
      },
      activity,
    });
  } catch (e) {
    console.error('[superadmin/admins/activity] error:', e);
    res.status(500).json({ message: 'Failed to load admin activity.' });
  }
});

module.exports = router;
