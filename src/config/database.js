const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'anime.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // ==========================================
    // ANIME TABLE - Core seasonal & episode info
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS anime (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anilist_id INTEGER UNIQUE,
        mal_id INTEGER,
        title TEXT NOT NULL,
        title_english TEXT,
        title_romaji TEXT,
        season TEXT,
        year INTEGER,
        total_episodes INTEGER,
        episodes_aired INTEGER DEFAULT 0,
        status TEXT DEFAULT 'NOT_AIRED',
        format TEXT,
        source TEXT,
        genres TEXT,
        studios TEXT,
        next_episode_date DATETIME,
        next_episode_number INTEGER,
        last_air_date DATETIME,
        start_date DATE,
        end_date DATE,
        poster_url TEXT,
        banner_url TEXT,
        cover_color TEXT,
        synopsis TEXT,
        average_score INTEGER,
        popularity INTEGER,
        trending INTEGER,
        is_adult BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for faster queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_anime_season_year ON anime(season, year)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_anime_status ON anime(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_anime_anilist ON anime(anilist_id)`);

    // ==========================================
    // DUB TABLE - Track dub info (admin controlled)
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS dubs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anime_id INTEGER NOT NULL,
        language TEXT DEFAULT 'EN',
        platform TEXT,
        dub_status TEXT DEFAULT 'NONE',
        episodes_dubbed INTEGER DEFAULT 0,
        dub_start_date DATE,
        dub_end_date DATE,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
        UNIQUE(anime_id, language, platform)
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_dubs_status ON dubs(dub_status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dubs_platform ON dubs(platform)`);

    // ==========================================
    // USERS TABLE
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT,
        name TEXT,
        picture TEXT,
        is_admin BOOLEAN DEFAULT 0,
        dub_preference_mode BOOLEAN DEFAULT 0,
        notify_dub_complete BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==========================================
    // USER PROGRESS TABLE - User specific tracking
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        anime_id INTEGER NOT NULL,
        last_episode INTEGER DEFAULT 0,
        user_status TEXT DEFAULT 'PLANNED',
        rating INTEGER,
        notes TEXT,
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
        UNIQUE(user_id, anime_id)
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_progress_status ON user_progress(user_status)`);

    // ==========================================
    // SESSION LOGS TABLE - Optional session history
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        anime_id INTEGER NOT NULL,
        from_episode INTEGER NOT NULL,
        to_episode INTEGER NOT NULL,
        session_date DATE DEFAULT (date('now')),
        duration_minutes INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON session_logs(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_date ON session_logs(session_date)`);

    // ==========================================
    // SYNC LOG TABLE - Track automation runs
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        anime_added INTEGER DEFAULT 0,
        anime_updated INTEGER DEFAULT 0,
        errors TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )
    `);

    // ==========================================
    // NOTIFICATIONS TABLE - User notifications
    // ==========================================
    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        anime_id INTEGER,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE SET NULL
      )
    `);

    console.log('Database tables initialized.');
  });
}

// Helper function to promisify db.all
db.allAsync = function(sql, params = []) {
  return new Promise((resolve, reject) => {
    this.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Helper function to promisify db.get
db.getAsync = function(sql, params = []) {
  return new Promise((resolve, reject) => {
    this.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Helper function to promisify db.run
db.runAsync = function(sql, params = []) {
  return new Promise((resolve, reject) => {
    this.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

module.exports = db;
