const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Create new user
    const user = new User({
      username,
      password,
      isAdmin: false
    });
    await user.save();

    // Generate token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

    // Convert gameCredits Map to plain object
    const gameCredits = user.gameCredits ? Object.fromEntries(user.gameCredits) : {};

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin || false,
        isSuperAdmin: user.isSuperAdmin || false,
        credits: user.credits || 0,
        gameCredits: gameCredits,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error creating user' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    // console.log(req.body)
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

    // Convert gameCredits Map to plain object
    const gameCredits = user.gameCredits ? Object.fromEntries(user.gameCredits) : {};

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin,
        isSuperAdmin: user.isSuperAdmin || false,
        credits: user.credits || 0,
        gameCredits: gameCredits,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error logging in' });
  }
});

// Get all users (admin only)
router.get('/users', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const users = await User.find({}, 'username isAdmin createdAt')
      .sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

module.exports = router;
