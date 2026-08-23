import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyAction,
  applyActions,
  type Action,
  type ActionContext,
} from '../../src/core/reducer.js';
import { remainingAt } from '../../src/core/clock.js';
import {
  createInitialState,
  DEFAULT_CONFIG,
  LIMITS,
  type BoardState,
  type Side,
} from '../../src/core/schema.js';

const T0 = 1_700_000_000_000;
const ctx: ActionContext = { now: T0, actor: 'uid_operator' };

let state: BoardState;

beforeEach(() => {
  state = createInitialState(DEFAULT_CONFIG, T0, 'system');
});

describe('commit semantics', () => {
  it('increments rev by exactly one and stamps provenance on every change', () => {
    const next = applyAction(state, { type: 'SCORE_ADJUST', side: 'home', delta: 2 }, ctx);
    expect(next.rev).toBe(state.rev + 1);
    expect(next.updatedAt).toBe(T0);
    expect(next.updatedBy).toBe('uid_operator');
  });

  /**
   * Reference stability is what stops a held-down key from flooding the network:
   * the caller writes only when the reducer hands back a different object.
   */
  it('returns the identical reference — and does not bump rev — for a no-op', () => {
    const atZero = applyAction(state, { type: 'SCORE_SET', side: 'home', value: 0 }, ctx);
    expect(atZero).toBe(state);

    const capped = applyActions(
      state,
      [
        { type: 'SCORE_SET', side: 'home', value: LIMITS.score.max },
        { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
      ],
      ctx,
    );
    expect(capped.rev).toBe(1);
    expect(capped.home.score).toBe(LIMITS.score.max);
  });

  it('never mutates the state it was given', () => {
    const snapshot = structuredClone(state);
    applyAction(state, { type: 'SCORE_ADJUST', side: 'home', delta: 3 }, ctx);
    applyAction(state, { type: 'NEW_GAME' }, ctx);
    expect(state).toEqual(snapshot);
  });
});

describe('scoring, fouls, timeouts', () => {
  const cases = [
    { action: 'SCORE', field: 'score', limits: LIMITS.score },
    { action: 'FOUL', field: 'fouls', limits: LIMITS.fouls },
    { action: 'TIMEOUT', field: 'timeouts', limits: LIMITS.timeouts },
  ] as const;

  for (const { action, field, limits } of cases) {
    for (const side of ['home', 'away'] as Side[]) {
      it(`clamps ${side} ${field} to ${limits.min}..${limits.max}`, () => {
        const high = applyAction(
          state,
          { type: `${action}_SET`, side, value: limits.max + 500 } as Action,
          ctx,
        );
        expect(high[side][field]).toBe(limits.max);

        const low = applyAction(
          state,
          { type: `${action}_ADJUST`, side, delta: -999 } as Action,
          ctx,
        );
        expect(low[side][field]).toBe(limits.min);
      });

      it(`leaves the opposing side's ${field} untouched`, () => {
        const other: Side = side === 'home' ? 'away' : 'home';
        const before = state[other][field];
        const next = applyAction(
          state,
          { type: `${action}_ADJUST`, side, delta: 1 } as Action,
          ctx,
        );
        expect(next[other][field]).toBe(before);
      });
    }
  }

  it('accumulates a realistic scoring run', () => {
    const next = applyActions(
      state,
      [
        { type: 'SCORE_ADJUST', side: 'home', delta: 3 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 2 },
        { type: 'SCORE_ADJUST', side: 'home', delta: 2 },
        { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
      ],
      ctx,
    );
    expect(next.home.score).toBe(6);
    expect(next.away.score).toBe(2);
    expect(next.rev).toBe(4);
  });
});

describe('team names', () => {
  it('trims whitespace', () => {
    const next = applyAction(
      state,
      { type: 'TEAM_NAME_SET', side: 'home', name: '  Lakers  ' },
      ctx,
    );
    expect(next.home.name).toBe('Lakers');
  });

  it('falls back to the configured default when cleared', () => {
    const next = applyAction(state, { type: 'TEAM_NAME_SET', side: 'away', name: '   ' }, ctx);
    expect(next.away.name).toBe(DEFAULT_CONFIG.awayTeamName);
  });

  it('truncates to the width the scoreboard can render', () => {
    const next = applyAction(
      state,
      { type: 'TEAM_NAME_SET', side: 'home', name: 'X'.repeat(200) },
      ctx,
    );
    expect(next.home.name).toHaveLength(LIMITS.teamName.maxLength);
  });
});

describe('logo', () => {
  it('sets the tournament logo', () => {
    const next = applyAction(
      state,
      { type: 'LOGO_URL_SET', logoUrl: 'https://example.com/logo.png' },
      ctx,
    );
    expect(next.logoUrl).toBe('https://example.com/logo.png');
  });

  it('clears the logo back to null', () => {
    const withLogo = applyAction(
      state,
      { type: 'LOGO_URL_SET', logoUrl: 'https://example.com/logo.png' },
      ctx,
    );
    const cleared = applyAction(withLogo, { type: 'LOGO_URL_SET', logoUrl: null }, ctx);
    expect(cleared.logoUrl).toBeNull();
  });

  it('is a no-op that returns the same reference when the value is unchanged', () => {
    const next = applyAction(state, { type: 'LOGO_URL_SET', logoUrl: state.logoUrl }, ctx);
    expect(next).toBe(state);
  });
});

describe('period', () => {
  it('clamps adjustment to the legal range', () => {
    expect(applyAction(state, { type: 'PERIOD_ADJUST', delta: -5 }, ctx).period).toBe(1);
    expect(applyAction(state, { type: 'PERIOD_SET', value: 99 }, ctx).period).toBe(
      LIMITS.period.max,
    );
  });

  it('NEXT_PERIOD resets team fouls and both clocks, as the rulebook requires', () => {
    const midGame = applyActions(
      state,
      [
        { type: 'FOUL_ADJUST', side: 'home', delta: 7 },
        { type: 'FOUL_ADJUST', side: 'away', delta: 4 },
        { type: 'GAME_CLOCK_SET', remainingMs: 5_000 },
        { type: 'SHOT_CLOCK_SET', remainingMs: 3_000 },
      ],
      ctx,
    );

    const next = applyAction(midGame, { type: 'NEXT_PERIOD' }, ctx);
    expect(next.period).toBe(2);
    expect(next.home.fouls).toBe(0);
    expect(next.away.fouls).toBe(0);
    expect(next.gameClock).toEqual({
      running: false,
      endsAt: null,
      remainingMs: DEFAULT_CONFIG.periodLengthMs,
    });
    expect(next.shotClock.remainingMs).toBe(DEFAULT_CONFIG.shotClockMs);
  });

  it('NEXT_PERIOD preserves the score', () => {
    const scored = applyAction(state, { type: 'SCORE_ADJUST', side: 'home', delta: 22 }, ctx);
    expect(applyAction(scored, { type: 'NEXT_PERIOD' }, ctx).home.score).toBe(22);
  });

  it('NEXT_PERIOD snapshots the cumulative score under the period just left', () => {
    const scored = applyActions(
      state,
      [
        { type: 'SCORE_ADJUST', side: 'home', delta: 18 },
        { type: 'SCORE_ADJUST', side: 'away', delta: 15 },
      ],
      ctx,
    );
    const next = applyAction(scored, { type: 'NEXT_PERIOD' }, ctx);
    expect(next.periodScores).toEqual({ '1': { home: 18, away: 15 } });

    const further = applyActions(
      next,
      [{ type: 'SCORE_ADJUST', side: 'home', delta: 14 }, { type: 'NEXT_PERIOD' }],
      ctx,
    );
    // Cumulative through period 2 (18+14=32), period 1's entry untouched.
    expect(further.periodScores).toEqual({
      '1': { home: 18, away: 15 },
      '2': { home: 32, away: 15 },
    });
  });
});

/**
 * Timeouts are allocated per *half*, so the count both refills and has to keep
 * being countable across the refill. Those are two separate obligations and the
 * tests below hold them apart: `timeouts` is what a team has left right now,
 * `timeoutsUsed` is what the match record reports at the end.
 */
describe('timeouts per half', () => {
  const use = (side: 'home' | 'away'): Action => ({ type: 'TIMEOUT_ADJUST', side, delta: -1 });

  it('starts each team with the configured allowance', () => {
    expect(state.home.timeouts).toBe(DEFAULT_CONFIG.timeouts);
    expect(state.home.timeoutsUsed).toBe(0);
  });

  it('counts a timeout as taken and as one fewer remaining', () => {
    const next = applyAction(state, use('home'), ctx);
    expect(next.home.timeouts).toBe(DEFAULT_CONFIG.timeouts - 1);
    expect(next.home.timeoutsUsed).toBe(1);
  });

  it('refills at the start of the second half, without forgetting the first', () => {
    const firstHalf = applyActions(state, [use('home'), use('home'), { type: 'NEXT_PERIOD' }], ctx);
    // Q2 is still the first half — no refill yet.
    expect(firstHalf.home.timeouts).toBe(DEFAULT_CONFIG.timeouts - 2);

    const secondHalf = applyAction(firstHalf, { type: 'NEXT_PERIOD' }, ctx);
    expect(secondHalf.period).toBe(3);
    expect(secondHalf.home.timeouts).toBe(DEFAULT_CONFIG.timeouts);
    expect(secondHalf.away.timeouts).toBe(DEFAULT_CONFIG.timeouts);
    // The whole point of the separate tally: the two taken before the break
    // are still on the record.
    expect(secondHalf.home.timeoutsUsed).toBe(2);
  });

  it('accumulates across halves', () => {
    const played = applyActions(
      state,
      [use('home'), { type: 'NEXT_PERIOD' }, { type: 'NEXT_PERIOD' }, use('home'), use('home')],
      ctx,
    );
    expect(played.home.timeouts).toBe(DEFAULT_CONFIG.timeouts - 2);
    expect(played.home.timeoutsUsed).toBe(3);
  });

  it('gives each overtime its own allocation', () => {
    let played = state;
    for (let i = 0; i < 4; i += 1) played = applyAction(played, { type: 'NEXT_PERIOD' }, ctx);
    expect(played.period).toBe(5); // OT1
    expect(played.home.timeouts).toBe(DEFAULT_CONFIG.timeouts);
  });

  /**
   * PERIOD_ADJUST is the correction tool — `Q` / `Shift+Q`. Refilling on it
   * would hand out a fresh allocation every time an operator nudged the period
   * back and forth to fix a mis-click.
   */
  it('does not refill on a manual period nudge', () => {
    const used = applyActions(state, [use('home'), use('home')], ctx);
    const nudged = applyActions(used, [{ type: 'PERIOD_ADJUST', delta: 1 }], ctx);
    const toThird = applyAction(nudged, { type: 'PERIOD_ADJUST', delta: 1 }, ctx);

    expect(toThird.period).toBe(3);
    expect(toThird.home.timeouts).toBe(DEFAULT_CONFIG.timeouts - 2);
  });

  it('records nothing as taken when a team has none left', () => {
    const spent = applyActions(state, Array(DEFAULT_CONFIG.timeouts).fill(use('home')), ctx);
    expect(spent.home.timeouts).toBe(0);

    const again = applyAction(spent, use('home'), ctx);
    // The clamp absorbed it, so no timeout was actually taken — and a no-op
    // must stay a no-op, or every blocked press would burn a revision.
    expect(again).toBe(spent);
    expect(again.home.timeoutsUsed).toBe(DEFAULT_CONFIG.timeouts);
  });

  /**
   * An operator handing a timeout back after a miscount did not take one, so
   * the tally must not run backwards — otherwise "used" could be talked down to
   * zero on a team that used three.
   */
  it('does not un-count a timeout that is handed back', () => {
    const used = applyAction(state, use('home'), ctx);
    const restored = applyAction(used, { type: 'TIMEOUT_ADJUST', side: 'home', delta: 1 }, ctx);

    expect(restored.home.timeouts).toBe(DEFAULT_CONFIG.timeouts);
    expect(restored.home.timeoutsUsed).toBe(1);
  });

  it('clears the tally on a new game', () => {
    const used = applyAction(state, use('home'), ctx);
    expect(applyAction(used, { type: 'NEW_GAME' }, ctx).home.timeoutsUsed).toBe(0);
  });
});

describe('possession', () => {
  it('toggles between sides', () => {
    const away = applyAction(state, { type: 'POSSESSION_TOGGLE' }, ctx);
    expect(away.possession).toBe('away');
    expect(applyAction(away, { type: 'POSSESSION_TOGGLE' }, ctx).possession).toBe('home');
  });

  it('setting the current side is a no-op', () => {
    expect(applyAction(state, { type: 'POSSESSION_SET', side: 'home' }, ctx)).toBe(state);
  });
});

describe('clocks', () => {
  it('start / pause round-trips without losing time', () => {
    const started = applyAction(state, { type: 'GAME_CLOCK_START' }, ctx);
    expect(started.gameClock.running).toBe(true);

    const paused = applyAction(started, { type: 'GAME_CLOCK_PAUSE' }, { ...ctx, now: T0 + 30_000 });
    expect(paused.gameClock.running).toBe(false);
    expect(paused.gameClock.remainingMs).toBe(DEFAULT_CONFIG.periodLengthMs - 30_000);
  });

  it('clamps a set beyond the displayable range', () => {
    const next = applyAction(state, { type: 'GAME_CLOCK_SET', remainingMs: 999 * 60_000 }, ctx);
    expect(next.gameClock.remainingMs).toBe(LIMITS.gameClockMs.max);
  });

  it('GAME_CLOCK_RESET returns to the configured period length, paused', () => {
    const running = applyActions(
      state,
      [{ type: 'GAME_CLOCK_SET', remainingMs: 4_000 }, { type: 'GAME_CLOCK_START' }],
      ctx,
    );
    const reset = applyAction(running, { type: 'GAME_CLOCK_RESET' }, ctx);
    expect(reset.gameClock).toEqual({
      running: false,
      endsAt: null,
      remainingMs: DEFAULT_CONFIG.periodLengthMs,
    });
  });

  it('SHOT_CLOCK_RESET resumes immediately when the game clock is live', () => {
    const live = applyAction(state, { type: 'GAME_CLOCK_START' }, ctx);
    const reset = applyAction(live, { type: 'SHOT_CLOCK_RESET' }, ctx);
    expect(reset.shotClock.running).toBe(true);
    expect(remainingAt(reset.shotClock, T0)).toBe(DEFAULT_CONFIG.shotClockMs);
  });

  it('SHOT_CLOCK_RESET stays paused when nothing is running', () => {
    const reset = applyAction(state, { type: 'SHOT_CLOCK_RESET' }, ctx);
    expect(reset.shotClock.running).toBe(false);
  });

  /**
   * Resets happen during live play, so stopping the clock to reset it would
   * cost the operator a manual restart every time — and the seconds in between
   * come off the possession.
   */
  it('SHOT_CLOCK_RESET keeps a running shot clock running', () => {
    const ticking = applyAction(state, { type: 'SHOT_CLOCK_START' }, ctx);
    expect(ticking.shotClock.running).toBe(true);

    const reset = applyAction(ticking, { type: 'SHOT_CLOCK_RESET' }, ctx);
    expect(reset.shotClock.running).toBe(true);
    expect(remainingAt(reset.shotClock, T0)).toBe(DEFAULT_CONFIG.shotClockMs);
  });

  it('SHOT_CLOCK_RESET keeps running on the 14-second rebound reset too', () => {
    const ticking = applyAction(state, { type: 'SHOT_CLOCK_START' }, ctx);
    const reset = applyAction(
      ticking,
      { type: 'SHOT_CLOCK_RESET', remainingMs: DEFAULT_CONFIG.shotClockResetMs },
      ctx,
    );
    expect(reset.shotClock.running).toBe(true);
    expect(remainingAt(reset.shotClock, T0)).toBe(14_000);
  });

  it('supports the 14-second offensive-rebound reset', () => {
    const live = applyAction(state, { type: 'GAME_CLOCK_START' }, ctx);
    const reset = applyAction(
      live,
      { type: 'SHOT_CLOCK_RESET', remainingMs: DEFAULT_CONFIG.shotClockResetMs },
      ctx,
    );
    expect(remainingAt(reset.shotClock, T0)).toBe(14_000);
  });

  it('SETTLE freezes a run-out clock so every viewer agrees it stopped', () => {
    const running = applyActions(
      state,
      [{ type: 'GAME_CLOCK_SET', remainingMs: 2_000 }, { type: 'GAME_CLOCK_START' }],
      ctx,
    );
    const settled = applyAction(running, { type: 'SETTLE' }, { ...ctx, now: T0 + 2_000 });
    expect(settled.gameClock).toEqual({ running: false, endsAt: null, remainingMs: 0 });
  });

  it('SETTLE is a no-op while time remains', () => {
    const running = applyAction(state, { type: 'GAME_CLOCK_START' }, ctx);
    expect(applyAction(running, { type: 'SETTLE' }, { ...ctx, now: T0 + 1_000 })).toBe(running);
  });

  it('refuses to start an expired clock', () => {
    const expired = applyAction(state, { type: 'GAME_CLOCK_SET', remainingMs: 0 }, ctx);
    expect(applyAction(expired, { type: 'GAME_CLOCK_START' }, ctx)).toBe(expired);
  });
});

describe('config', () => {
  it('applies a valid patch', () => {
    const next = applyAction(
      state,
      { type: 'CONFIG_SET', patch: { periodLengthMs: 12 * 60_000, foulBonusAt: 4 } },
      ctx,
    );
    expect(next.config.periodLengthMs).toBe(12 * 60_000);
    expect(next.config.foulBonusAt).toBe(4);
  });

  it('drops an invalid patch rather than corrupting a live game', () => {
    const next = applyAction(state, { type: 'CONFIG_SET', patch: { periodLengthMs: -1 } }, ctx);
    expect(next).toBe(state);
  });

  it('is a no-op when the patch changes nothing', () => {
    expect(
      applyAction(
        state,
        { type: 'CONFIG_SET', patch: { foulBonusAt: DEFAULT_CONFIG.foulBonusAt } },
        ctx,
      ),
    ).toBe(state);
  });
});

describe('NEW_GAME', () => {
  it('clears play state, preserves config, and keeps rev advancing', () => {
    const dirty = applyActions(
      state,
      [
        { type: 'SCORE_ADJUST', side: 'home', delta: 55 },
        { type: 'FOUL_ADJUST', side: 'away', delta: 6 },
        { type: 'PERIOD_SET', value: 4 },
        { type: 'TEAM_NAME_SET', side: 'home', name: 'Lakers' },
        { type: 'CONFIG_SET', patch: { periodLengthMs: 12 * 60_000 } },
      ],
      ctx,
    );

    const fresh = applyAction(dirty, { type: 'NEW_GAME' }, ctx);
    expect(fresh.home.score).toBe(0);
    expect(fresh.away.fouls).toBe(0);
    expect(fresh.period).toBe(DEFAULT_CONFIG.startingPeriod);
    expect(fresh.home.name).toBe(DEFAULT_CONFIG.homeTeamName);
    // Configuration survives a reset — only the game is cleared.
    expect(fresh.config.periodLengthMs).toBe(12 * 60_000);
    expect(fresh.gameClock.remainingMs).toBe(12 * 60_000);
    // rev must keep climbing, or concurrent writers would see it move backwards.
    expect(fresh.rev).toBe(dirty.rev + 1);
  });

  it('clears period scores, stamps a fresh matchStartedAt, and drops any schedule link', () => {
    const midGame: BoardState = {
      ...applyActions(
        state,
        [{ type: 'SCORE_ADJUST', side: 'home', delta: 10 }, { type: 'NEXT_PERIOD' }],
        ctx,
      ),
      scheduleId: 'sch_abc123',
    };

    const fresh = applyAction(
      midGame,
      { type: 'NEW_GAME' },
      { now: T0 + 5_000, actor: 'uid_operator' },
    );
    expect(fresh.periodScores).toEqual({});
    expect(fresh.matchStartedAt).toBe(T0 + 5_000);
    expect(fresh.scheduleId).toBeNull();
  });

  /**
   * The bug this guards: board settings live in Firestore, while live state
   * carries a snapshot of them taken at board creation. Nothing refreshes
   * that snapshot in place, so unless NEW_GAME is handed the current config,
   * editing (say) the shot clock in Board settings changes nothing a player
   * ever sees — which is exactly what shipped.
   */
  it('adopts the board config it is handed, so settings edits actually apply', () => {
    const updated = { ...DEFAULT_CONFIG, shotClockMs: 20_000, periodLengthMs: 8 * 60_000 };
    const fresh = applyAction(state, { type: 'NEW_GAME', config: updated }, ctx);

    expect(fresh.config.shotClockMs).toBe(20_000);
    expect(fresh.shotClock.remainingMs).toBe(20_000);
    expect(fresh.gameClock.remainingMs).toBe(8 * 60_000);
  });

  it('keeps the existing config when handed none', () => {
    const fresh = applyAction(state, { type: 'NEW_GAME' }, ctx);
    expect(fresh.config).toEqual(state.config);
  });

  it('falls back to the existing config rather than failing on a malformed one', () => {
    const broken = { ...DEFAULT_CONFIG, shotClockMs: -5 } as unknown as typeof DEFAULT_CONFIG;
    const fresh = applyAction(state, { type: 'NEW_GAME', config: broken }, ctx);
    expect(fresh.config).toEqual(state.config);
  });

  it('preserves the tournament logo — a discard-and-restart is not a rebrand', () => {
    const midGame: BoardState = {
      ...applyAction(state, { type: 'SCORE_ADJUST', side: 'home', delta: 10 }, ctx),
      logoUrl: 'https://example.com/logo.png',
    };

    const fresh = applyAction(midGame, { type: 'NEW_GAME' }, ctx);
    expect(fresh.logoUrl).toBe('https://example.com/logo.png');
  });
});

describe('invariants across arbitrary action sequences', () => {
  const arbSide = fc.constantFrom<Side>('home', 'away');

  const arbAction: fc.Arbitrary<Action> = fc.oneof(
    fc.record({
      type: fc.constant('SCORE_ADJUST' as const),
      side: arbSide,
      delta: fc.integer({ min: -5, max: 5 }),
    }),
    fc.record({
      type: fc.constant('FOUL_ADJUST' as const),
      side: arbSide,
      delta: fc.integer({ min: -2, max: 2 }),
    }),
    fc.record({
      type: fc.constant('TIMEOUT_ADJUST' as const),
      side: arbSide,
      delta: fc.integer({ min: -2, max: 2 }),
    }),
    fc.record({
      type: fc.constant('PERIOD_ADJUST' as const),
      delta: fc.integer({ min: -2, max: 2 }),
    }),
    fc.constant({ type: 'POSSESSION_TOGGLE' as const }),
    fc.constant({ type: 'GAME_CLOCK_TOGGLE' as const }),
    fc.constant({ type: 'SHOT_CLOCK_TOGGLE' as const }),
    fc.constant({ type: 'SHOT_CLOCK_RESET' as const }),
    fc.constant({ type: 'SETTLE' as const }),
    fc.constant({ type: 'NEXT_PERIOD' as const }),
    fc.constant({ type: 'NEW_GAME' as const }),
  );

  it('holds every schema bound no matter what the operator does', () => {
    fc.assert(
      fc.property(
        fc.array(arbAction, { maxLength: 60 }),
        fc.integer({ min: 0, max: 3_000 }),
        (actions, step) => {
          let current = state;
          let now = T0;
          for (const action of actions) {
            now += step;
            current = applyAction(current, action, { now, actor: 'uid_operator' });

            for (const side of ['home', 'away'] as Side[]) {
              expect(current[side].score).toBeGreaterThanOrEqual(LIMITS.score.min);
              expect(current[side].score).toBeLessThanOrEqual(LIMITS.score.max);
              expect(current[side].fouls).toBeLessThanOrEqual(LIMITS.fouls.max);
              expect(current[side].timeouts).toBeLessThanOrEqual(LIMITS.timeouts.max);
              expect(Number.isInteger(current[side].score)).toBe(true);
            }
            expect(current.period).toBeGreaterThanOrEqual(LIMITS.period.min);
            expect(current.period).toBeLessThanOrEqual(LIMITS.period.max);
            expect(current.gameClock.running).toBe(current.gameClock.endsAt !== null);
            expect(current.shotClock.running).toBe(current.shotClock.endsAt !== null);
          }
        },
      ),
    );
  });

  it('advances rev exactly when — and only when — the state changes', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 40 }), (actions) => {
        let current = state;
        let now = T0;
        for (const action of actions) {
          now += 1_000;
          const before = current;
          current = applyAction(current, action, { now, actor: 'uid_operator' });
          if (current === before) {
            expect(current.rev).toBe(before.rev);
          } else {
            expect(current.rev).toBe(before.rev + 1);
          }
        }
      }),
    );
  });
});
