/**
 * Firestore security rules — the control-plane isolation proof.
 *
 * Complements database.test.ts: that file protects the live game state, this one
 * protects the records that decide who may touch it. The sharpest test here is
 * that a tenant admin cannot rewrite a board's `overlayKeyHash` — otherwise an
 * admin could install a hash whose preimage they know and mint themselves an
 * unrevocable viewer URL.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import {
  BOARD_A1,
  BOARD_B1,
  claims,
  createTestEnv,
  TENANT_A,
  TENANT_B,
  UID_ADMIN_A,
  UID_OPERATOR_A,
  UID_OWNER_A,
  UID_VIEWER_A,
} from './helpers.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [tid, bid] of [
      [TENANT_A, BOARD_A1],
      [TENANT_B, BOARD_B1],
    ] as const) {
      await setDoc(doc(db, 'tenants', tid), {
        name: `Tenant ${tid}`,
        slug: tid,
        plan: 'pro',
        status: 'active',
        ownerUid: UID_OWNER_A,
        settings: {},
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'tenants', tid, 'members', UID_OWNER_A), {
        email: 'owner@example.com',
        role: 'owner',
        status: 'active',
      });
      await setDoc(doc(db, 'tenants', tid, 'boards', bid), {
        name: 'Court 1',
        sport: 'basketball',
        archived: false,
        config: {},
        theme: {},
        overlayKeyHash: 'hash-overlay',
        mirrorKeyHash: 'hash-mirror',
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'tenants', tid, 'boards', bid, 'secrets', 'viewerKeys'), {
        overlayKey: 'plaintext-overlay-key',
        mirrorKey: 'plaintext-mirror-key',
      });
      await setDoc(doc(db, 'tenants', tid, 'audit', 'evt_1'), {
        actorUid: UID_OPERATOR_A,
        action: 'SCORE_ADJUST',
        boardId: bid,
        ts: Date.now(),
      });
      await setDoc(doc(db, 'tenants', tid, 'matches', 'mtc_1'), {
        boardId: bid,
        boardName: 'Court 1',
        homeTeamName: 'Hawks',
        awayTeamName: 'Comets',
        homeScore: 68,
        awayScore: 72,
        periodScores: [],
        createdBy: UID_OPERATOR_A,
        endedAt: Date.now(),
      });
      await setDoc(doc(db, 'tenants', tid, 'schedule', 'sch_scheduled'), {
        homeTeamName: 'Eagles',
        awayTeamName: 'Wolves',
        scheduledAt: Date.now() + 3_600_000,
        notes: '',
        config: null,
        status: 'scheduled',
        boardId: null,
        matchId: null,
        createdBy: UID_OWNER_A,
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'tenants', tid, 'schedule', 'sch_in_progress'), {
        homeTeamName: 'Bears',
        awayTeamName: 'Lions',
        scheduledAt: Date.now(),
        notes: '',
        config: null,
        status: 'in_progress',
        boardId: bid,
        matchId: null,
        createdBy: UID_OWNER_A,
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'tenants', tid, 'schedule', 'sch_completed'), {
        homeTeamName: 'Sharks',
        awayTeamName: 'Falcons',
        scheduledAt: Date.now() - 3_600_000,
        notes: '',
        config: null,
        status: 'completed',
        boardId: bid,
        matchId: 'mtc_1',
        createdBy: UID_OWNER_A,
        createdAt: Date.now(),
      });
    }
    await setDoc(doc(db, 'userIndex', UID_OWNER_A), { tenantId: TENANT_A });
  });
});

function as(uid: string, tenantId: string, role: Parameters<typeof claims>[1]) {
  return env.authenticatedContext(uid, claims(tenantId, role)).firestore();
}

describe('tenant document', () => {
  it('is readable by its own members', async () => {
    await assertSucceeds(getDoc(doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), 'tenants', TENANT_A)));
  });

  it('is not readable across tenants', async () => {
    await assertFails(getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants', TENANT_B)));
  });

  it('cannot be enumerated', async () => {
    await assertFails(getDocs(collection(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants')));
  });

  it('cannot be created or deleted by any client, including the owner', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(setDoc(doc(db, 'tenants', 'tnt_forged'), { name: 'Forged' }));
    await assertFails(deleteDoc(doc(db, 'tenants', TENANT_A)));
  });

  it('lets an admin rename it', async () => {
    await assertSucceeds(
      updateDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A), { name: 'New Name' }),
    );
  });

  it('does not let an admin change their own plan', async () => {
    await assertFails(
      updateDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A), {
        plan: 'enterprise',
      }),
    );
  });

  it('does not let an operator or viewer edit it', async () => {
    await assertFails(
      updateDoc(doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), 'tenants', TENANT_A), { name: 'X' }),
    );
    await assertFails(
      updateDoc(doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), 'tenants', TENANT_A), { name: 'X' }),
    );
  });

  /**
   * The shared shortcut layout lives at `settings.keymap` on this document
   * rather than in a collection of its own, precisely so it inherits these
   * clauses instead of adding a new surface to prove. These cases pin that
   * inheritance: every member reads the layout they score with, only
   * owner/admin change it for the organisation, and it does not cross tenants.
   *
   * The write is a *dotted path*, which is what the client sends — a
   * whole-`settings` write would pass the same rule but drop every other
   * setting, so testing the merge form is testing what actually ships.
   */
  describe('shared shortcut keymap', () => {
    const KEYMAP = { 'score.home.plus1': { code: 'Mouse0', shift: true } };

    it('is readable by every member role, since everyone scores with it', async () => {
      for (const [uid, role] of [
        [UID_OWNER_A, 'owner'],
        [UID_ADMIN_A, 'admin'],
        [UID_OPERATOR_A, 'operator'],
        [UID_VIEWER_A, 'viewer'],
      ] as const) {
        await assertSucceeds(getDoc(doc(as(uid, TENANT_A, role), 'tenants', TENANT_A)));
      }
    });

    it('lets an owner or admin set it', async () => {
      for (const [uid, role] of [
        [UID_OWNER_A, 'owner'],
        [UID_ADMIN_A, 'admin'],
      ] as const) {
        await assertSucceeds(
          updateDoc(doc(as(uid, TENANT_A, role), 'tenants', TENANT_A), {
            'settings.keymap': KEYMAP,
          }),
        );
      }
    });

    it('does not let an operator or viewer set it', async () => {
      for (const [uid, role] of [
        [UID_OPERATOR_A, 'operator'],
        [UID_VIEWER_A, 'viewer'],
      ] as const) {
        await assertFails(
          updateDoc(doc(as(uid, TENANT_A, role), 'tenants', TENANT_A), {
            'settings.keymap': KEYMAP,
          }),
        );
      }
    });

    it('cannot be set in another tenant', async () => {
      await assertFails(
        updateDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants', TENANT_B), {
          'settings.keymap': KEYMAP,
        }),
      );
    });

    /**
     * Sharing the document with `name` is the cost of not adding a new
     * surface, so this checks the allowlist still holds: an admin writing the
     * keymap cannot smuggle a privileged field along beside it.
     */
    it('cannot carry a privileged field along with it', async () => {
      await assertFails(
        updateDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A), {
          'settings.keymap': KEYMAP,
          plan: 'enterprise',
        }),
      );
      await assertFails(
        updateDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A), {
          'settings.keymap': KEYMAP,
          status: 'suspended',
        }),
      );
    });
  });
});

