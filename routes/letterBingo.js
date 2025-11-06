const express = require('express');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const LetterBingoGameSession = require('../models/LetterBingoGameSession');
const Counter = require('../models/Counter');

// Socket.io instance will be set from server.js
let io;

const setSocketIO = (socketIO) => {
  io = socketIO;
};

// Create new Letter Bingo game (admin only)
router.post('/create', adminAuth, async (req, res) => {
  try {
    const { maxPlayers, wordLength, drawSpeed } = req.body;
    
    // Validate inputs
    if (!maxPlayers || maxPlayers < 2 || maxPlayers > 50) {
      return res.status(400).json({ error: 'maxPlayers must be between 2 and 50' });
    }
    
    if (!wordLength || wordLength < 3 || wordLength > 7) {
      return res.status(400).json({ error: 'wordLength must be between 3 and 7' });
    }
    
    // Get the next game ID
    const gameId = await Counter.getNextSequence('letterBingoGameId');
    
    const game = new LetterBingoGameSession({
      maxPlayers,
      wordLength,
      drawSpeed: drawSpeed || 3000,
      status: 'preparing',
      players: [],
      playerWords: [],
      gameId: `LB${gameId}`,
      createdBy: req.user._id
    });
    
    await game.save();
    
    res.status(201).json({
      message: 'Letter Bingo game created successfully',
      game: {
        _id: game._id,
        gameId: game.gameId,
        maxPlayers: game.maxPlayers,
        wordLength: game.wordLength,
        drawSpeed: game.drawSpeed,
        status: game.status
      }
    });
  } catch (error) {
    console.error('Error creating Letter Bingo game:', error);
    res.status(500).json({ error: 'Error creating game' });
  }
});

// Get all Letter Bingo games
router.get('/games', auth, async (req, res) => {
  try {
    // Admins can only see games they created, unless they are super admin
    const query = req.user.isSuperAdmin ? {} : { createdBy: req.user._id };

    const games = await LetterBingoGameSession.find(query)
      .populate('players', 'username')
      .populate('createdBy', 'username')
      .populate('winners', 'username')
      .populate('winningWords.player', 'username')
      .sort({ createdAt: -1 });
    
    res.json(games);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Error fetching games' });
  }
});

// Get user's Letter Bingo game history
router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find games where user participated
    const games = await LetterBingoGameSession.find({
      players: userId,
      status: 'completed'
    })
    .populate('winners', 'username')
    .populate('winningWords.player', 'username')
    .sort({ completedAt: -1 })
    .limit(50);
    
    // Format the response
    const history = games.map(game => ({
      gameId: game.gameId,
      completedAt: game.completedAt,
      wordLength: game.wordLength,
      totalPlayers: game.players.length,
      winners: game.winners.map(w => w.username),
      winningWords: game.winningWords.map(ww => ({
        player: ww.player?.username || 'Unknown',
        word: ww.word
      })),
      userWon: game.winners.some(w => w._id.equals(userId)),
      userWord: game.playerWords.find(pw => pw.player.equals(userId))?.word || ''
    }));
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ error: 'Error fetching game history' });
  }
});

// Get specific game details
router.get('/games/:gameId', auth, async (req, res) => {
  try {
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId })
      .populate('players', 'username')
      .populate('playerWords.player', 'username')
      .populate('winners', 'username');
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    // Get player-specific view
    const playerState = game.getPlayerGameState(req.user._id);
    
    res.json({
      ...playerState,
      players: game.players,
      allPlayerWords: game.playerWords.map(pw => ({
        player: pw.player.username,
        wordLength: pw.word.length,
        matchedCount: pw.matchedLetters.length,
        isWinner: pw.isWinner
      }))
    });
  } catch (error) {
    console.error('Error fetching game details:', error);
    res.status(500).json({ error: 'Error fetching game details' });
  }
});

// Prepare game for players (admin only)
router.post('/games/:gameId/prepare', adminAuth, async (req, res) => {
  try {
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.status !== 'preparing') {
      return res.status(400).json({ error: 'Game is not in preparing state' });
    }
    
    game.status = 'ready';
    await game.save();
    
    // Notify all clients via WebSocket
    if (io) {
      io.emit('letterBingoGameReady', { gameId: game.gameId });
    }
    
    res.json({ message: 'Game is now ready for players', gameId: game.gameId });
  } catch (error) {
    console.error('Error preparing game:', error);
    res.status(500).json({ error: 'Error preparing game' });
  }
});

// Join game
router.post('/games/:gameId/join', auth, async (req, res) => {
  try {
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId });
    
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
    
    game.players.push(req.user._id);
    await game.save();
    
    // Notify all clients
    if (io) {
      io.emit('playerJoinedLetterBingo', {
        gameId: game.gameId,
        playerId: req.user._id,
        playerName: req.user.username,
        totalPlayers: game.players.length
      });
    }
    
    res.json({ 
      message: 'Successfully joined game',
      gameId: game.gameId,
      wordLength: game.wordLength
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Error joining game' });
  }
});

