const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    await auth(req, res, () => {
      if (!req.user.isAdmin && !req.user.isSuperAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      next();
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};

const superAdminAuth = async (req, res, next) => {
  try {
    await auth(req, res, () => {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({ error: 'Super admin access required' });
      }
      next();
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};

module.exports = { auth, adminAuth, superAdminAuth };
