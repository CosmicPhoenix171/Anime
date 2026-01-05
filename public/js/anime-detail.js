/**
 * Anime Detail Page
 * Loads and displays full anime information
 */

const ANILIST_API = 'https://graphql.anilist.co';
let currentAnime = null;
let currentUser = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Get anime ID from URL
  const params = new URLSearchParams(window.location.search);
  const animeId = params.get('id');

  if (!animeId) {
    showError();
    return;
  }

  // Setup auth listener
  auth.onAuthStateChanged(user => {
    currentUser = user;
    updateNavForAuth();
    updateAddButton();
  });

  // Load anime details
  await loadAnimeDetails(animeId);
});

/**
 * Load anime details from Firebase and AniList
 */
async function loadAnimeDetails(animeId) {
  try {
    // First try Firebase
    const snapshot = await refs.anime.child(animeId).once('value');
    let anime = snapshot.val();

    if (anime) {
      anime.id = animeId;
      displayAnimeDetails(anime);
      
      // Fetch fresh data from AniList for relations
      fetchAniListDetails(anime.anilistId);
    } else {
      // Try fetching from AniList directly
      const numericId = parseInt(animeId.replace('al_', ''));
      if (!isNaN(numericId)) {
        const anilistData = await fetchAniListDetails(numericId, true);
        if (anilistData) {
          displayAnimeDetails(anilistData);
        } else {
          showError();
        }
      } else {
        showError();
      }
    }
  } catch (error) {
    console.error('Error loading anime:', error);
    showError();
  }
}

/**
 * Fetch detailed info from AniList including relations
 */
