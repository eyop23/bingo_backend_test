require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function createAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ username: 'admin' });
    if (existingAdmin) {
      console.log('ℹ️  Admin user already exists');
      console.log('📋 Admin credentials:');
      console.log('   Username: admin');
      console.log('   Password: (use your existing password)');
      process.exit(0);
    }

    // Create admin user
    const admin = new User({
      username: 'admin',
      password: 'admin123',  // This will be hashed automatically
      isAdmin: true
    });

    await admin.save();
    console.log('✅ Admin user created successfully!');
    console.log('\n📋 Admin credentials:');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('\n⚠️  Please change the password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();
