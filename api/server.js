const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'timetable-jwt-secret-change-me-2026';
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || 'vero@example.com').toLowerCase().trim();
const PORT = process.env.PORT || 3000;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is required in .env file');
  process.exit(1);
}

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return cachedDb;
  }
  try {
    console.log('🔄 Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    await client.connect();
    const db = client.db('classroom_timetable');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('timetables').createIndex({ type: 1 }, { unique: true });
    cachedClient = client;
    cachedDb = db;
    console.log('✅ Connected to MongoDB successfully');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    throw error;
  }
}

async function initializeRepUser(db) {
  try {
    const usersCollection = db.collection('users');
    const existingUser = await usersCollection.findOne({ email: ALLOWED_EMAIL });
    if (!existingUser) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('denver123', salt);
      await usersCollection.insertOne({
        email: ALLOWED_EMAIL,
        password: passwordHash,
        role: 'rep',
        name: 'REP',
        createdAt: new Date().toISOString()
      });
      console.log('✅ Created rep user:', ALLOWED_EMAIL);
      console.log('   Default password: denver123');
    } else {
      console.log('✅ Rep user already exists:', ALLOWED_EMAIL);
    }
  } catch (error) {
    console.error('❌ User initialization error:', error);
  }
}

let initialized = false;
app.use(async (req, res, next) => {
  if (!initialized) {
    try {
      const db = await connectToDatabase();
      await initializeRepUser(db);
      initialized = true;
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }
  next();
});

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.email !== ALLOWED_EMAIL) {
      return res.status(403).json({ error: 'Access denied' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const userEmail = email.toLowerCase().trim();
    if (userEmail !== ALLOWED_EMAIL) {
      return res.status(403).json({ error: 'Only the class rep can login' });
    }
    const db = await connectToDatabase();
    const user = await db.collection('users').findOne({ email: userEmail });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Change password
app.put('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const db = await connectToDatabase();
    const user = await db.collection('users').findOne({ email: ALLOWED_EMAIL });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);
    await db.collection('users').updateOne(
      { email: ALLOWED_EMAIL },
      { $set: { password: newHash, updatedAt: new Date().toISOString() } }
    );
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get timetable (PUBLIC)
app.get('/api/timetable', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const timetable = await db.collection('timetables').findOne({ type: 'current' });
    if (!timetable) {
      return res.json({
        type: 'current',
        schedule: {
          monday: [],
          tuesday: [
            { course: 'Entrepreneurship Principles and Practice', time: '08:00 - 11:00', venue: 'Virtual Zoom', code: 'CDU 402' },
            { course: 'Introduction to Programming', time: '15:00 - 19:00', venue: 'TC 2-3-3 / Virtual Lab', code: 'STU 501' }
          ],
          wednesday: [
            { course: 'System Analysis and Design', time: '08:00 - 11:00', venue: 'Virtual Zoom', code: 'STU 502' }
          ],
          thursday: [
            { course: 'Data Structure and Algorithm', time: '07:00 - 11:00', venue: 'TC 2-3-3', code: 'STU 602' },
            { course: 'Data Structure and Algorithm', time: '11:00 - 15:00', venue: 'TC 2-3-3', code: 'STU 602' },
            { course: 'Data Structure and Algorithm', time: '16:00 - 19:00', venue: 'TC 2-3-3', code: 'STU 602' }
          ],
          friday: [
            { course: 'Fundamentals of Computer Networks', time: '12:00 - 16:00', venue: 'TC 3-1 / TC 3-8', code: 'CSN 501' },
            { course: 'Introduction to Programming', time: '07:00 - 11:00', venue: 'TC 2-3-3', code: 'STU 501' },
            { course: 'Introduction to Programming', time: '15:00 - 19:00', venue: 'TC 2-3-3 / Virtual Lab', code: 'STU 501' }
          ]
        },
        lastModifiedBy: 'System',
        lastModifiedAt: new Date().toISOString()
      });
    }
    res.json(timetable);
  } catch (error) {
    console.error('Get timetable error:', error);
    res.status(500).json({ error: 'Failed to load timetable' });
  }
});

// Update timetable (REP ONLY)
app.put('/api/timetable', requireAuth, async (req, res) => {
  try {
    const { schedule } = req.body;
    if (!schedule) {
      return res.status(400).json({ error: 'Schedule required' });
    }
    const db = await connectToDatabase();
    const now = new Date().toISOString();
    await db.collection('timetables').updateOne(
      { type: 'current' },
      { $set: { schedule, lastModifiedBy: req.user.name || req.user.email, lastModifiedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    res.json({ message: 'Timetable updated', lastModifiedAt: now });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Delete lesson (REP ONLY)
app.delete('/api/timetable/lesson', requireAuth, async (req, res) => {
  try {
    const { day, courseIndex } = req.body;
    if (!day || courseIndex === undefined) {
      return res.status(400).json({ error: 'Day and index required' });
    }
    const db = await connectToDatabase();
    const timetable = await db.collection('timetables').findOne({ type: 'current' });
    if (!timetable?.schedule?.[day]?.[courseIndex]) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    timetable.schedule[day].splice(courseIndex, 1);
    await db.collection('timetables').updateOne(
      { type: 'current' },
      { $set: { schedule: timetable.schedule, lastModifiedBy: req.user.name, lastModifiedAt: new Date().toISOString() } }
    );
    res.json({ message: 'Lesson deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const db = await connectToDatabase();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', database: 'connected', allowedEmail: ALLOWED_EMAIL });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ============================================
// START SERVER FOR LOCAL DEVELOPMENT
// ============================================
// Only listen on a port when running locally (not on Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📅 Timetable API: http://localhost:${PORT}/api/timetable`);
    console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
    console.log(`👤 Allowed email: ${ALLOWED_EMAIL}`);
    console.log(`🔑 Default password: denver123`);
    console.log(`\n✨ Open index.html in your browser to see the app!\n`);
  });
}

// Export for Vercel
module.exports = app;