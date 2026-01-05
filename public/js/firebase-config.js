/**
 * Firebase Configuration - Serverless Anime Tracker
 */

const firebaseConfig = {
  apiKey: "AIzaSyD9U4bXTHzgaA5YbGiXbyrhIAUno4z4vPk",
  authDomain: "anime-461f8.firebaseapp.com",
  databaseURL: "https://anime-461f8-default-rtdb.firebaseio.com",
  projectId: "anime-461f8",
  storageBucket: "anime-461f8.firebasestorage.app",
  messagingSenderId: "179091956650",
  appId: "1:179091956650:web:a9d52046c3c3b5fc7bc1d3",
  measurementId: "G-QQ7JPQB7PR"
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
