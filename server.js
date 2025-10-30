require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// Import Letter Bingo routes and set Socket.io
const { router: letterBingoRouter, setSocketIO: setLetterBingoIO } = require('./routes/letterBingo');
setLetterBingoIO(io);

// Import Number Bingo routes and set Socket.io
const { router: bingoRouter, setSocketIO: setBingoIO } = require('./routes/bingo');
setBingoIO(io);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/games', require('./routes/games'));
app.use('/api/letter-bingo', letterBingoRouter);
app.use('/api/bingo', bingoRouter);
app.use('/api/admin-management', require('./routes/adminManagement'));

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Join a specific game room
  socket.on('joinGameRoom', (gameId) => {
    socket.join(`game-${gameId}`);
    console.log(`Socket ${socket.id} joined room: game-${gameId}`);
  });
  
  // Leave a game room
  socket.on('leaveGameRoom', (gameId) => {
    socket.leave(`game-${gameId}`);
    console.log(`Socket ${socket.id} left room: game-${gameId}`);
  });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 2022;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at ${PORT}`);
});
