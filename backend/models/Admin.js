const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  // Email is required for the super admin (Brevo OTP is sent here).
  // Regular admins created by super admin carry an email too (for contact / future features).
  email: {
    type: String,
    trim: true,
    default: '',
    // sparse unique: multiple admins can have empty email, but non-empty emails must be unique.
    sparse: true,
  },
  // Optional phone number — shown on profile, used by the superadmin panel
  phone: {
    type: String,
    trim: true,
    default: '',
  },
  password: {
    type: String,
    required: true,
    // Never ship the bcrypt hash by default; opt in with .select('+password').
    select: false,
  },
  role: {
    type: String,
    // 'superadmin' is the single hard-coded root account (seeded, not registerable).
    // 'admin' accounts are created BY the super admin from the dashboard.
    enum: ['admin', 'superadmin'],
    default: 'admin',
  },
  // Audit: which super admin created this admin (null for the seeded super admin).
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  // Brevo email-OTP challenge (super admin login only).
  // Stored bcrypt-hashed with a short expiry; never returned to the client.
  // Cleared after a successful verify-otp call.
  otpHash:     { type: String, select: false, default: null },
  otpExpires:  { type: Date,   select: false, default: null },
  otpAttempts: { type: Number, select: false, default: 0   },
}, {
  timestamps: true,
});

// Sparse unique index on email — allows blank, rejects duplicate non-blank values
AdminSchema.index({ email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Admin', AdminSchema);
