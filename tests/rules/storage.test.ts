/**
 * Cloud Storage security rules — the board-logo isolation proof.
 *
 * Complements database.test.ts and firestore.test.ts: this file protects the
 * one Storage object type the app writes today, the per-board tournament
 * logo at `tenants/{tenantId}/boards/{boardId}/logo`.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
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
  await env.clearStorage();
});

function as(uid: string, tenantId: string, role: Parameters<typeof claims>[1], boardId?: string) {
  return env.authenticatedContext(uid, claims(tenantId, role, boardId)).storage();
}

function logoPath(tenantId: string, boardId: string): string {
  return `tenants/${tenantId}/boards/${boardId}/logo`;
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]); // just needs a plausible size/type, not a real PNG
const OVERSIZED_BYTES = new Uint8Array(3 * 1024 * 1024); // over the 2MB cap

async function seedLogo(tenantId: string, boardId: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), logoPath(tenantId, boardId)), PNG_BYTES, {
      contentType: 'image/png',
    });
  });
}

describe('reading a board logo', () => {
  it("denies reading another tenant's logo", async () => {
    await seedLogo(TENANT_B, BOARD_B1);
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertFails(getBytes(ref(storage, logoPath(TENANT_B, BOARD_B1))));
  });

  it("allows a member to read their own tenant's logo", async () => {
    await seedLogo(TENANT_A, BOARD_A1);
    const storage = as(UID_VIEWER_A, TENANT_A, 'viewer');
    await assertSucceeds(getBytes(ref(storage, logoPath(TENANT_A, BOARD_A1))));
  });

  it('allows a mirror/overlay viewer session scoped to this exact board', async () => {
    await seedLogo(TENANT_A, BOARD_A1);
    const storage = as('uid_overlay', TENANT_A, 'overlay', BOARD_A1);
    await assertSucceeds(getBytes(ref(storage, logoPath(TENANT_A, BOARD_A1))));
  });

  it('denies a mirror/overlay viewer session scoped to a different board', async () => {
    await seedLogo(TENANT_A, BOARD_A1);
    const storage = as('uid_overlay', TENANT_A, 'overlay', 'brd_some_other');
    await assertFails(getBytes(ref(storage, logoPath(TENANT_A, BOARD_A1))));
  });
});

describe('uploading a board logo', () => {
  it('denies an operator — logo upload is admin+, matching board settings', async () => {
    const storage = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(
      uploadBytes(ref(storage, logoPath(TENANT_A, BOARD_A1)), PNG_BYTES, {
        contentType: 'image/png',
      }),
    );
  });

  it('allows an admin to upload a valid image within the size cap', async () => {
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertSucceeds(
      uploadBytes(ref(storage, logoPath(TENANT_A, BOARD_A1)), PNG_BYTES, {
        contentType: 'image/png',
      }),
    );
  });

  it('allows an owner to overwrite an existing logo', async () => {
    await seedLogo(TENANT_A, BOARD_A1);
    const storage = as(UID_OWNER_A, TENANT_A, 'owner');
    await assertSucceeds(
      uploadBytes(ref(storage, logoPath(TENANT_A, BOARD_A1)), PNG_BYTES, {
        contentType: 'image/png',
      }),
    );
  });

  it('denies an upload over the 2MB cap', async () => {
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertFails(
      uploadBytes(ref(storage, logoPath(TENANT_A, BOARD_A1)), OVERSIZED_BYTES, {
        contentType: 'image/png',
      }),
    );
  });

  it('denies a non-image content type', async () => {
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertFails(
      uploadBytes(ref(storage, logoPath(TENANT_A, BOARD_A1)), PNG_BYTES, {
        contentType: 'application/pdf',
      }),
    );
  });

  it("denies writing to another tenant's board path", async () => {
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertFails(
      uploadBytes(ref(storage, logoPath(TENANT_B, BOARD_B1)), PNG_BYTES, {
        contentType: 'image/png',
      }),
    );
  });
});

describe('removing a board logo', () => {
  it('allows an admin to delete their own tenant logo', async () => {
    await seedLogo(TENANT_A, BOARD_A1);
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertSucceeds(deleteObject(ref(storage, logoPath(TENANT_A, BOARD_A1))));
  });

  it('denies an operator from deleting a logo', async () => {
    await seedLogo(TENANT_A, BOARD_A1);
    const storage = as(UID_OPERATOR_A, TENANT_A, 'operator');
    await assertFails(deleteObject(ref(storage, logoPath(TENANT_A, BOARD_A1))));
  });

  it("denies deleting another tenant's logo", async () => {
    await seedLogo(TENANT_B, BOARD_B1);
    const storage = as(UID_ADMIN_A, TENANT_A, 'admin');
    await assertFails(deleteObject(ref(storage, logoPath(TENANT_B, BOARD_B1))));
  });
});
