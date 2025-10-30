const express = require('express');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const BingoGameSession = require('../models/BingoGameSession');
const Counter = require('../models/Counter');

// Socket.io instance will be set from server.js
let io;

const setSocketIO = (socketIO) => {
  io = socketIO;
};

// Store intervals for auto-calling numbers
const autoCallIntervals = new Map();

// ============= ADMIN ENDPOINTS =============

/**
 * Create new BINGO game (admin only)
 * POST /api/bingo/create
 */
router.post('/create', adminAuth, async (req, res) => {
  try {
    const { maxPlayers, winningPattern, autoCallInterval, markingMode, gameCost, profitPercentage, playerEntryFee } = req.body;

    // Validate inputs
    if (!maxPlayers || maxPlayers < 2 || maxPlayers > 50) {
      return res.status(400).json({ error: 'maxPlayers must be between 2 and 50' });
    }

    const validPatterns = ['any-line', 'horizontal', 'vertical', 'diagonal', 'four-corners', 'full-house'];
    if (winningPattern && !validPatterns.includes(winningPattern)) {
      return res.status(400).json({ error: 'Invalid winning pattern' });
    }

    const validMarkingModes = ['auto', 'manual'];
    if (markingMode && !validMarkingModes.includes(markingMode)) {
      return res.status(400).json({ error: 'Invalid marking mode' });
    }

    // Get game cost from admin's gameCredits configuration (set by superadmin)
    const configuredGameCost = req.user.gameCredits?.get('number-bingo');
    const finalGameCost = configuredGameCost !== undefined ? configuredGameCost : (gameCost || 2);
    const finalProfitPercentage = profitPercentage !== undefined ? profitPercentage : 10;
    const finalPlayerEntryFee = playerEntryFee !== undefined ? playerEntryFee : 10;

    // Check if admin has enough credits (skip for super admin)
    if (!req.user.isSuperAdmin) {
      if (req.user.credits < finalGameCost) {
        return res.status(403).json({
          error: `Insufficient credits. You need ${finalGameCost} credits to create this game. Current balance: ${req.user.credits}`
        });
      }

      // Deduct credits
      req.user.credits -= finalGameCost;
      await req.user.save();
    }

    // Get the next game ID
    const gameIdNum = await Counter.getNextSequence('bingoGameId');
    const gameId = `BG${gameIdNum}`;

    const game = new BingoGameSession({
      gameId,
      maxPlayers,
      winningPattern: winningPattern || 'any-line',
      autoCallInterval: autoCallInterval || 3000,
      markingMode: markingMode || 'auto',
      gameCost: finalGameCost,
      profitPercentage: finalProfitPercentage,
      playerEntryFee: finalPlayerEntryFee,
      status: 'preparing',
      players: [],
      bingoCards: [],
      calledNumbers: [],
      winners: [],
      createdBy: req.user._id
    });

    await game.save();

    res.status(201).json({
      message: 'BINGO game created successfully',
      game: {
        _id: game._id,
        gameId: game.gameId,
        maxPlayers: game.maxPlayers,
        winningPattern: game.winningPattern,
        autoCallInterval: game.autoCallInterval,
        markingMode: game.markingMode,
        gameCost: game.gameCost,
        profitPercentage: game.profitPercentage,
        playerEntryFee: game.playerEntryFee,
        status: game.status
      },
      creditsRemaining: req.user.credits
    });
  } catch (error) {
    console.error('Error creating BINGO game:', error);
    res.status(500).json({ error: 'Error creating game' });
  }
});

/**
 * Prepare game for players (admin only)
 * POST /api/bingo/games/:gameId/prepare
 */
router.post('/games/:gameId/prepare', adminAuth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'preparing') {
      return res.status(400).json({ error: 'Game is not in preparing state' });
    }

    game.status = 'ready';
    game.initializeAvailableCards(100);
    await game.save();

    // Notify all clients via WebSocket
    if (io) {
      io.emit('bingoGameReady', {
        gameId: game.gameId,
        maxPlayers: game.maxPlayers,
        winningPattern: game.winningPattern
      });
    }

    res.json({
      message: 'Game is now ready for players to join',
      gameId: game.gameId
    });
  } catch (error) {
    console.error('Error preparing game:', error);
    res.status(500).json({ error: 'Error preparing game' });
  }
});

/**
 * Start game (admin only)
 * POST /api/bingo/games/:gameId/start
 */
