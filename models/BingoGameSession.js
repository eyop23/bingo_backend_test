const mongoose = require('mongoose');
const crypto = require('crypto');
const { generateDeterministicBingoCard } = require('../utils/gridGenerator');
const { Schema } = mongoose;

// Schema for individual BINGO card
const bingoCardSchema = new Schema({
  player: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cardNumber: {
    type: Number,
    required: true
  },
  // 5x5 grid: columns represent B-I-N-G-O
  // [0] = B column (1-15), [1] = I (16-30), [2] = N (31-45), [3] = G (46-60), [4] = O (61-75)
  grid: {
    type: [[Number]],
    required: true,
    validate: {
      validator: function(grid) {
        return grid.length === 5 && grid.every(col => col.length === 5);
      },
      message: 'Grid must be 5x5'
    }
  },
  // Tracks which numbers have been marked (same structure as grid)
  marked: {
    type: [[Boolean]],
    required: true,
    default: function() {
      // Center space (column 2, row 2) is FREE and always marked
      const marked = Array(5).fill(null).map(() => Array(5).fill(false));
      marked[2][2] = true; // FREE space
      return marked;
    }
  },
  
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

// Schema for called numbers history
const calledNumberSchema = new Schema({
  number: {
    type: Number,
    required: true,
    min: 1,
    max: 75
  },
  calledAt: {
    type: Date,
    default: Date.now
  }
});

// Schema for winners
const winnerSchema = new Schema({
  player: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cardNumber: {
    type: Number,
    required: true
  },
  pattern: {
    type: String,
    enum: ['horizontal', 'vertical', 'diagonal', 'four-corners', 'full-house'],
    required: true
  },
  completedAt: {
    type: Date,
    default: Date.now
  },
  winningCard: {
    type: [[Number]],
    required: true
  },
  markedCells: {
    type: [[Boolean]],
    required: true
  }
});

// Main BINGO Game Session Schema
const bingoGameSessionSchema = new Schema({
  gameId: {
    type: String,
    unique: true,
    required: true
  },
  gameType: {
    type: String,
    default: 'numberBingo',
    immutable: true
  },
  maxPlayers: {
    type: Number,
    required: true,
    min: 2,
    max: 50,
    default: 10
  },
  status: {
    type: String,
    enum: ['preparing', 'ready', 'active', 'paused', 'completed'],
    default: 'preparing'
  },
  winningPattern: {
    type: String,
    enum: ['any-line', 'horizontal', 'vertical', 'diagonal', 'four-corners', 'full-house'],
    default: 'any-line',
    required: true
  },
  autoCallInterval: {
    type: Number,
    default: 3000, // milliseconds between number calls
    min: 1000,
    max: 10000
  },
  markingMode: {
    type: String,
    enum: ['auto', 'manual'],
    default: 'auto',
    required: true
  },
  gameCost: {
    type: Number,
    default: 2,
    min: 1,
    required: true
  },
  profitPercentage: {
    type: Number,
    default: 10,
    min: 0,
    max: 100,
    required: true
  },
  playerEntryFee: {
    type: Number,
    default: 10,
    min: 0
  },
  players: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  bingoCards: [bingoCardSchema],
  calledNumbers: [calledNumberSchema],
  availableCards: [{
    type: Number
  }],
  // Map of card assignments {cardNumber: playerId}
  cardAssignments: {
    type: Map,
    of: Schema.Types.ObjectId,
    default: new Map()
  },
  currentNumber: {
    type: Number,
    min: 1,
    max: 75
  },
  winners: [winnerSchema],
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

// ============= BINGO CARD GENERATION =============

/**
 * Generates a random BINGO card following the rules:
 * - Column B: numbers 1-15
 * - Column I: numbers 16-30
 * - Column N: numbers 31-45 (center is FREE = 0)
 * - Column G: numbers 46-60
 * - Column O: numbers 61-75
 */
// bingoGameSessionSchema.methods.generateBingoCard = function() {
//   const columnRanges = [
//     [1, 15],    // B
//     [16, 30],   // I
//     [31, 45],   // N
//     [46, 60],   // G
//     [61, 75]    // O
//   ];

//   const grid = [];

//   for (let col = 0; col < 5; col++) {
//     const [min, max] = columnRanges[col];
//     const numbers = [];

//     // Generate available numbers for this column
//     const availableNumbers = [];
//     for (let i = min; i <= max; i++) {
//       availableNumbers.push(i);
//     }

//     // Pick 5 random unique numbers for this column
//     for (let row = 0; row < 5; row++) {
//       // Special case: center of N column is FREE
//       if (col === 2 && row === 2) {
//         numbers.push(0); // 0 represents FREE space
//       } else {
//         const randomIndex = crypto.randomInt(0, availableNumbers.length);
//         const selectedNumber = availableNumbers[randomIndex];
//         numbers.push(selectedNumber);
//         availableNumbers.splice(randomIndex, 1);
//       }
//     }

//     grid.push(numbers);
//   }

//   return grid;
// };
/**
 * Generates a deterministic BINGO card for a given card number
 */
bingoGameSessionSchema.methods.generateBingoCard = function(cardNumber) {
  return generateDeterministicBingoCard(cardNumber);
};

bingoGameSessionSchema.methods.addPlayerCard = function(playerId, cardNumber) {
  const grid = this.generateBingoCard(cardNumber);
  const marked = Array(5).fill(null).map(() => Array(5).fill(false));
  marked[2][2] = true; // FREE space always marked

  this.bingoCards.push({
    player: playerId,
    cardNumber: cardNumber,
    grid: grid,
    marked: marked
  });

  // Mark card as taken
  this.availableCards = this.availableCards.filter(c => c !== cardNumber);
  this.cardAssignments.set(cardNumber.toString(), playerId);
};
bingoGameSessionSchema.methods.initializeAvailableCards = function(totalCards = 100) {
  this.availableCards = [];
  for (let i = 1; i <= totalCards; i++) {
    this.availableCards.push(i);
  }
};
bingoGameSessionSchema.methods.isCardAvailable = function(cardNumber) {
  return this.availableCards.includes(cardNumber);
};
// ============= NUMBER CALLING LOGIC =============

/**
 * Calls a random number from 1-75 that hasn't been called yet
 * Returns the called number or null if all numbers have been called
 */
bingoGameSessionSchema.methods.callNumber = function() {
  const calledNumbersList = this.calledNumbers.map(cn => cn.number);

  // Get remaining numbers
  const remainingNumbers = [];
  for (let i = 1; i <= 75; i++) {
    if (!calledNumbersList.includes(i)) {
      remainingNumbers.push(i);
    }
  }

  if (remainingNumbers.length === 0) {
    return null; // All numbers called
  }

  // Pick a random number from remaining
  const randomIndex = crypto.randomInt(0, remainingNumbers.length);
  const calledNumber = remainingNumbers[randomIndex];

  // Add to called numbers
  this.calledNumbers.push({
    number: calledNumber,
    calledAt: new Date()
  });

  this.currentNumber = calledNumber;

  // Mark the number on all cards only if markingMode is 'auto'
  if (this.markingMode === 'auto') {
    this.markNumberOnAllCards(calledNumber);
  }

  return calledNumber;
};

/**
 * Marks a called number on all player cards that contain it
 */
bingoGameSessionSchema.methods.markNumberOnAllCards = function(number) {
  this.bingoCards.forEach(card => {
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 5; row++) {
        if (card.grid[col][row] === number) {
          card.marked[col][row] = true;
        }
      }
    }
  });
};

/**
 * Marks a specific number on a specific player's card (for manual mode)
 * Returns true if the number was found and marked, false otherwise
 */
bingoGameSessionSchema.methods.markNumberOnPlayerCard = function(playerId, number) {
  const playerCard = this.getPlayerCard(playerId);
  if (!playerCard) {
    return false;
  }

  let marked = false;
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      if (playerCard.grid[col][row] === number) {
        playerCard.marked[col][row] = true;
        marked = true;
      }
    }
  }
  return marked;
};

