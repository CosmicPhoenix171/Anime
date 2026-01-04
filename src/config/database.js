const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../data/anime.db');

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
    // Anime table
    db.run(`
      CREATE TABLE IF NOT EXISTS anime (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mal_id INTEGER UNIQUE,
        title TEXT NOT NULL,
        title_english TEXT,
        season TEXT,
        year INTEGER,
        episodes INTEGER,
        status TEXT,
        airing BOOLEAN,
        image_url TEXT,
        synopsis TEXT,
        dub_available BOOLEAN DEFAULT 0,
        dub_platform TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT,
        name TEXT,
        picture TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User watch progress table
    db.run(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        anime_id INTEGER NOT NULL,
        episodes_watched INTEGER DEFAULT 0,
        status TEXT DEFAULT 'watching',
        session_marked BOOLEAN DEFAULT 0,
        last_watched DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (anime_id) REFERENCES anime(id),
        UNIQUE(user_id, anime_id)
      )
    `);

    // Episodes table
    db.run(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anime_id INTEGER NOT NULL,
        episode_number INTEGER NOT NULL,
        title TEXT,
        aired_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (anime_id) REFERENCES anime(id),
        UNIQUE(anime_id, episode_number)
      )
    `);

    console.log('Database tables initialized.');
  });
}

module.exports = db;
