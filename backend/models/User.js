const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  aadhar: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    maxlength: 200,
  },
  password: {
    type: String,
    required: true,
    // Never ship the bcrypt hash in a query result by default. Routes that need
    // it for comparison must opt in with .select('+password').
    select: false,
  },
  role: {
    type: String,
    enum: ['citizen', 'admin'],
    default: 'citizen',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', UserSchema);
