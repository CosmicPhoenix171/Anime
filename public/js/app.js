/**
 * Anime Tracker - Main Application
 * 
 * Serverless client-side app using Firebase Realtime Database
 * with local caching for faster season switching
 */

// State
let currentUser = null;
let currentSeason = null;
let currentYear = null;
let animeCache = [];
let debounceTimer = null;

// Season data
const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const seasonNames = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };

// Local Cache Configuration
const LOCAL_CACHE = {
  PREFIX: 'anime_cache_',
  // Different expiry based on season status
  EXPIRY_CURRENT: 15 * 60 * 1000,    // 15 minutes for current/airing season
  EXPIRY_RECENT: 2 * 60 * 60 * 1000, // 2 hours for recently finished
  EXPIRY_OLD: 7 * 24 * 60 * 60 * 1000, // 7 days for old finished seasons
  MAX_SEASONS: 8 // Keep max 8 seasons cached
};

/**
 * Check if a season is the current one
 */
function isCurrentSeason(season, year) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1;
  const currentSeasonIdx = Math.floor((month - 1) / 3);
  const currentSeasonName = seasons[currentSeasonIdx];
  
  return season === currentSeasonName && year === currentYear;
}

/**
 * Check if a season is finished (all shows done airing)
 */
function isFinishedSeason(season, year) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth() + 1;
  const currentSeasonIdx = Math.floor((month - 1) / 3);
  
  // Season is finished if it's from a past year, or earlier in the same year
  if (year < currentYear) return true;
  if (year === currentYear) {
    const targetSeasonIdx = seasons.indexOf(season);
    return targetSeasonIdx < currentSeasonIdx;
  }
  return false;
}

/**
 * Get appropriate cache expiry for a season
 */
function getCacheExpiry(season, year) {
  if (isCurrentSeason(season, year)) {
    return LOCAL_CACHE.EXPIRY_CURRENT;
  }
  if (isFinishedSeason(season, year)) {
    // Check how old the season is
    const now = new Date();
    const seasonEndMonth = (seasons.indexOf(season) + 1) * 3;
    const seasonEndDate = new Date(year, seasonEndMonth, 1);
    const monthsAgo = (now - seasonEndDate) / (30 * 24 * 60 * 60 * 1000);
    
    // Very old seasons (6+ months) - cache for a week
    if (monthsAgo > 6) return LOCAL_CACHE.EXPIRY_OLD;
    // Recently finished - cache for 2 hours
    return LOCAL_CACHE.EXPIRY_RECENT;
  }
  // Future seasons
  return LOCAL_CACHE.EXPIRY_CURRENT;
}

/**
 * Local Storage Cache Helper Functions
 */
