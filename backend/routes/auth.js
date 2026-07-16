const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const router   = express.Router();
const User     = require('../models/User');
const Admin    = require('../models/Admin');
const { validateAadhaar } = require('../aadhaar');
const { maskAadhar } = require('../utils/mask');
const { issueToken, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const { sendOtpEmail } = require('../utils/emailOtp');

// =============================================================================
// Helper — generate a 6-digit OTP string
// =============================================================================
function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

// =============================================================================
// POST /api/auth/register
// Citizen self-registration (citizen only; admins created by superadmin)
// =============================================================================
router.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    // Accept both our backend field names AND the fork frontend's field names
    const name     = req.body.name     || `${req.body.firstName || ''} ${req.body.lastName || ''}`.trim();
    const phone    = req.body.phone    || req.body.mobile || '';
    const aadhar   = req.body.aadhar   || req.body.aadharNumber || '';
    const email    = req.body.email    || '';
    const password = req.body.password || '';

    if (!name || !phone || !aadhar || !password) {
      return res.status(400).json({ message: 'All registration fields are required.' });
    }
    if ([name, phone, aadhar, password].some(v => typeof v !== 'string') ||
        (email !== undefined && email !== null && typeof email !== 'string')) {
      return res.status(400).json({ message: 'Invalid registration fields.' });
    }
    if (!/^\d{12}$/.test(aadhar)) {
      return res.status(400).json({ message: 'Aadhar number must be exactly 12 digits.' });
    }
    const aadhaarCheck = validateAadhaar(aadhar);
    if (!aadhaarCheck.valid) {
      return res.status(400).json({ message: aadhaarCheck.message });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ message: 'Mobile number already registered.' });
    }
    if (await User.findOne({ aadhar })) {
      return res.status(400).json({ message: 'Aadhar number already registered.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const u = new User({ name, phone, aadhar, email: email || '', password: hash, role: 'citizen' });
    await u.save();

    const token = issueToken(u);
    res.status(201).json({
      message: 'Citizen registered successfully.',
      token,
      user: {
        id:     String(u._id),
        name:   u.name,
        phone:  u.phone,
        aadhar: maskAadhar(u.aadhar),
        email:  u.email || '',
        role:   u.role,
      },
    });
  } catch (e) {
    if (e && e.code === 11000) {
      const field = e.keyPattern?.aadhar ? 'Aadhar number' : 'Mobile number';
      return res.status(400).json({ message: `${field} already registered.` });
    }
    console.error('Registration error:', e);
    res.status(500).json({ message: 'Internal server error during registration.' });
  }
});

// =============================================================================
// POST /api/auth/login
// Unified login for citizen, admin, and superadmin.
//
// For CITIZEN:  identifier = phone OR email; matches User collection.
// For ADMIN:    identifier = username OR email; matches Admin collection (role=admin).
// For SUPERADMIN: identifier = email; matches Admin (role=superadmin).
//   → does NOT issue a full JWT immediately.
//   → instead issues a short-lived "pending" JWT and sends a Brevo OTP email.
//   → frontend shows OTP prompt; full JWT is issued at /api/auth/verify-otp.
//
// Body: { identifier, password, role }
//   role: 'citizen' | 'admin'   (superadmin logs in through 'admin' path)
// =============================================================================
router.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { password, role } = req.body;
    // Accept both 'identifier' (our backend) and 'email' (fork frontend field name)
    const identifier = req.body.identifier || req.body.email || req.body.phone || '';

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Identifier and password are required.' });
    }
    if (typeof identifier !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const id = identifier.trim();

    // ------------------------------------------------------------------
    // Admin / superadmin path (role === 'admin' covers both)
    // ------------------------------------------------------------------
    if (role === 'admin' || role === 'superadmin') {
      // Try username first, then email
      let adminUser = await Admin.findOne({ username: id }).select('+password');
      if (!adminUser) {
        adminUser = await Admin.findOne({ email: id.toLowerCase() }).select('+password');
      }
      if (!adminUser) return res.status(401).json({ message: 'Invalid credentials.' });
      if (!(await bcrypt.compare(password, adminUser.password))) {
        return res.status(401).json({ message: 'Invalid credentials.' });
      }

      // ── Superadmin path: OTP required ────────────────────────────────
      if (adminUser.role === 'superadmin') {
        if (!adminUser.email) {
          return res.status(400).json({
            message: 'Super admin account has no email configured for OTP delivery. Contact system administrator.',
          });
        }

        // Generate OTP, hash it, store with 10-min expiry
        const otp = generateOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        adminUser.otpHash     = otpHash;
        adminUser.otpExpires  = new Date(Date.now() + 10 * 60 * 1000); // +10 min
        adminUser.otpAttempts = 0;
        await adminUser.save();

        // Send via Brevo (stubs to console in dev if creds not set)
        try {
          await sendOtpEmail(adminUser.email, otp);
        } catch (emailErr) {
          // Still proceed — OTP is in the DB; admin can check console in dev
          console.error('[auth/login] OTP email delivery failed:', emailErr.message);
        }

        // Issue a short-lived "pending" token — only usable at verify-otp
        const pendingToken = issueToken({ _id: adminUser._id, role: 'otp-pending', name: adminUser.name });

        return res.status(200).json({
          requiresOtp: true,
          pendingToken,
          message: 'OTP sent to your registered email address. Please verify.',
        });
      }

      // ── Regular admin path: full JWT ─────────────────────────────────
      const token = issueToken(adminUser);
      return res.status(200).json({
        message: 'Logged in successfully.',
        token,
        user: {
          id:       String(adminUser._id),
          name:     adminUser.name,
          username: adminUser.username || '',
          email:    adminUser.email    || '',
          phone:    adminUser.phone    || '',
          role:     adminUser.role,
        },
      });
    }

    // ------------------------------------------------------------------
    // Citizen path (default)
    // ------------------------------------------------------------------
    // Accept phone OR email as identifier
    let citizenUser = await User.findOne({ phone: id }).select('+password');
    if (!citizenUser && id.includes('@')) {
      citizenUser = await User.findOne({ email: id.toLowerCase() }).select('+password');
    }
    if (!citizenUser) return res.status(401).json({ message: 'Invalid credentials.' });
    if (!(await bcrypt.compare(password, citizenUser.password))) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = issueToken(citizenUser);
    return res.status(200).json({
      message: 'Logged in successfully.',
      token,
      user: {
        id:     String(citizenUser._id),
        name:   citizenUser.name,
        phone:  citizenUser.phone || '',
        aadhar: maskAadhar(citizenUser.aadhar || ''),
        email:  citizenUser.email || '',
        role:   citizenUser.role,
      },
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ message: 'Internal server error during login.' });
  }
});

