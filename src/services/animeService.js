const db = require('../config/database');
const anilistService = require('./anilistService');

class AnimeService {
  // ==========================================
  // SEASON SYNC JOB - Runs at season start + weekly
  // ==========================================
  async seasonSyncJob() {
    const season = anilistService.getCurrentSeason();
    const year = anilistService.getCurrentYear();
    
    console.log(`\n🌱 Starting Season Sync Job for ${season} ${year}...`);
    
    const logId = await this.startSyncLog('SEASON_SYNC');
    let added = 0;
    let updated = 0;
    const errors = [];

    try {
      const seasonalAnime = await anilistService.getAllSeasonalAnime(season, year);
      console.log(`Found ${seasonalAnime.length} anime for ${season} ${year}`);

      for (const anime of seasonalAnime) {
        try {
          const result = await this.saveAnime(anime);
          if (result.isNew) added++;
          else updated++;
        } catch (err) {
          errors.push(`${anime.title?.romaji}: ${err.message}`);
        }
      }

      // Also fetch next season's upcoming anime
      const nextSeason = anilistService.getNextSeason();
      console.log(`\nAlso fetching upcoming ${nextSeason.season} ${nextSeason.year}...`);
      
      const upcomingAnime = await anilistService.getAllSeasonalAnime(nextSeason.season, nextSeason.year);
      for (const anime of upcomingAnime) {
        try {
          const result = await this.saveAnime(anime);
          if (result.isNew) added++;
          else updated++;
        } catch (err) {
          errors.push(`${anime.title?.romaji}: ${err.message}`);
        }
      }

      await this.completeSyncLog(logId, 'SUCCESS', added, updated, errors);
      console.log(`\n✅ Season Sync Complete: ${added} added, ${updated} updated`);
      
    } catch (error) {
      await this.completeSyncLog(logId, 'ERROR', added, updated, [error.message]);
      console.error('❌ Season Sync Failed:', error.message);
      throw error;
    }

    return { added, updated, errors };
  }

  // ==========================================
  // DAILY UPDATE JOB - Runs daily
  // ==========================================
  async dailyUpdateJob() {
    console.log('\n📆 Starting Daily Update Job...');
    
    const logId = await this.startSyncLog('DAILY_UPDATE');
    let updated = 0;
    const errors = [];
    const finishedAnime = [];

    try {
      // Get all airing anime from AniList
      const airingAnime = await anilistService.getAiringAnime();
      console.log(`Checking ${airingAnime.length} airing anime for updates...`);

      // Get our database anime that are currently airing
      const ourAiringAnime = await db.allAsync(
        `SELECT id, anilist_id, episodes_aired, status FROM anime WHERE status = 'AIRING'`
      );

      const anilistMap = new Map(airingAnime.map(a => [a.id, a]));

      for (const dbAnime of ourAiringAnime) {
        try {
          const anilistData = anilistMap.get(dbAnime.anilist_id);
          
          if (anilistData) {
            // Get full details for accurate episode count
            const fullData = await anilistService.getAnimeDetails(dbAnime.anilist_id);
            const transformed = anilistService.transformAnimeData(fullData);
            
            // Check if status changed to FINISHED
            const wasFinished = dbAnime.status !== 'FINISHED' && transformed.status === 'FINISHED';
            
            await this.updateAnimeFromAniList(dbAnime.id, transformed);
            updated++;

            if (wasFinished) {
              finishedAnime.push(dbAnime.anilist_id);
            }

            await anilistService.sleep(700);
          }
        } catch (err) {
          errors.push(`ID ${dbAnime.anilist_id}: ${err.message}`);
        }
      }

      // Also check for anime that might have finished
      const possiblyFinished = await db.allAsync(
        `SELECT id, anilist_id FROM anime 
         WHERE status = 'AIRING' 
         AND total_episodes IS NOT NULL 
         AND episodes_aired >= total_episodes`
      );

      for (const anime of possiblyFinished) {
        try {
          const fullData = await anilistService.getAnimeDetails(anime.anilist_id);
          const transformed = anilistService.transformAnimeData(fullData);
          await this.updateAnimeFromAniList(anime.id, transformed);
          
          if (transformed.status === 'FINISHED') {
            finishedAnime.push(anime.anilist_id);
          }
          
          await anilistService.sleep(700);
        } catch (err) {
          errors.push(`Finish check ${anime.anilist_id}: ${err.message}`);
        }
      }

      await this.completeSyncLog(logId, 'SUCCESS', 0, updated, errors);
      console.log(`\n✅ Daily Update Complete: ${updated} updated, ${finishedAnime.length} newly finished`);
      
    } catch (error) {
      await this.completeSyncLog(logId, 'ERROR', 0, updated, [error.message]);
      console.error('❌ Daily Update Failed:', error.message);
      throw error;
    }

    return { updated, finishedAnime, errors };
  }

