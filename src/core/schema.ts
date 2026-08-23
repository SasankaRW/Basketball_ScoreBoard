/**
 * Board state schema — the single shared definition of what a live scoreboard is.
 *
 * This module is deliberately free of Firebase, React, and DOM imports. It is
 * consumed by the React control panel, the vanilla display pages, the Cloud
 * Functions, and the unit tests alike, so it must stay portable.
 *
 * The bounds declared in `LIMITS` are the one true source for clamping. They are
 * mirrored (by hand, and asserted by tests/rules) into `database.rules.json` so
 * that a hand-crafted request cannot write a value the UI would have rejected.
 */
import { z } from 'zod';

export type Side = 'home' | 'away';

export const SIDES: readonly Side[] = ['home', 'away'] as const;

/** The opposite side. Used by possession toggling and jump-ball logic. */
export function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

export const LIMITS = {
  score: { min: 0, max: 999 },
  fouls: { min: 0, max: 99 },
  timeouts: { min: 0, max: 99 },
  period: { min: 1, max: 10 },
  /** 99:59 — the widest value the two-digit minute display can render. */
  gameClockMs: { min: 0, max: 99 * 60_000 + 59_000 },
  /** 99s — the widest value the two-digit shot clock display can render. */
  shotClockMs: { min: 0, max: 99_000 },
  teamName: { minLength: 1, maxLength: 24 },
  periodCount: { min: 1, max: 10 },
  foulBonusAt: { min: 1, max: 99 },
} as const;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * A deadline-based clock.
 *
 * While running, the authority is `endsAt` — an absolute server-corrected
 * timestamp in milliseconds. Every viewer derives the displayed value from it,
 * so no two surfaces can drift apart and no per-second write is needed. While
 * paused, `endsAt` is null and `remainingMs` holds the frozen value.
 *
 * Invariant: `running === (endsAt !== null)`.
 */
export const ClockSchema = z.object({
  running: z.boolean(),
  endsAt: z.number().int().nonnegative().nullable(),
  remainingMs: z.number().int().nonnegative(),
});

export type Clock = z.infer<typeof ClockSchema>;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const TeamStateSchema = z.object({
  name: z.string().min(LIMITS.teamName.minLength).max(LIMITS.teamName.maxLength),
  score: z.number().int().min(LIMITS.score.min).max(LIMITS.score.max),
  fouls: z.number().int().min(LIMITS.fouls.min).max(LIMITS.fouls.max),
  /** Timeouts left **in the current half** — refilled at every half boundary. */
  timeouts: z.number().int().min(LIMITS.timeouts.min).max(LIMITS.timeouts.max),
  /**
   * Timeouts taken across the whole match, never reset by a half boundary.
   *
   * Exists because `timeouts` alone stopped being able to answer "how many did
   * they use": once it refills each half, the remaining count only describes
   * the half in progress, and `config.timeouts - timeouts` — which is how
   * `buildMatchRecord` used to derive it — silently forgets every timeout taken
   * before the break. Only `NEW_GAME` clears this.
   */
  timeoutsUsed: z.number().int().min(LIMITS.timeouts.min).max(LIMITS.timeouts.max),
});

export type TeamState = z.infer<typeof TeamStateSchema>;

// ---------------------------------------------------------------------------
// Period scores
// ---------------------------------------------------------------------------

/**
 * Cumulative score at the moment one period ended, keyed by period number as a
 * string (the Realtime Database's native representation of a sparse array —
 * see the comment on `BoardState.periodScores` for why this shape rather than
 * a JS array).
 */
export const PeriodSnapshotSchema = z.object({
  home: z.number().int().min(LIMITS.score.min).max(LIMITS.score.max),
  away: z.number().int().min(LIMITS.score.min).max(LIMITS.score.max),
});

export type PeriodSnapshot = z.infer<typeof PeriodSnapshotSchema>;

export const PeriodScoresSchema = z.record(z.string(), PeriodSnapshotSchema);

export type PeriodScores = z.infer<typeof PeriodScoresSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Per-board rules and defaults.
 *
 * Firestore (`/tenants/{tid}/boards/{bid}`) is the source of truth; this is a
 * snapshot carried inside the live state so that RESET_ALL / APPLY_DEFAULTS stay
 * pure reducer operations that work offline and need no second fetch.
 */
