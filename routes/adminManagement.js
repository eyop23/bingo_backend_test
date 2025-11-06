const express = require('express');
const router = express.Router();
const { superAdminAuth, adminAuth } = require('../middleware/auth');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const BingoGameSession = require('../models/BingoGameSession');
const LetterBingoGameSession = require('../models/LetterBingoGameSession');

// Socket.io instance will be set from server.js
let io;

const setSocketIO = (socketIO) => {
  io = socketIO;
};

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
      .select('username email wallet createdAt')
      .sort({ createdAt: -1 });

    res.json(players);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Error fetching players' });
  }
});

/**
 * Add money to player's wallet (Admin only)
 * POST /api/admin-management/players/:playerId/add-wallet
 */
router.post('/players/:playerId/add-wallet', adminAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const { playerId } = req.params;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const player = await User.findById(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (player.isAdmin || player.isSuperAdmin) {
      return res.status(400).json({ error: 'Cannot modify admin wallet' });
    }

    const balanceBefore = player.wallet;
    player.wallet += amount;
    await player.save();

    // Record transaction
    await WalletTransaction.create({
      user: player._id,
      type: 'admin_add',
      amount: amount,
      balanceBefore: balanceBefore,
      balanceAfter: player.wallet,
      description: `Admin added ${amount} Birr to wallet`,
      performedBy: req.user._id
    });

    // Emit socket event for real-time update
    if (io) {
      io.emit('walletUpdated', {
        userId: player._id.toString(),
        newBalance: player.wallet
      });
    }

    res.json({
      message: `Added ${amount} to ${player.username}'s wallet`,
      player: {
        _id: player._id,
        username: player.username,
        wallet: player.wallet
      }
    });
  } catch (error) {
    console.error('Error adding to wallet:', error);
    res.status(500).json({ error: 'Error adding to wallet' });
  }
});

/**
 * Subtract money from player's wallet (Admin only)
 * POST /api/admin-management/players/:playerId/subtract-wallet
 */
router.post('/players/:playerId/subtract-wallet', adminAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const { playerId } = req.params;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const player = await User.findById(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (player.isAdmin || player.isSuperAdmin) {
      return res.status(400).json({ error: 'Cannot modify admin wallet' });
    }

    if (player.wallet < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    const balanceBefore = player.wallet;
    player.wallet -= amount;
    await player.save();

    // Record transaction
    await WalletTransaction.create({
      user: player._id,
      type: 'admin_subtract',
      amount: -amount,
      balanceBefore: balanceBefore,
      balanceAfter: player.wallet,
      description: `Admin subtracted ${amount} Birr from wallet`,
      performedBy: req.user._id
    });

    // Emit socket event for real-time update
    if (io) {
      io.emit('walletUpdated', {
        userId: player._id.toString(),
        newBalance: player.wallet
      });
    }

    res.json({
      message: `Subtracted ${amount} from ${player.username}'s wallet`,
      player: {
        _id: player._id,
        username: player.username,
        wallet: player.wallet
      }
    });
  } catch (error) {
    console.error('Error subtracting from wallet:', error);
    res.status(500).json({ error: 'Error subtracting from wallet' });
  }
});

/**
 * Set player's wallet to specific amount (Admin only)
 * POST /api/admin-management/players/:playerId/set-wallet
 */
