const express = require('express');
const router = express.Router();
const { superAdminAuth, adminAuth } = require('../middleware/auth');
const User = require('../models/User');

/**
 * Get all admins with their credit info (Super Admin only)
 * GET /api/admin-management/admins
 */
router.get('/admins', superAdminAuth, async (req, res) => {
  try {
    const admins = await User.find({ isAdmin: true, isSuperAdmin: false })
      .select('-password')
      .sort({ createdAt: -1 });

    // Convert Map to plain object for JSON response
    const adminsData = admins.map(admin => {
      const adminObj = admin.toObject();
      if (adminObj.gameCredits) {
        adminObj.gameCredits = Object.fromEntries(adminObj.gameCredits);
      }
      return adminObj;
    });

    res.json(adminsData);
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Error fetching admins' });
  }
});

/**
 * Add credits to an admin (Super Admin only)
 * POST /api/admin-management/admins/:adminId/add-credits
 */
router.post('/admins/:adminId/add-credits', superAdminAuth, async (req, res) => {
  try {
    const { credits } = req.body;
    const { adminId } = req.params;

    if (!credits || credits <= 0) {
      return res.status(400).json({ error: 'Credits must be a positive number' });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (!admin.isAdmin || admin.isSuperAdmin) {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    admin.credits += credits;
    await admin.save();

    res.json({
      message: `Added ${credits} credits to ${admin.username}`,
      admin: {
        _id: admin._id,
        username: admin.username,
        credits: admin.credits
      }
    });
  } catch (error) {
    console.error('Error adding credits:', error);
    res.status(500).json({ error: 'Error adding credits' });
  }
});

/**
 * Subtract credits from an admin (Super Admin only)
 * POST /api/admin-management/admins/:adminId/subtract-credits
 */
router.post('/admins/:adminId/subtract-credits', superAdminAuth, async (req, res) => {
  try {
    const { credits } = req.body;
    const { adminId } = req.params;

    if (!credits || credits <= 0) {
      return res.status(400).json({ error: 'Credits must be a positive number' });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (!admin.isAdmin || admin.isSuperAdmin) {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    if (admin.credits < credits) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    admin.credits -= credits;
    await admin.save();

    res.json({
      message: `Subtracted ${credits} credits from ${admin.username}`,
      admin: {
        _id: admin._id,
        username: admin.username,
        credits: admin.credits
      }
    });
  } catch (error) {
    console.error('Error subtracting credits:', error);
    res.status(500).json({ error: 'Error subtracting credits' });
  }
});

/**
 * Set admin credits to specific amount (Super Admin only)
 * POST /api/admin-management/admins/:adminId/set-credits
 */
router.post('/admins/:adminId/set-credits', superAdminAuth, async (req, res) => {
  try {
    const { credits } = req.body;
    const { adminId } = req.params;

    if (credits < 0) {
      return res.status(400).json({ error: 'Credits cannot be negative' });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (!admin.isAdmin || admin.isSuperAdmin) {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    admin.credits = credits;
    await admin.save();

    res.json({
      message: `Set ${admin.username}'s credits to ${credits}`,
      admin: {
        _id: admin._id,
        username: admin.username,
        credits: admin.credits
      }
    });
  } catch (error) {
    console.error('Error setting credits:', error);
    res.status(500).json({ error: 'Error setting credits' });
  }
});

/**
 * Get current admin's credit balance
 * GET /api/admin-management/my-credits
 */
router.get('/my-credits', adminAuth, async (req, res) => {
  try {
    const admin = await User.findById(req.user._id).select('credits username');
    res.json({
      username: admin.username,
      credits: admin.credits
    });
  } catch (error) {
    console.error('Error fetching credits:', error);
    res.status(500).json({ error: 'Error fetching credits' });
  }
});

/**
 * Get all players (regular users who are not admins)
 * GET /api/admin-management/players
 */
router.get('/players', adminAuth, async (req, res) => {
  try {
    const players = await User.find({
      isAdmin: false,
      isSuperAdmin: false
    })
      .select('username email createdAt')
      .sort({ createdAt: -1 });

    res.json(players);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Error fetching players' });
  }
});

/**
 * Set game cost for a specific admin and game (Super Admin only)
 * POST /api/admin-management/admins/:adminId/set-game-cost
 */
router.post('/admins/:adminId/set-game-cost', superAdminAuth, async (req, res) => {
  try {
    const { gameCost, gameType } = req.body;
    const { adminId } = req.params;

    if (!gameCost || gameCost < 0) {
      return res.status(400).json({ error: 'Game cost must be a positive number or zero' });
    }

    if (!gameType || !['number-bingo', 'letter-bingo'].includes(gameType)) {
      return res.status(400).json({ error: 'Invalid game type' });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (!admin.isAdmin || admin.isSuperAdmin) {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    // Initialize gameCredits Map if it doesn't exist
    if (!admin.gameCredits) {
      admin.gameCredits = new Map();
    }

    admin.gameCredits.set(gameType, gameCost);
    admin.markModified('gameCredits');
    await admin.save();

    // Convert Map to plain object for response
    const gameCreditsObj = Object.fromEntries(admin.gameCredits);

    res.json({
      message: `Set ${gameType} game cost to ${gameCost} credits for ${admin.username}`,
      admin: {
        _id: admin._id,
        username: admin.username,
        gameCredits: gameCreditsObj
      }
    });
  } catch (error) {
    console.error('Error setting game cost:', error);
    res.status(500).json({ error: 'Error setting game cost' });
  }
});

module.exports = router;
