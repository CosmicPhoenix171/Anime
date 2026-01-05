const db = require('../config/database');
const anilistService = require('./anilistService');

class UserService {
  // ==========================================
  // USER MANAGEMENT
  // ==========================================
  
  async createOrUpdateUser(googleProfile) {
    const { id, emails, displayName, photos } = googleProfile;
    const email = emails && emails[0] ? emails[0].value : null;
    const picture = photos && photos[0] ? photos[0].value : null;

    await db.runAsync(
      `INSERT INTO users (google_id, email, name, picture) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(google_id) 
       DO UPDATE SET email = ?, name = ?, picture = ?, updated_at = CURRENT_TIMESTAMP`,
      [id, email, displayName, picture, email, displayName, picture]
    );

    return db.getAsync('SELECT * FROM users WHERE google_id = ?', [id]);
  }

  async getUserById(userId) {
    return db.getAsync('SELECT * FROM users WHERE id = ?', [userId]);
  }

  async getUserByGoogleId(googleId) {
    return db.getAsync('SELECT * FROM users WHERE google_id = ?', [googleId]);
  }

  async updateUserPreferences(userId, preferences) {
    const { dubPreferenceMode, notifyDubComplete } = preferences;
    return db.runAsync(
      `UPDATE users SET 
        dub_preference_mode = ?, 
        notify_dub_complete = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [dubPreferenceMode ? 1 : 0, notifyDubComplete ? 1 : 0, userId]
    );
  }

  // ==========================================
  // WATCH PROGRESS
  // ==========================================

  async getUserProgress(userId, filters = {}) {
    let query = `
      SELECT up.*, 
        a.title, a.title_english, a.total_episodes, a.episodes_aired,
        a.poster_url, a.season, a.year, a.status as anime_status,
        a.next_episode_date, a.genres,
        (a.episodes_aired - up.last_episode) as episodes_behind,
        (SELECT GROUP_CONCAT(d.platform || ':' || d.dub_status, ',')
         FROM dubs d WHERE d.anime_id = a.id) as dub_info
      FROM user_progress up
      JOIN anime a ON up.anime_id = a.id
      WHERE up.user_id = ?
    `;
    const params = [userId];

    if (filters.userStatus) {
      query += ' AND up.user_status = ?';
      params.push(filters.userStatus.toUpperCase());
    }

    if (filters.season) {
      query += ' AND a.season = ?';
      params.push(filters.season.toUpperCase());
    }

    if (filters.year) {
      query += ' AND a.year = ?';
      params.push(filters.year);
    }

    if (filters.hasDub) {
      query += ` AND EXISTS (
        SELECT 1 FROM dubs d WHERE d.anime_id = a.id 
        AND d.dub_status IN ('ONGOING', 'FINISHED')
      )`;
    }

    // Sorting
    const sortMap = {
      'updated': 'up.updated_at DESC',
      'title': 'a.title ASC',
      'behind': 'episodes_behind DESC',
      'progress': 'CAST(up.last_episode AS FLOAT) / NULLIF(a.total_episodes, 0) DESC'
    };
    query += ` ORDER BY ${sortMap[filters.sort] || 'up.updated_at DESC'}`;

    return db.allAsync(query, params);
  }

  async getProgressByAnime(userId, animeId) {
    return db.getAsync(
      `SELECT up.*, a.title, a.total_episodes, a.episodes_aired
       FROM user_progress up
       JOIN anime a ON up.anime_id = a.id
       WHERE up.user_id = ? AND up.anime_id = ?`,
      [userId, animeId]
    );
  }

  async updateProgress(userId, animeId, lastEpisode, status = null) {
    // Get current progress
    const current = await this.getProgressByAnime(userId, animeId);
    const previousEpisode = current?.last_episode || 0;
    
    // Auto-detect status changes
    let newStatus = status;
    if (!newStatus && current) {
      newStatus = current.user_status;
    } else if (!newStatus) {
      newStatus = 'WATCHING';
    }

    // Check if anime is finished and user caught up
    const anime = await db.getAsync('SELECT total_episodes, episodes_aired FROM anime WHERE id = ?', [animeId]);
    if (anime && anime.total_episodes && lastEpisode >= anime.total_episodes) {
      newStatus = 'FINISHED';
    }

    const now = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO user_progress (user_id, anime_id, last_episode, user_status, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, anime_id)
       DO UPDATE SET 
         last_episode = ?, 
         user_status = ?,
         started_at = COALESCE(started_at, ?),
         finished_at = CASE WHEN ? = 'FINISHED' AND finished_at IS NULL THEN ? ELSE finished_at END,
         updated_at = ?`,
      [userId, animeId, lastEpisode, newStatus, now, now,
       lastEpisode, newStatus, now, newStatus, now, now]
    );

    // Log session if episodes increased
    if (lastEpisode > previousEpisode) {
      await this.logSession(userId, animeId, previousEpisode + 1, lastEpisode);
    }

    return this.getProgressByAnime(userId, animeId);
  }