export const BoardConfigSchema = z.object({
  periodLengthMs: z.number().int().min(1_000).max(LIMITS.gameClockMs.max),
  shotClockMs: z.number().int().min(1_000).max(LIMITS.shotClockMs.max),
  /** Shorter reset after an offensive rebound (14s under FIBA/NBA rules). */
  shotClockResetMs: z.number().int().min(1_000).max(LIMITS.shotClockMs.max),
  /**
   * Timeouts each team gets **per half**, not per game.
   *
   * A half is two periods, so this many are granted at the start of the game
   * and again at every subsequent odd period (Q3, and each overtime). See
   * `startsNewHalf`.
   */
  timeouts: z.number().int().min(LIMITS.timeouts.min).max(LIMITS.timeouts.max),
  periodCount: z.number().int().min(LIMITS.periodCount.min).max(LIMITS.periodCount.max),
  startingPeriod: z.number().int().min(LIMITS.period.min).max(LIMITS.period.max),
  /** Team fouls at which the opponent enters the bonus. */
  foulBonusAt: z.number().int().min(LIMITS.foulBonusAt.min).max(LIMITS.foulBonusAt.max),
  homeTeamName: z.string().min(LIMITS.teamName.minLength).max(LIMITS.teamName.maxLength),
  awayTeamName: z.string().min(LIMITS.teamName.minLength).max(LIMITS.teamName.maxLength),
  /** Render tenths of a second under one minute. Off preserves the classic MM:SS look. */
  showTenthsUnderOneMinute: z.boolean(),
});

export type BoardConfig = z.infer<typeof BoardConfigSchema>;

/** Matches the values the original static scoreboard shipped with. */
export const DEFAULT_CONFIG: BoardConfig = {
  periodLengthMs: 10 * 60_000,
  shotClockMs: 24_000,
  shotClockResetMs: 14_000,
  timeouts: 2,
  periodCount: 4,
  startingPeriod: 1,
  foulBonusAt: 5,
  homeTeamName: 'HOME',
  awayTeamName: 'AWAY',
  showTenthsUnderOneMinute: false,
};

/**
 * Merges a raw Firestore board-config blob over the defaults and validates.
 *
 * A board created before a config field existed simply has no value for it;
 * merging over `DEFAULT_CONFIG` means an older board keeps working after a
 * deploy adds a new field, instead of failing validation and vanishing.
 * Falls back to the defaults entirely on anything unparseable, rather than
 * throwing — this runs in both the dashboard's live board list and
 * `startScheduledMatch` (functions/src/matches.ts), neither of which should
 * crash over one malformed config document.
 */
