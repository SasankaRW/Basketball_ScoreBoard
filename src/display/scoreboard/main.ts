/**
 * Operator scoreboard.
 *
 * This replaces the old script.js. The page it drives is visually identical —
 * same markup, same stylesheet, same keyboard map — but the 950-line file that
 * owned game rules, Firebase wiring, a hardcoded credential table and a
 * per-second write loop is now a thin controller over shared modules:
 *
 *   keypress -> Action -> dispatchWithRetry (transactional) -> RTDB
 *   RTDB -> subscribeBoardState -> renderScoreboard
 *
 * Every clamp and rule lives in core/reducer.ts, which the control panel and the
 * Cloud Functions run too, so the three cannot disagree about what a foul does.
 */
import { remainingAt } from '../../core/clock.js';
import { dispatchWithRetry, subscribeBoardState } from '../../core/liveState.js';
import type { Action } from '../../core/reducer.js';
import { canControlBoard } from '../../core/roles.js';
import type { BoardState } from '../../core/schema.js';
import { now } from '../../core/serverTime.js';
import {
  bootOperatorSurface,
  DisplayBootError,
  mountStatusBanner,
  renderFatalError,
  watchConnection,
  type DisplayContext,
} from '../shared/displayBoot.js';
import {
  queryScoreboardElements,
  renderScoreboard,
  startDisplayLoop,
} from '../shared/scoreboardView.js';

const IDLE_HINT = "Press 'H' for Help";

