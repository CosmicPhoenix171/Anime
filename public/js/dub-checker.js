/**
 * Robust Dub Checker Service V2
 * 
 * Multi-layered redundancy system for accurate English dub detection:
 * 
 * Layer 1 - Direct API Sources:
 *   - AniList external links & streaming episodes
 *   - MyAnimeList via Jikan API (licensors, producers)
 *   - Kitsu streaming links with dub arrays
 *   - TMDB watch providers & translations
 * 
 * Layer 2 - Streaming Platform Detection:
 *   - Crunchyroll catalog check
 *   - Funimation/Hidive patterns
 *   - Netflix anime detection
 * 
 * Layer 3 - Heuristic Analysis:
 *   - Known dub patterns (popular series, studios)
 *   - English VA credits detection
 *   - Release timing analysis
 *   - Popularity-based prediction
 * 
 * Layer 4 - Community & Manual:
 *   - Firebase shared dub database
 *   - User-reported dubs
 *   - Manual admin overrides
 */

class DubChecker {
  constructor() {
    this.JIKAN_API = 'https://api.jikan.moe/v4';
    this.ANILIST_API = 'https://graphql.anilist.co';
    this.KITSU_API = 'https://kitsu.io/api/edge';
    this.RATE_LIMIT_MS = 1000;
    
    // Streaming platforms known to offer English dubs
    this.DUB_PLATFORMS = {
      'Crunchyroll': { hasDubs: true, priority: 1 },
      'Funimation': { hasDubs: true, priority: 1 },
      'Netflix': { hasDubs: true, priority: 1 },
      'Hulu': { hasDubs: true, priority: 2 },
      'Amazon Prime Video': { hasDubs: true, priority: 2 },
      'Disney+': { hasDubs: true, priority: 1 },
      'HBO Max': { hasDubs: true, priority: 2 },
      'Max': { hasDubs: true, priority: 2 },
      'Hidive': { hasDubs: true, priority: 1 },
      'Adult Swim': { hasDubs: true, priority: 1 },
      'Toonami': { hasDubs: true, priority: 1 },
      'Viz': { hasDubs: true, priority: 2 },
      'Sentai': { hasDubs: true, priority: 1 },
      'Aniplex': { hasDubs: true, priority: 2 },
      'Bang Zoom': { hasDubs: true, priority: 1 },
      'Cartoon Network': { hasDubs: true, priority: 1 }
    };

    // Known English dubbing studios
    this.DUB_STUDIOS = [
      'Funimation', 'Bang Zoom! Entertainment', 'Studiopolis', 'NYAV Post', 
      'Sound Cadence Studios', 'Okratron 5000', 'VSI Los Angeles',
      'Spliced Bread Productions', 'Kocha Sound', 'PCB Productions',
      'Ocean Productions', 'Blue Water Studios', 'Animaze', 'New Generation Pictures',
      'SDPB Creative', 'Cup of Tea Productions', 'Headline Studios'
    ];

    // Known English voice actors (partial list for detection)
    this.KNOWN_ENGLISH_VAS = [
      'bryce papenbrook', 'johnny yong bosch', 'cristina vee', 'crispin freeman',
      'laura bailey', 'travis willingham', 'matthew mercer', 'erica mendez',
      'zach aguilar', 'alejandro saab', 'kayli mills', 'kira buckland',
      'cherami leigh', 'todd haberkorn', 'j michael tatum', 'monica rial',
      'chris sabat', 'stephanie sheh', 'tara strong', 'yuri lowenthal',
      'steve blum', 'michelle ruff', 'keith silverstein', 'robbie daymond',
      'max mittelman', 'xanthe huynh', 'suzie yeung', 'daman mills',
      'billy kametz', 'aleks le', 'adam mcarthur', 'casey mongillo',
      'abby trott', 'allegra clark', 'anairis quinones', 'marin miller',
      'sarah wiedenheft', 'brina palencia', 'colleen clinkenbeard', 'jamie marchi'
    ];

    // Major licensors that typically dub their acquisitions
    this.DUB_LICENSORS = [
      'Funimation', 'Crunchyroll', 'Aniplex of America', 'Viz Media',
      'Sentai Filmworks', 'GKIDS', 'Eleven Arts', 'Shout! Factory',
      'Discotek Media', 'NIS America', 'Ponycan USA', 'Nozomi Entertainment'
    ];

    // Cache
    this.dubCache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000;
    
    // Jikan rate limiting queue (3 requests per second max)
    this.jikanQueue = [];
    this.jikanProcessing = false;
    this.JIKAN_RATE_MS = 350; // ~3 requests per second
  }