router.post('/games/:gameId/start', adminAuth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not ready to start' });
    }

    // if (game.players.length < 2) {
    //   return res.status(400).json({ error: 'At least 2 players must join' });
    // }
    if (game.players.length < game.maxPlayers) {
      return res.status(400).json({
        error: `Game must be full to start. ${game.players.length}/${game.maxPlayers} players joined.`
      });
    }

    // Check that all players have selected their cards
    const playersWithCards = game.bingoCards.map(card => card.player.toString());
    const playersWithoutCards = game.players.filter(
      playerId => !playersWithCards.includes(playerId.toString())
    );

    if (playersWithoutCards.length > 0) {
      return res.status(400).json({
        error: `Cannot start: ${playersWithoutCards.length} player(s) have not selected their card yet. All players must select a card before starting.`
      });
    }

    // Start the game
    game.status = 'active';
    game.startedAt = new Date();
    await game.save();

    // Start auto-calling numbers
    startAutoCallNumbers(game.gameId, game.autoCallInterval);

    // Notify all clients
    if (io) {
      io.to(`game-${game.gameId}`).emit('bingoGameStarted', {
        gameId: game.gameId,
        autoCallInterval: game.autoCallInterval,
        startedAt: game.startedAt
      });
    }

    res.json({
      message: 'Game started successfully',
      gameId: game.gameId
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Error starting game' });
  }
});

/**
 * Pause game (admin only)
 * POST /api/bingo/games/:gameId/pause
 */
router.post('/games/:gameId/pause', adminAuth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'active') {
      return res.status(400).json({ error: 'Game is not active' });
    }

    // Pause the game
    game.status = 'paused';
    await game.save();

    // Stop auto-calling
    stopAutoCallNumbers(game.gameId);

    // Notify all clients
    if (io) {
      io.to(`game-${game.gameId}`).emit('bingoGamePaused', {
        gameId: game.gameId
      });
    }

    res.json({
      message: 'Game paused successfully',
      gameId: game.gameId
    });
  } catch (error) {
    console.error('Error pausing game:', error);
    res.status(500).json({ error: 'Error pausing game' });
  }
});

/**
 * Resume game (admin only)
 * POST /api/bingo/games/:gameId/resume
 */
router.post('/games/:gameId/resume', adminAuth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'paused') {
      return res.status(400).json({ error: 'Game is not paused' });
    }

    // Resume the game
    game.status = 'active';
    await game.save();

    // Restart auto-calling
    startAutoCallNumbers(game.gameId, game.autoCallInterval);

    // Notify all clients
    if (io) {
      io.to(`game-${game.gameId}`).emit('bingoGameResumed', {
        gameId: game.gameId
      });
    }

    res.json({
      message: 'Game resumed successfully',
      gameId: game.gameId
    });
  } catch (error) {
    console.error('Error resuming game:', error);
    res.status(500).json({ error: 'Error resuming game' });
  }
});

/**
 * Manually call next number (admin only)
 * POST /api/bingo/games/:gameId/call-number
 */
router.post('/games/:gameId/call-number', adminAuth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId })
      .populate('winners.player', 'username');

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'active' && game.status !== 'paused') {
      return res.status(400).json({ error: 'Game must be active or paused' });
    }

    // Call a number
    const calledNumber = game.callNumber();

    if (!calledNumber) {
      return res.status(400).json({ error: 'All numbers have been called' });
    }

    // Check for winners
    const newWinners = game.checkForWinners();

    if (newWinners.length > 0) {
      newWinners.forEach(winner => game.winners.push(winner));
      game.status = 'completed';
      game.completedAt = new Date();

      // Stop auto-calling
      stopAutoCallNumbers(game.gameId);
    }

    await game.save();

    // Notify all clients
    if (io) {
      io.to(`game-${game.gameId}`).emit('bingoNumberCalled', {
        gameId: game.gameId,
        number: calledNumber,
        totalCalled: game.calledNumbers.length,
        currentNumber: game.currentNumber
      });

      // If there are winners, notify
      if (newWinners.length > 0) {
        const populatedGame = await BingoGameSession.findOne({ gameId: game.gameId })
          .populate('winners.player', 'username');

          io.to(`game-${game.gameId}`).emit('bingoWinner', {
            gameId: game.gameId,
            winners: populatedGame.winners.map(w => {
              return {
                player: {
                  _id: w.player._id,
                  username: w.player.username
                },
                cardNumber: w.cardNumber,
                pattern: w.pattern,
                completedAt: w.completedAt,
                winningCard: w.winningCard,
                markedCells: w.markedCells
              };
            })
          });
      }
    }

    res.json({
      message: 'Number called successfully',
      number: calledNumber,
      totalCalled: game.calledNumbers.length,
      hasWinner: newWinners.length > 0,
      winners: newWinners
    });
  } catch (error) {
    console.error('Error calling number:', error);
    res.status(500).json({ error: 'Error calling number' });
  }
});

