const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const { requireAuth } = require('../middleware/auth');

router.post('/api/reviews', requireAuth, async (req, res) => {
  try {
    const { name, role, quote, rating, complaintId } = req.body;
    if (!name || !role || !quote || !rating) {
      return res.status(400).json({ message: 'All review fields (name, role, quote, rating) are required.' });
    }
    const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
    const newReview = new Review({ name, role, quote, avatar: initials, rating: Number(rating), complaintId: complaintId || '' });
    await newReview.save();
    if (complaintId) {
      await Complaint.findOneAndUpdate({ id: complaintId }, { isReviewed: true });
    }
    res.status(201).json(newReview);
  } catch (error) {
    console.error('Submit review error:', error);
    res.status(500).json({ message: 'Failed to submit review.' });
  }
});

router.get('/api/reviews', async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.status(200).json(reviews);
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ message: 'Failed to retrieve reviews.' });
  }
});

module.exports = router;
