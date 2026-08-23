/**
 * Period changes against a real Realtime Database.
 *
 * This file exists because of a bug that no unit test could have caught and no
 * unit test alone can keep away: RTDB re-types an integer-keyed object as a
 * sparse array on the way back out, so the `periodScores` map that
 * `NEXT_PERIOD` writes returns in a shape the schema rejects. The board then
 * parsed as absent and every following write was refused by the `rev` rule —
 * one click on "Start next period" bricked the board for the rest of the game.
 *
 * `tests/unit/schema.test.ts` pins the restoration logic against the shape the
 * emulator produced. This pins the shape itself, so the day a Firebase SDK
 * upgrade changes how the wire format is decoded, it fails here rather than
 * courtside.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get, ref, type Database } from 'firebase/database';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { dispatchWithRetry } from '../../src/core/liveState.js';
import { parseLiveBoardState } from '../../src/core/schema.js';
import {
  BOARD,
  createIntegrationEnv,
  operatorDb,
  primeBoard,
  seedBoard,
  TENANT,
  UID_A,
} from './helpers.js';

let env: RulesTestEnvironment;
let db: Database;

beforeAll(async () => {
  env = await createIntegrationEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
  await seedBoard(env, Date.now());
  db = operatorDb(env, UID_A);
  await primeBoard(env, UID_A);
});

const ctx = () => ({ now: Date.now(), actor: UID_A });

const nextPeriod = () => dispatchWithRetry(db, TENANT, BOARD, { type: 'NEXT_PERIOD' }, ctx());

const score = (delta: number) =>
  dispatchWithRetry(db, TENANT, BOARD, { type: 'SCORE_ADJUST', side: 'home', delta }, ctx());

const rawState = async (): Promise<unknown> =>
  (await get(ref(db, `live/${TENANT}/${BOARD}/state`))).val();

describe('period changes over the wire', () => {
  it('keeps the board usable through four periods', async () => {
    for (let period = 1; period <= 4; period += 1) {
      const scored = await score(2);
      expect(scored.status, `scoring in period ${period}`).toBe('committed');

      const advanced = await nextPeriod();
      expect(advanced.status, `leaving period ${period}`).toBe('committed');
    }

    const state = parseLiveBoardState(await rawState());
    expect(state).not.toBeNull();
    expect(state?.period).toBe(5);
    expect(state?.home.score).toBe(8);
  });

  it('records the cumulative score at the end of each period', async () => {
    await score(2);
    await nextPeriod();
    await score(3);
    await nextPeriod();

    const state = parseLiveBoardState(await rawState());
    expect(state?.periodScores).toEqual({
      '1': { home: 2, away: 0 },
      '2': { home: 5, away: 0 },
    });
  });

  /**
   * The mangling itself, asserted directly. If this ever stops being an array,
   * the restoration in `parseLiveBoardState` is free to go — but it must be
   * deleted deliberately, on the evidence of this test, not on an assumption.
   *
   * Index 0 is a genuine hole rather than a stored null, which is why the
   * restoration relies on `forEach` skipping holes as well as checking for
   * null: `toEqual([null, …])` would pass against a dense null and quietly stop
   * describing what the database returns.
   */
  it('confirms RTDB really does hand periodScores back as a sparse array', async () => {
    await nextPeriod();

    const raw: unknown = (await get(ref(db, `live/${TENANT}/${BOARD}/state/periodScores`))).val();
    expect(Array.isArray(raw)).toBe(true);

    const array = raw as unknown[];
    expect(array).toHaveLength(2);
    expect(0 in array).toBe(false);
    expect(array[1]).toEqual({ home: 0, away: 0 });
  });
});
