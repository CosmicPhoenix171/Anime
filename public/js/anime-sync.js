/**
 * Anime Sync Service - Client-Side
 * 
 * Handles syncing anime data from AniList API to Firebase
 * Runs in the browser when users visit the page
 */

class AnimeSync {
  constructor() {
    this.ANILIST_API = 'https://graphql.anilist.co';
    this.RATE_LIMIT_MS = 800; // AniList rate limit
    this.onProgress = null;
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
