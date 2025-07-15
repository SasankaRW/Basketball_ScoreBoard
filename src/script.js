import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

// Your web app's Firebase configuration
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

    // Control Panel Elements
    const controlPanelModal = document.getElementById('control-panel-modal');
    const controlCloseBtn = document.getElementById('control-close-button');
    const homeTeamInput = document.getElementById('home-team-input');
    const awayTeamInput = document.getElementById('away-team-input');
    const homeScoreInput = document.getElementById('home-score-input');
    const awayScoreInput = document.getElementById('away-score-input');
    const homeFoulsInput = document.getElementById('home-fouls-input');
    const awayFoulsInput = document.getElementById('away-fouls-input');
    const homeTimeoutsInput = document.getElementById('home-timeouts-input');
    const awayTimeoutsInput = document.getElementById('away-timeouts-input');
    const gameMinutesInput = document.getElementById('game-minutes-input');
    const gameSecondsInput = document.getElementById('game-seconds-input');
    const shotClockInput = document.getElementById('shot-clock-input');
    const applyChangesBtn = document.getElementById('apply-changes');
    const resetAllBtn = document.getElementById('reset-all');
    const startGameClockBtn = document.getElementById('start-game-clock');
    const stopGameClockBtn = document.getElementById('stop-game-clock');
    const startShotClockBtn = document.getElementById('start-shot-clock');
    const stopShotClockBtn = document.getElementById('stop-shot-clock');
    
    // Default Settings Elements
    const defaultGameMinutesInput = document.getElementById('default-game-minutes');
    const defaultShotClockInput = document.getElementById('default-shot-clock');
    const defaultTimeoutsInput = document.getElementById('default-timeouts');
    const defaultHomeTeamInput = document.getElementById('default-home-team');
    const defaultAwayTeamInput = document.getElementById('default-away-team');
    const applyDefaultsBtn = document.getElementById('apply-defaults');

    // --- State Object ---
    let scoreboardState = {
        homeScore: 0,
        awayScore: 0,
        homeFouls: 0,
        awayFouls: 0,
        homeTimeouts: 2,
        awayTimeouts: 2,
        homeTeamName: "HOME",
        awayTeamName: "AWAY",
        gameMinutes: 10,
        gameSeconds: 0,
        shotClockSeconds: 12,
        isGameClockRunning: false,
        isShotClockRunning: false,
        // Default Settings
        defaultGameMinutes: 10,
        defaultShotClock: 12,
        defaultTimeouts: 2,
        defaultHomeTeam: "HOME",
        defaultAwayTeam: "AWAY"
    };

    // --- Firebase Setup ---
    const stateRef = ref(db, 'scoreboardState');

    // --- Update Functions ---
    const updateDisplay = () => {
        if (homeScoreEl) homeScoreEl.textContent = String(scoreboardState.homeScore).padStart(2, '0');
        if (awayScoreEl) awayScoreEl.textContent = String(scoreboardState.awayScore).padStart(2, '0');
        if (gameClockEl) gameClockEl.textContent = `${String(scoreboardState.gameMinutes).padStart(2, '0')}:${String(scoreboardState.gameSeconds).padStart(2, '0')}`;
        if (shotClockEl) shotClockEl.textContent = String(scoreboardState.shotClockSeconds).padStart(2, '0');
        if (homeFoulsEl) homeFoulsEl.textContent = scoreboardState.homeFouls;
        if (awayFoulsEl) awayFoulsEl.textContent = scoreboardState.awayFouls;
        if (homeTimeoutsEl) homeTimeoutsEl.textContent = scoreboardState.homeTimeouts;
        if (awayTimeoutsEl) awayTimeoutsEl.textContent = scoreboardState.awayTimeouts;
        
        // Update team names
        const homeTeamNameEl = document.getElementById('home-team-name');
        const awayTeamNameEl = document.getElementById('away-team-name');
        if (homeTeamNameEl) homeTeamNameEl.textContent = scoreboardState.homeTeamName;
        if (awayTeamNameEl) awayTeamNameEl.textContent = scoreboardState.awayTeamName;
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
            if (controlsInfoEl) controlsInfoEl.textContent = "Game Clock RUNNING";
            pushStateToFirebase();
        }
    }
    function stopGameClock() {
        clearInterval(gameTimerInterval);
        scoreboardState.isGameClockRunning = false;
        if (controlsInfoEl) controlsInfoEl.textContent = "Game Clock STOPPED";
        pushStateToFirebase();
    }
    function startShotClock() {
        if (!scoreboardState.isShotClockRunning && scoreboardState.shotClockSeconds > 0) {
            clearInterval(shotClockTimerInterval);
            shotClockTimerInterval = setInterval(tickShotClock, 1000);
            scoreboardState.isShotClockRunning = true;
            if (shotClockEl) {
            shotClockEl.style.backgroundColor = '';
                shotClockEl.style.color = '';
            }
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
            if (controlsInfoEl) controlsInfoEl.textContent = "Game Clock Reset";
        }
    }
    function resetShotClock(time = 12) {
        scoreboardState.shotClockSeconds = time;
        if (shotClockEl) {
        shotClockEl.style.backgroundColor = '';
            shotClockEl.style.color = '';
        }
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
            scoreboardState.homeTimeouts = Math.max(0, Math.min(99, scoreboardState.homeTimeouts + delta));
        } else if (team === 'away') {
            scoreboardState.awayTimeouts = Math.max(0, Math.min(99, scoreboardState.awayTimeouts + delta));
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
        if (controlsInfoEl) controlsInfoEl.textContent = "Game Clock STOPPED";
    }

    // --- Team Name Functions ---
    function setTeamNames() {
        const homeName = prompt("Enter Home Team Name:", scoreboardState.homeTeamName);
        if (homeName !== null) {
            scoreboardState.homeTeamName = homeName.trim() || "HOME";
        }
        
        const awayName = prompt("Enter Away Team Name:", scoreboardState.awayTeamName);
        if (awayName !== null) {
            scoreboardState.awayTeamName = awayName.trim() || "AWAY";
        }
        
        pushStateToFirebase();
    }

    // --- Control Panel Functions ---
    function showControlPanel() {
        if (controlPanelModal) {
            populateControlPanel();
            controlPanelModal.style.display = 'block';
        }
    }

    function hideControlPanel() {
        if (controlPanelModal) {
            controlPanelModal.style.display = 'none';
        }
    }

    function populateControlPanel() {
        if (homeTeamInput) homeTeamInput.value = scoreboardState.homeTeamName;
        if (awayTeamInput) awayTeamInput.value = scoreboardState.awayTeamName;
        if (homeScoreInput) homeScoreInput.value = scoreboardState.homeScore;
        if (awayScoreInput) awayScoreInput.value = scoreboardState.awayScore;
        if (homeFoulsInput) homeFoulsInput.value = scoreboardState.homeFouls;
        if (awayFoulsInput) awayFoulsInput.value = scoreboardState.awayFouls;
        if (homeTimeoutsInput) homeTimeoutsInput.value = scoreboardState.homeTimeouts;
        if (awayTimeoutsInput) awayTimeoutsInput.value = scoreboardState.awayTimeouts;
        if (gameMinutesInput) gameMinutesInput.value = scoreboardState.gameMinutes;
        if (gameSecondsInput) gameSecondsInput.value = scoreboardState.gameSeconds;
        if (shotClockInput) shotClockInput.value = scoreboardState.shotClockSeconds;
        
        // Populate default settings
        if (defaultGameMinutesInput) defaultGameMinutesInput.value = scoreboardState.defaultGameMinutes;
        if (defaultShotClockInput) defaultShotClockInput.value = scoreboardState.defaultShotClock;
        if (defaultTimeoutsInput) defaultTimeoutsInput.value = scoreboardState.defaultTimeouts;
        if (defaultHomeTeamInput) defaultHomeTeamInput.value = scoreboardState.defaultHomeTeam;
        if (defaultAwayTeamInput) defaultAwayTeamInput.value = scoreboardState.defaultAwayTeam;
    }

    function applyControlPanelChanges() {
        // Update team names
        if (homeTeamInput) scoreboardState.homeTeamName = homeTeamInput.value.trim() || "HOME";
        if (awayTeamInput) scoreboardState.awayTeamName = awayTeamInput.value.trim() || "AWAY";
        
        // Update scores
        if (homeScoreInput) scoreboardState.homeScore = Math.max(0, Math.min(999, parseInt(homeScoreInput.value) || 0));
        if (awayScoreInput) scoreboardState.awayScore = Math.max(0, Math.min(999, parseInt(awayScoreInput.value) || 0));
        
        // Update fouls
        if (homeFoulsInput) scoreboardState.homeFouls = Math.max(0, Math.min(99, parseInt(homeFoulsInput.value) || 0));
        if (awayFoulsInput) scoreboardState.awayFouls = Math.max(0, Math.min(99, parseInt(awayFoulsInput.value) || 0));
        
        // Update timeouts
        if (homeTimeoutsInput) scoreboardState.homeTimeouts = Math.max(0, Math.min(99, parseInt(homeTimeoutsInput.value) || 0));
        if (awayTimeoutsInput) scoreboardState.awayTimeouts = Math.max(0, Math.min(99, parseInt(awayTimeoutsInput.value) || 0));
        
        // Update game clock
        if (gameMinutesInput) scoreboardState.gameMinutes = Math.max(0, Math.min(99, parseInt(gameMinutesInput.value) || 0));
        if (gameSecondsInput) scoreboardState.gameSeconds = Math.max(0, Math.min(59, parseInt(gameSecondsInput.value) || 0));
        
        // Update shot clock
        if (shotClockInput) scoreboardState.shotClockSeconds = Math.max(0, Math.min(99, parseInt(shotClockInput.value) || 0));
        
        // Update default settings
        if (defaultGameMinutesInput) scoreboardState.defaultGameMinutes = Math.max(1, Math.min(99, parseInt(defaultGameMinutesInput.value) || 10));
        if (defaultShotClockInput) scoreboardState.defaultShotClock = Math.max(1, Math.min(99, parseInt(defaultShotClockInput.value) || 12));
        if (defaultTimeoutsInput) scoreboardState.defaultTimeouts = Math.max(0, Math.min(99, parseInt(defaultTimeoutsInput.value) || 2));
        if (defaultHomeTeamInput) scoreboardState.defaultHomeTeam = defaultHomeTeamInput.value.trim() || "HOME";
        if (defaultAwayTeamInput) scoreboardState.defaultAwayTeam = defaultAwayTeamInput.value.trim() || "AWAY";
        
        pushStateToFirebase();
        hideControlPanel();
    }

    function applyDefaults() {
        if (confirm("Apply default settings to current game? This will reset the current game data.")) {
            // Stop any running clocks
            stopGameClock();
            stopShotClock();
            
            // Apply default settings to current game
            scoreboardState.homeScore = 0;
            scoreboardState.awayScore = 0;
            scoreboardState.homeFouls = 0;
            scoreboardState.awayFouls = 0;
            scoreboardState.homeTimeouts = scoreboardState.defaultTimeouts;
            scoreboardState.awayTimeouts = scoreboardState.defaultTimeouts;
            scoreboardState.homeTeamName = scoreboardState.defaultHomeTeam;
            scoreboardState.awayTeamName = scoreboardState.defaultAwayTeam;
            scoreboardState.gameMinutes = scoreboardState.defaultGameMinutes;
            scoreboardState.gameSeconds = 0;
            scoreboardState.shotClockSeconds = scoreboardState.defaultShotClock;
            scoreboardState.isGameClockRunning = false;
            scoreboardState.isShotClockRunning = false;
            
            pushStateToFirebase();
            hideControlPanel();
        }
    }

    function resetAllData() {
        if (confirm("Are you sure you want to reset all data? This will set everything back to default values.")) {
            scoreboardState = {
                homeScore: 0,
                awayScore: 0,
                homeFouls: 0,
                awayFouls: 0,
                homeTimeouts: scoreboardState.defaultTimeouts,
                awayTimeouts: scoreboardState.defaultTimeouts,
                homeTeamName: scoreboardState.defaultHomeTeam,
                awayTeamName: scoreboardState.defaultAwayTeam,
                gameMinutes: scoreboardState.defaultGameMinutes,
                gameSeconds: 0,
                shotClockSeconds: scoreboardState.defaultShotClock,
                isGameClockRunning: false,
                isShotClockRunning: false,
                // Preserve default settings
                defaultGameMinutes: scoreboardState.defaultGameMinutes,
                defaultShotClock: scoreboardState.defaultShotClock,
                defaultTimeouts: scoreboardState.defaultTimeouts,
                defaultHomeTeam: scoreboardState.defaultHomeTeam,
                defaultAwayTeam: scoreboardState.defaultAwayTeam
            };
            pushStateToFirebase();
            hideControlPanel();
        }
    }
    // --- Help Modal Functions ---
     const showHelp = () => {
        if (helpModal) helpModal.style.display = 'block';
    };
    const hideHelp = () => {
        if (helpModal) helpModal.style.display = 'none';
    };

    // --- Mouse Event Listeners ---
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
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR', 'KeyS', 'KeyF', 'KeyJ', 'KeyT', 'KeyY', 'KeyH', 'KeyZ', 'KeyX', 'Enter'].includes(e.code) || (e.shiftKey && ['KeyR', 'KeyF', 'KeyJ', 'KeyT', 'KeyY', 'KeyZ', 'KeyX'].includes(e.code))) {

        }

        // --- Clock Controls ---
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
                 startShotClock();
             }
        }
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
             if (helpModal && helpModal.style.display === 'block') {
                 hideHelp();
             } else {
                 showHelp();
             }
        }
        else if (e.code === 'KeyC') { // 'c' - Show Control Panel
            showControlPanel();
        }
        else if (e.code === 'N' || e.code === 'n') { // 'n' - Set Team Names
            setTeamNames();
        }
        else if (e.code === 'P' || e.code === 'p') { // 'p' - Show Control Panel
            showControlPanel();
        }
        else if (e.code === 'O' || e.code === 'o') { // 'o' - Hide Control Panel
            hideControlPanel();
        }
        else if (e.code === 'R' || e.code === 'r') { // 'r' - Apply Control Panel Changes
            applyControlPanelChanges();
        }
        else if (e.code === 'A' || e.code === 'a') { // 'a' - Reset All Data
            resetAllData();
        }
        else if (e.code === 'D' || e.code === 'd') { // 'd' - Apply Defaults
            applyDefaults();
        }
    });

     // --- Modal Event Listeners ---
    if (closeModalBtn) closeModalBtn.addEventListener('click', hideHelp);
    window.addEventListener('click', (event) => {
        if (event.target === helpModal) {
            hideHelp();
        }
        if (event.target === controlPanelModal) {
            hideControlPanel();
        }
    });

    // --- Control Panel Event Listeners ---
    if (controlCloseBtn) controlCloseBtn.addEventListener('click', hideControlPanel);
    if (applyChangesBtn) applyChangesBtn.addEventListener('click', applyControlPanelChanges);
    if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllData);
    if (startGameClockBtn) startGameClockBtn.addEventListener('click', startGameClock);
    if (stopGameClockBtn) stopGameClockBtn.addEventListener('click', stopGameClock);
    if (startShotClockBtn) startShotClockBtn.addEventListener('click', startShotClock);
    if (stopShotClockBtn) stopShotClockBtn.addEventListener('click', stopShotClock);
    if (applyDefaultsBtn) applyDefaultsBtn.addEventListener('click', applyDefaults);

    // --- Initial Setup ---
    updateDisplay();
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