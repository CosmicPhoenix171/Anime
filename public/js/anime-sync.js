/**
 * Anime Sync Service - Client-Side
 * 
 * Handles syncing anime data from MULTIPLE APIs to Firebase:
 * - AniList (primary)
 * - Jikan/MyAnimeList (secondary)
 * - Kitsu (tertiary)
 * - TMDB (for streaming/trailer info)
 * 
 * Uses a hierarchical enrichment system where each API can fill in
 * missing data from other sources.
 */

class AnimeSync {
  constructor() {
    // AniList API (primary source)
    this.ANILIST_API = 'https://graphql.anilist.co';
    
    // Jikan API v4 (MyAnimeList data - secondary source)
    this.JIKAN_API = 'https://api.jikan.moe/v4';
    
    // Kitsu API (tertiary source)
    this.KITSU_API = 'https://kitsu.io/api/edge';
    
    // TMDB API (for streaming/trailer info)
    this.TMDB_API = 'https://api.themoviedb.org/3';
    
    this.RATE_LIMIT_MS = 800; // AniList rate limit
    this.JIKAN_RATE_LIMIT_MS = 1000; // Jikan rate limit (more strict)
    this.KITSU_RATE_LIMIT_MS = 500;
    this.onProgress = null;
    
    // Enrichment hierarchy - defines which API to try first for each field
    this.ENRICHMENT_HIERARCHY = {
      title: ['anilist', 'jikan', 'kitsu', 'tmdb'],
      titleRomaji: ['anilist', 'kitsu', 'jikan'],
      titleEnglish: ['anilist', 'tmdb', 'kitsu', 'jikan'],
      titleNative: ['anilist', 'jikan', 'kitsu'],
      description: ['anilist', 'tmdb', 'kitsu', 'jikan'],
      episodes: ['anilist', 'jikan', 'kitsu'],
      duration: ['anilist', 'kitsu', 'jikan'],
      score: ['anilist', 'jikan', 'kitsu'],
      popularity: ['anilist', 'jikan', 'kitsu'],
      coverImage: ['anilist', 'kitsu', 'jikan', 'tmdb'],
      bannerImage: ['anilist', 'kitsu', 'tmdb'],
      genres: ['anilist', 'jikan', 'kitsu'],
      studios: ['anilist', 'jikan', 'kitsu'],
      startDate: ['anilist', 'jikan', 'kitsu'],
      endDate: ['anilist', 'jikan', 'kitsu'],
      trailer: ['tmdb', 'anilist'],
      nextEpisode: ['anilist'],
      nextEpisodeAt: ['anilist'],
      broadcast: ['jikan'],
      licensors: ['jikan'],
      producers: ['jikan'],
      themes: ['jikan'],
      demographics: ['jikan']
    };
  }

