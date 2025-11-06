const mongoose = require('mongoose');
const { Schema } = mongoose;

const walletTransactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'admin_add',        // Admin added money
      'admin_subtract',   // Admin subtracted money
      'admin_set',        // Admin set balance
      'game_join',        // Player joined game (entry fee deducted)
      'game_win',         // Player won game (prize added)
      'game_profit'       // Admin received profit from game
    ],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  balanceBefore: {
    type: Number,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  gameId: {
    type: String,
    index: true
  },
  description: {
    type: String,
    required: true
  },
  performedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Index for faster queries
walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ gameId: 1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