describe('members', () => {
  it('are readable inside the tenant', async () => {
    await assertSucceeds(
      getDoc(
        doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), 'tenants', TENANT_A, 'members', UID_OWNER_A),
      ),
    );
  });

  it('are not readable across tenants', async () => {
    await assertFails(
      getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants', TENANT_B, 'members', UID_OWNER_A)),
    );
  });

  /**
   * Roles live in auth custom claims. A client that could write this document
   * would be able to display a role it does not actually hold, so writes are
   * Functions-only and the two can never drift apart.
   */
  it('cannot be written by a client, not even the owner promoting someone', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(
      setDoc(doc(db, 'tenants', TENANT_A, 'members', 'uid_new'), {
        role: 'admin',
        status: 'active',
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'tenants', TENANT_A, 'members', UID_OWNER_A), { role: 'owner' }),
    );
  });
});

describe('boards', () => {
  it('are readable by any member of the tenant', async () => {
    await assertSucceeds(
      getDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), 'tenants', TENANT_A, 'boards', BOARD_A1),
      ),
    );
  });

  it('are not readable across tenants', async () => {
    await assertFails(
      getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants', TENANT_B, 'boards', BOARD_B1)),
    );
  });

  it('can be renamed and reconfigured by an admin', async () => {
    const ref = doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A, 'boards', BOARD_A1);
    await assertSucceeds(updateDoc(ref, { name: 'Court 2' }));
    await assertSucceeds(updateDoc(ref, { config: { periodLengthMs: 720000 } }));
    await assertSucceeds(updateDoc(ref, { archived: true }));
  });

  /**
   * The single most important rule in this file. Viewer URLs are revoked by
   * rotating a hash; an admin who could overwrite the hash directly could mint a
   * permanent key for themselves that rotation would never invalidate.
   */
  it('never let a client touch the viewer key hashes', async () => {
    const ref = doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A, 'boards', BOARD_A1);
    await assertFails(updateDoc(ref, { overlayKeyHash: 'attacker-controlled' }));
    await assertFails(updateDoc(ref, { mirrorKeyHash: 'attacker-controlled' }));
    // Not even smuggled alongside a legitimate field.
    await assertFails(updateDoc(ref, { name: 'Court 2', overlayKeyHash: 'attacker-controlled' }));
  });

  it('cannot be created or deleted by a client', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(
      setDoc(doc(db, 'tenants', TENANT_A, 'boards', 'brd_forged'), { name: 'Forged' }),
    );
    await assertFails(deleteDoc(doc(db, 'tenants', TENANT_A, 'boards', BOARD_A1)));
  });

  it('cannot be edited by an operator', async () => {
    await assertFails(
      updateDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), 'tenants', TENANT_A, 'boards', BOARD_A1),
        { name: 'Court 2' },
      ),
    );
  });
});

