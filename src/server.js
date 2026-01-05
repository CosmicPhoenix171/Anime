const express = require('express');
const session = require('express-session');
const passport = require('./config/passport');
const config = require('./config/config');
const cron = require('node-cron');
const path = require('path');
const cors = require('cors');

// Initialize database
require('./config/database');

const animeService = require('./services/animeService');
const anilistService = require('./services/anilistService');

// Routes
const authRoutes = require('./routes/auth');
const animeRoutes = require('./routes/anime');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Session configuration
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// API Routes
app.use('/auth', authRoutes);
app.use('/api/anime', animeRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Views directory
const viewsDir = path.join(__dirname, '../views');

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: viewsDir });
});

app.get('/dashboard', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile('dashboard.html', { root: viewsDir });
  } else {
    res.redirect('/');
  }
});

// Additional pages
app.get('/anime/:id', (req, res) => {
  res.sendFile('anime-detail.html', { root: viewsDir });
});

app.get('/dub-radar', (req, res) => {
  res.sendFile('dub-radar.html', { root: viewsDir });
});

app.get('/recently-finished', (req, res) => {
  res.sendFile('recently-finished.html', { root: viewsDir });
});

app.get('/my-list', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile('my-list.html', { root: viewsDir });
  } else {
    res.redirect('/');
  }
});

app.get('/my-season', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile('my-season.html', { root: viewsDir });
  } else {
    res.redirect('/');
  }
});

app.get('/admin', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile('admin.html', { root: viewsDir });
  } else {
    res.redirect('/');
  }
});

// ==========================================
// SCHEDULED JOBS
// ==========================================

// Daily Update Job - Runs at 2 AM every day
// Updates episode counts, airing status, detects finished shows
cron.schedule('0 2 * * *', async () => {
  console.log('\n⏰ Running scheduled Daily Update Job...');
  try {
    await animeService.dailyUpdateJob();
  } catch (err) {
    console.error('Scheduled daily update error:', err);
  }
});

// Season Sync Job - Runs at midnight on season starts
// Jan 1 (Winter), Apr 1 (Spring), Jul 1 (Summer), Oct 1 (Fall)
cron.schedule('0 0 1 1,4,7,10 *', async () => {
  console.log('\n🌱 Running scheduled Season Sync Job (Season Start)...');
  try {
    await animeService.seasonSyncJob();
  } catch (err) {
    console.error('Scheduled season sync error:', err);
  }
});

// Weekly Season Sync - Runs every Sunday at 3 AM
// Catches late additions to the season
cron.schedule('0 3 * * 0', async () => {
  console.log('\n🌱 Running scheduled Weekly Season Sync...');
  try {
    await animeService.seasonSyncJob();
  } catch (err) {
    console.error('Weekly season sync error:', err);
  }
});

// Initial sync on startup (with delay to let DB initialize)
setTimeout(async () => {
  console.log('\n🚀 Running initial anime database sync...');
  try {
    const stats = await animeService.getAnimeStats();
    if (stats.total === 0) {
      console.log('Database is empty. Running full season sync...');
      await animeService.seasonSyncJob();
    } else {
      console.log(`Database has ${stats.total} anime. Running daily update...`);
      await animeService.dailyUpdateJob();
    }
  } catch (err) {
    console.error('Initial sync error:', err);
  }
}, 5000);

// Helper endpoint to get current season info
app.get('/api/season-info', (req, res) => {
  res.json({
    currentSeason: anilistService.getCurrentSeason(),
    currentYear: anilistService.getCurrentYear(),
    nextSeason: anilistService.getNextSeason()
  });
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`\n🎌 Anime Tracker Server running on http://localhost:${PORT}`);
  console.log(`📅 Current Season: ${anilistService.getCurrentSeason()} ${anilistService.getCurrentYear()}`);
});
