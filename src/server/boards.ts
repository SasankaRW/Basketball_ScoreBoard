/**
 * Board lifecycle: creation, deletion, and viewer-key rotation.
 *
 * All three need privileges a client must not hold — the plaintext of a
 * viewer key, the board-to-tenant index that `exchangeViewerKey` trusts, or
 * live state that outlives the Firestore document.
 */
import { z } from 'zod';
import { generateBoardId, generateViewerKey, isValidId } from '../core/ids.js';
import { BoardConfigSchema, createInitialState, DEFAULT_CONFIG } from '../core/schema.js';
import {
  ApiError,
  database,
  firestore,
  hashViewerKey,
  limitsForPlan,
  writeAudit,
  type Caller,
} from './common.js';

export const CreateBoardInput = z.object({
  name: z.string().trim().min(1).max(60),
  config: BoardConfigSchema.partial().optional(),
});

export interface CreateBoardResult {
  boardId: string;
  overlayKey: string;
  mirrorKey: string;
}

export async function createBoard(
  caller: Caller,
  input: z.infer<typeof CreateBoardInput>,
): Promise<CreateBoardResult> {
  const tenantRef = firestore.collection('tenants').doc(caller.tenantId);
  const tenantSnapshot = await tenantRef.get();
  if (!tenantSnapshot.exists) throw new ApiError(404, 'Organisation not found.');

  const limits = limitsForPlan(tenantSnapshot.data()?.['plan']);
  const activeBoards = await tenantRef
    .collection('boards')
    .where('archived', '==', false)
    .count()
    .get();
  if (activeBoards.data().count >= limits.boards) {
    throw new ApiError(
      412,
      `Your plan allows ${limits.boards} active boards. Archive one or upgrade.`,
    );
  }

  const boardId = generateBoardId();
  const config = BoardConfigSchema.parse({ ...DEFAULT_CONFIG, ...(input.config ?? {}) });

  // Generated here and returned exactly once. Only the hashes are persisted,
  // so there is no path — for us or for an attacker with database access —
  // that recovers these strings later.
  const overlayKey = generateViewerKey();
  const mirrorKey = generateViewerKey();
  const now = Date.now();

  await firestore.runTransaction(async (tx) => {
    tx.set(tenantRef.collection('boards').doc(boardId), {
      name: input.name,
      sport: 'basketball',
      archived: false,
      config,
      theme: { logoUrl: null, homeColor: '#d64545', awayColor: '#3f7fd6' },
      overlayKeyHash: hashViewerKey(overlayKey),
      mirrorKeyHash: hashViewerKey(mirrorKey),
      createdAt: now,
      updatedAt: now,
      createdBy: caller.uid,
    });

    // Plaintext keys, readable only by admins, so the dashboard can
    // re-display a shareable link instead of forcing a rotation every time
    // someone loses one.
    tx.set(tenantRef.collection('boards').doc(boardId).collection('secrets').doc('viewerKeys'), {
      overlayKey,
      mirrorKey,
      updatedAt: now,
    });

    // Lets exchangeViewerKey resolve a board without being told its tenant.
    // Server-only collection: the security rules deny every client.
    tx.set(firestore.collection('boardIndex').doc(boardId), {
      tenantId: caller.tenantId,
      createdAt: now,
    });
  });

  await database
    .ref(`live/${caller.tenantId}/${boardId}/state`)
    .set({ ...createInitialState(config, now, caller.uid), rev: 1 });

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'BOARD_CREATED',
    boardId,
    detail: input.name,
  });

  return { boardId, overlayKey, mirrorKey };
}

export const BoardRefInput = z.object({ boardId: z.string() });

export async function deleteBoard(
  caller: Caller,
  input: z.infer<typeof BoardRefInput>,
): Promise<{ deleted: true }> {
  if (!isValidId(input.boardId, 'brd')) throw new ApiError(400, 'Unknown board.');
  const { boardId } = input;

  const boardRef = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('boards')
    .doc(boardId);
  const snapshot = await boardRef.get();
  if (!snapshot.exists) throw new ApiError(404, 'Board not found.');

  // Live state first: a board whose document is gone but whose state lingers
  // is orphaned data no one can reach, whereas the reverse is briefly
  // harmless.
  await database.ref(`live/${caller.tenantId}/${boardId}`).remove();
  await firestore.collection('boardIndex').doc(boardId).delete();
  await boardRef.delete();

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'BOARD_DELETED',
    boardId,
    detail: (snapshot.data()?.['name'] as string | undefined) ?? '',
  });

  return { deleted: true };
}

export const RotateViewerKeyInput = z.object({
  boardId: z.string(),
  kind: z.enum(['overlay', 'mirror']),
});

/**
 * Issues a replacement key and invalidates the old one immediately.
 *
 * This is the revocation path for a leaked mirror or overlay URL — the
 * moment the hash changes, every existing link stops exchanging.
 */
export async function rotateViewerKey(
  caller: Caller,
  input: z.infer<typeof RotateViewerKeyInput>,
): Promise<{ key: string }> {
  if (!isValidId(input.boardId, 'brd')) throw new ApiError(400, 'Unknown board.');
  const { boardId, kind } = input;

  const boardRef = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('boards')
    .doc(boardId);
  if (!(await boardRef.get()).exists) throw new ApiError(404, 'Board not found.');

  const key = generateViewerKey();
  const rotatedAt = Date.now();

  await firestore.runTransaction(async (tx) => {
    tx.update(boardRef, {
      [`${kind}KeyHash`]: hashViewerKey(key),
      [`${kind}KeyRotatedAt`]: rotatedAt,
      updatedAt: rotatedAt,
    });
    // Hash and plaintext move together; if they ever disagreed the dashboard
    // would hand out a link that the exchange endpoint rejects.
    tx.set(
      boardRef.collection('secrets').doc('viewerKeys'),
      { [`${kind}Key`]: key, updatedAt: rotatedAt },
      { merge: true },
    );
  });

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'VIEWER_KEY_ROTATED',
    boardId,
    detail: kind,
  });

  return { key };
}
