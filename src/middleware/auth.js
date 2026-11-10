const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// Admin always passes. allow() with no roles = admin only.
const allow = (...roles) => (req, res, next) =>
  req.user && (req.user.role === 'admin' || roles.includes(req.user.role))
    ? next()
    : res.status(403).json({ error: 'You do not have permission for this action' });

module.exports = { auth, allow };
