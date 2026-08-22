/**
 * Match lifecycle: finishing a live game into permanent history, and starting
 * a scheduled game onto a board.
 *
 * Both are Functions rather than client writes for the same reason as
 * `createBoard`/`rotateViewerKey`: each touches something a client must not be
 * trusted to compute or enforce itself — `finishMatch` derives every metric
 * from the board's *actual* live state rather than trusting whatever a client
 * claims the score was, and `startScheduledMatch` enforces the "board must be
 * idle" rule server-side rather than relying on a UI that merely hints at it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { isValidId } from '../../src/core/ids.js';
import { buildMatchRecord } from '../../src/core/matchRecord.js';
import {
  createInitialState,
  isBoardIdle,
  mergeBoardConfig,
  parseLiveBoardState,
  type BoardState,
} from '../../src/core/schema.js';
import { database, firestore, REGION, requireRole, writeAudit } from './common.js';

function boardsCollection(tenantId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('boards');
}

function scheduleCollection(tenantId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('schedule');
}

// ---------------------------------------------------------------------------
// finishMatch
// ---------------------------------------------------------------------------

const FinishMatchInput = z.object({ boardId: z.string() });

export const finishMatch = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const caller = requireRole(request, 'operator');

  const parsed = FinishMatchInput.safeParse(request.data);
  if (!parsed.success || !isValidId(parsed.data.boardId, 'brd')) {
    throw new HttpsError('invalid-argument', 'Unknown board.');
  }
  const { boardId } = parsed.data;

  const boardRef = boardsCollection(caller.tenantId).doc(boardId);
  const boardSnapshot = await boardRef.get();
  if (!boardSnapshot.exists) throw new HttpsError('not-found', 'Board not found.');
  const boardName = (boardSnapshot.data()?.['name'] as string | undefined) ?? 'Board';

  const now = Date.now();
  const liveRef = database.ref(`live/${caller.tenantId}/${boardId}/state`);

  /**
   * Captures the pre-reset state in the updater's closure and resets the
   * board in the same RTDB transaction — the same capture-then-replace idiom
   * `dispatchAction` uses in core/liveState.ts. This is what makes two
   * simultaneous `finishMatch` calls safe: only one transaction can win, so
   * at most one closure ends up holding the real game state and at most one
   * history record gets written, however close together both calls arrive.
   *
   * The `isBoardIdle` check is what actually makes that guarantee hold, not
   * just the `=== null` case: once the winning transaction commits, the board
   * is a *valid, freshly-reset* state — not absent — so a losing transaction
   * that only checked for `null` would treat that fresh board as a real game
   * and capture it, producing a second, bogus 0-0 history record. Treating an
   * idle board as "nothing to finish" closes that gap, and also matches the
   * plain product semantics: there is nothing meaningful to record for a game
   * that was never actually played.
   *
   * The `state === null` branch returns `current` rather than aborting, for
   * the same reason `dispatchAction` (core/liveState.ts) does: the Realtime
   * Database transaction protocol — including, it turns out, the Admin SDK's
   * implementation of it — invokes this updater with an unconfirmed local
   * guess before it has heard from the server at all, and that guess is
   * `null` for a path with no prior activity on this connection. Treating that
   * as "genuinely absent" and hard-aborting would misreport a real, freshly-
   * scored game as having nothing to finish — which is exactly the failure
   * this comment exists to prevent a future edit from reintroducing. Returning
   * the same value lets the SDK detect the mismatch against the real server
   * data and rerun this function with the value that is actually trustworthy.
   */
  let captured: BoardState | null = null;
  const result = await liveRef.transaction((current: unknown) => {
    const state = parseLiveBoardState(current);
    if (state === null) return current; // not yet confirmed absent — see comment above
    if (isBoardIdle(state)) return undefined; // confirmed idle — abort, nothing to finish
    captured = state;
    // The tournament logo is a board-level branding setting, not a per-game
    // one — finishing a match resets scores/clocks but must not un-brand the
    // board for whichever game gets played on it next.
    return {
      ...createInitialState(state.config, now, caller.uid, null, state.logoUrl),
      rev: state.rev + 1,
    };
  });

  if (!result.committed || captured === null) {
    throw new HttpsError('failed-precondition', 'This board has no game to finish.');
  }
  const finalState: BoardState = captured;

  const matchRef = firestore.collection('tenants').doc(caller.tenantId).collection('matches').doc();
  const record = buildMatchRecord(finalState, { boardId, boardName, endedAt: now });

  await firestore.runTransaction(async (tx) => {
    // Read before write — Firestore transactions require every read to
    // precede every write, which is why the schedule lookup happens first.
    let scheduleRef: FirebaseFirestore.DocumentReference | null = null;
    if (finalState.scheduleId) {
      const candidate = scheduleCollection(caller.tenantId).doc(finalState.scheduleId);
      const scheduleSnapshot = await tx.get(candidate);
      if (scheduleSnapshot.exists) scheduleRef = candidate;
    }

    tx.set(matchRef, { ...record, createdBy: caller.uid });
    if (scheduleRef) {
      tx.update(scheduleRef, { status: 'completed', matchId: matchRef.id, updatedAt: now });
    }
  });

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'MATCH_FINISHED',
    boardId,
    detail: `${finalState.home.name} ${finalState.home.score}–${finalState.away.score} ${finalState.away.name}`,
  });

  return { matchId: matchRef.id };
});

