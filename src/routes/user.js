const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const userService = require('../services/userService');

// Get user's watch progress
router.get('/progress', ensureAuthenticated, async (req, res) => {
  try {
    const progress = await userService.getUserProgress(req.user.id);
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update watch progress
router.post('/progress', ensureAuthenticated, async (req, res) => {
  try {
    const { animeId, episodesWatched, status } = req.body;
    await userService.updateProgress(req.user.id, animeId, episodesWatched, status);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark/unmark session
router.post('/session', ensureAuthenticated, async (req, res) => {
  try {
    const { animeId, marked } = req.body;
    await userService.markSession(req.user.id, animeId, marked);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get completion stats
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

module.exports = router;
