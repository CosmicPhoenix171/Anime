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

// Routes
const authRoutes = require('./routes/auth');
const animeRoutes = require('./routes/anime');
const userRoutes = require('./routes/user');

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

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

app.get('/dashboard', (req, res) => {
  if (req.isAuthenticated()) {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
  } else {
    res.redirect('/');
  }
});

// Schedule daily updates
cron.schedule(config.updateSchedule, () => {
  console.log('Running scheduled anime database update...');
  animeService.updateAnimeDatabase().catch(err => 
    console.error('Scheduled update error:', err)
  );
});

// Initial update on startup (optional)
setTimeout(() => {
  console.log('Running initial anime database update...');
  animeService.updateAnimeDatabase().catch(err => 
    console.error('Initial update error:', err)
  );
}, 5000);

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