/**
 * Stop/complete game (admin only)
 * POST /api/bingo/games/:gameId/stop
 */
router.post('/games/:gameId/stop', adminAuth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Stop the game
    stopAutoCallNumbers(game.gameId);
    game.status = 'completed';
    game.completedAt = new Date();
    await game.save();

    // Notify all clients
    if (io) {
      io.to(`game-${game.gameId}`).emit('bingoGameStopped', {
        gameId: game.gameId
      });
    }

    res.json({
      message: 'Game stopped successfully',
      gameId: game.gameId
    });
  } catch (error) {
    console.error('Error stopping game:', error);
    res.status(500).json({ error: 'Error stopping game' });
  }
});

// ============= PLAYER ENDPOINTS =============

/**
 * Get all available BINGO games
 * GET /api/bingo/games
 */
router.get('/games', auth, async (req, res) => {
  try {
    const games = await BingoGameSession.find()
      .populate('players', 'username')
      .populate('createdBy', 'username')
      .populate('winners.player', 'username')
      .sort({ createdAt: -1 });

    const gamesData = games.map(game => ({
      _id: game._id,
      gameId: game.gameId,
      maxPlayers: game.maxPlayers,
      currentPlayers: game.players.length,
      status: game.status,
      winningPattern: game.winningPattern,
      autoCallInterval: game.autoCallInterval,
      createdBy: game.createdBy.username,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      calledNumbersCount: game.calledNumbers.length,
      hasWinner: game.winners.length > 0,
      createdAt: game.createdAt,
      players: game.players.map(p => ({
        _id: p._id,
        username: p.username
      })),
      bingoCards: game.bingoCards || []
    }));

    res.json(gamesData);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Error fetching games' });
  }
});

/**
 * Get specific game details
 * GET /api/bingo/games/:gameId
 */
router.get('/games/:gameId', auth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId })
      .populate('players', 'username')
      .populate('winners.player', 'username');

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Get player-specific view
    const playerState = game.getPlayerGameState(req.user._id);

    res.json({
      ...playerState,
      availableCards: game.availableCards || [],  // ← ADD THIS LINE
      players: game.players.map(p => ({
        _id: p._id,
        username: p.username
      })),
      allPlayersCount: game.bingoCards.length,
      winners: game.winners.map(w => ({
        player: {
          _id: w.player._id,
          username: w.player.username
        },
        cardNumber: w.cardNumber,
        pattern: w.pattern,
        completedAt: w.completedAt
      }))
    });
  } catch (error) {
    console.error('Error fetching game details:', error);
    res.status(500).json({ error: 'Error fetching game details' });
  }
});

/**
 * Join game
 * POST /api/bingo/games/:gameId/join
 */
