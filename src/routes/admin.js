const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const animeService = require('../services/animeService');
const userService = require('../services/userService');
const dubService = require('../services/dubService');
const db = require('../config/database');

// All admin routes require authentication and admin status
router.use(ensureAuthenticated, ensureAdmin);

// ==========================================
// DASHBOARD
// ==========================================

// Get admin dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const animeStats = await animeService.getAnimeStats();
    const syncLogs = await animeService.getSyncLogs(5);
    
    // Count users
    const userCount = await db.getAsync('SELECT COUNT(*) as count FROM users');
    
    // Dubs needing review (no dub info for popular anime)
    const needsDubReview = await db.allAsync(`
      SELECT a.id, a.title, a.poster_url, a.popularity
      FROM anime a
      WHERE a.status IN ('AIRING', 'FINISHED')
        AND a.popularity > 5000
        AND NOT EXISTS (SELECT 1 FROM dubs d WHERE d.anime_id = a.id)
      ORDER BY a.popularity DESC
      LIMIT 20
    `);

    res.json({
      animeStats,
      syncLogs,
      userCount: userCount?.count || 0,
      needsDubReview
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ANIME MANAGEMENT
// ==========================================

// Search anime in database
router.get('/anime/search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    const results = await animeService.searchAnime(q || '');
    res.json(results.slice(0, parseInt(limit) || 50));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get anime with all dub info for editing
router.get('/anime/:id', async (req, res) => {
  try {
    const anime = await animeService.getAnimeById(req.params.id);
    if (!anime) {
      return res.status(404).json({ error: 'Anime not found' });
    }
    res.json(anime);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DUB MANAGEMENT
// ==========================================

// Get all dubs
router.get('/dubs', async (req, res) => {
  try {
    const { status, platform, page = 1, limit = 50 } = req.query;
    
    let query = `
      SELECT d.*, a.title, a.title_english, a.poster_url, a.status as anime_status
      FROM dubs d
      JOIN anime a ON d.anime_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND d.dub_status = ?';
      params.push(status);
    }
    if (platform) {
      query += ' AND d.platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY d.updated_at DESC';
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const dubs = await db.allAsync(query, params);
    res.json(dubs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add/Update dub info
router.post('/dubs', async (req, res) => {
  try {
    const { anime_id, platform, dub_status, episodes_dubbed, dub_start_date, dub_end_date, notes } = req.body;
    
    if (!anime_id || !platform) {
      return res.status(400).json({ error: 'anime_id and platform are required' });
    }

    await animeService.updateDubStatus(anime_id, platform, {
      dub_status: dub_status || 'NONE',
      episodes_dubbed: episodes_dubbed || 0,
      dub_start_date,
      dub_end_date,
      notes
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete dub entry
router.delete('/dubs/:id', async (req, res) => {
  try {
    await db.runAsync('DELETE FROM dubs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk update dubs
router.post('/dubs/bulk', async (req, res) => {
  try {
    const { updates } = req.body; // Array of { anime_id, platform, ...dubData }
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an array' });
    }

    let success = 0;
    let failed = 0;

    for (const update of updates) {
      try {
        await animeService.updateDubStatus(update.anime_id, update.platform, {
          dub_status: update.dub_status,
          episodes_dubbed: update.episodes_dubbed,
          dub_start_date: update.dub_start_date,
          dub_end_date: update.dub_end_date,
          notes: update.notes
        });
        success++;
      } catch {
        failed++;
      }
    }

    res.json({ success, failed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SYNC MANAGEMENT
// ==========================================

// Trigger season sync
router.post('/sync/season', async (req, res) => {
  try {
    // Run in background
    animeService.seasonSyncJob().catch(err => 
      console.error('Admin-triggered season sync error:', err)
    );
    res.json({ message: 'Season sync started in background' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger daily update
router.post('/sync/daily', async (req, res) => {
  try {
    // Run in background
    animeService.dailyUpdateJob().catch(err => 
      console.error('Admin-triggered daily update error:', err)
    );
    res.json({ message: 'Daily update started in background' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger dub sync (uses multiple sources with fallback)
router.post('/sync/dubs', async (req, res) => {
  try {
    // Run in background
    dubService.syncAllDubs().catch(err => 
      console.error('Admin-triggered dub sync error:', err)
    );
    res.json({ message: 'Dub sync started in background. This uses multiple sources with fallback redundancy.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check dub status for a single anime (uses all sources)
router.get('/dubs/check/:animeId', async (req, res) => {
  try {
    const anime = await db.getAsync(
      'SELECT id, title, title_english, anilist_id, mal_id FROM anime WHERE id = ?',
      [req.params.animeId]
    );
    
    if (!anime) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    const dubInfo = await dubService.checkDubStatus(anime);
    res.json({
      anime: { id: anime.id, title: anime.title },
      dub: dubInfo
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get platform statistics
router.get('/dubs/stats', async (req, res) => {
  try {
    const stats = await dubService.getPlatformStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sync logs
router.get('/sync/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const logs = await animeService.getSyncLogs(limit);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// USER MANAGEMENT
// ==========================================

// Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await db.allAsync(`
      SELECT id, email, name, picture, is_admin, created_at,
        (SELECT COUNT(*) FROM user_progress WHERE user_id = users.id) as anime_count
      FROM users
      ORDER BY created_at DESC
    `);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle admin status
router.post('/users/:id/admin', async (req, res) => {
  try {
    const { isAdmin } = req.body;
    await userService.setAdmin(req.params.id, isAdmin);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DATA CLEANUP
// ==========================================

// Get orphaned records
router.get('/cleanup/orphans', async (req, res) => {
  try {
    const orphanedProgress = await db.allAsync(`
      SELECT COUNT(*) as count FROM user_progress 
      WHERE anime_id NOT IN (SELECT id FROM anime)
    `);
    
    const orphanedDubs = await db.allAsync(`
      SELECT COUNT(*) as count FROM dubs 
      WHERE anime_id NOT IN (SELECT id FROM anime)
    `);

    res.json({
      orphanedProgress: orphanedProgress[0]?.count || 0,
      orphanedDubs: orphanedDubs[0]?.count || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clean orphaned records
router.post('/cleanup/orphans', async (req, res) => {
  try {
    const progressResult = await db.runAsync(`
      DELETE FROM user_progress 
      WHERE anime_id NOT IN (SELECT id FROM anime)
    `);
    
    const dubsResult = await db.runAsync(`
      DELETE FROM dubs 
      WHERE anime_id NOT IN (SELECT id FROM anime)
    `);

    res.json({
      deletedProgress: progressResult.changes,
      deletedDubs: dubsResult.changes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