  async incrementEpisode(userId, animeId) {
    const current = await this.getProgressByAnime(userId, animeId);
    const currentEpisode = current?.last_episode || 0;
    return this.updateProgress(userId, animeId, currentEpisode + 1);
  }

  async setStatus(userId, animeId, status) {
    const current = await this.getProgressByAnime(userId, animeId);
    const lastEpisode = current?.last_episode || 0;
    
    const now = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO user_progress (user_id, anime_id, last_episode, user_status, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, anime_id)
       DO UPDATE SET 
         user_status = ?,
         started_at = CASE WHEN ? = 'WATCHING' AND started_at IS NULL THEN ? ELSE started_at END,
         finished_at = CASE WHEN ? = 'FINISHED' THEN ? ELSE NULL END,
         updated_at = ?`,
      [userId, animeId, lastEpisode, status, now, now,
       status, status, now, status, now, now]
    );

    return this.getProgressByAnime(userId, animeId);
  }

  async markSeasonFinished(userId, animeId) {
    const anime = await db.getAsync('SELECT total_episodes FROM anime WHERE id = ?', [animeId]);
    if (anime?.total_episodes) {
      return this.updateProgress(userId, animeId, anime.total_episodes, 'FINISHED');
    }
    return this.setStatus(userId, animeId, 'FINISHED');
  }

  async removeFromList(userId, animeId) {
    return db.runAsync(
      'DELETE FROM user_progress WHERE user_id = ? AND anime_id = ?',
      [userId, animeId]
    );
  }

  // ==========================================
  // SESSION LOGGING
  // ==========================================

  async logSession(userId, animeId, fromEpisode, toEpisode, notes = null) {
    return db.runAsync(
      `INSERT INTO session_logs (user_id, anime_id, from_episode, to_episode, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, animeId, fromEpisode, toEpisode, notes]
    );
  }

  async getSessionHistory(userId, animeId = null, limit = 50) {
    let query = `
      SELECT sl.*, a.title, a.title_english, a.poster_url
      FROM session_logs sl
      JOIN anime a ON sl.anime_id = a.id
      WHERE sl.user_id = ?
    `;
    const params = [userId];

    if (animeId) {
      query += ' AND sl.anime_id = ?';
      params.push(animeId);
    }

    query += ' ORDER BY sl.created_at DESC LIMIT ?';
    params.push(limit);

    return db.allAsync(query, params);
  }

  async getSessionStats(userId, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const stats = await db.getAsync(`
      SELECT 
        COUNT(*) as total_sessions,
        SUM(to_episode - from_episode + 1) as total_episodes,
        COUNT(DISTINCT anime_id) as unique_anime,
        COUNT(DISTINCT session_date) as active_days
      FROM session_logs
      WHERE user_id = ? AND session_date >= ?
    `, [userId, cutoff.toISOString().split('T')[0]]);

    // Get daily breakdown
    const daily = await db.allAsync(`
      SELECT session_date, 
        SUM(to_episode - from_episode + 1) as episodes_watched,
        COUNT(DISTINCT anime_id) as anime_count
      FROM session_logs
      WHERE user_id = ? AND session_date >= ?
      GROUP BY session_date
      ORDER BY session_date DESC
    `, [userId, cutoff.toISOString().split('T')[0]]);

    return { ...stats, daily };
  }

  // ==========================================
  // SEASONAL DASHBOARD
  // ==========================================

  async getMySeasonDashboard(userId, season = null, year = null) {
    const currentSeason = season || anilistService.getCurrentSeason();
    const currentYear = year || anilistService.getCurrentYear();

    // Anime I finished this season
    const finished = await db.allAsync(`
      SELECT a.*, up.last_episode, up.finished_at
      FROM user_progress up
      JOIN anime a ON up.anime_id = a.id
      WHERE up.user_id = ? AND up.user_status = 'FINISHED'
        AND a.season = ? AND a.year = ?
      ORDER BY up.finished_at DESC
    `, [userId, currentSeason, currentYear]);

    // Anime I'm currently watching this season
    const watching = await db.allAsync(`
      SELECT a.*, up.last_episode, 
        (a.episodes_aired - up.last_episode) as episodes_behind
      FROM user_progress up
      JOIN anime a ON up.anime_id = a.id
      WHERE up.user_id = ? AND up.user_status = 'WATCHING'
        AND a.season = ? AND a.year = ?
      ORDER BY episodes_behind DESC
    `, [userId, currentSeason, currentYear]);

    // Anime I'm behind on (more than 3 episodes)
    const behindOn = watching.filter(a => a.episodes_behind >= 3);

    // Anime I haven't started yet (planned)
    const planned = await db.allAsync(`
      SELECT a.*, up.last_episode
      FROM user_progress up
      JOIN anime a ON up.anime_id = a.id
      WHERE up.user_id = ? AND up.user_status = 'PLANNED'
        AND a.season = ? AND a.year = ?
      ORDER BY a.popularity DESC
    `, [userId, currentSeason, currentYear]);

    // Stats
    const stats = await db.getAsync(`
      SELECT 
        SUM(CASE WHEN up.user_status = 'FINISHED' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN up.user_status = 'FINISHED' THEN up.last_episode ELSE 0 END) as finished_episodes,
        SUM(CASE WHEN up.user_status = 'WATCHING' THEN up.last_episode ELSE 0 END) as watching_episodes
      FROM user_progress up
      JOIN anime a ON up.anime_id = a.id
      WHERE up.user_id = ? AND a.season = ? AND a.year = ?
    `, [userId, currentSeason, currentYear]);

    return {
      season: currentSeason,
      year: currentYear,
      finished,
      watching,
      behindOn,
      planned,
      stats: {
        animeCompleted: stats?.completed_count || 0,
        totalEpisodes: (stats?.finished_episodes || 0) + (stats?.watching_episodes || 0),
        currentlyWatching: watching.length,
        plannedCount: planned.length
      }
    };
  }

  // ==========================================
  // NOTIFICATIONS
  // ==========================================

  async getNotifications(userId, unreadOnly = false) {
    let query = `
      SELECT n.*, a.title as anime_title, a.poster_url
      FROM notifications n
      LEFT JOIN anime a ON n.anime_id = a.id
      WHERE n.user_id = ?
    `;
    const params = [userId];

    if (unreadOnly) {
      query += ' AND n.is_read = 0';
    }

    query += ' ORDER BY n.created_at DESC LIMIT 50';

    return db.allAsync(query, params);
  }

  async markNotificationRead(userId, notificationId) {
    return db.runAsync(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );
  }

  async markAllNotificationsRead(userId) {
    return db.runAsync(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ?',
      [userId]
    );
  }

  async createNotification(userId, type, title, message, animeId = null) {
    return db.runAsync(
      `INSERT INTO notifications (user_id, type, title, message, anime_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, type, title, message, animeId]
    );
  }

  // ==========================================
  // COMPLETION STATS (Legacy support)
  // ==========================================

  async getCompletionStats(userId, season = null, year = null) {
    return this.getMySeasonDashboard(userId, season, year);
  }

  // ==========================================
  // ADMIN FUNCTIONS
  // ==========================================

  async isAdmin(userId) {
    const user = await db.getAsync('SELECT is_admin FROM users WHERE id = ?', [userId]);
    return user?.is_admin === 1;
  }

  async setAdmin(userId, isAdmin) {
    return db.runAsync(
      'UPDATE users SET is_admin = ? WHERE id = ?',
      [isAdmin ? 1 : 0, userId]
    );
  }
}

module.exports = new UserService();
