const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'timetable-jwt-secret-2026';
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || 'bnd.developerz@gmail.com').toLowerCase().trim();

// MongoDB connection caching for Vercel serverless
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    try {
      await cachedDb.command({ ping: 1 });
      return cachedDb;
    } catch (error) {
      cachedClient = null;
      cachedDb = null;
    }
  }

  try {
    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 5000,
    });

    await client.connect();
    const db = client.db('classroom_timetable');
    
    cachedClient = client;
    cachedDb = db;
    
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

// Initialize rep user
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
        name: 'Vero',
        createdAt: new Date().toISOString()
      });
      console.log('Created rep user:', ALLOWED_EMAIL);
    }
  } catch (error) {
    console.error('User init error:', error);
  }
}

// Auth middleware
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

// Routes
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

app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

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
      { 
        $set: { 
          schedule, 
          lastModifiedBy: req.user.name || req.user.email, 
          lastModifiedAt: now 
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );
    
    res.json({ message: 'Timetable updated', lastModifiedAt: now });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update' });
  }
});

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
      { 
        $set: { 
          schedule: timetable.schedule, 
          lastModifiedBy: req.user.name, 
          lastModifiedAt: new Date().toISOString() 
        } 
      }
    );
    
    res.json({ message: 'Lesson deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const db = await connectToDatabase();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', database: 'connected', allowedEmail: ALLOWED_EMAIL });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// Initialize on first request
let initialized = false;
app.use(async (req, res, next) => {
  if (!initialized) {
    try {
      const db = await connectToDatabase();
      await initializeRepUser(db);
      initialized = true;
    } catch (error) {
      console.error('Init error:', error);
    }
  }
  next();
});

module.exports = app;