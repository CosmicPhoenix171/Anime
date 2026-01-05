const userService = require('../services/userService');

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

async function ensureAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const isAdmin = await userService.isAdmin(req.user.id);
    if (isAdmin) {
      return next();
    }
    res.status(403).json({ error: 'Admin access required' });
  } catch (error) {
    res.status(500).json({ error: 'Authorization check failed' });
  }
}

// Optional auth - continues even if not authenticated
function optionalAuth(req, res, next) {
  // Just continue, req.user will be undefined if not authenticated
  next();
}

module.exports = { ensureAuthenticated, ensureAdmin, optionalAuth };