const localCache = {
  // Get cache key for a season
  getKey(season, year) {
    return `${LOCAL_CACHE.PREFIX}${season}_${year}`;
  },

  // Save anime list to local cache
  save(season, year, animeList) {
    try {
      const key = this.getKey(season, year);
      const data = {
        anime: animeList,
        timestamp: Date.now(),
        season,
        year,
        isFinished: isFinishedSeason(season, year)
      };
      localStorage.setItem(key, JSON.stringify(data));
      console.log(`💾 Cached ${animeList.length} anime for ${season} ${year}`);
      
      // Cleanup old cache entries
      this.cleanup();
    } catch (e) {
      console.warn('Local storage save error:', e);
      // If quota exceeded, clear some old data
      if (e.name === 'QuotaExceededError') {
        this.clearOldest(3);
      }
    }
  },

  // Get anime list from local cache (with smart expiry)
  get(season, year, ignoreExpiry = false) {
    try {
      const key = this.getKey(season, year);
      const stored = localStorage.getItem(key);
      
      if (!stored) return null;
      
      const data = JSON.parse(stored);
      const age = Date.now() - data.timestamp;
      const expiry = getCacheExpiry(season, year);
      
      // For finished seasons, always return cache (refresh in background)
      if (isFinishedSeason(season, year) || ignoreExpiry) {
        const ageStr = age < 60000 ? `${Math.round(age/1000)}s` : 
                       age < 3600000 ? `${Math.round(age/60000)}m` : 
                       `${Math.round(age/3600000)}h`;
        console.log(`⚡ Using cached data for ${season} ${year} (${ageStr} old, ${isFinishedSeason(season,year) ? 'finished' : 'active'})`);
        return data.anime;
      }
      
      // For current season, check expiry
      if (age > expiry) {
        console.log(`⏰ Cache expired for ${season} ${year} (current season)`);
        return null;
      }
      
      console.log(`⚡ Using cached data for ${season} ${year} (${Math.round(age / 1000)}s old)`);
      return data.anime;
    } catch (e) {
      console.warn('Local storage get error:', e);
      return null;
    }
  },

  // Get raw cache data without expiry check
  getRaw(season, year) {
    try {
      const key = this.getKey(season, year);
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch (e) {
      return null;
    }
  },

  // Check if cache exists and is valid
  has(season, year) {
    return this.get(season, year) !== null;
  },

  // Merge updates into cache (diff-based update)
  mergeUpdates(season, year, freshAnime) {
    try {
      const key = this.getKey(season, year);
      const stored = localStorage.getItem(key);
      
      if (!stored) {
        // No existing cache, just save
        this.save(season, year, freshAnime);
        return { added: freshAnime.length, updated: 0, unchanged: 0 };
      }
      
      const data = JSON.parse(stored);
      const existingMap = new Map(data.anime.map(a => [a.id, a]));
      
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      
      // Process each fresh anime
      for (const fresh of freshAnime) {
        const existing = existingMap.get(fresh.id);
        
        if (!existing) {
          // New anime
          existingMap.set(fresh.id, fresh);
          added++;
        } else if (this.hasChanges(existing, fresh)) {
          // Update changed fields, but preserve local data like dub info
          existingMap.set(fresh.id, {
            ...existing,
            ...fresh,
            // Preserve dub data if we have it and Firebase doesn't
            hasDub: fresh.hasDub !== undefined ? fresh.hasDub : existing.hasDub,
            dubPlatforms: fresh.dubPlatforms?.length ? fresh.dubPlatforms : existing.dubPlatforms,
            dubConfidence: fresh.dubConfidence !== undefined ? fresh.dubConfidence : existing.dubConfidence,
            dubCheckedAt: fresh.dubCheckedAt || existing.dubCheckedAt
          });
          updated++;
        } else {
          unchanged++;
        }
      }
      
      // Convert back to array
      const mergedAnime = Array.from(existingMap.values());
      
      // Save merged data
      data.anime = mergedAnime;
      data.timestamp = Date.now();
      localStorage.setItem(key, JSON.stringify(data));
      
      console.log(`🔀 Merged ${season} ${year}: +${added} new, ~${updated} updated, ${unchanged} unchanged`);
      return { added, updated, unchanged, anime: mergedAnime };
    } catch (e) {
      console.warn('Merge error:', e);
      // Fallback to full save
      this.save(season, year, freshAnime);
      return { added: freshAnime.length, updated: 0, unchanged: 0 };
    }
  },

  // Check if anime has meaningful changes
  hasChanges(existing, fresh) {
    // Fields that matter for updates
    const compareFields = [
      'status', 'episodes', 'score', 'popularity', 
      'nextEpisode', 'nextEpisodeAt', 'coverImage'
    ];
    
    for (const field of compareFields) {
      if (existing[field] !== fresh[field]) {
        return true;
      }
    }
    return false;
  },

  // Update specific anime in cache
  updateAnime(season, year, updatedAnime) {
    try {
      const key = this.getKey(season, year);
      const stored = localStorage.getItem(key);
      
      if (!stored) return;
      
      const data = JSON.parse(stored);
      const idx = data.anime.findIndex(a => a.id === updatedAnime.id);
      
      if (idx !== -1) {
        data.anime[idx] = { ...data.anime[idx], ...updatedAnime };
        localStorage.setItem(key, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('Local storage update error:', e);
    }
  },

  // Remove oldest cache entries (but prefer keeping finished seasons)
  clearOldest(count = 2) {
    const entries = this.getAllEntries();
    
    // Sort: current seasons first (to remove), then by age
    entries.sort((a, b) => {
      const aFinished = isFinishedSeason(a.season, a.year);
      const bFinished = isFinishedSeason(b.season, b.year);
      
      // Prefer keeping finished seasons
      if (aFinished !== bFinished) return aFinished ? 1 : -1;
      
      // Otherwise by age
      return a.timestamp - b.timestamp;
    });
    
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      localStorage.removeItem(entries[i].key);
      console.log(`🗑️ Cleared cache: ${entries[i].key}`);
    }
  },

  // Get all cache entries with metadata
  getAllEntries() {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_CACHE.PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          entries.push({ key, ...data });
        } catch (e) {}
      }
    }
    return entries;
  },

  // Cleanup: remove very old entries and excess
  cleanup() {
    const entries = this.getAllEntries();
    const now = Date.now();
    
    // Remove very old entries (30+ days)
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    entries.forEach(entry => {
      if (now - entry.timestamp > maxAge) {
        localStorage.removeItem(entry.key);
      }
    });
    
    // Remove excess (keep only MAX_SEASONS)
    const valid = this.getAllEntries();
    if (valid.length > LOCAL_CACHE.MAX_SEASONS) {
      this.clearOldest(valid.length - LOCAL_CACHE.MAX_SEASONS);
    }
  },

  // Force refresh cache for a season
  invalidate(season, year) {
    const key = this.getKey(season, year);
    localStorage.removeItem(key);
    console.log(`🔄 Invalidated cache for ${season} ${year}`);
  },

  // Clear all anime cache
  clearAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_CACHE.PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach(key => localStorage.removeItem(key));
    console.log(`🗑️ Cleared all ${keys.length} cached seasons`);
  }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎌 Anime Tracker starting...');
  
  // Initialize season
  currentSeason = animeSync.getCurrentSeason();
  currentYear = animeSync.getCurrentYear();
  updateSeasonDisplay();

  // Setup sync progress handler
  animeSync.onProgress = updateSyncProgress;

  // Setup auth listener
  auth.onAuthStateChanged(handleAuthChange);

  // Setup event listeners
  setupEventListeners();

  // Start loading
  await initializeApp();
});