async function fetchAniListDetails(anilistId, returnData = false) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        idMal
        title {
          romaji
          english
          native
        }
        description(asHtml: false)
        season
        seasonYear
        status
        episodes
        duration
        format
        genres
        averageScore
        popularity
        coverImage {
          large
          extraLarge
          color
        }
        bannerImage
        studios(isMain: true) {
          nodes {
            id
            name
            siteUrl
          }
        }
        nextAiringEpisode {
          episode
          airingAt
          timeUntilAiring
        }
        relations {
          edges {
            relationType
            node {
              id
              title {
                romaji
                english
              }
              format
              status
              coverImage {
                medium
              }
              seasonYear
            }
          }
        }
        externalLinks {
          site
          url
          type
          icon
          color
        }
        streamingEpisodes {
          site
          title
          url
          thumbnail
        }
        siteUrl
      }
    }
  `;

  try {
    const response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { id: anilistId } })
    });

    const data = await response.json();
    const media = data?.data?.Media;

    if (media) {
      displayRelations(media.relations);
      displayExternalLinks(media.externalLinks);
      displayStreamingLinks(media.streamingEpisodes, media.externalLinks);
      
      // Also fetch TMDB data for additional info (trailers, watch providers)
      fetchTMDBData(media.title.english || media.title.romaji, media.seasonYear);
      
      if (returnData) {
        return {
          id: `al_${media.id}`,
          anilistId: media.id,
          malId: media.idMal,
          title: media.title.english || media.title.romaji,
          titleRomaji: media.title.romaji,
          titleEnglish: media.title.english,
          titleNative: media.title.native,
          description: media.description,
          season: media.season,
          year: media.seasonYear,
          status: media.status,
          episodes: media.episodes,
          format: media.format,
          genres: media.genres,
          score: media.averageScore,
          popularity: media.popularity,
          coverImage: media.coverImage?.extraLarge || media.coverImage?.large,
          bannerImage: media.bannerImage,
          studios: media.studios?.nodes?.map(s => s.name) || [],
          nextEpisode: media.nextAiringEpisode?.episode,
          nextEpisodeAt: media.nextAiringEpisode?.airingAt 
            ? new Date(media.nextAiringEpisode.airingAt * 1000).toISOString() 
            : null,
          siteUrl: media.siteUrl
        };
      }
    }

    return null;
  } catch (error) {
    console.error('AniList fetch error:', error);
    return null;
  }
}

/**
 * Display anime details on page
 */
function displayAnimeDetails(anime) {
  currentAnime = anime;
  
  // Hide loading, show content
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('animeContent').style.display = 'block';

  // Set page title
  document.title = `${anime.titleEnglish || anime.title} - Anime Tracker`;

  // Banner
  const banner = document.getElementById('animeBanner');
  if (anime.bannerImage) {
    banner.style.backgroundImage = `url(${anime.bannerImage})`;
    banner.classList.add('has-banner');
  } else if (anime.coverImage) {
    banner.style.backgroundImage = `url(${anime.coverImage})`;
    banner.classList.add('has-banner', 'cover-banner');
  }

  // Poster
  document.getElementById('animePoster').src = anime.coverImage || '';
  document.getElementById('animePoster').alt = anime.title;

  // Titles
  document.getElementById('animeTitle').textContent = anime.titleEnglish || anime.title || anime.titleRomaji;
  document.getElementById('animeTitleNative').textContent = anime.titleNative || anime.titleRomaji || '';

  // Quick info tags
  document.getElementById('animeFormat').textContent = formatType(anime.format);
  document.getElementById('animeStatus').textContent = formatStatus(anime.status);
  document.getElementById('animeStatus').className = `info-tag status ${getStatusClass(anime.status)}`;
  document.getElementById('animeEpisodes').textContent = anime.episodes ? `${anime.episodes} Episodes` : 'TBA';
  document.getElementById('animeSeason').textContent = anime.season && anime.year 
    ? `${formatSeason(anime.season)} ${anime.year}` 
    : anime.year || '';

  // Score
  const score = anime.score || anime.averageScore;
  document.getElementById('animeScore').textContent = score || '--';
  const scoreCircle = document.getElementById('scoreCircle');
  if (score) {
    scoreCircle.className = `score-circle ${getScoreClass(score)}`;
  }
  document.getElementById('animePopularity').textContent = anime.popularity 
    ? `${anime.popularity.toLocaleString()} users` 
    : '';

  // Genres
  const genresContainer = document.getElementById('animeGenres');
  genresContainer.innerHTML = (anime.genres || [])
    .map(g => `<span class="genre-tag">${g}</span>`)
    .join('');

  // Description
  document.getElementById('animeDescription').innerHTML = formatDescription(anime.description);

  // AniList link
  document.getElementById('anilistLink').href = `https://anilist.co/anime/${anime.anilistId}`;
  
  // MAL link
  if (anime.malId) {
    const malLink = document.getElementById('malLink');
    malLink.href = `https://myanimelist.net/anime/${anime.malId}`;
    malLink.style.display = 'inline-flex';
  }

  // Studios
  const studiosContainer = document.getElementById('animeStudios');
  studiosContainer.innerHTML = (anime.studios || [])
    .map(s => `<span class="studio-tag">${s}</span>`)
    .join('') || '<span class="no-data">No studio information</span>';

  // Airing info
  if (anime.status === 'RELEASING' && anime.nextEpisodeAt) {
    document.getElementById('airingSection').style.display = 'block';
    document.getElementById('nextEpisode').textContent = `Episode ${anime.nextEpisode || '?'}`;
    updateCountdown(anime.nextEpisodeAt);
  }

  // Dub info
  if (anime.hasDub) {
    document.getElementById('dubSection').style.display = 'block';
    document.getElementById('dubBadge').style.display = 'block';
    document.getElementById('dubStatus').textContent = anime.dubStatus || 'Available';
    
    const platformsContainer = document.getElementById('dubPlatforms');
    if (anime.dubPlatforms?.length) {
      platformsContainer.innerHTML = anime.dubPlatforms
        .map(p => `<span class="platform-tag">${p}</span>`)
        .join('');
    } else {
      platformsContainer.innerHTML = '<span class="no-data">Check streaming services</span>';
    }
  }

  updateAddButton();
}

