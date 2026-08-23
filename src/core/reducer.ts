/**
 * The board state machine — one pure function behind every mutation.
 *
 * The original app implemented each rule twice: once in the keyboard handler
 * (`adjustScore`, `adjustFouls`, `adjustTimeouts` in script.js) and again in the
 * control panel's `applyControlPanelChanges`, with the clamp bounds copy-pasted
 * between them. Here the keyboard handler, the React control panel, the Cloud
 * Functions, and the tests all call `applyAction`, so the rules cannot diverge.
 *
 * Two properties the rest of the system depends on:
 *
 *   1. **Purity.** No I/O, no `Date.now()`, no DOM. `now` and `actor` arrive via
 *      `ActionContext`. This is what lets `runTransaction` re-run the reducer on
 *      a fresh snapshot when two operators write at once, and what lets the unit
 *      suite exercise thousands of action sequences in milliseconds.
 *
 *   2. **Reference stability.** An action that changes nothing returns the very
 *      same object. Callers check `next !== prev` to skip a database write
 *      entirely, which is why holding a key down does not flood the network.
 */
import * as clock from './clock.js';
import {
  BoardConfigSchema,
  clamp,
  createInitialState,
  LIMITS,
  otherSide,
  type BoardConfig,
  type BoardState,
  type Side,
  type TeamState,
} from './schema.js';

export type Action =
  // Scoring
  | { type: 'SCORE_ADJUST'; side: Side; delta: number }
  | { type: 'SCORE_SET'; side: Side; value: number }
  // Fouls
  | { type: 'FOUL_ADJUST'; side: Side; delta: number }
  | { type: 'FOUL_SET'; side: Side; value: number }
  // Timeouts
  | { type: 'TIMEOUT_ADJUST'; side: Side; delta: number }
  | { type: 'TIMEOUT_SET'; side: Side; value: number }
  // Identity
  | { type: 'TEAM_NAME_SET'; side: Side; name: string }
  | { type: 'LOGO_URL_SET'; logoUrl: string | null }
  // Period
  | { type: 'PERIOD_ADJUST'; delta: number }
  | { type: 'PERIOD_SET'; value: number }
  | { type: 'NEXT_PERIOD' }
  // Possession
  | { type: 'POSSESSION_SET'; side: Side }
  | { type: 'POSSESSION_TOGGLE' }
  // Game clock
  | { type: 'GAME_CLOCK_START' }
  | { type: 'GAME_CLOCK_PAUSE' }
  | { type: 'GAME_CLOCK_TOGGLE' }
  | { type: 'GAME_CLOCK_SET'; remainingMs: number }
  | { type: 'GAME_CLOCK_RESET' }
  // Shot clock
  | { type: 'SHOT_CLOCK_START' }
  | { type: 'SHOT_CLOCK_PAUSE' }
  | { type: 'SHOT_CLOCK_TOGGLE' }
  | { type: 'SHOT_CLOCK_SET'; remainingMs: number }
  | { type: 'SHOT_CLOCK_RESET'; remainingMs?: number }
  // Whole-board
  | { type: 'CONFIG_SET'; patch: Partial<BoardConfig> }
  | { type: 'NEW_GAME'; config?: BoardConfig }
  | { type: 'SETTLE' };

export type ActionType = Action['type'];

export interface ActionContext {
  /** Server-corrected wall clock in milliseconds. Never `Date.now()` directly. */
  now: number;
  /** UID of the operator, or a machine role such as `system`. */
  actor: string;
}

/** Actions a read-only surface (mirror, overlay) must never be able to dispatch. */
export const MUTATING_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'SCORE_ADJUST',
  'SCORE_SET',
  'FOUL_ADJUST',
  'FOUL_SET',
  'TIMEOUT_ADJUST',
  'TIMEOUT_SET',
  'TEAM_NAME_SET',
  'LOGO_URL_SET',
  'PERIOD_ADJUST',
  'PERIOD_SET',
  'NEXT_PERIOD',
  'POSSESSION_SET',
  'POSSESSION_TOGGLE',
  'GAME_CLOCK_START',
  'GAME_CLOCK_PAUSE',
  'GAME_CLOCK_TOGGLE',
  'GAME_CLOCK_SET',
  'GAME_CLOCK_RESET',
  'SHOT_CLOCK_START',
  'SHOT_CLOCK_PAUSE',
  'SHOT_CLOCK_TOGGLE',
  'SHOT_CLOCK_SET',
  'SHOT_CLOCK_RESET',
  'CONFIG_SET',
  'NEW_GAME',
  'SETTLE',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Stamps provenance and advances the optimistic-concurrency counter. */
function commit(base: BoardState, next: BoardState, ctx: ActionContext): BoardState {
  return {
    ...next,
    rev: base.rev + 1,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  };
}

function teamsEqual(a: TeamState, b: TeamState): boolean {
  return (
    a.name === b.name && a.score === b.score && a.fouls === b.fouls && a.timeouts === b.timeouts
  );
}