router.post('/games/:gameId/join', auth, async (req, res) => {
  try {
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not ready to join' });
    }

    if (game.players.length >= game.maxPlayers) {
      return res.status(400).json({ error: 'Game is full' });
    }

    if (game.players.some(player => player.equals(req.user._id))) {
      return res.status(400).json({ error: 'Already joined this game' });
    }

    // Add player to game (but don't generate card yet)
    game.players.push(req.user._id);
    await game.save();

    // Notify all clients
    if (io) {
      const eventData = {
        gameId: game.gameId,
        playerId: req.user._id,
        playerName: req.user.username,
        totalPlayers: game.players.length,
        maxPlayers: game.maxPlayers
      };
      io.to(`game-${game.gameId}`).emit('playerJoinedBingo', eventData);
      // Also broadcast globally for admin dashboards
      io.emit('playerJoinedBingo', eventData);
    }

    res.json({
      message: 'Successfully joined game',
      gameId: game.gameId,
      playerId: req.user._id,
      availableCards: game.availableCards
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Error joining game' });
  }
});
router.post('/games/:gameId/select-card', auth, async (req, res) => {
  try {
    const { cardNumber } = req.body;
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not ready' });
    }

    if (!game.players.some(player => player.equals(req.user._id))) {
      return res.status(400).json({ error: 'You have not joined this game' });
    }

    // Check if player already has a card
    const existingCard = game.getPlayerCard(req.user._id);
    if (existingCard) {
      return res.status(400).json({ error: 'You already have a card' });
    }

    // Validate card number
    if (!cardNumber || typeof cardNumber !== 'number') {
      return res.status(400).json({ error: 'Invalid card number' });
    }

    // Check if card is available
    if (!game.isCardAvailable(cardNumber)) {
      return res.status(400).json({
        error: 'Card not available',
        availableCards: game.availableCards
      });
    }

    // Generate and assign card
    game.addPlayerCard(req.user._id, cardNumber);
    await game.save();

    // Get the player's card
    const playerCard = game.getPlayerCard(req.user._id);

    // Notify all clients that card was selected
    if (io) {
      const eventData = {
        gameId: game.gameId,
        playerId: req.user._id,
        playerName: req.user.username,
        cardNumber: cardNumber,
        availableCards: game.availableCards
      };
      io.to(`game-${game.gameId}`).emit('cardSelected', eventData);
      // Also broadcast globally for admin dashboards
      io.emit('cardSelected', eventData);
    }

    res.json({
      message: 'Card selected successfully',
      gameId: game.gameId,
      cardNumber: cardNumber,
      card: {
        grid: playerCard.grid,
        marked: playerCard.marked
      }
    });
  } catch (error) {
    console.error('Error selecting card:', error);
    res.status(500).json({ error: 'Error selecting card' });
  }
});

/**
 * Mark a number on player's card (for manual mode)
 * POST /api/bingo/games/:gameId/mark-number
 */
router.post('/games/:gameId/mark-number', auth, async (req, res) => {
  try {
    const { number } = req.body;
    const game = await BingoGameSession.findOne({ gameId: req.params.gameId });

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.status !== 'active' && game.status !== 'paused') {
      return res.status(400).json({ error: 'Game is not active' });
    }

    if (game.markingMode !== 'manual') {
      return res.status(400).json({ error: 'Game is not in manual marking mode' });
    }

    if (!game.players.some(player => player.equals(req.user._id))) {
      return res.status(400).json({ error: 'You are not a player in this game' });
    }

    // Validate number
    if (!number || typeof number !== 'number' || number < 1 || number > 75) {
      return res.status(400).json({ error: 'Invalid number' });
    }

    // Check if number has been called
    const calledNumbersList = game.calledNumbers.map(cn => cn.number);
    if (!calledNumbersList.includes(number)) {
      return res.status(400).json({ error: 'This number has not been called yet' });
    }

    // Mark the number on player's card
    const marked = game.markNumberOnPlayerCard(req.user._id, number);

    if (!marked) {
      return res.status(400).json({ error: 'Number not found on your card' });
    }

    // Check if player has won
    const newWinners = game.checkForWinners();
    if (newWinners.length > 0) {
      newWinners.forEach(winner => game.winners.push(winner));
      game.status = 'completed';
      game.completedAt = new Date();
    }

    await game.save();

    // Get updated player card
    const playerCard = game.getPlayerCard(req.user._id);

    // Notify via socket if there's a winner
    if (newWinners.length > 0 && io) {
      const populatedGame = await BingoGameSession.findOne({ gameId: game.gameId })
        .populate('winners.player', 'username');

      io.to(`game-${game.gameId}`).emit('bingoWinner', {
        gameId: game.gameId,
        winners: populatedGame.winners.map(w => {
          return {
            player: {
              _id: w.player._id,
              username: w.player.username
            },
            cardNumber: w.cardNumber,
            pattern: w.pattern,
            completedAt: w.completedAt,
            winningCard: w.winningCard,
            markedCells: w.markedCells
          };
        })
      });
    }

    res.json({
      message: 'Number marked successfully',
      number: number,
      marked: playerCard.marked,
      hasWon: newWinners.some(w => w.player.equals(req.user._id))
    });
  } catch (error) {
    console.error('Error marking number:', error);
    res.status(500).json({ error: 'Error marking number' });
  }
});

/**
 * Get user's game history
 * GET /api/bingo/history
 */
