/**
 * Dub Detection Service
 * 
 * A robust multi-source dub checking system with fallback redundancy.
 * Checks multiple sources in order and uses the first successful result.
 * 
 * Sources (in priority order):
 * 1. Local database cache (fastest)
 * 2. AniList API (official data)
 * 3. MyAnimeList via Jikan API (community data)
 * 4. LiveChart.me scraping (real-time data)
 * 5. Manual override database
 */

const db = require('../config/database');

class DubService {
  constructor() {
    // Rate limiting
    this.lastJikanRequest = 0;
    this.jikanRateLimit = 1000; // 1 request per second
    
    // Platform mappings for different sources
    this.platformMappings = {
      'crunchyroll': 'Crunchyroll',
      'funimation': 'Funimation',
      'hidive': 'HIDIVE',
      'netflix': 'Netflix',
      'amazon': 'Amazon',
      'amazon prime': 'Amazon',
      'amazon prime video': 'Amazon',
      'prime video': 'Amazon',
      'hulu': 'Hulu',
      'disney+': 'Disney+',
      'disney plus': 'Disney+',
      'adult swim': 'Adult Swim',
      'toonami': 'Adult Swim'
    };

    // Cache for dub results (in-memory)
    this.dubCache = new Map();
    this.cacheTTL = 6 * 60 * 60 * 1000; // 6 hours
  }

  /**
   * Main method to check dub status for an anime
   * Uses multiple sources with fallback
   * 
   * @param {Object} anime - Anime object with id, title, anilist_id, mal_id
   * @returns {Object} - Dub info { hasDub, platforms: [...], source }
   */
  async checkDubStatus(anime) {
    const animeId = anime.id;
    const cacheKey = `dub_${animeId}`;

    // Check in-memory cache first
    const cached = this.dubCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return { ...cached.data, source: 'cache' };
    }

    const sources = [
      { name: 'database', fn: () => this.checkDatabaseDub(animeId) },
      { name: 'anilist', fn: () => this.checkAniListDub(anime) },
      { name: 'jikan', fn: () => this.checkJikanDub(anime.mal_id) },
      { name: 'livechart', fn: () => this.checkLiveChartDub(anime) }
    ];

    let lastError = null;
    