// ============= WINNING PATTERN DETECTION =============

/**
 * Checks if a card has a horizontal line (any row)
 */
function hasHorizontalLine(marked) {
  for (let row = 0; row < 5; row++) {
    let complete = true;
    for (let col = 0; col < 5; col++) {
      if (!marked[col][row]) {
        complete = false;
        break;
      }
    }
    if (complete) return true;
  }
  return false;
}

/**
 * Checks if a card has a vertical line (any column)
 */
function hasVerticalLine(marked) {
  for (let col = 0; col < 5; col++) {
    let complete = true;
    for (let row = 0; row < 5; row++) {
      if (!marked[col][row]) {
        complete = false;
        break;
      }
    }
    if (complete) return true;
  }
  return false;
}

/**
 * Checks if a card has a diagonal line
 */
function hasDiagonalLine(marked) {
  // Diagonal 1: top-left to bottom-right
  let diagonal1 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[i][i]) {
      diagonal1 = false;
      break;
    }
  }
  if (diagonal1) return true;

  // Diagonal 2: top-right to bottom-left
  let diagonal2 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[4 - i][i]) {
      diagonal2 = false;
      break;
    }
  }
  return diagonal2;
}

/**
 * Checks if a card has all four corners marked
 */
function hasFourCorners(marked) {
  return marked[0][0] && marked[4][0] && marked[0][4] && marked[4][4];
}