/**
 * Display related anime (sequels, prequels, etc.)
 */
function displayRelations(relations) {
  if (!relations?.edges?.length) {
    document.getElementById('relatedAnime').innerHTML = '<p class="no-data">No related anime found</p>';
    return;
  }

  // Sort by relation type priority
  const priority = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'OTHER'];
  const sorted = relations.edges.sort((a, b) => {
    return priority.indexOf(a.relationType) - priority.indexOf(b.relationType);
  });

  const html = sorted.map(edge => {
    const node = edge.node;
    const title = node.title.english || node.title.romaji;
    return `
      <a href="./anime.html?id=al_${node.id}" class="related-card">
        <img src="${node.coverImage?.medium || ''}" alt="${title}" loading="lazy">
        <div class="related-info">
          <span class="relation-type">${formatRelationType(edge.relationType)}</span>
          <h4>${title}</h4>
          <span class="related-meta">${formatType(node.format)} • ${node.seasonYear || 'TBA'}</span>
        </div>
      </a>
    `;
  }).join('');

  document.getElementById('relatedAnime').innerHTML = html;
}

/**
 * Display external links
 */
function displayExternalLinks(links) {
  if (!links?.length) {
    document.getElementById('externalLinks').innerHTML = '<p class="no-data">No external links</p>';
    return;
  }

  const html = links.map(link => `
    <a href="${link.url}" target="_blank" class="external-link" style="--link-color: ${link.color || '#667eea'}">
      ${link.site}
    </a>
  `).join('');

  document.getElementById('externalLinks').innerHTML = html;
}

/**
 * Display streaming links
 */
function displayStreamingLinks(episodes, externalLinks) {
  const streamingContainer = document.getElementById('streamingLinks');
  
  // Get streaming services from external links
  const streamingSites = ['Crunchyroll', 'Funimation', 'Netflix', 'Hulu', 'Amazon Prime Video', 
    'Disney+', 'HBO Max', 'Hidive', 'VRV', 'YouTube', 'Bilibili'];
  
  const streamingLinks = (externalLinks || []).filter(link => 
    streamingSites.some(site => link.site.toLowerCase().includes(site.toLowerCase())) ||
    link.type === 'STREAMING'
  );

  if (!streamingLinks.length && !episodes?.length) {
    document.getElementById('streamingSection').style.display = 'none';
    return;
  }

  let html = '';

  // Streaming service buttons
  if (streamingLinks.length) {
    html += '<div class="streaming-services">';
    html += streamingLinks.map(link => `
      <a href="${link.url}" target="_blank" class="streaming-btn" style="--link-color: ${link.color || '#667eea'}">
        ${link.site}
      </a>
    `).join('');
    html += '</div>';
  }

  // Episode thumbnails (if available)
  if (episodes?.length) {
    html += '<div class="episode-list">';
    html += episodes.slice(0, 12).map(ep => `
      <a href="${ep.url}" target="_blank" class="episode-card">
        <img src="${ep.thumbnail}" alt="${ep.title}" loading="lazy">
        <span class="episode-title">${ep.title}</span>
      </a>
    `).join('');
    html += '</div>';
  }

  streamingContainer.innerHTML = html;
}

/**
 * Fetch additional data from TMDB (trailers, watch providers, ratings)
 */
