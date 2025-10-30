const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const GameSession = require('../models/GameSession');
const Counter = require('../models/Counter');

// Create new game (admin only)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { maxPlayers } = req.body;
    if (!maxPlayers || maxPlayers < 2 || maxPlayers > 100) {
      return res.status(400).json({ error: 'maxPlayers must be between 2 and 100' });
    }
    
    // Get the next game ID
    const gameId = await Counter.getNextSequence('gameId');
    
    const game = new GameSession({
      maxPlayers,
      status: 'preparing',
      players: [],
      numbers: [],
      gameId: gameId.toString(),
    });
    await game.save();
    res.status(201).json(game);
  } catch (error) {
    res.status(500).json({ error: 'Error creating game' });
  }
});

// Get all games
router.get('/', auth, async (req, res) => {
  try {
    const games = await GameSession.find()
      .populate('players', 'username')
      .populate('numbers.selectedBy', 'username')
      .populate('winner', 'username');
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching games' });
  }
});

// Get game details
router.get('/:gameId', auth, async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.gameId)
      .populate('players', 'username')
      .populate('numbers.selectedBy', 'username')
      .populate('winner', 'username');
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({
      _id: game._id,
      maxPlayers: game.maxPlayers,
      status: game.status,
      players: game.players,
      numbers: game.numbers.map(n => ({
        number: n.number,
        selectedBy: n.selectedBy ? n.selectedBy.username : null,
        selectedAt: n.selectedAt,
      })),
      winningNumber: game.winningNumber,
      winner: game.winner ? game.winner.username : null,
      availableNumbers: game.getAvailableNumbers(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching game details' });
  }
});

// Join game
router.post('/:gameId/join', auth, async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.gameId);
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
    res.json({ message: 'Successfully joined game', game });
  } catch (error) {
    res.status(500).json({ error: 'Error joining game' });
  }
});

// Prepare game (admin only)
router.post('/:gameId/prepare', adminAuth, async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (game.status !== 'preparing') {
      return res.status(400).json({ error: 'Game is not in preparing state' });
    }
    game.status = 'ready';
    await game.save();
    res.json({ message: 'Game is ready for players to pick numbers', game });
  } catch (error) {
    res.status(500).json({ error: 'Error preparing game' });
  }
});

// Start game (admin only)
router.post('/:gameId/start', adminAuth, async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.gameId)
      .populate('numbers.selectedBy', 'username');
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not ready' });
    }
    if (game.numbers.length !== game.maxPlayers) {
      return res.status(400).json({ error: 'Not all numbers have been picked' });
    }
    const selectedNumbers = game.numbers.map(n => n.number);
    // Ensure truly random selection using crypto.randomInt for better randomness
    const randomIndex = crypto.randomInt(0, selectedNumbers.length);
    const winningNumber = selectedNumbers[randomIndex];
    const winningNumberObj = game.numbers.find(n => n.number === winningNumber);
    game.winningNumber = winningNumber;
    game.winner = winningNumberObj.selectedBy;
    game.status = 'completed';
    await game.save();
    res.json({
      message: 'Game completed, winner determined',
      winningNumber,
      winner: winningNumberObj.selectedBy ? winningNumberObj.selectedBy.username : null,
      game,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error starting game' });
  }
});

// Pick number
router.post('/:gameId/numbers', auth, async (req, res) => {
  try {
    const game = await GameSession.findById(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (game.status !== 'ready') {
      return res.status(400).json({ error: 'Game is not ready for number selection' });
    }
    const { number } = req.body;
    if (!number || number < 1 || number > game.maxPlayers) {
      return res.status(400).json({ error: 'Invalid number' });
    }
    if (game.numbers.some(n => n.number === number)) {
      return res.status(400).json({ error: 'Number already taken' });
    }
    if (game.numbers.some(n => n.selectedBy && n.selectedBy.equals(req.user._id))) {
      return res.status(400).json({ error: 'You have already picked a number' });
    }
    game.numbers.push({
      number,
      selectedBy: req.user._id,
      selectedAt: new Date(),
    });
    await game.save();
    res.json({ message: 'Number selected successfully', game });
  } catch (error) {
    console.error('Error selecting number:', error);  
    res.status(500).json({ error: 'Error selecting number' });
  }
});

module.exports = router;