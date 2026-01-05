const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const userService = require('../services/userService');

// ==========================================
// PROGRESS ROUTES
// ==========================================

// Get user's watch progress with filters
router.get('/progress', ensureAuthenticated, async (req, res) => {
  try {
    const { status, season, year, hasDub, sort } = req.query;
    const filters = {};
    
    if (status) filters.userStatus = status;
    if (season) filters.season = season;
    if (year) filters.year = parseInt(year);
    if (hasDub === 'true') filters.hasDub = true;
    if (sort) filters.sort = sort;

    const progress = await userService.getUserProgress(req.user.id, filters);
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get progress for specific anime
router.get('/progress/:animeId', ensureAuthenticated, async (req, res) => {
  try {
    const progress = await userService.getProgressByAnime(req.user.id, req.params.animeId);
    res.json(progress || { last_episode: 0, user_status: null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update watch progress
router.post('/progress', ensureAuthenticated, async (req, res) => {
  try {
    const { animeId, lastEpisode, status } = req.body;
    
    if (!animeId) {
      return res.status(400).json({ error: 'animeId is required' });
    }

    const progress = await userService.updateProgress(
      req.user.id, 
      animeId, 
      lastEpisode || 0, 
      status
    );
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Increment episode (+1)
router.post('/progress/:animeId/increment', ensureAuthenticated, async (req, res) => {
  try {
    const progress = await userService.incrementEpisode(req.user.id, req.params.animeId);
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Jump to specific episode
router.post('/progress/:animeId/jump', ensureAuthenticated, async (req, res) => {
  try {
    const { episode } = req.body;
    if (episode === undefined) {
      return res.status(400).json({ error: 'episode is required' });
    }
    const progress = await userService.updateProgress(req.user.id, req.params.animeId, episode);
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark season finished
router.post('/progress/:animeId/finish', ensureAuthenticated, async (req, res) => {
  try {
    const progress = await userService.markSeasonFinished(req.user.id, req.params.animeId);
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set status (WATCHING, PLANNED, DROPPED, ON_HOLD)
router.post('/progress/:animeId/status', ensureAuthenticated, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['WATCHING', 'PLANNED', 'FINISHED', 'DROPPED', 'ON_HOLD'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const progress = await userService.setStatus(req.user.id, req.params.animeId, status);
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove from list
router.delete('/progress/:animeId', ensureAuthenticated, async (req, res) => {
  try {
    await userService.removeFromList(req.user.id, req.params.animeId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SESSION ROUTES
// ==========================================

// Get session history
router.get('/sessions', ensureAuthenticated, async (req, res) => {
  try {
    const { animeId, limit } = req.query;
    const sessions = await userService.getSessionHistory(
      req.user.id, 
      animeId ? parseInt(animeId) : null,
      limit ? parseInt(limit) : 50
    );
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session stats
router.get('/sessions/stats', ensureAuthenticated, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const stats = await userService.getSessionStats(req.user.id, days);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log a session manually
router.post('/sessions', ensureAuthenticated, async (req, res) => {
  try {
    const { animeId, fromEpisode, toEpisode, notes } = req.body;
    
    if (!animeId || fromEpisode === undefined || toEpisode === undefined) {
      return res.status(400).json({ error: 'animeId, fromEpisode, and toEpisode are required' });
    }

    await userService.logSession(req.user.id, animeId, fromEpisode, toEpisode, notes);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DASHBOARD & STATS
// ==========================================

// Get my season dashboard
router.get('/my-season', ensureAuthenticated, async (req, res) => {
  try {
    const { season, year } = req.query;
    const dashboard = await userService.getMySeasonDashboard(
      req.user.id,
      season || null,
      year ? parseInt(year) : null
    );
    res.json(dashboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get completion stats (legacy)
router.get('/stats', ensureAuthenticated, async (req, res) => {
  try {
    const { season, year } = req.query;
    const stats = await userService.getCompletionStats(
      req.user.id,
      season || null,
      year ? parseInt(year) : null
    );
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// NOTIFICATIONS
// ==========================================

// Get notifications
router.get('/notifications', ensureAuthenticated, async (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await userService.getNotifications(req.user.id, unreadOnly);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
router.post('/notifications/:id/read', ensureAuthenticated, async (req, res) => {
  try {
    await userService.markNotificationRead(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark all notifications as read
router.post('/notifications/read-all', ensureAuthenticated, async (req, res) => {
  try {
    await userService.markAllNotificationsRead(req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PREFERENCES
// ==========================================

// Update user preferences
router.put('/preferences', ensureAuthenticated, async (req, res) => {
  try {
    const { dubPreferenceMode, notifyDubComplete } = req.body;
    await userService.updateUserPreferences(req.user.id, { dubPreferenceMode, notifyDubComplete });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user info
router.get('/me', ensureAuthenticated, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
