const express = require('express');
const router = express.Router();
const animeService = require('../services/animeService');
const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');

// ==========================================
// PUBLIC ROUTES
// ==========================================

// Get current season anime
router.get('/current', async (req, res) => {
  try {
    const anime = await animeService.getCurrentSeasonAnime();
    res.json(anime);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all anime with filters
router.get('/', async (req, res) => {
  try {
    const { season, year, status, hasDub, platform, genre, search, sort, limit, offset, includeAdult } = req.query;
    
    const filters = {};
    if (season) filters.season = season;
    if (year) filters.year = parseInt(year);
    if (status) filters.status = status;
    if (hasDub === 'true') filters.hasDub = true;
    if (platform) filters.platform = platform;
    if (genre) filters.genre = genre;
    if (search) filters.search = search;
    if (sort) filters.sort = sort;
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);
    if (includeAdult === 'true') filters.includeAdult = true;

    const anime = await animeService.getAllAnime(filters);
    res.json(anime);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get anime stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await animeService.getAnimeStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recently finished anime
router.get('/recently-finished', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const anime = await animeService.getRecentlyFinished(days);
    res.json(anime);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dub radar data
router.get('/dub-radar', async (req, res) => {
  try {
    const data = await animeService.getDubRadar();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search anime
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const results = await animeService.searchAnime(q);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get anime by ID
router.get('/:id', async (req, res) => {
  try {
    const anime = await animeService.getAnimeById(req.params.id);
    if (anime) {
      res.json(anime);
    } else {
      res.status(404).json({ error: 'Anime not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ADMIN ROUTES
// ==========================================

// Update dub status (admin only)
router.put('/:id/dub', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { platform, dub_status, episodes_dubbed, dub_start_date, dub_end_date, notes } = req.body;
    
    if (!platform) {
      return res.status(400).json({ error: 'Platform is required' });
    }

    await animeService.updateDubStatus(req.params.id, platform, {
      dub_status: dub_status || 'NONE',
      episodes_dubbed,
      dub_start_date,
      dub_end_date,
      notes
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger season sync (admin only)
router.post('/sync/season', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    // Run in background
    animeService.seasonSyncJob().catch(err => 
      console.error('Season sync error:', err)
    );
    res.json({ message: 'Season sync started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger daily update (admin only)
router.post('/sync/daily', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    // Run in background
    animeService.dailyUpdateJob().catch(err => 
      console.error('Daily update error:', err)
    );
    res.json({ message: 'Daily update started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sync logs (admin only)
router.get('/admin/sync-logs', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const logs = await animeService.getSyncLogs(limit);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy manual update endpoint
router.post('/update', async (req, res) => {
  try {
    // Run in background
    animeService.updateAnimeDatabase().catch(err => 
      console.error('Background update error:', err)
    );
    res.json({ message: 'Update started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
