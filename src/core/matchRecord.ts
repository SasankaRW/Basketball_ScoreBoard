/**
 * Turns a finished game's live state into the permanent record match history
 * shows — the one place "what counts as a metric" is decided and tested, so
 * the Cloud Function that writes history (`functions/src/matches.ts`) and any
 * future caller compute it identically.
 *
 * Pure and I/O-free, like every other module under `core/`: no `Date.now()`,
 * no Firebase. `ctx.endedAt` and everything else this needs arrives as plain
 * arguments, which is what makes the exhaustive period-sequence tests in
 * `tests/unit/matchRecord.test.ts` possible without a database.
 */
import type { BoardState, PeriodScores } from './schema.js';

export interface PeriodPoints {
  period: number;
  /** Points scored in this period alone — not cumulative. */
  home: number;
  away: number;
}

export interface MatchRecord {
  boardId: string;
  boardName: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  homeFouls: number;
  awayFouls: number;
  homeTimeoutsUsed: number;
  awayTimeoutsUsed: number;
  periodsPlayed: number;
  periodScores: PeriodPoints[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Links back to the schedule entry this game started from, if any. */
  scheduleId: string | null;
}

export interface MatchRecordContext {
  boardId: string;
  boardName: string;
  /** Server-corrected time the match was finished. */
  endedAt: number;
}

/**
 * Diffs consecutive cumulative period snapshots into the per-period point
 * deltas a box score shows, closing out whatever period the game actually
 * ended in first if `NEXT_PERIOD` never fired for it — the ordinary case,
 * since nobody clicks "next period" after the final period ends.
 *
 * One accepted limitation: a score correction made *after* a period boundary
 * has already been snapshotted (e.g. fixing a miscounted Q1 basket once Q2 is
 * underway) skews that already-frozen period rather than the one the fix
 * conceptually belongs to. A fully correct fix would need a possession-by-
 * possession event ledger rather than periodic score snapshots; the final
 * total is always exactly right regardless, only the historical Q1-vs-Q2 split
 * could read slightly off in this specific case.
 */
export function buildMatchRecord(state: BoardState, ctx: MatchRecordContext): MatchRecord {
  const snapshots: PeriodScores = { ...state.periodScores };
  if (!(String(state.period) in snapshots)) {
    snapshots[String(state.period)] = { home: state.home.score, away: state.away.score };
  }

  const periods = Object.keys(snapshots)
    .map(Number)
    .sort((a, b) => a - b);

  const periodScores: PeriodPoints[] = periods.map((period, index) => {
    const previousPeriod = periods[index - 1];
    const previous =
      index === 0 || previousPeriod === undefined
        ? { home: 0, away: 0 }
        : snapshots[String(previousPeriod)];
    const current = snapshots[String(period)];
    return {
      period,
      home: (current?.home ?? 0) - (previous?.home ?? 0),
      away: (current?.away ?? 0) - (previous?.away ?? 0),
    };
  });

  return {
    boardId: ctx.boardId,
    boardName: ctx.boardName,
    homeTeamName: state.home.name,
    awayTeamName: state.away.name,
    homeScore: state.home.score,
    awayScore: state.away.score,
    homeFouls: state.home.fouls,
    awayFouls: state.away.fouls,
    // Read straight off the running tally rather than derived from what is
    // left. Timeouts refill at every half boundary, so `config.timeouts -
    // timeouts` describes only the half in progress and would report a team
    // that used two in each half as having used two.
    homeTimeoutsUsed: state.home.timeoutsUsed,
    awayTimeoutsUsed: state.away.timeoutsUsed,
    periodsPlayed: periods.length,
    periodScores,
    startedAt: state.matchStartedAt,
    endedAt: ctx.endedAt,
    durationMs: Math.max(0, ctx.endedAt - state.matchStartedAt),
    scheduleId: state.scheduleId,
  };
}