// =============================================================================
// POST /api/auth/verify-otp
// Verify the 6-digit OTP for superadmin login.
// Requires the "pending" JWT from the login response as Bearer token.
// Body: { otp }
// Returns: { token, user } — full superadmin JWT
// =============================================================================
router.post('/api/auth/verify-otp', authLimiter, async (req, res) => {
  try {
    const { otp } = req.body;
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Pending token required.' });
    }

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7).trim(), JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Pending token expired or invalid. Please log in again.' });
    }

    if (decoded.role !== 'otp-pending') {
      return res.status(401).json({ message: 'Invalid pending token.' });
    }

    const adminUser = await Admin.findById(decoded.sub)
      .select('+otpHash +otpExpires +otpAttempts');

    if (!adminUser || adminUser.role !== 'superadmin') {
      return res.status(401).json({ message: 'Invalid session.' });
    }

    // Check expiry
    if (!adminUser.otpExpires || adminUser.otpExpires < new Date()) {
      adminUser.otpHash = null; adminUser.otpExpires = null; adminUser.otpAttempts = 0;
      await adminUser.save();
      return res.status(401).json({ message: 'OTP has expired. Please log in again.' });
    }

    // Rate-limit attempts (max 5)
    if (adminUser.otpAttempts >= 5) {
      adminUser.otpHash = null; adminUser.otpExpires = null; adminUser.otpAttempts = 0;
      await adminUser.save();
      return res.status(429).json({ message: 'Too many incorrect OTP attempts. Please log in again.' });
    }

    const isMatch = (otp && typeof otp === 'string' && adminUser.otpHash && await bcrypt.compare(otp.trim(), adminUser.otpHash));

    if (!isMatch) {
      adminUser.otpAttempts = (adminUser.otpAttempts || 0) + 1;
      await adminUser.save();
      return res.status(401).json({ message: 'Invalid OTP. Please try again.' });
    }

    // OTP correct — clear it and issue full JWT
    adminUser.otpHash = null; adminUser.otpExpires = null; adminUser.otpAttempts = 0;
    await adminUser.save();

    const fullToken = issueToken(adminUser);
    return res.status(200).json({
      message: 'OTP verified. Login successful.',
      token: fullToken,
      user: {
        id:       String(adminUser._id),
        name:     adminUser.name,
        username: adminUser.username || '',
        email:    adminUser.email    || '',
        role:     adminUser.role,
      },
    });
  } catch (e) {
    console.error('OTP verify error:', e);
    res.status(500).json({ message: 'Internal server error during OTP verification.' });
  }
});

// =============================================================================
// PATCH /api/auth/update-profile
// Update the logged-in user's own profile (name, email, phone)
// =============================================================================
router.patch('/api/auth/update-profile', requireAuth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.auth.sub;
    let user = await User.findById(userId).select('+password');
    if (!user) user = await Admin.findById(userId).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (name && typeof name === 'string') user.name = name.trim().slice(0, 200);
    if (email !== undefined) user.email = (email || '').trim().slice(0, 200);
    if (phone && typeof phone === 'string' && user.role === 'citizen') {
      const existing = await User.findOne({ phone, _id: { $ne: user._id } });
      if (existing) return res.status(400).json({ message: 'Phone number already in use.' });
      user.phone = phone.trim();
    }
    await user.save();
    res.status(200).json({
      user: {
        id:       String(user._id),
        name:     user.name,
        phone:    user.phone     || '',
        username: user.username  || '',
        aadhar:   maskAadhar(user.aadhar || ''),
        email:    user.email     || '',
        role:     user.role,
      },
    });
  } catch (e) {
    console.error('Update profile error:', e);
    res.status(500).json({ message: 'Failed to update profile.' });
  }
});

module.exports = router;
