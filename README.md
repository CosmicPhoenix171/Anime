# 🎌 Anime Tracker

A fully automated, always-up-to-date anime platform that tracks every anime each season, updates daily to detect new episodes, and lets users track their watch progress with session logging.

## ✨ Features

### 🌐 Public Features (No Login Required)
- **Season Board**: Browse all anime for the current season with filtering & search
- **Season Navigator**: Navigate between seasons (e.g., Spring 2025, Winter 2025)
- **Recently Finished**: View anime that recently finished airing
- **Dub Radar**: Track English dub status across platforms (Crunchyroll, Funimation, etc.)
- **Anime Details**: Full info page with synopsis, stats, and dub availability

### 🔐 User Features (Google Login Required)
- **My Anime List**: Track anime with status (Watching, Planned, Finished, Dropped, On Hold)
- **Episode Progress**: +1 button, Jump to Episode, Mark Season Finished
- **Session Logging**: Every progress update logs when you watched and how many episodes
- **Seasonal Dashboard**: See your progress for current season anime
- **Notifications**: Get notified about new episodes for shows you're watching
- **Behind Indicator**: See if you're behind on airing shows

### ⚙️ Automation System
- **Season Sync Job**: Runs at start of each anime season + weekly refresh
- **Daily Update Job**: Updates episode counts, status changes, next episode dates
- **Dub Status Management**: Admin-managed dub tracking per platform

### 👑 Admin Features
- **Admin Dashboard**: Overview stats, sync job controls, user management
- **Dub Management**: Search anime, add/edit dub entries per platform
- **Manual Sync Triggers**: Trigger season sync or daily update on demand

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/CosmicPhoenix171/Anime.git
cd Anime
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your Google OAuth credentials:
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a new project or select an existing one
- Enable Google+ API
- Create OAuth 2.0 credentials
- Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
- Copy Client ID and Client Secret to `.env`

4. Start the server:
```bash
npm start
```

5. Open your browser and navigate to:
```
http://localhost:3000
```

### First Admin Setup
The first user to log in can be made admin by manually setting `is_admin = 1` in the SQLite database.

## 📖 Pages & Navigation

| Page | URL | Access |
|------|-----|--------|
| Season Board | `/` | Public |
| Anime Detail | `/anime/:id` | Public |
| Dub Radar | `/dub-radar` | Public |
| Recently Finished | `/recently-finished` | Public |
| My Anime List | `/my-list` | Logged In |
| My Season | `/my-season` | Logged In |
| Admin Dashboard | `/admin` | Admin Only |

## 🏗️ Architecture

### Backend
- **Node.js + Express 5**: RESTful API server
- **SQLite3**: Lightweight database with async helpers
- **Passport.js**: Google OAuth 2.0 authentication
- **node-cron**: Scheduled sync jobs
- **AniList GraphQL API**: Anime data source

### Frontend
- **Vanilla JavaScript**: No framework overhead
- **Responsive CSS**: Works on desktop, tablet, and mobile
- **Modern UI**: Gradient themes, smooth animations

### Database Schema
```
anime (id, anilist_id, mal_id, title, title_english, title_native, 
       episodes_total, episodes_aired, status, season, year, 
       format, score, genres, cover_image, banner_image, synopsis,
       start_date, end_date, next_episode_date, next_episode_number,
       updated_at)

dubs (id, anime_id, platform, dub_status, episodes_dubbed, 
      last_updated_at)

users (id, google_id, email, name, avatar, is_admin, 
       dub_preference_mode, created_at, updated_at)

user_progress (id, user_id, anime_id, last_episode, user_status,
               added_at, updated_at)

session_logs (id, user_id, anime_id, from_episode, to_episode,
              session_date)

sync_logs (id, job_type, status, details, started_at, completed_at)

notifications (id, user_id, anime_id, type, message, is_read,
               created_at)
```

## 📡 API Endpoints

