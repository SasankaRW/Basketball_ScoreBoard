import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

// Firebase configuration (matches main scoreboard)
const firebaseConfig = {
    apiKey: "AIzaSyB0I8H2bAIFMMB01n-4p-G3ogxbmp3Nii8",
    authDomain: "basketballscoreboard-65c95.firebaseapp.com",
    databaseURL: "https://basketballscoreboard-65c95-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "basketballscoreboard-65c95",
    storageBucket: "basketballscoreboard-65c95.firebasestorage.app",
    messagingSenderId: "31697951521",
    appId: "1:31697951521:web:074259ad89964d30437c60"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// DOM Elements
const streamHomeNameEl = document.getElementById('stream-home-name');
const streamAwayNameEl = document.getElementById('stream-away-name');
const streamHomeScoreEl = document.getElementById('stream-home-score');
const streamAwayScoreEl = document.getElementById('stream-away-score');
const streamGameTimeEl = document.getElementById('stream-game-time');
const streamQuarterEl = document.getElementById('stream-quarter');

// Listen to Firebase for real-time updates
const stateRef = ref(db, 'scoreboardState');

// Helper function to format team names for two lines if two words
function formatTeamName(name) {
    if (!name) return 'TEAM';
    const words = name.trim().split(/\s+/);
    if (words.length === 2) {
        return words.join('\n'); // Add line break between two words
    }
    return name;
}

onValue(stateRef, (snapshot) => {
    const data = snapshot.val();

    if (data) {
        // Update team names with two-line formatting
        if (streamHomeNameEl) streamHomeNameEl.textContent = formatTeamName(data.homeTeamName || 'HOME');
        if (streamAwayNameEl) streamAwayNameEl.textContent = formatTeamName(data.awayTeamName || 'AWAY');

        // Update scores
        if (streamHomeScoreEl) streamHomeScoreEl.textContent = data.homeScore || 0;
        if (streamAwayScoreEl) streamAwayScoreEl.textContent = data.awayScore || 0;

        // Update game time
        if (streamGameTimeEl) {
            const minutes = String(data.gameMinutes || 0).padStart(2, '0');
            const seconds = String(data.gameSeconds || 0).padStart(2, '0');
            streamGameTimeEl.textContent = `${minutes}:${seconds}`;
        }

        // Update quarter
        if (streamQuarterEl) {
            const quarter = data.quarter || 1;
            if (quarter <= 4) {
                streamQuarterEl.textContent = `Q${quarter}`;
            } else {
                streamQuarterEl.textContent = `OT${quarter - 4}`;
            }
        }
    }
});

// Initial display
console.log('Stream overlay loaded and listening to Firebase...');
