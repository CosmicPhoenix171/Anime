const axios = require('axios');
const db = require('../config/database');

const JIKAN_API = 'https://api.jikan.moe/v4';

class AnimeService {
  async getCurrentSeasonAnime() {
    try {
      const response = await axios.get(`${JIKAN_API}/seasons/now`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching current season anime:', error.message);
      return [];
    }
  }

  async getAnimeDetails(malId) {
    try {
      const response = await axios.get(`${JIKAN_API}/anime/${malId}/full`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching anime details:', error.message);
      return null;
    }
  }

  async updateAnimeDatabase() {
    console.log('Starting anime database update...');
    const seasonAnime = await this.getCurrentSeasonAnime();
    
    for (const anime of seasonAnime) {
      await this.saveAnime(anime);
      // Respect rate limiting
      await this.sleep(1000);
    }
    
    console.log('Anime database update completed.');
  }

  async saveAnime(animeData) {
    return new Promise((resolve, reject) => {
      const {
        mal_id,
        title,
        title_english,
        season,
        year,
        episodes,
        status,
        airing,
        images,
        synopsis
      } = animeData;

      const imageUrl = images?.jpg?.large_image_url || images?.jpg?.image_url || '';

      db.run(
        `INSERT OR REPLACE INTO anime 
        (mal_id, title, title_english, season, year, episodes, status, airing, image_url, synopsis, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [mal_id, title, title_english, season, year, episodes, status, airing ? 1 : 0, imageUrl, synopsis],
        (err) => {
          if (err) {
            console.error('Error saving anime:', err.message);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getAllAnime(filters = {}) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM anime WHERE 1=1';
      const params = [];

      if (filters.season) {
        query += ' AND season = ?';
        params.push(filters.season);
      }

      if (filters.year) {
        query += ' AND year = ?';
        params.push(filters.year);
      }

      if (filters.airing !== undefined) {
        query += ' AND airing = ?';
        params.push(filters.airing ? 1 : 0);
      }

      query += ' ORDER BY title ASC';

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getAnimeById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM anime WHERE id = ?', [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async updateDubStatus(animeId, dubAvailable, dubPlatform) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE anime SET dub_available = ?, dub_platform = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [dubAvailable ? 1 : 0, dubPlatform, animeId],
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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AnimeService();
