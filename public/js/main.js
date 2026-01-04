// Main page functionality
document.addEventListener('DOMContentLoaded', async () => {
  const loginBtn = document.getElementById('loginBtn');
  const getStartedBtn = document.getElementById('getStartedBtn');
  const statusFilter = document.getElementById('statusFilter');
  const refreshBtn = document.getElementById('refreshBtn');
  const animeGrid = document.getElementById('animeGrid');

  // Check auth status
  try {
    const response = await fetch('/auth/status');
    const data = await response.json();
    if (data.authenticated) {
      loginBtn.textContent = 'Go to Dashboard';
      loginBtn.onclick = () => window.location.href = '/dashboard';
    }
  } catch (error) {
    console.error('Error checking auth:', error);
  }

  // Login button
  loginBtn.addEventListener('click', () => {
    window.location.href = '/auth/google';
  });

  // Get started button
  getStartedBtn.addEventListener('click', () => {
    window.location.href = '/auth/google';
  });

  // Load anime
  async function loadAnime() {
    animeGrid.innerHTML = '<div class="loading">Loading anime...</div>';
    
    try {
      const airingFilter = statusFilter.value;
      let url = '/api/anime';
      if (airingFilter) {
        url += `?airing=${airingFilter}`;
      }

      const response = await fetch(url);
      const anime = await response.json();

      if (anime.length === 0) {
        animeGrid.innerHTML = '<div class="loading">No anime found. Click refresh to update database.</div>';
        return;
      }

      animeGrid.innerHTML = '';
      anime.forEach(item => {
        const card = createAnimeCard(item);
        animeGrid.appendChild(card);
      });
    } catch (error) {
      console.error('Error loading anime:', error);
      animeGrid.innerHTML = '<div class="loading">Error loading anime. Please try again.</div>';
    }
  }

  function createAnimeCard(anime) {
    const card = document.createElement('div');
    card.className = 'anime-card';
    
    const imageUrl = anime.image_url || 'https://via.placeholder.com/200x280?text=No+Image';
    const title = anime.title_english || anime.title;
    const episodes = anime.episodes || '?';
    const status = anime.airing ? 'Airing' : 'Finished';
    
    card.innerHTML = `
      <img src="${imageUrl}" alt="${title}" onerror="this.src='https://via.placeholder.com/200x280?text=No+Image'">
      <div class="anime-card-body">
        <div class="anime-card-title">${title}</div>
        <div class="anime-card-info">
          <span>Episodes: ${episodes}</span>
        </div>
        <span class="anime-badge ${anime.airing ? 'badge-airing' : 'badge-finished'}">${status}</span>
        ${anime.dub_available ? '<span class="anime-badge badge-dub">DUB</span>' : ''}
      </div>
    `;
    
    return card;
  }

  // Filter change
  statusFilter.addEventListener('change', loadAnime);

  // Refresh button
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Updating...';
    
    try {
      await fetch('/api/anime/update', { method: 'POST' });
      alert('Database update started! This may take a few minutes. Refresh the page in a moment to see new anime.');
    } catch (error) {
      console.error('Error triggering update:', error);
      alert('Error starting update. Please try again.');
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  });

  // Initial load
  loadAnime();
});
