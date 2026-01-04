const db = require('../config/database');

class UserService {
  async createOrUpdateUser(googleProfile) {
    return new Promise((resolve, reject) => {
      const { id, emails, displayName, photos } = googleProfile;
      const email = emails && emails[0] ? emails[0].value : null;
      const picture = photos && photos[0] ? photos[0].value : null;

      db.run(
        `INSERT INTO users (google_id, email, name, picture) 
         VALUES (?, ?, ?, ?)
         ON CONFLICT(google_id) 
         DO UPDATE SET email = ?, name = ?, picture = ?`,
        [id, email, displayName, picture, email, displayName, picture],
        function(err) {
          if (err) {
            reject(err);
          } else {
            db.get('SELECT * FROM users WHERE google_id = ?', [id], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          }
        }
      );
    });
  }

  async getUserById(userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getUserByGoogleId(googleId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE google_id = ?', [googleId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getUserProgress(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT up.*, a.title, a.title_english, a.episodes, a.image_url, a.season, a.year, a.airing
         FROM user_progress up
         JOIN anime a ON up.anime_id = a.id
         WHERE up.user_id = ?
         ORDER BY up.updated_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  async updateProgress(userId, animeId, episodesWatched, status = 'watching') {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO user_progress (user_id, anime_id, episodes_watched, status, last_watched, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, anime_id)
         DO UPDATE SET episodes_watched = ?, status = ?, last_watched = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
        [userId, animeId, episodesWatched, status, episodesWatched, status],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async markSession(userId, animeId, marked = true) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE user_progress 
         SET session_marked = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND anime_id = ?`,
        [marked ? 1 : 0, userId, animeId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getCompletionStats(userId, season = null, year = null) {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT 
          COUNT(*) as total_tracking,
          SUM(CASE WHEN up.status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN up.status = 'watching' THEN 1 ELSE 0 END) as watching,
          SUM(up.episodes_watched) as total_episodes_watched
        FROM user_progress up
        JOIN anime a ON up.anime_id = a.id
        WHERE up.user_id = ?
      `;
      const params = [userId];

      if (season) {
        query += ' AND a.season = ?';
        params.push(season);
      }

      if (year) {
        query += ' AND a.year = ?';
        params.push(year);
      }

      db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
}

module.exports = new UserService();
