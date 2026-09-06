/**
 * Control panel — the operator's surface.
 *
 * This is what the empty `control-panel.html` stub was always meant to be. It
 * dispatches the same actions through the same reducer as the keyboard-driven
 * scoreboard, so the two can be used side by side on one game — a scorer on the
 * keyboard, an assistant on a tablet — without them fighting each other.
 *
 * The buttons are deliberately oversized. This gets driven courtside, at speed,
 * by someone whose attention is mostly on the court.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createBuzzerElements, createBuzzers } from '../../core/buzzer.js';
import { formatGameClock, formatShotClock, remainingAt } from '../../core/clock.js';
import {
  buildGameClockUrl,
  buildScoreboardUrl,
  buildShotClockUrl,
  subscribeViewerKeys,
  updateBoard,
  type Board,
  type ViewerKeys,
} from '../../core/boards.js';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { finishMatch } from '../../core/matches.js';
import { canControlBoard, canManageBoards } from '../../core/roles.js';
import {
  commandForKey,
  COMMANDS,
  defaultKeymap,
  formatBinding,
  type CommandId,
  type Keymap,
} from '../../core/keymap.js';
import { clearKeymap, readKeymap, writeKeymap } from '../keymapStorage.js';
import {
  isInBonus,
  LIMITS,
  type BoardConfig,
  type BoardState,
  type Side,
} from '../../core/schema.js';
import {
  LOGO_UPLOAD_ENABLED,
  removeBoardLogo,
  uploadBoardLogo,
  validateLogoFile,
} from '../../core/storage.js';
import { ensureStorageClient } from '../../core/storageClient.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { IconExternalLink } from '../components/icons.js';
import { ShortcutEditor } from '../components/ShortcutEditor.js';
import { Alert, CopyField, Field, Modal, Spinner } from '../components/ui.js';
import { useTour } from '../tour/TourProvider.js';
import { useBoard, useBoardState, useDispatch, useNow } from '../hooks.js';

export function ControlPanelPage() {
  const session = useSession();
  const { running: tourRunning } = useTour();
  const navigate = useNavigate();
  const { boardId } = useParams<{ boardId: string }>();
  const board = useBoard(session.tenantId, boardId);
  const { state, loaded, error } = useBoardState(session.tenantId, boardId);
  const {
    dispatch,
    error: dispatchError,
    clearError,
  } = useDispatch(session.tenantId, boardId, session.uid);

  const readOnly = !canControlBoard(session.role);
  const clocksActive = (state?.gameClock.running ?? false) || (state?.shotClock.running ?? false);
  const now = useNow(clocksActive, 100);

  const [editingTime, setEditingTime] = useState(false);
  const [editingNames, setEditingNames] = useState(false);
  const [editingShortcuts, setEditingShortcuts] = useState(false);

  /**
   * The operator's own shortcuts, read once per signed-in user.
   *
   * Seeded lazily so a blocked or empty `localStorage` costs nothing on every
   * later render, and keyed by uid inside the store — a shared courtside laptop
   * must not hand one scorer's layout to the next person who signs in.
   */
  const [keymap, setKeymap] = useState<Keymap>(() => readKeymap(session.uid));

  useEffect(() => setKeymap(readKeymap(session.uid)), [session.uid]);

  const changeKeymap = useCallback(
    (next: Keymap) => {
      setKeymap(next);
      writeKeymap(session.uid, next);
    },
    [session.uid],
  );

  const resetKeymap = useCallback(() => {
    setKeymap(defaultKeymap());
    clearKeymap(session.uid);
  }, [session.uid]);

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishResult, setFinishResult] = useState<{
    homeTeamName: string;
    awayTeamName: string;
    homeScore: number;
    awayScore: number;
  } | null>(null);

  /**
   * Snapshots the score before calling the Function, not after: `finishMatch`
   * resets the board's live state as part of finishing it, and that reset
   * lands back on this page through the same `state` the moment it commits —
   * reading `state` after the await would show the fresh 0-0 board, not the
   * result being announced.
   */
  const handleFinish = useCallback(async () => {
    if (!state || !boardId) return;
    if (
      !confirm(
        'Finish this match? The final score will be saved to match history and the board will reset for the next game.',
      )
    ) {
      return;
    }
    const summary = {
      homeTeamName: state.home.name,
      awayTeamName: state.away.name,
      homeScore: state.home.score,
      awayScore: state.away.score,
    };
    setFinishing(true);
    setFinishError(null);
    try {
      await finishMatch(boardId);
      setFinishResult(summary);
    } catch (caught) {
      setFinishError(caught instanceof Error ? caught.message : 'Could not finish this match.');
    } finally {
      setFinishing(false);
    }
  }, [state, boardId]);

  /**
   * Buzzers here as well as on the scoreboard.
   *
   * The operator is looking at *this* screen, not the gym-wall display, so a
   * buzzer only the scoreboard can sound is one the person who needs it may
   * never hear — the board is often in another room, or muted, or on a machine
   * whose audio nobody checked. Both surfaces detecting expiry independently is
   * already how the clocks work (see the render loop in
   * display/scoreboard/main.ts); this just gives the sound the same treatment.
   *
   * Unlocking is a non-issue on this page in practice — an operator cannot use
   * the control panel without clicking it — but it costs one listener to be
   * certain.
   */
  const buzzers = useMemo(() => createBuzzers(createBuzzerElements()), []);

  useEffect(() => {
    const unlock = () => buzzers.unlock();
    for (const eventName of ['pointerdown', 'keydown'] as const) {
      document.addEventListener(eventName, unlock);
    }
    return () => {
      for (const eventName of ['pointerdown', 'keydown'] as const) {
        document.removeEventListener(eventName, unlock);
      }
    };
  }, [buzzers]);

  /**
   * Edge-triggered on a *running* clock reaching zero, mirroring the
   * scoreboard's `gameWasRunning`/`shotWasRunning` latches. Refs rather than
   * state: this must not itself cause a render, and the previous value has to
   * survive the many renders the tick already causes.
   */
  const gameWasRunning = useRef(false);
  const shotWasRunning = useRef(false);

  useEffect(() => {
    if (!state) return;
    const gameRemaining = remainingAt(state.gameClock, now);
    const shotRemaining = remainingAt(state.shotClock, now);

    if (gameWasRunning.current && gameRemaining === 0) buzzers.play('gameOver');
    if (shotWasRunning.current && shotRemaining === 0) buzzers.play('shotClock');

    gameWasRunning.current = state.gameClock.running && gameRemaining > 0;
    shotWasRunning.current = state.shotClock.running && shotRemaining > 0;
  }, [state, now, buzzers]);

  /**
   * What every bindable control actually does.
   *
   * The panel used to switch straight from a key to a dispatch, which made the
   * key the identity of the action. Naming the commands separates the two, so
   * `src/core/keymap.ts` can decide *which* command a keypress reaches while
   * this stays the single definition of what each one does.
   *
   * Each entry does exactly what its button does, confirmations included — a
   * shortcut that skipped the "start the next period?" prompt would be a
   * different, more dangerous control wearing the same name.
   */
  const commands = useMemo<Record<CommandId, () => void>>(() => {
    const score = (side: Side, delta: number) => () =>
      dispatch({ type: 'SCORE_ADJUST', side, delta });
    const foul = (side: Side, delta: number) => () =>
      dispatch({ type: 'FOUL_ADJUST', side, delta });
    const timeout = (side: Side, delta: number) => () =>
      dispatch({ type: 'TIMEOUT_ADJUST', side, delta });

    return {
      'gameClock.toggle': () => dispatch({ type: 'GAME_CLOCK_TOGGLE' }),
      'gameClock.set': () => setEditingTime(true),
      'gameClock.reset': () => dispatch({ type: 'GAME_CLOCK_RESET' }),
      'shotClock.toggle': () => dispatch({ type: 'SHOT_CLOCK_TOGGLE' }),
      'shotClock.reset': () => dispatch({ type: 'SHOT_CLOCK_RESET' }),
      'shotClock.resetShort': () =>
        dispatch({
          type: 'SHOT_CLOCK_RESET',
          ...(state ? { remainingMs: state.config.shotClockResetMs } : {}),
        }),

      'score.home.plus1': score('home', 1),
      'score.home.plus2': score('home', 2),
      'score.home.plus3': score('home', 3),
      'score.home.minus1': score('home', -1),
      'score.away.plus1': score('away', 1),
      'score.away.plus2': score('away', 2),
      'score.away.plus3': score('away', 3),
      'score.away.minus1': score('away', -1),

      'foul.home.plus': foul('home', 1),
      'foul.home.minus': foul('home', -1),
      'foul.away.plus': foul('away', 1),
      'foul.away.minus': foul('away', -1),

      'timeout.home.use': timeout('home', -1),
      'timeout.home.restore': timeout('home', 1),
      'timeout.away.use': timeout('away', -1),
      'timeout.away.restore': timeout('away', 1),

      'period.plus': () => dispatch({ type: 'PERIOD_ADJUST', delta: 1 }),
      'period.minus': () => dispatch({ type: 'PERIOD_ADJUST', delta: -1 }),
      'period.next': () => {
        if (confirm('Start the next period? Team fouls reset and both clocks return to full.')) {
          dispatch({ type: 'NEXT_PERIOD' });
        }
      },

      'possession.toggle': () => dispatch({ type: 'POSSESSION_TOGGLE' }),
      'possession.home': () => dispatch({ type: 'POSSESSION_SET', side: 'home' }),
      'possession.away': () => dispatch({ type: 'POSSESSION_SET', side: 'away' }),

      'teamNames.edit': () => setEditingNames(true),
      'match.finish': () => void handleFinish(),
      'game.new': () => {
        if (
          board &&
          confirm(
            'Start a new game without saving history? Score, fouls and clocks will all be cleared and this game will NOT appear in match history. Use "Finish match" instead if you want to keep a record of it.',
          )
        ) {
          dispatch({ type: 'NEW_GAME', config: board.config });
        }
      },
    };
  }, [dispatch, state, board, handleFinish]);

  // Keyboard shortcuts, resolved through the operator's keymap rather than a
  // fixed switch. Suppressed while a text field has focus, while the shortcut
  // editor is capturing a key, and while the guided tour is open — the tour
  // steps through with the arrow keys, which are also this page's default score
  // shortcuts, so leaving both live would quietly add points to a game while
  // explaining how to add points to a game.
  useEffect(() => {
    if (readOnly || !state || tourRunning || editingShortcuts) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      const command = commandForKey(keymap, event.code, event.shiftKey);
      if (!command) return;

      commands[command]();
      event.preventDefault();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [commands, keymap, readOnly, state, tourRunning, editingShortcuts]);

  if (!boardId) return <Alert kind="error">No board specified.</Alert>;
  if (board === undefined || (!loaded && !error)) return <Spinner label="Opening board…" />;
  if (error)
    return (
      <AppShell tenantName="">
        <Alert kind="error">{error}</Alert>
      </AppShell>
    );
  if (board === null) {
    return (
      <AppShell tenantName="">
        <Alert kind="error">That board no longer exists.</Alert>
        <Link className="btn" to="/app">
          Back to dashboard
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell tenantName={board.name}>
      <div className="page-head">
        <div>
          <h1>{board.name}</h1>
          <p>Control panel</p>
        </div>
        <div className="page-head__actions">
          <a
            className="btn"
            href={buildScoreboardUrl(window.location.origin, boardId)}
            target="_blank"
            rel="noopener"
          >
            Open scoreboard
            <IconExternalLink size={13} />
          </a>
          <Link className="btn" to="/app">
            Dashboard
          </Link>
        </div>
      </div>

      {readOnly ? (
        <Alert kind="warn">
          You have read-only access to this board. Ask an admin for the operator role to make
          changes.
        </Alert>
      ) : null}

      {dispatchError ? (
        <div onClick={clearError} role="presentation">
          <Alert kind="error">{dispatchError}</Alert>
        </div>
      ) : null}

      {finishError ? (
        <div onClick={() => setFinishError(null)} role="presentation">
          <Alert kind="error">{finishError}</Alert>
        </div>
      ) : null}

      {!state ? (
        <Alert kind="error">This board has no game state yet.</Alert>
      ) : (
        <div className="control-layout">
          <div className="control-board">
            <TeamPanel
              side="home"
              state={state}
              disabled={readOnly}
              onAction={dispatch}
              onRename={() => setEditingNames(true)}
            />

            <ClockConsole
              state={state}
              now={now}
              disabled={readOnly}
              onAction={dispatch}
              onEditTime={() => setEditingTime(true)}
            />

            <TeamPanel
              side="away"
              state={state}
              disabled={readOnly}
              onAction={dispatch}
              onRename={() => setEditingNames(true)}
            />
          </div>

          <aside className="stack" data-tour="game-actions">
            <GameActions
              state={state}
              boardConfig={board.config}
              disabled={readOnly}
              onAction={dispatch}
              onFinish={() => void handleFinish()}
              finishing={finishing}
            />
            {LOGO_UPLOAD_ENABLED && canManageBoards(session.role) ? (
              <LogoCard
                board={board}
                tenantId={session.tenantId}
                state={state}
                onAction={dispatch}
              />
            ) : null}
            {canManageBoards(session.role) ? (
              <ClockScreensCard tenantId={session.tenantId} boardId={boardId} />
            ) : null}
            <ShortcutCard keymap={keymap} onCustomise={() => setEditingShortcuts(true)} />
          </aside>
        </div>
      )}

      {editingTime && state ? (
        <SetTimeModal
          state={state}
          now={now}
          onClose={() => setEditingTime(false)}
          onApply={(remainingMs) => {
            dispatch({ type: 'GAME_CLOCK_SET', remainingMs });
            setEditingTime(false);
          }}
        />
      ) : null}

      {editingNames && state ? (
        <TeamNamesModal
          state={state}
          onClose={() => setEditingNames(false)}
          onApply={(home, away) => {
            dispatch({ type: 'TEAM_NAME_SET', side: 'home', name: home });
            dispatch({ type: 'TEAM_NAME_SET', side: 'away', name: away });
            setEditingNames(false);
          }}
        />
      ) : null}

      {editingShortcuts ? (
        <ShortcutEditor
          keymap={keymap}
          onChange={changeKeymap}
          onReset={resetKeymap}
          onClose={() => setEditingShortcuts(false)}
        />
      ) : null}

      {finishResult ? (
        <Modal
          title="Match finished"
          onClose={() => navigate('/app')}
          footer={
            <>
              <button type="button" className="btn" onClick={() => navigate('/app/history')}>
                View history
              </button>
              <button type="button" className="btn btn--primary" onClick={() => navigate('/app')}>
                Back to dashboard
              </button>
            </>
          }
        >
          <p className="match-result match-result__score">
            {finishResult.homeTeamName} {finishResult.homeScore} – {finishResult.awayScore}{' '}
            {finishResult.awayTeamName}
          </p>
          <p className="muted match-result">
            Saved to match history. This board is ready for the next game.
          </p>
        </Modal>
      ) : null}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

type Dispatch = ReturnType<typeof useDispatch>['dispatch'];

function TeamPanel({
  side,
  state,
  disabled,
  onAction,
  onRename,
}: {
  side: Side;
  state: BoardState;
  disabled: boolean;
  onAction: Dispatch;
  onRename: () => void;
}) {
  const team = state[side];
  const bonus = isInBonus(state, side);

  return (
    <div className="team-panel">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onRename}
        disabled={disabled}
      >
        <span className="team-panel__name">{team.name}</span>
      </button>

      <div className="team-panel__score">{String(team.score).padStart(2, '0')}</div>

      <div className="score-buttons">
        {[1, 2, 3].map((points) => (
          <button
            key={points}
            type="button"
            className="btn btn--primary"
            disabled={disabled || team.score >= LIMITS.score.max}
            onClick={() => onAction({ type: 'SCORE_ADJUST', side, delta: points })}
          >
            +{points}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--block btn--sm"
        disabled={disabled || team.score <= 0}
        onClick={() => onAction({ type: 'SCORE_ADJUST', side, delta: -1 })}
      >
        Correct −1
      </button>

      <div className="stat-row">
        <span className="stat-row__label">Fouls{bonus ? ' · bonus' : ''}</span>
        <button
          type="button"
          className="btn"
          disabled={disabled || team.fouls <= 0}
          onClick={() => onAction({ type: 'FOUL_ADJUST', side, delta: -1 })}
          aria-label={`Decrease ${side} fouls`}
        >
          −
        </button>
        <span className={`stat-row__value${bonus ? ' stat-row__value--bonus' : ''}`}>
          {team.fouls}
        </span>
        <button
          type="button"
          className="btn"
          disabled={disabled || team.fouls >= LIMITS.fouls.max}
          onClick={() => onAction({ type: 'FOUL_ADJUST', side, delta: 1 })}
          aria-label={`Increase ${side} fouls`}
        >
          +
        </button>
      </div>

      <div className="stat-row">
        <span className="stat-row__label">Timeouts</span>
        <button
          type="button"
          className="btn"
          disabled={disabled || team.timeouts <= 0}
          onClick={() => onAction({ type: 'TIMEOUT_ADJUST', side, delta: -1 })}
          aria-label={`Use ${side} timeout`}
        >
          −
        </button>
        <span className="stat-row__value">{team.timeouts}</span>
        <button
          type="button"
          className="btn"
          disabled={disabled || team.timeouts >= LIMITS.timeouts.max}
          onClick={() => onAction({ type: 'TIMEOUT_ADJUST', side, delta: 1 })}
          aria-label={`Restore ${side} timeout`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function ClockConsole({
  state,
  now,
  disabled,
  onAction,
  onEditTime,
}: {
  state: BoardState;
  now: number;
  disabled: boolean;
  onAction: Dispatch;
  onEditTime: () => void;
}) {
  const gameRemaining = remainingAt(state.gameClock, now);
  const shotRemaining = remainingAt(state.shotClock, now);
  const showTenths = state.config.showTenthsUnderOneMinute;

  return (
    <div className="clock-console">
      <div className="clock-console__label">Game time</div>
      <div
        className={`clock-console__game${state.gameClock.running ? ' clock-console__game--live' : ''}`}
      >
        {formatGameClock(gameRemaining, showTenths)}
      </div>

      <div className="button-grid">
        <button
          type="button"
          className={state.gameClock.running ? 'btn btn--danger' : 'btn btn--primary'}
          disabled={disabled}
          onClick={() => onAction({ type: 'GAME_CLOCK_TOGGLE' })}
        >
          {state.gameClock.running ? 'Stop' : 'Start'}
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={onEditTime}>
          Set time
        </button>
      </div>

      <div className="clock-console__label">Shot clock</div>
      <div className="clock-console__shot">{formatShotClock(shotRemaining, showTenths)}</div>

      <div className="button-grid">
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => onAction({ type: 'SHOT_CLOCK_TOGGLE' })}
        >
          {state.shotClock.running ? 'Stop' : 'Start'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => onAction({ type: 'SHOT_CLOCK_RESET' })}
        >
          {Math.round(state.config.shotClockMs / 1000)}s
        </button>
      </div>
      <button
        type="button"
        className="btn btn--block btn--sm"
        disabled={disabled}
        onClick={() =>
          onAction({ type: 'SHOT_CLOCK_RESET', remainingMs: state.config.shotClockResetMs })
        }
      >
        Reset to {Math.round(state.config.shotClockResetMs / 1000)}s (offensive rebound)
      </button>

      <div className="clock-console__label clock-console__label--spaced">Period</div>
      <div className="clock-console__period">Q{state.period}</div>
      <div className="button-grid">
        <button
          type="button"
          className="btn"
          disabled={disabled || state.period <= LIMITS.period.min}
          onClick={() => onAction({ type: 'PERIOD_ADJUST', delta: -1 })}
          aria-label="Decrease period"
        >
          −
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || state.period >= LIMITS.period.max}
          onClick={() => onAction({ type: 'PERIOD_ADJUST', delta: 1 })}
          aria-label="Increase period"
        >
          +
        </button>
      </div>

      <div className="clock-console__label clock-console__label--spaced">Possession</div>
      <div className="possession-toggle">
        {(['home', 'away'] as Side[]).map((side) => (
          <button
            key={side}
            type="button"
            className={`btn${state.possession === side ? ' btn--active' : ''}`}
            disabled={disabled}
            onClick={() => onAction({ type: 'POSSESSION_SET', side })}
          >
            {side === 'home' ? '◀ Home' : 'Away ▶'}
          </button>
        ))}
      </div>
    </div>
  );
}

function GameActions({
  state,
  boardConfig,
  disabled,
  onAction,
  onFinish,
  finishing,
}: {
  state: BoardState;
  /**
   * The board's *current* settings, straight from its Firestore document.
   *
   * Live state carries its own copy of the config, snapshotted when the board
   * was created, and nothing refreshes it in place. Handing the fresh document
   * to NEW_GAME is what makes an edit in Board settings actually take effect —
   * without it, the settings page's promise that changes "apply the next time
   * this board starts a new game" is never kept.
   */
  boardConfig: BoardConfig;
  disabled: boolean;
  onAction: Dispatch;
  onFinish: () => void;
  finishing: boolean;
}) {
  return (
    <div className="card stack">
      <h3>Game</h3>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={disabled || finishing}
        onClick={onFinish}
      >
        {finishing ? 'Finishing…' : 'Finish match'}
      </button>
      <button
        type="button"
        className="btn btn--block"
        disabled={disabled || state.period >= LIMITS.period.max}
        onClick={() => {
          if (confirm('Start the next period? Team fouls reset and both clocks return to full.')) {
            onAction({ type: 'NEXT_PERIOD' });
          }
        }}
      >
        Start next period
      </button>
      <button
        type="button"
        className="btn btn--block"
        disabled={disabled}
        onClick={() => onAction({ type: 'GAME_CLOCK_RESET' })}
      >
        Reset game clock
      </button>
      <button
        type="button"
        className="btn btn--danger btn--block"
        disabled={disabled}
        onClick={() => {
          if (
            confirm(
              'Start a new game without saving history? Score, fouls and clocks will all be cleared and this game will NOT appear in match history. Use "Finish match" instead if you want to keep a record of it.',
            )
          ) {
            onAction({ type: 'NEW_GAME', config: boardConfig });
          }
        }}
      >
        New game (discard, no history)
      </button>
    </div>
  );
}

/**
 * Uploads the board's tournament logo — shown on the scoreboard, mirror, and
 * overlay in place of a default. Persists to the board's Firestore doc
 * (`theme.logoUrl`, picked up by the next game this board starts) and
 * dispatches `LOGO_URL_SET` so the change is visible on the game in progress
 * right now, without waiting for a restart.
 */
function LogoCard({
  board,
  tenantId,
  state,
  onAction,
}: {
  board: Board;
  tenantId: string;
  state: BoardState;
  onAction: Dispatch;
}) {
  const firestore = getFirestoreClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(picked: File | null) {
    const reason = picked ? validateLogoFile(picked) : null;
    setError(reason);
    setFile(reason ? null : picked);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const storage = await ensureStorageClient();
      const logoUrl = await uploadBoardLogo(storage, tenantId, board.id, file);
      await updateBoard(firestore, tenantId, board.id, { theme: { ...board.theme, logoUrl } });
      onAction({ type: 'LOGO_URL_SET', logoUrl });
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload that logo.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Remove the tournament logo from this board?')) return;
    setBusy(true);
    setError(null);
    try {
      const storage = await ensureStorageClient();
      await removeBoardLogo(storage, tenantId, board.id);
      await updateBoard(firestore, tenantId, board.id, {
        theme: { ...board.theme, logoUrl: null },
      });
      onAction({ type: 'LOGO_URL_SET', logoUrl: null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove that logo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h3>Tournament logo</h3>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {state.logoUrl ? (
        <img src={state.logoUrl} alt="Current tournament logo" className="logo-card__preview" />
      ) : (
        <p className="muted">
          No logo set. Shown on the scoreboard, mirror, and overlay once uploaded.
        </p>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
      />
      <div className="row">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!file || busy}
          onClick={() => void upload()}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        {state.logoUrl ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Share links for the two single-clock displays: `/gameclock/:id` and
 * `/shotclock/:id`, the game time or the shot clock alone, full screen.
 *
 * They live here rather than only in board settings because that is where they
 * get used — an operator setting up a venue's second monitor or shot-clock
 * panel is already on this page, mid-setup, and the alternative is a detour
 * through Settings for a URL they need on another device right now.
 *
 * Admins and owners only: both links carry the board's mirror key, and
 * `firestore.rules` restricts the viewer-key document to those two roles, so an
 * operator would sit on a permanent "Loading…" instead of a link.
 */
function ClockScreensCard({ tenantId, boardId }: { tenantId: string; boardId: string }) {
  const firestore = getFirestoreClient();
  const [keys, setKeys] = useState<ViewerKeys>({ overlayKey: null, mirrorKey: null });
  const origin = window.location.origin;

  useEffect(
    () => subscribeViewerKeys(firestore, tenantId, boardId, setKeys),
    [firestore, tenantId, boardId],
  );

  const screens = keys.mirrorKey
    ? [
        {
          slug: 'gameclock',
          name: 'game clock',
          hint: 'Game clock — the game time alone, for a second monitor.',
          url: buildGameClockUrl(origin, boardId, keys.mirrorKey),
        },
        {
          slug: 'shotclock',
          name: 'shot clock',
          hint: 'Shot clock — the shot clock alone, for a pole or wall panel.',
          url: buildShotClockUrl(origin, boardId, keys.mirrorKey),
        },
      ]
    : [];

  return (
    <div className="card stack">
      <h3 className="shortcut-card__title">Clock screens</h3>
      {screens.length === 0 ? (
        <span className="muted">Loading…</span>
      ) : (
        screens.map(({ slug, name, hint, url }) => (
          <div key={slug}>
            <div className="field__hint board-card__hint">{hint}</div>
            <CopyField label={`${slug}-${boardId}`} value={url} />
            <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noopener">
              Open {name}
              <IconExternalLink size={13} />
            </a>
          </div>
        ))
      )}
      <div className="field__hint">
        Read-only, and no sign-in needed. Both use this board&rsquo;s mirror key — rotating the
        mirror link in Settings revokes these too.
      </div>
    </div>
  );
}

/**
 * The live shortcut reference.
 *
 * Rendered from the operator's actual keymap rather than a hand-written list,
 * which is the point of the exercise: a card that still advertised `↑` after
 * someone moved scoring elsewhere would be worse than no card at all. Only
 * bound commands appear — the unbound ones are in the editor, where they can be
 * given a key.
 */
function ShortcutCard({ keymap, onCustomise }: { keymap: Keymap; onCustomise: () => void }) {
  const bound = COMMANDS.filter((command) => keymap[command.id]);

  return (
    <div className="card" data-tour="shortcuts">
      <h3 className="shortcut-card__title">Keyboard</h3>
      {bound.length === 0 ? (
        <p className="field__hint">No shortcuts are set.</p>
      ) : (
        <ul className="shortcut-list">
          {bound.map((command) => (
            <li key={command.id}>
              <kbd>{formatBinding(keymap[command.id])}</kbd>
              <span>{command.label}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--sm shortcut-card__edit" onClick={onCustomise}>
        Customise shortcuts
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SetTimeModal({
  state,
  now,
  onClose,
  onApply,
}: {
  state: BoardState;
  now: number;
  onClose: () => void;
  onApply: (remainingMs: number) => void;
}) {
  const initial = useMemo(() => remainingAt(state.gameClock, now), [state.gameClock, now]);
  const [minutes, setMinutes] = useState(Math.floor(initial / 60_000));
  const [seconds, setSeconds] = useState(Math.floor((initial % 60_000) / 1_000));

  return (
    <Modal
      title="Set game time"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onApply(minutes * 60_000 + seconds * 1_000)}
          >
            Set time
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Minutes">
          <input
            type="number"
            min={0}
            max={99}
            value={minutes}
            onChange={(event) => setMinutes(Math.max(0, Math.min(99, Number(event.target.value))))}
            autoFocus
          />
        </Field>
        <Field label="Seconds">
          <input
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(event) => setSeconds(Math.max(0, Math.min(59, Number(event.target.value))))}
          />
        </Field>
      </div>
      <p className="field__hint">
        The clock keeps its running state — setting the time on a live clock does not stop it.
      </p>
    </Modal>
  );
}

function TeamNamesModal({
  state,
  onClose,
  onApply,
}: {
  state: BoardState;
  onClose: () => void;
  onApply: (home: string, away: string) => void;
}) {
  const [home, setHome] = useState(state.home.name);
  const [away, setAway] = useState(state.away.name);

  return (
    <Modal
      title="Team names"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onApply(home, away)}>
            Save names
          </button>
        </>
      }
    >
      <Field label="Home" hint={`Up to ${LIMITS.teamName.maxLength} characters.`}>
        <input
          type="text"
          value={home}
          onChange={(event) => setHome(event.target.value)}
          maxLength={LIMITS.teamName.maxLength}
          autoFocus
        />
      </Field>
      <Field label="Away">
        <input
          type="text"
          value={away}
          onChange={(event) => setAway(event.target.value)}
          maxLength={LIMITS.teamName.maxLength}
        />
      </Field>
    </Modal>
  );
}
