const axios = require('axios');

const ANILIST_API = 'https://graphql.anilist.co';

class AniListService {
  /**
   * Get current season based on date
   */
  getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 1 && month <= 3) return 'WINTER';
    if (month >= 4 && month <= 6) return 'SPRING';
    if (month >= 7 && month <= 9) return 'SUMMER';
    return 'FALL';
  }

  /**
   * Get current year
   */
  getCurrentYear() {
    return new Date().getFullYear();
  }

  /**
   * Get next season info
   */
  getNextSeason() {
    const currentSeason = this.getCurrentSeason();
    const currentYear = this.getCurrentYear();
    
    const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
    const currentIndex = seasons.indexOf(currentSeason);
    const nextIndex = (currentIndex + 1) % 4;
    
    return {
      season: seasons[nextIndex],
      year: nextIndex === 0 ? currentYear + 1 : currentYear
    };
  }

  /**
   * Make a GraphQL request to AniList
   */
  async graphqlRequest(query, variables = {}) {
    try {
      const response = await axios.post(ANILIST_API, {
        query,
        variables
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        // Rate limited, wait and retry
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60');
        console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
        await this.sleep(retryAfter * 1000);
        return this.graphqlRequest(query, variables);
      }
      throw error;
    }
  }

  /**
   * Get seasonal anime from AniList
   */
  async getSeasonalAnime(season, year, page = 1) {
    const query = `
      query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
          }
          media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
            id
            idMal
            title {
              romaji
              english
              native
            }
            season
            seasonYear
            episodes
            status
            format
            source
            genres
            studios(isMain: true) {
              nodes {
                name
              }
            }
            nextAiringEpisode {
              airingAt
              episode
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
            coverImage {
              extraLarge
              large
              color
            }
            bannerImage
            description
            averageScore
            popularity
            trending
            isAdult
          }
        }
      }
    `;

    const variables = {
      season,
      year,
      page,
      perPage: 50
    };

    const result = await this.graphqlRequest(query, variables);
    return result.data.Page;
  }

  /**
   * Get all seasonal anime (handles pagination)
   */
  async getAllSeasonalAnime(season, year) {
    const allAnime = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`Fetching ${season} ${year} anime - page ${page}...`);
      const result = await this.getSeasonalAnime(season, year, page);
      
      allAnime.push(...result.media);
      hasNextPage = result.pageInfo.hasNextPage;
      page++;
      
      // Rate limit: 90 requests per minute, we'll be conservative
      await this.sleep(700);
    }

    return allAnime;
  }

  /**
   * Get anime details by AniList ID
   */
  async getAnimeDetails(anilistId) {
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
          season
          seasonYear
          episodes
          status
          format
          source
          genres
          studios(isMain: true) {
            nodes {
              name
            }
          }
          nextAiringEpisode {
            airingAt
            episode
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
          coverImage {
            extraLarge
            large
            color
          }
          bannerImage
          description
          averageScore
          popularity
          trending
          isAdult
          airingSchedule(notYetAired: false, page: 1, perPage: 1) {
            nodes {
              episode
              airingAt
            }
          }
        }
      }
    `;

    const result = await this.graphqlRequest(query, { id: anilistId });
    return result.data.Media;
  }

  /**
   * Get recently finished anime
   */
  async getRecentlyFinishedAnime(days = 30) {
    const query = `
      query ($page: Int, $perPage: Int, $status: MediaStatus) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
          }
          media(status: $status, type: ANIME, sort: END_DATE_DESC) {
            id
            idMal
            title {
              romaji
              english
            }
            episodes
            status
            endDate {
              year
              month
              day
            }
            coverImage {
              large
            }
          }
        }
      }
    `;

    const result = await this.graphqlRequest(query, {
      page: 1,
      perPage: 50,
      status: 'FINISHED'
    });

    // Filter to only include anime that finished within the specified days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return result.data.Page.media.filter(anime => {
      if (!anime.endDate?.year) return false;
      const endDate = new Date(
        anime.endDate.year,
        (anime.endDate.month || 1) - 1,
        anime.endDate.day || 1
      );
      return endDate >= cutoffDate;
    });
  }

  /**
   * Get airing anime that need episode updates
   */
  async getAiringAnime() {
    const query = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            hasNextPage
            currentPage
          }
          media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC) {
            id
            idMal
            title {
              romaji
              english
            }
            episodes
            status
            nextAiringEpisode {
              airingAt
              episode
            }
            airingSchedule(notYetAired: false, page: 1, perPage: 1) {
              nodes {
                episode
                airingAt
              }
            }
          }
        }
      }
    `;

    const allAiring = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage && page <= 10) {
      const result = await this.graphqlRequest(query, { page, perPage: 50 });
      allAiring.push(...result.data.Page.media);
      hasNextPage = result.data.Page.pageInfo.hasNextPage;
      page++;
      await this.sleep(700);
    }

    return allAiring;
  }

  /**
   * Search anime by title
   */
  async searchAnime(searchTerm, page = 1) {
    const query = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            hasNextPage
          }
          media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
            id
            idMal
            title {
              romaji
              english
            }
            season
            seasonYear
            episodes
            status
            format
            coverImage {
              large
            }
            averageScore
          }
        }
      }
    `;

    const result = await this.graphqlRequest(query, {
      search: searchTerm,
      page,
      perPage: 20
    });

    return result.data.Page;
  }

  /**
   * Transform AniList anime data to our database format
   */
  transformAnimeData(anime) {
    const studios = anime.studios?.nodes?.map(s => s.name).join(', ') || null;
    const genres = anime.genres?.join(', ') || null;
    
    // Calculate episodes aired from airing schedule
    let episodesAired = 0;
    if (anime.airingSchedule?.nodes?.length > 0) {
      episodesAired = anime.airingSchedule.nodes[0].episode;
    } else if (anime.nextAiringEpisode) {
      episodesAired = anime.nextAiringEpisode.episode - 1;
    } else if (anime.status === 'FINISHED') {
      episodesAired = anime.episodes || 0;
    }

    // Map AniList status to our status
    let status = 'NOT_AIRED';
    switch (anime.status) {
      case 'RELEASING':
        status = 'AIRING';
        break;
      case 'FINISHED':
        status = 'FINISHED';
        break;
      case 'NOT_YET_RELEASED':
        status = 'NOT_AIRED';
        break;
      case 'CANCELLED':
        status = 'CANCELLED';
        break;
      case 'HIATUS':
        status = 'HIATUS';
        break;
    }

    // Format dates
    const formatDate = (dateObj) => {
      if (!dateObj?.year) return null;
      const month = String(dateObj.month || 1).padStart(2, '0');
      const day = String(dateObj.day || 1).padStart(2, '0');
      return `${dateObj.year}-${month}-${day}`;
    };

    // Next episode date
    let nextEpisodeDate = null;
    if (anime.nextAiringEpisode?.airingAt) {
      nextEpisodeDate = new Date(anime.nextAiringEpisode.airingAt * 1000).toISOString();
    }

    return {
      anilist_id: anime.id,
      mal_id: anime.idMal || null,
      title: anime.title?.romaji || anime.title?.english || 'Unknown',
      title_english: anime.title?.english || null,
      title_romaji: anime.title?.romaji || null,
      season: anime.season || null,
      year: anime.seasonYear || null,
      total_episodes: anime.episodes || null,
      episodes_aired: episodesAired,
      status,
      format: anime.format || null,
      source: anime.source || null,
      genres,
      studios,
      next_episode_date: nextEpisodeDate,
      next_episode_number: anime.nextAiringEpisode?.episode || null,
      start_date: formatDate(anime.startDate),
      end_date: formatDate(anime.endDate),
      poster_url: anime.coverImage?.extraLarge || anime.coverImage?.large || null,
      banner_url: anime.bannerImage || null,
      cover_color: anime.coverImage?.color || null,
      synopsis: anime.description || null,
      average_score: anime.averageScore || null,
      popularity: anime.popularity || null,
      trending: anime.trending || null,
      is_adult: anime.isAdult ? 1 : 0
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AniListService();