// ---------------------------------------------------------------------------
// startScheduledMatch
// ---------------------------------------------------------------------------

const StartScheduledMatchInput = z.object({
  scheduleId: z.string().min(1).max(200),
  boardId: z.string(),
});

export const startScheduledMatch = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const caller = requireRole(request, 'operator');

  const parsed = StartScheduledMatchInput.safeParse(request.data);
  if (!parsed.success || !isValidId(parsed.data.boardId, 'brd')) {
    throw new HttpsError('invalid-argument', 'Invalid scheduled match or board.');
  }
  const { scheduleId, boardId } = parsed.data;

  const scheduleRef = scheduleCollection(caller.tenantId).doc(scheduleId);
  const boardRef = boardsCollection(caller.tenantId).doc(boardId);
  const [scheduleSnapshot, boardSnapshot] = await Promise.all([scheduleRef.get(), boardRef.get()]);

  if (!scheduleSnapshot.exists) {
    throw new HttpsError('not-found', 'That scheduled match no longer exists.');
  }
  if (!boardSnapshot.exists) {
    throw new HttpsError('not-found', 'That board no longer exists.');
  }

  const schedule = scheduleSnapshot.data()!;
  if (schedule['status'] !== 'scheduled') {
    throw new HttpsError(
      'failed-precondition',
      'This match has already been started, finished, or cancelled.',
    );
  }

  const liveRef = database.ref(`live/${caller.tenantId}/${boardId}/state`);
  const currentSnapshot = await liveRef.get();
  const currentState = parseLiveBoardState(currentSnapshot.val());

  // A board with no live state at all has never been played on and is
  // trivially idle; one that exists must actually satisfy isBoardIdle.
  if (currentState !== null && !isBoardIdle(currentState)) {
    throw new HttpsError(
      'failed-precondition',
      `Court "${(boardSnapshot.data()?.['name'] as string | undefined) ?? boardId}" already has a game in progress. Finish or reset it before starting this match.`,
    );
  }

  const config = mergeBoardConfig(boardSnapshot.data()?.['config']);
  const homeTeamName =
    typeof schedule['homeTeamName'] === 'string' ? schedule['homeTeamName'] : config.homeTeamName;
  const awayTeamName =
    typeof schedule['awayTeamName'] === 'string' ? schedule['awayTeamName'] : config.awayTeamName;
  const overrides = schedule['config'];
  const mergedConfig = {
    ...config,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
    homeTeamName,
    awayTeamName,
  };

  const theme = boardSnapshot.data()?.['theme'];
  const logoUrl =
    theme &&
    typeof theme === 'object' &&
    typeof (theme as { logoUrl?: unknown }).logoUrl === 'string'
      ? (theme as { logoUrl: string }).logoUrl
      : null;

  const now = Date.now();
  const initial = {
    ...createInitialState(mergedConfig, now, caller.uid, scheduleId, logoUrl),
    rev: (currentState?.rev ?? 0) + 1,
  };

  await liveRef.set(initial);
  await scheduleRef.update({ status: 'in_progress', boardId, updatedAt: now });

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'MATCH_STARTED',
    boardId,
    detail: `${homeTeamName} vs ${awayTeamName}`,
  });

  return { boardId };
});
