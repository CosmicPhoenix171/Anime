# 🎌 Anime Tracker

**Live Site:** https://cosmicphoenix171.github.io/Anime/

A fully **serverless** anime tracking platform using Firebase Realtime Database. All syncing happens in the browser - no backend server needed!

## ✨ Features

- 📺 Browse seasonal anime from AniList
- 🔄 Automatic syncing (client-side) - no server required
- 🔥 Firebase Realtime Database for data storage
- 🔐 Google Authentication via Firebase
- 📱 Responsive design
- 🎯 Filter by status, format, and search
- 🗓️ Navigate between seasons

### ⚡ Smart Client-Side Sync
The app checks when data was last synced and runs updates automatically:
- **Full Sync** (24+ hours): Fetches entire current season from AniList
- **Daily Update** (6-24 hours): Updates all airing anime
- **Partial Update** (1-6 hours): Checks anime with upcoming episodes
- **Quick Refresh** (<1 hour): Uses cached data

## 🚀 Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable **Realtime Database** (NOT Firestore)
4. Enable **Authentication** → **Google** provider

### 2. Add Firebase Config

Edit `public/js/firebase-config.js` with your config:

```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

### 3. GitHub Pages (Already Enabled)

The site is hosted at: https://cosmicphoenix171.github.io/Anime/

## Local Development

Just open `index.html` directly in your browser - no server needed!

## 🔧 Development

### Force a sync manually
Open browser console and run:
```javascript
forceSync('full')   // Full season sync
forceSync('daily')  // Update airing anime
```

## � File Structure

```
Anime/
├── index.html              # Main app page
├── public/
│   ├── css/
│   │   └── style.css       # All styles
│   └── js/
│       ├── firebase-config.js  # Firebase configuration
│       ├── anime-sync.js       # AniList sync logic
│       └── app.js              # Main application
└── README.md
```

## 📝 License

ISC