/**
 * Initialize the application
 */
async function initializeApp() {
  try {
    // Check if sync is needed and run it
    const syncCheck = await animeSync.checkSyncNeeded();
    
    if (syncCheck.needed) {
      showSyncBanner(true);
      await animeSync.runSync(syncCheck.type);
      hideSyncBanner();
    }

    // Load and display anime
    await loadAnime();
    
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize. Please refresh the page.');
  }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Season navigation
  document.getElementById('prevSeason')?.addEventListener('click', async () => {
    const idx = seasons.indexOf(currentSeason);
    if (idx === 0) {
      currentSeason = seasons[3];
      currentYear--;
    } else {
      currentSeason = seasons[idx - 1];
    }
    updateSeasonDisplay();
    await loadAnimeWithSync();
  });

  document.getElementById('nextSeason')?.addEventListener('click', async () => {
    const idx = seasons.indexOf(currentSeason);
    if (idx === 3) {
      currentSeason = seasons[0];
      currentYear++;
    } else {
      currentSeason = seasons[idx + 1];
    }
    updateSeasonDisplay();
    await loadAnimeWithSync();
  });

  // Filters
  document.getElementById('statusFilter')?.addEventListener('change', filterAnime);
  document.getElementById('formatFilter')?.addEventListener('change', filterAnime);
  document.getElementById('dubFilter')?.addEventListener('change', filterAnime);
  document.getElementById('sortFilter')?.addEventListener('change', filterAnime);

  // Search with debounce
  document.getElementById('searchInput')?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(filterAnime, 300);
  });

  // Mobile menu
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.querySelector('.nav-links')?.classList.toggle('show');
  });
}

