require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function createPlayer() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if player already exists
    const existingPlayer = await User.findOne({ username: 'player1' });
    if (existingPlayer) {
      console.log('ℹ️  Player user already exists');
      console.log('📋 Player credentials:');
      console.log('   Username: player1');
      console.log('   Password: (use your existing password)');
      process.exit(0);
    }

    // Create player user
    const player = new User({
      username: 'player1',
      password: 'player123',  // This will be hashed automatically
      isAdmin: false
    });

    await player.save();
    console.log('✅ Player user created successfully!');
    console.log('\n📋 Player credentials:');
    console.log('   Username: player1');
    console.log('   Password: player123');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating player:', error);
    process.exit(1);
  }
}

createPlayer();
