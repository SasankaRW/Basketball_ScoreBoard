document.addEventListener('DOMContentLoaded', () => {
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

    // --- State Variables ---
    let homeScore = 0;
    let awayScore = 0;
    let homeFouls = 0;
    let awayFouls = 0;
    let homeTimeouts = 2;
    let awayTimeouts = 2;

    let gameMinutes = 10;
    let gameSeconds = 0;
    let shotClockSeconds = 12;

    let gameTimerInterval = null;
    let shotClockTimerInterval = null;
    let isGameClockRunning = false;
    let isShotClockRunning = false;

    const SHOT_CLOCK_FULL = 12;
    const SHOT_CLOCK_OREB = 12;
    const MAX_FOULS = 99;
    const MAX_TIMEOUTS = 9;
    const MAX_SCORE = 999;

    // --- Update Functions ---
    const updateDisplay = () => {
        homeScoreEl.textContent = String(homeScore).padStart(2, '0');
        awayScoreEl.textContent = String(awayScore).padStart(2, '0');
        gameClockEl.textContent = `${String(gameMinutes).padStart(2, '0')}:${String(gameSeconds).padStart(2, '0')}`;
        shotClockEl.textContent = String(shotClockSeconds).padStart(2, '0');
        homeFoulsEl.textContent = homeFouls;
        awayFoulsEl.textContent = awayFouls;
        homeTimeoutsEl.textContent = homeTimeouts;
        awayTimeoutsEl.textContent = awayTimeouts;
    };

    // --- Timer Functions ---
    const tickGameClock = () => {
        if (gameSeconds > 0) {
            gameSeconds--;
        } else if (gameMinutes > 0) {
            gameMinutes--;
            gameSeconds = 59;
        } else {
            stopGameClock(); // Stop at 00:00
            alert("Game Over!");
        }
        updateDisplay();
    };

    const tickShotClock = () => {
        if (shotClockSeconds === 1) {
            // Play the shot clock sound just before hitting zero
            const shotClockSound = document.getElementById('shotclock-sound');
            // Change background color to red
            shotClockEl.style.backgroundColor = 'red';
            shotClockEl.style.color= 'black';
            shotClockSound.play();
        }
    
        if (shotClockSeconds > 0) {
            shotClockSeconds--;
        } else {
            stopShotClock();
            console.log("Shot Clock Violation!");
    
            
        }
    
        updateDisplay();
    };
    
    

    const startGameClock = () => {
        if (!isGameClockRunning && (gameMinutes > 0 || gameSeconds > 0)) {
            // Clear just in case
            clearInterval(gameTimerInterval);
            gameTimerInterval = setInterval(tickGameClock, 1000);
            isGameClockRunning = true;
            controlsInfoEl.textContent = "Game Clock RUNNING";
        }
    };

    const stopGameClock = () => {
        clearInterval(gameTimerInterval);
        isGameClockRunning = false;
        // --- REMOVED stopShotClock() call from here ---
        controlsInfoEl.textContent = "Game Clock STOPPED";
    };

    const startShotClock = () => {
         // Start shot clock regardless of game clock state, if not already running and > 0
        if (!isShotClockRunning && shotClockSeconds > 0) {
            // Clear just in case
            clearInterval(shotClockTimerInterval);
            shotClockTimerInterval = setInterval(tickShotClock, 1000);
            isShotClockRunning = true;
            shotClockEl.style.backgroundColor = '';
            shotClockEl.style.color= ''; // Reset to default
            // shotClockEl.style.color = '#e74c3c'; // Reset color if changed on violation
        }
    };

    const stopShotClock = () => {
        clearInterval(shotClockTimerInterval);
        isShotClockRunning = false;
    };

    const resetShotClock = (time = SHOT_CLOCK_FULL) => {
       // Always stop when resetting
        shotClockSeconds = time;
        // shotClockEl.style.color = '#e74c3c'; // Reset color
        updateDisplay();
        shotClockEl.style.backgroundColor = '';
        shotClockEl.style.color= ''; 
        // Optional: Decide if reset should *automatically* restart the shot clock.
        // Common behaviour: It *might* restart if the game clock is running.
        // Let's keep that conditional start for convenience after reset.
        if (isGameClockRunning) {
           startShotClock();
        }
    };
    // --- Control Functions (adjustScore, adjustFouls, adjustTimeouts, setCustomTime) ---
    // These functions remain the same as before...
    const adjustScore = (team, delta) => {
        if (team === 'home') {
            homeScore = Math.max(0, Math.min(MAX_SCORE, homeScore + delta));
        } else if (team === 'away') {
            awayScore = Math.max(0, Math.min(MAX_SCORE, awayScore + delta));
        }
        updateDisplay();
    };

    const adjustFouls = (team, delta) => {
        if (team === 'home') {
            homeFouls = Math.max(0, Math.min(MAX_FOULS, homeFouls + delta));
        } else if (team === 'away') {
            awayFouls = Math.max(0, Math.min(MAX_FOULS, awayFouls + delta));
        }
        updateDisplay();
    };

     const adjustTimeouts = (team, delta) => {
        if (team === 'home') {
            homeTimeouts = Math.max(0, Math.min(MAX_TIMEOUTS, homeTimeouts + delta));
        } else if (team === 'away') {
            awayTimeouts = Math.max(0, Math.min(MAX_TIMEOUTS, awayTimeouts + delta));
        }
        updateDisplay();
    };

    const setCustomTime = () => {
        stopGameClock(); // Stop clock before setting
        const timeInput = prompt("Enter game time (MM:SS):", `${String(gameMinutes).padStart(2, '0')}:${String(gameSeconds).padStart(2, '0')}`);
        if (timeInput) {
            const parts = timeInput.split(':');
            if (parts.length === 2) {
                const mins = parseInt(parts[0], 10);
                const secs = parseInt(parts[1], 10);
                if (!isNaN(mins) && !isNaN(secs) && mins >= 0 && secs >= 0 && secs < 60) {
                    gameMinutes = mins;
                    gameSeconds = secs;
                    updateDisplay();
                } else {
                    alert("Invalid time format. Please use MM:SS.");
                }
            } else {
                 alert("Invalid time format. Please use MM:SS.");
            }
        }
         // Keep game clock stopped after setting
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

    // --- Keyboard Event Listener ---
    document.addEventListener('keydown', (e) => {
        // console.log(e.key, e.code, e.shiftKey); // Debugging

        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR', 'KeyS', 'KeyF', 'KeyJ', 'KeyT', 'KeyY', 'KeyH', 'Enter'].includes(e.code) || (e.shiftKey && ['KeyR', 'KeyF', 'KeyJ', 'KeyT', 'KeyY'].includes(e.code))) {
             e.preventDefault();
        }

        // --- MODIFIED Clock Controls ---
        if (e.code === 'KeyT') { // Game Clock Toggle
            if (isGameClockRunning) {
                stopGameClock();
            } else {
                startGameClock();
            }
        }
        else if (e.code === 'Space' && !e.shiftKey) { // Shot Clock Toggle
             if (isShotClockRunning) {
                 stopShotClock();
             } else {
                 startShotClock(); // Will only start if > 0 seconds
             }
        }
        // --- END MODIFIED Clock Controls ---

        else if (e.code === 'KeyR' && !e.shiftKey) { // 'r' - Reset Shot Clock (Full)
            resetShotClock(SHOT_CLOCK_FULL);
        }
         else if (e.code === 'KeyR' && e.shiftKey) { // Shift + 'r' - Reset Shot Clock (O.Reb)
            resetShotClock(SHOT_CLOCK_OREB);
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

        // Other Controls
        else if (e.code === 'Enter') { setCustomTime(); }
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
