/**
 * Concurrent-writer behaviour against the real emulator.
 *
 * The unit suite proves the reducer is correct in isolation; this proves the
 * *transaction* built around it does the right thing when two operators — a
 * scorer on the keyboard and an assistant on the control panel — act on the
 * same board at nearly the same instant. That is the scenario the original
 * plain `set()` calls in the old script.js could not survive: whichever write
 * landed last would silently discard the other.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref } from 'firebase/database';
import { dispatchAction, dispatchWithRetry } from '../../src/core/liveState.js';
import { applyActions } from '../../src/core/reducer.js';
import { createInitialState, DEFAULT_CONFIG, type BoardState } from '../../src/core/schema.js';
import {
  BOARD,
  createIntegrationEnv,
  operatorDb,
  primeBoard,
  seedBoard,
  TENANT,
  UID_A,
  UID_B,
} from './helpers.js';

/**
 * A fixed epoch would be simpler to read, but database.rules.json validates
 * `updatedAt` against the *real* server clock (`now - 600000 <= updatedAt <=
 * now + 120000`) — exactly the same check that stops a stale or clock-skewed
 * client from writing a bogus timestamp in production. `seedBoard` bypasses
 * rules entirely, so a fixed epoch works there, but every ordinary dispatch in
 * this file must carry a genuinely current timestamp or the RTDB emulator
 * rejects the write, same as it would in production.
 */
const T0 = 1_700_000_000_000;

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createIntegrationEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
});

async function readState(uid: string): Promise<BoardState> {
  const snapshot = await get(ref(operatorDb(env, uid), `live/${TENANT}/${BOARD}/state`));
  return snapshot.val() as BoardState;
}

