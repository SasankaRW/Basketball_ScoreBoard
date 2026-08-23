/**
 * The play-by-play behind a match.
 *
 * `buildMatchRecord` (matchRecord.ts) answers "what was the result"; this
 * answers "how did it get there" — every basket, foul, timeout and period
 * change, in order, with the score as it stood at that moment.
 *
 * Pure and I/O-free like the rest of `core/`: `describeEvent` is a function of
 * an action and the state that action produced, nothing else. That is what
 * makes "which actions are worth recording" one tested decision in one place
 * rather than a condition scattered across the surfaces that dispatch them.
 */
import { remainingAt } from './clock.js';
import type { Action } from './reducer.js';
import type { BoardState, Side } from './schema.js';

export type TimelineEventType = 'score' | 'foul' | 'timeout' | 'period';

export interface TimelineEvent {
  /** Server-corrected time, from the dispatching `ActionContext`. */
  ts: number;
  period: number;
  /** Game clock remaining when it happened — the "when" a box score cares about. */
  clockMs: number;
  type: TimelineEventType;
  /** Null for whole-game events such as a period change. */
  side: Side | null;
  /** Points scored, ±1 foul, or ∓1 timeout. Zero for a period change. */
  delta: number;
  /** Running score *after* the event — what turns a list into a narrative. */
  home: number;
  away: number;
  /** UID of whoever dispatched it, matching `BoardState.updatedBy`. */
  actor: string;
}

/** Keeps a runaway game from writing an unbounded document. */
export const MAX_TIMELINE_EVENTS = 500;

/**
 * Describes one action for the timeline, or returns null if it does not belong
 * there.
 *
 * Clock starts and stops are deliberately excluded: they fire on every whistle,
 * and a timeline where four fifths of the rows are "clock stopped" buries the
 * basket someone opened it to find. Possession, config and SETTLE are excluded
 * for the same reason — they describe bookkeeping, not play.
 *
 * `after` is the state the action produced, so the running score is already
 * correct without the caller diffing anything.
 */
export function describeEvent(
  action: Action,
  after: BoardState,
  ctx: { now: number; actor: string },
): TimelineEvent | null {
  const base = {
    ts: ctx.now,
    period: after.period,
    // `remainingAt`, never `gameClock.remainingMs` directly. The clock stores a
    // deadline, not a countdown (see clock.ts): while it runs, `remainingMs`
    // holds whatever it read at the moment it was *started* and does not move
    // again until the clock is paused. Reading it raw stamped every event of a
    // running period with the full period length — a timeline where twenty
    // baskets all happened at 10:00.
    clockMs: remainingAt(after.gameClock, ctx.now),
    home: after.home.score,
    away: after.away.score,
    actor: ctx.actor,
  };

  switch (action.type) {
    case 'SCORE_ADJUST':
      return { ...base, type: 'score', side: action.side, delta: action.delta };

    case 'FOUL_ADJUST':
      return { ...base, type: 'foul', side: action.side, delta: action.delta };

    case 'TIMEOUT_ADJUST':
      // Stored as it was dispatched: -1 is a timeout *taken* (one fewer left),
      // +1 an operator handing one back after a miscount. The UI reads the sign
      // rather than this module second-guessing which the operator meant.
      return { ...base, type: 'timeout', side: action.side, delta: action.delta };

    case 'NEXT_PERIOD':
      return { ...base, type: 'period', side: null, delta: 0 };

    // The control panel's period +/- pair, and the scoreboard's Q shortcut.
    // Logged alongside NEXT_PERIOD because both move the game between periods,
    // and a timeline grouped by period would silently misplace events if only
    // one of the two were recorded.
    case 'PERIOD_ADJUST':
      return { ...base, type: 'period', side: null, delta: action.delta };

    /**
     * Everything else is bookkeeping, a clock adjustment, or a whole-board
     * reset — none of which describe play.
     *
     * That deliberately includes the `*_SET` variants: a timeline entry needs a
     * delta, and a SET carries only a final value, so describing one would mean
     * taking the prior state as an argument purely for actions no surface
     * currently dispatches. If a UI ever starts dispatching them, this is the
     * place that has to grow that argument rather than guess.
     */
    default:
      return null;
  }
}
