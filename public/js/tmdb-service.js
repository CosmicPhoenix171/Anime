/**
 * TMDB (The Movie Database) Service
 * 
 * Provides additional anime data from TMDB including:
 * - English dub availability via watch providers
 * - Trailers and videos
 * - Additional ratings
 * - Cast information
 * - Regional streaming availability
 * 
 * TMDB API Documentation: https://developer.themoviedb.org/docs
 */

class TMDBService {
  constructor() {
    // TMDB API v3 (free tier)
    this.API_BASE = 'https://api.themoviedb.org/3';
    this.IMAGE_BASE = 'https://image.tmdb.org/t/p';
    
    // You can get a free API key from https://www.themoviedb.org/settings/api
    // For now, we'll use a public read access token (v4 auth)
    this.API_KEY = ''; // Will be loaded from Firebase config
    this.READ_ACCESS_TOKEN = ''; // For v4 API
    
    // Cache for TMDB data
    this.cache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    
    // Rate limiting
    this.lastRequest = 0;
    this.RATE_LIMIT_MS = 250; // TMDB allows 40 requests per 10 seconds
    
    // US watch provider IDs that typically offer dubs
    this.DUB_PROVIDERS = {
      8: 'Netflix',
      15: 'Hulu',
      283: 'Crunchyroll',
      269: 'Funimation',
      531: 'Paramount+',
      337: 'Disney+',
      384: 'HBO Max',
      9: 'Amazon Prime Video',
      430: 'HiDive',
      1899: 'Max'
    };

    // Animation genre ID in TMDB
    this.ANIMATION_GENRE = 16;
    
    this.initialized = false;
  }

  /**
   * Initialize TMDB with API key from Firebase config
   */
  async initialize() {
    if (this.initialized) return true;
    
    try {
      // Try to get API key from Firebase config
      const configSnapshot = await refs.syncLog.child('config/tmdb').once('value');
      const config = configSnapshot.val();
      
      if (config?.apiKey) {
        this.API_KEY = config.apiKey;
        this.initialized = true;
        console.log('✅ TMDB Service initialized');
        return true;
      }
      
      // Fallback: Check if key exists in window config
      if (window.TMDB_API_KEY) {
        this.API_KEY = window.TMDB_API_KEY;
        this.initialized = true;
        return true;
      }
      
      console.warn('⚠️ TMDB API key not configured - some features will be limited');
      return false;
    } catch (error) {
      console.error('TMDB initialization error:', error);
      return false;
    }
  }

  /**
   * Search for an anime on TMDB by title
   * Returns the best matching result
   */
  async searchAnime(title, year = null) {
    if (!this.API_KEY) {
      await this.initialize();
      if (!this.API_KEY) return null;
    }

    const cacheKey = `search:${title}:${year}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      await this.rateLimit();

      // Clean title for search
      const cleanTitle = title
        .replace(/\s*\(.*?\)\s*/g, '') // Remove parenthetical
        .replace(/\s*Season\s*\d+/i, '') // Remove season numbers
        .replace(/\s*Part\s*\d+/i, '') // Remove part numbers
        .trim();

      // Search in both TV and movie
      const params = new URLSearchParams({
        api_key: this.API_KEY,
        query: cleanTitle,
        include_adult: false,
        language: 'en-US'
      });

      if (year) {
        params.append('first_air_date_year', year);
      }

      // Try TV search first (most anime are TV)
      let response = await fetch(`${this.API_BASE}/search/tv?${params}`);
      let data = await response.json();

      let results = (data.results || []).filter(r => 
        r.genre_ids?.includes(this.ANIMATION_GENRE) || 
        r.origin_country?.includes('JP')
      );

      // If no TV results, try movie search
      if (!results.length) {
        if (year) {
          params.set('year', year);
          params.delete('first_air_date_year');
        }
        response = await fetch(`${this.API_BASE}/search/movie?${params}`);
        data = await response.json();
        results = (data.results || []).filter(r => 
          r.genre_ids?.includes(this.ANIMATION_GENRE) ||
          r.original_language === 'ja'
        );
      }

      if (!results.length) return null;

      // Find best match
      const result = this.findBestMatch(results, cleanTitle, year);
      
      if (result) {
        this.saveToCache(cacheKey, result);
      }

      return result;

    } catch (error) {
      console.error('TMDB search error:', error);
      return null;
    }
  }

  /**
   * Get detailed info for a TV show or movie
   */
  async getDetails(tmdbId, type = 'tv') {
    if (!this.API_KEY) {
      await this.initialize();
      if (!this.API_KEY) return null;
    }

    const cacheKey = `details:${type}:${tmdbId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      await this.rateLimit();

      const params = new URLSearchParams({
        api_key: this.API_KEY,
        append_to_response: 'videos,watch/providers,external_ids,credits,translations',
        language: 'en-US'
      });

      const response = await fetch(`${this.API_BASE}/${type}/${tmdbId}?${params}`);
      
      if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Process and normalize the data
      const result = this.normalizeDetails(data, type);
      
      this.saveToCache(cacheKey, result);
      return result;

    } catch (error) {
      console.error('TMDB details error:', error);
      return null;
    }
  }