/**
 * Load anime with sync check - used when changing seasons
 * Now checks local cache first for instant loading
 * Smart caching: finished seasons cached longer, diff-based updates
 */
async function loadAnimeWithSync() {
  const grid = document.getElementById('animeGrid');
  
  // Check local cache first for instant display
  // For finished seasons, always use cache if available (ignoreExpiry)
  const useIgnoreExpiry = isFinishedSeason(currentSeason, currentYear);
  const cachedAnime = localCache.get(currentSeason, currentYear, useIgnoreExpiry);
  
  if (cachedAnime && cachedAnime.length > 0) {
    // Instant display from cache!
    const seasonType = isFinishedSeason(currentSeason, currentYear) ? 'finished' : 
                       isCurrentSeason(currentSeason, currentYear) ? 'current' : 'future';
    console.log(`⚡ Instant load from cache: ${cachedAnime.length} anime (${seasonType} season)`);
    animeCache = cachedAnime;
    animeCache.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    updateStats();
    renderAnimeGrid(animeCache);
    
    // Still refresh from Firebase in background for any updates
    // (but the refresh function will skip if not needed for finished seasons)
    refreshFromFirebaseInBackground();
    return;
  }
  
  // No cache - load from Firebase
  grid.innerHTML = '<div class="loading">Loading anime...</div>';

  try {
    // Check if we have data for this season in Firebase
    const snapshot = await refs.anime
      .orderByChild('year')
      .equalTo(currentYear)
      .limitToFirst(1)
      .once('value');

    let hasSeasonData = false;
    snapshot.forEach(child => {
      const anime = child.val();
      if (anime.season === currentSeason) {
        hasSeasonData = true;
      }
    });

    // If no data for this season, sync it
    if (!hasSeasonData) {
      console.log(`📥 No data for ${currentSeason} ${currentYear} - syncing...`);
      showSyncBanner(true);
      await animeSync.syncSeason(currentSeason, currentYear);
      hideSyncBanner();
    }

    // Now load the anime
    await loadAnime();

  } catch (error) {
    console.error('Error loading anime with sync:', error);
    grid.innerHTML = '<div class="error">Failed to load anime. Please refresh.</div>';
  }
}

/**
 * Refresh data from Firebase in background (silent update with diff-based merge)
 */
async function refreshFromFirebaseInBackground() {
  try {
    // For finished seasons, only refresh occasionally
    const cacheData = localCache.getRaw(currentSeason, currentYear);
    if (cacheData && isFinishedSeason(currentSeason, currentYear)) {
      const age = Date.now() - cacheData.timestamp;
      // Skip refresh for finished seasons if cache is less than 2 hours old
      if (age < LOCAL_CACHE.EXPIRY_RECENT) {
        console.log(`⏭️ Skipping background refresh for finished season (cache ${Math.round(age/60000)}m old)`);
        return;
      }
    }

    const snapshot = await refs.anime
      .orderByChild('year')
      .equalTo(currentYear)
      .once('value');

    const freshAnime = [];
    snapshot.forEach(child => {
      const anime = { id: child.key, ...child.val() };
      if (anime.season === currentSeason) {
        freshAnime.push(anime);
      }
    });

    // Use diff-based merge instead of full replacement
    const mergeResult = localCache.mergeUpdates(currentSeason, currentYear, freshAnime);
    
    // Only re-render if there are actual changes
    if (mergeResult.added > 0 || mergeResult.updated > 0) {
      console.log('🔄 Background refresh found changes - updating display');
      animeCache = mergeResult.anime || freshAnime;
      animeCache.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      updateStats();
      renderAnimeGrid(animeCache);
    }
  } catch (error) {
    console.warn('Background refresh failed:', error);
  }
}

/**
 * Load anime from Firebase and save to local cache
 */
