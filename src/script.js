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
    const quarterEl = document.getElementById('quarter-display');
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
    const quarterInput = document.getElementById('quarter-input');
    const ballPossessionInput = document.getElementById('ball-possession-input');
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
    const defaultQuarterInput = document.getElementById('default-quarter');
    const defaultHomeTeamInput = document.getElementById('default-home-team');
    const defaultAwayTeamInput = document.getElementById('default-away-team');
    const applyDefaultsBtn = document.getElementById('apply-defaults');
    
    // Authentication Elements
    const loginModal = document.getElementById('login-modal');
    const usernameInput = document.getElementById('username-input');
    const passwordInput = document.getElementById('password-input');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const loginStatus = document.getElementById('login-status');
    const scoreboardEl = document.querySelector('.scoreboard');
    
    // Control Panel Authentication Elements
    const controlUsernameInput = document.getElementById('control-username-input');
    const controlPasswordInput = document.getElementById('control-password-input');
    const controlLoginBtn = document.getElementById('control-login-btn');
    const controlLogoutBtn = document.getElementById('control-logout-btn');
    const controlLoginStatus = document.getElementById('control-login-status');

    // Authentication State
    let isAuthenticated = false;
    let currentUser = null;
    
    // Default credentials (you can change these)
    const VALID_CREDENTIALS = {
        'admin': 'scoreboard123',
        'referee': 'ref123',
        'operator': 'op123'
    };

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
        quarter: 1,
        gameMinutes: 10,
        gameSeconds: 0,
        shotClockSeconds: 24,
        isGameClockRunning: false,
        isShotClockRunning: false,
        ballPossession: 'home', // 'home' or 'away'
        // Default Settings
        defaultGameMinutes: 10,
        defaultShotClock: 24,
        defaultTimeouts: 2,
        defaultQuarter: 1,
        defaultHomeTeam: "HOME",
        defaultAwayTeam: "AWAY"
    };

    // --- Authentication Functions ---
    function showLoginModal() {
        if (loginModal) {
            loginModal.style.display = 'block';
            if (usernameInput) usernameInput.focus();
        }
    }

    function hideLoginModal() {
        if (loginModal) {
            loginModal.style.display = 'none';
            if (loginStatus) {
                loginStatus.textContent = '';
                loginStatus.className = 'login-status';
            }
        }
    }

    function showLoginStatus(message, type = 'info') {
        if (loginStatus) {
            loginStatus.textContent = message;
            loginStatus.className = `login-status ${type}`;
        }
        if (controlLoginStatus) {
            controlLoginStatus.textContent = message;
            controlLoginStatus.className = `login-status ${type}`;
        }
    }

    function authenticateUser(username, password) {
        if (VALID_CREDENTIALS[username] && VALID_CREDENTIALS[username] === password) {
            isAuthenticated = true;
            currentUser = username;
            showLoginStatus(`Welcome, ${username}!`, 'success');
            updateScoreboardAccess();
            hideLoginModal();
            
            // Store authentication in localStorage
            localStorage.setItem('scoreboardAuth', JSON.stringify({
                user: username,
                timestamp: Date.now()
            }));
            
            return true;
        } else {
            isAuthenticated = false;
            currentUser = null;
            showLoginStatus('Invalid username or password', 'error');
            return false;
        }
    }

    function logout() {
        isAuthenticated = false;
        currentUser = null;
        updateScoreboardAccess();
        
        // Clear localStorage
        localStorage.removeItem('scoreboardAuth');
        
        showLoginStatus('Logged out successfully', 'info');
        setTimeout(() => {
            hideLoginModal();
        }, 1500);
    }

    function updateScoreboardAccess() {
        if (scoreboardEl) {
            // Remove locked class - allow viewing for all users
            scoreboardEl.classList.remove('locked');
            
            if (isAuthenticated) {
                if (logoutBtn) logoutBtn.style.display = 'inline-block';
                if (loginBtn) loginBtn.style.display = 'none';
                if (controlLogoutBtn) controlLogoutBtn.style.display = 'inline-block';
                if (controlLoginBtn) controlLoginBtn.style.display = 'none';
            } else {
                if (logoutBtn) logoutBtn.style.display = 'none';
                if (loginBtn) loginBtn.style.display = 'inline-block';
                if (controlLogoutBtn) controlLogoutBtn.style.display = 'none';
                if (controlLoginBtn) controlLoginBtn.style.display = 'inline-block';
            }
        }
    }

    function checkAuthentication() {
        const savedAuth = localStorage.getItem('scoreboardAuth');
        if (savedAuth) {
            try {
                const auth = JSON.parse(savedAuth);
                const now = Date.now();
                const authAge = now - auth.timestamp;
                
                // Check if authentication is less than 24 hours old
                if (authAge < 24 * 60 * 60 * 1000) {
                    isAuthenticated = true;
                    currentUser = auth.user;
                    updateScoreboardAccess();
                    return true;
                } else {
                    // Authentication expired
                    localStorage.removeItem('scoreboardAuth');
                }
            } catch (e) {
                localStorage.removeItem('scoreboardAuth');
            }
        }
        
        // Don't show login modal automatically - allow viewing for all users
        updateScoreboardAccess();
        return false;
    }

    function requireAuth(callback) {
        if (isAuthenticated) {
            return callback();
        } else {
            // Don't show login modal automatically - user must press 'L' key
            return false;
        }
    }

    // --- Firebase Setup ---
    const stateRef = ref(db, 'scoreboardState');

    // --- Update Functions ---
    const updateDisplay = () => {
        if (homeScoreEl) homeScoreEl.textContent = String(scoreboardState.homeScore).padStart(2, '0');
        if (awayScoreEl) awayScoreEl.textContent = String(scoreboardState.awayScore).padStart(2, '0');
        if (gameClockEl) gameClockEl.textContent = `${String(scoreboardState.gameMinutes).padStart(2, '0')}:${String(scoreboardState.gameSeconds).padStart(2, '0')}`;
        if (shotClockEl) shotClockEl.textContent = String(scoreboardState.shotClockSeconds).padStart(2, '0');
        if (quarterEl) quarterEl.textContent = `Q${scoreboardState.quarter}`;
        if (homeFoulsEl) homeFoulsEl.textContent = scoreboardState.homeFouls;
        if (awayFoulsEl) awayFoulsEl.textContent = scoreboardState.awayFouls;
        if (homeTimeoutsEl) homeTimeoutsEl.textContent = scoreboardState.homeTimeouts;
        if (awayTimeoutsEl) awayTimeoutsEl.textContent = scoreboardState.awayTimeouts;
        
        // Update team names
        const homeTeamNameEl = document.getElementById('home-team-name');
        const awayTeamNameEl = document.getElementById('away-team-name');
        if (homeTeamNameEl) {
            // Update only the text content, preserving the possession arrow div
            const textNode = homeTeamNameEl.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.textContent = scoreboardState.homeTeamName;
            } else {
                // If no text node exists, create one
                homeTeamNameEl.textContent = scoreboardState.homeTeamName;
                // Re-add the possession arrow div
                const arrowDiv = document.createElement('div');
                arrowDiv.className = 'possession-arrow';
                arrowDiv.id = 'home-possession-arrow';
                homeTeamNameEl.appendChild(arrowDiv);
            }
        }
        if (awayTeamNameEl) {
            // Update only the text content, preserving the possession arrow div
            const textNode = awayTeamNameEl.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.textContent = scoreboardState.awayTeamName;
            } else {
                // If no text node exists, create one
                awayTeamNameEl.textContent = scoreboardState.awayTeamName;
                // Re-add the possession arrow div
                const arrowDiv = document.createElement('div');
                arrowDiv.className = 'possession-arrow';
                arrowDiv.id = 'away-possession-arrow';
                awayTeamNameEl.appendChild(arrowDiv);
            }
        }
        
        // Update ball possession indicator
        updateBallPossessionIndicator();
        
        // Update foul bonus styling
        updateFoulBonusStyling();
    };

    // --- Firebase Sync ---
    function pushStateToFirebase() {
        set(stateRef, scoreboardState);
    }

    // --- Efficient Firebase Updates ---
    function pushStateToFirebaseEfficient(updates) {
        // Update local state first
        Object.assign(scoreboardState, updates);
        // Update DOM immediately
        updateDisplay();
        // Then push to Firebase
        set(stateRef, scoreboardState);
    }



    // --- Ball Possession Indicator ---
    function updateBallPossessionIndicator() {
        const homeArrow = document.getElementById('home-possession-arrow');
        const awayArrow = document.getElementById('away-possession-arrow');
        
        if (homeArrow && awayArrow) {
            if (scoreboardState.ballPossession === 'home') {
                homeArrow.textContent = '◀';
                homeArrow.classList.add('active');
                awayArrow.classList.remove('active');
            } else {
                awayArrow.textContent = '▶';
                awayArrow.classList.add('active');
                homeArrow.classList.remove('active');
            }
        }
    }

    // --- Foul Bonus Styling ---
    function updateFoulBonusStyling() {
        // Get foul stat lines
        const homeFoulStatLine = document.querySelector('.team.home .stat-line.foul');
        const awayFoulStatLine = document.querySelector('.team.away .stat-line.foul');
        
        // Check if home team just reached bonus
        const wasHomeBonus = homeFoulStatLine && homeFoulStatLine.classList.contains('bonus');
        const isHomeBonus = scoreboardState.homeFouls >= 5;
        
        // Check if away team just reached bonus
        const wasAwayBonus = awayFoulStatLine && awayFoulStatLine.classList.contains('bonus');
        const isAwayBonus = scoreboardState.awayFouls >= 5;
        
        // Update home team foul styling
        if (homeFoulStatLine) {
            if (isHomeBonus) {
                homeFoulStatLine.classList.add('bonus');
            } else {
                homeFoulStatLine.classList.remove('bonus');
            }
        }
        
        // Update away team foul styling
        if (awayFoulStatLine) {
            if (isAwayBonus) {
                awayFoulStatLine.classList.add('bonus');
            } else {
                awayFoulStatLine.classList.remove('bonus');
            }
        }
    }



    // --- Listen for Firebase changes ---
    onValue(stateRef, (snapshot) => {
        const newState = snapshot.val();
        if (newState) {
            // Preserve team names if they're not in the new state
            const currentTeamNames = {
                homeTeamName: scoreboardState.homeTeamName,
                awayTeamName: scoreboardState.awayTeamName
            };
            
            // Update state
            scoreboardState = { ...scoreboardState, ...newState };
            
            // Ensure team names are preserved if not in update
            if (!newState.hasOwnProperty('homeTeamName')) {
                scoreboardState.homeTeamName = currentTeamNames.homeTeamName;
            }
            if (!newState.hasOwnProperty('awayTeamName')) {
                scoreboardState.awayTeamName = currentTeamNames.awayTeamName;
            }
            
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
            if (gameOverSound) {
                gameOverSound.currentTime = 0; 
                gameOverSound.play().catch(() => {
                    // Handle autoplay restrictions silently
                });
            }
            alert("Game Over!");
        }
        // Only update game clock in Firebase, not the entire state
        pushStateToFirebaseEfficient({ 
            gameMinutes: scoreboardState.gameMinutes, 
            gameSeconds: scoreboardState.gameSeconds 
        });
    }
    function tickShotClock() {
        if (scoreboardState.shotClockSeconds > 0) {
            scoreboardState.shotClockSeconds--;
            
            // Play shot clock buzzer when it reaches 1 second (not 0)
            if (scoreboardState.shotClockSeconds === 0) {
                const shotClockSound = document.getElementById('shotclock-sound');
                if (shotClockSound) {
                    shotClockSound.currentTime = 0;
                    shotClockSound.play().catch(() => {
                        // Handle autoplay restrictions silently
                    });
                }
            }
        } else {
            stopShotClock();
        }
        // Only update shot clock in Firebase, not the entire state
        pushStateToFirebaseEfficient({ shotClockSeconds: scoreboardState.shotClockSeconds });
    }
    let gameTimerInterval = null;
    let shotClockTimerInterval = null;
    function startGameClock() {
        return requireAuth(() => {
            if (!scoreboardState.isGameClockRunning && (scoreboardState.gameMinutes > 0 || scoreboardState.gameSeconds > 0)) {
                clearInterval(gameTimerInterval);
                gameTimerInterval = setInterval(tickGameClock, 1000);
                scoreboardState.isGameClockRunning = true;
                if (controlsInfoEl) controlsInfoEl.textContent = "Game Clock RUNNING";
                pushStateToFirebase();
            }
        });
    }
    function stopGameClock() {
        return requireAuth(() => {
            clearInterval(gameTimerInterval);
            scoreboardState.isGameClockRunning = false;
            if (controlsInfoEl) controlsInfoEl.textContent = "Game Clock STOPPED";
            pushStateToFirebase();
        });
    }
    function startShotClock() {
        return requireAuth(() => {
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
        });
    }
    function stopShotClock() {
        return requireAuth(() => {
        clearInterval(shotClockTimerInterval);
            scoreboardState.isShotClockRunning = false;
            pushStateToFirebase();
        });
    }
    function resetGameClock() {
        return requireAuth(() => {
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
        });
    }
    function resetShotClock(time = 24) {
        return requireAuth(() => {
            scoreboardState.shotClockSeconds = time;
            if (shotClockEl) {
                shotClockEl.style.backgroundColor = '';
                shotClockEl.style.color = '';
            }
            if (scoreboardState.isGameClockRunning) {
                startShotClock();
            }
            // Only update shot clock in Firebase
            pushStateToFirebaseEfficient({ shotClockSeconds: time });
        });
    }
    // --- Control Functions ---
    function adjustScore(team, delta) {
        return requireAuth(() => {
        if (team === 'home') {
                scoreboardState.homeScore = Math.max(0, Math.min(999, scoreboardState.homeScore + delta));
        } else if (team === 'away') {
                scoreboardState.awayScore = Math.max(0, Math.min(999, scoreboardState.awayScore + delta));
            }
            pushStateToFirebaseEfficient({ 
                homeScore: scoreboardState.homeScore, 
                awayScore: scoreboardState.awayScore 
            });
        });
    }
    function adjustFouls(team, delta) {
        return requireAuth(() => {
        if (team === 'home') {
                scoreboardState.homeFouls = Math.max(0, Math.min(99, scoreboardState.homeFouls + delta));
        } else if (team === 'away') {
                scoreboardState.awayFouls = Math.max(0, Math.min(99, scoreboardState.awayFouls + delta));
            }
            pushStateToFirebaseEfficient({ 
                homeFouls: scoreboardState.homeFouls, 
                awayFouls: scoreboardState.awayFouls 
            });
        });
    }
    function adjustTimeouts(team, delta) {
        return requireAuth(() => {
        if (team === 'home') {
                scoreboardState.homeTimeouts = Math.max(0, Math.min(99, scoreboardState.homeTimeouts + delta));
        } else if (team === 'away') {
                scoreboardState.awayTimeouts = Math.max(0, Math.min(99, scoreboardState.awayTimeouts + delta));
            }
            pushStateToFirebaseEfficient({ 
                homeTimeouts: scoreboardState.homeTimeouts, 
                awayTimeouts: scoreboardState.awayTimeouts 
            });
        });
    }

    function adjustQuarter(delta) {
        return requireAuth(() => {
            scoreboardState.quarter = Math.max(1, Math.min(10, scoreboardState.quarter + delta));
            pushStateToFirebaseEfficient({ quarter: scoreboardState.quarter });
        });
    }

    function toggleBallPossession() {
        return requireAuth(() => {
            scoreboardState.ballPossession = scoreboardState.ballPossession === 'home' ? 'away' : 'home';
            pushStateToFirebaseEfficient({ ballPossession: scoreboardState.ballPossession });
        });
    }
    function setCustomTime() {
        return requireAuth(() => {
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
        });
    }

    // --- Team Name Functions ---
    function setTeamNames() {
        return requireAuth(() => {
            const homeName = prompt("Enter Home Team Name:", scoreboardState.homeTeamName);
            if (homeName !== null) {
                scoreboardState.homeTeamName = homeName.trim() || "HOME";
            }
            
            const awayName = prompt("Enter Away Team Name:", scoreboardState.awayTeamName);
            if (awayName !== null) {
                scoreboardState.awayTeamName = awayName.trim() || "AWAY";
            }
            
            // Only update team names in Firebase when they're actually changed
            pushStateToFirebaseEfficient({ 
                homeTeamName: scoreboardState.homeTeamName, 
                awayTeamName: scoreboardState.awayTeamName 
            });
        });
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
        if (quarterInput) quarterInput.value = scoreboardState.quarter;
        if (ballPossessionInput) ballPossessionInput.value = scoreboardState.ballPossession;
        if (gameMinutesInput) gameMinutesInput.value = scoreboardState.gameMinutes;
        if (gameSecondsInput) gameSecondsInput.value = scoreboardState.gameSeconds;
        if (shotClockInput) shotClockInput.value = scoreboardState.shotClockSeconds;
        
        // Populate default settings
        if (defaultGameMinutesInput) defaultGameMinutesInput.value = scoreboardState.defaultGameMinutes;
        if (defaultShotClockInput) defaultShotClockInput.value = scoreboardState.defaultShotClock;
        if (defaultTimeoutsInput) defaultTimeoutsInput.value = scoreboardState.defaultTimeouts;
        if (defaultQuarterInput) defaultQuarterInput.value = scoreboardState.defaultQuarter;
        if (defaultHomeTeamInput) defaultHomeTeamInput.value = scoreboardState.defaultHomeTeam;
        if (defaultAwayTeamInput) defaultAwayTeamInput.value = scoreboardState.defaultAwayTeam;
        
        // Clear authentication fields
        if (controlUsernameInput) controlUsernameInput.value = '';
        if (controlPasswordInput) controlPasswordInput.value = '';
        if (controlLoginStatus) controlLoginStatus.textContent = '';
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
        
        // Update quarter
        if (quarterInput) scoreboardState.quarter = Math.max(1, Math.min(10, parseInt(quarterInput.value) || 1));
        
        // Update ball possession
        if (ballPossessionInput) scoreboardState.ballPossession = ballPossessionInput.value;
        
        // Update default settings
        if (defaultGameMinutesInput) scoreboardState.defaultGameMinutes = Math.max(1, Math.min(99, parseInt(defaultGameMinutesInput.value) || 10));
        if (defaultShotClockInput) scoreboardState.defaultShotClock = Math.max(1, Math.min(99, parseInt(defaultShotClockInput.value) || 24));
        if (defaultTimeoutsInput) scoreboardState.defaultTimeouts = Math.max(0, Math.min(99, parseInt(defaultTimeoutsInput.value) || 2));
        if (defaultQuarterInput) scoreboardState.defaultQuarter = Math.max(1, Math.min(10, parseInt(defaultQuarterInput.value) || 1));
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
            scoreboardState.quarter = scoreboardState.defaultQuarter;
            scoreboardState.ballPossession = 'home';
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
                quarter: scoreboardState.defaultQuarter,
                ballPossession: 'home',
                gameMinutes: scoreboardState.defaultGameMinutes,
                gameSeconds: 0,
                shotClockSeconds: scoreboardState.defaultShotClock,
                isGameClockRunning: false,
                isShotClockRunning: false,
                // Preserve default settings
                defaultGameMinutes: scoreboardState.defaultGameMinutes,
                defaultShotClock: scoreboardState.defaultShotClock,
                defaultTimeouts: scoreboardState.defaultTimeouts,
                defaultQuarter: scoreboardState.defaultQuarter,
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
            resetShotClock(24);
        } else if (e.button === 1) { // Middle click (scroll wheel)
            e.preventDefault();
            resetShotClock(14);
        }
    });

    // --- Keyboard Event Listener ---
    document.addEventListener('keydown', (e) => {
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight','KeyC' ,'KeyR', 'KeyS', 'KeyF', 'KeyJ', 'KeyT', 'KeyY', 'KeyH', 'KeyZ', 'KeyX', 'KeyC','KeyQ', 'KeyB', 'Enter', 'KeyN', 'KeyP', 'KeyO', 'KeyA', 'KeyD', 'KeyL'].includes(e.code) || (e.shiftKey && ['KeyR', 'KeyF', 'KeyJ', 'KeyT', 'KeyY', 'KeyZ', 'KeyX', 'KeyQ'].includes(e.code))) {
            e.preventDefault();
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
        else if (e.code === 'KeyR' && !e.shiftKey) { // 'r' - Reset Shot Clock (24s)
            resetShotClock(24);
        }
         else if (e.code === 'KeyR' && e.shiftKey) { // Shift + 'r' - Reset Shot Clock (14s)
            resetShotClock(14);
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

        // Quarter Controls
        else if (e.code === 'KeyQ' && !e.shiftKey) { adjustQuarter(1); }
        else if (e.code === 'KeyQ' && e.shiftKey) { adjustQuarter(-1); }

        // Ball Possession Control
        else if (e.code === 'KeyB') { toggleBallPossession(); }

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
        else if (e.code === 'KeyL' || e.code === 'l') { // 'l' - Show Login Modal
            e.preventDefault();
            showLoginModal();
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

    // --- Authentication Event Listeners ---
    if (loginBtn) loginBtn.addEventListener('click', () => {
        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        
        if (!username || !password) {
            showLoginStatus('Please enter both username and password', 'error');
            return;
        }
        
        authenticateUser(username, password);
    });

    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // --- Control Panel Authentication Event Listeners ---
    if (controlLoginBtn) controlLoginBtn.addEventListener('click', () => {
        const username = controlUsernameInput ? controlUsernameInput.value.trim() : '';
        const password = controlPasswordInput ? controlPasswordInput.value : '';
        
        if (!username || !password) {
            showLoginStatus('Please enter both username and password', 'error');
            return;
        }
        
        authenticateUser(username, password);
    });

    if (controlLogoutBtn) controlLogoutBtn.addEventListener('click', logout);

    // Handle Enter key in login form
    if (usernameInput) {
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && passwordInput) {
                passwordInput.focus();
            }
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loginBtn.click();
            }
        });
    }

    // Handle Enter key in control panel login form
    if (controlUsernameInput) {
        controlUsernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && controlPasswordInput) {
                controlPasswordInput.focus();
            }
        });
    }

    if (controlPasswordInput) {
        controlPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                controlLoginBtn.click();
            }
        });
    }

    // Close login modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === loginModal) {
            hideLoginModal();
        }
        if (event.target === helpModal) {
            hideHelp();
        }
        if (event.target === controlPanelModal) {
            hideControlPanel();
        }
    });

    // --- Sound Initialization ---
    function initializeSounds() {
        // Pre-load and enable sounds after user interaction
        const gameOverSound = document.getElementById('game-over-sound');
        const shotClockSound = document.getElementById('shotclock-sound');
        
        if (gameOverSound) {
            gameOverSound.volume = 0.7;
            gameOverSound.load();
        }
        
        if (shotClockSound) {
            shotClockSound.volume = 0.8;
            shotClockSound.load();
        }
    }

    // --- Initial Setup ---
    updateDisplay();

    // Initialize authentication
    checkAuthentication();
    
    // Initialize sounds on first user interaction
    document.addEventListener('click', function initSounds() {
        initializeSounds();
        document.removeEventListener('click', initSounds);
    }, { once: true });
    
    document.addEventListener('keydown', function initSounds() {
        initializeSounds();
        document.removeEventListener('keydown', initSounds);
    }, { once: true });
});