  /**
   * Get watch providers for a title (streaming availability)
   */
  async getWatchProviders(tmdbId, type = 'tv', region = 'US') {
    if (!this.API_KEY) {
      await this.initialize();
      if (!this.API_KEY) return null;
    }

    const cacheKey = `providers:${type}:${tmdbId}:${region}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      await this.rateLimit();

      const params = new URLSearchParams({
        api_key: this.API_KEY
      });

      const response = await fetch(`${this.API_BASE}/${type}/${tmdbId}/watch/providers?${params}`);
      const data = await response.json();

      const regionData = data.results?.[region] || {};
      
      const result = {
        link: regionData.link,
        flatrate: (regionData.flatrate || []).map(p => ({
          id: p.provider_id,
          name: p.provider_name,
          logo: `${this.IMAGE_BASE}/w92${p.logo_path}`
        })),
        rent: (regionData.rent || []).map(p => ({
          id: p.provider_id,
          name: p.provider_name,
          logo: `${this.IMAGE_BASE}/w92${p.logo_path}`
        })),
        buy: (regionData.buy || []).map(p => ({
          id: p.provider_id,
          name: p.provider_name,
          logo: `${this.IMAGE_BASE}/w92${p.logo_path}`
        })),
        free: (regionData.free || []).map(p => ({
          id: p.provider_id,
          name: p.provider_name,
          logo: `${this.IMAGE_BASE}/w92${p.logo_path}`
        }))
      };

      this.saveToCache(cacheKey, result);
      return result;

    } catch (error) {
      console.error('TMDB watch providers error:', error);
      return null;
    }
  }

  /**
   * Check if anime has English dub based on TMDB data
   */
  async checkDub(title, year = null) {
    try {
      // Search for the anime
      const searchResult = await this.searchAnime(title, year);
      if (!searchResult) return null;

      const type = searchResult.media_type || (searchResult.first_air_date ? 'tv' : 'movie');
      
      // Get full details including translations and watch providers
      const details = await this.getDetails(searchResult.id, type);
      if (!details) return null;

      const result = {
        hasDub: false,
        confidence: 0,
        platforms: [],
        tmdbId: searchResult.id,
        tmdbType: type,
        tmdbRating: details.vote_average,
        source: 'TMDB'
      };

      // Check translations for English audio
      if (details.translations?.translations) {
        const englishTrans = details.translations.translations.find(t => 
          t.iso_639_1 === 'en' && t.iso_3166_1 === 'US'
        );
        if (englishTrans?.data?.name || englishTrans?.data?.overview) {
          result.confidence += 10;
        }
      }

      // Check watch providers - if available on major US streaming, likely dubbed
      if (details.watchProviders) {
        const allProviders = [
          ...(details.watchProviders.flatrate || []),
          ...(details.watchProviders.free || [])
        ];

        for (const provider of allProviders) {
          const dubProvider = this.DUB_PROVIDERS[provider.id];
          if (dubProvider) {
            result.platforms.push(dubProvider);
            result.confidence += 15;
          }
        }
      }

      // If on multiple major streaming platforms, very likely has dub
      if (result.platforms.length >= 2) {
        result.hasDub = true;
        result.confidence = Math.min(result.confidence + 20, 100);
      } else if (result.platforms.length === 1) {
        // Single platform - possible dub
        result.hasDub = true;
        result.confidence = Math.min(result.confidence, 60);
      }

      // Check if there's an English version in spoken languages
      if (details.spoken_languages) {
        const hasEnglish = details.spoken_languages.some(l => l.iso_639_1 === 'en');
        if (hasEnglish) {
          result.hasDub = true;
          result.confidence += 30;
        }
      }

      // Check videos for English trailers
      if (details.videos?.results) {
        const englishTrailers = details.videos.results.filter(v => 
          v.iso_639_1 === 'en' && 
          (v.type === 'Trailer' || v.type === 'Clip')
        );
        if (englishTrailers.length > 0) {
          result.confidence += 10;
        }
      }

      result.confidence = Math.min(result.confidence, 100);
      
      return result;

    } catch (error) {
      console.error('TMDB dub check error:', error);
      return null;
    }
  }

  /**
   * Get trailers and videos for an anime
   */
  async getVideos(tmdbId, type = 'tv') {
    if (!this.API_KEY) {
      await this.initialize();
      if (!this.API_KEY) return [];
    }

    try {
      await this.rateLimit();

      const params = new URLSearchParams({
        api_key: this.API_KEY,
        language: 'en-US'
      });

      const response = await fetch(`${this.API_BASE}/${type}/${tmdbId}/videos?${params}`);
      const data = await response.json();

      return (data.results || []).map(v => ({
        id: v.id,
        key: v.key,
        name: v.name,
        site: v.site,
        type: v.type,
        official: v.official,
        url: v.site === 'YouTube' 
          ? `https://www.youtube.com/watch?v=${v.key}`
          : v.site === 'Vimeo'
            ? `https://vimeo.com/${v.key}`
            : null
      })).filter(v => v.url);

    } catch (error) {
      console.error('TMDB videos error:', error);
      return [];
    }
  }

  /**
   * Normalize TMDB details to a consistent format
   */
  normalizeDetails(data, type) {
    const isTV = type === 'tv';
    
    return {
      id: data.id,
      type: type,
      title: isTV ? data.name : data.title,
      originalTitle: isTV ? data.original_name : data.original_title,
      overview: data.overview,
      posterPath: data.poster_path 
        ? `${this.IMAGE_BASE}/w500${data.poster_path}` 
        : null,
      backdropPath: data.backdrop_path 
        ? `${this.IMAGE_BASE}/original${data.backdrop_path}` 
        : null,
      releaseDate: isTV ? data.first_air_date : data.release_date,
      voteAverage: data.vote_average,
      voteCount: data.vote_count,
      popularity: data.popularity,
      genres: (data.genres || []).map(g => g.name),
      runtime: isTV ? data.episode_run_time?.[0] : data.runtime,
      status: data.status,
      numberOfSeasons: isTV ? data.number_of_seasons : null,
      numberOfEpisodes: isTV ? data.number_of_episodes : null,
      
      // External IDs
      externalIds: data.external_ids || {},
      imdbId: data.external_ids?.imdb_id,
      
      // Videos/Trailers
      videos: (data.videos?.results || []).map(v => ({
        key: v.key,
        name: v.name,
        site: v.site,
        type: v.type
      })),
      
      // Watch providers (US)
      watchProviders: data['watch/providers']?.results?.US || null,
      
      // Translations
      translations: data.translations,
      
      // Spoken languages
      spoken_languages: data.spoken_languages,
      
      // Cast (voice actors)
      cast: (data.credits?.cast || []).slice(0, 10).map(c => ({
        id: c.id,
        name: c.name,
        character: c.character,
        profilePath: c.profile_path 
          ? `${this.IMAGE_BASE}/w185${c.profile_path}` 
          : null
      })),
      
      // Networks/Studios
      networks: isTV 
        ? (data.networks || []).map(n => n.name)
        : (data.production_companies || []).map(c => c.name)
    };
  }

  /**
   * Find best matching result from search
   */
  findBestMatch(results, title, year) {
    if (!results.length) return null;
    
    const titleLower = title.toLowerCase();
    
    // Score each result
    const scored = results.map(r => {
      let score = 0;
      const rTitle = (r.name || r.title || '').toLowerCase();
      const rOriginal = (r.original_name || r.original_title || '').toLowerCase();
      
      // Exact match
      if (rTitle === titleLower || rOriginal === titleLower) {
        score += 100;
      }
      // Starts with
      else if (rTitle.startsWith(titleLower) || titleLower.startsWith(rTitle)) {
        score += 50;
      }
      // Contains
      else if (rTitle.includes(titleLower) || titleLower.includes(rTitle)) {
        score += 30;
      }
      
      // Year match
      const rYear = (r.first_air_date || r.release_date || '').split('-')[0];
      if (year && rYear === String(year)) {
        score += 30;
      }
      
      // Japanese origin
      if (r.original_language === 'ja' || r.origin_country?.includes('JP')) {
        score += 20;
      }
      
      // Animation genre
      if (r.genre_ids?.includes(this.ANIMATION_GENRE)) {
        score += 20;
      }
      
      // Popularity boost
      score += Math.min(r.popularity / 10, 20);
      
      return { ...r, score };
    });
    
    // Sort by score
    scored.sort((a, b) => b.score - a.score);
    
    return scored[0];
  }

  /**
   * Get external links (IMDB, etc.) 
   */
  async getExternalLinks(tmdbId, type = 'tv') {
    if (!this.API_KEY) {
      await this.initialize();
      if (!this.API_KEY) return null;
    }

    try {
      await this.rateLimit();

      const params = new URLSearchParams({
        api_key: this.API_KEY
      });

      const response = await fetch(`${this.API_BASE}/${type}/${tmdbId}/external_ids?${params}`);
      const data = await response.json();

      const links = [];

      if (data.imdb_id) {
        links.push({
          site: 'IMDb',
          url: `https://www.imdb.com/title/${data.imdb_id}`,
          icon: '🎬'
        });
      }

      if (type === 'tv' && data.tvdb_id) {
        links.push({
          site: 'TheTVDB',
          url: `https://thetvdb.com/series/${data.tvdb_id}`,
          icon: '📺'
        });
      }

      if (data.facebook_id) {
        links.push({
          site: 'Facebook',
          url: `https://www.facebook.com/${data.facebook_id}`,
          icon: '📘'
        });
      }

      if (data.twitter_id) {
        links.push({
          site: 'Twitter',
          url: `https://twitter.com/${data.twitter_id}`,
          icon: '🐦'
        });
      }

      if (data.instagram_id) {
        links.push({
          site: 'Instagram',
          url: `https://www.instagram.com/${data.instagram_id}`,
          icon: '📷'
        });
      }

      // Add TMDB link
      links.push({
        site: 'TMDB',
        url: `https://www.themoviedb.org/${type}/${tmdbId}`,
        icon: '🎥'
      });

      return { ...data, links };

    } catch (error) {
      console.error('TMDB external links error:', error);
      return null;
    }
  }

  // Rate limiting
  async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.RATE_LIMIT_MS) {
      await this.delay(this.RATE_LIMIT_MS - elapsed);
    }
    this.lastRequest = Date.now();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cache methods
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  saveToCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clearCache() {
    this.cache.clear();
  }
}

// Create global instance
const tmdbService = new TMDBService();
