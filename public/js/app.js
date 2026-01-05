/**
 * Anime Tracker - Main Application
 * 
 * Serverless client-side app using Firebase Realtime Database
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
  document.getElementById('prevSeason')?.addEventListener('click', () => {
    const idx = seasons.indexOf(currentSeason);
    if (idx === 0) {
      currentSeason = seasons[3];
      currentYear--;
    } else {
      currentSeason = seasons[idx - 1];
    }
    updateSeasonDisplay();
    loadAnime();
  });

  document.getElementById('nextSeason')?.addEventListener('click', () => {
    const idx = seasons.indexOf(currentSeason);
    if (idx === 3) {
      currentSeason = seasons[0];
      currentYear++;
    } else {
      currentSeason = seasons[idx + 1];
    }
    updateSeasonDisplay();
    loadAnime();
  });

  // Filters
  document.getElementById('statusFilter')?.addEventListener('change', filterAnime);
  document.getElementById('formatFilter')?.addEventListener('change', filterAnime);
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
 * Load anime from Firebase
 */
async function loadAnime() {
  const grid = document.getElementById('animeGrid');
  grid.innerHTML = '<div class="loading">Loading anime...</div>';

  try {
    // Query anime for current season
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

    // Update stats
    updateStats();

    // Render
    renderAnimeGrid(animeCache);

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
  const score = anime.score ? `⭐ ${anime.score}%` : '';
  const episodes = anime.episodes ? `${anime.episodes} eps` : 'TBA';
  const nextEp = getNextEpisodeText(anime);

  return `
    <div class="anime-card" onclick="showAnimeDetails('${anime.id}')" style="--accent-color: ${anime.coverColor || '#6366f1'}">
      <div class="anime-poster">
        <img src="${anime.coverImage || '/images/no-poster.png'}" alt="${anime.title}" loading="lazy">
        <div class="anime-overlay">
          <span class="anime-status ${statusClass}">${formatStatus(anime.status)}</span>
          ${score ? `<span class="anime-score">${score}</span>` : ''}
        </div>
        ${currentUser ? `<button class="add-btn" onclick="event.stopPropagation(); addToList('${anime.id}')">+</button>` : ''}
      </div>
      <div class="anime-info">
        <h3 class="anime-title" title="${anime.title}">${anime.title}</h3>
        <div class="anime-meta">
          <span>${anime.format || 'TV'}</span>
          <span>${episodes}</span>
        </div>
        ${nextEp ? `<div class="anime-next">${nextEp}</div>` : ''}
      </div>
    </div>
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
function updateStats() {
  const total = animeCache.length;
  const airing = animeCache.filter(a => a.status === 'RELEASING').length;
  const dubbed = 0; // TODO: Implement dub tracking

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
function handleAuthChange(user) {
  currentUser = user;
  updateNavForAuth();
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
