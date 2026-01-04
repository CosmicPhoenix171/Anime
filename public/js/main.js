// Main page functionality
document.addEventListener('DOMContentLoaded', async () => {
  // State
  let currentUser = null;
  let currentSeason = null;
  let currentYear = null;
  let currentOffset = 0;
  const pageSize = 50;
  let debounceTimer = null;

  // DOM Elements
  const loginBtn = document.getElementById('loginBtn');
  const navUser = document.getElementById('navUser');
  const statusFilter = document.getElementById('statusFilter');
  const dubFilter = document.getElementById('dubFilter');
  const platformFilter = document.getElementById('platformFilter');
  const sortFilter = document.getElementById('sortFilter');
  const searchInput = document.getElementById('searchInput');
  const animeGrid = document.getElementById('animeGrid');
  const seasonTitle = document.getElementById('seasonTitle');
  const prevSeasonBtn = document.getElementById('prevSeason');
  const nextSeasonBtn = document.getElementById('nextSeason');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');

  // Season data
  const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const seasonNames = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };

  // Initialize
  await checkAuth();
  await getSeasonInfo();
  await loadAnime();

  // Check auth status
  async function checkAuth() {
    try {
      const response = await fetch('/auth/status');
      const data = await response.json();
      if (data.authenticated) {
        currentUser = data.user;
        updateNavForUser();
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    }
  }

  function updateNavForUser() {
    if (currentUser) {
      navUser.innerHTML = `
        <div class="user-menu">
          <img src="${currentUser.picture || '/images/default-avatar.png'}" alt="${currentUser.name}" class="user-avatar">
          <div class="user-dropdown">
            <a href="/dashboard">Dashboard</a>
            <a href="/my-list">My List</a>
            <a href="/my-season">My Season</a>
            ${currentUser.is_admin ? '<a href="/admin">Admin</a>' : ''}
            <a href="/auth/logout">Logout</a>
          </div>
        </div>
      `;
    }
  }

  // Get current season info from server
  async function getSeasonInfo() {
    try {
      const response = await fetch('/api/season-info');
      const data = await response.json();
      currentSeason = data.currentSeason;
      currentYear = data.currentYear;
      updateSeasonDisplay();
    } catch (error) {
      // Default to current
      const now = new Date();
      const month = now.getMonth() + 1;
      currentYear = now.getFullYear();
      if (month >= 1 && month <= 3) currentSeason = 'WINTER';
      else if (month >= 4 && month <= 6) currentSeason = 'SPRING';
      else if (month >= 7 && month <= 9) currentSeason = 'SUMMER';
      else currentSeason = 'FALL';
      updateSeasonDisplay();
    }
  }

  function updateSeasonDisplay() {
    seasonTitle.textContent = `${seasonNames[currentSeason]} ${currentYear}`;
  }

  // Season navigation
  prevSeasonBtn?.addEventListener('click', () => {
    const idx = seasons.indexOf(currentSeason);
    if (idx === 0) {
      currentSeason = seasons[3];
      currentYear--;
    } else {
      currentSeason = seasons[idx - 1];
    }
    updateSeasonDisplay();
    resetAndLoad();
  });

  nextSeasonBtn?.addEventListener('click', () => {
    const idx = seasons.indexOf(currentSeason);
    if (idx === 3) {
      currentSeason = seasons[0];
      currentYear++;
    } else {
      currentSeason = seasons[idx + 1];
    }
    updateSeasonDisplay();
    resetAndLoad();
  });

  // Login button
  loginBtn?.addEventListener('click', () => {
    if (currentUser) {
      window.location.href = '/dashboard';
    } else {
      window.location.href = '/auth/google';
    }
  });

  // Load anime
  async function loadAnime(append = false) {
    if (!append) {
      animeGrid.innerHTML = '<div class="loading">Loading anime...</div>';
      currentOffset = 0;
    }
    
    try {
      const params = new URLSearchParams({
        season: currentSeason,
        year: currentYear,
        limit: pageSize,
        offset: currentOffset
      });

      if (statusFilter?.value) params.append('status', statusFilter.value);
      if (dubFilter?.value) params.append('hasDub', dubFilter.value);
      if (platformFilter?.value) params.append('platform', platformFilter.value);
      if (sortFilter?.value) params.append('sort', sortFilter.value);
      if (searchInput?.value) params.append('search', searchInput.value);

      const response = await fetch(`/api/anime?${params}`);
      const anime = await response.json();

      if (!append) {
        animeGrid.innerHTML = '';
      }

      if (anime.length === 0 && !append) {
        animeGrid.innerHTML = '<div class="no-results">No anime found for this season. Try refreshing!</div>';
        loadMoreContainer.style.display = 'none';
        return;
      }

      anime.forEach(item => {
        const card = createAnimeCard(item);
        animeGrid.appendChild(card);
      });

      // Update stats
      updateStats();

      // Show/hide load more
      loadMoreContainer.style.display = anime.length === pageSize ? 'flex' : 'none';
      currentOffset += anime.length;

    } catch (error) {
      console.error('Error loading anime:', error);
      animeGrid.innerHTML = '<div class="error">Error loading anime. Please try again.</div>';
    }
  }

  async function updateStats() {
    try {
      const response = await fetch('/api/anime/stats');
      const stats = await response.json();
      document.getElementById('statTotal').textContent = stats.total || 0;
      document.getElementById('statAiring').textContent = stats.airing || 0;
      document.getElementById('statFinished').textContent = stats.finished || 0;
    } catch (e) {
      // Ignore stats errors
    }
  }

  function createAnimeCard(anime) {
    const card = document.createElement('div');
    card.className = 'anime-card';
    card.setAttribute('data-id', anime.id);
    
    const imageUrl = anime.poster_url || 'https://via.placeholder.com/200x280?text=No+Image';
    const title = anime.title_english || anime.title_romaji || anime.title;
    const episodes = anime.total_episodes || '?';
    const aired = anime.episodes_aired || 0;
    
    // Status badge
    let statusClass = 'badge-upcoming';
    let statusText = 'Upcoming';
    if (anime.status === 'AIRING') {
      statusClass = 'badge-airing';
      statusText = 'Airing';
    } else if (anime.status === 'FINISHED') {
      statusClass = 'badge-finished';
      statusText = 'Finished';
    }

    // Parse dub info
    let dubBadge = '';
    if (anime.dub_info) {
      const dubs = anime.dub_info.split(',');
      for (const dub of dubs) {
        const [platform, status] = dub.split(':');
        if (status === 'FINISHED') {
          dubBadge = `<span class="anime-badge badge-dub-complete">DUB ✓</span>`;
          break;
        } else if (status === 'ONGOING') {
          dubBadge = `<span class="anime-badge badge-dub">DUB</span>`;
        }
      }
    }

    // Score badge
    const scoreBadge = anime.average_score 
      ? `<span class="anime-score">${anime.average_score}%</span>` 
      : '';

    card.innerHTML = `
      <a href="/anime/${anime.id}" class="anime-card-link">
        <div class="anime-card-image">
          <img src="${imageUrl}" alt="${title}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x280?text=No+Image'">
          ${scoreBadge}
        </div>
        <div class="anime-card-body">
          <div class="anime-card-title" title="${title}">${title}</div>
          <div class="anime-card-info">
            <span class="episode-count">EP ${aired}/${episodes}</span>
          </div>
          <div class="anime-card-badges">
            <span class="anime-badge ${statusClass}">${statusText}</span>
            ${dubBadge}
          </div>
        </div>
      </a>
      ${currentUser ? `
        <div class="anime-card-actions">
          <button class="btn-icon add-to-list" data-id="${anime.id}" title="Add to list">+</button>
        </div>
      ` : ''}
    `;

    // Add to list handler
    const addBtn = card.querySelector('.add-to-list');
    if (addBtn) {
      addBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await fetch('/api/user/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ animeId: anime.id, status: 'PLANNED' })
          });
          addBtn.textContent = '✓';
          addBtn.disabled = true;
        } catch (err) {
          console.error('Error adding to list:', err);
        }
      });
    }
    
    return card;
  }

  function resetAndLoad() {
    currentOffset = 0;
    loadAnime();
  }

  // Filter listeners
  statusFilter?.addEventListener('change', resetAndLoad);
  dubFilter?.addEventListener('change', resetAndLoad);
  platformFilter?.addEventListener('change', resetAndLoad);
  sortFilter?.addEventListener('change', resetAndLoad);

  // Search with debounce
  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(resetAndLoad, 300);
  });

  // Load more
  loadMoreBtn?.addEventListener('click', () => {
    loadAnime(true);
  });

  // Mobile menu
  mobileMenuBtn?.addEventListener('click', () => {
    document.querySelector('.nav-links').classList.toggle('show');
  });
});