export function mergeBoardConfig(raw: unknown): BoardConfig {
  const merged = { ...DEFAULT_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  const parsed = BoardConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_CONFIG;
}

// ---------------------------------------------------------------------------
// Board state
// ---------------------------------------------------------------------------

export const BoardStateSchema = z.object({
  sport: z.literal('basketball'),
  period: z.number().int().min(LIMITS.period.min).max(LIMITS.period.max),
  possession: z.enum(['home', 'away']),
  home: TeamStateSchema,
  away: TeamStateSchema,
  gameClock: ClockSchema,
  shotClock: ClockSchema,
  config: BoardConfigSchema,
  /**
   * Optimistic-concurrency counter. Every mutation increments it by exactly one,
   * and the RTDB rules enforce that, so a stale writer is rejected by the
   * database rather than silently clobbering a concurrent operator.
   */
  rev: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** UID of the last writer, or a machine role. Feeds the audit log. */
  updatedBy: z.string().max(128),
  /**
   * The instant this game began — stamped fresh by every `NEW_GAME` /
   * `createInitialState`. A match's duration in the eventual history record is
   * `endedAt - matchStartedAt`, not derived from the game clock, because the
   * game clock only measures time the ball was live, not the real time spent
   * running the game (timeouts, between-period breaks, a paused clock while a
   * dispute gets sorted out).
   */
  matchStartedAt: z.number().int().nonnegative(),
  /**
   * Cumulative score snapshotted at the moment each period ended, keyed by
   * period number. `buildMatchRecord` (matchRecord.ts) diffs consecutive
   * entries into the per-period point deltas a box score actually shows.
   */
  periodScores: PeriodScoresSchema,
  /**
   * Set by `startScheduledMatch` when this game began from a scheduled entry,
   * so `finishMatch` can close the loop and mark that entry completed. Null
   * for a game started the ordinary way, straight from the dashboard.
   */
  scheduleId: z.string().max(128).nullable(),
  /**
   * The board's tournament logo, shown on the scoreboard/mirror/overlay.
   * Seeded from the board's `theme.logoUrl` (Firestore) at game start, but
   * also settable live via `LOGO_URL_SET` so an upload mid-game shows up
   * immediately instead of waiting for the next `NEW_GAME` — the same
   * "editable anytime" treatment `TEAM_NAME_SET` already gets. Null shows no
   * logo at all, rather than falling back to a default image.
   */
  logoUrl: z.string().max(600).nullable(),
});

export type BoardState = z.infer<typeof BoardStateSchema>;

function initialTeam(name: string, timeouts: number): TeamState {
  return { name, score: 0, fouls: 0, timeouts, timeoutsUsed: 0 };
}

/**
 * True when `period` opens a new half, and so refills both teams' timeouts.
 *
 * A half is two periods, so halves begin at the odd ones: Q1, Q3, and then each
 * overtime (period 5, 7, …) — an overtime is its own short half and gets its
 * own allocation, which matches how the rulebook treats it. The parity test is
 * against the configured `startingPeriod`, so a board that opens at Q2 (a
 * second-half-only fixture, say) still breaks in the right places rather than
 * inheriting Q1's parity.
 */
export function startsNewHalf(period: number, startingPeriod: number): boolean {
  return (period - startingPeriod) % 2 === 0;
}

/**
 * A fresh, fully-paused board ready for tip-off.
 *
 * `scheduleId` links this game back to the schedule entry that started it, if
 * any — `startScheduledMatch` sets it so `finishMatch` can later mark that
 * entry completed. To start a game under different team names than the
 * board's saved defaults (as `startScheduledMatch` also does), pass a `config`
 * with `homeTeamName`/`awayTeamName` overridden — this function does not treat
 * team names specially.
 */
export function createInitialState(
  config: BoardConfig = DEFAULT_CONFIG,
  now = 0,
  actor = 'system',
  scheduleId: string | null = null,
  logoUrl: string | null = null,
): BoardState {
  return {
    sport: 'basketball',
    period: config.startingPeriod,
    possession: 'home',
    home: initialTeam(config.homeTeamName, config.timeouts),
    away: initialTeam(config.awayTeamName, config.timeouts),
    gameClock: { running: false, endsAt: null, remainingMs: config.periodLengthMs },
    shotClock: { running: false, endsAt: null, remainingMs: config.shotClockMs },
    config,
    rev: 0,
    updatedAt: now,
    updatedBy: actor,
    matchStartedAt: now,
    periodScores: {},
    scheduleId,
    logoUrl,
  };
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

/**
 * The flat shape written by the original single-tenant app at RTDB
 * `/scoreboardState`. Retained only so existing data can be migrated once.
 */
export interface LegacyScoreboardState {
  homeScore?: number;
  awayScore?: number;
  homeFouls?: number;
  awayFouls?: number;
  homeTimeouts?: number;
  awayTimeouts?: number;
  homeTeamName?: string;
  awayTeamName?: string;
  quarter?: number;
  gameMinutes?: number;
  gameSeconds?: number;
  shotClockSeconds?: number;
  ballPossession?: string;
  defaultGameMinutes?: number;
  defaultShotClock?: number;
  defaultTimeouts?: number;
  defaultQuarter?: number;
  defaultHomeTeam?: string;
  defaultAwayTeam?: string;
}

function pickName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return name === '' ? fallback : name.slice(0, LIMITS.teamName.maxLength);
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Converts one legacy `/scoreboardState` blob into a tenant-scoped BoardState.
 *
 * Both clocks land paused regardless of the legacy `isGameClockRunning` flag: a
 * migration must never resume a clock, because the legacy shape carries no
 * deadline to resume against and would otherwise invent one.
 */
export function migrateLegacyState(
  legacy: LegacyScoreboardState | null | undefined,
  now = 0,
  actor = 'migration',
): BoardState {
  const source = legacy ?? {};

  const config: BoardConfig = {
    ...DEFAULT_CONFIG,
    periodLengthMs: clamp(
      pickNumber(source.defaultGameMinutes, 10) * 60_000,
      1_000,
      LIMITS.gameClockMs.max,
    ),
    shotClockMs: clamp(
      pickNumber(source.defaultShotClock, 24) * 1_000,
      1_000,
      LIMITS.shotClockMs.max,
    ),
    timeouts: clamp(
      pickNumber(source.defaultTimeouts, 2),
      LIMITS.timeouts.min,
      LIMITS.timeouts.max,
    ),
    startingPeriod: clamp(
      pickNumber(source.defaultQuarter, 1),
      LIMITS.period.min,
      LIMITS.period.max,
    ),
    homeTeamName: pickName(source.defaultHomeTeam, DEFAULT_CONFIG.homeTeamName),
    awayTeamName: pickName(source.defaultAwayTeam, DEFAULT_CONFIG.awayTeamName),
  };

  const gameClockMs =
    clamp(pickNumber(source.gameMinutes, 10), 0, 99) * 60_000 +
    clamp(pickNumber(source.gameSeconds, 0), 0, 59) * 1_000;

  return {
    sport: 'basketball',
    period: clamp(pickNumber(source.quarter, 1), LIMITS.period.min, LIMITS.period.max),
    possession: source.ballPossession === 'away' ? 'away' : 'home',
    home: {
      name: pickName(source.homeTeamName, config.homeTeamName),
      score: clamp(pickNumber(source.homeScore, 0), LIMITS.score.min, LIMITS.score.max),
      fouls: clamp(pickNumber(source.homeFouls, 0), LIMITS.fouls.min, LIMITS.fouls.max),
      timeouts: clamp(
        pickNumber(source.homeTimeouts, config.timeouts),
        LIMITS.timeouts.min,
        LIMITS.timeouts.max,
      ),
      // The legacy scoreboard tracked only what was left, so how many had been
      // taken is not recoverable — zero is the honest answer, not a guess.
      timeoutsUsed: 0,
    },
    away: {
      name: pickName(source.awayTeamName, config.awayTeamName),
      score: clamp(pickNumber(source.awayScore, 0), LIMITS.score.min, LIMITS.score.max),
      fouls: clamp(pickNumber(source.awayFouls, 0), LIMITS.fouls.min, LIMITS.fouls.max),
      timeouts: clamp(
        pickNumber(source.awayTimeouts, config.timeouts),
        LIMITS.timeouts.min,
        LIMITS.timeouts.max,
      ),
      timeoutsUsed: 0,
    },
    gameClock: { running: false, endsAt: null, remainingMs: gameClockMs },
    shotClock: {
      running: false,
      endsAt: null,
      remainingMs: clamp(
        pickNumber(source.shotClockSeconds, 24) * 1_000,
        LIMITS.shotClockMs.min,
        LIMITS.shotClockMs.max,
      ),
    },
    config,
    rev: 0,
    updatedAt: now,
    updatedBy: actor,
    matchStartedAt: now,
    periodScores: {},
    scheduleId: null,
    logoUrl: null,
  };
}

/** True when this team's fouls have put the opponent in the bonus. */
export function isInBonus(state: BoardState, side: Side): boolean {
  return state[side].fouls >= state.config.foulBonusAt;
}

// ---------------------------------------------------------------------------
// Idle detection
// ---------------------------------------------------------------------------

/**
 * True only when a board is sitting exactly at its fresh-game defaults — the
 * one authoritative definition of "no game in progress here."
 *
 * `startScheduledMatch` (functions/src/matches.ts) uses this server-side to
 * refuse starting a scheduled match onto a board that already has one running;
 * the schedule page's board picker uses the same function client-side as a UX
 * hint. Both must agree, which is exactly why this lives here once rather than
 * being approximated twice.
 */
export function isBoardIdle(state: BoardState): boolean {
  return (
    state.home.score === 0 &&
    state.away.score === 0 &&
    state.home.fouls === 0 &&
    state.away.fouls === 0 &&
    state.home.timeouts === state.config.timeouts &&
    state.away.timeouts === state.config.timeouts &&
    state.period === state.config.startingPeriod &&
    !state.gameClock.running &&
    !state.shotClock.running &&
    state.gameClock.remainingMs === state.config.periodLengthMs &&
    state.shotClock.remainingMs === state.config.shotClockMs &&
    Object.keys(state.periodScores).length === 0
  );
}

// ---------------------------------------------------------------------------
// RTDB shape restoration
// ---------------------------------------------------------------------------

/**
 * Undoes the Realtime Database's array coercion of `periodScores`.
 *
 * RTDB does not store objects and arrays as distinct types. When every key of
 * an object looks like a non-negative integer and enough of the range is
 * filled, it hands the node back as a JavaScript *array* with holes — so
 * `{ '1': { home: 2, away: 3 } }`, written after the first period ends, is read
 * back as `[null, { home: 2, away: 3 }]`.
 *
 * That is not cosmetic. `PeriodScoresSchema` is a record, an array fails it,
 * and a board whose state fails to parse reads as *absent*: the control panel
 * shows "this board has no game state", and because every subsequent
 * transaction then declines to advance `rev`, the security rules reject its
 * writes too. Ending the first period would brick the board for the rest of the
 * game — which is exactly what happened before this function existed.
 *
 * Indices are restored as string keys, and holes (the `null` at index 0, and
 * any period never played) are dropped rather than becoming keys with null
 * values.
 */
/**
 * Defaults `timeoutsUsed` to zero on a team that predates the field.
 *
 * A game already in progress when this deploys has teams written without it.
 * Requiring it outright would fail the schema, which makes the whole board read
 * as *absent* — the board would go blank mid-game and refuse every further
 * write, which is precisely how the `periodScores` array bug behaved. A missing
 * count means no timeouts were recorded, so zero is both safe and true enough.
 */
function withTimeoutsUsed(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const team = raw as Record<string, unknown>;
  return team['timeoutsUsed'] === undefined ? { ...team, timeoutsUsed: 0 } : team;
}

function restorePeriodScores(raw: unknown): unknown {
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw)) return raw;

  const restored: Record<string, unknown> = {};
  // `forEach` skips holes in a sparse array; the explicit null check covers the
  // dense nulls the SDK produces for absent indices.
  raw.forEach((entry, index) => {
    if (entry !== null && entry !== undefined) restored[String(index)] = entry;
  });
  return restored;
}