/** Returns `null` when the patch is a no-op, so the caller can skip committing. */
function patchTeam(state: BoardState, side: Side, patch: Partial<TeamState>): BoardState | null {
  const current = state[side];
  const merged: TeamState = { ...current, ...patch };
  if (teamsEqual(current, merged)) return null;
  return side === 'home' ? { ...state, home: merged } : { ...state, away: merged };
}

function normaliseName(raw: string, fallback: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const name = trimmed === '' ? fallback : trimmed;
  return name.slice(0, LIMITS.teamName.maxLength);
}

function withGameClock(state: BoardState, next: clock.Clock): BoardState | null {
  return next === state.gameClock ? null : { ...state, gameClock: next };
}

function withShotClock(state: BoardState, next: clock.Clock): BoardState | null {
  return next === state.shotClock ? null : { ...state, shotClock: next };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Applies one action. Returns the same reference when nothing changed.
 *
 * Out-of-range inputs are clamped rather than rejected — an operator holding the
 * `+` key at 999 points should see the score sit still, not see an error dialog
 * mid-game.
 */
export function applyAction(state: BoardState, action: Action, ctx: ActionContext): BoardState {
  const next = compute(state, action, ctx);
  if (next === null || next === state) return state;
  return commit(state, next, ctx);
}

/** Folds a sequence of actions. Used by tests and by the concurrency harness. */
export function applyActions(
  state: BoardState,
  actions: readonly Action[],
  ctx: ActionContext,
): BoardState {
  return actions.reduce((acc, action) => applyAction(acc, action, ctx), state);
}

function compute(state: BoardState, action: Action, ctx: ActionContext): BoardState | null {
  const { now } = ctx;

  switch (action.type) {
    // -- Scoring ------------------------------------------------------------
    case 'SCORE_ADJUST':
      return patchTeam(state, action.side, {
        score: clamp(state[action.side].score + action.delta, LIMITS.score.min, LIMITS.score.max),
      });

    case 'SCORE_SET':
      return patchTeam(state, action.side, {
        score: clamp(action.value, LIMITS.score.min, LIMITS.score.max),
      });

    // -- Fouls --------------------------------------------------------------
    case 'FOUL_ADJUST':
      return patchTeam(state, action.side, {
        fouls: clamp(state[action.side].fouls + action.delta, LIMITS.fouls.min, LIMITS.fouls.max),
      });

    case 'FOUL_SET':
      return patchTeam(state, action.side, {
        fouls: clamp(action.value, LIMITS.fouls.min, LIMITS.fouls.max),
      });

    // -- Timeouts -----------------------------------------------------------
    case 'TIMEOUT_ADJUST':
      return patchTeam(state, action.side, {
        timeouts: clamp(
          state[action.side].timeouts + action.delta,
          LIMITS.timeouts.min,
          LIMITS.timeouts.max,
        ),
      });

    case 'TIMEOUT_SET':
      return patchTeam(state, action.side, {
        timeouts: clamp(action.value, LIMITS.timeouts.min, LIMITS.timeouts.max),
      });

    // -- Identity -----------------------------------------------------------
    case 'TEAM_NAME_SET': {
      const fallback =
        action.side === 'home' ? state.config.homeTeamName : state.config.awayTeamName;
      return patchTeam(state, action.side, { name: normaliseName(action.name, fallback) });
    }

    case 'LOGO_URL_SET':
      return action.logoUrl === state.logoUrl ? null : { ...state, logoUrl: action.logoUrl };

    // -- Period -------------------------------------------------------------
    case 'PERIOD_ADJUST': {
      const period = clamp(state.period + action.delta, LIMITS.period.min, LIMITS.period.max);
      return period === state.period ? null : { ...state, period };
    }

    case 'PERIOD_SET': {
      const period = clamp(action.value, LIMITS.period.min, LIMITS.period.max);
      return period === state.period ? null : { ...state, period };
    }

    /**
     * Advances to the next period the way the rulebook does: team fouls reset,
     * both clocks return to full and paused. Kept separate from PERIOD_ADJUST so
     * the bare `Q` shortcut retains its original nudge-only behaviour.
     */
    case 'NEXT_PERIOD': {
      const period = clamp(state.period + 1, LIMITS.period.min, LIMITS.period.max);
      return {
        ...state,
        period,
        // Cumulative score at the moment the period being LEFT ended — the raw
        // material `buildMatchRecord` (matchRecord.ts) later diffs into the
        // per-period point deltas a box score shows.
        periodScores: {
          ...state.periodScores,
          [String(state.period)]: { home: state.home.score, away: state.away.score },
        },
        home: { ...state.home, fouls: 0 },
        away: { ...state.away, fouls: 0 },
        gameClock: clock.createClock(state.config.periodLengthMs),
        shotClock: clock.createClock(state.config.shotClockMs),
      };
    }

    // -- Possession ---------------------------------------------------------
    case 'POSSESSION_SET':
      return action.side === state.possession ? null : { ...state, possession: action.side };

    case 'POSSESSION_TOGGLE':
      return { ...state, possession: otherSide(state.possession) };

    // -- Game clock ---------------------------------------------------------
    case 'GAME_CLOCK_START':
      return withGameClock(state, clock.startClock(state.gameClock, now));

    case 'GAME_CLOCK_PAUSE':
      return withGameClock(state, clock.pauseClock(state.gameClock, now));

    case 'GAME_CLOCK_TOGGLE':
      return withGameClock(state, clock.toggleClock(state.gameClock, now));

    case 'GAME_CLOCK_SET':
      return withGameClock(
        state,
        clock.setRemaining(
          state.gameClock,
          clamp(action.remainingMs, LIMITS.gameClockMs.min, LIMITS.gameClockMs.max),
          now,
        ),
      );

    case 'GAME_CLOCK_RESET':
      return withGameClock(state, clock.createClock(state.config.periodLengthMs));

    // -- Shot clock ---------------------------------------------------------
    case 'SHOT_CLOCK_START':
      return withShotClock(state, clock.startClock(state.shotClock, now));

    case 'SHOT_CLOCK_PAUSE':
      return withShotClock(state, clock.pauseClock(state.shotClock, now));

    case 'SHOT_CLOCK_TOGGLE':
      return withShotClock(state, clock.toggleClock(state.shotClock, now));

    case 'SHOT_CLOCK_SET':
      return withShotClock(
        state,
        clock.setRemaining(
          state.shotClock,
          clamp(action.remainingMs, LIMITS.shotClockMs.min, LIMITS.shotClockMs.max),
          now,
        ),
      );

    /**
     * Resets and — as the original did — immediately resumes if the game clock
     * is live, because play restarts the instant the ball is inbounded.
     */
    case 'SHOT_CLOCK_RESET': {
      const target = clamp(
        action.remainingMs ?? state.config.shotClockMs,
        LIMITS.shotClockMs.min,
        LIMITS.shotClockMs.max,
      );
      /**
       * A reset keeps the shot clock running if it already was.
       *
       * Resets happen *during* live play — an offensive rebound, a shot hitting
       * the rim — so stopping the clock to reset it means the operator has to
       * restart it by hand every time, and the seconds between the two are lost
       * off the possession. `setRemaining` preserves the running state; the
       * game-clock check then also resumes a *stopped* shot clock when play is
       * live, which is the ordinary courtside case of resetting just as the ball
       * is put back in play.
       */
      const reset = clock.setRemaining(state.shotClock, target, now);
      const resumed = state.gameClock.running ? clock.startClock(reset, now) : reset;
      return clock.clocksEqual(state.shotClock, resumed) ? null : { ...state, shotClock: resumed };
    }

    // -- Whole-board --------------------------------------------------------
    case 'CONFIG_SET': {
      const merged = { ...state.config, ...action.patch };
      const parsed = BoardConfigSchema.safeParse(merged);
      // An invalid patch is dropped rather than thrown: config edits arrive from
      // form inputs, and a half-typed number must not break a live game.
      if (!parsed.success) return null;
      const config = parsed.data;
      const unchanged = (Object.keys(config) as (keyof BoardConfig)[]).every(
        (key) => config[key] === state.config[key],
      );
      return unchanged ? null : { ...state, config };
    }

    /**
     * Fresh game on the same board, preserving configuration, `rev`, and the
     * board's tournament logo — a discard-and-restart is not a rebrand.
     */
    case 'NEW_GAME': {
      // A caller that has the board's Firestore document to hand passes its
      // config here, which is the only way a settings change ever reaches a
      // live board: the config inside live state is a snapshot taken when the
      // board was created, and nothing refreshes it on its own. Falls back to
      // the existing snapshot when omitted or unparseable — a malformed config
      // document must not be able to block starting a game.
      const parsed = action.config ? BoardConfigSchema.safeParse(action.config) : null;
      const config = parsed?.success ? parsed.data : state.config;
      const fresh = createInitialState(config, ctx.now, ctx.actor, null, state.logoUrl);
      return { ...fresh, rev: state.rev };
    }

    /**
     * Persists the end of a period. Without this, every viewer would independently
     * render 00:00 over a clock the database still believes is running; the
     * controlling surface dispatches SETTLE so all of them agree it has stopped.
     */
    case 'SETTLE': {
      const gameClock = clock.settleExpired(state.gameClock, now);
      const shotClock = clock.settleExpired(state.shotClock, now);
      if (gameClock === state.gameClock && shotClock === state.shotClock) return null;
      return { ...state, gameClock, shotClock };
    }

    default: {
      // Exhaustiveness guard: adding an action without handling it fails to compile.
      const unreachable: never = action;
      return unreachable;
    }
  }
}
