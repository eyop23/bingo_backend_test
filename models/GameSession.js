const mongoose = require('mongoose');
const { Schema } = mongoose;

const numberSchema = new Schema({
  number: {
    type: Number,
    required: true,
    min: 1,
  },
  selectedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  selectedAt: {
    type: Date,
  },
});

const gameSessionSchema = new Schema({
  maxPlayers: {
    type: Number,
    required: true,
    min: 2,
    max: 100,
  },
  status: {
    type: String,
    enum: ['preparing', 'ready', 'completed'],
    default: 'preparing',
  },
  players: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  numbers: [numberSchema],
  winningNumber: {
    type: Number,
  },
  winner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  gameId:{type: String},
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

gameSessionSchema.index({ 'numbers.number': 1 }, { unique: true, sparse: true });

gameSessionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

gameSessionSchema.methods.getAvailableNumbers = function() {
  const selectedNumbers = this.numbers.map(n => n.number);
  return Array.from({ length: this.maxPlayers }, (_, i) => i + 1)
    .filter(n => !selectedNumbers.includes(n));
};

module.exports = mongoose.model('GameSession', gameSessionSchema);