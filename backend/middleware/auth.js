const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET
  || 'fixmycity-dev-insecure-secret-change-me-in-production';
if (!process.env.JWT_SECRET) {
  console.warn('[security] ⚠️  JWT_SECRET not set — using an insecure dev fallback. Set JWT_SECRET in the host env before production.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function issueToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name || '' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function extractToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required. Please log in.' });
  }
  try {
    req.auth = jwt.verify(token, JWT_SECRET); // { sub, role, name, iat, exp }
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Session expired or invalid. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    // Super admin is a strict superset of admin — it passes every admin-gated route.
    if (req.auth.role !== 'admin' && req.auth.role !== 'superadmin') {
      return res.status(403).json({ message: 'Admin privileges required.' });
    }
    return next();
  });
}

function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.auth.role !== 'superadmin') {
      return res.status(403).json({ message: 'Super admin privileges required.' });
    }
    return next();
  });
}

module.exports = { issueToken, extractToken, requireAuth, requireAdmin, requireSuperAdmin, JWT_SECRET };