async function loadAnime() {
  const grid = document.getElementById('animeGrid');
  
  // Check local cache first
  const cachedAnime = localCache.get(currentSeason, currentYear);
  if (cachedAnime && cachedAnime.length > 0) {
    console.log(`⚡ Using cached anime: ${cachedAnime.length} titles`);
    animeCache = cachedAnime;
    animeCache.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    updateStats();
    renderAnimeGrid(animeCache);
    
    // Check dubs in background (don't await)
    setTimeout(() => checkDubsInBackground(), 2000);
    return;
  }
  
  grid.innerHTML = '<div class="loading">Loading anime...</div>';

  try {
    // Query anime for current season from Firebase
    const snapshot = await refs.anime
      .orderByChild('year')
      .equalTo(currentYear)
      .once('value');

    animeCache = [];
    snapshot.forEach(child => {
      const anime = { id: child.key, ...child.val() };
      // Filter by season
      if (anime.season === currentSeason) {
        animeCache.push(anime);
      }
    });

    // Sort by popularity by default
    animeCache.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    // Save to local cache for fast switching
    localCache.save(currentSeason, currentYear, animeCache);

    // Update stats
    updateStats();

    // Render
    renderAnimeGrid(animeCache);

    // Check dubs in background (don't await)
    setTimeout(() => checkDubsInBackground(), 2000);

  } catch (error) {
    console.error('Error loading anime:', error);
    grid.innerHTML = '<div class="error">Failed to load anime. Please refresh.</div>';
  }
}

/**
 * Filter and sort anime based on current filters
 */
function filterAnime() {
  const statusFilter = document.getElementById('statusFilter')?.value;
  const formatFilter = document.getElementById('formatFilter')?.value;
  const dubFilter = document.getElementById('dubFilter')?.value;
  const sortFilter = document.getElementById('sortFilter')?.value;
  const searchQuery = document.getElementById('searchInput')?.value.toLowerCase();

  let filtered = [...animeCache];

  // Apply filters
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter);
  }

  if (formatFilter) {
    filtered = filtered.filter(a => a.format === formatFilter);
  }

  // Dub filter
  if (dubFilter === 'dubbed') {
    filtered = filtered.filter(a => a.hasDub === true);
  } else if (dubFilter === 'subbed') {
    filtered = filtered.filter(a => !a.hasDub);
  }

  if (searchQuery) {
    filtered = filtered.filter(a => 
      a.title?.toLowerCase().includes(searchQuery) ||
      a.titleRomaji?.toLowerCase().includes(searchQuery) ||
      a.titleEnglish?.toLowerCase().includes(searchQuery)
    );
  }

  // Apply sort
  switch (sortFilter) {
    case 'score':
      filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
      break;
    case 'title':
      filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'popularity':
    default:
      filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }

  renderAnimeGrid(filtered);
}

/**
 * Render anime grid
 */
function renderAnimeGrid(animeList) {
  const grid = document.getElementById('animeGrid');
  
  if (animeList.length === 0) {
    grid.innerHTML = '<div class="no-results">No anime found for this season.</div>';
    return;
  }

  grid.innerHTML = animeList.map(anime => createAnimeCard(anime)).join('');
}

/**
 * Create anime card HTML
 */