describe('viewer key secrets', () => {
  const path = (tid: string, bid: string) =>
    ['tenants', tid, 'boards', bid, 'secrets', 'viewerKeys'] as const;

  it('is readable by owners and admins, who hand out the links', async () => {
    await assertSucceeds(
      getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), ...path(TENANT_A, BOARD_A1))),
    );
    await assertSucceeds(
      getDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), ...path(TENANT_A, BOARD_A1))),
    );
  });

  /**
   * An operator can see the board exists and run the game on it, but handing
   * them a permanent shareable URL is a separate, higher privilege.
   */
  it('is hidden from operators and viewers', async () => {
    await assertFails(
      getDoc(doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), ...path(TENANT_A, BOARD_A1))),
    );
    await assertFails(
      getDoc(doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), ...path(TENANT_A, BOARD_A1))),
    );
  });

  it('is not readable across tenants', async () => {
    await assertFails(getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), ...path(TENANT_B, BOARD_B1))));
  });

  it('is never client-writable, so a key cannot be replaced with a known one', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(setDoc(doc(db, ...path(TENANT_A, BOARD_A1)), { overlayKey: 'attacker' }));
    await assertFails(updateDoc(doc(db, ...path(TENANT_A, BOARD_A1)), { overlayKey: 'attacker' }));
  });
});

describe('matches', () => {
  it('is readable by any member of the tenant, including a viewer', async () => {
    await assertSucceeds(
      getDoc(doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), 'tenants', TENANT_A, 'matches', 'mtc_1')),
    );
    await assertSucceeds(
      getDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), 'tenants', TENANT_A, 'matches', 'mtc_1'),
      ),
    );
  });

  it('is not readable across tenants', async () => {
    await assertFails(
      getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants', TENANT_B, 'matches', 'mtc_1')),
    );
  });

  it('is never client-writable — finishMatch computes every metric server-side', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(
      setDoc(doc(db, 'tenants', TENANT_A, 'matches', 'mtc_forged'), { homeScore: 999 }),
    );
    await assertFails(
      updateDoc(doc(db, 'tenants', TENANT_A, 'matches', 'mtc_1'), { homeScore: 999 }),
    );
    await assertFails(deleteDoc(doc(db, 'tenants', TENANT_A, 'matches', 'mtc_1')));
  });
});

