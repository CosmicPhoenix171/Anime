/**
 * Firebase Configuration - Serverless Anime Tracker
 * 
 * IMPORTANT: Replace these values with your Firebase project config
 * Get these from: Firebase Console > Project Settings > General > Your apps
 */

const firebaseConfig = {
  // TODO: Replace with your Firebase config
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get database and auth references
const db = firebase.database();
const auth = firebase.auth();

// Database references
const refs = {
  anime: db.ref('anime'),
  syncLog: db.ref('syncLog'),
  users: db.ref('users'),
  userLists: db.ref('userLists')
};

console.log('🔥 Firebase initialized');
