// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const socketIO = require('socket.io'); // clearer name
const helmet = require('helmet'); // optional, recommended for production

const app = express();
const server = http.createServer(app);

// Express middleware
app.use(express.json());
app.use(cors()); // allow all origins by default; tighten in production
app.use(helmet());

// In-memory room state (simple). Consider Redis for production.
const rooms = new Map(); // Map<roomID, Set<socketId>>
const socketToRoom = new Map(); // Map<socketId, roomID>

const io = socketIO(server, {
  cors: {
    origin: '*', // tighten this in production to your client URL
    methods: ['GET', 'POST']
  },
  // pingInterval/pingTimeout can be tuned
});

io.on('connection', (socket) => {
  console.log(`socket connected: ${socket.id}`);

  socket.on('join room', (roomID) => {
    if (!roomID || typeof roomID !== 'string') {
      socket.emit('error', { message: 'Invalid room ID' });
      return;
    }

    const set = rooms.get(roomID) || new Set();

    // enforce max participants (example = 4)
    const MAX_PARTICIPANTS = 4;
    if (set.size >= MAX_PARTICIPANTS) {
      socket.emit('room full');
      return;
    }

    // Join socket.io room and update internal state
    socket.join(roomID);
    set.add(socket.id);
    rooms.set(roomID, set);
    socketToRoom.set(socket.id, roomID);

    // Send existing users (except the joining socket)
    const otherClients = Array.from(set).filter(id => id !== socket.id);
    socket.emit('all users', otherClients);
  });

  socket.on('sending signal', (payload) => {
    // payload: { userToSignal, callerID, signal }
    if (!payload || !payload.userToSignal || !payload.signal || !payload.callerID) return;
    io.to(payload.userToSignal).emit('user joined', {
      signal: payload.signal,
      callerID: payload.callerID
    });
  });

  socket.on('returning signal', (payload) => {
    // payload: { callerID, signal }
    if (!payload || !payload.callerID || !payload.signal) return;
    io.to(payload.callerID).emit('receiving returned signal', {
      signal: payload.signal,
      id: socket.id
    });
  });

  socket.on('change', (payload) => {
    const roomID = socketToRoom.get(socket.id);
    if (roomID) {
      // emit to everyone in room except sender
      socket.to(roomID).emit('change', payload);
    }
  });

  socket.on('disconnect', (reason) => {
    const roomID = socketToRoom.get(socket.id);
    if (roomID) {
      const set = rooms.get(roomID);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          rooms.delete(roomID);
        } else {
          rooms.set(roomID, set);
        }
      }
      socketToRoom.delete(socket.id);

      // notify only the room participants that someone left
      socket.to(roomID).emit('user left', socket.id);
    }

    console.log(`socket disconnected: ${socket.id} (${reason})`);
  });

  // optionally handle socket errors
  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

// Basic Express error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
