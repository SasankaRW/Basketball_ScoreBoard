/**
 * Exchanges a viewer key for a board-scoped, read-only Firebase session.
 *
 * This is the only unauthenticated endpoint in the system, which makes it the
 * one an attacker can reach without an account. Its defences, in order:
 *
 *   1. The key is 43 characters of a 64-symbol alphabet (~256 bits), so guessing
 *      is not a strategy.
 *   2. Rate limiting per board and per caller IP, so guessing is not even cheap.
 *   3. Constant-time hash comparison, so response timing leaks nothing.
 *   4. One generic error for every failure, so probing cannot distinguish
 *      "no such board" from "wrong key" and enumerate valid board IDs.
 *   5. The minted token carries `role: 'overlay' | 'mirror'` and a single
 *      `boardId`, which matches no write rule anywhere in database.rules.json.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { isValidId, isValidViewerKey } from '../../src/core/ids.js';
import { auth, consumeRateLimit, firestore, REGION, viewerKeyMatches } from './common.js';

const ExchangeInput = z.object({
  boardId: z.string(),
  key: z.string(),
});

/**
 * Deliberately identical for every failure mode. Distinguishing them would let a
 * caller enumerate which board IDs exist.
 */
function reject(): never {
  throw new HttpsError('permission-denied', 'This link is not valid.');
}

/**
 * Tokens are short-lived; the display pages refresh silently through the Firebase
 * SDK while the tab stays open. A rotated key therefore stops working on the next
 * page load rather than lingering for the life of the browser session.
 */
export const exchangeViewerKey = onCall(
  { region: REGION, maxInstances: 20, cors: true },
  async (request) => {
    const parsed = ExchangeInput.safeParse(request.data);
    if (!parsed.success) reject();

    const { boardId, key } = parsed.data;
    if (!isValidId(boardId, 'brd') || !isValidViewerKey(key)) reject();

    const callerIp = request.rawRequest?.ip ?? 'unknown';
    await consumeRateLimit('viewerKeyIp', callerIp, { limit: 30, windowMs: 60_000 });
    await consumeRateLimit('viewerKeyBoard', boardId, { limit: 60, windowMs: 60_000 });

    const indexSnapshot = await firestore.collection('boardIndex').doc(boardId).get();
    const tenantId = indexSnapshot.data()?.['tenantId'];
    if (typeof tenantId !== 'string') reject();

    const boardSnapshot = await firestore
      .collection('tenants')
      .doc(tenantId)
      .collection('boards')
      .doc(boardId)
      .get();
    if (!boardSnapshot.exists) reject();

    const board = boardSnapshot.data() ?? {};
    if (board['archived'] === true) reject();

    // Which key was presented decides the role. A mirror key cannot claim the
    // overlay role, or the reverse, because the caller never names it.
    const role = viewerKeyMatches(key, board['overlayKeyHash'])
      ? 'overlay'
      : viewerKeyMatches(key, board['mirrorKeyHash'])
        ? 'mirror'
        : reject();

    const token = await auth.createCustomToken(`viewer_${role}_${boardId}`, {
      tenantId,
      boardId,
      role,
    });

    return { token, tenantId, boardId, role };
  },
);