async function fetchTMDBData(title, year) {
  try {
    if (typeof tmdbService === 'undefined') {
      console.log('TMDB service not loaded');
      return;
    }

    // Search for the anime on TMDB
    const searchResult = await tmdbService.searchAnime(title, year);
    if (!searchResult) {
      console.log('No TMDB match found for:', title);
      return;
    }

    const type = searchResult.media_type || (searchResult.first_air_date ? 'tv' : 'movie');
    
    // Get full details
    const details = await tmdbService.getDetails(searchResult.id, type);
    if (!details) return;

    // Display TMDB section
    displayTMDBInfo(details);

    // Display trailers
    if (details.videos?.length) {
      displayTrailers(details.videos);
    }

    // Display additional watch providers from TMDB
    if (details.watchProviders) {
      displayTMDBWatchProviders(details.watchProviders);
    }

  } catch (error) {
    console.error('TMDB fetch error:', error);
  }
}

/**
 * Display TMDB info section
 */
function displayTMDBInfo(details) {
  const tmdbSection = document.getElementById('tmdbSection');
  if (!tmdbSection) return;

  tmdbSection.style.display = 'block';

  // TMDB Rating
  if (details.voteAverage) {
    const rating = (details.voteAverage).toFixed(1);
    document.getElementById('tmdbRating').innerHTML = `
      <span class="tmdb-score">${rating}</span>
      <span class="tmdb-votes">(${details.voteCount?.toLocaleString() || 0} votes)</span>
    `;
  }

  // IMDB Link
  if (details.imdbId) {
    const imdbLink = document.getElementById('imdbLink');
    if (imdbLink) {
      imdbLink.href = `https://www.imdb.com/title/${details.imdbId}`;
      imdbLink.style.display = 'inline-flex';
    }
  }

  // TMDB Link
  const tmdbLink = document.getElementById('tmdbLink');
  if (tmdbLink) {
    tmdbLink.href = `https://www.themoviedb.org/${details.type}/${details.id}`;
    tmdbLink.style.display = 'inline-flex';
  }
}

/**
 * Display trailers section
 */
function displayTrailers(videos) {
  const trailersSection = document.getElementById('trailersSection');
  if (!trailersSection) return;

  // Filter for trailers and teasers
  const trailers = videos.filter(v => 
    v.site === 'YouTube' && 
    (v.type === 'Trailer' || v.type === 'Teaser' || v.type === 'Clip')
  ).slice(0, 4);

  if (!trailers.length) return;

  trailersSection.style.display = 'block';

  const container = document.getElementById('trailersList');
  container.innerHTML = trailers.map(video => `
    <a href="https://www.youtube.com/watch?v=${video.key}" target="_blank" class="trailer-card">
      <div class="trailer-thumb">
        <img src="https://img.youtube.com/vi/${video.key}/mqdefault.jpg" alt="${video.name}" loading="lazy">
        <div class="play-overlay">▶</div>
      </div>
      <span class="trailer-title">${video.name}</span>
      <span class="trailer-type">${video.type}</span>
    </a>
  `).join('');
}

/**
 * Display watch providers from TMDB
 */
function displayTMDBWatchProviders(providers) {
  const container = document.getElementById('tmdbProviders');
  if (!container) return;

  const allProviders = [
    ...(providers.flatrate || []),
    ...(providers.free || [])
  ];

  if (!allProviders.length) return;

  document.getElementById('tmdbProvidersSection').style.display = 'block';

  container.innerHTML = allProviders.map(p => `
    <a href="${providers.link || '#'}" target="_blank" class="provider-badge" title="${p.name}">
      <img src="${p.logo}" alt="${p.name}" loading="lazy">
      <span>${p.name}</span>
    </a>
  `).join('');
}

/**
 * Update countdown timer
 */