  /**
   * Main method - Multi-layered dub detection with redundancy
   * Uses parallel checking across all sources for accuracy
   */
  async checkDub(anime) {
    const animeId = anime.id || anime.anilistId;
    const malId = anime.malId || anime.idMal;
    const title = anime.title || anime.titleRomaji || anime.titleEnglish;
    const titleEnglish = anime.titleEnglish;
    const titleRomaji = anime.titleRomaji;

    // Check local cache first
    const cached = this.getFromCache(animeId);
    if (cached) {
      return cached;
    }

    // Check if Firebase already has recent dub data (from another user)
    const existingData = await this.getExistingDubData(animeId);
    if (existingData && existingData.confidence >= 70) {
      console.log(`✅ Using cached dub data for: ${title} (confidence: ${existingData.confidence}%)`);
      this.saveToCache(animeId, existingData);
      return existingData;
    }

    console.log(`🔍 Multi-layer dub check for: ${title}`);

    const results = {
      hasDub: false,
      confidence: 0,
      sources: [],
      platforms: [],
      dubEpisodes: null,
      dubStatus: null,
      englishVAs: [],
      lastChecked: Date.now()
    };

    try {
      const kitsuId = anime.kitsuId;
      
      // Run heuristic checks first (instant, no API calls)
      const heuristicChecks = this.runHeuristicChecks(anime);
      
      // OPTIMIZED: Run ALL API checks in parallel (Layer 1 + Layer 2 combined)
      const allChecks = await Promise.allSettled([
        // Layer 1 - Primary APIs
        this.checkAniListDub(animeId),
        malId ? this.checkJikanDubEnhanced(malId) : Promise.resolve(null),
        this.checkKitsuDub(kitsuId, title),
        this.checkTMDBDub(title, anime.year || anime.seasonYear),
        // Layer 2 - Secondary sources (independent, can run in parallel)
        this.checkFirebaseOverride(animeId),
        this.checkCommunityReports(animeId),
        this.checkKnownDubListEnhanced(animeId, title, titleEnglish, titleRomaji),
        this.checkEnglishVACredits(malId, animeId)
      ]);

      // Map results for easier access
      const [anilistCheck, jikanCheck, kitsuCheck, tmdbCheck, 
             overrideCheck, communityCheck, knownCheck, vaCheck] = allChecks;

      // Process results - AniList
      if (anilistCheck.status === 'fulfilled' && anilistCheck.value) {
        const anilistResult = anilistCheck.value;
        if (anilistResult.hasDub) {
          results.hasDub = true;
          results.confidence += anilistResult.confidence || 25;
          results.sources.push('AniList');
          results.platforms.push(...(anilistResult.platforms || []));
        }
      }

      // Jikan/MAL (enhanced)
      if (jikanCheck.status === 'fulfilled' && jikanCheck.value) {
        const jikanResult = jikanCheck.value;
        if (jikanResult.hasDub) {
          results.hasDub = true;
          results.confidence += jikanResult.confidence || 35;
          results.sources.push('MyAnimeList');
          results.platforms.push(...(jikanResult.platforms || []));
          if (jikanResult.dubInfo) {
            results.dubStatus = jikanResult.dubInfo.status;
            results.dubEpisodes = jikanResult.dubInfo.episodes;
          }
        }
      }

      // Kitsu
      if (kitsuCheck.status === 'fulfilled' && kitsuCheck.value) {
        const kitsuResult = kitsuCheck.value;
        if (kitsuResult.hasDub) {
          results.hasDub = true;
          results.confidence += kitsuResult.confidence || 30;
          results.sources.push('Kitsu');
          results.platforms.push(...(kitsuResult.platforms || []));
        }
      }

      // TMDB
      if (tmdbCheck.status === 'fulfilled' && tmdbCheck.value) {
        const tmdbResult = tmdbCheck.value;
        if (tmdbResult.hasDub) {
          results.hasDub = true;
          results.confidence += tmdbResult.confidence || 20;
          results.sources.push('TMDB');
          results.platforms.push(...(tmdbResult.platforms || []));
        }
        if (tmdbResult.tmdbId) {
          results.tmdbId = tmdbResult.tmdbId;
          results.tmdbType = tmdbResult.tmdbType;
        }
      }

      // Process secondary results
      // Firebase override (highest priority)
      if (overrideCheck.status === 'fulfilled' && overrideCheck.value) {
        const override = overrideCheck.value;
        results.hasDub = override.hasDub;
        results.confidence = 100;
        results.sources = ['Manual Override'];
        results.platforms = override.platforms || results.platforms;
        results.dubEpisodes = override.episodes || results.dubEpisodes;
        results.dubStatus = override.status || results.dubStatus;
      }

      // Community reports
      if (communityCheck.status === 'fulfilled' && communityCheck.value) {
        const communityResult = communityCheck.value;
        if (communityResult.hasDub && communityResult.reportCount >= 2) {
          results.hasDub = true;
          results.confidence += Math.min(communityResult.reportCount * 10, 30);
          results.sources.push('Community Reports');
          results.platforms.push(...(communityResult.platforms || []));
        }
      }

      // Known dub database (enhanced)
      if (knownCheck.status === 'fulfilled' && knownCheck.value) {
        const knownResult = knownCheck.value;
        if (knownResult.hasDub) {
          results.hasDub = true;
          results.confidence += knownResult.confidence || 25;
          results.sources.push('Known Database');
          results.platforms.push(...(knownResult.platforms || []));
        }
      }

      // English VA credits
      if (vaCheck.status === 'fulfilled' && vaCheck.value) {
        const vaResult = vaCheck.value;
        if (vaResult.hasEnglishVAs) {
          results.hasDub = true;
          results.confidence += vaResult.confidence || 40;
          results.sources.push('English VA Credits');
          results.englishVAs = vaResult.vas || [];
        }
      }

      // Process heuristics (already computed at start)
      if (heuristicChecks.hasDub) {
        if (!results.hasDub) {
          results.hasDub = true;
          results.confidence += heuristicChecks.confidence;
        } else {
          results.confidence += Math.floor(heuristicChecks.confidence / 2);
        }
        results.sources.push(...heuristicChecks.sources);
      }

      // Normalize confidence (cap at 100)
      results.confidence = Math.min(results.confidence, 100);

      // Remove duplicate platforms and sources
      results.platforms = [...new Set(results.platforms)];
      results.sources = [...new Set(results.sources)];

      // Apply confidence thresholds
      if (results.confidence < 30 && results.hasDub) {
        // Low confidence - mark as possible
        results.dubStatus = 'possible';
      } else if (results.confidence >= 70) {
        results.dubStatus = results.dubStatus || 'confirmed';
      }

      // Cache the result
      this.saveToCache(animeId, results);

      // Save to Firebase for persistence and sharing
      await this.saveDubInfo(animeId, results);

      console.log(`✅ Dub check complete for ${title}: ${results.hasDub ? 'YES' : 'NO'} (${results.confidence}% confidence from ${results.sources.join(', ')})`);

      return results;

    } catch (error) {
      console.error(`Error checking dub for ${title}:`, error);
      return results;
    }
  }