// Submit word
router.post('/games/:gameId/submit-word', auth, async (req, res) => {
  try {
    const { word } = req.body;
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (!game.players.some(player => player.equals(req.user._id))) {
      return res.status(400).json({ error: 'You are not in this game' });
    }
    
    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not in ready state' });
    }
    
    // Validate word length
    if (!word || word.length !== game.wordLength) {
      return res.status(400).json({ 
        error: `Word must be exactly ${game.wordLength} characters` 
      });
    }
    
    const upperWord = word.toUpperCase();
    
    // Validate only letters
    if (!/^[A-Z]+$/.test(upperWord)) {
      return res.status(400).json({ error: 'Word must contain only letters' });
    }
    
    // Check for unique characters
    const chars = upperWord.split('');
    const uniqueChars = new Set(chars);
    if (chars.length !== uniqueChars.size) {
      return res.status(400).json({ error: 'Word must have all unique characters' });
    }
    
    // Check if word is already taken
    if (!game.isWordAvailable(upperWord, req.user._id)) {
      return res.status(400).json({ error: 'This word is already taken' });
    }
    
    // Remove any existing word for this player
    game.playerWords = game.playerWords.filter(pw => !pw.player.equals(req.user._id));
    
    // Add the new word
    game.playerWords.push({
      player: req.user._id,
      word: upperWord,
      matchedLetters: []
    });
    
    await game.save();
    
    // Notify all clients
    if (io) {
      io.emit('wordSubmitted', {
        gameId: game.gameId,
        playerId: req.user._id,
        playerName: req.user.username,
        totalSubmitted: game.playerWords.length,
        totalPlayers: game.players.length
      });
    }
    
    res.json({ 
      message: 'Word submitted successfully',
      word: upperWord
    });
  } catch (error) {
    console.error('Error submitting word:', error);
    res.status(500).json({ error: 'Error submitting word' });
  }
});

// Check word availability
router.post('/games/:gameId/check-word', auth, async (req, res) => {
  try {
    const { word } = req.body;
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const upperWord = word.toUpperCase();
    const isAvailable = game.isWordAvailable(upperWord, req.user._id);
    
    res.json({ available: isAvailable });
  } catch (error) {
    console.error('Error checking word:', error);
    res.status(500).json({ error: 'Error checking word availability' });
  }
});

// Start game (admin only)
router.post('/games/:gameId/start', adminAuth, async (req, res) => {
  try {
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not ready to start' });
    }
    
    if (game.playerWords.length < 2) {
      return res.status(400).json({ error: 'At least 2 players must submit words' });
    }
    
    // Initialize the game
    game.initializeLetters();
    game.status = 'playing';
    game.startedAt = new Date();
    await game.save();
    
    // Start the automatic letter drawing
    startLetterDrawing(game.gameId, game.drawSpeed);
    
    // Notify all clients
    if (io) {
      io.emit('letterBingoGameStarted', {
        gameId: game.gameId,
        drawSpeed: game.drawSpeed
      });
    }
    
    res.json({ message: 'Game started successfully' });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Error starting game' });
  }
});

// Function to handle automatic letter drawing
const letterDrawIntervals = new Map();

async function startLetterDrawing(gameId, drawSpeed) {
  // Clear any existing interval for this game
  if (letterDrawIntervals.has(gameId)) {
    clearInterval(letterDrawIntervals.get(gameId));
  }
  
  const interval = setInterval(async () => {
    try {
      const game = await LetterBingoGameSession.findOne({ gameId })
        .populate('winners', 'username');
      
      if (!game || game.status !== 'playing') {
        clearInterval(interval);
        letterDrawIntervals.delete(gameId);
        return;
      }
      
      // Draw a letter
      const drawnLetter = game.drawLetter();
      
      if (!drawnLetter) {
        // No more letters to draw
        game.status = 'completed';
        await game.save();
        clearInterval(interval);
        letterDrawIntervals.delete(gameId);
        
        if (io) {
          io.emit('letterBingoGameCompleted', {
            gameId: game.gameId,
            winners: game.winners,
            reason: 'All letters drawn'
          });
        }
        return;
      }
      
      await game.save();
      
      // Notify all clients about the drawn letter
      if (io) {
        io.emit('letterDrawn', {
          gameId: game.gameId,
          letter: drawnLetter,
          drawnLetters: game.drawnLetters.map(dl => dl.letter),
          remainingCount: game.remainingLetters.length
        });
        
        // Check if there are winners
        if (game.status === 'completed') {
          clearInterval(interval);
          letterDrawIntervals.delete(gameId);
          
          const populatedGame = await LetterBingoGameSession.findOne({ gameId })
            .populate('winners', 'username')
            .populate('playerWords.player', 'username');
          
          io.emit('letterBingoWinner', {
            gameId: game.gameId,
            winners: populatedGame.winners.map(w => ({
              _id: w._id,
              username: w.username
            })),
            winningWords: populatedGame.playerWords
              .filter(pw => pw.isWinner)
              .map(pw => ({
                player: pw.player.username,
                word: pw.word
              }))
          });
        }
      }
    } catch (error) {
      console.error('Error in letter drawing:', error);
    }
  }, drawSpeed);
  
  letterDrawIntervals.set(gameId, interval);
}

// Stop game (admin only)
router.post('/games/:gameId/stop', adminAuth, async (req, res) => {
  try {
    const game = await LetterBingoGameSession.findOne({ gameId: req.params.gameId });
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    // Stop the drawing interval
    if (letterDrawIntervals.has(game.gameId)) {
      clearInterval(letterDrawIntervals.get(game.gameId));
      letterDrawIntervals.delete(game.gameId);
    }
    
    game.status = 'completed';
    game.completedAt = new Date();
    await game.save();
    
    // Notify all clients
    if (io) {
      io.emit('letterBingoGameStopped', {
        gameId: game.gameId
      });
    }
    
    res.json({ message: 'Game stopped successfully' });
  } catch (error) {
    console.error('Error stopping game:', error);
    res.status(500).json({ error: 'Error stopping game' });
  }
});

module.exports = { router, setSocketIO };