/**
 * Checks if a card has full house (all spaces marked)
 */
function hasFullHouse(marked) {
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      if (!marked[col][row]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks all cards for winning patterns based on game's winning pattern setting
 * Returns array of winners
 */
bingoGameSessionSchema.methods.checkForWinners = function() {
  const newWinners = [];
  const existingWinnerIds = this.winners.map(w => w.player.toString());

  this.bingoCards.forEach(card => {
    // Skip if player already won
    if (existingWinnerIds.includes(card.player.toString())) {
      return;
    }

    let isWinner = false;
    let pattern = null;

    const marked = card.marked;

    // Check based on game's winning pattern
    switch (this.winningPattern) {
      case 'any-line':
        if (hasHorizontalLine(marked)) {
          isWinner = true;
          pattern = 'horizontal';
        } else if (hasVerticalLine(marked)) {
          isWinner = true;
          pattern = 'vertical';
        } else if (hasDiagonalLine(marked)) {
          isWinner = true;
          pattern = 'diagonal';
        }
        break;

      case 'horizontal':
        if (hasHorizontalLine(marked)) {
          isWinner = true;
          pattern = 'horizontal';
        }
        break;

      case 'vertical':
        if (hasVerticalLine(marked)) {
          isWinner = true;
          pattern = 'vertical';
        }
        break;

      case 'diagonal':
        if (hasDiagonalLine(marked)) {
          isWinner = true;
          pattern = 'diagonal';
        }
        break;

      case 'four-corners':
        if (hasFourCorners(marked)) {
          isWinner = true;
          pattern = 'four-corners';
        }
        break;

      case 'full-house':
        if (hasFullHouse(marked)) {
          isWinner = true;
          pattern = 'full-house';
        }
        break;
    }

    if (isWinner) {
      newWinners.push({
        player: card.player,
        cardNumber: card.cardNumber,
        pattern: pattern,
        completedAt: new Date(),
        winningCard: card.grid,
        markedCells: card.marked
      });
    }
  });

  return newWinners;
};

// ============= HELPER METHODS =============

/**
 * Gets player's card from the game
 */
bingoGameSessionSchema.methods.getPlayerCard = function(playerId) {
  return this.bingoCards.find(card => card.player.equals(playerId));
};
bingoGameSessionSchema.methods.getCardByNumber = function(cardNumber) {
  return this.bingoCards.find(card => card.cardNumber === cardNumber);
};

/**
 * Gets game state for a specific player
 */
bingoGameSessionSchema.methods.getPlayerGameState = function(playerId) {
  const playerCard = this.getPlayerCard(playerId);

  return {
    gameId: this.gameId,
    status: this.status,
    winningPattern: this.winningPattern,
    maxPlayers: this.maxPlayers,
    currentPlayers: this.players.length,
    myCard: playerCard ? {
      cardNumber: playerCard.cardNumber,
      grid: playerCard.grid,
      marked: playerCard.marked
    } : null,
    calledNumbers: this.calledNumbers.map(cn => cn.number),
    currentNumber: this.currentNumber,
    autoCallInterval: this.autoCallInterval,
    markingMode: this.markingMode,
    playerEntryFee: this.playerEntryFee,
    profitPercentage: this.profitPercentage,
    gameCost: this.gameCost,
    winners: this.winners,
    startedAt: this.startedAt,
    completedAt: this.completedAt
  };
};

// Indexes for performance
bingoGameSessionSchema.index({ gameId: 1 });
bingoGameSessionSchema.index({ status: 1 });
bingoGameSessionSchema.index({ 'bingoCards.player': 1 });

module.exports = mongoose.model('BingoGameSession', bingoGameSessionSchema);
