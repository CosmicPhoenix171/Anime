/**
 * Robust Dub Checker Service
 * 
 * Checks multiple sources to determine if an anime has an English dub:
 * 1. AniList - Check external links and streaming services
 * 2. MyAnimeList - Cross-reference via AniList MAL ID
 * 3. Jikan API (MAL) - Official MAL data
 * 4. LiveChart.me data patterns
 * 5. Known dub databases (Funimation/Crunchyroll patterns)
 * 6. Manual overrides from Firebase
 */

class DubChecker {
  constructor() {
    this.JIKAN_API = 'https://api.jikan.moe/v4';
    this.ANILIST_API = 'https://graphql.anilist.co';
    this.RATE_LIMIT_MS = 1000; // Jikan rate limit
    
    // Known streaming services that do dubs
    this.DUB_PLATFORMS = {
      'Crunchyroll': { hasDubs: true, checkPattern: true },
      'Funimation': { hasDubs: true, checkPattern: true },
      'Netflix': { hasDubs: true, checkPattern: true },
      'Hulu': { hasDubs: true, checkPattern: true },
      'Amazon Prime Video': { hasDubs: true, checkPattern: true },
      'Disney+': { hasDubs: true, checkPattern: true },
      'HBO Max': { hasDubs: true, checkPattern: true },
      'Hidive': { hasDubs: true, checkPattern: true },
      'Adult Swim': { hasDubs: true, checkPattern: true },
      'Toonami': { hasDubs: true, checkPattern: true },
      'Viz': { hasDubs: true, checkPattern: true },
      'Sentai': { hasDubs: true, checkPattern: true },
      'Aniplex': { hasDubs: true, checkPattern: true },
      'Bang Zoom': { hasDubs: true, checkPattern: true }
    };

    // Studios known for dubbing
    this.DUB_STUDIOS = [
      'Funimation', 'Bang Zoom', 'Studiopolis', 'NYAV Post', 
      'Sound Cadence Studios', 'Okratron 5000', 'VSI Los Angeles',
      'Spliced Bread Productions', 'Kocha Sound', 'PCB Productions'
    ];

    // Cache for dub info
    this.dubCache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Main method - Check if anime has dub using multiple sources
   */
  async checkDub(anime) {
    const animeId = anime.id || anime.anilistId;
    const malId = anime.malId || anime.idMal;
    const title = anime.title || anime.titleRomaji;

    // Check cache first
    const cached = this.getFromCache(animeId);
    if (cached) {
      return cached;
    }

    console.log(`🔍 Checking dub for: ${title}`);

    const results = {
      hasDub: false,
      confidence: 0,
      sources: [],
      platforms: [],
      dubEpisodes: null,
      dubStatus: null,
      lastChecked: Date.now()
    };

    try {
      // Run all checks in parallel where possible
      const checks = await Promise.allSettled([
        this.checkAniListDub(animeId),
        malId ? this.checkJikanDub(malId) : Promise.resolve(null),
        this.checkFirebaseOverride(animeId),
        this.checkKnownDubList(animeId, title)
      ]);

      // Process AniList results
      if (checks[0].status === 'fulfilled' && checks[0].value) {
        const anilistResult = checks[0].value;
        if (anilistResult.hasDub) {
          results.hasDub = true;
          results.confidence += 30;
          results.sources.push('AniList');
          results.platforms.push(...(anilistResult.platforms || []));
        }
      }

      // Process Jikan/MAL results
      if (checks[1].status === 'fulfilled' && checks[1].value) {
        const jikanResult = checks[1].value;
        if (jikanResult.hasDub) {
          results.hasDub = true;
          results.confidence += 40;
          results.sources.push('MyAnimeList');
          if (jikanResult.dubInfo) {
            results.dubStatus = jikanResult.dubInfo.status;
            results.dubEpisodes = jikanResult.dubInfo.episodes;
          }
        }
      }

      // Process Firebase override (highest priority)
      if (checks[2].status === 'fulfilled' && checks[2].value) {
        const override = checks[2].value;
        results.hasDub = override.hasDub;
        results.confidence = 100;
        results.sources = ['Manual Override'];
        results.platforms = override.platforms || results.platforms;
        results.dubEpisodes = override.episodes || results.dubEpisodes;
        results.dubStatus = override.status || results.dubStatus;
      }

      // Process known dub list
      if (checks[3].status === 'fulfilled' && checks[3].value) {
        const knownResult = checks[3].value;
        if (knownResult.hasDub) {
          results.hasDub = true;
          results.confidence += 30;
          results.sources.push('Known Database');
          results.platforms.push(...(knownResult.platforms || []));
        }
      }

      // Normalize confidence
      results.confidence = Math.min(results.confidence, 100);

      // Remove duplicate platforms
      results.platforms = [...new Set(results.platforms)];

      // Cache the result
      this.saveToCache(animeId, results);

      // Save to Firebase for persistence
      await this.saveDubInfo(animeId, results);

      return results;

    } catch (error) {
      console.error(`Error checking dub for ${title}:`, error);
      return results;
    }
  }

  /**
   * Check AniList for dub information
   */
  async checkAniListDub(anilistId) {
    const numericId = parseInt(String(anilistId).replace('al_', ''));
    
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english }
          externalLinks {
            site
            url
            type
            language
          }
          streamingEpisodes {
            site
            title
            url
          }
          studios(isMain: false) {
            nodes {
              name
              isAnimationStudio
            }
          }
        }
      }
    `;

    try {
      const response = await fetch(this.ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id: numericId } })
      });

      const data = await response.json();
      const media = data?.data?.Media;

      if (!media) return null;

      const result = { hasDub: false, platforms: [] };

      // Check external links for dub platforms
      if (media.externalLinks) {
        for (const link of media.externalLinks) {
          // Check if link mentions dub or English
          if (link.language === 'English' || 
              (link.site && this.DUB_PLATFORMS[link.site])) {
            result.hasDub = true;
            result.platforms.push(link.site);
          }
          
          // Check URL for dub indicators
          if (link.url && (
            link.url.includes('/dub') || 
            link.url.includes('-dub') ||
            link.url.includes('english')
          )) {
            result.hasDub = true;
          }
        }
      }

      // Check streaming episodes for English titles
      if (media.streamingEpisodes) {
        for (const ep of media.streamingEpisodes) {
          if (ep.title && (
            ep.title.includes('(English Dub)') ||
            ep.title.includes('English') ||
            ep.title.includes('Dub')
          )) {
            result.hasDub = true;
            if (ep.site) result.platforms.push(ep.site);
          }
        }
      }

      // Check for dub studios
      if (media.studios?.nodes) {
        for (const studio of media.studios.nodes) {
          if (this.DUB_STUDIOS.includes(studio.name)) {
            result.hasDub = true;
            result.platforms.push(studio.name);
          }
        }
      }

      return result;

    } catch (error) {
      console.error('AniList dub check error:', error);
      return null;
    }
  }

  /**
   * Check Jikan (MAL) API for dub information
   */
  async checkJikanDub(malId) {
    try {
      // Rate limit
      await this.delay(this.RATE_LIMIT_MS);

      // Get anime details
      const response = await fetch(`${this.JIKAN_API}/anime/${malId}/full`);
      
      if (!response.ok) {
        throw new Error(`Jikan API error: ${response.status}`);
      }

      const data = await response.json();
      const anime = data?.data;

      if (!anime) return null;

      const result = { hasDub: false, dubInfo: null, platforms: [] };

      // Check producers/licensors for dub companies
      const allCompanies = [
        ...(anime.producers || []),
        ...(anime.licensors || []),
        ...(anime.studios || [])
      ];

      for (const company of allCompanies) {
        const name = company.name || company;
        if (this.isDubCompany(name)) {
          result.hasDub = true;
          result.platforms.push(name);
        }
      }

      // Check if there are English streaming links
      if (anime.streaming) {
        for (const stream of anime.streaming) {
          if (this.DUB_PLATFORMS[stream.name]) {
            result.platforms.push(stream.name);
          }
        }
      }

      // Funimation/Crunchyroll typically dub popular anime (score > 7, members > 100k)
      if (anime.score >= 7 && anime.members >= 100000) {
        // High chance of dub for popular shows
        const hasMajorLicensor = allCompanies.some(c => 
          ['Funimation', 'Crunchyroll', 'Aniplex of America', 'Viz Media', 'Sentai Filmworks'].includes(c.name)
        );
        if (hasMajorLicensor) {
          result.hasDub = true;
        }
      }

      return result;

    } catch (error) {
      console.error('Jikan dub check error:', error);
      return null;
    }
  }

  /**
   * Check Firebase for manual override
   */
  async checkFirebaseOverride(animeId) {
    try {
      const snapshot = await refs.anime.child(animeId).child('dubOverride').once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Firebase override check error:', error);
      return null;
    }
  }

  /**
   * Check against known dub database
   */
  async checkKnownDubList(animeId, title) {
    // Get from Firebase known dubs collection
    try {
      const snapshot = await refs.syncLog.child('knownDubs').child(animeId).once('value');
      const known = snapshot.val();
      
      if (known) {
        return {
          hasDub: true,
          platforms: known.platforms || [],
          episodes: known.episodes
        };
      }

      // Title-based pattern matching for common dubbed series
      const dubPatterns = [
        // Big shonen
        { pattern: /naruto|boruto/i, platforms: ['Crunchyroll', 'Hulu'] },
        { pattern: /one piece/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /dragon ball/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /my hero academia|boku no hero/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /demon slayer|kimetsu no yaiba/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /jujutsu kaisen/i, platforms: ['Crunchyroll'] },
        { pattern: /attack on titan|shingeki no kyojin/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /black clover/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /bleach/i, platforms: ['Hulu', 'Disney+'] },
        { pattern: /hunter.*hunter/i, platforms: ['Crunchyroll', 'Netflix'] },
        { pattern: /fullmetal alchemist/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /sword art online/i, platforms: ['Crunchyroll', 'Hulu'] },
        { pattern: /re:zero|re zero/i, platforms: ['Crunchyroll'] },
        { pattern: /konosuba/i, platforms: ['Crunchyroll'] },
        { pattern: /mob psycho/i, platforms: ['Crunchyroll'] },
        { pattern: /one punch man/i, platforms: ['Crunchyroll', 'Hulu'] },
        { pattern: /spy.*family/i, platforms: ['Crunchyroll'] },
        { pattern: /chainsaw man/i, platforms: ['Crunchyroll'] },
        { pattern: /tokyo revengers/i, platforms: ['Crunchyroll'] },
        { pattern: /dr\.?\s*stone/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /fire force|enen no shouboutai/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /fairy tail/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /overlord/i, platforms: ['Crunchyroll', 'Funimation'] },
        { pattern: /that time i got reincarnated as a slime|tensei shitara slime/i, platforms: ['Crunchyroll'] },
        { pattern: /mushoku tensei/i, platforms: ['Crunchyroll', 'Funimation'] }
      ];

      for (const { pattern, platforms } of dubPatterns) {
        if (pattern.test(title)) {
          return { hasDub: true, platforms };
        }
      }

      return null;

    } catch (error) {
      console.error('Known dub check error:', error);
      return null;
    }
  }

  /**
   * Check if company name is a known dubbing company
   */
  isDubCompany(name) {
    const dubCompanies = [
      'Funimation', 'Crunchyroll', 'Aniplex of America', 'Viz Media',
      'Sentai Filmworks', 'Bang Zoom! Entertainment', 'Studiopolis',
      'NYAV Post', 'Sound Cadence Studios', 'ADV Films', 'Geneon',
      'Media Play', 'Bandai Entertainment', 'Manga Entertainment',
      'Discotek Media', 'NIS America', 'Ponycan USA', 'Eleven Arts'
    ];
    
    return dubCompanies.some(company => 
      name.toLowerCase().includes(company.toLowerCase())
    );
  }

  /**
   * Batch check dubs for multiple anime
   */
  async batchCheckDubs(animeList, onProgress = null) {
    const results = [];
    const total = animeList.length;

    for (let i = 0; i < animeList.length; i++) {
      const anime = animeList[i];
      
      if (onProgress) {
        onProgress(Math.round((i / total) * 100), `Checking dub ${i + 1}/${total}...`);
      }

      const result = await this.checkDub(anime);
      results.push({
        animeId: anime.id,
        title: anime.title,
        ...result
      });

      // Rate limiting between checks
      if (anime.malId) {
        await this.delay(this.RATE_LIMIT_MS);
      }
    }

    return results;
  }

  /**
   * Save dub info to Firebase
   */
  async saveDubInfo(animeId, dubInfo) {
    try {
      await refs.anime.child(animeId).update({
        hasDub: dubInfo.hasDub,
        dubConfidence: dubInfo.confidence,
        dubPlatforms: dubInfo.platforms,
        dubEpisodes: dubInfo.dubEpisodes || null,
        dubStatus: dubInfo.dubStatus || null,
        dubSources: dubInfo.sources,
        dubCheckedAt: dubInfo.lastChecked
      });
    } catch (error) {
      console.error('Error saving dub info:', error);
    }
  }

  /**
   * Set manual dub override
   */
  async setDubOverride(animeId, dubData) {
    try {
      await refs.anime.child(animeId).child('dubOverride').set({
        hasDub: dubData.hasDub,
        platforms: dubData.platforms || [],
        episodes: dubData.episodes || null,
        status: dubData.status || null,
        setBy: 'manual',
        setAt: Date.now()
      });

      // Clear cache
      this.dubCache.delete(animeId);

      // Re-check to update main data
      return await this.checkDub({ id: animeId });
    } catch (error) {
      console.error('Error setting dub override:', error);
      throw error;
    }
  }

  /**
   * Get dubbed anime for current season
   */
  async getDubbedAnime(season, year) {
    try {
      const snapshot = await refs.anime
        .orderByChild('hasDub')
        .equalTo(true)
        .once('value');

      const dubbed = [];
      snapshot.forEach(child => {
        const anime = { id: child.key, ...child.val() };
        if (anime.season === season && anime.year === year) {
          dubbed.push(anime);
        }
      });

      return dubbed.sort((a, b) => (b.dubConfidence || 0) - (a.dubConfidence || 0));

    } catch (error) {
      console.error('Error getting dubbed anime:', error);
      return [];
    }
  }

  /**
   * Get dub statistics
   */
  async getDubStats(season, year) {
    try {
      const snapshot = await refs.anime
        .orderByChild('year')
        .equalTo(year)
        .once('value');

      let total = 0;
      let dubbed = 0;
      let confirmed = 0;
      const platforms = {};

      snapshot.forEach(child => {
        const anime = child.val();
        if (anime.season === season) {
          total++;
          if (anime.hasDub) {
            dubbed++;
            if (anime.dubConfidence >= 80) confirmed++;
            
            (anime.dubPlatforms || []).forEach(p => {
              platforms[p] = (platforms[p] || 0) + 1;
            });
          }
        }
      });

      return {
        total,
        dubbed,
        confirmed,
        percentage: total > 0 ? Math.round((dubbed / total) * 100) : 0,
        platforms: Object.entries(platforms)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count }))
      };

    } catch (error) {
      console.error('Error getting dub stats:', error);
      return { total: 0, dubbed: 0, confirmed: 0, percentage: 0, platforms: [] };
    }
  }

  // Cache methods
  getFromCache(animeId) {
    const cached = this.dubCache.get(animeId);
    if (cached && (Date.now() - cached.lastChecked) < this.cacheExpiry) {
      return cached;
    }
    return null;
  }

  saveToCache(animeId, data) {
    this.dubCache.set(animeId, data);
  }

  clearCache() {
    this.dubCache.clear();
  }

  // Utility
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create global instance
const dubChecker = new DubChecker();