async function main(): Promise<void> {
  const banner = mountStatusBanner();

  let context: DisplayContext;
  try {
    context = await bootOperatorSurface();
  } catch (error) {
    if (error instanceof DisplayBootError) renderFatalError(error.message);
    else renderFatalError('Could not open this board.');
    return;
  }

  const { db, tenantId, boardId, session } = context;
  const elements = queryScoreboardElements();
  const readOnly = !canControlBoard(session.role);

  watchConnection(db, banner);

  let state: BoardState | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function hint(message: string, holdMs = 2_500): void {
    if (!elements.controlsInfo) return;
    elements.controlsInfo.textContent = message;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (elements.controlsInfo) elements.controlsInfo.textContent = IDLE_HINT;
    }, holdMs);
  }

  function dispatch(action: Action): void {
    if (readOnly) {
      hint('Read-only access — ask an admin for the operator role');
      return;
    }
    if (!state) return;

    void dispatchWithRetry(db, tenantId, boardId, action, { now: now(), actor: session.uid })
      .then((outcome) => {
        if (outcome.status === 'missing') hint('This board has no game state yet');
        else if (outcome.status === 'conflict')
          hint('Another operator changed the board — retrying');
      })
      .catch(() => hint('Change not saved — check the connection'));
  }

  // -- Live state ---------------------------------------------------------

  subscribeBoardState(
    db,
    tenantId,
    boardId,
    (snapshot) => {
      state = snapshot.state;
      if (snapshot.loaded && !snapshot.state) {
        banner.set('error', 'This board has no game state. Recreate it from the dashboard.');
      }
    },
    () => banner.set('error', 'Lost permission to read this board. Sign in again.'),
  );

  // -- Buzzers ------------------------------------------------------------

  const shotBuzzer = document.getElementById('shotclock-sound') as HTMLAudioElement | null;
  const gameBuzzer = document.getElementById('game-over-sound') as HTMLAudioElement | null;

  function play(audio: HTMLAudioElement | null): void {
    if (!audio) return;
    audio.currentTime = 0;
    // Autoplay policy rejects until the page has been interacted with; a silent
    // failure is correct here, not an error the operator has to dismiss.
    void audio.play().catch(() => undefined);
  }

  let gameWasRunning = false;
  let shotWasRunning = false;

  // -- Render loop --------------------------------------------------------

  startDisplayLoop(() => {
    if (!state) return 250;

    const currentTime = now();
    const nextDelay = renderScoreboard(elements, state, { now: currentTime });

    const gameRemaining = remainingAt(state.gameClock, currentTime);
    const shotRemaining = remainingAt(state.shotClock, currentTime);

    /**
     * Expiry is detected locally by every surface but persisted by this one.
     * SETTLE rewrites the clock as explicitly paused-at-zero so the mirror and
     * overlay stop rendering a countdown the database still thinks is live.
     */
    if (gameWasRunning && gameRemaining === 0) {
      play(gameBuzzer);
      hint('Period over', 5_000);
      dispatch({ type: 'SETTLE' });
    }
    if (shotWasRunning && shotRemaining === 0) {
      play(shotBuzzer);
      dispatch({ type: 'SETTLE' });
    }

    gameWasRunning = state.gameClock.running && gameRemaining > 0;
    shotWasRunning = state.shotClock.running && shotRemaining > 0;

    return nextDelay;
  });

  // -- Mouse --------------------------------------------------------------

  document.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('mousedown', (event) => {
    // Clicks inside a dialog belong to the dialog. The original reset the shot
    // clock even when dismissing the help box, which made it hard to close.
    if ((event.target as HTMLElement | null)?.closest('.modal-content')) return;

    if (event.button === 2) {
      dispatch({ type: 'SHOT_CLOCK_TOGGLE' });
    } else if (event.button === 0) {
      dispatch({ type: 'SHOT_CLOCK_RESET' });
    } else if (event.button === 1) {
      event.preventDefault();
      dispatch({ type: 'SHOT_CLOCK_RESET', remainingMs: state?.config.shotClockResetMs ?? 14_000 });
    }
  });

  // -- Help modal ---------------------------------------------------------

  const helpModal = document.getElementById('help-modal');
  const setHelp = (visible: boolean) => {
    if (helpModal) helpModal.style.display = visible ? 'block' : 'none';
  };

  document.querySelector('.close-button')?.addEventListener('click', () => setHelp(false));
  window.addEventListener('click', (event) => {
    if (event.target === helpModal) setHelp(false);
  });

  // -- Keyboard -----------------------------------------------------------

  /** Keys the page owns. Preventing default stops Space and the arrows scrolling. */
  const OWNED_KEYS = new Set([
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'KeyA',
    'KeyB',
    'KeyC',
    'KeyD',
    'KeyF',
    'KeyG',
    'KeyH',
    'KeyJ',
    'KeyN',
    'KeyQ',
    'KeyR',
    'KeyT',
    'KeyX',
    'KeyZ',
    'Enter',
  ]);

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (OWNED_KEYS.has(event.code)) event.preventDefault();

    const shift = event.shiftKey;

    switch (event.code) {
      // Clocks
      case 'KeyT':
        dispatch({ type: 'GAME_CLOCK_TOGGLE' });
        hint(state?.gameClock.running ? 'Game Clock STOPPED' : 'Game Clock RUNNING');
        return;
      case 'Space':
        dispatch({ type: 'SHOT_CLOCK_TOGGLE' });
        return;
      case 'KeyR':
        dispatch({
          type: 'SHOT_CLOCK_RESET',
          ...(shift ? { remainingMs: state?.config.shotClockResetMs ?? 14_000 } : {}),
        });
        return;
      case 'KeyG':
        if (confirm('Are you sure you want to reset the game clock?')) {
          dispatch({ type: 'GAME_CLOCK_RESET' });
          hint('Game Clock Reset');
        }
        return;

      // Score
      case 'ArrowUp':
        return dispatch({ type: 'SCORE_ADJUST', side: 'home', delta: 1 });
      case 'ArrowDown':
        return dispatch({ type: 'SCORE_ADJUST', side: 'home', delta: -1 });
      case 'ArrowRight':
        return dispatch({ type: 'SCORE_ADJUST', side: 'away', delta: 1 });
      case 'ArrowLeft':
        return dispatch({ type: 'SCORE_ADJUST', side: 'away', delta: -1 });

      // Fouls
      case 'KeyF':
        return dispatch({ type: 'FOUL_ADJUST', side: 'home', delta: shift ? -1 : 1 });
      case 'KeyJ':
        return dispatch({ type: 'FOUL_ADJUST', side: 'away', delta: shift ? -1 : 1 });

      // Timeouts — unshifted spends one, shift returns one, as before.
      case 'KeyZ':
        return dispatch({ type: 'TIMEOUT_ADJUST', side: 'home', delta: shift ? 1 : -1 });
      case 'KeyX':
        return dispatch({ type: 'TIMEOUT_ADJUST', side: 'away', delta: shift ? 1 : -1 });

      // Period and possession
      case 'KeyQ':
        return dispatch({ type: 'PERIOD_ADJUST', delta: shift ? -1 : 1 });
      case 'KeyB':
        return dispatch({ type: 'POSSESSION_TOGGLE' });

      // Prompts
      case 'Enter':
        return promptGameTime();
      case 'KeyN':
        return promptTeamNames();

      // Navigation and whole-game actions
      case 'KeyH':
        setHelp(helpModal?.style.display !== 'block');
        return;
      case 'KeyC':
        if (shift) return promptShotClock();
        window.open(`/control/${boardId}`, '_blank', 'noopener');
        return;
      case 'KeyA':
      case 'KeyD':
        if (confirm('Start a new game? Score, fouls and clocks will be cleared.')) {
          dispatch({ type: 'NEW_GAME' });
          hint('New game');
        }
        return;
      default:
    }
  });

  function promptGameTime(): void {
    if (!state) return;
    dispatch({ type: 'GAME_CLOCK_PAUSE' });

    const remaining = remainingAt(state.gameClock, now());
    const current = `${String(Math.floor(remaining / 60_000)).padStart(2, '0')}:${String(
      Math.floor((remaining % 60_000) / 1_000),
    ).padStart(2, '0')}`;

    const input = prompt('Enter game time (MM:SS):', current);
    if (input === null) return;

    const match = /^(\d{1,2}):(\d{1,2})$/.exec(input.trim());
    const minutes = match ? Number(match[1]) : Number.NaN;
    const seconds = match ? Number(match[2]) : Number.NaN;

    if (!match || Number.isNaN(minutes) || Number.isNaN(seconds) || seconds > 59) {
      alert('Invalid time format. Please use MM:SS.');
      return;
    }
    dispatch({ type: 'GAME_CLOCK_SET', remainingMs: minutes * 60_000 + seconds * 1_000 });
    hint('Game Clock STOPPED');
  }

  function promptShotClock(): void {
    if (!state) return;
    const input = prompt(
      'Enter custom shot clock (seconds):',
      String(Math.ceil(remainingAt(state.shotClock, now()) / 1_000)),
    );
    if (input === null) return;

    const seconds = Number.parseInt(input, 10);
    if (Number.isNaN(seconds) || seconds < 1 || seconds > 99) {
      alert('Invalid shot clock value. Enter a number between 1 and 99.');
      return;
    }
    dispatch({ type: 'SHOT_CLOCK_RESET', remainingMs: seconds * 1_000 });
  }

  function promptTeamNames(): void {
    if (!state) return;
    const home = prompt('Enter Home Team Name:', state.home.name);
    if (home !== null) dispatch({ type: 'TEAM_NAME_SET', side: 'home', name: home });

    const away = prompt('Enter Away Team Name:', state.away.name);
    if (away !== null) dispatch({ type: 'TEAM_NAME_SET', side: 'away', name: away });
  }

  // Browsers block audio until the page has been interacted with; priming the
  // elements on the first gesture means the buzzer is ready before it is needed.
  const primeAudio = () => {
    for (const audio of [shotBuzzer, gameBuzzer]) {
      if (audio) {
        audio.volume = audio === gameBuzzer ? 0.7 : 0.8;
        audio.load();
      }
    }
  };
  document.addEventListener('click', primeAudio, { once: true });
  document.addEventListener('keydown', primeAudio, { once: true });

  if (readOnly) hint('Read-only access — you can watch but not control this board', 8_000);
}

void main();
