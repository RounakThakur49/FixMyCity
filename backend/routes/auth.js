const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Admin = require('../models/Admin');
const { validateAadhaar } = require('../aadhaar');
const { maskAadhar } = require('../utils/mask');
const { issueToken, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');

router.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, phone, aadhar, email, password } = req.body;
    if (!name || !phone || !aadhar || !password) {
      return res.status(400).json({ message: 'All registration fields are required.' });
    }
    // Reject non-string fields so query-operator objects can't reach findOne/save
    // (NoSQL injection) and downstream .trim()/regex can't throw.
    if ([name, phone, aadhar, password].some(v => typeof v !== 'string') ||
        (email !== undefined && email !== null && typeof email !== 'string')) {
      return res.status(400).json({ message: 'Invalid registration fields.' });
    }
    if (!/^\d{12}$/.test(aadhar)) {
      return res.status(400).json({ message: 'Aadhar number must be exactly 12 digits.' });
    }
    // Full offline format validation: 12 digits + first-digit rule + Verhoeff
    // checksum (rejects typos / random fakes the way government portals do).
    const aadhaarCheck = validateAadhaar(aadhar);
    if (!aadhaarCheck.valid) {
      return res.status(400).json({ message: aadhaarCheck.message });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ message: 'Mobile number already registered.' });
    }
    if (await User.findOne({ aadhar })) {
      return res.status(400).json({ message: 'Aadhar number already registered.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const u = new User({ name, phone, aadhar, email: email || '', password: hash, role: 'citizen' });
    await u.save();
    res.status(201).json({
      message: 'Citizen registered successfully.',
      token: issueToken(u),
      user: { id: u._id, name: u.name, phone: u.phone, aadhar: maskAadhar(u.aadhar), email: u.email || '', role: u.role },
    });
  } catch (e) {
    // A concurrent duplicate registration can slip past the findOne checks and
    // be rejected by the unique index — surface it as a friendly 400, not a 500.
    if (e && e.code === 11000) {
      const field = e.keyPattern && e.keyPattern.aadhar ? 'Aadhar number' : 'Mobile number';
      return res.status(400).json({ message: `${field} already registered.` });
    }
    console.error('Registration error:', e);
    res.status(500).json({ message: 'Internal server error during registration.' });
  }
});

router.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const identifier = req.body.identifier || req.body.phone;
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Mobile number/ID and password are required.' });
    }
    // Reject non-string inputs so a JSON body like {"identifier":{"$ne":null}}
    // can't smuggle a Mongo query operator into findOne (NoSQL injection).
    if (typeof identifier !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }
    let user = await Admin.findOne({ username: identifier }).select('+password');
    if (!user) user = await User.findOne({ phone: identifier }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    res.status(200).json({
      message: 'Logged in successfully.',
      token: issueToken(user),
      user: {
        id: user._id, name: user.name, phone: user.phone || '', username: user.username || '',
        aadhar: maskAadhar(user.aadhar || ''), email: user.email || '', role: user.role,
      },
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ message: 'Internal server error during login.' });
  }
});

router.patch('/api/auth/update-profile', requireAuth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    // Identity comes from the verified token, NOT the request body — a caller
    // can only ever edit their own profile, and the old id/userId mismatch that
    // broke the Edit Profile form is gone (frontend no longer sends an id).
    const userId = req.auth.sub;
    let user = await User.findById(userId).select('+password');
    if (!user) user = await Admin.findById(userId).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (name && typeof name === 'string') user.name = name.trim().slice(0, 200);
    if (email !== undefined) user.email = (email || '').trim().slice(0, 200);
    if (phone && typeof phone === 'string' && user.role !== 'admin') {
      const existing = await User.findOne({ phone, _id: { $ne: user._id } });
      if (existing) return res.status(400).json({ message: 'Phone number already in use.' });
      user.phone = phone.trim();
    }
    await user.save();
    res.status(200).json({
      user: {
        id: user._id, name: user.name, phone: user.phone || '', username: user.username || '',
        aadhar: maskAadhar(user.aadhar || ''), email: user.email || '', role: user.role,
      },
    });
  } catch (e) {
    console.error('Update profile error:', e);
    res.status(500).json({ message: 'Failed to update profile.' });
  }
});

module.exports = router;
