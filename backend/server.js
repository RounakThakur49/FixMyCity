// =============================================================================
// FixMyCity API — application bootstrap (modular, July 2026 refactor)
// -----------------------------------------------------------------------------
// This file is now a thin composition root. Concerns live in dedicated modules:
//   config/db.js         — Mongo connect + boot seed
//   middleware/security.js — helmet, cors, rate limiters
//   middleware/auth.js   — JWT issue/verify, requireAuth/requireAdmin
//   routes/*.js          — auth, complaints, stats, reviews, health
// The ML image pipeline now lives in a SEPARATE service (../ml-service), called
// over HTTP from routes/complaints.js. The backend holds NO ML deps or models;
// it fails open (saves the complaint) if the ML service is unset/unreachable.
//   utils/               — datetime, aadhaar mask
// Route paths are unchanged (full /api/... paths, mounted at '/') so the API
// contract and the live frontend/Vercel deploy are byte-for-byte compatible.
// =============================================================================
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const { connectDB } = require('./config/db');
const {
  helmetMiddleware, corsMiddleware, globalLimiter,
} = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 5000;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || '';

// ---- Global middleware (order matters: security → limiter → body parsers) ----
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use('/api/', globalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ---- Routes (each router declares its own full /api/... paths) ----
app.use(require('./routes/health'));
app.use(require('./routes/stats'));
app.use(require('./routes/auth'));
app.use(require('./routes/complaints'));
app.use(require('./routes/reviews'));

// =============================================================================
// GLOBAL ERROR HANDLER
// =============================================================================
// Terminal error middleware — keeps the API's JSON contract for failures that
// bypass the per-route try/catch, most notably body-parser errors (malformed
// JSON → 400, over-limit payload → 413) which otherwise return Express's
// default HTML 500.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Payload too large. Please upload a smaller image.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ message: 'Malformed request body.' });
  }
  console.error('Unhandled request error:', err);
  res.status(500).json({ message: 'Internal server error.' });
});

// =============================================================================
// START SERVER
// =============================================================================
connectDB().catch(err => console.error('MongoDB connection error:', err));

const server = app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
  // ML image validation. Two modes (see routes/complaints.js):
  //   ML_INLINE=true → pipeline co-runs in THIS process (single-service deploy).
  //     Warm the models at boot so the first complaint isn't slow.
  //   else → delegated to a separate ML service at ML_SERVICE_URL over HTTP.
  // Either way missing/unreachable ML → complaints still save (fail-open).
  const { ML_INLINE, initInline } = require('./mlInline');
  if (ML_INLINE) {
    console.log('[ml] ML_INLINE=true — loading pipeline in-process...');
    initInline()
      .then(() => console.log('[ml] In-process pipeline ready.'))
      .catch(e => console.error('[ml] In-process load error (continuing, fail-open):', e.message));
  } else if (ML_SERVICE_URL) {
    console.log(`[ml] Image validation delegated to ML service: ${ML_SERVICE_URL}`);
  } else {
    console.warn('[ml] ⚠️  No ML configured (ML_INLINE unset, ML_SERVICE_URL unset) — image validation DISABLED (complaints save unchecked, fail-open).');
  }
});

// =============================================================================
// GRACEFUL SHUTDOWN + PROCESS SAFETY NETS
// =============================================================================
// Stop accepting new connections, drain in-flight requests, then close the DB
// connection before exiting. Without this, a deploy/restart severs in-flight
// writes and churns the Mongoose pool.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing server...`);
  const forceExit = setTimeout(() => {
    console.error('[shutdown] Forced exit after 10s drain timeout.');
    process.exit(1);
  }, 10000);
  forceExit.unref();
  server.close(async () => {
    try {
      await mongoose.connection.close(false);
      console.log('[shutdown] MongoDB connection closed. Bye.');
    } catch (e) {
      console.error('[shutdown] Error closing MongoDB connection:', e.message);
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
}

['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => gracefulShutdown(sig)));

// Last-resort logging so an unexpected rejection/exception is visible rather
// than silently terminating the process on newer Node versions.
process.on('unhandledRejection', reason => {
  console.error('[process] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', err => {
  console.error('[process] Uncaught exception:', err);
});