  /**
   * LAYER 3: Run heuristic checks (no API calls, fast)
   */
  runHeuristicChecks(anime) {
    const result = { hasDub: false, confidence: 0, sources: [] };
    const title = (anime.title || anime.titleEnglish || anime.titleRomaji || '').toLowerCase();
    
    // Check 1: Popularity-based prediction
    // Very popular anime (high popularity + good score) almost always get dubbed
    if (anime.popularity > 200000 && (anime.score || 0) >= 70) {
      result.confidence += 15;
      result.sources.push('High Popularity');
    } else if (anime.popularity > 100000 && (anime.score || 0) >= 75) {
      result.confidence += 10;
    }

    // Check 2: Format check - Movies are more likely to be dubbed
    if (anime.format === 'MOVIE' && anime.popularity > 50000) {
      result.confidence += 10;
      result.sources.push('Movie Format');
    }

    // Check 3: Sequel/Franchise check - If it's a sequel to a dubbed series
    const sequelPatterns = [
      /season\s*[2-9]|season\s*\d{2}/i,
      /\b(2nd|3rd|4th|5th)\s*season/i,
      /part\s*[2-9]/i,
      /\bii\b|\biii\b|\biv\b/i,
      /cour\s*2/i
    ];
    
    for (const pattern of sequelPatterns) {
      if (pattern.test(title)) {
        result.confidence += 10;
        result.sources.push('Sequel Detection');
        break;
      }
    }

    // Check 4: Studio check - Some studios consistently get dubbed
    const dubbedStudios = [
      'mappa', 'wit studio', 'ufotable', 'bones', 'madhouse', 
      'a-1 pictures', 'cloverworks', 'kyoto animation', 'trigger',
      'studio pierrot', 'toei animation', 'sunrise'
    ];
    
    const studios = (anime.studios || []).map(s => s.toLowerCase());
    if (studios.some(s => dubbedStudios.some(ds => s.includes(ds)))) {
      if (anime.popularity > 50000) {
        result.confidence += 8;
      }
    }

    // Check 5: Genre check - Action/Shounen more likely to be dubbed
    const dubbedGenres = ['action', 'adventure', 'fantasy', 'sci-fi', 'comedy'];
    const genres = (anime.genres || []).map(g => g.toLowerCase());
    if (genres.some(g => dubbedGenres.includes(g)) && anime.popularity > 30000) {
      result.confidence += 5;
    }

    // Check 6: Recent release window - New popular anime get simuldubs
    if (anime.status === 'RELEASING') {
      const licensedPlatforms = ['crunchyroll', 'funimation', 'hidive', 'netflix'];
      // If we know it's on a major platform, simuldub is likely
      result.confidence += 5;
    }

    // Determine if heuristics suggest dub
    if (result.confidence >= 20) {
      result.hasDub = true;
    }

    return result;
  }