  // ==========================================
  // DATABASE OPERATIONS
  // ==========================================
  
  async saveAnime(anilistData) {
    const data = anilistService.transformAnimeData(anilistData);
    
    // Check if exists
    const existing = await db.getAsync(
      'SELECT id FROM anime WHERE anilist_id = ?',
      [data.anilist_id]
    );

    if (existing) {
      await this.updateAnimeFromAniList(existing.id, data);
      return { isNew: false, id: existing.id };
    }

    const result = await db.runAsync(
      `INSERT INTO anime (
        anilist_id, mal_id, title, title_english, title_romaji,
        season, year, total_episodes, episodes_aired, status,
        format, source, genres, studios, next_episode_date,
        next_episode_number, start_date, end_date, poster_url,
        banner_url, cover_color, synopsis, average_score,
        popularity, trending, is_adult
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.anilist_id, data.mal_id, data.title, data.title_english, data.title_romaji,
        data.season, data.year, data.total_episodes, data.episodes_aired, data.status,
        data.format, data.source, data.genres, data.studios, data.next_episode_date,
        data.next_episode_number, data.start_date, data.end_date, data.poster_url,
        data.banner_url, data.cover_color, data.synopsis, data.average_score,
        data.popularity, data.trending, data.is_adult
      ]
    );

    return { isNew: true, id: result.lastID };
  }

  async updateAnimeFromAniList(id, data) {
    return db.runAsync(
      `UPDATE anime SET
        title = ?, title_english = ?, title_romaji = ?,
        total_episodes = ?, episodes_aired = ?, status = ?,
        format = ?, source = ?, genres = ?, studios = ?,
        next_episode_date = ?, next_episode_number = ?,
        start_date = ?, end_date = ?, poster_url = ?,
        banner_url = ?, cover_color = ?, synopsis = ?,
        average_score = ?, popularity = ?, trending = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        data.title, data.title_english, data.title_romaji,
        data.total_episodes, data.episodes_aired, data.status,
        data.format, data.source, data.genres, data.studios,
        data.next_episode_date, data.next_episode_number,
        data.start_date, data.end_date, data.poster_url,
        data.banner_url, data.cover_color, data.synopsis,
        data.average_score, data.popularity, data.trending,
        id
      ]
    );
  }

  async startSyncLog(jobType) {
    const result = await db.runAsync(
      'INSERT INTO sync_logs (job_type, status) VALUES (?, ?)',
      [jobType, 'RUNNING']
    );
    return result.lastID;
  }

  async completeSyncLog(logId, status, added, updated, errors) {
    return db.runAsync(
      `UPDATE sync_logs SET 
        status = ?, anime_added = ?, anime_updated = ?, 
        errors = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [status, added, updated, JSON.stringify(errors), logId]
    );
  }

  // ==========================================
  // QUERY METHODS
  // ==========================================

  async getAllAnime(filters = {}) {
    let query = `
      SELECT a.*, 
        (SELECT GROUP_CONCAT(d.platform || ':' || d.dub_status, ',')
         FROM dubs d WHERE d.anime_id = a.id) as dub_info
      FROM anime a WHERE 1=1
    `;
    const params = [];

    if (filters.season) {
      query += ' AND a.season = ?';
      params.push(filters.season.toUpperCase());
    }

    if (filters.year) {
      query += ' AND a.year = ?';
      params.push(filters.year);
    }

    if (filters.status) {
      query += ' AND a.status = ?';
      params.push(filters.status.toUpperCase());
    }

    if (filters.hasDub) {
      query += ` AND EXISTS (
        SELECT 1 FROM dubs d WHERE d.anime_id = a.id 
        AND d.dub_status IN ('ONGOING', 'FINISHED')
      )`;
    }

    if (filters.platform) {
      query += ` AND EXISTS (
        SELECT 1 FROM dubs d WHERE d.anime_id = a.id AND d.platform = ?
      )`;
      params.push(filters.platform);
    }

    if (filters.genre) {
      query += ' AND a.genres LIKE ?';
      params.push(`%${filters.genre}%`);
    }

    if (filters.search) {
      query += ' AND (a.title LIKE ? OR a.title_english LIKE ? OR a.title_romaji LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (!filters.includeAdult) {
      query += ' AND a.is_adult = 0';
    }

    // Sorting
    const sortOptions = {
      'popularity': 'a.popularity DESC',
      'score': 'a.average_score DESC',
      'title': 'a.title ASC',
      'newest': 'a.start_date DESC',
      'episodes': 'a.episodes_aired DESC'
    };
    query += ` ORDER BY ${sortOptions[filters.sort] || 'a.popularity DESC'}`;

    // Pagination
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    return db.allAsync(query, params);
  }

  async getAnimeById(id) {
    const anime = await db.getAsync('SELECT * FROM anime WHERE id = ?', [id]);
    if (anime) {
      // Get dub info
      anime.dubs = await db.allAsync(
        'SELECT * FROM dubs WHERE anime_id = ? ORDER BY platform',
        [id]
      );
    }
    return anime;
  }

  async getAnimeByAnilistId(anilistId) {
    return db.getAsync('SELECT * FROM anime WHERE anilist_id = ?', [anilistId]);
  }

  async getCurrentSeasonAnime() {
    const season = anilistService.getCurrentSeason();
    const year = anilistService.getCurrentYear();
    return this.getAllAnime({ season, year });
  }

  async getRecentlyFinished(days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return db.allAsync(
      `SELECT a.*, 
        (SELECT GROUP_CONCAT(d.platform || ':' || d.dub_status, ',')
         FROM dubs d WHERE d.anime_id = a.id) as dub_info
      FROM anime a 
      WHERE a.status = 'FINISHED' 
        AND a.end_date >= ?
        AND a.is_adult = 0
      ORDER BY a.end_date DESC`,
      [cutoffDate.toISOString().split('T')[0]]
    );
  }

  async getAnimeStats() {
    const season = anilistService.getCurrentSeason();
    const year = anilistService.getCurrentYear();

    const stats = await db.getAsync(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'AIRING' THEN 1 ELSE 0 END) as airing,
        SUM(CASE WHEN status = 'FINISHED' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN status = 'NOT_AIRED' THEN 1 ELSE 0 END) as upcoming
      FROM anime 
      WHERE season = ? AND year = ?
    `, [season, year]);

    const dubStats = await db.getAsync(`
      SELECT 
        COUNT(DISTINCT anime_id) as with_dub,
        SUM(CASE WHEN dub_status = 'FINISHED' THEN 1 ELSE 0 END) as dub_finished,
        SUM(CASE WHEN dub_status = 'ONGOING' THEN 1 ELSE 0 END) as dub_ongoing
      FROM dubs
    `);

    // Get last sync time
    const lastSync = await db.getAsync(`
      SELECT completed_at FROM sync_logs 
      WHERE status = 'success' 
      ORDER BY completed_at DESC 
      LIMIT 1
    `);

    return { 
      ...stats, 
      ...dubStats, 
      season, 
      year,
      lastUpdated: lastSync?.completed_at || null
    };
  }

  // ==========================================
  // DUB OPERATIONS
  // ==========================================

  async getDubRadar() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // New dub premieres this week
    const newPremieresThisWeek = await db.allAsync(`
      SELECT a.*, d.platform, d.dub_status, d.dub_start_date
      FROM anime a
      JOIN dubs d ON a.id = d.anime_id
      WHERE d.dub_start_date >= ? AND d.dub_start_date <= ?
      ORDER BY d.dub_start_date DESC
    `, [weekAgo.toISOString().split('T')[0], now.toISOString().split('T')[0]]);

    // Recently completed dubs
    const recentlyCompletedDubs = await db.allAsync(`
      SELECT a.*, d.platform, d.dub_status, d.dub_end_date
      FROM anime a
      JOIN dubs d ON a.id = d.anime_id
      WHERE d.dub_status = 'FINISHED' AND d.dub_end_date >= ?
      ORDER BY d.dub_end_date DESC
      LIMIT 20
    `, [monthAgo.toISOString().split('T')[0]]);

    // Ongoing dubs
    const ongoingDubs = await db.allAsync(`
      SELECT a.*, d.platform, d.dub_status, d.episodes_dubbed
      FROM anime a
      JOIN dubs d ON a.id = d.anime_id
      WHERE d.dub_status = 'ONGOING'
      ORDER BY a.popularity DESC
      LIMIT 30
    `);

    // Group by platform
    const byPlatform = await db.allAsync(`
      SELECT d.platform, COUNT(*) as count,
        SUM(CASE WHEN d.dub_status = 'FINISHED' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN d.dub_status = 'ONGOING' THEN 1 ELSE 0 END) as ongoing
      FROM dubs d
      GROUP BY d.platform
    `);

    return {
      newPremieresThisWeek,
      recentlyCompletedDubs,
      ongoingDubs,
      byPlatform
    };
  }

  async updateDubStatus(animeId, platform, dubData) {
    const existing = await db.getAsync(
      'SELECT id FROM dubs WHERE anime_id = ? AND platform = ?',
      [animeId, platform]
    );

    if (existing) {
      return db.runAsync(
        `UPDATE dubs SET 
          dub_status = ?, episodes_dubbed = ?, 
          dub_start_date = ?, dub_end_date = ?, 
          notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          dubData.dub_status, dubData.episodes_dubbed || 0,
          dubData.dub_start_date, dubData.dub_end_date,
          dubData.notes, existing.id
        ]
      );
    } else {
      return db.runAsync(
        `INSERT INTO dubs (anime_id, platform, dub_status, episodes_dubbed, dub_start_date, dub_end_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          animeId, platform, dubData.dub_status,
          dubData.episodes_dubbed || 0, dubData.dub_start_date,
          dubData.dub_end_date, dubData.notes
        ]
      );
    }
  }

  async searchAnime(searchTerm) {
    // First search local database
    const local = await this.getAllAnime({ search: searchTerm, limit: 20 });
    
    if (local.length >= 10) {
      return local;
    }

    // If not enough results, search AniList and add to DB
    try {
      const anilistResults = await anilistService.searchAnime(searchTerm);
      for (const anime of anilistResults.media.slice(0, 10)) {
        await this.saveAnime(anime);
      }
      // Re-query local
      return this.getAllAnime({ search: searchTerm, limit: 20 });
    } catch (err) {
      console.error('AniList search error:', err.message);
      return local;
    }
  }

  async getSyncLogs(limit = 10) {
    return db.allAsync(
      'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT ?',
      [limit]
    );
  }

  // Legacy method for compatibility
  async updateAnimeDatabase() {
    return this.seasonSyncJob();
  }
}

module.exports = new AnimeService();