/**
 * Restores the shapes the Realtime Database mangles on the way in and out, then
 * validates against `BoardStateSchema`.
 *
 * Three distinct pieces of RTDB behaviour have to be undone here. It deletes
 * any key whose value is `null` (a paused clock's `endsAt`) or an empty object
 * (`periodScores` on a fresh board, before any period has ended), so a value
 * written as `{ endsAt: null }` or `{ periodScores: {} }` comes back with that
 * key simply *absent*. And it re-types an integer-keyed object as an array —
 * see `restorePeriodScores`.
 *
 * Every read of live board state — on the client (`core/liveState.ts`) and
 * inside the serverless functions that also read RTDB directly
 * (`src/server/matches.ts`) — must go through this before the data can be
 * trusted, so both sides restore the same shape the same way rather than each
 * guessing at the gaps independently.
 *
 * Returns null for anything that fails the schema. A malformed node is treated
 * as "no state" rather than crashing the page: a scoreboard on a gym wall must
 * degrade to blank, never to a stack trace.
 */
export function parseLiveBoardState(raw: unknown): BoardState | null {
  if (raw === null || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const restored = {
    ...candidate,
    home: withTimeoutsUsed(candidate['home']),
    away: withTimeoutsUsed(candidate['away']),
    gameClock: withEndsAt(candidate['gameClock']),
    shotClock: withEndsAt(candidate['shotClock']),
    periodScores: restorePeriodScores(candidate['periodScores']),
    scheduleId: candidate['scheduleId'] ?? null,
    logoUrl: candidate['logoUrl'] ?? null,
  };

  const parsed = BoardStateSchema.safeParse(restored);
  return parsed.success ? parsed.data : null;
}

function withEndsAt(clock: unknown): unknown {
  if (clock === null || typeof clock !== 'object') return clock;
  const record = clock as Record<string, unknown>;
  return { endsAt: null, ...record };
}
