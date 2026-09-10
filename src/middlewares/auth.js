const jwt = require('jsonwebtoken');

/**
 * JWT auth middleware — reads the same JWT_SECRET and ella_pms users table
 * as the Ella PMS backend. No changes needed to Ella PMS.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const queryToken = req.query && req.query.token ? String(req.query.token) : '';
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, username, role, roleId }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
   return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
