const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const User = require('../models/User');

router.get('/api/stats', async (req, res) => {
  try {
    const totalComplaints = await Complaint.countDocuments();
    const resolvedComplaints = await Complaint.countDocuments({ status: 'Resolved' });
    const registeredCitizens = await User.countDocuments({ role: 'citizen' });
    res.status(200).json({ totalComplaints, resolvedComplaints, registeredCitizens });
  } catch (e) {
    console.error('Get stats error:', e);
    res.status(500).json({ message: 'Failed to retrieve stats.' });
  }
});

module.exports = router;
