const mongoose = require('mongoose');
const { Schema } = mongoose;

const playerWordSchema = new Schema({
  player: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  word: {
    type: String,
    required: true,
    uppercase: true,
    validate: {
      validator: function(word) {
        // Check if all characters are unique
        const chars = word.split('');
        const uniqueChars = new Set(chars);
        return chars.length === uniqueChars.size && /^[A-Z]+$/.test(word);
      },
      message: 'Word must contain only unique letters'
    }
  },
  matchedLetters: [{
    type: String,
    uppercase: true
  }],
  isWinner: {
    type: Boolean,
    default: false
  },
  submittedAt: {
    type: Date,
    default: Date.now
  }
});

const letterBingoGameSessionSchema = new Schema({
  gameType: {
    type: String,
    default: 'letterBingo',
    immutable: true
  },
  maxPlayers: {
    type: Number,
    required: true,
    min: 2,
    max: 50
  },
  wordLength: {
    type: Number,
    required: true,
    min: 3,
    max: 7,
    default: 5
  },
  status: {
    type: String,
    enum: ['preparing', 'ready', 'playing', 'completed'],
    default: 'preparing'
  },
  players: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  playerWords: [playerWordSchema],
  drawnLetters: [{
    letter: {
      type: String,
      uppercase: true,
      match: /^[A-Z]$/
    },
    drawnAt: {
      type: Date,
      default: Date.now
    }
  }],
  remainingLetters: [{
    type: String,
    uppercase: true
  }],
  winners: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  winningWords: [{
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    word: String
  }],
  gameId: {
    type: String,
    unique: true
  },
  drawSpeed: {
    type: Number,
    default: 3000, // milliseconds between draws
    min: 1000,
    max: 10000
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startedAt: Date,
  completedAt: Date
}, { 
  timestamps: true 
});

// Initialize remaining letters when game starts
letterBingoGameSessionSchema.methods.initializeLetters = function() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  this.remainingLetters = alphabet;
  this.drawnLetters = [];
};

// Draw a random letter
letterBingoGameSessionSchema.methods.drawLetter = function() {
  if (this.remainingLetters.length === 0) {
    return null;
  }
  
  const randomIndex = Math.floor(Math.random() * this.remainingLetters.length);
  const drawnLetter = this.remainingLetters[randomIndex];
  
  // Remove from remaining and add to drawn
  this.remainingLetters.splice(randomIndex, 1);
  this.drawnLetters.push({
    letter: drawnLetter,
    drawnAt: new Date()
  });
  
  // Check for winners
  this.checkForWinners(drawnLetter);
  
  return drawnLetter;
};

// Check if any player has won
letterBingoGameSessionSchema.methods.checkForWinners = function(newLetter) {
  let hasWinner = false;
  
  this.playerWords.forEach(playerWord => {
    if (!playerWord.isWinner && playerWord.word.includes(newLetter)) {
      // Add to matched letters if not already there
      if (!playerWord.matchedLetters.includes(newLetter)) {
        playerWord.matchedLetters.push(newLetter);
      }
      
      // Check if all letters in word are matched
      const wordLetters = playerWord.word.split('');
      const allMatched = wordLetters.every(letter => 
        playerWord.matchedLetters.includes(letter)
      );
      
      if (allMatched) {
        playerWord.isWinner = true;
        this.winners.push(playerWord.player);
        this.winningWords.push({
          player: playerWord.player,
          word: playerWord.word
        });
        hasWinner = true;
      }
    }
  });
  
  if (hasWinner) {
    this.status = 'completed';
    this.completedAt = new Date();
  }
};

// Validate word uniqueness across all players
letterBingoGameSessionSchema.methods.isWordAvailable = function(word, playerId) {
  return !this.playerWords.some(pw => 
    pw.word === word.toUpperCase() && !pw.player.equals(playerId)
  );
};

// Get game state for a specific player
letterBingoGameSessionSchema.methods.getPlayerGameState = function(playerId) {
  const playerWord = this.playerWords.find(pw => pw.player.equals(playerId));
  
  return {
    gameId: this.gameId,
    status: this.status,
    wordLength: this.wordLength,
    myWord: playerWord ? playerWord.word : null,
    matchedLetters: playerWord ? playerWord.matchedLetters : [],
    drawnLetters: this.drawnLetters.map(dl => dl.letter),
    remainingLettersCount: this.remainingLetters.length,
    totalPlayers: this.players.length,
    maxPlayers: this.maxPlayers,
    winners: this.winners,
    isWinner: playerWord ? playerWord.isWinner : false,
    drawSpeed: this.drawSpeed
  };
};

// Index for faster queries
letterBingoGameSessionSchema.index({ gameId: 1 });
letterBingoGameSessionSchema.index({ status: 1 });
letterBingoGameSessionSchema.index({ 'playerWords.player': 1 });

module.exports = mongoose.model('LetterBingoGameSession', letterBingoGameSessionSchema);