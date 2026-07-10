const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    // Never ship the bcrypt hash by default; opt in with .select('+password').
    select: false,
  },
  role: {
    type: String,
    enum: ['admin'],
    default: 'admin',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Admin', AdminSchema);
