# 🎌 Anime Tracker

A public anime website that automatically tracks every anime each season, updates daily to detect new anime & new episodes, and lets users track their watch progress.

## ✨ Features

### Automated Anime Tracking
- **Seasonal Coverage**: Automatically tracks every anime each season
- **Daily Updates**: Detects new anime and new episodes automatically
- **Status Management**: Distinguishes between airing vs finished series

### Dub Awareness
- **Dub Tracking**: Tracks English dub status for all anime
- **Platform Information**: Shows which platforms offer dubs
- **Dedicated Dub Tracker**: Filter and view only dubbed anime

### User Features (Google Login)
- **Watch Progress**: Track where you are in each anime
- **Session Marking**: Mark anime sessions for later viewing
- **Completion Stats**: View personal and seasonal completion progress
- **Personalized Dashboard**: See your watching list and stats at a glance

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
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

4. Create data directory:
```bash
mkdir data
```

5. Start the server:
```bash
npm start
```

6. Open your browser and navigate to:
```
http://localhost:3000
```

## 📖 Usage

### For Visitors (No Login Required)
- Browse current season anime
- Filter by airing status
- View anime details and synopsis
- See which anime have English dubs

### For Registered Users
1. Click "Login with Google" to authenticate
2. Navigate to your dashboard
3. Browse seasonal anime and start tracking
4. Update your progress as you watch
5. Mark sessions for later viewing
6. View your completion statistics

## 🏗️ Architecture

### Backend
- **Node.js + Express**: RESTful API server
- **SQLite**: Lightweight database for anime and user data
- **Passport.js**: Google OAuth authentication
- **node-cron**: Scheduled daily updates
- **Jikan API**: Anime data from MyAnimeList

### Frontend
- **Vanilla JavaScript**: No framework overhead
- **Responsive Design**: Works on all devices
- **Modern CSS**: Beautiful gradient UI with smooth animations

### Database Schema
- `anime`: Stores anime information (title, episodes, status, dub info)
- `users`: User accounts from Google OAuth
- `user_progress`: Tracks user watch progress
- `episodes`: Episode information for each anime

## 📡 API Endpoints

### Public Endpoints
- `GET /api/anime` - Get all anime (with optional filters)
- `GET /api/anime/:id` - Get specific anime details

### Authenticated Endpoints
- `GET /api/user/progress` - Get user's watch progress
- `POST /api/user/progress` - Update watch progress
- `POST /api/user/session` - Mark/unmark session
- `GET /api/user/stats` - Get completion statistics

### Authentication
- `GET /auth/google` - Initiate Google login
- `GET /auth/google/callback` - Google OAuth callback
- `GET /auth/logout` - Logout user
- `GET /auth/status` - Check authentication status

## 🔄 Automated Updates

The system automatically updates the anime database:
- **Schedule**: Daily at 2:00 AM (configurable in `src/config/config.js`)
- **Initial Update**: Runs 5 seconds after server start
- **Manual Update**: Click "Refresh" button on any page

The update process:
1. Fetches current season anime from Jikan API
2. Updates anime information in the database
3. Respects API rate limits (1 request per second)

## 🎨 Customization

### Change Update Schedule
Edit `src/config/config.js`:
```javascript
updateSchedule: '0 2 * * *' // Cron format: Daily at 2 AM
```

### Modify UI Theme
Edit `public/css/style.css` - Look for gradient colors:
```css
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```

## 🛠️ Development

### Project Structure
```
Anime/
├── src/
│   ├── config/          # Configuration files
│   │   ├── database.js  # Database setup
│   │   ├── passport.js  # OAuth configuration
│   │   └── config.js    # App configuration
│   ├── services/        # Business logic
│   │   ├── animeService.js   # Anime data management
│   │   └── userService.js    # User data management
│   ├── routes/          # API routes
│   │   ├── auth.js      # Authentication routes
│   │   ├── anime.js     # Anime API routes
│   │   └── user.js      # User API routes
│   ├── middleware/      # Express middleware
│   │   └── auth.js      # Authentication middleware
│   └── server.js        # Main application entry
├── public/              # Static files
│   ├── css/
│   │   └── style.css    # Styles
│   └── js/
│       ├── main.js      # Homepage scripts
│       └── dashboard.js # Dashboard scripts
├── views/               # HTML pages
│   ├── index.html       # Homepage
│   └── dashboard.html   # User dashboard
└── data/                # SQLite database (created on first run)
```

## 🔐 Security

- Passwords are not stored (OAuth only)
- Session-based authentication with secure cookies
- Environment variables for sensitive data
- SQL injection protection via parameterized queries

## 📝 License

ISC

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.

## 🙏 Acknowledgments

- [Jikan API](https://jikan.moe/) for providing anime data
- [MyAnimeList](https://myanimelist.net/) as the data source
- Google OAuth for authentication