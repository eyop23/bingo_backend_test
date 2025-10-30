require('dotenv').config();
const mongoose = require('mongoose');
const BingoGameSession = require('./models/BingoGameSession');
const Counter = require('./models/Counter');
const User = require('./models/User');

async function createSampleGame() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find admin user
    const admin = await User.findOne({ isAdmin: true });
    if (!admin) {
      console.log('❌ No admin user found. Please create an admin first.');
      process.exit(1);
    }

    // Get next game ID
    const gameIdNum = await Counter.getNextSequence('bingoGameId');
    const gameId = `BG${gameIdNum}`;

    // Create sample game
    const game = new BingoGameSession({
      gameId,
      maxPlayers: 10,
      winningPattern: 'any-line',
      autoCallInterval: 3000,
      status: 'preparing',
      players: [],
      bingoCards: [],
      calledNumbers: [],
      winners: [],
      createdBy: admin._id
    });

    await game.save();

    console.log('✅ Sample BINGO game created successfully!');
    console.log('\n📋 Game Details:');
    console.log('   Game ID: ' + gameId);
    console.log('   Max Players: 10');
    console.log('   Winning Pattern: Any Line');
    console.log('   Auto-call Speed: 3 seconds');
    console.log('   Status: Preparing');
    console.log('\n💡 Next steps:');
    console.log('   1. Login as admin');
    console.log('   2. Go to Number BINGO Admin');
    console.log('   3. Click "Open for Players" on game ' + gameId);
    console.log('   4. Players can join and get their cards!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating game:', error);
    process.exit(1);
  }
}

createSampleGame();
