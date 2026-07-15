// Security + rate-limiting middleware (extracted from server.js, July 2026).
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Security headers (CSP, X-Frame-Options, HSTS, X-Content-Type-Options, etc.)
const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
});

// CORS — restrict to known frontend origins (override via CORS_ORIGIN env var)
// Defaults include both Vite dev server (5173) and legacy CRA (3000)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(o => o.trim());
const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
});

// Rate limiters. DISABLE_RATE_LIMIT=true opts out for local E2E/integration
// runs (many complaint POSTs in quick succession). NEVER set in production.
const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';
const passthrough = (req, res, next) => next();

const globalLimiter = RATE_LIMIT_DISABLED ? passthrough : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
});
const authLimiter = RATE_LIMIT_DISABLED ? passthrough : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' },
});
const complaintLimiter = RATE_LIMIT_DISABLED ? passthrough : rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many complaints submitted. Please wait a moment.' },
});
if (RATE_LIMIT_DISABLED) {
  console.warn('[security] ⚠️  Rate limiting DISABLED (DISABLE_RATE_LIMIT=true). Dev/test only — never in production.');
}

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  globalLimiter,
  authLimiter,
  complaintLimiter,
  RATE_LIMIT_DISABLED,
};