  /**
   * Check for English VA credits in anime staff
   */
  async checkEnglishVACredits(malId, anilistId) {
    const result = { hasEnglishVAs: false, vas: [], confidence: 0 };
    
    try {
      // Try Jikan characters endpoint
      if (malId) {
        // Small delay to stagger Jikan requests
        await this.delay(this.JIKAN_RATE_MS);
        const response = await fetch(`${this.JIKAN_API}/anime/${malId}/characters`);
        
        if (response.ok) {
          const data = await response.json();
          const characters = data?.data || [];
          
          for (const char of characters.slice(0, 10)) { // Check main characters
            const voiceActors = char.voice_actors || [];
            
            for (const va of voiceActors) {
              if (va.language === 'English') {
                const vaName = va.person?.name?.toLowerCase() || '';
                result.vas.push(va.person?.name);
                result.hasEnglishVAs = true;
                
                // Bonus confidence if it's a known VA
                if (this.KNOWN_ENGLISH_VAS.some(known => vaName.includes(known))) {
                  result.confidence += 15;
                } else {
                  result.confidence += 8;
                }
              }
            }
          }
          
          // Cap confidence from VA check
          result.confidence = Math.min(result.confidence, 50);
        }
      }
    } catch (error) {
      console.error('Error checking VA credits:', error);
    }
    
    return result;
  }

