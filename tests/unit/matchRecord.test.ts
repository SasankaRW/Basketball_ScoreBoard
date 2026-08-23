import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildMatchRecord } from '../../src/core/matchRecord.js';
import { applyActions, type Action } from '../../src/core/reducer.js';
import { createInitialState, DEFAULT_CONFIG, type BoardState } from '../../src/core/schema.js';

const T0 = 1_700_000_000_000;

function play(actions: Action[], startedAt = T0): BoardState {
  const initial = createInitialState(DEFAULT_CONFIG, startedAt, 'system');
  return applyActions(initial, actions, { now: startedAt, actor: 'uid_operator' });
}

const ctx = (overrides: Partial<{ boardId: string; boardName: string; endedAt: number }> = {}) => ({
  boardId: 'brd_test',
  boardName: 'Court 1',
  endedAt: T0 + 40 * 60_000,
  ...overrides,
});

describe('buildMatchRecord', () => {
  it('reports final score, fouls, and identity straight from state', () => {
    const state = play([
      { type: 'SCORE_ADJUST', side: 'home', delta: 12 },
      { type: 'SCORE_ADJUST', side: 'away', delta: 9 },
      { type: 'FOUL_ADJUST', side: 'home', delta: 3 },
      { type: 'FOUL_ADJUST', side: 'away', delta: 4 },
      { type: 'TEAM_NAME_SET', side: 'home', name: 'Hawks' },
      { type: 'TEAM_NAME_SET', side: 'away', name: 'Comets' },
    ]);
    const record = buildMatchRecord(state, ctx());

    expect(record.homeScore).toBe(12);
    expect(record.awayScore).toBe(9);
    expect(record.homeFouls).toBe(3);
    expect(record.awayFouls).toBe(4);
    expect(record.homeTeamName).toBe('Hawks');
    expect(record.awayTeamName).toBe('Comets');
    expect(record.boardId).toBe('brd_test');
    expect(record.boardName).toBe('Court 1');
  });

  it('reports timeouts used from the running tally', () => {
    const state = play([
      { type: 'TIMEOUT_ADJUST', side: 'home', delta: -1 },
      { type: 'TIMEOUT_ADJUST', side: 'away', delta: -2 },
    ]);
    const record = buildMatchRecord(state, ctx());
    expect(record.homeTimeoutsUsed).toBe(1);
    expect(record.awayTimeoutsUsed).toBe(2);
  });

  /**
   * The reason the tally exists at all. Timeouts refill at the half, so
   * deriving "used" from what is left — as this once did — reports only the
   * second half and quietly loses everything before the break.
   */
  it('counts timeouts from both halves, not just the one the game ended in', () => {
    const state = play([
      { type: 'TIMEOUT_ADJUST', side: 'home', delta: -1 },
      { type: 'NEXT_PERIOD' },
      { type: 'NEXT_PERIOD' }, // into the second half — timeouts refill here
      { type: 'TIMEOUT_ADJUST', side: 'home', delta: -1 },
    ]);
    const record = buildMatchRecord(state, ctx());

    expect(state.home.timeouts).toBe(DEFAULT_CONFIG.timeouts - 1); // one left this half
    expect(record.homeTimeoutsUsed).toBe(2); // but two across the match
  });

  it('never reports a negative count when an operator hands one back', () => {
    // Restoring a timeout past the configured allowance is possible via the
    // control panel's +/- pair; it did not "un-take" a timeout.
    const state = play([{ type: 'TIMEOUT_ADJUST', side: 'home', delta: 5 }]);
    const record = buildMatchRecord(state, ctx());
    expect(record.homeTimeoutsUsed).toBe(0);
  });

  it('computes duration from matchStartedAt to the given endedAt, not the game clock', () => {
    const state = play([{ type: 'GAME_CLOCK_START' }, { type: 'GAME_CLOCK_PAUSE' }], T0);
    const record = buildMatchRecord(state, ctx({ endedAt: T0 + 90 * 60_000 }));
    expect(record.durationMs).toBe(90 * 60_000);
    expect(record.startedAt).toBe(T0);
  });

  it('never reports a negative duration even if endedAt precedes matchStartedAt', () => {
    const state = play([], T0);
    const record = buildMatchRecord(state, ctx({ endedAt: T0 - 1_000 }));
    expect(record.durationMs).toBe(0);
  });

  describe('period scores', () => {
    it('reports a single period of points when NEXT_PERIOD is never dispatched', () => {
      const state = play([
        { type: 'SCORE_ADJUST', side: 'home', delta: 18 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 15 },
      ]);
      const record = buildMatchRecord(state, ctx());
      expect(record.periodsPlayed).toBe(1);
      expect(record.periodScores).toEqual([{ period: 1, home: 18, away: 15 }]);
    });

    it('splits points into per-period deltas across a full four-quarter game', () => {
      const state = play([
        { type: 'SCORE_ADJUST', side: 'home', delta: 18 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 15 },
        { type: 'NEXT_PERIOD' }, // -> Q2, snapshot Q1: 18-15
        { type: 'SCORE_ADJUST', side: 'home', delta: 14 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 19 },
        { type: 'NEXT_PERIOD' }, // -> Q3, snapshot Q2 cumulative: 32-34
        { type: 'SCORE_ADJUST', side: 'home', delta: 20 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 17 },
        { type: 'NEXT_PERIOD' }, // -> Q4, snapshot Q3 cumulative: 52-51
        { type: 'SCORE_ADJUST', side: 'home', delta: 16 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 21 },
        // Q4 never explicitly closed — buildMatchRecord closes it itself.
      ]);
      const record = buildMatchRecord(state, ctx());

      expect(record.periodsPlayed).toBe(4);
      expect(record.periodScores).toEqual([
        { period: 1, home: 18, away: 15 },
        { period: 2, home: 14, away: 19 },
        { period: 3, home: 20, away: 17 },
        { period: 4, home: 16, away: 21 },
      ]);
      // Per-period points must always sum to the final score — the one
      // invariant that has to hold regardless of how scoring happened.
      const homeSum = record.periodScores.reduce((sum, p) => sum + p.home, 0);
      const awaySum = record.periodScores.reduce((sum, p) => sum + p.away, 0);
      expect(homeSum).toBe(record.homeScore);
      expect(awaySum).toBe(record.awayScore);
    });

    it('handles a match finished with no scoring at all', () => {
      const state = play([{ type: 'NEXT_PERIOD' }, { type: 'NEXT_PERIOD' }]);
      const record = buildMatchRecord(state, ctx());
      expect(record.periodsPlayed).toBe(3);
      expect(record.periodScores).toEqual([
        { period: 1, home: 0, away: 0 },
        { period: 2, home: 0, away: 0 },
        { period: 3, home: 0, away: 0 },
      ]);
    });

    it('handles overtime periods beyond the configured period count the same way', () => {
      const state = play([
        { type: 'SCORE_ADJUST', side: 'home', delta: 10 },
        { type: 'NEXT_PERIOD' },
        { type: 'SCORE_ADJUST', side: 'home', delta: 10 },
        { type: 'NEXT_PERIOD' },
        { type: 'SCORE_ADJUST', side: 'home', delta: 10 },
        { type: 'NEXT_PERIOD' },
        { type: 'SCORE_ADJUST', side: 'home', delta: 10 },
        { type: 'NEXT_PERIOD' }, // period 5 — an overtime frame
        { type: 'SCORE_ADJUST', side: 'home', delta: 5 },
      ]);
      const record = buildMatchRecord(state, ctx());
      expect(record.periodsPlayed).toBe(5);
      expect(record.periodScores[4]).toEqual({ period: 5, home: 5, away: 0 });
      expect(record.homeScore).toBe(45);
    });
  });

  describe('property: period points always sum to the final score', () => {
    const arbAction: fc.Arbitrary<Action> = fc.oneof(
      fc.record({
        type: fc.constant('SCORE_ADJUST' as const),
        side: fc.constantFrom<'home' | 'away'>('home', 'away'),
        delta: fc.integer({ min: 0, max: 5 }), // non-negative: real scoring never subtracts
      }),
      fc.constant({ type: 'NEXT_PERIOD' as const }),
    );

    it('holds for arbitrary scoring and period-advance sequences', () => {
      fc.assert(
        fc.property(fc.array(arbAction, { maxLength: 40 }), (actions) => {
          const state = play(actions);
          const record = buildMatchRecord(state, ctx());
          const homeSum = record.periodScores.reduce((sum, p) => sum + p.home, 0);
          const awaySum = record.periodScores.reduce((sum, p) => sum + p.away, 0);
          expect(homeSum).toBe(state.home.score);
          expect(awaySum).toBe(state.away.score);
          // Periods are reported in order, gap-free from 1.
          expect(record.periodScores.map((p) => p.period)).toEqual(
            record.periodScores.map((_, i) => i + 1),
          );
        }),
      );
    });
  });

  it('carries the scheduleId through from state, or null when absent', () => {
    const withoutSchedule = play([]);
    expect(buildMatchRecord(withoutSchedule, ctx()).scheduleId).toBeNull();

    const withSchedule = { ...play([]), scheduleId: 'sch_abc123' };
    expect(buildMatchRecord(withSchedule, ctx()).scheduleId).toBe('sch_abc123');
  });
});