describe('schedule', () => {
  const scheduleDoc = (tid: string, id: string) => ['tenants', tid, 'schedule', id] as const;

  const draftEntry = (overrides: Record<string, unknown> = {}) => ({
    homeTeamName: 'Hawks',
    awayTeamName: 'Comets',
    scheduledAt: Date.now() + 3_600_000,
    notes: '',
    config: null,
    status: 'scheduled',
    boardId: null,
    matchId: null,
    createdBy: UID_OPERATOR_A,
    createdAt: Date.now(),
    ...overrides,
  });

  it('is readable by any member of the tenant', async () => {
    await assertSucceeds(
      getDoc(doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), ...scheduleDoc(TENANT_A, 'sch_scheduled'))),
    );
  });

  it('is not readable across tenants', async () => {
    await assertFails(
      getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), ...scheduleDoc(TENANT_B, 'sch_scheduled'))),
    );
  });

  it('can be created by an operator with boardId and matchId unset', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), ...scheduleDoc(TENANT_A, 'sch_new')),
        draftEntry(),
      ),
    );
  });

  it('cannot be created by a viewer', async () => {
    await assertFails(
      setDoc(
        doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), ...scheduleDoc(TENANT_A, 'sch_new')),
        draftEntry(),
      ),
    );
  });

  it('cannot be created already tied to a board or a match', async () => {
    const db = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(
      setDoc(
        doc(db, ...scheduleDoc(TENANT_A, 'sch_new')),
        draftEntry({ boardId: 'brd_a1aaaaaaaaa' }),
      ),
    );
    await assertFails(
      setDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_new')), draftEntry({ matchId: 'mtc_1' })),
    );
  });

  it('cannot be created with any status other than scheduled', async () => {
    await assertFails(
      setDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), ...scheduleDoc(TENANT_A, 'sch_new')),
        draftEntry({ status: 'in_progress' }),
      ),
    );
  });

  it('can be edited — teams, time, notes, config — while still scheduled', async () => {
    await assertSucceeds(
      updateDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), ...scheduleDoc(TENANT_A, 'sch_scheduled')),
        { homeTeamName: 'Renamed Hawks', scheduledAt: Date.now() + 7_200_000 },
      ),
    );
  });

  it('can be cancelled by setting status to cancelled', async () => {
    await assertSucceeds(
      updateDoc(
        doc(as(UID_ADMIN_A, TENANT_A, 'admin'), ...scheduleDoc(TENANT_A, 'sch_scheduled')),
        { status: 'cancelled' },
      ),
    );
  });

  it('cannot be pushed to in_progress or completed by a client — Functions-only', async () => {
    const db = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(
      updateDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_scheduled')), { status: 'in_progress' }),
    );
    await assertFails(
      updateDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_scheduled')), { status: 'completed' }),
    );
  });

  it('cannot be edited once it is no longer scheduled', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(
      updateDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_in_progress')), { homeTeamName: 'Renamed' }),
    );
    await assertFails(
      updateDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_completed')), { homeTeamName: 'Renamed' }),
    );
  });

  it('rejects an update that smuggles a change to boardId alongside an allowed field', async () => {
    await assertFails(
      updateDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), ...scheduleDoc(TENANT_A, 'sch_scheduled')),
        { homeTeamName: 'Renamed', boardId: 'brd_a1aaaaaaaaa' },
      ),
    );
  });

  it('cannot be edited by a viewer', async () => {
    await assertFails(
      updateDoc(
        doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), ...scheduleDoc(TENANT_A, 'sch_scheduled')),
        { homeTeamName: 'Renamed' },
      ),
    );
  });

  it('can be deleted by an admin while scheduled or cancelled, but not by an operator', async () => {
    await assertFails(
      deleteDoc(
        doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), ...scheduleDoc(TENANT_A, 'sch_scheduled')),
      ),
    );
    await assertSucceeds(
      deleteDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), ...scheduleDoc(TENANT_A, 'sch_scheduled'))),
    );
  });

  it('cannot be deleted once completed or in progress, even by an owner', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(deleteDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_completed'))));
    await assertFails(deleteDoc(doc(db, ...scheduleDoc(TENANT_A, 'sch_in_progress'))));
  });
});

describe('audit log', () => {
  it('is readable by owners and admins', async () => {
    await assertSucceeds(
      getDoc(doc(as(UID_OWNER_A, TENANT_A, 'owner'), 'tenants', TENANT_A, 'audit', 'evt_1')),
    );
    await assertSucceeds(
      getDoc(doc(as(UID_ADMIN_A, TENANT_A, 'admin'), 'tenants', TENANT_A, 'audit', 'evt_1')),
    );
  });

  it('is not readable by operators or viewers', async () => {
    await assertFails(
      getDoc(doc(as(UID_OPERATOR_A, TENANT_A, 'operator'), 'tenants', TENANT_A, 'audit', 'evt_1')),
    );
    await assertFails(
      getDoc(doc(as(UID_VIEWER_A, TENANT_A, 'viewer'), 'tenants', TENANT_A, 'audit', 'evt_1')),
    );
  });

  it('is append-only: no client may write or rewrite history', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(setDoc(doc(db, 'tenants', TENANT_A, 'audit', 'evt_2'), { action: 'FAKE' }));
    await assertFails(
      updateDoc(doc(db, 'tenants', TENANT_A, 'audit', 'evt_1'), { action: 'EDITED' }),
    );
    await assertFails(deleteDoc(doc(db, 'tenants', TENANT_A, 'audit', 'evt_1')));
  });
});

describe('userIndex bootstrap lookup', () => {
  it('lets a user resolve only their own tenant', async () => {
    const ctx = env.authenticatedContext(UID_OWNER_A, {}).firestore();
    await assertSucceeds(getDoc(doc(ctx, 'userIndex', UID_OWNER_A)));
    await assertFails(getDoc(doc(ctx, 'userIndex', 'uid_someone_else')));
  });

  it('is not client-writable', async () => {
    const ctx = env.authenticatedContext(UID_OWNER_A, {}).firestore();
    await assertFails(setDoc(doc(ctx, 'userIndex', UID_OWNER_A), { tenantId: TENANT_B }));
  });
});

describe('default deny', () => {
  it('rejects collections that have no rule of their own', async () => {
    const db = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertFails(getDoc(doc(db, 'secrets', 'anything')));
    await assertFails(setDoc(doc(db, 'secrets', 'anything'), { a: 1 }));
  });

  it('rejects an unauthenticated caller everywhere', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'tenants', TENANT_A)));
    await assertFails(getDoc(doc(db, 'tenants', TENANT_A, 'boards', BOARD_A1)));
  });
});
