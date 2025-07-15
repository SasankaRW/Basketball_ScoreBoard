import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB0I8H2bAIFMMB01n-4p-G3ogxbmp3Nii8",
  authDomain: "basketballscoreboard-65c95.firebaseapp.com",
  projectId: "basketballscoreboard-65c95",
  storageBucket: "basketballscoreboard-65c95.firebasestorage.app",
  messagingSenderId: "31697951521",
  appId: "1:31697951521:web:074259ad89964d30437c60"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const stateRef = ref(db, 'scoreboardState');

// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    // Prevent context menu on right click for the entire document
    document.addEventListener('contextmenu', e => e.preventDefault());

    // --- DOM Elements ---
    const homeScoreEl = document.getElementById('home-score');
    const awayScoreEl = document.getElementById('away-score');
    const gameClockEl = document.getElementById('game-clock');
    const shotClockEl = document.getElementById('shot-clock');
    const homeFoulsEl = document.getElementById('home-fouls');
    const awayFoulsEl = document.getElementById('away-fouls');
    const homeTimeoutsEl = document.getElementById('home-timeouts');
    const awayTimeoutsEl = document.getElementById('away-timeouts');
    const helpModal = document.getElementById('help-modal');
    const closeModalBtn = document.querySelector('.close-button');
    const controlsInfoEl = document.getElementById('controls-info');

    // --- State Object ---
    let scoreboardState = {
        homeScore: 0,
        awayScore: 0,
        homeFouls: 0,
        awayFouls: 0,
        homeTimeouts: 2,
        awayTimeouts: 2,
        gameMinutes: 10,
        gameSeconds: 0,
        shotClockSeconds: 12,
        isGameClockRunning: false,
        isShotClockRunning: false
    };

    // --- Update Functions ---
    const updateDisplay = () => {
        homeScoreEl.textContent = String(scoreboardState.homeScore).padStart(2, '0');
        awayScoreEl.textContent = String(scoreboardState.awayScore).padStart(2, '0');
        gameClockEl.textContent = `${String(scoreboardState.gameMinutes).padStart(2, '0')}:${String(scoreboardState.gameSeconds).padStart(2, '0')}`;
        shotClockEl.textContent = String(scoreboardState.shotClockSeconds).padStart(2, '0');
        homeFoulsEl.textContent = scoreboardState.homeFouls;
        awayFoulsEl.textContent = scoreboardState.awayFouls;
        homeTimeoutsEl.textContent = scoreboardState.homeTimeouts;
        awayTimeoutsEl.textContent = scoreboardState.awayTimeouts;
    };

    // --- Firebase Sync ---
    function pushStateToFirebase() {
        set(stateRef, scoreboardState);
    }

    // --- Listen for Firebase changes ---
    onValue(stateRef, (snapshot) => {
        const newState = snapshot.val();
        if (newState) {
            scoreboardState = { ...scoreboardState, ...newState };
            updateDisplay();
        }
    });

    // --- Timer Functions (refactored) ---
    function tickGameClock() {
        if (scoreboardState.gameSeconds > 0) {
            scoreboardState.gameSeconds--;
        } else if (scoreboardState.gameMinutes > 0) {
            scoreboardState.gameMinutes--;
            scoreboardState.gameSeconds = 59;
        } else {
            stopGameClock();
            const gameOverSound = document.getElementById('game-over-sound');
            gameOverSound.currentTime = 0;
            gameOverSound.play().catch(() => {});
            alert("Game Over!");
        }
        pushStateToFirebase();
    }
    function tickShotClock() {
        if (scoreboardState.shotClockSeconds > 0) {
            scoreboardState.shotClockSeconds--;
        } else {
            stopShotClock();
        }
        pushStateToFirebase();
    }
    let gameTimerInterval = null;
    let shotClockTimerInterval = null;
    function startGameClock() {
        if (!scoreboardState.isGameClockRunning && (scoreboardState.gameMinutes > 0 || scoreboardState.gameSeconds > 0)) {
            clearInterval(gameTimerInterval);
            gameTimerInterval = setInterval(tickGameClock, 1000);
            scoreboardState.isGameClockRunning = true;
            controlsInfoEl.textContent = "Game Clock RUNNING";
            pushStateToFirebase();
        }
    }
    function stopGameClock() {
        clearInterval(gameTimerInterval);
        scoreboardState.isGameClockRunning = false;
        controlsInfoEl.textContent = "Game Clock STOPPED";
        pushStateToFirebase();
    }
    function startShotClock() {
        if (!scoreboardState.isShotClockRunning && scoreboardState.shotClockSeconds > 0) {
            clearInterval(shotClockTimerInterval);
            shotClockTimerInterval = setInterval(tickShotClock, 1000);
            scoreboardState.isShotClockRunning = true;
            shotClockEl.style.backgroundColor = '';
            shotClockEl.style.color = '';
            pushStateToFirebase();
        }
    }
    function stopShotClock() {
        clearInterval(shotClockTimerInterval);
        scoreboardState.isShotClockRunning = false;
        pushStateToFirebase();
    }
    function resetGameClock() {
        if (confirm("Are you sure you want to reset the game clock?")) {
            stopGameClock();
            const gameOverSound = document.getElementById('game-over-sound');
            if (gameOverSound) {
                gameOverSound.pause();
                gameOverSound.currentTime = 0;
            }
            scoreboardState.gameMinutes = 10;
            scoreboardState.gameSeconds = 0;
            pushStateToFirebase();
            controlsInfoEl.textContent = "Game Clock Reset";
        }
    }
    function resetShotClock(time = 12) {
        scoreboardState.shotClockSeconds = time;
        shotClockEl.style.backgroundColor = '';
        shotClockEl.style.color = '';
        if (scoreboardState.isGameClockRunning) {
            startShotClock();
        }
        pushStateToFirebase();
    }
    // --- Control Functions ---
    function adjustScore(team, delta) {
        if (team === 'home') {
            scoreboardState.homeScore = Math.max(0, Math.min(999, scoreboardState.homeScore + delta));
        } else if (team === 'away') {
            scoreboardState.awayScore = Math.max(0, Math.min(999, scoreboardState.awayScore + delta));
        }
        pushStateToFirebase();
    }
    function adjustFouls(team, delta) {
        if (team === 'home') {
            scoreboardState.homeFouls = Math.max(0, Math.min(99, scoreboardState.homeFouls + delta));
        } else if (team === 'away') {
            scoreboardState.awayFouls = Math.max(0, Math.min(99, scoreboardState.awayFouls + delta));
        }
        pushStateToFirebase();
    }
    function adjustTimeouts(team, delta) {
        if (team === 'home') {
            scoreboardState.homeTimeouts = Math.max(0, Math.min(9, scoreboardState.homeTimeouts + delta));
        } else if (team === 'away') {
            scoreboardState.awayTimeouts = Math.max(0, Math.min(9, scoreboardState.awayTimeouts + delta));
        }
        pushStateToFirebase();
    }
    function setCustomTime() {
        stopGameClock();
        const timeInput = prompt("Enter game time (MM:SS):", `${String(scoreboardState.gameMinutes).padStart(2, '0')}:${String(scoreboardState.gameSeconds).padStart(2, '0')}`);
        if (timeInput) {
            const parts = timeInput.split(':');
            if (parts.length === 2) {
                const mins = parseInt(parts[0], 10);
                const secs = parseInt(parts[1], 10);
                if (!isNaN(mins) && !isNaN(secs) && mins >= 0 && secs >= 0 && secs < 60) {
                    scoreboardState.gameMinutes = mins;
                    scoreboardState.gameSeconds = secs;
                    pushStateToFirebase();
                } else {
                    alert("Invalid time format. Please use MM:SS.");
                }
            } else {
                alert("Invalid time format. Please use MM:SS.");
            }
        }
        controlsInfoEl.textContent = "Game Clock STOPPED";
    }
    // --- Help Modal Functions (showHelp, hideHelp) ---
    // These remain the same...
     const showHelp = () => {
        helpModal.style.display = 'block';
    };
    const hideHelp = () => {
        helpModal.style.display = 'none';
    };

    // --- Keyboard and Mouse Event Listeners ---
    document.addEventListener('mousedown', (e) => {
        if (e.button === 2) { // Right click
            e.preventDefault();
            if (scoreboardState.isShotClockRunning) {
                stopShotClock();
            } else {
                startShotClock();
            }
        } else if (e.button === 0) { // Left click
            resetShotClock();
        }
    });

    // --- Keyboard Event Listener ---
    document.addEventListener('keydown', (e) => {
        // console.log(e.key, e.code, e.shiftKey); // Debugging

        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR', 'KeyS', 'KeyF', 'KeyJ', 'KeyT', 'KeyY', 'KeyH', 'Enter'].includes(e.code) || (e.shiftKey && ['KeyR', 'KeyF', 'KeyJ', 'KeyT', 'KeyY'].includes(e.code))) {
             e.preventDefault();
        }

        // --- MODIFIED Clock Controls ---
        if (e.code === 'KeyT') { // Game Clock Toggle
            if (scoreboardState.isGameClockRunning) {
                stopGameClock();
            } else {
                startGameClock();
            }
        }
        else if (e.code === 'Space' && !e.shiftKey) { // Shot Clock Toggle
             if (scoreboardState.isShotClockRunning) {
                 stopShotClock();
             } else {
                 startShotClock(); // Will only start if > 0 seconds
             }
        }
        // --- END MODIFIED Clock Controls ---

        else if (e.code === 'KeyR' && !e.shiftKey) { // 'r' - Reset Shot Clock (Full)
            resetShotClock(12);
        }
         else if (e.code === 'KeyR' && e.shiftKey) { // Shift + 'r' - Reset Shot Clock (O.Reb)
            resetShotClock(12);
        }

        // Score Controls
        else if (e.code === 'ArrowUp') { adjustScore('home', 1); }
        else if (e.code === 'ArrowDown') { adjustScore('home', -1); }
        else if (e.code === 'ArrowRight') { adjustScore('away', 1); }
        else if (e.code === 'ArrowLeft') { adjustScore('away', -1); }

        // Foul Controls
        else if (e.code === 'KeyF' && !e.shiftKey) { adjustFouls('home', 1); }
        else if (e.code === 'KeyF' && e.shiftKey) { adjustFouls('home', -1); }
        else if (e.code === 'KeyJ' && !e.shiftKey) { adjustFouls('away', 1); }
        else if (e.code === 'KeyJ' && e.shiftKey) { adjustFouls('away', -1); }

         // Timeout Controls
        else if (e.code === 'KeyZ' && !e.shiftKey) { adjustTimeouts('home', -1); }
        else if (e.code === 'KeyZ' && e.shiftKey) { adjustTimeouts('home', 1); }
        else if (e.code === 'KeyX' && !e.shiftKey) { adjustTimeouts('away', -1); }
        else if (e.code === 'KeyX' && e.shiftKey) { adjustTimeouts('away', 1); }
        // --- Custom Shot Clock Key ---
        else if (e.code === 'KeyC' && e.shiftKey) { // 'c' - Set Custom Shot Clock
            let custom = prompt('Enter custom shot clock (seconds):', scoreboardState.shotClockSeconds);
            if (custom !== null) {
                let val = parseInt(custom, 10);
                if (!isNaN(val) && val > 0 && val <= 99) {
                    resetShotClock(val);
                } else {
                    alert('Invalid shot clock value. Enter a number between 1 and 99.');
                }
            }
        }
        else if (e.code === 'Enter') { setCustomTime(); }
        else if (e.code === 'KeyG') { // 'g' - Reset Game Clock
            resetGameClock();
        }
        else if (e.code === 'KeyH') { // 'h' - Toggle Help
             if (helpModal.style.display === 'block') {
                 hideHelp();
             } else {
                 showHelp();
             }
        }
    });

     // --- Modal Event Listeners ---
    closeModalBtn.addEventListener('click', hideHelp);
    window.addEventListener('click', (event) => {
        if (event.target === helpModal) {
            hideHelp();
        }
    });

    // --- Initial Setup ---
    updateDisplay();
    controlsInfoEl.textContent = "Press Space to Start Game Clock"; // Updated initial instruction

});

// Remove editTeamName function and old keydown for 'n'/'N', replace with unified hotkey logic
const homeTeamNameEl = document.getElementById('home-team-name');
const awayTeamNameEl = document.getElementById('away-team-name');

// --- Unified Team Name Hotkey ---
document.addEventListener('keydown', function(e) {
    if (e.key === 'n' || e.key === 'N') {
        let homeName = prompt('Enter Home Team Name:', homeTeamNameEl.textContent);
        let awayName = prompt('Enter Away Team Name:', awayTeamNameEl.textContent);
        if (homeName && homeName.trim().length > 0) homeTeamNameEl.textContent = homeName.trim();
        if (awayName && awayName.trim().length > 0) awayTeamNameEl.textContent = awayName.trim();
    }
});