  /**
   * Check community-reported dubs
   */
  async checkCommunityReports(animeId) {
    try {
      const snapshot = await refs.syncLog.child('dubReports').child(animeId).once('value');
      const reports = snapshot.val();
      
      if (!reports) return null;
      
      const reportList = Object.values(reports);
      const dubReports = reportList.filter(r => r.hasDub === true);
      const noDubReports = reportList.filter(r => r.hasDub === false);
      
      // Need at least 2 reports agreeing
      if (dubReports.length >= 2 && dubReports.length > noDubReports.length) {
        // Collect platforms from reports
        const platforms = [...new Set(reportList.flatMap(r => r.platforms || []))];
        
        return {
          hasDub: true,
          reportCount: dubReports.length,
          platforms,
          confidence: Math.min(dubReports.length * 10, 30)
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error checking community reports:', error);
      return null;
    }
  }

  /**
   * Enhanced Jikan dub check with more signals
   */
  async checkJikanDubEnhanced(malId) {
    try {
      // Small delay to stagger Jikan requests
      await this.delay(this.JIKAN_RATE_MS);

      const response = await fetch(`${this.JIKAN_API}/anime/${malId}/full`);
      if (!response.ok) return null;

      const data = await response.json();
      const anime = data?.data;
      if (!anime) return null;

      const result = { hasDub: false, dubInfo: null, platforms: [], confidence: 0 };

      // Check 1: Licensors (strongest signal)
      const licensors = anime.licensors || [];
      for (const licensor of licensors) {
        if (this.DUB_LICENSORS.includes(licensor.name)) {
          result.hasDub = true;
          result.confidence += 25;
          result.platforms.push(licensor.name);
        }
      }

      // Check 2: Producers that do dubs
      const producers = anime.producers || [];
      for (const producer of producers) {
        if (this.isDubCompany(producer.name)) {
          result.hasDub = true;
          result.confidence += 15;
          result.platforms.push(producer.name);
        }
      }

      // Check 3: Streaming availability
      const streaming = anime.streaming || [];
      for (const stream of streaming) {
        if (this.DUB_PLATFORMS[stream.name]) {
          result.platforms.push(stream.name);
          result.confidence += 5;
        }
      }

      // Check 4: Popularity + Major licensor = very likely dub
      if (anime.score >= 7 && anime.members >= 100000) {
        const hasMajorLicensor = licensors.some(l => 
          ['Funimation', 'Crunchyroll', 'Aniplex of America', 'Viz Media', 'Sentai Filmworks'].includes(l.name)
        );
        if (hasMajorLicensor) {
          result.hasDub = true;
          result.confidence += 20;
        }
      }

      // Check 5: External sites for dub mentions
      if (anime.external) {
        for (const ext of anime.external) {
          const url = (ext.url || '').toLowerCase();
          if (url.includes('dub') || url.includes('english')) {
            result.hasDub = true;
            result.confidence += 10;
          }
        }
      }

      result.confidence = Math.min(result.confidence, 50);
      return result;

    } catch (error) {
      console.error('Jikan enhanced dub check error:', error);
      return null;
    }
  }

  /**
   * Enhanced known dub list with more patterns
   */
  async checkKnownDubListEnhanced(animeId, title, titleEnglish, titleRomaji) {
    try {
      // Check Firebase known dubs collection first
      const snapshot = await refs.syncLog.child('knownDubs').child(animeId).once('value');
      const known = snapshot.val();
      
      if (known) {
        return {
          hasDub: true,
          platforms: known.platforms || [],
          episodes: known.episodes,
          confidence: 35
        };
      }

      // Comprehensive title-based pattern matching
      const titlesToCheck = [title, titleEnglish, titleRomaji].filter(Boolean).map(t => t.toLowerCase());
      
      const dubPatterns = [
        // Major ongoing/recent series
        { pattern: /naruto|boruto/i, platforms: ['Crunchyroll', 'Hulu'], confidence: 35 },
        { pattern: /one piece/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /dragon ball/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /my hero academia|boku no hero/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /demon slayer|kimetsu no yaiba/i, platforms: ['Crunchyroll', 'Funimation', 'Netflix'], confidence: 35 },
        { pattern: /jujutsu kaisen/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /attack on titan|shingeki no kyojin/i, platforms: ['Crunchyroll', 'Funimation', 'Hulu'], confidence: 35 },
        { pattern: /black clover/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /bleach/i, platforms: ['Hulu', 'Disney+'], confidence: 35 },
        { pattern: /hunter.*hunter/i, platforms: ['Crunchyroll', 'Netflix'], confidence: 35 },
        { pattern: /fullmetal alchemist/i, platforms: ['Crunchyroll', 'Funimation', 'Netflix'], confidence: 35 },
        { pattern: /sword art online/i, platforms: ['Crunchyroll', 'Hulu', 'Netflix'], confidence: 35 },
        { pattern: /re:?zero/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /konosuba/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /mob psycho/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /one punch man/i, platforms: ['Crunchyroll', 'Hulu', 'Netflix'], confidence: 35 },
        { pattern: /spy.*family/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /chainsaw man/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /tokyo revengers/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /dr\.?\s*stone/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /fire force|enen no shouboutai/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 30 },
        { pattern: /fairy tail/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /overlord/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 30 },
        { pattern: /slime.*reincarnated|tensei.*slime/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /mushoku tensei/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /frieren/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /solo leveling/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /oshi no ko/i, platforms: ['Hidive'], confidence: 30 },
        { pattern: /vinland saga/i, platforms: ['Crunchyroll', 'Netflix'], confidence: 35 },
        { pattern: /made in abyss/i, platforms: ['Hidive'], confidence: 30 },
        { pattern: /dandadan/i, platforms: ['Crunchyroll', 'Netflix'], confidence: 35 },
        { pattern: /blue lock/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /bocchi.*rock/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /apothecary diaries|kusuriya/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /kaiju no\.?\s*8/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /wind breaker/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /dungeon meshi|delicious in dungeon/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /hell.?s paradise|jigokuraku/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /zom\s*100/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /undead unluck/i, platforms: ['Hulu'], confidence: 30 },
        { pattern: /eminence in shadow/i, platforms: ['Hidive'], confidence: 30 },
        // More series
        { pattern: /death note/i, platforms: ['Netflix', 'Crunchyroll'], confidence: 35 },
        { pattern: /tokyo ghoul/i, platforms: ['Funimation', 'Hulu'], confidence: 35 },
        { pattern: /code geass/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /steins.?gate/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /cowboy bebop/i, platforms: ['Crunchyroll', 'Netflix'], confidence: 35 },
        { pattern: /neon genesis evangelion|evangelion/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /your name|kimi no na wa/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /weathering with you/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /a silent voice|koe no katachi/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /violet evergarden/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /cyberpunk.*edgerunners/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /castlevania/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /beastars/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /baki/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /kengan ashura/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /sakamoto days/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /ranking of kings|ousama ranking/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 30 },
        { pattern: /to your eternity|fumetsu no anata/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /86.*eighty.?six|eighty.?six/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /spy classroom/i, platforms: ['Crunchyroll'], confidence: 25 },
        { pattern: /blue exorcist|ao no exorcist/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /bungo stray dogs/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /haikyuu/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /kuroko.*basket/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /assassination classroom|ansatsu kyoushitsu/i, platforms: ['Funimation'], confidence: 35 },
        { pattern: /food wars|shokugeki/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /promised neverland|yakusoku no neverland/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /dororo/i, platforms: ['Amazon Prime Video'], confidence: 30 },
        { pattern: /goblin slayer/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 30 },
        { pattern: /rising of the shield hero|tate no yuusha/i, platforms: ['Crunchyroll', 'Funimation'], confidence: 35 },
        { pattern: /seven deadly sins|nanatsu no taizai/i, platforms: ['Netflix'], confidence: 35 },
        { pattern: /black butler|kuroshitsuji/i, platforms: ['Funimation'], confidence: 30 },
        { pattern: /soul eater/i, platforms: ['Funimation'], confidence: 35 },
        { pattern: /noragami/i, platforms: ['Funimation'], confidence: 30 },
        { pattern: /parasyte|kiseijuu/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /erased|boku dake ga inai machi/i, platforms: ['Crunchyroll', 'Netflix'], confidence: 35 },
        { pattern: /akame ga kill/i, platforms: ['Crunchyroll'], confidence: 30 },
        { pattern: /kill la kill/i, platforms: ['Crunchyroll'], confidence: 35 },
        { pattern: /gurren lagann|tengen toppa/i, platforms: ['Crunchyroll'], confidence: 35 }
      ];

      for (const titleToCheck of titlesToCheck) {
        for (const { pattern, platforms, confidence } of dubPatterns) {
          if (pattern.test(titleToCheck)) {
            return { hasDub: true, platforms, confidence };
          }
        }
      }

      return null;

    } catch (error) {
      console.error('Known dub check error:', error);
      return null;
    }
  }

  /**
   * Report a dub (community contribution)
   */
  async reportDub(animeId, hasDub, platforms = [], userId = 'anonymous') {
    try {
      const reportId = `${userId}_${Date.now()}`;
      await refs.syncLog.child('dubReports').child(animeId).child(reportId).set({
        hasDub,
        platforms,
        reportedBy: userId,
        reportedAt: Date.now()
      });
      
      // Invalidate cache
      this.dubCache.delete(animeId);
      
      console.log(`📝 Dub report submitted for ${animeId}: ${hasDub ? 'HAS DUB' : 'NO DUB'}`);
      return true;
    } catch (error) {
      console.error('Error reporting dub:', error);
      return false;
    }
  }

  /**
   * Check AniList for dub information (enhanced)
   */
  async checkAniListDub(anilistId) {
    const numericId = parseInt(String(anilistId).replace('al_', ''));
    
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english }
          externalLinks {
            site
            url
            type
            language
          }
          streamingEpisodes {
            site
            title
            url
          }
          studios(isMain: false) {
            nodes {
              name
              isAnimationStudio
            }
          }
        }
      }
    `;

    try {
      const response = await fetch(this.ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id: numericId } })
      });

      const data = await response.json();
      const media = data?.data?.Media;

      if (!media) return null;

      const result = { hasDub: false, platforms: [] };
      
      // Sites to exclude from platforms (not streaming services)
      const excludedSites = [
        'Official Site', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 
        'TikTok', 'Tumblr', 'Reddit', 'Discord', 'Wikipedia', 'AniDB',
        'Anime-Planet', 'Anime News Network', 'MyAnimeList', 'AniList'
      ];

      // Check external links for dub platforms
      if (media.externalLinks) {
        for (const link of media.externalLinks) {
          const siteName = link.site || '';
          const isExcluded = excludedSites.some(ex => siteName.toLowerCase().includes(ex.toLowerCase()));
          
          // Only add if it's a known dub platform (not just any English link)
          if (!isExcluded && this.DUB_PLATFORMS[siteName]) {
            result.hasDub = true;
            result.platforms.push(siteName);
          }
          
          // Check URL for dub indicators
          if (link.url && (
            link.url.includes('/dub') || 
            link.url.includes('-dub') ||
            link.url.includes('english')
          )) {
            result.hasDub = true;
          }
        }
      }

      // Check streaming episodes for English titles
      if (media.streamingEpisodes) {
        for (const ep of media.streamingEpisodes) {
          if (ep.title && (
            ep.title.includes('(English Dub)') ||
            ep.title.includes('English') ||
            ep.title.includes('Dub')
          )) {
            result.hasDub = true;
            if (ep.site) result.platforms.push(ep.site);
          }
        }
      }

      // Check for dub studios
      if (media.studios?.nodes) {
        for (const studio of media.studios.nodes) {
          if (this.DUB_STUDIOS.includes(studio.name)) {
            result.hasDub = true;
            result.platforms.push(studio.name);
          }
        }
      }

      return result;

    } catch (error) {
      console.error('AniList dub check error:', error);
      return null;
    }
  }

  /**
   * Check if Firebase already has recent dub data (shared by another user)
   * Returns cached data if checked within last 12 hours
   */
  async getExistingDubData(animeId) {
    try {
      const snapshot = await refs.anime.child(animeId).once('value');
      const anime = snapshot.val();

      if (!anime) return null;

      // Check if dub data exists and is recent (12 hours)
      const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
      
      if (anime.dubCheckedAt && anime.dubCheckedAt > twelveHoursAgo) {
        return {
          hasDub: anime.hasDub || false,
          confidence: anime.dubConfidence || 0,
          sources: anime.dubSources || [],
          platforms: anime.dubPlatforms || [],
          dubEpisodes: anime.dubEpisodes || null,
          dubStatus: anime.dubStatus || null,
          lastChecked: anime.dubCheckedAt,
          fromCache: true
        };
      }

      return null;
    } catch (error) {
      console.error('Error checking existing dub data:', error);
      return null;
    }
  }

  /**
   * Check Jikan (MAL) API for dub information - redirects to enhanced version
   */
  async checkJikanDub(malId) {
    return this.checkJikanDubEnhanced(malId);
  }

  /**
   * Check Firebase for manual override
   */
  async checkFirebaseOverride(animeId) {
    try {
      const snapshot = await refs.anime.child(animeId).child('dubOverride').once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Firebase override check error:', error);
      return null;
    }
  }

  /**
   * Check against known dub database - redirects to enhanced version
   */
  async checkKnownDubList(animeId, title) {
    return this.checkKnownDubListEnhanced(animeId, title, null, null);
  }

  /**
   * Check TMDB for dub information via watch providers and translations
   */
  async checkTMDBDub(title, year) {
    try {
      // Check if TMDB service is available
      if (typeof tmdbService === 'undefined') {
        console.log('TMDB service not loaded');
        return null;
      }

      // Use the TMDB service's dub check
      const result = await tmdbService.checkDub(title, year);
      return result;

    } catch (error) {
      console.error('TMDB dub check error:', error);
      return null;
    }
  }

  /**
   * Check Kitsu API for dub information
   */
  async checkKitsuDub(kitsuId, title) {
    try {
      let id = kitsuId;
      
      // If no Kitsu ID, search by title
      if (!id && title) {
        const searchResponse = await fetch(
          `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=1`,
          {
            headers: {
              'Accept': 'application/vnd.api+json',
              'Content-Type': 'application/vnd.api+json'
            }
          }
        );
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.data?.[0]) {
            id = searchData.data[0].id;
          }
        }
      }

      if (!id) return null;

      // Get anime details with streaming links
      const response = await fetch(
        `https://kitsu.io/api/edge/anime/${id}?include=streamingLinks,streamingLinks.streamer`,
        {
          headers: {
            'Accept': 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json'
          }
        }
      );

      if (!response.ok) return null;
      const data = await response.json();

      const result = { hasDub: false, platforms: [], confidence: 0 };

      // Check streaming links for dub indicators
      if (data.included) {
        for (const item of data.included) {
          if (item.type === 'streamingLinks') {
            const url = item.attributes?.url || '';
            const subs = item.attributes?.subs || [];
            const dubs = item.attributes?.dubs || [];
            
            // Check if English is in dubs array
            if (dubs.includes('en') || dubs.includes('english')) {
              result.hasDub = true;
              result.confidence = 90;
            }
            
            // Check URL for dub indicators
            if (url.toLowerCase().includes('dub') || url.toLowerCase().includes('english')) {
              result.hasDub = true;
              result.confidence = Math.max(result.confidence, 70);
            }
          } else if (item.type === 'streamers') {
            const name = item.attributes?.siteName;
            if (name && this.DUB_PLATFORMS[name]) {
              result.platforms.push(name);
            }
          }
        }
      }

      return result;

    } catch (error) {
      console.error('Kitsu dub check error:', error);
      return null;
    }
  }

  /**
   * Check if company name is a known dubbing company
   */
  isDubCompany(name) {
    const dubCompanies = [
      'Funimation', 'Crunchyroll', 'Aniplex of America', 'Viz Media',
      'Sentai Filmworks', 'Bang Zoom! Entertainment', 'Studiopolis',
      'NYAV Post', 'Sound Cadence Studios', 'ADV Films', 'Geneon',
      'Media Play', 'Bandai Entertainment', 'Manga Entertainment',
      'Discotek Media', 'NIS America', 'Ponycan USA', 'Eleven Arts'
    ];
    
    return dubCompanies.some(company => 
      name.toLowerCase().includes(company.toLowerCase())
    );
  }

  /**
   * Batch check dubs for multiple anime with parallel processing
   * @param {Array} animeList - List of anime to check
   * @param {Function} onProgress - Progress callback
   * @param {number} concurrency - Number of concurrent checks (default 5)
   */
  async batchCheckDubs(animeList, onProgress = null, concurrency = 5) {
    const results = [];
    const total = animeList.length;
    let completed = 0;

    console.log(`🚀 Starting parallel dub check for ${total} anime (concurrency: ${concurrency})`);
    const startTime = Date.now();

    // Process in batches with controlled concurrency
    for (let i = 0; i < animeList.length; i += concurrency) {
      const batch = animeList.slice(i, Math.min(i + concurrency, animeList.length));
      
      // Run batch in parallel
      const batchPromises = batch.map(async (anime) => {
        try {
          const result = await this.checkDub(anime);
          return {
            animeId: anime.id,
            title: anime.title,
            ...result
          };
        } catch (error) {
          console.error(`Error checking dub for ${anime.title}:`, error);
          return {
            animeId: anime.id,
            title: anime.title,
            hasDub: false,
            confidence: 0,
            error: true
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      completed += batch.length;
      if (onProgress) {
        onProgress(
          Math.round((completed / total) * 100), 
          `Checking dubs ${completed}/${total}...`
        );
      }

      // Small delay between batches to avoid overwhelming APIs
      if (i + concurrency < animeList.length) {
        await this.delay(200);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Parallel dub check complete: ${total} anime in ${elapsed}s`);

    return results;
  }

  /**
   * Save dub info to Firebase
   */
  async saveDubInfo(animeId, dubInfo) {
    try {
      await refs.anime.child(animeId).update({
        hasDub: dubInfo.hasDub,
        dubConfidence: dubInfo.confidence,
        dubPlatforms: dubInfo.platforms,
        dubEpisodes: dubInfo.dubEpisodes || null,
        dubStatus: dubInfo.dubStatus || null,
        dubSources: dubInfo.sources,
        dubCheckedAt: dubInfo.lastChecked
      });
    } catch (error) {
      console.error('Error saving dub info:', error);
    }
  }

  /**
   * Set manual dub override
   */
  async setDubOverride(animeId, dubData) {
    try {
      await refs.anime.child(animeId).child('dubOverride').set({
        hasDub: dubData.hasDub,
        platforms: dubData.platforms || [],
        episodes: dubData.episodes || null,
        status: dubData.status || null,
        setBy: 'manual',
        setAt: Date.now()
      });

      // Clear cache
      this.dubCache.delete(animeId);

      // Re-check to update main data
      return await this.checkDub({ id: animeId });
    } catch (error) {
      console.error('Error setting dub override:', error);
      throw error;
    }
  }

  /**
   * Get dubbed anime for current season
   */
  async getDubbedAnime(season, year) {
    try {
      const snapshot = await refs.anime
        .orderByChild('hasDub')
        .equalTo(true)
        .once('value');

      const dubbed = [];
      snapshot.forEach(child => {
        const anime = { id: child.key, ...child.val() };
        if (anime.season === season && anime.year === year) {
          dubbed.push(anime);
        }
      });

      return dubbed.sort((a, b) => (b.dubConfidence || 0) - (a.dubConfidence || 0));

    } catch (error) {
      console.error('Error getting dubbed anime:', error);
      return [];
    }
  }

  /**
   * Get dub statistics
   */
  async getDubStats(season, year) {
    try {
      const snapshot = await refs.anime
        .orderByChild('year')
        .equalTo(year)
        .once('value');

      let total = 0;
      let dubbed = 0;
      let confirmed = 0;
      const platforms = {};

      snapshot.forEach(child => {
        const anime = child.val();
        if (anime.season === season) {
          total++;
          if (anime.hasDub) {
            dubbed++;
            if (anime.dubConfidence >= 80) confirmed++;
            
            (anime.dubPlatforms || []).forEach(p => {
              platforms[p] = (platforms[p] || 0) + 1;
            });
          }
        }
      });

      return {
        total,
        dubbed,
        confirmed,
        percentage: total > 0 ? Math.round((dubbed / total) * 100) : 0,
        platforms: Object.entries(platforms)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count }))
      };

    } catch (error) {
      console.error('Error getting dub stats:', error);
      return { total: 0, dubbed: 0, confirmed: 0, percentage: 0, platforms: [] };
    }
  }

  // Cache methods
  getFromCache(animeId) {
    const cached = this.dubCache.get(animeId);
    if (cached && (Date.now() - cached.lastChecked) < this.cacheExpiry) {
      return cached;
    }
    return null;
  }

  saveToCache(animeId, data) {
    this.dubCache.set(animeId, data);
  }

  clearCache() {
    this.dubCache.clear();
  }

  // Utility
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create global instance
const dubChecker = new DubChecker();
