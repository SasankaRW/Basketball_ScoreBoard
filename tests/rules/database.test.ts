/**
 * Realtime Database security rules — the live-plane isolation proof.
 *
 * These tests are the evidence behind the multi-tenant claim. Everything else in
 * the system assumes that a token carrying tenant A cannot reach tenant B's game
 * state; this file is where that is actually demonstrated against real rules
 * running in the emulator, rather than asserted in a design document.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';
import {
  BOARD_A1,
  BOARD_A2,
  BOARD_B1,
  claims,
  createTestEnv,
  statePath,
  TENANT_A,
  TENANT_B,
  UID_ADMIN_A,
  UID_OPERATOR_A,
  UID_OPERATOR_B,
  UID_OWNER_A,
  UID_VIEWER_A,
  validState,
} from './helpers.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
  // Seed one board in each tenant with security rules bypassed.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, statePath(TENANT_A, BOARD_A1)), validState());
    await set(ref(db, statePath(TENANT_A, BOARD_A2)), validState());
    await set(ref(db, statePath(TENANT_B, BOARD_B1)), validState());
  });
});

function as(uid: string, tenantId: string, role: Parameters<typeof claims>[1], boardId?: string) {
  return env.authenticatedContext(uid, claims(tenantId, role, boardId)).database();
}

describe('cross-tenant isolation', () => {
  it("denies reading another tenant's board", async () => {
    const db = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(get(ref(db, statePath(TENANT_B, BOARD_B1))));
  });

  it("denies writing another tenant's board", async () => {
    const db = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(set(ref(db, statePath(TENANT_B, BOARD_B1)), validState({ rev: 2 })));
  });

  it('denies a token whose tenant claim names a tenant it does not belong to', async () => {
    // The claim is the only identity the rules consult, so this proves that
    // forging the *path* is useless without a matching, Function-issued claim.
    const db = as(UID_OPERATOR_B, TENANT_B, 'operator');
    await assertFails(get(ref(db, statePath(TENANT_A, BOARD_A1))));
  });

  it("allows an operator full access within their own tenant's boards", async () => {
    const db = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertSucceeds(get(ref(db, statePath(TENANT_A, BOARD_A1))));
    await assertSucceeds(get(ref(db, statePath(TENANT_A, BOARD_A2))));
    await assertSucceeds(set(ref(db, statePath(TENANT_A, BOARD_A1)), validState({ rev: 2 })));
  });
});

describe('unauthenticated access', () => {
  it('denies reads and writes outright', async () => {
    const db = env.unauthenticatedContext().database();
    await assertFails(get(ref(db, statePath(TENANT_A, BOARD_A1))));
    await assertFails(set(ref(db, statePath(TENANT_A, BOARD_A1)), validState({ rev: 2 })));
  });

  it('denies a signed-in token that carries no tenant claim at all', async () => {
    const db = env.authenticatedContext('uid_stranger', {}).database();
    await assertFails(get(ref(db, statePath(TENANT_A, BOARD_A1))));
  });
});

describe('roles', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['operator', true],
    ['viewer', false],
  ] as const)('write permission for %s is %s', async (role, allowed) => {
    const db = as(`uid_${role}`, TENANT_A, role);
    const write = set(ref(db, statePath(TENANT_A, BOARD_A1)), validState({ rev: 2 }));
    await (allowed ? assertSucceeds(write) : assertFails(write));
  });

  it('lets a viewer read the board they cannot write', async () => {
    const db = as(UID_VIEWER_A, TENANT_A, 'viewer');
    await assertSucceeds(get(ref(db, statePath(TENANT_A, BOARD_A1))));
  });

  it('lets an owner and an admin write in turn, each advancing rev', async () => {
    await assertSucceeds(
      set(
        ref(as(UID_OWNER_A, TENANT_A, 'owner'), statePath(TENANT_A, BOARD_A1)),
        validState({ rev: 2 }),
      ),
    );
    await assertSucceeds(
      set(
        ref(as(UID_ADMIN_A, TENANT_A, 'admin'), statePath(TENANT_A, BOARD_A1)),
        validState({ rev: 3 }),
      ),
    );
  });
});

describe('viewer keys (overlay and mirror machine tokens)', () => {
  it('reads exactly the one board the token was minted for', async () => {
    const db = as('overlay_conn', TENANT_A, 'overlay', BOARD_A1);
    await assertSucceeds(get(ref(db, statePath(TENANT_A, BOARD_A1))));
  });

  it('cannot read a different board in the same tenant', async () => {
    // An overlay URL leaked from one court must not expose the next one.
    const db = as('overlay_conn', TENANT_A, 'overlay', BOARD_A1);
    await assertFails(get(ref(db, statePath(TENANT_A, BOARD_A2))));
  });

  it('cannot read another tenant at all', async () => {
    const db = as('overlay_conn', TENANT_A, 'overlay', BOARD_A1);
    await assertFails(get(ref(db, statePath(TENANT_B, BOARD_B1))));
  });

  it.each(['overlay', 'mirror'] as const)('%s tokens are strictly read-only', async (role) => {
    const db = as(`${role}_conn`, TENANT_A, role, BOARD_A1);
    await assertSucceeds(get(ref(db, statePath(TENANT_A, BOARD_A1))));
    await assertFails(set(ref(db, statePath(TENANT_A, BOARD_A1)), validState({ rev: 2 })));
  });

  it('denies a machine token with no board claim', async () => {
    const db = as('overlay_conn', TENANT_A, 'overlay');
    await assertFails(get(ref(db, statePath(TENANT_A, BOARD_A1))));
  });
});

describe('write validation', () => {
  const write = (state: unknown) =>
    set(ref(as(UID_OPERATOR_A, TENANT_A, 'operator'), statePath(TENANT_A, BOARD_A1)), state);

  it('enforces the optimistic lock: rev must advance by exactly one', async () => {
    await assertSucceeds(write(validState({ rev: 2 })));
    // A stale writer that still believes rev is 1 is rejected by the database,
    // not merely by client-side courtesy.
    await assertFails(write(validState({ rev: 2 })));
    await assertFails(write(validState({ rev: 5 })));
    await assertFails(write(validState({ rev: 1 })));
    await assertSucceeds(write(validState({ rev: 3 })));
  });

  it('rejects a score beyond the display range', async () => {
    const base = validState({ rev: 2 });
    await assertFails(write({ ...base, home: { ...base.home, score: 1_000 } }));
    await assertFails(write({ ...base, home: { ...base.home, score: -1 } }));
  });

  it('rejects out-of-range fouls, timeouts and period', async () => {
    const base = validState({ rev: 2 });
    await assertFails(write({ ...base, home: { ...base.home, fouls: 100 } }));
    await assertFails(write({ ...base, away: { ...base.away, timeouts: 100 } }));
    await assertFails(write({ ...base, period: 0 }));
    await assertFails(write({ ...base, period: 11 }));
  });

  it('rejects an empty or oversized team name', async () => {
    const base = validState({ rev: 2 });
    await assertFails(write({ ...base, home: { ...base.home, name: '' } }));
    await assertFails(write({ ...base, home: { ...base.home, name: 'X'.repeat(25) } }));
  });

  it('rejects an unknown field, so a client cannot smuggle data into live state', async () => {
    await assertFails(write({ ...validState({ rev: 2 }), injected: 'payload' }));
  });

  it('rejects a possession value outside home/away', async () => {
    await assertFails(write({ ...validState({ rev: 2 }), possession: 'referee' }));
  });

  /**
   * The deadline clock's core invariant, enforced server-side: a clock is running
   * if and only if it carries a deadline. Without this a client could store
   * `running: true` with no `endsAt` and every viewer would render a frozen clock.
   */
  it('rejects a running clock with no deadline', async () => {
    const base = validState({ rev: 2 });
    await assertFails(write({ ...base, gameClock: { running: true, remainingMs: 600_000 } }));
  });

  it('rejects a paused clock that still carries a deadline', async () => {
    const base = validState({ rev: 2 });
    await assertFails(
      write({
        ...base,
        gameClock: { running: false, endsAt: Date.now() + 600_000, remainingMs: 600_000 },
      }),
    );
  });

  it('accepts a correctly-formed running clock', async () => {
    const base = validState({ rev: 2 });
    await assertSucceeds(
      write({
        ...base,
        gameClock: { running: true, endsAt: Date.now() + 600_000, remainingMs: 600_000 },
      }),
    );
  });

  it('rejects a shot clock longer than its two-digit display', async () => {
    const base = validState({ rev: 2 });
    await assertFails(write({ ...base, shotClock: { running: false, remainingMs: 100_000 } }));
  });

  it('rejects a missing required field', async () => {
    const base = validState({ rev: 2 }) as Record<string, unknown>;
    delete base['config'];
    await assertFails(write(base));
  });

  it('rejects an updatedAt far outside the server clock window', async () => {
    await assertFails(write(validState({ rev: 2, updatedAt: Date.now() + 86_400_000 })));
  });

  describe('match tracking fields', () => {
    it('rejects a write with matchStartedAt missing entirely', async () => {
      const base = validState({ rev: 2 }) as Record<string, unknown>;
      delete base['matchStartedAt'];
      await assertFails(write(base));
    });

    it('rejects a non-numeric matchStartedAt', async () => {
      await assertFails(write({ ...validState({ rev: 2 }), matchStartedAt: 'yesterday' }));
    });

    it('accepts a board with no period scores yet, matching a fresh game', async () => {
      // periodScores: {} is what createInitialState produces and is what RTDB
      // actually stores for an empty object — omitted entirely.
      await assertSucceeds(write(validState({ rev: 2 })));
    });

    it('accepts a well-formed period score entry', async () => {
      await assertSucceeds(
        write({
          ...validState({ rev: 2 }),
          periodScores: { '1': { home: 18, away: 15 } },
        }),
      );
    });

    it('rejects a period score entry missing a side', async () => {
      const base = validState({ rev: 2 });
      await assertFails(write({ ...base, periodScores: { '1': { home: 18 } } }));
    });

    it('rejects a period score entry with an out-of-range value', async () => {
      const base = validState({ rev: 2 });
      await assertFails(write({ ...base, periodScores: { '1': { home: 1000, away: 15 } } }));
      await assertFails(write({ ...base, periodScores: { '1': { home: -1, away: 15 } } }));
    });

    it('rejects an unknown field inside a period score entry', async () => {
      const base = validState({ rev: 2 });
      await assertFails(
        write({ ...base, periodScores: { '1': { home: 18, away: 15, bonus: true } } }),
      );
    });

    it('accepts a board linked to a schedule entry', async () => {
      await assertSucceeds(write({ ...validState({ rev: 2 }), scheduleId: 'sch_abc123' }));
    });

    it('rejects an oversized scheduleId', async () => {
      await assertFails(write({ ...validState({ rev: 2 }), scheduleId: 'x'.repeat(200) }));
    });

    it('accepts a board with no scheduleId, matching a game started the ordinary way', async () => {
      // scheduleId: null is what createInitialState produces by default and is
      // what RTDB actually stores — omitted entirely, just like periodScores.
      await assertSucceeds(write(validState({ rev: 2 })));
    });
  });
});

describe('paths outside the live tree', () => {
  it('denies the legacy single-tenant node that the old app wrote to', async () => {
    const db = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(get(ref(db, 'scoreboardState')));
    await assertFails(set(ref(db, 'scoreboardState'), { homeScore: 1 }));
  });

  it('denies writing arbitrary top-level nodes', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(set(ref(db, 'anything'), { a: 1 }));
  });
});
