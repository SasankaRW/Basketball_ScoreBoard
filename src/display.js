import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

// Firebase configuration (shared with main scoreboard)
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

document.addEventListener('DOMContentLoaded', () => {
    // Display-only DOM elements
    const homeScoreEl = document.getElementById('home-score');
    const awayScoreEl = document.getElementById('away-score');
    const gameClockEl = document.getElementById('game-clock');
    const shotClockEl = document.getElementById('shot-clock');
    const homeFoulsEl = document.getElementById('home-fouls');
    const awayFoulsEl = document.getElementById('away-fouls');
    const quarterEl = document.getElementById('quarter-display');
    const homeTimeoutsEl = document.getElementById('home-timeouts');
    const awayTimeoutsEl = document.getElementById('away-timeouts');

    let scoreboardState = {
        homeScore: 0,
        awayScore: 0,
        homeFouls: 0,
        awayFouls: 0,
        homeTimeouts: 2,
        awayTimeouts: 2,
        homeTeamName: "HOME",
        awayTeamName: "AWAY",
        quarter: 1,
        gameMinutes: 10,
        gameSeconds: 0,
        gameMilliseconds: 0,
        shotClockSeconds: 24,
        ballPossession: 'home'
    };

    const stateRef = ref(db, 'scoreboardState');

    const wrapClockChars = (timeString) => {
        return timeString.split('').map(char => {
            const className = (char === ':' || char === '.') ? 'clock-char colon' : 'clock-char';
            return `<span class="${className}">${char}</span>`;
        }).join('');
    };

    function updateTeamName(elementId, newName, arrowId) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const existingArrow = el.querySelector('.possession-arrow');
        if (existingArrow) {
            existingArrow.remove();
        }

        el.textContent = newName;

        const arrowDiv = document.createElement('div');
        arrowDiv.className = 'possession-arrow';
        arrowDiv.id = arrowId;
        el.appendChild(arrowDiv);
    }

    function updateBallPossessionIndicator() {
        const homeArrow = document.getElementById('home-possession-arrow');
        const awayArrow = document.getElementById('away-possession-arrow');

        if (!homeArrow || !awayArrow) return;

        homeArrow.classList.remove('active');
        awayArrow.classList.remove('active');

        if (scoreboardState.ballPossession === 'home') {
            homeArrow.classList.add('active');
        } else if (scoreboardState.ballPossession === 'away') {
            awayArrow.classList.add('active');
        }
    }

    function updateFoulBonusStyling() {
        const homeFoulBox = document.querySelector('.foul-box.home');
        const awayFoulBox = document.querySelector('.foul-box.away');

        if (homeFoulBox) {
            homeFoulBox.classList.toggle('penalty', scoreboardState.homeFouls >= 5);
        }
        if (awayFoulBox) {
            awayFoulBox.classList.toggle('penalty', scoreboardState.awayFouls >= 5);
        }
    }

    function updateDisplay() {
        if (homeScoreEl) homeScoreEl.textContent = String(scoreboardState.homeScore).padStart(2, '0');
        if (awayScoreEl) awayScoreEl.textContent = String(scoreboardState.awayScore).padStart(2, '0');

        if (gameClockEl) {
            let timeString;
            if (scoreboardState.gameMinutes === 0 && scoreboardState.gameSeconds < 60) {
                const milliseconds = Math.floor(scoreboardState.gameMilliseconds / 100);
                timeString = `${String(scoreboardState.gameSeconds).padStart(2, '0')}.${String(milliseconds)}`;
            } else {
                timeString = `${String(scoreboardState.gameMinutes).padStart(2, '0')}:${String(scoreboardState.gameSeconds).padStart(2, '0')}`;
            }
            gameClockEl.innerHTML = wrapClockChars(timeString);
        }

        if (shotClockEl) shotClockEl.textContent = String(scoreboardState.shotClockSeconds).padStart(2, '0');
        if (quarterEl) {
            if (scoreboardState.quarter <= 4) {
                quarterEl.textContent = `Q${scoreboardState.quarter}`;
            } else {
                quarterEl.textContent = `OT${scoreboardState.quarter - 4}`;
            }
        }

        if (homeFoulsEl) homeFoulsEl.textContent = scoreboardState.homeFouls;
        if (awayFoulsEl) awayFoulsEl.textContent = scoreboardState.awayFouls;
        if (homeTimeoutsEl) homeTimeoutsEl.textContent = scoreboardState.homeTimeouts;
        if (awayTimeoutsEl) awayTimeoutsEl.textContent = scoreboardState.awayTimeouts;

        updateTeamName('home-team-name', scoreboardState.homeTeamName, 'home-possession-arrow');
        updateTeamName('away-team-name', scoreboardState.awayTeamName, 'away-possession-arrow');
        updateBallPossessionIndicator();
        updateFoulBonusStyling();
    }

    function mergeState(newState) {
        scoreboardState = {
            ...scoreboardState,
            ...newState
        };

        scoreboardState.homeScore = Number(scoreboardState.homeScore) || 0;
        scoreboardState.awayScore = Number(scoreboardState.awayScore) || 0;
        scoreboardState.gameMinutes = Number(scoreboardState.gameMinutes) || 0;
        scoreboardState.gameSeconds = Number(scoreboardState.gameSeconds) || 0;
        scoreboardState.gameMilliseconds = Number(scoreboardState.gameMilliseconds) || 0;
        scoreboardState.shotClockSeconds = Number(scoreboardState.shotClockSeconds) || 0;
        scoreboardState.homeFouls = Number(scoreboardState.homeFouls) || 0;
        scoreboardState.awayFouls = Number(scoreboardState.awayFouls) || 0;
        scoreboardState.homeTimeouts = Number(scoreboardState.homeTimeouts) || 0;
        scoreboardState.awayTimeouts = Number(scoreboardState.awayTimeouts) || 0;
        scoreboardState.quarter = Number(scoreboardState.quarter) || 1;

        if (scoreboardState.ballPossession !== 'home' && scoreboardState.ballPossession !== 'away') {
            scoreboardState.ballPossession = 'home';
        }
    }

    onValue(stateRef, (snapshot) => {
        const newState = snapshot.val();
        if (!newState) return;

        mergeState(newState);
        updateDisplay();
    });

    // Initial render
    updateDisplay();
});



