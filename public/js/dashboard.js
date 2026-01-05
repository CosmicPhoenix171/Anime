// Dashboard functionality
document.addEventListener('DOMContentLoaded', async () => {
  const logoutBtn = document.getElementById('logoutBtn');
  const userName = document.getElementById('userName');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  let currentUser = null;
  let allAnime = [];
  let userProgress = [];

  // Check auth and load user
  try {
    const response = await fetch('/auth/status');
    const data = await response.json();
    if (!data.authenticated) {
      window.location.href = '/';
      return;
    }
    currentUser = data.user;
    userName.textContent = `👋 ${currentUser.name}`;
    
    // Load data
    await Promise.all([
      loadStats(),
      loadAnime(),
      loadUserProgress()
    ]);
  } catch (error) {
    console.error('Error checking auth:', error);
    window.location.href = '/';
  }

  // Logout
  logoutBtn.addEventListener('click', () => {
    window.location.href = '/auth/logout';
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(tabName).classList.add('active');
      
      // Load specific tab data
      if (tabName === 'dubTracker') {
        loadDubTracker();
      }
    });
  });

  // Load stats
  async function loadStats() {
    try {
      const response = await fetch('/api/user/stats');
      const stats = await response.json();
      
      document.getElementById('watchingCount').textContent = stats.watching || 0;
      document.getElementById('completedCount').textContent = stats.completed || 0;
      document.getElementById('totalEpisodes').textContent = stats.total_episodes_watched || 0;
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  // Load anime
  async function loadAnime() {
    const animeGrid = document.getElementById('animeGrid');
    const seasonFilter = document.getElementById('seasonFilter');
    const statusFilter = document.getElementById('statusFilter');
    const refreshBtn = document.getElementById('refreshBtn');
    
    async function fetchAndDisplayAnime() {
      animeGrid.innerHTML = '<div class="loading">Loading anime...</div>';
      
      try {
        let url = '/api/anime?';
        const params = [];
        
        if (seasonFilter.value) params.push(`season=${seasonFilter.value}`);
        if (statusFilter.value) params.push(`airing=${statusFilter.value}`);
        
        url += params.join('&');
        
        const response = await fetch(url);
        allAnime = await response.json();
        
        if (allAnime.length === 0) {
          animeGrid.innerHTML = '<div class="loading">No anime found.</div>';
          return;
        }
        
        displayAnime(allAnime);
      } catch (error) {
        console.error('Error loading anime:', error);
        animeGrid.innerHTML = '<div class="loading">Error loading anime.</div>';
      }
    }
    
    function displayAnime(anime) {
      animeGrid.innerHTML = '';
      anime.forEach(item => {
        const card = createAnimeCard(item);
        animeGrid.appendChild(card);
      });
    }
    
    seasonFilter.addEventListener('change', fetchAndDisplayAnime);
    statusFilter.addEventListener('change', fetchAndDisplayAnime);
    
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Updating...';
      
      try {
        await fetch('/api/anime/update', { method: 'POST' });
        alert('Database update started!');
        setTimeout(fetchAndDisplayAnime, 2000);
      } catch (error) {
        console.error('Error:', error);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
      }
    });
    
    await fetchAndDisplayAnime();
  }

  // Load user progress
  async function loadUserProgress() {
    const progressGrid = document.getElementById('progressGrid');
    
    try {
      const response = await fetch('/api/user/progress');
      userProgress = await response.json();
      
      if (userProgress.length === 0) {
        progressGrid.innerHTML = '<div class="loading">No progress yet. Start tracking anime from the Seasonal Anime tab!</div>';
        return;
      }
      
      progressGrid.innerHTML = '';
      userProgress.forEach(item => {
        const card = createProgressCard(item);
        progressGrid.appendChild(card);
      });
    } catch (error) {
      console.error('Error loading progress:', error);
      progressGrid.innerHTML = '<div class="loading">Error loading progress.</div>';
    }
  }

  // Load dub tracker
  async function loadDubTracker() {
    const dubGrid = document.getElementById('dubGrid');
    const dubFilterBtn = document.getElementById('dubFilterBtn');
    let showOnlyDubbed = false;
    
    dubFilterBtn.addEventListener('click', () => {
      showOnlyDubbed = !showOnlyDubbed;
      dubFilterBtn.textContent = showOnlyDubbed ? 'Show All' : 'Show Only Dubbed';
      displayDubAnime();
    });
    
    function displayDubAnime() {
      dubGrid.innerHTML = '';
      const filtered = showOnlyDubbed 
        ? allAnime.filter(a => a.dub_available) 
        : allAnime;
      
      if (filtered.length === 0) {
        dubGrid.innerHTML = '<div class="loading">No dubbed anime found.</div>';
        return;
      }
      
      filtered.forEach(item => {
        const card = createAnimeCard(item);
        dubGrid.appendChild(card);
      });
    }
    
    displayDubAnime();
  }

  // Create anime card
  function createAnimeCard(anime) {
    const card = document.createElement('div');
    card.className = 'anime-card';
    
    const imageUrl = anime.image_url || 'https://via.placeholder.com/200x280?text=No+Image';
    const title = anime.title_english || anime.title;
    const episodes = anime.episodes || '?';
    
    card.innerHTML = `
      <img src="${imageUrl}" alt="${title}" onerror="this.src='https://via.placeholder.com/200x280?text=No+Image'">
      <div class="anime-card-body">
        <div class="anime-card-title">${title}</div>
        <div class="anime-card-info">
          <span>Episodes: ${episodes}</span>
        </div>
        <span class="anime-badge ${anime.airing ? 'badge-airing' : 'badge-finished'}">
          ${anime.airing ? 'Airing' : 'Finished'}
        </span>
        ${anime.dub_available ? `<span class="anime-badge badge-dub">DUB: ${anime.dub_platform || 'Available'}</span>` : ''}
      </div>
    `;
    
    card.addEventListener('click', () => showAnimeModal(anime));
    
    return card;
  }

  // Create progress card
  function createProgressCard(item) {
    const card = document.createElement('div');
    card.className = 'progress-card';
    
    const imageUrl = item.image_url || 'https://via.placeholder.com/100x140?text=No+Image';
    const title = item.title_english || item.title;
    const totalEpisodes = item.episodes || 0;
    const watchedEpisodes = item.episodes_watched || 0;
    const percentage = totalEpisodes > 0 ? (watchedEpisodes / totalEpisodes) * 100 : 0;
    
    card.innerHTML = `
      <img src="${imageUrl}" alt="${title}" class="progress-image" onerror="this.src='https://via.placeholder.com/100x140?text=No+Image'">
      <div class="progress-details">
        <div class="progress-title">${title}</div>
        <div>Episodes: ${watchedEpisodes} / ${totalEpisodes}</div>
        <div>Status: <strong>${item.status}</strong></div>
        ${item.season && item.year ? `<div>Season: ${item.season} ${item.year}</div>` : ''}
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${percentage}%"></div>
        </div>
        <div class="progress-actions">
          <button class="btn-increment" data-anime-id="${item.anime_id}" data-current="${watchedEpisodes}" data-total="${totalEpisodes}">
            +1 Episode
          </button>
          <button class="btn-complete" data-anime-id="${item.anime_id}" data-total="${totalEpisodes}">
            Mark Complete
          </button>
          <button class="btn-session ${item.session_marked ? 'marked' : ''}" data-anime-id="${item.anime_id}" data-marked="${item.session_marked}">
            ${item.session_marked ? 'Unmark Session' : 'Mark Session'}
          </button>
        </div>
      </div>
    `;
    
    return card;
  }

  // Show anime modal
  function showAnimeModal(anime) {
    const modal = document.getElementById('animeModal');
    const modalBody = document.getElementById('modalBody');
    const closeBtn = document.querySelector('.close');
    
    const title = anime.title_english || anime.title;
    const imageUrl = anime.image_url || 'https://via.placeholder.com/600x400?text=No+Image';
    const synopsis = anime.synopsis || 'No synopsis available.';
    
    // Check if user is tracking this anime
    const progress = userProgress.find(p => p.anime_id === anime.id);
    
    modalBody.innerHTML = `
      <img src="${imageUrl}" alt="${title}" class="modal-anime-image" onerror="this.src='https://via.placeholder.com/600x400?text=No+Image'">
      <h2 class="modal-anime-title">${title}</h2>
      <div class="modal-anime-info">
        <strong>Episodes:</strong> ${anime.episodes || '?'}<br>
        <strong>Status:</strong> ${anime.airing ? 'Currently Airing' : 'Finished'}<br>
        ${anime.season && anime.year ? `<strong>Season:</strong> ${anime.season} ${anime.year}<br>` : ''}
        ${anime.dub_available ? `<strong>Dub:</strong> Available on ${anime.dub_platform || 'Unknown'}<br>` : '<strong>Dub:</strong> Not available<br>'}
      </div>
      <div class="modal-anime-synopsis">${synopsis}</div>
      ${!progress ? `
        <button class="btn-primary" onclick="startTracking(${anime.id})">Start Tracking</button>
      ` : `
        <div style="padding: 1rem; background: #f0f0f0; border-radius: 8px; margin-top: 1rem;">
          <strong>Your Progress:</strong> ${progress.episodes_watched} / ${anime.episodes || '?'} episodes
        </div>
      `}
    `;
    
    modal.style.display = 'block';
    
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  // Make startTracking available globally
  window.startTracking = async (animeId) => {
    try {
      await fetch('/api/user/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeId, episodesWatched: 0, status: 'watching' })
      });
      alert('Started tracking!');
      document.getElementById('animeModal').style.display = 'none';
      await Promise.all([loadStats(), loadUserProgress()]);
    } catch (error) {
      console.error('Error:', error);
      alert('Error starting tracking');
    }
  };

  // Event delegation for progress actions
  document.getElementById('progressGrid').addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-increment')) {
      const animeId = e.target.dataset.animeId;
      const current = parseInt(e.target.dataset.current);
      const total = parseInt(e.target.dataset.total);
      
      if (current < total) {
        await updateProgress(animeId, current + 1, 'watching');
      }
    } else if (e.target.classList.contains('btn-complete')) {
      const animeId = e.target.dataset.animeId;
      const total = parseInt(e.target.dataset.total);
      
      await updateProgress(animeId, total, 'completed');
    } else if (e.target.classList.contains('btn-session')) {
      const animeId = e.target.dataset.animeId;
      const marked = e.target.dataset.marked === 'true';
      
      await markSession(animeId, !marked);
    }
  });

  async function updateProgress(animeId, episodesWatched, status) {
    try {
      await fetch('/api/user/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeId, episodesWatched, status })
      });
      await Promise.all([loadStats(), loadUserProgress()]);
    } catch (error) {
      console.error('Error updating progress:', error);
      alert('Error updating progress');
    }
  }

  async function markSession(animeId, marked) {
    try {
      await fetch('/api/user/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeId, marked })
      });
      await loadUserProgress();
    } catch (error) {
      console.error('Error marking session:', error);
      alert('Error marking session');
    }
  }
});
