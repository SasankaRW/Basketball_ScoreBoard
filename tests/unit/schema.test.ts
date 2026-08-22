import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BoardStateSchema,
  clamp,
  createInitialState,
  DEFAULT_CONFIG,
  isBoardIdle,
  isInBonus,
  LIMITS,
  migrateLegacyState,
  otherSide,
  parseLiveBoardState,
  type BoardState,
  type LegacyScoreboardState,
} from '../../src/core/schema.js';

describe('clamp', () => {
  it('bounds a value on both sides and truncates to an integer', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
    expect(clamp(7.9, 0, 10)).toBe(7);
  });

  it('falls back to the minimum for values that are not finite', () => {
    expect(clamp(Number.NaN, 3, 10)).toBe(3);
    expect(clamp(Number.POSITIVE_INFINITY, 3, 10)).toBe(3);
  });

  it('always lands inside the range', () => {
    fc.assert(
      fc.property(
        fc.double(),
        fc.integer({ min: -50, max: 0 }),
        fc.integer({ min: 1, max: 50 }),
        (v, min, max) => {
          const result = clamp(v, min, max);
          expect(result).toBeGreaterThanOrEqual(min);
          expect(result).toBeLessThanOrEqual(max);
          expect(Number.isInteger(result)).toBe(true);
        },
      ),
    );
  });
});

describe('otherSide', () => {
  it('is its own inverse', () => {
    expect(otherSide('home')).toBe('away');
    expect(otherSide(otherSide('home'))).toBe('home');
  });
});

describe('createInitialState', () => {
  it('produces a state that satisfies the schema', () => {
    expect(() => BoardStateSchema.parse(createInitialState())).not.toThrow();
  });

  it('starts paused, scoreless, and at the configured opening period', () => {
    const state = createInitialState({ ...DEFAULT_CONFIG, startingPeriod: 2, timeouts: 3 });
    expect(state.home.score).toBe(0);
    expect(state.away.score).toBe(0);
    expect(state.period).toBe(2);
    expect(state.home.timeouts).toBe(3);
    expect(state.gameClock.running).toBe(false);
    expect(state.shotClock.running).toBe(false);
    expect(state.rev).toBe(0);
  });

  it('matches the values the original static scoreboard shipped with', () => {
    const state = createInitialState();
    expect(state.home.name).toBe('HOME');
    expect(state.away.name).toBe('AWAY');
    expect(state.home.timeouts).toBe(2);
    expect(state.gameClock.remainingMs).toBe(10 * 60_000);
    expect(state.shotClock.remainingMs).toBe(24_000);
    expect(state.period).toBe(1);
  });

  it('stamps matchStartedAt from now and starts with no period scores, schedule link, or logo', () => {
    const state = createInitialState(DEFAULT_CONFIG, 12_345, 'uid_operator');
    expect(state.matchStartedAt).toBe(12_345);
    expect(state.periodScores).toEqual({});
    expect(state.scheduleId).toBeNull();
    expect(state.logoUrl).toBeNull();
  });

  it('links to a schedule entry when one is passed', () => {
    const state = createInitialState(DEFAULT_CONFIG, 0, 'system', 'sch_abc123');
    expect(state.scheduleId).toBe('sch_abc123');
  });

  it('carries the board logo when one is passed', () => {
    const state = createInitialState(
      DEFAULT_CONFIG,
      0,
      'system',
      null,
      'https://example.com/logo.png',
    );
    expect(state.logoUrl).toBe('https://example.com/logo.png');
  });
});

describe('isBoardIdle', () => {
  const idle = createInitialState();

  it('is true for a freshly created board', () => {
    expect(isBoardIdle(idle)).toBe(true);
  });

  it.each([
    ['home score', { ...idle, home: { ...idle.home, score: 2 } }],
    ['away score', { ...idle, away: { ...idle.away, score: 2 } }],
    ['home fouls', { ...idle, home: { ...idle.home, fouls: 1 } }],
    ['away fouls', { ...idle, away: { ...idle.away, fouls: 1 } }],
    ['home timeouts spent', { ...idle, home: { ...idle.home, timeouts: idle.home.timeouts - 1 } }],
    [
      'away timeouts restored',
      { ...idle, away: { ...idle.away, timeouts: idle.away.timeouts + 1 } },
    ],
    ['period advanced', { ...idle, period: 2 }],
    ['game clock running', { ...idle, gameClock: { running: true, endsAt: 1, remainingMs: 5000 } }],
    ['shot clock running', { ...idle, shotClock: { running: true, endsAt: 1, remainingMs: 5000 } }],
    ['game clock not at full', { ...idle, gameClock: { ...idle.gameClock, remainingMs: 1000 } }],
    ['a period score already recorded', { ...idle, periodScores: { '1': { home: 2, away: 0 } } }],
  ] as [string, BoardState][])('is false when %s differs from a fresh board', (_label, state) => {
    expect(isBoardIdle(state)).toBe(false);
  });
});

describe('parseLiveBoardState', () => {
  it('restores an empty periodScores, a null scheduleId, and a null logoUrl that RTDB stripped', () => {
    const raw = JSON.parse(JSON.stringify(createInitialState())) as Record<string, unknown>;
    delete raw['periodScores'];
    delete raw['scheduleId'];
    delete raw['logoUrl'];

    const parsed = parseLiveBoardState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.periodScores).toEqual({});
    expect(parsed?.scheduleId).toBeNull();
    expect(parsed?.logoUrl).toBeNull();
  });

  it('round-trips a board with period scores, a schedule link, and a logo intact', () => {
    const original: BoardState = {
      ...createInitialState(),
      periodScores: { '1': { home: 18, away: 15 } },
      scheduleId: 'sch_xyz',
      logoUrl: 'https://example.com/logo.png',
    };
    const raw = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
    expect(parseLiveBoardState(raw)).toEqual(original);
  });
});