    for (const source of sources) {
      try {
        const result = await source.fn();
        if (result && result.checked) {
          // Cache successful result
          this.dubCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
          });
          
          // Also save to database for persistence
          if (source.name !== 'database' && result.hasDub) {
            await this.saveDubToDatabase(animeId, result);
          }
          
          return { ...result, source: source.name };
        }
      } catch (err) {
        console.warn(`Dub check failed for ${anime.title} via ${source.name}:`, err.message);
        lastError = err;
        // Continue to next source
      }
    }

    // All sources failed - return unknown status
    console.warn(`All dub sources failed for ${anime.title}`);
    return {
      hasDub: false,
      platforms: [],
      source: 'none',
      error: lastError?.message,
      checked: true
    };
  }

  /**
   * Source 1: Check local database (fastest, most reliable for known data)
   */
  async checkDatabaseDub(animeId) {
    const dubs = await db.allAsync(
      `SELECT * FROM dubs WHERE anime_id = ? AND dub_status != 'NONE'`,
      [animeId]
    );

    if (dubs && dubs.length > 0) {
      return {
        hasDub: true,
        platforms: dubs.map(d => ({
          name: d.platform,
          status: d.dub_status,
          episodes: d.episodes_dubbed
        })),
        checked: true
      };
    }

    // Check if we've explicitly marked this as no dub
    const noDub = await db.getAsync(
      `SELECT * FROM dubs WHERE anime_id = ? AND dub_status = 'NONE'`,
      [animeId]
    );

    if (noDub) {
      return {
        hasDub: false,
        platforms: [],
        checked: true,
        confirmedNoDub: true
      };
    }

    // Not in database - need to check other sources
    return { checked: false };
  }

  /**
   * Source 2: Check AniList API for dub info
   * AniList doesn't have direct dub info, but we can check:
   * - External links for streaming services
   * - Title translations (if English title differs significantly)
   */
  async checkAniListDub(anime) {
    if (!anime.anilist_id) {
      return { checked: false };
    }

    try {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            title {
              english
              romaji
            }
            externalLinks {
              site
              url
              language
              type
            }
            streamingEpisodes {
              site
              title
              url
            }
          }
        }
      `;

      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { id: anime.anilist_id }
        })
      });

      if (!response.ok) {
        throw new Error(`AniList API error: ${response.status}`);
      }

      const data = await response.json();
      const media = data.data?.Media;

      if (!media) {
        return { checked: false };
      }

      // Check external links for streaming platforms
      const platforms = [];
      const streamingLinks = media.externalLinks?.filter(
        link => link.type === 'STREAMING'
      ) || [];

      for (const link of streamingLinks) {
        const siteLower = link.site.toLowerCase();
        const platform = this.platformMappings[siteLower];
        
        if (platform && link.language === 'English') {
          platforms.push({
            name: platform,
            status: 'AVAILABLE',
            url: link.url
          });
        }
      }

      // Check streaming episodes for English content
      const engEpisodes = media.streamingEpisodes?.filter(
        ep => ep.title?.match(/\(English|Dub|English Dub\)/i)
      ) || [];

      if (engEpisodes.length > 0) {
        for (const ep of engEpisodes) {
          const siteLower = ep.site?.toLowerCase() || '';
          const platform = this.platformMappings[siteLower];
          if (platform && !platforms.find(p => p.name === platform)) {
            platforms.push({
              name: platform,
              status: 'ONGOING',
              episodes: engEpisodes.length
            });
          }
        }
      }

      return {
        hasDub: platforms.length > 0,
        platforms,
        checked: true
      };

    } catch (err) {
      console.warn('AniList dub check error:', err.message);
      return { checked: false, error: err.message };
    }
  }

  /**
   * Source 3: Check Jikan API (MyAnimeList data)
   * MAL has community-maintained dub info
   */
  async checkJikanDub(malId) {
    if (!malId) {
      return { checked: false };
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastJikanRequest;
    if (timeSinceLastRequest < this.jikanRateLimit) {
      await this.sleep(this.jikanRateLimit - timeSinceLastRequest);
    }
    this.lastJikanRequest = Date.now();

    try {
      // Get anime details from Jikan
      const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}/full`);
      
      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - wait and retry once
          await this.sleep(2000);
          return this.checkJikanDub(malId);
        }
        throw new Error(`Jikan API error: ${response.status}`);
      }

      const data = await response.json();
      const anime = data.data;

      if (!anime) {
        return { checked: false };
      }

      const platforms = [];

      // Check streaming links
      if (anime.streaming && anime.streaming.length > 0) {
        for (const stream of anime.streaming) {
          const siteLower = stream.name?.toLowerCase() || '';
          const platform = this.platformMappings[siteLower];
          if (platform) {
            platforms.push({
              name: platform,
              status: 'AVAILABLE',
              url: stream.url
            });
          }
        }
      }

      // Check for English in the title (indicates possible dub)
      const hasEnglishTitle = anime.title_english && 
        anime.title_english !== anime.title;

      // Check producers/licensors for dub companies
      const dubCompanies = ['funimation', 'sentai filmworks', 'viz media', 
        'aniplex of america', 'crunchyroll', 'bang zoom'];
      
      const licensors = anime.licensors || [];
      const hasDubCompany = licensors.some(l => 
        dubCompanies.some(dc => l.name?.toLowerCase().includes(dc))
      );

      // If we found streaming platforms with English dub indicators
      const hasDub = platforms.length > 0 || hasDubCompany;

      return {
        hasDub,
        platforms,
        hasEnglishTitle,
        hasDubCompany,
        checked: true
      };

    } catch (err) {
      console.warn('Jikan dub check error:', err.message);
      return { checked: false, error: err.message };
    }
  }

  /**
   * Source 4: Check LiveChart.me for real-time dub info
   * This scrapes their streaming info which is very up-to-date
   */
  async checkLiveChartDub(anime) {
    // LiveChart uses AniList IDs
    if (!anime.anilist_id) {
      return { checked: false };
    }

    try {
      // LiveChart API endpoint (unofficial)
      const response = await fetch(
        `https://www.livechart.me/api/v1/anime/${anime.anilist_id}`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'AnimeTracker/1.0'
          }
        }
      );

      if (!response.ok) {
        // LiveChart might block or not have the anime
        return { checked: false };
      }

      const data = await response.json();
      const platforms = [];

      // Check streams for English audio
      if (data.streams) {
        for (const stream of data.streams) {
          if (stream.audio === 'en' || stream.dub === true) {
            const platform = this.platformMappings[stream.service?.toLowerCase()] 
              || stream.service;
            platforms.push({
              name: platform,
              status: stream.status || 'AVAILABLE',
              url: stream.url
            });
          }
        }
      }

      return {
        hasDub: platforms.length > 0,
        platforms,
        checked: true
      };

    } catch (err) {
      // LiveChart scraping is unreliable - fail silently
      return { checked: false };
    }
  }

  /**
   * Save dub info to database for future lookups
   */
  async saveDubToDatabase(animeId, dubInfo) {
    if (!dubInfo.hasDub || !dubInfo.platforms?.length) {
      return;
    }

    for (const platform of dubInfo.platforms) {
      try {
        await db.runAsync(`
          INSERT INTO dubs (anime_id, platform, dub_status, episodes_dubbed, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(anime_id, platform) 
          DO UPDATE SET 
            dub_status = excluded.dub_status,
            episodes_dubbed = excluded.episodes_dubbed,
            updated_at = datetime('now')
        `, [
          animeId,
          platform.name,
          platform.status === 'FINISHED' ? 'FINISHED' : 'ONGOING',
          platform.episodes || 0
        ]);
      } catch (err) {
        console.warn('Error saving dub to database:', err.message);
      }
    }
  }

  /**
   * Batch check dubs for multiple anime
   * Uses parallel requests with rate limiting
   */
  async batchCheckDubs(animeList, options = {}) {
    const { concurrency = 3, onProgress } = options;
    const results = [];
    const queue = [...animeList];
    let completed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const anime = queue.shift();
        if (!anime) break;

        try {
          const result = await this.checkDubStatus(anime);
          results.push({ anime, dub: result });
        } catch (err) {
          results.push({ anime, dub: null, error: err.message });
        }

        completed++;
        if (onProgress) {
          onProgress(completed, animeList.length);
        }
      }
    };

    // Run workers in parallel
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return results;
  }

  /**
   * Update dub status manually (admin function)
   */
  async updateDubManual(animeId, platform, status, episodesDubbed = 0) {
    await db.runAsync(`
      INSERT INTO dubs (anime_id, platform, dub_status, episodes_dubbed, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(anime_id, platform) 
      DO UPDATE SET 
        dub_status = ?,
        episodes_dubbed = ?,
        updated_at = datetime('now')
    `, [animeId, platform, status, episodesDubbed, status, episodesDubbed]);

    // Clear cache
    this.dubCache.delete(`dub_${animeId}`);

    return { success: true };
  }

  /**
   * Get all platforms with dub counts
   */
  async getPlatformStats() {
    const stats = await db.allAsync(`
      SELECT 
        platform,
        COUNT(*) as total,
        SUM(CASE WHEN dub_status = 'FINISHED' THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN dub_status = 'ONGOING' THEN 1 ELSE 0 END) as ongoing
      FROM dubs
      WHERE dub_status != 'NONE'
      GROUP BY platform
      ORDER BY total DESC
    `);

    return stats;
  }

  /**
   * Run full dub sync for all airing anime
   */
  async syncAllDubs(options = {}) {
    console.log('\n🎙️ Starting Full Dub Sync...');
    
    const airingAnime = await db.allAsync(`
      SELECT id, title, title_english, anilist_id, mal_id
      FROM anime 
      WHERE status IN ('AIRING', 'FINISHED')
      ORDER BY popularity DESC
      LIMIT 500
    `);

    console.log(`Checking dubs for ${airingAnime.length} anime...`);

    const results = await this.batchCheckDubs(airingAnime, {
      concurrency: 2,
      onProgress: (done, total) => {
        if (done % 50 === 0) {
          console.log(`  Progress: ${done}/${total}`);
        }
      }
    });

    const withDub = results.filter(r => r.dub?.hasDub).length;
    console.log(`\n✅ Dub Sync Complete: ${withDub}/${airingAnime.length} have dubs`);

    return {
      total: airingAnime.length,
      withDub,
      results
    };
  }

  // Utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new DubService();