router.post('/players/:playerId/set-wallet', adminAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const { playerId } = req.params;

    if (amount < 0) {
      return res.status(400).json({ error: 'Amount cannot be negative' });
    }

    const player = await User.findById(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (player.isAdmin || player.isSuperAdmin) {
      return res.status(400).json({ error: 'Cannot modify admin wallet' });
    }

    const balanceBefore = player.wallet;
    player.wallet = amount;
    await player.save();

    // Record transaction
    await WalletTransaction.create({
      user: player._id,
      type: 'admin_set',
      amount: amount - balanceBefore,
      balanceBefore: balanceBefore,
      balanceAfter: player.wallet,
      description: `Admin set wallet to ${amount} Birr`,
      performedBy: req.user._id
    });

    // Emit socket event for real-time update
    if (io) {
      io.emit('walletUpdated', {
        userId: player._id.toString(),
        newBalance: player.wallet
      });
    }

    res.json({
      message: `Set ${player.username}'s wallet to ${amount}`,
      player: {
        _id: player._id,
        username: player.username,
        wallet: player.wallet
      }
    });
  } catch (error) {
    console.error('Error setting wallet:', error);
    res.status(500).json({ error: 'Error setting wallet' });
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

/**
 * Get comprehensive analytics for all admins (Super Admin only)
 * GET /api/admin-management/analytics
 */
router.get('/analytics', superAdminAuth, async (req, res) => {
  try {


    // Get all admins
    const admins = await User.find({ isAdmin: true, isSuperAdmin: false })
      .select('-password')
      .lean();

    const analyticsData = [];

    for (const admin of admins) {
      // Get number bingo games created by this admin
      const numberBingoGames = await BingoGameSession.find({ createdBy: admin._id }).lean();

      // Get letter bingo games created by this admin
      const letterBingoGames = await LetterBingoGameSession.find({ createdBy: admin._id }).lean();

      // Calculate statistics for number bingo
      const numberBingoStats = {
        totalGames: numberBingoGames.length,
        completedGames: numberBingoGames.filter(g => g.status === 'completed').length,
        activeGames: numberBingoGames.filter(g => g.status === 'active').length,
        totalRevenue: 0,
        totalProfit: 0,
        totalPlayers: 0
      };

      numberBingoGames.forEach(game => {
        const playerCount = game.players?.length || 0;
        const revenue = playerCount * (game.playerEntryFee || 0);
        const profit = (revenue * (game.profitPercentage || 0)) / 100;

        numberBingoStats.totalRevenue += revenue;
        numberBingoStats.totalProfit += profit;
        numberBingoStats.totalPlayers += playerCount;
      });

      // Calculate statistics for letter bingo
      const letterBingoStats = {
        totalGames: letterBingoGames.length,
        completedGames: letterBingoGames.filter(g => g.status === 'completed').length,
        activeGames: letterBingoGames.filter(g => g.status === 'active').length,
        totalRevenue: 0,
        totalProfit: 0,
        totalPlayers: 0
      };

      letterBingoGames.forEach(game => {
        const playerCount = game.players?.length || 0;
        const revenue = playerCount * (game.playerEntryFee || 0);
        const profit = (revenue * (game.profitPercentage || 0)) / 100;

        letterBingoStats.totalRevenue += revenue;
        letterBingoStats.totalProfit += profit;
        letterBingoStats.totalPlayers += playerCount;
      });

      // Combined statistics
      const combinedStats = {
        totalGames: numberBingoStats.totalGames + letterBingoStats.totalGames,
        completedGames: numberBingoStats.completedGames + letterBingoStats.completedGames,
        activeGames: numberBingoStats.activeGames + letterBingoStats.activeGames,
        totalRevenue: numberBingoStats.totalRevenue + letterBingoStats.totalRevenue,
        totalProfit: numberBingoStats.totalProfit + letterBingoStats.totalProfit,
        totalPlayers: numberBingoStats.totalPlayers + letterBingoStats.totalPlayers
      };

      // Calculate credits spent (games created * game cost)
      const numberBingoGameCost = admin.gameCredits?.get?.('number-bingo') ||
                                   (admin.gameCredits?.['number-bingo']) || 0;
      const letterBingoGameCost = admin.gameCredits?.get?.('letter-bingo') ||
                                   (admin.gameCredits?.['letter-bingo']) || 0;

      const creditsSpent = (numberBingoStats.totalGames * numberBingoGameCost) +
                           (letterBingoStats.totalGames * letterBingoGameCost);

      analyticsData.push({
        adminId: admin._id,
        username: admin.username,
        currentCredits: admin.credits,
        creditsSpent: creditsSpent,
        gameCredits: admin.gameCredits ? Object.fromEntries(
          admin.gameCredits instanceof Map ? admin.gameCredits : new Map(Object.entries(admin.gameCredits))
        ) : {},
        numberBingo: numberBingoStats,
        letterBingo: letterBingoStats,
        combined: combinedStats,
        averagePlayersPerGame: combinedStats.totalGames > 0
          ? (combinedStats.totalPlayers / combinedStats.totalGames).toFixed(2)
          : 0,
        averageProfitPerGame: combinedStats.totalGames > 0
          ? (combinedStats.totalProfit / combinedStats.totalGames).toFixed(2)
          : 0
      });
    }

    // Sort by total profit (highest first)
    analyticsData.sort((a, b) => b.combined.totalProfit - a.combined.totalProfit);

    // Get total unique players (regular users only, not admins/superadmins)
    const totalPlayers = await User.countDocuments({
      isAdmin: false,
      isSuperAdmin: false
    });

    // Calculate overall statistics
    const overallStats = {
      totalAdmins: admins.length,
      totalGamesCreated: analyticsData.reduce((sum, a) => sum + a.combined.totalGames, 0),
      totalCompletedGames: analyticsData.reduce((sum, a) => sum + a.combined.completedGames, 0),
      totalActiveGames: analyticsData.reduce((sum, a) => sum + a.combined.activeGames, 0),
      totalRevenue: analyticsData.reduce((sum, a) => sum + a.combined.totalRevenue, 0),
      totalProfit: analyticsData.reduce((sum, a) => sum + a.combined.totalProfit, 0),
      totalPlayers: totalPlayers,
      totalCreditsInSystem: admins.reduce((sum, a) => sum + a.credits, 0),
      totalCreditsSpent: analyticsData.reduce((sum, a) => sum + a.creditsSpent, 0)
    };

    res.json({
      overall: overallStats,
      adminAnalytics: analyticsData
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Error fetching analytics' });
  }
});

/**
 * Get analytics for a specific admin (Super Admin only)
 * GET /api/admin-management/admins/:adminId/analytics
 */
router.get('/admins/:adminId/analytics', superAdminAuth, async (req, res) => {
  try {
    const { adminId } = req.params;
    const BingoGameSession = require('../models/BingoGameSession');
    const LetterBingoGameSession = require('../models/LetterBingoGameSession');

    const admin = await User.findById(adminId).select('-password').lean();
    if (!admin || !admin.isAdmin || admin.isSuperAdmin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Get all games created by this admin
    const numberBingoGames = await BingoGameSession.find({ createdBy: adminId })
      .populate('players', 'username')
      .sort({ createdAt: -1 })
      .lean();

    const letterBingoGames = await LetterBingoGameSession.find({ createdBy: adminId })
      .populate('players', 'username')
      .sort({ createdAt: -1 })
      .lean();

    // Format all games (no limit)
    const recentGames = [
      ...numberBingoGames.map(g => ({
        ...g,
        gameType: 'Number Bingo',
        playerCount: g.players?.length || 0,
        revenue: (g.players?.length || 0) * (g.playerEntryFee || 0),
        profit: ((g.players?.length || 0) * (g.playerEntryFee || 0) * (g.profitPercentage || 0)) / 100
      })),
      ...letterBingoGames.map(g => ({
        ...g,
        gameType: 'Letter Bingo',
        playerCount: g.players?.length || 0,
        revenue: (g.players?.length || 0) * (g.playerEntryFee || 0),
        profit: ((g.players?.length || 0) * (g.playerEntryFee || 0) * (g.profitPercentage || 0)) / 100
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      admin: {
        _id: admin._id,
        username: admin.username,
        credits: admin.credits,
        gameCredits: admin.gameCredits ? Object.fromEntries(
          admin.gameCredits instanceof Map ? admin.gameCredits : new Map(Object.entries(admin.gameCredits))
        ) : {}
      },
      recentGames: recentGames
    });
  } catch (error) {
    console.error('Error fetching admin analytics:', error);
    res.status(500).json({ error: 'Error fetching admin analytics' });
  }
});

/**
 * Get wallet transaction history for current user (Player or Admin)
 * GET /api/admin-management/wallet-history
 */
router.get('/wallet-history', adminAuth, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const transactions = await WalletTransaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('performedBy', 'username')
      .lean();

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching wallet history:', error);
    res.status(500).json({ error: 'Error fetching wallet history' });
  }
});

/**
 * Get wallet transaction history for a specific player (Admin only)
 * GET /api/admin-management/players/:playerId/wallet-history
 */
router.get('/players/:playerId/wallet-history', adminAuth, async (req, res) => {
  try {
    const { playerId } = req.params;
    const { limit = 50 } = req.query;

    const player = await User.findById(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const transactions = await WalletTransaction.find({ user: playerId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('performedBy', 'username')
      .lean();

    res.json({
      player: {
        _id: player._id,
        username: player.username,
        currentWallet: player.wallet
      },
      transactions: transactions
    });
  } catch (error) {
    console.error('Error fetching player wallet history:', error);
    res.status(500).json({ error: 'Error fetching player wallet history' });
  }
});

module.exports = { router, setSocketIO };
