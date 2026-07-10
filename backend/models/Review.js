const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  role: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  quote: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000,
  },
  avatar: {
    type: String,
    required: true,
    trim: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  complaintId: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

// The reviews list is always fetched sorted by newest first.
ReviewSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Review', ReviewSchema);