function updateCountdown(isoDate) {
  const countdown = () => {
    const now = new Date();
    const target = new Date(isoDate);
    const diff = target - now;

    if (diff <= 0) {
      document.getElementById('nextEpisodeTime').textContent = 'Aired!';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    let text = '';
    if (days > 0) text += `${days}d `;
    if (hours > 0 || days > 0) text += `${hours}h `;
    text += `${minutes}m`;

    document.getElementById('nextEpisodeTime').textContent = text;
  };

  countdown();
  setInterval(countdown, 60000); // Update every minute
}

/**
 * Add to user's list
 */
async function addToMyList() {
  if (!currentUser) {
    alert('Please login to add anime to your list');
    return;
  }

  if (!currentAnime) return;

  try {
    const userAnimeRef = refs.db.ref(`userLists/${currentUser.uid}/${currentAnime.id}`);
    await userAnimeRef.set({
      animeId: currentAnime.id,
      title: currentAnime.title,
      coverImage: currentAnime.coverImage,
      status: 'PLANNING',
      progress: 0,
      addedAt: Date.now()
    });

    alert('Added to your list!');
    updateAddButton();
  } catch (error) {
    console.error('Error adding to list:', error);
    alert('Failed to add to list');
  }
}

/**
 * Update add button state
 */
async function updateAddButton() {
  const btn = document.getElementById('addToListBtn');
  if (!btn) return;

  if (!currentUser) {
    btn.textContent = '+ Add to My List';
    btn.disabled = false;
    return;
  }

  if (!currentAnime) return;

  try {
    const snapshot = await refs.db.ref(`userLists/${currentUser.uid}/${currentAnime.id}`).once('value');
    if (snapshot.exists()) {
      btn.textContent = '✓ In My List';
      btn.classList.add('in-list');
    } else {
      btn.textContent = '+ Add to My List';
      btn.classList.remove('in-list');
    }
  } catch (error) {
    console.error('Error checking list:', error);
  }
}

/**
 * Show error state
 */
function showError() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('errorState').style.display = 'block';
}

// Helper functions
function formatStatus(status) {
  const map = {
    'RELEASING': 'Airing',
    'FINISHED': 'Finished',
    'NOT_YET_RELEASED': 'Upcoming',
    'CANCELLED': 'Cancelled',
    'HIATUS': 'Hiatus'
  };
  return map[status] || status;
}

function getStatusClass(status) {
  const map = {
    'RELEASING': 'airing',
    'FINISHED': 'finished',
    'NOT_YET_RELEASED': 'upcoming',
    'CANCELLED': 'cancelled',
    'HIATUS': 'hiatus'
  };
  return map[status] || '';
}

function formatType(format) {
  const map = {
    'TV': 'TV Series',
    'TV_SHORT': 'TV Short',
    'MOVIE': 'Movie',
    'SPECIAL': 'Special',
    'OVA': 'OVA',
    'ONA': 'ONA',
    'MUSIC': 'Music'
  };
  return map[format] || format;
}

function formatSeason(season) {
  return season ? season.charAt(0) + season.slice(1).toLowerCase() : '';
}

function formatRelationType(type) {
  const map = {
    'PREQUEL': 'Prequel',
    'SEQUEL': 'Sequel',
    'PARENT': 'Parent Story',
    'SIDE_STORY': 'Side Story',
    'SPIN_OFF': 'Spin-off',
    'ALTERNATIVE': 'Alternative',
    'CHARACTER': 'Character',
    'SUMMARY': 'Summary',
    'OTHER': 'Other'
  };
  return map[type] || type;
}

function getScoreClass(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function formatDescription(desc) {
  if (!desc) return '<p class="no-data">No description available</p>';
  // Remove HTML tags and convert line breaks
  return desc
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .filter(p => p.trim())
    .map(p => `<p>${p}</p>`)
    .join('');
}

// Auth functions
function updateNavForAuth() {
  const navUser = document.getElementById('navUser');
  if (currentUser) {
    navUser.innerHTML = `
      <div class="user-menu">
        <img src="${currentUser.photoURL || ''}" alt="${currentUser.displayName}" class="user-avatar">
        <span class="user-name">${currentUser.displayName}</span>
      </div>
    `;
  } else {
    navUser.innerHTML = `
      <button id="loginBtn" class="btn-primary" onclick="handleLogin()">Login with Google</button>
    `;
  }
}

async function handleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed: ' + error.message);
  }
}