function createAnimeCard(anime) {
  const statusClass = getStatusClass(anime.status);
  const statusText = formatStatus(anime.status);
  const score = anime.score ? anime.score : null;
  const episodes = anime.episodes ? `${anime.episodes} eps` : 'TBA';
  const nextEp = getNextEpisodeText(anime);
  const title = anime.titleEnglish || anime.title || anime.titleRomaji || 'Unknown';
  
  // Dub badge
  const dubBadge = anime.hasDub ? `
    <span class="card-dub-badge ${anime.dubConfidence >= 80 ? 'confirmed' : 'likely'}" 
          title="${anime.dubPlatforms?.join(', ') || 'English Dub Available'}">
      🎙️ DUB
    </span>` : '';

  return `
    <a href="./anime.html?id=${anime.id}" class="anime-card">
      <div class="card-image">
        <img src="${anime.coverImage || 'https://via.placeholder.com/200x280?text=No+Image'}" alt="${title}" loading="lazy">
        ${score ? `<span class="card-score">⭐ ${score}%</span>` : ''}
        ${dubBadge}
        <span class="card-status ${statusClass}">${statusText}</span>
        ${currentUser ? `<button class="card-add-btn" onclick="event.preventDefault(); event.stopPropagation(); addToList('${anime.id}')" title="Add to list">+</button>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title" title="${title}">${title}</h3>
        <div class="card-meta">
          <span class="card-format">${anime.format || 'TV'}</span>
          <span class="card-eps">${episodes}</span>
        </div>
        ${nextEp ? `<div class="card-next-ep">${nextEp}</div>` : ''}
        ${anime.studios?.length ? `<div class="card-studio">${anime.studios[0]}</div>` : ''}
      </div>
    </a>
  `;
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  switch (status) {
    case 'RELEASING': return 'status-airing';
    case 'FINISHED': return 'status-finished';
    case 'NOT_YET_RELEASED': return 'status-upcoming';
    default: return '';
  }
}

/**
 * Format status for display
 */
function formatStatus(status) {
  switch (status) {
    case 'RELEASING': return 'Airing';
    case 'FINISHED': return 'Finished';
    case 'NOT_YET_RELEASED': return 'Upcoming';
    case 'CANCELLED': return 'Cancelled';
    case 'HIATUS': return 'Hiatus';
    default: return status;
  }
}

/**
 * Get next episode text
 */
function getNextEpisodeText(anime) {
  if (!anime.nextEpisodeAt || anime.status !== 'RELEASING') return '';
  
  const nextDate = new Date(anime.nextEpisodeAt);
  const now = new Date();
  const diff = nextDate - now;
  
  if (diff < 0) return '';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (days > 0) {
    return `Ep ${anime.nextEpisode} in ${days}d ${hours}h`;
  } else if (hours > 0) {
    return `Ep ${anime.nextEpisode} in ${hours}h`;
  } else {
    return `Ep ${anime.nextEpisode} soon!`;
  }
}

/**
 * Update season display
 */
function updateSeasonDisplay() {
  const title = document.getElementById('seasonTitle');
  if (title) {
    title.textContent = `${seasonNames[currentSeason]} ${currentYear}`;
  }
}

/**
 * Update stats display
 */
async function updateStats() {
  const total = animeCache.length;
  const airing = animeCache.filter(a => a.status === 'RELEASING').length;
  const dubbed = animeCache.filter(a => a.hasDub).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statAiring').textContent = airing;
  document.getElementById('statDubbed').textContent = dubbed;

  // Update last sync time
  refs.syncLog.child('lastSync').once('value', snapshot => {
    const lastSync = snapshot.val();
    if (lastSync?.timestamp) {
      const date = new Date(lastSync.timestamp);
      const timeAgo = getTimeAgo(date);
      document.getElementById('lastUpdated').textContent = `Updated ${timeAgo}`;
    }
  });
}

/**
 * Check dubs for all anime in current view (background)
 */
async function checkDubsInBackground() {
  // Get anime that haven't been checked recently (24 hours)
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const needsCheck = animeCache.filter(a => 
    !a.dubCheckedAt || a.dubCheckedAt < oneDayAgo
  );

  if (needsCheck.length === 0) {
    console.log('✅ All dubs recently checked');
    return;
  }

  console.log(`🎬 Checking dubs for ${needsCheck.length} anime...`);

  let updated = false;

  // Check in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < needsCheck.length; i += batchSize) {
    const batch = needsCheck.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async anime => {
      try {
        const result = await dubChecker.checkDub(anime);
        // Update memory cache
        const idx = animeCache.findIndex(a => a.id === anime.id);
        if (idx !== -1) {
          animeCache[idx].hasDub = result.hasDub;
          animeCache[idx].dubPlatforms = result.platforms;
          animeCache[idx].dubConfidence = result.confidence;
          animeCache[idx].dubCheckedAt = Date.now();
          updated = true;
          
          // Update local storage cache for this anime
          localCache.updateAnime(currentSeason, currentYear, animeCache[idx]);
        }
      } catch (err) {
        console.error(`Dub check failed for ${anime.title}:`, err);
      }
    }));

    // Small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }

  // Update stats and re-render to show dub badges
  if (updated) {
    updateStats();
    filterAnime();
    // Save full cache update
    localCache.save(currentSeason, currentYear, animeCache);
  }
  console.log('✅ Dub check complete');
}

/**
 * Get relative time string
 */
function getTimeAgo(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Show anime details modal
 */
function showAnimeDetails(animeId) {
  // TODO: Implement modal or navigate to details page
  console.log('Show details for:', animeId);
}

/**
 * Add anime to user's list
 */
async function addToList(animeId) {
  if (!currentUser) {
    alert('Please login to add anime to your list');
    return;
  }

  try {
    await refs.userLists.child(currentUser.uid).child(animeId).set({
      status: 'PLANNING',
      progress: 0,
      addedAt: Date.now()
    });
    alert('Added to your list!');
  } catch (error) {
    console.error('Error adding to list:', error);
    alert('Failed to add. Please try again.');
  }
}

/**
 * Handle auth state changes
 */
async function handleAuthChange(user) {
  const previousUser = currentUser;
  currentUser = user;
  updateNavForAuth();

  // Check if user just logged in or switched accounts
  if (user && (!previousUser || previousUser.uid !== user.uid)) {
    console.log('🔄 Session changed - checking for updates...');
    
    try {
      // Check if sync is needed
      const syncCheck = await animeSync.checkSyncNeeded();
      
      if (syncCheck.needed) {
        showSyncBanner(true);
        await animeSync.runSync(syncCheck.type);
        hideSyncBanner();
      }

      // Reload anime to get fresh data
      await loadAnime();
      
      console.log('✅ Session sync complete');
    } catch (error) {
      console.error('Session sync error:', error);
    }
  }
}

/**
 * Update navigation for auth state
 */
function updateNavForAuth() {
  const navUser = document.getElementById('navUser');
  
  if (currentUser) {
    navUser.innerHTML = `
      <div class="user-menu">
        <img src="${currentUser.photoURL || 'public/images/default-avatar.png'}" 
             alt="${currentUser.displayName}" class="user-avatar">
        <div class="user-dropdown">
          <span class="user-name">${currentUser.displayName}</span>
          <a href="#my-list" onclick="showPage('my-list')">My List</a>
          <a href="#" onclick="handleLogout()">Logout</a>
        </div>
      </div>
    `;
  } else {
    navUser.innerHTML = `
      <button id="loginBtn" class="btn-primary" onclick="handleLogin()">Login with Google</button>
    `;
  }
}

/**
 * Handle Google login
 */
async function handleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed: ' + error.message);
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('Logout error:', error);
  }
}

/**
 * Show sync banner
 */
function showSyncBanner(show) {
  const banner = document.getElementById('syncBanner');
  if (banner) {
    banner.style.display = show ? 'block' : 'none';
  }
}

/**
 * Hide sync banner after delay
 */
function hideSyncBanner() {
  setTimeout(() => {
    showSyncBanner(false);
  }, 2000);
}

/**
 * Update sync progress display
 */
function updateSyncProgress(percent, message) {
  const progressBar = document.getElementById('syncProgress');
  const messageEl = document.getElementById('syncMessage');
  
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (messageEl) {
    messageEl.textContent = message;
  }
}

/**
 * Show error message
 */
function showError(message) {
  const grid = document.getElementById('animeGrid');
  grid.innerHTML = `<div class="error">${message}</div>`;
}

/**
 * Navigate to different pages/views
 */
function showPage(page) {
  console.log('Navigate to:', page);
  // TODO: Implement SPA navigation or separate pages
}

// Force sync (for debugging)
window.forceSync = async (type = 'full') => {
  showSyncBanner(true);
  await animeSync.runSync(type);
  hideSyncBanner();
  await loadAnime();
};
