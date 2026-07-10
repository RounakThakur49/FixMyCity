// MongoDB connection + boot seeding (extracted from server.js, July 2026).
const mongoose = require('mongoose');
const { seedDatabase } = require('../db/seed');

async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/FixMyCity', {
    // Bound the pool and fail fast on an unreachable/failing-over server instead
    // of hanging requests on driver defaults.
    maxPoolSize: 20,
    // Model loading (pure-JS tfjs weight-decode + warmup) runs at boot and blocks
    // the event loop for several seconds, which can starve the async MongoDB SDAM
    // handshake. A short selection timeout would let the INITIAL connect fail
    // during that block (mongoose does not retry an initial connect), leaving
    // every request to buffer-timeout. 45s comfortably outlasts model load; a
    // healthy server still connects in well under a second.
    serverSelectionTimeoutMS: 45000,
    socketTimeoutMS: 45000,
  });
  console.log('Connected to MongoDB.');
  await seedDatabase();
}

module.exports = { connectDB };