describe('isInBonus', () => {
  it('triggers at the configured foul threshold', () => {
    const state = createInitialState();
    expect(isInBonus({ ...state, home: { ...state.home, fouls: 4 } }, 'home')).toBe(false);
    expect(isInBonus({ ...state, home: { ...state.home, fouls: 5 } }, 'home')).toBe(true);
  });

  it('respects a non-default threshold', () => {
    const state = createInitialState({ ...DEFAULT_CONFIG, foulBonusAt: 7 });
    expect(isInBonus({ ...state, away: { ...state.away, fouls: 6 } }, 'away')).toBe(false);
    expect(isInBonus({ ...state, away: { ...state.away, fouls: 7 } }, 'away')).toBe(true);
  });
});

describe('migrateLegacyState', () => {
  const legacy: LegacyScoreboardState = {
    homeScore: 64,
    awayScore: 58,
    homeFouls: 7,
    awayFouls: 3,
    homeTimeouts: 1,
    awayTimeouts: 2,
    homeTeamName: 'Lakers',
    awayTeamName: 'Celtics',
    quarter: 3,
    gameMinutes: 4,
    gameSeconds: 32,
    shotClockSeconds: 14,
    ballPossession: 'away',
    defaultGameMinutes: 12,
    defaultShotClock: 24,
    defaultTimeouts: 3,
    defaultQuarter: 1,
    defaultHomeTeam: 'HOME',
    defaultAwayTeam: 'AWAY',
  };

  it('carries every field across to the nested shape', () => {
    const state = migrateLegacyState(legacy);
    expect(state.home).toEqual({ name: 'Lakers', score: 64, fouls: 7, timeouts: 1 });
    expect(state.away).toEqual({ name: 'Celtics', score: 58, fouls: 3, timeouts: 2 });
    expect(state.period).toBe(3);
    expect(state.possession).toBe('away');
    expect(state.gameClock.remainingMs).toBe(4 * 60_000 + 32_000);
    expect(state.shotClock.remainingMs).toBe(14_000);
    expect(state.config.periodLengthMs).toBe(12 * 60_000);
    expect(state.config.timeouts).toBe(3);
    expect(state.periodScores).toEqual({});
    expect(state.scheduleId).toBeNull();
    expect(state.logoUrl).toBeNull();
  });

  /**
   * The legacy blob stores a countdown value, not a deadline. Resuming would
   * mean inventing an `endsAt` that never existed, so migration always lands paused.
   */
  it('always lands with both clocks paused', () => {
    const state = migrateLegacyState({ ...legacy, ...{ isGameClockRunning: true } });
    expect(state.gameClock.running).toBe(false);
    expect(state.shotClock.running).toBe(false);
  });

  it('produces a schema-valid state from an empty or missing blob', () => {
    for (const input of [null, undefined, {}]) {
      const state = migrateLegacyState(input);
      expect(() => BoardStateSchema.parse(state)).not.toThrow();
      expect(state.home.name).toBe('HOME');
    }
  });

  it('clamps hostile or corrupt values instead of throwing', () => {
    const state = migrateLegacyState({
      homeScore: 99_999,
      awayScore: -40,
      homeFouls: Number.NaN,
      quarter: 500,
      gameMinutes: 1_000,
      gameSeconds: 900,
      shotClockSeconds: -12,
      homeTeamName: 'Z'.repeat(400),
    } as LegacyScoreboardState);

    expect(state.home.score).toBe(LIMITS.score.max);
    expect(state.away.score).toBe(LIMITS.score.min);
    expect(state.home.fouls).toBe(0);
    expect(state.period).toBe(LIMITS.period.max);
    expect(state.gameClock.remainingMs).toBe(99 * 60_000 + 59_000);
    expect(state.shotClock.remainingMs).toBe(0);
    expect(state.home.name).toHaveLength(LIMITS.teamName.maxLength);
    expect(() => BoardStateSchema.parse(state)).not.toThrow();
  });

  it('survives arbitrary junk without ever producing an invalid state', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            homeScore: fc.oneof(fc.integer(), fc.double(), fc.constant(undefined)),
            awayScore: fc.oneof(fc.integer(), fc.constant(undefined)),
            quarter: fc.oneof(fc.integer(), fc.constant(undefined)),
            gameMinutes: fc.oneof(fc.integer(), fc.constant(undefined)),
            gameSeconds: fc.oneof(fc.integer(), fc.constant(undefined)),
            shotClockSeconds: fc.oneof(fc.integer(), fc.constant(undefined)),
            homeTeamName: fc.oneof(fc.string(), fc.constant(undefined)),
            ballPossession: fc.oneof(fc.string(), fc.constant(undefined)),
          },
          { requiredKeys: [] },
        ),
        (junk) => {
          expect(() => BoardStateSchema.parse(migrateLegacyState(junk))).not.toThrow();
        },
      ),
    );
  });
});

describe('BoardStateSchema', () => {
  it('rejects a score above the display range', () => {
    const state = createInitialState();
    const result = BoardStateSchema.safeParse({
      ...state,
      home: { ...state.home, score: LIMITS.score.max + 1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty team name', () => {
    const state = createInitialState();
    const result = BoardStateSchema.safeParse({ ...state, home: { ...state.home, name: '' } });
    expect(result.success).toBe(false);
  });

  it('rejects a negative remaining time', () => {
    const state = createInitialState();
    const result = BoardStateSchema.safeParse({
      ...state,
      gameClock: { running: false, endsAt: null, remainingMs: -1 },
    });
    expect(result.success).toBe(false);
  });
});
