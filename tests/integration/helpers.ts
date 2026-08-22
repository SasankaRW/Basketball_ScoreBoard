import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Database } from 'firebase/database';
import { createInitialState, DEFAULT_CONFIG, type BoardState } from '../../src/core/schema.js';

export const TENANT = 'tnt_integration01';
export const BOARD = 'brd_integration01';
export const UID_A = 'uid_operator_a';
export const UID_B = 'uid_operator_b';

export async function createIntegrationEnv(): Promise<RulesTestEnvironment> {
  const root = process.cwd();
  return initializeTestEnvironment({
    projectId: 'scoreboard-integration-test',
    database: {
      rules: readFileSync(resolve(root, 'database.rules.json'), 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
}

/**
 * @firebase/rules-unit-testing types `.database()` as the legacy namespaced
 * `firebase.database.Database` rather than the modular type, even though the
 * object it returns is the same modular `Database` instance underneath and
 * works fine with `ref`/`get`/`set`/`runTransaction` at runtime — this is a gap
 * in that package's own type declarations, not a real incompatibility. The
 * functions under test (`dispatchAction`, `dispatchWithRetry`) are typed
 * against the real modular `Database`, so the cast is necessary here; it would
 * be unsound if the two were actually different objects, which they are not.
 *
 * Memoized per (environment, uid): a real operator's browser tab holds exactly
 * one persistent connection, and `env.authenticatedContext()` mints a brand new
 * underlying app + socket on every call — asking for a fresh one per read or
 * write, as a naive helper would, piles up parallel connections that no
 * production client ever has and makes the emulator's transaction retry
 * bookkeeping (which is keyed per connection) misbehave under concurrent load.
 */
const dbCache = new WeakMap<RulesTestEnvironment, Map<string, Database>>();

export function operatorDb(env: RulesTestEnvironment, uid: string): Database {
  let forEnv = dbCache.get(env);
  if (!forEnv) {
    forEnv = new Map();
    dbCache.set(env, forEnv);
  }
  let db = forEnv.get(uid);
  if (!db) {
    db = env
      .authenticatedContext(uid, { tenantId: TENANT, role: 'operator' })
      .database() as unknown as Database;
    forEnv.set(uid, db);
  }
  return db;
}

/**
 * Primes a connection's local sync cache by reading the board once before it
 * takes part in a race.
 *
 * Every real page in this app calls `subscribeBoardState` (an `onValue`
 * listener) the moment it mounts, long before a user can trigger a dispatch —
 * so in production, a transaction's first attempt almost always already knows
 * the current value and needs no round trip to find out. A freshly created
 * test connection has no such listener, so without this priming step every
 * dispatch pays for a cold start that a real operator's browser tab never
 * experiences, understating how quickly `dispatchWithRetry` actually converges.
 */
export async function primeBoard(env: RulesTestEnvironment, uid: string): Promise<void> {
  const { get, ref } = await import('firebase/database');
  await get(ref(operatorDb(env, uid), `live/${TENANT}/${BOARD}/state`));
}

export async function seedBoard(env: RulesTestEnvironment, now: number): Promise<BoardState> {
  const initial: BoardState = { ...createInitialState(DEFAULT_CONFIG, now, 'system'), rev: 1 };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { ref, set } = await import('firebase/database');
    await set(ref(ctx.database(), `live/${TENANT}/${BOARD}/state`), initial);
  });
  return initial;
}