### Public Anime Endpoints
- `GET /api/anime` - Get anime list with filters (season, year, status, genre)
- `GET /api/anime/current` - Get current season info
- `GET /api/anime/:id` - Get anime details with dub info
- `GET /api/anime/search?q=` - Search anime by title
- `GET /api/anime/recently-finished` - Get recently finished anime
- `GET /api/anime/dub-radar` - Get dub status by platform
- `GET /api/anime/stats` - Get overall statistics

### User Endpoints (Authenticated)
- `GET /api/user/progress` - Get user's anime list
- `POST /api/user/progress` - Add/update anime progress
- `POST /api/user/progress/:animeId/increment` - Add +1 episode
- `POST /api/user/progress/:animeId/jump` - Jump to specific episode
- `POST /api/user/progress/:animeId/finish` - Mark anime as finished
- `POST /api/user/progress/:animeId/status` - Change anime status
- `GET /api/user/sessions` - Get session history
- `GET /api/user/my-season` - Get seasonal dashboard data
- `GET /api/user/notifications` - Get notifications

### Admin Endpoints (Admin Only)
- `GET /api/admin/dashboard` - Get admin stats
- `GET /api/admin/dubs` - Get all dub entries
- `POST /api/admin/dubs` - Add/update dub entry
- `DELETE /api/admin/dubs/:id` - Remove dub entry
- `POST /api/admin/sync/season` - Trigger season sync
- `POST /api/admin/sync/daily` - Trigger daily update
- `GET /api/admin/sync/logs` - Get sync job history
- `GET /api/admin/users` - Get all users
- `POST /api/admin/users/:id/admin` - Toggle admin status

### Authentication
- `GET /auth/google` - Initiate Google login
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/logout` - Logout user
- `GET /auth/status` - Check auth status

## 🔄 Automated Jobs

### Season Sync Job
- **Triggers**: January 1, April 1, July 1, October 1 (season starts)
- **Also**: Every Sunday at 3:00 AM
- **Action**: Fetches all anime for current and next season from AniList

### Daily Update Job
- **Schedule**: Daily at 2:00 AM
- **Action**: Updates episode counts, status changes, next episode dates
- **Scope**: All airing anime from current and previous season

## 🎨 Customization

### Environment Variables
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-session-secret
PORT=3000
```

### Update Schedule
Edit `src/server.js` cron patterns:
```javascript
// Daily at 2 AM
cron.schedule('0 2 * * *', () => dailyUpdateJob());

// Season starts
cron.schedule('0 0 1 1,4,7,10 *', () => seasonSyncJob());

// Weekly Sunday 3 AM
cron.schedule('0 3 * * 0', () => seasonSyncJob());
```

## 🛠️ Project Structure
```
Anime/
├── src/
│   ├── config/
│   │   ├── database.js    # SQLite setup & schema
│   │   ├── passport.js    # Google OAuth config
│   │   └── config.js      # App configuration
│   ├── services/
│   │   ├── anilistService.js  # AniList GraphQL API
│   │   ├── animeService.js    # Anime operations & sync jobs
│   │   └── userService.js     # User progress & sessions
│   ├── routes/
│   │   ├── auth.js        # Authentication routes
│   │   ├── anime.js       # Public anime API
│   │   ├── user.js        # User progress API
│   │   └── admin.js       # Admin dashboard API
│   ├── middleware/
│   │   └── auth.js        # Auth middleware (ensure, optional, admin)
│   └── server.js          # Express app & cron scheduling
├── public/
│   ├── css/style.css      # All styles
│   └── js/main.js         # Client-side JavaScript
├── views/
│   ├── index.html         # Season board
│   ├── anime-detail.html  # Anime detail page
│   ├── dub-radar.html     # Dub tracking
│   ├── recently-finished.html
│   ├── my-list.html       # User anime list
│   ├── my-season.html     # Seasonal dashboard
│   └── admin.html         # Admin panel
└── data/                  # SQLite database
```

## 🔐 Security

- OAuth-only authentication (no passwords stored)
- Session-based auth with secure cookies
- Admin-only routes with middleware protection
- Parameterized SQL queries prevent injection

## 📝 License

ISC

## 🙏 Acknowledgments

- [AniList](https://anilist.co/) for providing the GraphQL API
- Google OAuth for authentication