  /**
   * Get current anime season
   */
  getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 1 && month <= 3) return 'WINTER';
    if (month >= 4 && month <= 6) return 'SPRING';
    if (month >= 7 && month <= 9) return 'SUMMER';
    return 'FALL';
  }

  getCurrentYear() {
    return new Date().getFullYear();
  }

  getNextSeason() {
    const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
    const current = this.getCurrentSeason();
    const idx = seasons.indexOf(current);
    if (idx === 3) {
      return { season: 'WINTER', year: this.getCurrentYear() + 1 };
    }
    return { season: seasons[idx + 1], year: this.getCurrentYear() };
  }

  getPreviousSeason() {
    const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
    const current = this.getCurrentSeason();
    const idx = seasons.indexOf(current);
    if (idx === 0) {
      return { season: 'FALL', year: this.getCurrentYear() - 1 };
    }
    return { season: seasons[idx - 1], year: this.getCurrentYear() };
  }

  // ============================================================
  // PHASE 1: INDIVIDUAL API SEARCH METHODS
  // ============================================================

  /**
   * Search AniList for anime by season (with expanded fields)
   */
  async searchAniListSeason(season, year) {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;

    const query = `
      query ($season: MediaSeason, $year: Int, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
            id
            idMal
            isAdult
            title { romaji english native }
            synonyms
            season
            seasonYear
            status
            episodes
            duration
            nextAiringEpisode { episode airingAt }
            format
            genres
            averageScore
            meanScore
            popularity
            coverImage { large extraLarge color }
            bannerImage
            description(asHtml: false)
            studios(isMain: true) { nodes { name } }
            startDate { year month day }
            endDate { year month day }
            trailer { id site thumbnail }
            countryOfOrigin
            source
          }
        }
      }
    `;

    while (hasNextPage) {
      try {
        const response = await fetch(this.ANILIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { season, year, page } })
        });

        const data = await response.json();
        if (data.errors) break;

        const pageData = data.data.Page;
        allAnime.push(...pageData.media.map(m => ({
          ...m,
          _source: 'anilist',
          _sourceId: m.id
        })));

        hasNextPage = pageData.pageInfo.hasNextPage;
        page++;
        await this.sleep(this.RATE_LIMIT_MS);
      } catch (error) {
        console.error('AniList search error:', error);
        break;
      }
    }

    console.log(`🔍 AniList: Found ${allAnime.length} anime for ${season} ${year}`);
    return allAnime;
  }

  /**
   * Search Jikan/MAL for anime by season (includes synonyms and alt titles)
   */
  async searchJikanSeason(season, year) {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;
    const jikanSeason = season.toLowerCase();

    while (hasNextPage && page <= 10) {
      try {
        const response = await fetch(
          `${this.JIKAN_API}/seasons/${year}/${jikanSeason}?page=${page}`
        );

        if (!response.ok) break;
        const data = await response.json();

        if (data.data) {
          allAnime.push(...data.data.map(m => ({
            ...m,
            _source: 'jikan',
            _sourceId: m.mal_id
          })));
        }

        hasNextPage = data.pagination?.has_next_page || false;
        page++;
        await this.sleep(this.JIKAN_RATE_LIMIT_MS);
      } catch (error) {
        console.error('Jikan search error:', error);
        break;
      }
    }

    console.log(`🔍 Jikan: Found ${allAnime.length} anime for ${season} ${year}`);
    return allAnime;
  }

  /**
   * Search Kitsu for anime by season (includes ID mappings)
   */
  async searchKitsuSeason(season, year) {
    const allAnime = [];
    let offset = 0;
    const limit = 20;
    let hasMore = true;

    while (hasMore && offset < 200) {
      try {
        const params = new URLSearchParams({
          'filter[seasonYear]': year,
          'filter[season]': season.toLowerCase(),
          'page[limit]': limit,
          'page[offset]': offset,
          'sort': '-userCount',
          'include': 'mappings'
        });

        const response = await fetch(`${this.KITSU_API}/anime?${params}`, {
          headers: {
            'Accept': 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json'
          }
        });

        if (!response.ok) break;
        const data = await response.json();

        if (data.data?.length > 0) {
          // Extract mappings to get MAL/AniList IDs
          const mappings = this.extractKitsuMappings(data);

          allAnime.push(...data.data.map(m => ({
            ...m,
            _source: 'kitsu',
            _sourceId: m.id,
            _mappings: mappings[m.id] || {}
          })));

          offset += limit;
          hasMore = data.data.length === limit;
        } else {
          hasMore = false;
        }

        await this.sleep(this.KITSU_RATE_LIMIT_MS);
      } catch (error) {
        console.error('Kitsu search error:', error);
        break;
      }
    }

    console.log(`🔍 Kitsu: Found ${allAnime.length} anime for ${season} ${year}`);
    return allAnime;
  }

  /**
   * Extract external ID mappings from Kitsu included data
   */
  extractKitsuMappings(kitsuResponse) {
    const mappings = {};

    if (kitsuResponse.included) {
      for (const item of kitsuResponse.included) {
        if (item.type === 'mappings') {
          const animeId = item.relationships?.item?.data?.id;
          if (animeId) {
            if (!mappings[animeId]) mappings[animeId] = {};

            const site = item.attributes.externalSite;
            const externalId = item.attributes.externalId;

            if (site === 'myanimelist/anime') {
              mappings[animeId].malId = parseInt(externalId);
            } else if (site === 'anilist/anime') {
              mappings[animeId].anilistId = parseInt(externalId);
            }
          }
        }
      }
    }

    return mappings;
  }

  /**
   * Search TMDB for anime by season
   */
  async searchTMDBSeason(season, year) {
    // Check if TMDB service is available
    if (typeof tmdbService === 'undefined' || !tmdbService.API_KEY) {
      await tmdbService?.initialize?.();
      if (!tmdbService?.API_KEY) {
        console.log('🔍 TMDB: Skipped (no API key)');
        return [];
      }
    }

    const allAnime = [];
    const seasonDates = {
      'WINTER': { start: `${year}-01-01`, end: `${year}-03-31` },
      'SPRING': { start: `${year}-04-01`, end: `${year}-06-30` },
      'SUMMER': { start: `${year}-07-01`, end: `${year}-09-30` },
      'FALL': { start: `${year}-10-01`, end: `${year}-12-31` }
    };

    const dates = seasonDates[season];
    if (!dates) return [];

    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 5) {
      try {
        const params = new URLSearchParams({
          api_key: tmdbService.API_KEY,
          with_genres: '16', // Animation
          with_origin_country: 'JP',
          'first_air_date.gte': dates.start,
          'first_air_date.lte': dates.end,
          sort_by: 'popularity.desc',
          page: page
        });

        const response = await fetch(`${this.TMDB_API}/discover/tv?${params}`);

        if (!response.ok) break;
        const data = await response.json();

        if (data.results) {
          allAnime.push(...data.results.map(m => ({
            ...m,
            _source: 'tmdb',
            _sourceId: m.id
          })));
        }

        totalPages = Math.min(data.total_pages || 1, 5);
        page++;
        await this.sleep(250);
      } catch (error) {
        console.error('TMDB search error:', error);
        break;
      }
    }

    console.log(`🔍 TMDB: Found ${allAnime.length} anime for ${season} ${year}`);
    return allAnime;
  }

  // ============================================================
  // PHASE 2: UNIFIED LIST CREATION WITH DEDUPLICATION
  // ============================================================

  /**
   * Normalize a title for matching
   */
  normalizeTitle(title) {
    if (!title) return '';
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\b(the|a|an)\b/g, '')
      .replace(/\s*(season|part|cour)\s*\d+/gi, '')
      .replace(/\s*(2nd|3rd|\d+th)\s*season/gi, '')
      .trim();
  }

  /**
   * Fuzzy title matching using similarity
   */
  fuzzyMatch(str1, str2, threshold = 0.85) {
    if (!str1 || !str2) return false;
    if (str1 === str2) return true;

    // Quick substring check
    if (str1.includes(str2) || str2.includes(str1)) return true;

    // Levenshtein distance
    const len1 = str1.length;
    const len2 = str2.length;

    if (Math.abs(len1 - len2) > Math.max(len1, len2) * (1 - threshold)) {
      return false;
    }

    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));

    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;

    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    const distance = matrix[len2][len1];
    const similarity = 1 - distance / Math.max(len1, len2);
    return similarity >= threshold;
  }

  /**
   * Create unified list from all API sources with deduplication
   */
  createUnifiedList(results) {
    const unified = new Map();
    const titleIndex = new Map();

    // Helper to generate canonical ID
    const getCanonicalId = (malId, anilistId, kitsuId, title) => {
      if (anilistId) return `al_${anilistId}`;
      if (malId) return `mal_${malId}`;
      if (kitsuId) return `kitsu_${kitsuId}`;
      return `title_${this.normalizeTitle(title).replace(/\s/g, '_')}`;
    };

    // Process AniList first (highest priority)
    console.log('📊 Processing AniList results...');
    for (const anime of results.anilist || []) {
      const normalized = this.normalizeAniListData(anime);
      const canonicalId = getCanonicalId(normalized.malId, normalized.anilistId, null, normalized.title);

      unified.set(canonicalId, {
        canonicalId,
        ...normalized,
        _sources: { anilist: anime }
      });

      // Index titles
      [normalized.title, normalized.titleRomaji, normalized.titleEnglish, ...(normalized.synonyms || [])]
        .filter(Boolean)
        .forEach(t => titleIndex.set(this.normalizeTitle(t), canonicalId));
    }

    // Process Jikan results
    console.log('📊 Processing Jikan results...');
    for (const anime of results.jikan || []) {
      const normalized = this.normalizeJikanData(anime);

      // Check if already exists
      let existingId = null;
      if (normalized.malId && unified.has(`mal_${normalized.malId}`)) {
        existingId = `mal_${normalized.malId}`;
      } else {
        // Check by AniList ID match
        for (const [id, entry] of unified) {
          if (entry.malId === normalized.malId) {
            existingId = id;
            break;
          }
        }
      }

      if (!existingId) {
        // Check by title
        const titleKey = this.normalizeTitle(normalized.title);
        if (titleIndex.has(titleKey)) {
          existingId = titleIndex.get(titleKey);
        }
      }

      if (existingId) {
        const existing = unified.get(existingId);
        existing._sources.jikan = anime;
        if (!existing.malId && normalized.malId) existing.malId = normalized.malId;
        // Merge synonyms
        if (normalized.synonyms?.length) {
          existing.synonyms = [...new Set([...(existing.synonyms || []), ...normalized.synonyms])];
        }
        if (normalized.altTitles?.length) {
          existing.altTitles = [...(existing.altTitles || []), ...normalized.altTitles];
        }
      } else {
        const canonicalId = getCanonicalId(normalized.malId, null, null, normalized.title);
        unified.set(canonicalId, {
          canonicalId,
          ...normalized,
          _sources: { jikan: anime }
        });

        [normalized.title, normalized.titleRomaji, normalized.titleEnglish]
          .filter(Boolean)
          .forEach(t => titleIndex.set(this.normalizeTitle(t), canonicalId));
      }
    }

    // Process Kitsu results
    console.log('📊 Processing Kitsu results...');
    for (const anime of results.kitsu || []) {
      const normalized = this.normalizeKitsuData(anime);
      const mappings = anime._mappings || {};

      let existingId = null;
      if (mappings.malId && unified.has(`mal_${mappings.malId}`)) {
        existingId = `mal_${mappings.malId}`;
      } else if (mappings.anilistId && unified.has(`al_${mappings.anilistId}`)) {
        existingId = `al_${mappings.anilistId}`;
      }

      if (!existingId) {
        const titleKey = this.normalizeTitle(normalized.title);
        if (titleIndex.has(titleKey)) {
          existingId = titleIndex.get(titleKey);
        }
      }

      if (existingId) {
        const existing = unified.get(existingId);
        existing._sources.kitsu = anime;
        existing.kitsuId = normalized.kitsuId;
        if (mappings.malId && !existing.malId) existing.malId = mappings.malId;
        if (mappings.anilistId && !existing.anilistId) existing.anilistId = mappings.anilistId;
      } else {
        const canonicalId = getCanonicalId(mappings.malId, mappings.anilistId, normalized.kitsuId, normalized.title);
        unified.set(canonicalId, {
          canonicalId,
          ...normalized,
          _sources: { kitsu: anime }
        });

        [normalized.title, normalized.titleRomaji, normalized.titleEnglish]
          .filter(Boolean)
          .forEach(t => titleIndex.set(this.normalizeTitle(t), canonicalId));
      }
    }

    // Process TMDB results (enrichment only, don't create new entries)
    console.log('📊 Processing TMDB results...');
    for (const anime of results.tmdb || []) {
      const normalized = this.normalizeTMDBData(anime);
      const titleKey = this.normalizeTitle(normalized.title);

      if (titleIndex.has(titleKey)) {
        const existingId = titleIndex.get(titleKey);
        const existing = unified.get(existingId);
        existing._sources.tmdb = anime;
        existing.tmdbId = normalized.tmdbId;
      }
    }

    const unifiedList = Array.from(unified.values());
    console.log(`📊 Unified list: ${unifiedList.length} unique anime (from ${(results.anilist?.length||0) + (results.jikan?.length||0) + (results.kitsu?.length||0) + (results.tmdb?.length||0)} total)`);
    return unifiedList;
  }

  // ============================================================
  // PHASE 2B: DATA NORMALIZATION METHODS
  // ============================================================

  /**
   * Normalize AniList data to unified format
   */
  normalizeAniListData(anilist) {
    return {
      anilistId: anilist.id,
      malId: anilist.idMal || null,
      title: anilist.title?.english || anilist.title?.romaji,
      titleRomaji: anilist.title?.romaji,
      titleEnglish: anilist.title?.english,
      titleNative: anilist.title?.native,
      synonyms: anilist.synonyms || [],
      season: anilist.season,
      year: anilist.seasonYear,
      status: anilist.status,
      episodes: anilist.episodes,
      duration: anilist.duration,
      nextEpisode: anilist.nextAiringEpisode?.episode,
      nextEpisodeAt: anilist.nextAiringEpisode?.airingAt
        ? new Date(anilist.nextAiringEpisode.airingAt * 1000).toISOString()
        : null,
      format: anilist.format,
      genres: anilist.genres || [],
      score: anilist.averageScore,
      popularity: anilist.popularity,
      coverImage: anilist.coverImage?.extraLarge || anilist.coverImage?.large,
      coverColor: anilist.coverImage?.color,
      bannerImage: anilist.bannerImage,
      description: anilist.description,
      studios: anilist.studios?.nodes?.map(s => s.name) || [],
      startDate: this.formatDate(anilist.startDate),
      endDate: this.formatDate(anilist.endDate),
      trailer: anilist.trailer ? {
        id: anilist.trailer.id,
        site: anilist.trailer.site,
        thumbnail: anilist.trailer.thumbnail
      } : null,
      isAdult: anilist.isAdult || false,
      countryOfOrigin: anilist.countryOfOrigin,
      source: 'anilist'
    };
  }

  /**
   * Normalize Jikan data to unified format
   */
  normalizeJikanData(jikan) {
    const statusMap = {
      'Currently Airing': 'RELEASING',
      'Finished Airing': 'FINISHED',
      'Not yet aired': 'NOT_YET_RELEASED'
    };

    let season = jikan.season?.toUpperCase() || null;
    let seasonYear = jikan.year || null;

    if (!season && jikan.aired?.from) {
      const airDate = new Date(jikan.aired.from);
      seasonYear = airDate.getFullYear();
      const month = airDate.getMonth() + 1;
      if (month >= 1 && month <= 3) season = 'WINTER';
      else if (month >= 4 && month <= 6) season = 'SPRING';
      else if (month >= 7 && month <= 9) season = 'SUMMER';
      else season = 'FALL';
    }

    return {
      malId: jikan.mal_id,
      title: jikan.title_english || jikan.title,
      titleRomaji: jikan.title,
      titleEnglish: jikan.title_english,
      titleNative: jikan.title_japanese,
      synonyms: jikan.title_synonyms || [],
      altTitles: jikan.titles?.map(t => ({ type: t.type, title: t.title })) || [],
      season: season,
      year: seasonYear,
      status: statusMap[jikan.status] || 'RELEASING',
      episodes: jikan.episodes,
      duration: jikan.duration ? this.parseDuration(jikan.duration) : null,
      format: jikan.type === 'TV' ? 'TV' : jikan.type,
      genres: jikan.genres?.map(g => g.name) || [],
      themes: jikan.themes?.map(t => t.name) || [],
      demographics: jikan.demographics?.map(d => d.name) || [],
      score: jikan.score ? Math.round(jikan.score * 10) : null,
      popularity: jikan.members || 0,
      coverImage: jikan.images?.jpg?.large_image_url || jikan.images?.jpg?.image_url,
      description: jikan.synopsis,
      studios: jikan.studios?.map(s => s.name) || [],
      producers: jikan.producers?.map(p => p.name) || [],
      licensors: jikan.licensors?.map(l => l.name) || [],
      startDate: jikan.aired?.from ? this.formatDateFromString(jikan.aired.from) : null,
      endDate: jikan.aired?.to ? this.formatDateFromString(jikan.aired.to) : null,
      broadcast: jikan.broadcast?.string || null,
      isAdult: jikan.rating?.includes('Rx') || jikan.genres?.some(g => g.name === 'Hentai'),
      rating: jikan.rating,
      source: 'jikan'
    };
  }

  /**
   * Normalize Kitsu data to unified format
   */
  normalizeKitsuData(kitsu) {
    const attrs = kitsu.attributes;
    const statusMap = {
      'current': 'RELEASING',
      'finished': 'FINISHED',
      'upcoming': 'NOT_YET_RELEASED',
      'tba': 'NOT_YET_RELEASED'
    };

    let season = null;
    let seasonYear = null;
    if (attrs.startDate) {
      const startDate = new Date(attrs.startDate);
      seasonYear = startDate.getFullYear();
      const month = startDate.getMonth() + 1;
      if (month >= 1 && month <= 3) season = 'WINTER';
      else if (month >= 4 && month <= 6) season = 'SPRING';
      else if (month >= 7 && month <= 9) season = 'SUMMER';
      else season = 'FALL';
    }

    return {
      kitsuId: kitsu.id,
      malId: kitsu._mappings?.malId || null,
      anilistId: kitsu._mappings?.anilistId || null,
      title: attrs.titles?.en || attrs.titles?.en_us || attrs.canonicalTitle,
      titleRomaji: attrs.titles?.en_jp || attrs.canonicalTitle,
      titleEnglish: attrs.titles?.en || attrs.titles?.en_us,
      titleNative: attrs.titles?.ja_jp,
      synonyms: attrs.abbreviatedTitles || [],
      season: season,
      year: seasonYear,
      status: statusMap[attrs.status] || 'RELEASING',
      episodes: attrs.episodeCount,
      duration: attrs.episodeLength,
      format: attrs.subtype?.toUpperCase() || 'TV',
      score: attrs.averageRating ? Math.round(parseFloat(attrs.averageRating)) : null,
      popularity: attrs.userCount || 0,
      coverImage: attrs.posterImage?.original || attrs.posterImage?.large,
      bannerImage: attrs.coverImage?.original,
      description: attrs.synopsis,
      startDate: attrs.startDate,
      endDate: attrs.endDate,
      isAdult: attrs.nsfw || false,
      ageRating: attrs.ageRating,
      source: 'kitsu'
    };
  }

  /**
   * Normalize TMDB data to unified format
   */
  normalizeTMDBData(tmdb) {
    return {
      tmdbId: tmdb.id,
      title: tmdb.name,
      titleOriginal: tmdb.original_name,
      description: tmdb.overview,
      coverImage: tmdb.poster_path
        ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`
        : null,
      bannerImage: tmdb.backdrop_path
        ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}`
        : null,
      score: tmdb.vote_average ? Math.round(tmdb.vote_average * 10) : null,
      popularity: tmdb.popularity,
      startDate: tmdb.first_air_date,
      source: 'tmdb'
    };
  }

  /**
   * Parse duration string to minutes
   */
  parseDuration(durationStr) {
    if (!durationStr) return null;
    const match = durationStr.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Format date from ISO string
   */
  formatDateFromString(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  // ============================================================
  // PHASE 3: HIERARCHICAL ENRICHMENT
  // ============================================================

  /**
   * Check if a value is valid (not null/undefined/empty)
   */
  isValidValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }

  /**
   * Merge arrays from multiple sources
   */
  mergeArrays(arrays) {
    const merged = new Set();
    for (const arr of arrays) {
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'string') merged.add(item);
        }
      }
    }
    return Array.from(merged);
  }

  /**
   * Enrich anime data by cascading through all available sources
   */
  async enrichAnimeData(unifiedAnime) {
    const enriched = {
      canonicalId: unifiedAnime.canonicalId,
      anilistId: unifiedAnime.anilistId || null,
      malId: unifiedAnime.malId || null,
      kitsuId: unifiedAnime.kitsuId || null,
      tmdbId: unifiedAnime.tmdbId || null,
      _enrichedFrom: [],
      _enrichedAt: Date.now()
    };

    const sources = unifiedAnime._sources || {};

    // Normalize each source's data
    const normalizedSources = {
      anilist: sources.anilist ? this.normalizeAniListData(sources.anilist) : null,
      jikan: sources.jikan ? this.normalizeJikanData(sources.jikan) : null,
      kitsu: sources.kitsu ? this.normalizeKitsuData(sources.kitsu) : null,
      tmdb: sources.tmdb ? this.normalizeTMDBData(sources.tmdb) : null
    };

    // Track which sources contributed
    for (const [sourceName, sourceData] of Object.entries(normalizedSources)) {
      if (sourceData) enriched._enrichedFrom.push(sourceName);
    }

    // Go through each field in the hierarchy
    for (const [field, priorityOrder] of Object.entries(this.ENRICHMENT_HIERARCHY)) {
      let value = null;

      for (const sourceName of priorityOrder) {
        const sourceData = normalizedSources[sourceName];
        if (sourceData && this.isValidValue(sourceData[field])) {
          value = sourceData[field];
          break;
        }
      }

      if (value !== null) {
        enriched[field] = value;
      }
    }

    // Special handling: Merge arrays from ALL sources
    enriched.synonyms = this.mergeArrays([
      normalizedSources.anilist?.synonyms,
      normalizedSources.jikan?.synonyms,
      normalizedSources.kitsu?.synonyms
    ]);

    enriched.genres = this.mergeArrays([
      normalizedSources.anilist?.genres,
      normalizedSources.jikan?.genres,
      normalizedSources.kitsu?.genres
    ]);

    enriched.studios = this.mergeArrays([
      normalizedSources.anilist?.studios,
      normalizedSources.jikan?.studios
    ]);

    // Jikan-specific fields
    if (normalizedSources.jikan) {
      enriched.themes = normalizedSources.jikan.themes || [];
      enriched.demographics = normalizedSources.jikan.demographics || [];
      enriched.producers = normalizedSources.jikan.producers || [];
      enriched.licensors = normalizedSources.jikan.licensors || [];
      enriched.altTitles = normalizedSources.jikan.altTitles || [];
    }

    // Fetch TMDB enrichment if we don't have it but have a title
    if (!sources.tmdb && (enriched.title || enriched.titleEnglish)) {
      const tmdbData = await this.fetchTMDBEnrichment(enriched);
      if (tmdbData) {
        enriched.tmdbId = tmdbData.tmdbId;
        if (!enriched.trailer && tmdbData.trailer) enriched.trailer = tmdbData.trailer;
        if (!enriched.bannerImage && tmdbData.bannerImage) enriched.bannerImage = tmdbData.bannerImage;
        enriched.watchProviders = tmdbData.watchProviders;
        enriched._enrichedFrom.push('tmdb');
      }
    }

    return enriched;
  }

  /**
   * Fetch TMDB data for enrichment
   */
  async fetchTMDBEnrichment(anime) {
    if (typeof tmdbService === 'undefined' || !tmdbService.API_KEY) {
      return null;
    }

    try {
      const searchTitle = anime.titleEnglish || anime.title || anime.titleRomaji;
      const searchResult = await tmdbService.searchAnime(searchTitle, anime.year);
      if (!searchResult) return null;

      const details = await tmdbService.getDetails(searchResult.id, 'tv');
      if (!details) return null;

      const result = {
        tmdbId: searchResult.id,
        bannerImage: details.backdrop_path
          ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
          : null,
        watchProviders: null,
        trailer: null
      };

      // Get trailer
      if (details.videos?.results?.length) {
        const trailer = details.videos.results.find(v =>
          v.type === 'Trailer' && v.site === 'YouTube'
        ) || details.videos.results[0];

        if (trailer) {
          result.trailer = {
            id: trailer.key,
            site: 'YouTube',
            url: `https://www.youtube.com/watch?v=${trailer.key}`
          };
        }
      }

      return result;
    } catch (error) {
      console.warn('TMDB enrichment failed:', error);
      return null;
    }
  }

  // ============================================================
  // PHASE 4: COMPREHENSIVE SYNC (NEW VERSION)
  // ============================================================

  /**
   * NEW: Comprehensive season sync using hierarchical multi-API system
   * 
   * Flow:
   * 1. Search ALL 4 APIs independently in parallel
   * 2. Combine into unified deduplicated list
   * 3. Enrich each anime by cascading through sources
   * 4. Save to Firebase
   */
  async comprehensiveSeasonSyncV2(season, year) {
    const startTime = Date.now();
    let added = 0;
    let updated = 0;
    const errors = [];

    try {
      // ========== PHASE 1: Parallel API Searches ==========
      this.updateProgress(5, 'Phase 1: Searching all 4 APIs in parallel...');

      const [anilistResults, jikanResults, kitsuResults, tmdbResults] = await Promise.all([
        this.searchAniListSeason(season, year).catch(e => { errors.push({ source: 'anilist', error: e.message }); return []; }),
        this.searchJikanSeason(season, year).catch(e => { errors.push({ source: 'jikan', error: e.message }); return []; }),
        this.searchKitsuSeason(season, year).catch(e => { errors.push({ source: 'kitsu', error: e.message }); return []; }),
        this.searchTMDBSeason(season, year).catch(e => { errors.push({ source: 'tmdb', error: e.message }); return []; })
      ]);

      const results = {
        anilist: anilistResults,
        jikan: jikanResults,
        kitsu: kitsuResults,
        tmdb: tmdbResults
      };

      const totalRaw = anilistResults.length + jikanResults.length + kitsuResults.length + tmdbResults.length;
      this.updateProgress(25, `Phase 1 complete: ${totalRaw} results from all sources`);

      // ========== PHASE 2: Create Unified List ==========
      this.updateProgress(30, 'Phase 2: Deduplicating and combining results...');

      const unifiedList = this.createUnifiedList(results);
      this.updateProgress(40, `Phase 2 complete: ${unifiedList.length} unique anime`);

      // ========== PHASE 3: Hierarchical Enrichment ==========
      this.updateProgress(45, 'Phase 3: Enriching each anime from all sources...');

      const enrichedAnime = [];
      for (let i = 0; i < unifiedList.length; i++) {
        const enriched = await this.enrichAnimeData(unifiedList[i]);
        enrichedAnime.push(enriched);

        if (i % 10 === 0) {
          const progress = 45 + (i / unifiedList.length) * 30;
          this.updateProgress(progress, `Enriching ${i + 1}/${unifiedList.length} anime...`);
        }
      }

      this.updateProgress(75, `Phase 3 complete: ${enrichedAnime.length} anime enriched`);

      // ========== PHASE 4: Save to Firebase ==========
      this.updateProgress(80, 'Phase 4: Saving to Firebase...');

      for (let i = 0; i < enrichedAnime.length; i++) {
        const anime = enrichedAnime[i];
        const result = await this.saveEnrichedAnime(anime);

        if (result.isNew) added++;
        else updated++;

        if (i % 20 === 0) {
          const progress = 80 + (i / enrichedAnime.length) * 18;
          this.updateProgress(progress, `Saving ${i + 1}/${enrichedAnime.length} anime...`);
        }
      }

      // Log results
      const duration = Date.now() - startTime;
      const syncResult = {
        season,
        year,
        added,
        updated,
        total: enrichedAnime.length,
        sources: {
          anilist: anilistResults.length,
          jikan: jikanResults.length,
          kitsu: kitsuResults.length,
          tmdb: tmdbResults.length
        },
        errors: errors.length > 0 ? errors : null,
        duration: `${(duration / 1000).toFixed(1)}s`,
        timestamp: Date.now()
      };

      await refs.syncLog.child(`comprehensive/${season}_${year}`).set(syncResult);

      this.updateProgress(100, `Complete! ${added} added, ${updated} updated from 4 APIs`);
      console.log('✅ Comprehensive sync complete:', syncResult);

      return syncResult;

    } catch (error) {
      console.error('Comprehensive sync failed:', error);
      this.updateProgress(0, `Sync failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save enriched anime to Firebase
   */
  async saveEnrichedAnime(enrichedAnime) {
    // Determine canonical Firebase ID
    let animeId;
    if (enrichedAnime.anilistId) {
      animeId = `al_${enrichedAnime.anilistId}`;
    } else if (enrichedAnime.malId) {
      animeId = `mal_${enrichedAnime.malId}`;
    } else if (enrichedAnime.kitsuId) {
      animeId = `kitsu_${enrichedAnime.kitsuId}`;
    } else {
      const titleSlug = (enrichedAnime.titleRomaji || enrichedAnime.title || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .substring(0, 50);
      animeId = `title_${titleSlug}`;
    }

    // Get existing data to preserve user contributions
    const existingSnapshot = await refs.anime.child(animeId).once('value');
    const existing = existingSnapshot.val() || {};

    const animeData = {
      // IDs
      anilistId: enrichedAnime.anilistId || existing.anilistId || null,
      malId: enrichedAnime.malId || existing.malId || null,
      kitsuId: enrichedAnime.kitsuId || existing.kitsuId || null,
      tmdbId: enrichedAnime.tmdbId || existing.tmdbId || null,

      // Titles
      title: enrichedAnime.title || existing.title,
      titleRomaji: enrichedAnime.titleRomaji || existing.titleRomaji,
      titleEnglish: enrichedAnime.titleEnglish || existing.titleEnglish,
      titleNative: enrichedAnime.titleNative || existing.titleNative,
      synonyms: enrichedAnime.synonyms || existing.synonyms || [],
      altTitles: enrichedAnime.altTitles || existing.altTitles || [],

      // Season
      season: enrichedAnime.season || existing.season,
      year: enrichedAnime.year || existing.year,
      status: enrichedAnime.status || existing.status,
      format: enrichedAnime.format || existing.format,

      // Episodes
      episodes: enrichedAnime.episodes ?? existing.episodes,
      duration: enrichedAnime.duration ?? existing.duration,
      nextEpisode: enrichedAnime.nextEpisode ?? existing.nextEpisode,
      nextEpisodeAt: enrichedAnime.nextEpisodeAt || existing.nextEpisodeAt,
      broadcast: enrichedAnime.broadcast || existing.broadcast,

      // Scores
      score: enrichedAnime.score ?? existing.score,
      popularity: enrichedAnime.popularity || existing.popularity || 0,

      // Media
      coverImage: enrichedAnime.coverImage || existing.coverImage,
      coverColor: enrichedAnime.coverColor || existing.coverColor,
      bannerImage: enrichedAnime.bannerImage || existing.bannerImage,
      trailer: enrichedAnime.trailer || existing.trailer,

      // Content
      description: enrichedAnime.description || existing.description,
      genres: enrichedAnime.genres || existing.genres || [],
      themes: enrichedAnime.themes || existing.themes || [],
      demographics: enrichedAnime.demographics || existing.demographics || [],
      studios: enrichedAnime.studios || existing.studios || [],
      producers: enrichedAnime.producers || existing.producers || [],
      licensors: enrichedAnime.licensors || existing.licensors || [],

      // Dates
      startDate: enrichedAnime.startDate || existing.startDate,
      endDate: enrichedAnime.endDate || existing.endDate,

      // Streaming
      watchProviders: enrichedAnime.watchProviders || existing.watchProviders,

      // Flags
      isAdult: enrichedAnime.isAdult ?? existing.isAdult ?? false,

      // Metadata
      _enrichedFrom: enrichedAnime._enrichedFrom || [],
      _enrichedAt: enrichedAnime._enrichedAt || Date.now(),
      updatedAt: Date.now(),

      // PRESERVE USER DATA
      hasDub: existing.hasDub ?? null,
      dubConfidence: existing.dubConfidence ?? null,
      dubPlatforms: existing.dubPlatforms ?? null,
      dubEpisodes: existing.dubEpisodes ?? null,
      dubStatus: existing.dubStatus ?? null,
      dubSources: existing.dubSources ?? null,
      dubCheckedAt: existing.dubCheckedAt ?? null,
      dubOverride: existing.dubOverride ?? null
    };

    // Clean nulls
    Object.keys(animeData).forEach(key => {
      if (animeData[key] === undefined) animeData[key] = null;
    });

    const isNew = !existingSnapshot.exists();
    if (isNew) animeData.createdAt = Date.now();

    await refs.anime.child(animeId).update(animeData);
    return { isNew, id: animeId };
  }

  /**
   * Check if sync is needed based on last sync time
   */
  async checkSyncNeeded() {
    try {
      const snapshot = await refs.syncLog.child('lastSync').once('value');
      const lastSync = snapshot.val();
      
      if (!lastSync) {
        return { needed: true, type: 'full', reason: 'No previous sync' };
      }

      const now = Date.now();
      const hoursSinceSync = (now - lastSync.timestamp) / (1000 * 60 * 60);

      if (hoursSinceSync >= 24) {
        return { needed: true, type: 'daily', reason: `${Math.floor(hoursSinceSync)} hours since last sync` };
      }
      
      if (hoursSinceSync >= 6) {
        return { needed: true, type: 'partial', reason: 'Checking airing anime updates' };
      }

      if (hoursSinceSync >= 1) {
        return { needed: true, type: 'quick', reason: 'Quick refresh' };
      }

      return { needed: false, reason: 'Recently synced' };
    } catch (error) {
      console.error('Error checking sync status:', error);
      return { needed: true, type: 'full', reason: 'Error checking - doing full sync' };
    }
  }

  /**
   * Main sync method - determines what type of sync to run
   */
  async runSync(forceType = null) {
    const check = forceType ? { needed: true, type: forceType } : await this.checkSyncNeeded();
    
    if (!check.needed) {
      console.log('✅ No sync needed:', check.reason);
      return { skipped: true, reason: check.reason };
    }

    console.log(`🔄 Starting ${check.type} sync: ${check.reason}`);
    this.updateProgress(0, `Starting ${check.type} sync...`);

    try {
      let result;
      switch (check.type) {
        case 'full':
          result = await this.fullSeasonSync();
          break;
        case 'daily':
          result = await this.dailyUpdate();
          break;
        case 'partial':
          result = await this.partialUpdate();
          break;
        case 'quick':
          result = await this.quickRefresh();
          break;
        default:
          result = await this.dailyUpdate();
      }

      // Update last sync time
      await refs.syncLog.child('lastSync').set({
        timestamp: Date.now(),
        type: check.type,
        result: result
      });

      this.updateProgress(100, 'Sync complete!');
      return result;
    } catch (error) {
      console.error('Sync error:', error);
      this.updateProgress(0, 'Sync failed: ' + error.message);
      throw error;
    }
  }

  /**
   * Full season sync - fetches all anime for current and next season
   * PLUS all currently airing anime regardless of original season
   */
  async fullSeasonSync() {
    const season = this.getCurrentSeason();
    const year = this.getCurrentYear();
    const nextSeason = this.getNextSeason();
    const prevSeason = this.getPreviousSeason();

    let added = 0;
    let updated = 0;
    const seenIds = new Set();

    // 1. Fetch ALL currently airing anime (regardless of season)
    this.updateProgress(5, 'Fetching all currently airing anime...');
    const airingAnime = await this.fetchAllAiringAnime();
    
    this.updateProgress(15, `Processing ${airingAnime.length} airing anime...`);
    for (let i = 0; i < airingAnime.length; i++) {
      if (!seenIds.has(airingAnime[i].id)) {
        seenIds.add(airingAnime[i].id);
        const result = await this.saveAnime(airingAnime[i]);
        if (result.isNew) added++;
        else updated++;
      }
      if (i % 10 === 0) {
        this.updateProgress(15 + (i / airingAnime.length) * 15, 
          `Saving airing ${i + 1}/${airingAnime.length}...`);
      }
    }

    // 2. Fetch current season
    this.updateProgress(30, `Fetching ${season} ${year} anime...`);
    const currentAnime = await this.fetchSeasonAnime(season, year);
    
    this.updateProgress(40, `Saving ${currentAnime.length} current season anime...`);
    for (let i = 0; i < currentAnime.length; i++) {
      if (!seenIds.has(currentAnime[i].id)) {
        seenIds.add(currentAnime[i].id);
        const result = await this.saveAnime(currentAnime[i]);
        if (result.isNew) added++;
        else updated++;
      }
      if (i % 10 === 0) {
        this.updateProgress(40 + (i / currentAnime.length) * 15, 
          `Saving anime ${i + 1}/${currentAnime.length}...`);
      }
    }

    // 3. Fetch previous season (for recently finished or continuing)
    this.updateProgress(55, `Fetching ${prevSeason.season} ${prevSeason.year} anime...`);
    const prevAnime = await this.fetchSeasonAnime(prevSeason.season, prevSeason.year);
    
    this.updateProgress(60, `Saving ${prevAnime.length} previous season anime...`);
    for (let i = 0; i < prevAnime.length; i++) {
      if (!seenIds.has(prevAnime[i].id)) {
        seenIds.add(prevAnime[i].id);
        const result = await this.saveAnime(prevAnime[i]);
        if (result.isNew) added++;
        else updated++;
      }
    }

    // 4. Fetch next season
    this.updateProgress(70, `Fetching ${nextSeason.season} ${nextSeason.year} anime...`);
    const upcomingAnime = await this.fetchSeasonAnime(nextSeason.season, nextSeason.year);
    
    this.updateProgress(80, `Saving ${upcomingAnime.length} upcoming anime...`);
    for (let i = 0; i < upcomingAnime.length; i++) {
      if (!seenIds.has(upcomingAnime[i].id)) {
        seenIds.add(upcomingAnime[i].id);
        const result = await this.saveAnime(upcomingAnime[i]);
        if (result.isNew) added++;
        else updated++;
      }
      if (i % 10 === 0) {
        this.updateProgress(80 + (i / upcomingAnime.length) * 15, 
          `Saving upcoming ${i + 1}/${upcomingAnime.length}...`);
      }
    }

    // 5. Fetch anime without season but starting this year
    this.updateProgress(95, 'Checking for anime without season tags...');
    const noSeasonAnime = await this.fetchAnimeByStartDate(year);
    for (const anime of noSeasonAnime) {
      if (!seenIds.has(anime.id)) {
        seenIds.add(anime.id);
        const result = await this.saveAnime(anime);
        if (result.isNew) added++;
        else updated++;
      }
    }

    console.log(`✅ Full sync complete: ${added} added, ${updated} updated, ${seenIds.size} total`);
    return { added, updated, total: seenIds.size };
  }

  /**
   * Sync a specific season - used when navigating to a new season
   */
  async syncSeason(season, year) {
    let added = 0;
    let updated = 0;

    this.updateProgress(10, `Fetching ${season} ${year} anime...`);
    const animeList = await this.fetchSeasonAnime(season, year);
    
    this.updateProgress(30, `Saving ${animeList.length} anime...`);
    for (let i = 0; i < animeList.length; i++) {
      const result = await this.saveAnime(animeList[i]);
      if (result.isNew) added++;
      else updated++;
      
      if (i % 10 === 0) {
        this.updateProgress(30 + (i / animeList.length) * 65, 
          `Saving anime ${i + 1}/${animeList.length}...`);
      }
    }

    // Log the sync
    await refs.syncLog.child(`seasons/${season}_${year}`).set({
      timestamp: Date.now(),
      count: animeList.length,
      added,
      updated
    });

    console.log(`✅ ${season} ${year} sync complete: ${added} added, ${updated} updated`);
    return { added, updated, total: animeList.length };
  }

  /**
   * Daily update - checks all airing anime for updates AND fetches new releases
   */
  async dailyUpdate() {
    this.updateProgress(5, 'Fetching latest airing anime...');
    
    // First, fetch all currently airing from AniList (catches new releases)
    const freshAiring = await this.fetchAllAiringAnime();
    const seenIds = new Set();
    let added = 0;
    let updated = 0;

    this.updateProgress(30, `Processing ${freshAiring.length} airing anime...`);
    for (let i = 0; i < freshAiring.length; i++) {
      if (!seenIds.has(freshAiring[i].id)) {
        seenIds.add(freshAiring[i].id);
        const result = await this.saveAnime(freshAiring[i]);
        if (result.isNew) added++;
        else updated++;
      }
      if (i % 20 === 0) {
        this.updateProgress(30 + (i / freshAiring.length) * 50, 
          `Updating ${i + 1}/${freshAiring.length}...`);
      }
    }

    // Also update anime in DB that are marked as airing but might have finished
    this.updateProgress(80, 'Checking database for status changes...');
    const snapshot = await refs.anime.orderByChild('status').equalTo('RELEASING').once('value');
    const dbAiring = [];
    snapshot.forEach(child => {
      const anime = child.val();
      if (!seenIds.has(anime.anilistId)) {
        dbAiring.push({ id: child.key, ...anime });
      }
    });

    // Check these anime that weren't in the fresh airing list (might have finished)
    for (let i = 0; i < Math.min(dbAiring.length, 20); i++) {
      try {
        const freshData = await this.fetchAnimeById(dbAiring[i].anilistId);
        if (freshData) {
          await this.saveAnime(freshData);
          updated++;
        }
        await this.sleep(this.RATE_LIMIT_MS);
      } catch (error) {
        console.warn(`Failed to update ${dbAiring[i].title}:`, error.message);
      }
    }

    console.log(`✅ Daily update complete: ${added} added, ${updated} updated, ${seenIds.size} total airing`);
    return { added, updated, total: seenIds.size };
  }

  /**
   * Partial update - only updates anime that aired recently
   */
  async partialUpdate() {
    this.updateProgress(10, 'Quick check on airing anime...');
    
    const snapshot = await refs.anime.orderByChild('status').equalTo('RELEASING').once('value');
    const airingAnime = [];
    snapshot.forEach(child => {
      const anime = child.val();
      // Only check anime that might have new episodes (next episode soon)
      if (anime.nextEpisodeAt) {
        const nextEp = new Date(anime.nextEpisodeAt);
        const now = new Date();
        const hoursDiff = (now - nextEp) / (1000 * 60 * 60);
        // If next episode was within last 24 hours, check it
        if (hoursDiff >= -24 && hoursDiff <= 24) {
          airingAnime.push({ id: child.key, ...anime });
        }
      }
    });

    let updated = 0;
    for (let i = 0; i < airingAnime.length; i++) {
      try {
        const freshData = await this.fetchAnimeById(airingAnime[i].anilistId);
        if (freshData) {
          await this.saveAnime(freshData);
          updated++;
        }
        await this.sleep(this.RATE_LIMIT_MS);
      } catch (error) {
        console.warn(`Failed to update:`, error.message);
      }
      this.updateProgress(10 + (i / airingAnime.length) * 85, 
        `Checking ${i + 1}/${airingAnime.length}...`);
    }

    return { updated, checked: airingAnime.length };
  }

  /**
   * Quick refresh - just reload from cache
   */
  async quickRefresh() {
    this.updateProgress(50, 'Loading from cache...');
    // Just mark as synced, data is fresh enough
    return { refreshed: true };
  }

  /**
   * Fetch all anime for a season from AniList
   */
  async fetchSeasonAnime(season, year) {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const query = `
        query ($season: MediaSeason, $year: Int, $page: Int) {
          Page(page: $page, perPage: 50) {
            pageInfo {
              hasNextPage
              currentPage
            }
            media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
              id
              idMal
              isAdult
              title {
                romaji
                english
                native
              }
              season
              seasonYear
              status
              episodes
              nextAiringEpisode {
                episode
                airingAt
              }
              format
              genres
              averageScore
              popularity
              coverImage {
                large
                medium
                color
              }
              bannerImage
              description
              studios(isMain: true) {
                nodes {
                  name
                }
              }
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
            }
          }
        }
      `;

      try {
        const response = await fetch(this.ANILIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { season, year, page }
          })
        });

        const data = await response.json();
        
        if (data.errors) {
          console.error('AniList API error:', data.errors);
          break;
        }

        const pageData = data.data.Page;
        allAnime.push(...pageData.media);
        hasNextPage = pageData.pageInfo.hasNextPage;
        page++;

        await this.sleep(this.RATE_LIMIT_MS);
      } catch (error) {
        console.error('Fetch error:', error);
        break;
      }
    }

    return allAnime;
  }

  /**
   * Fetch ALL currently airing anime (regardless of season)
   * This catches long-running shows, multi-cour anime, and continuing series
   */
  async fetchAllAiringAnime() {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const query = `
        query ($page: Int) {
          Page(page: $page, perPage: 50) {
            pageInfo {
              hasNextPage
              currentPage
            }
            media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC, countryOfOrigin: JP) {
              id
              idMal
              isAdult
              title {
                romaji
                english
                native
              }
              season
              seasonYear
              status
              episodes
              nextAiringEpisode {
                episode
                airingAt
              }
              format
              genres
              averageScore
              popularity
              coverImage {
                large
                medium
                color
              }
              bannerImage
              description
              studios(isMain: true) {
                nodes {
                  name
                }
              }
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
            }
          }
        }
      `;

      try {
        const response = await fetch(this.ANILIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { page }
          })
        });

        const data = await response.json();
        
        if (data.errors) {
          console.error('AniList API error:', data.errors);
          break;
        }

        const pageData = data.data.Page;
        allAnime.push(...pageData.media);
        hasNextPage = pageData.pageInfo.hasNextPage;
        page++;

        await this.sleep(this.RATE_LIMIT_MS);
      } catch (error) {
        console.error('Fetch error:', error);
        break;
      }
    }

    console.log(`📡 Fetched ${allAnime.length} currently airing anime`);
    return allAnime;
  }

  /**
   * Fetch anime by start date year (catches anime without season tags)
   * These are anime that started this year but weren't assigned to a specific season
   */
  async fetchAnimeByStartDate(year) {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;
    const maxPages = 5; // Limit pages for this supplementary query

    while (hasNextPage && page <= maxPages) {
      const query = `
        query ($page: Int, $startDateGreater: FuzzyDateInt, $startDateLess: FuzzyDateInt) {
          Page(page: $page, perPage: 50) {
            pageInfo {
              hasNextPage
              currentPage
            }
            media(
              type: ANIME, 
              sort: POPULARITY_DESC, 
              countryOfOrigin: JP,
              startDate_greater: $startDateGreater,
              startDate_lesser: $startDateLess,
              season: null
            ) {
              id
              idMal
              isAdult
              title {
                romaji
                english
                native
              }
              season
              seasonYear
              status
              episodes
              nextAiringEpisode {
                episode
                airingAt
              }
              format
              genres
              averageScore
              popularity
              coverImage {
                large
                medium
                color
              }
              bannerImage
              description
              studios(isMain: true) {
                nodes {
                  name
                }
              }
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
            }
          }
        }
      `;

      try {
        const response = await fetch(this.ANILIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { 
              page,
              startDateGreater: (year - 1) * 10000 + 1201, // Dec 1 of previous year
              startDateLess: (year + 1) * 10000 + 101      // Jan 1 of next year
            }
          })
        });

        const data = await response.json();
        
        if (data.errors) {
          console.error('AniList API error:', data.errors);
          break;
        }

        const pageData = data.data.Page;
        allAnime.push(...pageData.media);
        hasNextPage = pageData.pageInfo.hasNextPage;
        page++;

        await this.sleep(this.RATE_LIMIT_MS);
      } catch (error) {
        console.error('Fetch error:', error);
        break;
      }
    }

    console.log(`📡 Fetched ${allAnime.length} anime without season tags from ${year}`);
    return allAnime;
  }

  /**
   * Fetch single anime by AniList ID
   */
  async fetchAnimeById(anilistId) {
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          idMal
          isAdult
          title {
            romaji
            english
            native
          }
          season
          seasonYear
          status
          episodes
          nextAiringEpisode {
            episode
            airingAt
          }
          format
          genres
          averageScore
          popularity
          coverImage {
            large
            medium
            color
          }
          bannerImage
          description
          studios(isMain: true) {
            nodes {
              name
            }
          }
          startDate {
            year
            month
            day
          }
          endDate {
            year
            month
            day
          }
        }
      }
    `;

    const response = await fetch(this.ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { id: anilistId }
      })
    });

    const data = await response.json();
    return data.data?.Media;
  }

  /**
   * Save anime to Firebase
   * Preserves existing dub data and other user-contributed info
   */
  async saveAnime(anilistData) {
    const animeId = `al_${anilistData.id}`;
    
    // Check for existing data to preserve user-contributed info
    const existingSnapshot = await refs.anime.child(animeId).once('value');
    const existing = existingSnapshot.val() || {};
    
    const animeData = {
      anilistId: anilistData.id,
      malId: anilistData.idMal,
      title: anilistData.title.english || anilistData.title.romaji,
      titleRomaji: anilistData.title.romaji,
      titleEnglish: anilistData.title.english,
      titleNative: anilistData.title.native,
      season: anilistData.season,
      year: anilistData.seasonYear,
      status: anilistData.status,
      episodes: anilistData.episodes || null,
      nextEpisode: anilistData.nextAiringEpisode?.episode || null,
      nextEpisodeAt: anilistData.nextAiringEpisode?.airingAt 
        ? new Date(anilistData.nextAiringEpisode.airingAt * 1000).toISOString()
        : null,
      format: anilistData.format || null,
      genres: anilistData.genres || [],
      score: anilistData.averageScore || null,
      popularity: anilistData.popularity || 0,
      coverImage: anilistData.coverImage?.large || anilistData.coverImage?.medium || null,
      coverColor: anilistData.coverImage?.color || null,
      bannerImage: anilistData.bannerImage || null,
      description: anilistData.description || null,
      studios: anilistData.studios?.nodes?.map(s => s.name) || [],
      startDate: this.formatDate(anilistData.startDate),
      endDate: this.formatDate(anilistData.endDate),
      isAdult: anilistData.isAdult || false,
      updatedAt: Date.now(),
      
      // Preserve existing dub data (don't overwrite user-contributed info)
      hasDub: existing.hasDub ?? null,
      dubConfidence: existing.dubConfidence ?? null,
      dubPlatforms: existing.dubPlatforms ?? null,
      dubEpisodes: existing.dubEpisodes ?? null,
      dubStatus: existing.dubStatus ?? null,
      dubSources: existing.dubSources ?? null,
      dubCheckedAt: existing.dubCheckedAt ?? null,
      dubOverride: existing.dubOverride ?? null
    };

    // Remove any remaining undefined values (Firebase doesn't accept them)
    Object.keys(animeData).forEach(key => {
      if (animeData[key] === undefined) {
        animeData[key] = null;
      }
    });

    const isNew = !existingSnapshot.exists();

    if (isNew) {
      animeData.createdAt = Date.now();
    }

    await refs.anime.child(animeId).update(animeData);

    return { isNew, id: animeId };
  }

  formatDate(dateObj) {
    if (!dateObj || !dateObj.year) return null;
    const month = dateObj.month ? String(dateObj.month).padStart(2, '0') : '01';
    const day = dateObj.day ? String(dateObj.day).padStart(2, '0') : '01';
    return `${dateObj.year}-${month}-${day}`;
  }

  /**
   * Convert season name to Jikan format
   */
  getJikanSeason(season) {
    return season.toLowerCase(); // winter, spring, summer, fall
  }

  /**
   * Fetch anime from Jikan API (MyAnimeList data)
   * This catches anime that might not be on AniList
   */
  async fetchJikanSeasonAnime(season, year) {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;
    const jikanSeason = this.getJikanSeason(season);

    this.updateProgress(0, `Fetching from MyAnimeList (${season} ${year})...`);

    while (hasNextPage && page <= 5) { // Limit to 5 pages
      try {
        const response = await fetch(
          `${this.JIKAN_API}/seasons/${year}/${jikanSeason}?page=${page}&filter=tv`
        );
        
        if (!response.ok) {
          console.warn(`Jikan API error: ${response.status}`);
          break;
        }

        const data = await response.json();
        
        if (data.data) {
          allAnime.push(...data.data);
        }
        
        hasNextPage = data.pagination?.has_next_page || false;
        page++;

        await this.sleep(this.JIKAN_RATE_LIMIT_MS);
      } catch (error) {
        console.error('Jikan fetch error:', error);
        break;
      }
    }

    console.log(`📡 Jikan: Fetched ${allAnime.length} anime for ${season} ${year}`);
    return allAnime;
  }

  /**
   * Fetch currently airing anime from Jikan
   */
  async fetchJikanAiringAnime() {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage && page <= 5) {
      try {
        const response = await fetch(
          `${this.JIKAN_API}/seasons/now?page=${page}`
        );
        
        if (!response.ok) break;

        const data = await response.json();
        
        if (data.data) {
          allAnime.push(...data.data);
        }
        
        hasNextPage = data.pagination?.has_next_page || false;
        page++;

        await this.sleep(this.JIKAN_RATE_LIMIT_MS);
      } catch (error) {
        console.error('Jikan airing fetch error:', error);
        break;
      }
    }

    console.log(`📡 Jikan: Fetched ${allAnime.length} currently airing anime`);
    return allAnime;
  }

  /**
   * Convert Jikan anime data to our format
   */
  convertJikanAnime(jikanData) {
    // Map Jikan status to AniList status
    const statusMap = {
      'Currently Airing': 'RELEASING',
      'Finished Airing': 'FINISHED',
      'Not yet aired': 'NOT_YET_RELEASED'
    };

    // Determine season from aired date
    let season = null;
    let seasonYear = null;
    if (jikanData.aired?.from) {
      const airDate = new Date(jikanData.aired.from);
      seasonYear = airDate.getFullYear();
      const month = airDate.getMonth() + 1;
      if (month >= 1 && month <= 3) season = 'WINTER';
      else if (month >= 4 && month <= 6) season = 'SPRING';
      else if (month >= 7 && month <= 9) season = 'SUMMER';
      else season = 'FALL';
    }
    
    // Use Jikan's season if available
    if (jikanData.season) {
      season = jikanData.season.toUpperCase();
    }
    if (jikanData.year) {
      seasonYear = jikanData.year;
    }

    return {
      id: jikanData.mal_id,
      idMal: jikanData.mal_id,
      isAdult: jikanData.rating?.includes('Rx') || jikanData.genres?.some(g => g.name === 'Hentai') || false,
      title: {
        english: jikanData.title_english,
        romaji: jikanData.title,
        native: jikanData.title_japanese
      },
      // Alternative titles from MAL
      titleSynonyms: jikanData.title_synonyms || [],
      titles: jikanData.titles || [], // Array of {type, title} objects
      season: season,
      seasonYear: seasonYear,
      status: statusMap[jikanData.status] || 'RELEASING',
      episodes: jikanData.episodes,
      nextAiringEpisode: null, // Jikan doesn't provide this in the same format
      format: jikanData.type === 'TV' ? 'TV' : jikanData.type,
      genres: jikanData.genres?.map(g => g.name) || [],
      averageScore: jikanData.score ? Math.round(jikanData.score * 10) : null,
      popularity: jikanData.members || 0,
      coverImage: {
        large: jikanData.images?.jpg?.large_image_url || jikanData.images?.jpg?.image_url,
        medium: jikanData.images?.jpg?.image_url,
        color: null
      },
      bannerImage: null,
      description: jikanData.synopsis,
      studios: {
        nodes: jikanData.studios?.map(s => ({ name: s.name })) || []
      },
      startDate: jikanData.aired?.from ? {
        year: new Date(jikanData.aired.from).getFullYear(),
        month: new Date(jikanData.aired.from).getMonth() + 1,
        day: new Date(jikanData.aired.from).getDate()
      } : null,
      endDate: jikanData.aired?.to ? {
        year: new Date(jikanData.aired.to).getFullYear(),
        month: new Date(jikanData.aired.to).getMonth() + 1,
        day: new Date(jikanData.aired.to).getDate()
      } : null,
      source: 'jikan' // Track the source
    };
  }

  /**
   * Fetch anime from Kitsu API
   */
  async fetchKitsuSeasonAnime(season, year) {
    const allAnime = [];
    let offset = 0;
    const limit = 20;
    let hasMore = true;

    // Kitsu uses date ranges for seasons
    const seasonDates = {
      'WINTER': { start: `${year}-01-01`, end: `${year}-03-31` },
      'SPRING': { start: `${year}-04-01`, end: `${year}-06-30` },
      'SUMMER': { start: `${year}-07-01`, end: `${year}-09-30` },
      'FALL': { start: `${year}-10-01`, end: `${year}-12-31` }
    };

    const dates = seasonDates[season];
    if (!dates) return allAnime;

    while (hasMore && offset < 100) { // Limit total fetched
      try {
        const params = new URLSearchParams({
          'filter[seasonYear]': year,
          'filter[season]': season.toLowerCase(),
          'page[limit]': limit,
          'page[offset]': offset,
          'sort': '-userCount'
        });

        const response = await fetch(`${this.KITSU_API}/anime?${params}`, {
          headers: {
            'Accept': 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json'
          }
        });
        
        if (!response.ok) break;

        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
          allAnime.push(...data.data);
          offset += limit;
          hasMore = data.data.length === limit;
        } else {
          hasMore = false;
        }

        await this.sleep(500); // Kitsu is more lenient
      } catch (error) {
        console.error('Kitsu fetch error:', error);
        break;
      }
    }

    console.log(`📡 Kitsu: Fetched ${allAnime.length} anime for ${season} ${year}`);
    return allAnime;
  }

  /**
   * Convert Kitsu anime data to our format
   */
  convertKitsuAnime(kitsuData) {
    const attrs = kitsuData.attributes;
    
    const statusMap = {
      'current': 'RELEASING',
      'finished': 'FINISHED',
      'upcoming': 'NOT_YET_RELEASED',
      'tba': 'NOT_YET_RELEASED'
    };

    // Determine season from start date
    let season = null;
    let seasonYear = null;
    if (attrs.startDate) {
      const startDate = new Date(attrs.startDate);
      seasonYear = startDate.getFullYear();
      const month = startDate.getMonth() + 1;
      if (month >= 1 && month <= 3) season = 'WINTER';
      else if (month >= 4 && month <= 6) season = 'SPRING';
      else if (month >= 7 && month <= 9) season = 'SUMMER';
      else season = 'FALL';
    }

    return {
      id: kitsuData.id,
      kitsuId: kitsuData.id,
      isAdult: attrs.nsfw || false,
      title: {
        english: attrs.titles?.en || attrs.titles?.en_us,
        romaji: attrs.titles?.en_jp || attrs.canonicalTitle,
        native: attrs.titles?.ja_jp
      },
      season: season,
      seasonYear: seasonYear,
      status: statusMap[attrs.status] || 'RELEASING',
      episodes: attrs.episodeCount,
      nextAiringEpisode: null,
      format: attrs.subtype?.toUpperCase() || 'TV',
      genres: [], // Kitsu requires separate request for genres
      averageScore: attrs.averageRating ? Math.round(parseFloat(attrs.averageRating)) : null,
      popularity: attrs.userCount || 0,
      coverImage: {
        large: attrs.posterImage?.large || attrs.posterImage?.original,
        medium: attrs.posterImage?.medium,
        color: null
      },
      bannerImage: attrs.coverImage?.original,
      description: attrs.synopsis,
      studios: { nodes: [] }, // Kitsu requires separate request
      startDate: attrs.startDate ? {
        year: new Date(attrs.startDate).getFullYear(),
        month: new Date(attrs.startDate).getMonth() + 1,
        day: new Date(attrs.startDate).getDate()
      } : null,
      endDate: attrs.endDate ? {
        year: new Date(attrs.endDate).getFullYear(),
        month: new Date(attrs.endDate).getMonth() + 1,
        day: new Date(attrs.endDate).getDate()
      } : null,
      source: 'kitsu'
    };
  }

  /**
   * Comprehensive season sync - uses ALL APIs
   */
  async comprehensiveSeasonSync(season, year) {
    let added = 0;
    let updated = 0;
    const seenIds = new Map(); // Track by MAL ID to avoid duplicates
    const seenTitles = new Set(); // Fallback for matching

    this.updateProgress(5, 'Starting comprehensive sync from all sources...');

    // 1. Fetch from AniList (primary)
    this.updateProgress(10, `Fetching from AniList (${season} ${year})...`);
    const anilistAnime = await this.fetchSeasonAnime(season, year);
    
    this.updateProgress(25, `Processing ${anilistAnime.length} AniList anime...`);
    for (const anime of anilistAnime) {
      const result = await this.saveAnime(anime);
      if (result.isNew) added++;
      else updated++;
      
      if (anime.idMal) seenIds.set(anime.idMal, true);
      if (anime.title?.romaji) seenTitles.add(anime.title.romaji.toLowerCase());
      if (anime.title?.english) seenTitles.add(anime.title.english.toLowerCase());
    }

    // 2. Fetch from Jikan/MAL (secondary)
    this.updateProgress(40, `Fetching from MyAnimeList (${season} ${year})...`);
    try {
      const jikanAnime = await this.fetchJikanSeasonAnime(season, year);
      
      this.updateProgress(55, `Processing ${jikanAnime.length} MAL anime...`);
      for (const jikan of jikanAnime) {
        // Skip if we already have this from AniList
        if (seenIds.has(jikan.mal_id)) continue;
        
        // Check by title as fallback
        const titleLower = jikan.title?.toLowerCase();
        const titleEnLower = jikan.title_english?.toLowerCase();
        if (titleLower && seenTitles.has(titleLower)) continue;
        if (titleEnLower && seenTitles.has(titleEnLower)) continue;

        // New anime from Jikan!
        const converted = this.convertJikanAnime(jikan);
        const result = await this.saveAnimeFromJikan(converted);
        if (result.isNew) added++;
        else updated++;
        
        seenIds.set(jikan.mal_id, true);
        if (titleLower) seenTitles.add(titleLower);
        if (titleEnLower) seenTitles.add(titleEnLower);
      }
    } catch (error) {
      console.warn('Jikan sync failed, continuing...', error);
    }

    // 3. Fetch from Kitsu (tertiary)
    this.updateProgress(70, `Fetching from Kitsu (${season} ${year})...`);
    try {
      const kitsuAnime = await this.fetchKitsuSeasonAnime(season, year);
      
      this.updateProgress(85, `Processing ${kitsuAnime.length} Kitsu anime...`);
      for (const kitsu of kitsuAnime) {
        const converted = this.convertKitsuAnime(kitsu);
        
        // Check if we already have this
        const titleLower = converted.title?.romaji?.toLowerCase();
        const titleEnLower = converted.title?.english?.toLowerCase();
        if (titleLower && seenTitles.has(titleLower)) continue;
        if (titleEnLower && seenTitles.has(titleEnLower)) continue;

        // New anime from Kitsu!
        const result = await this.saveAnimeFromKitsu(converted);
        if (result.isNew) added++;
        else updated++;
        
        if (titleLower) seenTitles.add(titleLower);
        if (titleEnLower) seenTitles.add(titleEnLower);
      }
    } catch (error) {
      console.warn('Kitsu sync failed, continuing...', error);
    }

    // 4. Also fetch currently airing from Jikan (catches shows that might be missing)
    this.updateProgress(90, 'Checking for additional airing anime...');
    try {
      const jikanAiring = await this.fetchJikanAiringAnime();
      for (const jikan of jikanAiring) {
        if (seenIds.has(jikan.mal_id)) continue;
        
        const converted = this.convertJikanAnime(jikan);
        // Only save if it matches current season
        if (converted.season === season && converted.seasonYear === year) {
          const result = await this.saveAnimeFromJikan(converted);
          if (result.isNew) added++;
        }
      }
    } catch (error) {
      console.warn('Jikan airing sync failed', error);
    }

    this.updateProgress(100, 'Comprehensive sync complete!');
    console.log(`✅ Comprehensive sync: ${added} added, ${updated} updated from all sources`);
    return { added, updated, sources: ['AniList', 'MyAnimeList', 'Kitsu'] };
  }

  /**
   * Save anime from Jikan format
   */
  async saveAnimeFromJikan(jikanData) {
    const animeId = `mal_${jikanData.idMal}`;
    
    const existingSnapshot = await refs.anime.child(animeId).once('value');
    const existing = existingSnapshot.val() || {};
    
    const animeData = {
      malId: jikanData.idMal,
      title: jikanData.title.english || jikanData.title.romaji,
      titleRomaji: jikanData.title.romaji,
      titleEnglish: jikanData.title.english,
      titleNative: jikanData.title.native,
      // Alternative titles from MAL
      titleSynonyms: jikanData.titleSynonyms || [],
      altTitles: jikanData.titles?.map(t => ({ type: t.type, title: t.title })) || [],
      season: jikanData.season,
      year: jikanData.seasonYear,
      status: jikanData.status,
      episodes: jikanData.episodes || null,
      format: jikanData.format || null,
      genres: jikanData.genres || [],
      score: jikanData.averageScore || null,
      popularity: jikanData.popularity || 0,
      coverImage: jikanData.coverImage?.large || jikanData.coverImage?.medium || null,
      description: jikanData.description || null,
      studios: jikanData.studios?.nodes?.map(s => s.name) || [],
      startDate: this.formatDate(jikanData.startDate),
      endDate: this.formatDate(jikanData.endDate),
      isAdult: jikanData.isAdult || false,
      source: 'jikan',
      updatedAt: Date.now(),
      
      // Preserve existing dub data
      hasDub: existing.hasDub ?? null,
      dubConfidence: existing.dubConfidence ?? null,
      dubPlatforms: existing.dubPlatforms ?? null
    };

    Object.keys(animeData).forEach(key => {
      if (animeData[key] === undefined) animeData[key] = null;
    });

    const isNew = !existingSnapshot.exists();
    if (isNew) animeData.createdAt = Date.now();

    await refs.anime.child(animeId).update(animeData);
    return { isNew, id: animeId };
  }

  /**
   * Save anime from Kitsu format
   */
  async saveAnimeFromKitsu(kitsuData) {
    const animeId = `kitsu_${kitsuData.kitsuId}`;
    
    const existingSnapshot = await refs.anime.child(animeId).once('value');
    const existing = existingSnapshot.val() || {};
    
    const animeData = {
      kitsuId: kitsuData.kitsuId,
      title: kitsuData.title.english || kitsuData.title.romaji,
      titleRomaji: kitsuData.title.romaji,
      titleEnglish: kitsuData.title.english,
      titleNative: kitsuData.title.native,
      season: kitsuData.season,
      year: kitsuData.seasonYear,
      status: kitsuData.status,
      episodes: kitsuData.episodes || null,
      format: kitsuData.format || null,
      genres: kitsuData.genres || [],
      score: kitsuData.averageScore || null,
      popularity: kitsuData.popularity || 0,
      coverImage: kitsuData.coverImage?.large || kitsuData.coverImage?.medium || null,
      bannerImage: kitsuData.bannerImage || null,
      description: kitsuData.description || null,
      startDate: this.formatDate(kitsuData.startDate),
      endDate: this.formatDate(kitsuData.endDate),
      isAdult: kitsuData.isAdult || false,
      source: 'kitsu',
      updatedAt: Date.now(),
      
      // Preserve existing dub data
      hasDub: existing.hasDub ?? null,
      dubConfidence: existing.dubConfidence ?? null,
      dubPlatforms: existing.dubPlatforms ?? null
    };

    Object.keys(animeData).forEach(key => {
      if (animeData[key] === undefined) animeData[key] = null;
    });

    const isNew = !existingSnapshot.exists();
    if (isNew) animeData.createdAt = Date.now();

    await refs.anime.child(animeId).update(animeData);
    return { isNew, id: animeId };
  }

  updateProgress(percent, message) {
    if (this.onProgress) {
      this.onProgress(percent, message);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create global instance
const animeSync = new AnimeSync();