router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Find games where user participated
    const games = await BingoGameSession.find({
      players: userId,
      status: 'completed'
    })
      .populate('winners.player', 'username')
      .sort({ completedAt: -1 })
      .limit(50);

    // const history = games.map(game => ({
    //   gameId: game.gameId,
    //   completedAt: game.completedAt,
    //   winningPattern: game.winningPattern,
    //   totalPlayers: game.players.length,
    //   calledNumbers: game.calledNumbers.length,
    //   winners: game.winners.map(w => ({
    //     player: w.player.username,
    //     pattern: w.pattern
    //   })),
    //   userWon: game.winners.some(w => w.player._id.equals(userId))
    // }));
    const history = games.map(game => {
      const userCard = game.bingoCards.find(card => card.player.equals(userId));
      return {
        gameId: game.gameId,
        completedAt: game.completedAt,
        winningPattern: game.winningPattern,
        totalPlayers: game.players.length,
        calledNumbers: game.calledNumbers.length,
        calledNumbersList: game.calledNumbers,
        winners: game.winners.map(w => {
          const winnerCard = game.bingoCards.find(c => c.player.equals(w.player._id));
          return {
            player: w.player.username,
            pattern: w.pattern,
            cardNumber: winnerCard ? winnerCard.cardNumber : null,
            winningCard: w.winningCard,
            markedCells: w.markedCells
          };
        }),
        userWon: game.winners.some(w => w.player._id.equals(userId)),
        userCard: userCard ? {
          cardNumber: userCard.cardNumber,
          grid: userCard.grid,
          marked: userCard.marked
        } : null
      };
    });

    res.json(history);
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ error: 'Error fetching game history' });
  }
});

// ============= AUTO-CALL MECHANISM =============

/**
 * Starts automatic number calling for a game
 */
async function startAutoCallNumbers(gameId, interval) {
  // Clear any existing interval
  stopAutoCallNumbers(gameId);

  const intervalId = setInterval(async () => {
    try {
      const game = await BingoGameSession.findOne({ gameId })
        .populate('winners.player', 'username');

      if (!game || game.status !== 'active') {
        stopAutoCallNumbers(gameId);
        return;
      }

      // Call a number
      const calledNumber = game.callNumber();

      if (!calledNumber) {
        // No more numbers to call
        game.status = 'completed';
        game.completedAt = new Date();
        await game.save();
        stopAutoCallNumbers(gameId);

        if (io) {
          io.to(`game-${gameId}`).emit('bingoGameCompleted', {
            gameId: game.gameId,
            reason: 'All numbers called'
          });
        }
        return;
      }

      // Check for winners
      const newWinners = game.checkForWinners();

      if (newWinners.length > 0) {
        newWinners.forEach(winner => game.winners.push(winner));
        game.status = 'completed';
        game.completedAt = new Date();
        stopAutoCallNumbers(gameId);
      }

      await game.save();

      // Notify all clients about the called number
      if (io) {
        io.to(`game-${gameId}`).emit('bingoNumberCalled', {
          gameId: game.gameId,
          number: calledNumber,
          totalCalled: game.calledNumbers.length,
          currentNumber: game.currentNumber
        });

        // If there are winners, notify
        if (newWinners.length > 0) {
          const populatedGame = await BingoGameSession.findOne({ gameId })
            .populate('winners.player', 'username');

            io.to(`game-${gameId}`).emit('bingoWinner', {
              gameId: game.gameId,
              winners: populatedGame.winners.map(w => {
                return {
                  player: {
                    _id: w.player._id,
                    username: w.player.username
                  },
                  cardNumber: w.cardNumber,
                  pattern: w.pattern,
                  completedAt: w.completedAt,
                  winningCard: w.winningCard,
                  markedCells: w.markedCells
                };
              })
            });
        }
      }
    } catch (error) {
      console.error('Error in auto-call:', error);
      stopAutoCallNumbers(gameId);
    }
  }, interval);

  autoCallIntervals.set(gameId, intervalId);
  console.log(`Auto-call started for game ${gameId} with interval ${interval}ms`);
}

/**
 * Stops automatic number calling for a game
 */
function stopAutoCallNumbers(gameId) {
  if (autoCallIntervals.has(gameId)) {
    clearInterval(autoCallIntervals.get(gameId));
    autoCallIntervals.delete(gameId);
    console.log(`Auto-call stopped for game ${gameId}`);
  }
}

module.exports = { router, setSocketIO };
   