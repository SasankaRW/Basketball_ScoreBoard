import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../../src/core/reducer.js';
import { createInitialState, DEFAULT_CONFIG } from '../../src/core/schema.js';
import { describeEvent } from '../../src/core/timeline.js';

const T0 = 1_700_000_000_000;
const ctx = { now: T0, actor: 'uid_operator' };
const state = createInitialState(DEFAULT_CONFIG, T0, 'uid_operator');

/** Mirrors production: the event describes the state the action produced. */
function record(action: Action, from = state) {
  return describeEvent(action, applyAction(from, action, ctx), ctx);
}

describe('describeEvent — what belongs on a timeline', () => {
  it('records a basket with its points and the score it produced', () => {
    const event = record({ type: 'SCORE_ADJUST', side: 'home', delta: 3 });

    expect(event).toMatchObject({ type: 'score', side: 'home', delta: 3, home: 3, away: 0 });
    expect(event?.period).toBe(state.period);
    expect(event?.actor).toBe('uid_operator');
    expect(event?.ts).toBe(T0);
  });

  it('carries the running score forward, which is what makes it a narrative', () => {
    const afterFirst = applyAction(state, { type: 'SCORE_ADJUST', side: 'home', delta: 2 }, ctx);
    const event = record({ type: 'SCORE_ADJUST', side: 'away', delta: 3 }, afterFirst);

    expect(event).toMatchObject({ home: 2, away: 3 });
  });

  it('records a correction as a negative delta rather than dropping it', () => {
    const scored = applyAction(state, { type: 'SCORE_ADJUST', side: 'home', delta: 2 }, ctx);
    const event = record({ type: 'SCORE_ADJUST', side: 'home', delta: -1 }, scored);

    expect(event).toMatchObject({ type: 'score', delta: -1, home: 1 });
  });

  it('records fouls', () => {
    expect(record({ type: 'FOUL_ADJUST', side: 'away', delta: 1 })).toMatchObject({
      type: 'foul',
      side: 'away',
      delta: 1,
    });
  });

  /**
   * The sign is the meaning: -1 is a timeout taken, +1 an operator handing one
   * back after a miscount. Normalising it away here would lose that.
   */
  it('records timeouts with the sign they were dispatched with', () => {
    expect(record({ type: 'TIMEOUT_ADJUST', side: 'home', delta: -1 })).toMatchObject({
      type: 'timeout',
      side: 'home',
      delta: -1,
    });
  });

  it('records both ways a period can change', () => {
    expect(record({ type: 'NEXT_PERIOD' })).toMatchObject({ type: 'period', side: null, delta: 0 });
    expect(record({ type: 'PERIOD_ADJUST', delta: 1 })).toMatchObject({
      type: 'period',
      side: null,
      delta: 1,
    });
  });

  it('reports the period the game is in after a period change, not before', () => {
    const event = record({ type: 'NEXT_PERIOD' });
    expect(event?.period).toBe(state.period + 1);
  });
});

describe('describeEvent — what does not', () => {
  /**
   * Clock actions fire on every whistle. A timeline where four fifths of the
   * rows are "clock stopped" buries the basket someone opened it to find.
   */
  it.each([
    ['GAME_CLOCK_TOGGLE', { type: 'GAME_CLOCK_TOGGLE' }],
    ['GAME_CLOCK_START', { type: 'GAME_CLOCK_START' }],
    ['GAME_CLOCK_PAUSE', { type: 'GAME_CLOCK_PAUSE' }],
    ['GAME_CLOCK_RESET', { type: 'GAME_CLOCK_RESET' }],
    ['SHOT_CLOCK_TOGGLE', { type: 'SHOT_CLOCK_TOGGLE' }],
    ['SHOT_CLOCK_RESET', { type: 'SHOT_CLOCK_RESET' }],
    ['POSSESSION_TOGGLE', { type: 'POSSESSION_TOGGLE' }],
    ['POSSESSION_SET', { type: 'POSSESSION_SET', side: 'away' }],
    ['TEAM_NAME_SET', { type: 'TEAM_NAME_SET', side: 'home', name: 'Hawks' }],
    ['LOGO_URL_SET', { type: 'LOGO_URL_SET', logoUrl: null }],
    ['SETTLE', { type: 'SETTLE' }],
    ['NEW_GAME', { type: 'NEW_GAME' }],
    ['CONFIG_SET', { type: 'CONFIG_SET', patch: { timeouts: 3 } }],
  ] as [string, Action][])('ignores %s', (_label, action) => {
    expect(describeEvent(action, applyAction(state, action, ctx), ctx)).toBeNull();
  });

  /**
   * The `*_SET` variants carry a final value rather than a delta, so describing
   * one would need the prior state. No surface dispatches them today; this
   * pins that assumption so it fails loudly if one starts.
   */
  it.each([
    ['SCORE_SET', { type: 'SCORE_SET', side: 'home', value: 10 }],
    ['FOUL_SET', { type: 'FOUL_SET', side: 'home', value: 3 }],
    ['TIMEOUT_SET', { type: 'TIMEOUT_SET', side: 'home', value: 1 }],
    ['PERIOD_SET', { type: 'PERIOD_SET', value: 3 }],
  ] as [string, Action][])('ignores %s, which carries no delta', (_label, action) => {
    expect(describeEvent(action, applyAction(state, action, ctx), ctx)).toBeNull();
  });
});