describe('concurrent writers', () => {
  it('two operators scoring at once both land — no lost update', async () => {
    await seedBoard(env, T0);
    const dbA = operatorDb(env, UID_A);
    const dbB = operatorDb(env, UID_B);
    // Mirrors the real app: both operators' pages are already subscribed to
    // the board before either one acts.
    await Promise.all([primeBoard(env, UID_A), primeBoard(env, UID_B)]);

    // Genuinely concurrent: both transactions start before either resolves.
    const [outcomeA, outcomeB] = await Promise.all([
      dispatchWithRetry(
        dbA,
        TENANT,
        BOARD,
        { type: 'SCORE_ADJUST', side: 'home', delta: 2 },
        { now: Date.now(), actor: UID_A },
      ),
      dispatchWithRetry(
        dbB,
        TENANT,
        BOARD,
        { type: 'SCORE_ADJUST', side: 'away', delta: 3 },
        { now: Date.now(), actor: UID_B },
      ),
    ]);

    expect(outcomeA.status).toBe('committed');
    expect(outcomeB.status).toBe('committed');

    const final = await readState(UID_A);
    // Both points landed regardless of which transaction the database ran first.
    expect(final.home.score).toBe(2);
    expect(final.away.score).toBe(3);
    // Two accepted mutations from rev 1 means rev must land at 3, not 2 — a value
    // of 2 would mean one of the two writes silently overwrote the other.
    expect(final.rev).toBe(3);
  });

  it('ten interleaved increments from two operators all count', async () => {
    await seedBoard(env, T0);
    const dbA = operatorDb(env, UID_A);
    const dbB = operatorDb(env, UID_B);
    await Promise.all([primeBoard(env, UID_A), primeBoard(env, UID_B)]);

    const writes = Array.from({ length: 5 }, (_, i) =>
      dispatchWithRetry(
        dbA,
        TENANT,
        BOARD,
        { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
        { now: Date.now() + i, actor: UID_A },
      ),
    ).concat(
      Array.from({ length: 5 }, (_, i) =>
        dispatchWithRetry(
          dbB,
          TENANT,
          BOARD,
          { type: 'FOUL_ADJUST', side: 'away', delta: 1 },
          { now: Date.now() + i, actor: UID_B },
        ),
      ),
    );

    const outcomes = await Promise.all(writes);
    expect(outcomes.every((o) => o.status === 'committed')).toBe(true);

    const final = await readState(UID_A);
    expect(final.home.score).toBe(5);
    expect(final.away.fouls).toBe(5);
    expect(final.rev).toBe(11); // seeded at rev 1, plus 10 accepted writes
  });

  it('matches the sequential reduction of the same actions in any interleaving', async () => {
    await seedBoard(env, T0);
    const db = operatorDb(env, UID_A);
    await primeBoard(env, UID_A);

    const actions = [
      { type: 'SCORE_ADJUST', side: 'home', delta: 2 },
      { type: 'SCORE_ADJUST', side: 'away', delta: 3 },
      { type: 'FOUL_ADJUST', side: 'home', delta: 1 },
      { type: 'TIMEOUT_ADJUST', side: 'away', delta: -1 },
      { type: 'PERIOD_ADJUST', delta: 1 },
      { type: 'POSSESSION_TOGGLE' },
    ] as const;

    await Promise.all(
      actions.map((action) =>
        dispatchWithRetry(db, TENANT, BOARD, action, { now: Date.now(), actor: UID_A }),
      ),
    );

    const final = await readState(UID_A);
    const seeded: BoardState = { ...createInitialState(DEFAULT_CONFIG, T0, 'system'), rev: 1 };
    const expected = applyActions(
      seeded,
      actions as unknown as Parameters<typeof applyActions>[1],
      { now: T0, actor: UID_A },
    );

    // The RTDB transaction may apply the six actions in any order (they commute
    // here), but the final board must equal *some* full reduction of them —
    // never a partial one.
    expect(final.home.score).toBe(expected.home.score);
    expect(final.away.score).toBe(expected.away.score);
    expect(final.home.fouls).toBe(expected.home.fouls);
    expect(final.away.timeouts).toBe(expected.away.timeouts);
    expect(final.period).toBe(expected.period);
    expect(final.possession).toBe(expected.possession);
    expect(final.rev).toBe(7);
  });
});

describe('dispatchAction without retry', () => {
  /**
   * `dispatchAction` is the raw, single-attempt primitive — `dispatchWithRetry`
   * is what callers use for a board that should keep trying. Under a genuine
   * simultaneous race between two already-primed connections, the loser's write
   * is expected to lose to the `rev` optimistic lock and come back as
   * `'conflict'` rather than silently vanishing or double-applying. What must
   * hold regardless of which way the race breaks: the final score reflects
   * exactly the increments that were actually reported as committed — never
   * more (a phantom double-apply) and never fewer (a silently dropped write).
   */
  it('a losing writer reports conflict rather than silently dropping or duplicating its change', async () => {
    await seedBoard(env, T0);
    const dbA = operatorDb(env, UID_A);
    const dbB = operatorDb(env, UID_B);
    // Both connections already know the current value, so both fire their
    // write attempts immediately or the race is not a real one.
    await Promise.all([primeBoard(env, UID_A), primeBoard(env, UID_B)]);

    const [a, b] = await Promise.all([
      dispatchAction(
        dbA,
        TENANT,
        BOARD,
        { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
        { now: Date.now(), actor: UID_A },
      ),
      dispatchAction(
        dbB,
        TENANT,
        BOARD,
        { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
        { now: Date.now(), actor: UID_B },
      ),
    ]);

    expect(a.status).not.toBe('missing');
    expect(b.status).not.toBe('missing');

    const committedCount = [a, b].filter((o) => o.status === 'committed').length;
    expect(committedCount).toBeGreaterThanOrEqual(1);

    const final = await readState(UID_A);
    // The score must equal exactly how many attempts actually committed — the
    // one concrete, checkable consequence of "no lost or duplicated writes"
    // under a raw, non-retrying dispatch.
    expect(final.home.score).toBe(committedCount);

    // A caller that retries the loser converges to both increments landing —
    // this is the contract dispatchWithRetry is built on.
    if (committedCount === 1) {
      const loser = a.status === 'conflict' ? a : b;
      expect(loser.status).toBe('conflict');
      const retried = await dispatchWithRetry(
        a.status === 'conflict' ? dbA : dbB,
        TENANT,
        BOARD,
        { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
        { now: Date.now(), actor: UID_A },
      );
      expect(retried.status).toBe('committed');
      expect((await readState(UID_A)).home.score).toBe(2);
    }
  });

  it('a no-op action performs no write and burns no revision', async () => {
    await seedBoard(env, T0);
    const db = operatorDb(env, UID_A);

    const before = await readState(UID_A);
    const outcome = await dispatchAction(
      db,
      TENANT,
      BOARD,
      { type: 'POSSESSION_SET', side: 'home' }, // already home
      { now: Date.now(), actor: UID_A },
    );

    expect(outcome.status).toBe('unchanged');
    const after = await readState(UID_A);
    expect(after.rev).toBe(before.rev);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('reports missing when no board exists at the path', async () => {
    const db = operatorDb(env, UID_A);
    const outcome = await dispatchAction(
      db,
      TENANT,
      'brd_does_not_exist',
      { type: 'SCORE_ADJUST', side: 'home', delta: 1 },
      { now: Date.now(), actor: UID_A },
    );
    expect(outcome.status).toBe('missing');
  });
});

describe('clock transactions under concurrency', () => {
  it('start and pause issued nearly together leave the clock in one coherent state', async () => {
    await seedBoard(env, T0);
    const dbA = operatorDb(env, UID_A);
    const dbB = operatorDb(env, UID_B);
    await Promise.all([primeBoard(env, UID_A), primeBoard(env, UID_B)]);

    await Promise.all([
      dispatchWithRetry(
        dbA,
        TENANT,
        BOARD,
        { type: 'GAME_CLOCK_START' },
        { now: Date.now(), actor: UID_A },
      ),
      dispatchWithRetry(
        dbB,
        TENANT,
        BOARD,
        { type: 'GAME_CLOCK_PAUSE' },
        { now: Date.now() + 5, actor: UID_B },
      ),
    ]);

    const final = await readState(UID_A);
    // Whichever of the two actually ran last, the invariant the whole design
    // rests on must hold: running iff a deadline is set.
    expect(final.gameClock.running).toBe(final.gameClock.endsAt !== null);
  });
});
