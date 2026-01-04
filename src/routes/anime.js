const express = require('express');
const router = express.Router();
const animeService = require('../services/animeService');

// Get all anime
router.get('/', async (req, res) => {
  try {
    const { season, year, airing } = req.query;
    const filters = {};
    
    if (season) filters.season = season;
    if (year) filters.year = parseInt(year);
    if (airing !== undefined) filters.airing = airing === 'true';

    const anime = await animeService.getAllAnime(filters);
    res.json(anime);
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

// Update dub status (admin function)
router.put('/:id/dub', async (req, res) => {
  try {
    const { dubAvailable, dubPlatform } = req.body;
    await animeService.updateDubStatus(req.params.id, dubAvailable, dubPlatform);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger manual update
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
