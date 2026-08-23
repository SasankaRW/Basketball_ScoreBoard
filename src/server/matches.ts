/**
 * Match lifecycle: finishing a live game into permanent history, and starting
 * a scheduled game onto a board.
 *
 * Both need privileges a client must not hold — `finishMatch` derives every
 * metric from the board's *actual* live state rather than trusting whatever a
 * client claims the score was, and `startScheduledMatch` enforces the "board
 * must be idle" rule server-side rather than relying on a UI that merely
 * hints at it.
 */
import { z } from 'zod';
import { isValidId } from '../core/ids.js';
import { buildMatchRecord } from '../core/matchRecord.js';
import {
  createInitialState,
  isBoardIdle,
  mergeBoardConfig,
  parseLiveBoardState,
  type BoardState,
} from '../core/schema.js';
import { MAX_TIMELINE_EVENTS, type TimelineEvent } from '../core/timeline.js';
import { ApiError, database, firestore, writeAudit, type Caller } from './common.js';

function boardsCollection(tenantId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('boards');
}

function scheduleCollection(tenantId: string) {
  return firestore.collection('tenants').doc(tenantId).collection('schedule');
}

function eventsRef(tenantId: string, boardId: string) {
  return database.ref(`live/${tenantId}/${boardId}/events`);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Turns one stored RTDB entry back into a `TimelineEvent`.
 *
 * `side` needs restoring the same way `parseLiveBoardState` restores the
 * clock's `endsAt`: a period change has `side: null`, and the Realtime Database
 * deletes keys whose value is null, so it comes back *absent* rather than null.
 */
function parseEvent(raw: unknown): TimelineEvent | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const type = value['type'];
  if (type !== 'score' && type !== 'foul' && type !== 'timeout' && type !== 'period') return null;
  const side = value['side'];

  return {
    ts: num(value['ts'], 0),
    period: num(value['period'], 1),
    clockMs: num(value['clockMs'], 0),
    type,
    side: side === 'home' || side === 'away' ? side : null,
    delta: num(value['delta'], 0),
    home: num(value['home'], 0),
    away: num(value['away'], 0),
    actor: typeof value['actor'] === 'string' ? value['actor'] : '',
  };
}

/**
 * Takes a board's timeline and clears it, in one atomic step.
 *
 * A read followed by a delete would leave a window in which an event appended
 * between the two is destroyed without ever reaching history; a transaction
 * that returns `null` captures and removes the node together, so anything that
 * lands after this either made it into `captured` or is still there for the
 * next game. That the node was just reset by the caller's state transaction is
 * what makes "still there" harmless.
 *
 * Never throws: a match record that reaches history without its play-by-play is
 * a lesser failure than a finished game that cannot be recorded at all.
 */
async function harvestEvents(
  tenantId: string,
  boardId: string,
): Promise<{ events: TimelineEvent[]; eventsTruncated: boolean }> {
  let captured: Record<string, unknown> | null = null;

  try {
    await eventsRef(tenantId, boardId).transaction((current: unknown) => {
      captured =
        current !== null && typeof current === 'object'
          ? (current as Record<string, unknown>)
          : null;
      return null; // take it and clear it in the same operation
    });
  } catch {
    return { events: [], eventsTruncated: false };
  }

  if (captured === null) return { events: [], eventsTruncated: false };

  // Push IDs sort chronologically by construction, which is the whole reason
  // for using them — sorting the keys restores the order events happened in,
  // without trusting the object key order the SDK happened to hand back.
  const ordered = Object.keys(captured)
    .sort()
    .map((key) => parseEvent((captured as Record<string, unknown>)[key]))
    .filter((event): event is TimelineEvent => event !== null);

  // Keeping the earliest events rather than the latest: a timeline that starts
  // at tip-off and stops partway still reads as a game, whereas one that begins
  // mid-third-quarter with no explanation does not.
  return {
    events: ordered.slice(0, MAX_TIMELINE_EVENTS),
    eventsTruncated: ordered.length > MAX_TIMELINE_EVENTS,
  };
}

// ---------------------------------------------------------------------------
// finishMatch
// ---------------------------------------------------------------------------

export const FinishMatchInput = z.object({ boardId: z.string() });

export async function finishMatch(
  caller: Caller,
  input: z.infer<typeof FinishMatchInput>,
): Promise<{ matchId: string }> {
  if (!isValidId(input.boardId, 'brd')) throw new ApiError(400, 'Unknown board.');
  const { boardId } = input;

  const boardRef = boardsCollection(caller.tenantId).doc(boardId);
  const boardSnapshot = await boardRef.get();
  if (!boardSnapshot.exists) throw new ApiError(404, 'Board not found.');
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
   * Database transaction protocol invokes this updater with an unconfirmed
   * local guess before it has heard from the server at all, and that guess is
   * `null` for a path with no prior activity on this connection. Treating
   * that as "genuinely absent" and hard-aborting would misreport a real,
   * freshly-scored game as having nothing to finish — exactly the failure
   * this comment exists to prevent a future edit from reintroducing.
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
    throw new ApiError(412, 'This board has no game to finish.');
  }
  const finalState: BoardState = captured;

  const matchRef = firestore.collection('tenants').doc(caller.tenantId).collection('matches').doc();
  const record = buildMatchRecord(finalState, { boardId, boardName, endedAt: now });
  // After the state transaction, not before: the board is already reset, so
  // every event this game could still produce has been written by now.
  const { events, eventsTruncated } = await harvestEvents(caller.tenantId, boardId);

  await firestore.runTransaction(async (tx) => {
    // Read before write — Firestore transactions require every read to
    // precede every write, which is why the schedule lookup happens first.
    let scheduleRef: FirebaseFirestore.DocumentReference | null = null;
    if (finalState.scheduleId) {
      const candidate = scheduleCollection(caller.tenantId).doc(finalState.scheduleId);
      const scheduleSnapshot = await tx.get(candidate);
      if (scheduleSnapshot.exists) scheduleRef = candidate;
    }

    tx.set(matchRef, { ...record, events, eventsTruncated, createdBy: caller.uid });
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
}

// ---------------------------------------------------------------------------
// startScheduledMatch
// ---------------------------------------------------------------------------

export const StartScheduledMatchInput = z.object({
  scheduleId: z.string().min(1).max(200),
  boardId: z.string(),
});

export async function startScheduledMatch(
  caller: Caller,
  input: z.infer<typeof StartScheduledMatchInput>,
): Promise<{ boardId: string }> {
  if (!isValidId(input.boardId, 'brd'))
    throw new ApiError(400, 'Invalid scheduled match or board.');
  const { scheduleId, boardId } = input;

  const scheduleRef = scheduleCollection(caller.tenantId).doc(scheduleId);
  const boardRef = boardsCollection(caller.tenantId).doc(boardId);
  const [scheduleSnapshot, boardSnapshot] = await Promise.all([scheduleRef.get(), boardRef.get()]);

  if (!scheduleSnapshot.exists) throw new ApiError(404, 'That scheduled match no longer exists.');
  if (!boardSnapshot.exists) throw new ApiError(404, 'That board no longer exists.');

  const schedule = scheduleSnapshot.data()!;
  if (schedule['status'] !== 'scheduled') {
    throw new ApiError(412, 'This match has already been started, finished, or cancelled.');
  }

  const liveRef = database.ref(`live/${caller.tenantId}/${boardId}/state`);
  const currentSnapshot = await liveRef.get();
  const currentState = parseLiveBoardState(currentSnapshot.val());

  // A board with no live state at all has never been played on and is
  // trivially idle; one that exists must actually satisfy isBoardIdle.
  if (currentState !== null && !isBoardIdle(currentState)) {
    throw new ApiError(
      412,
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
  // The board is idle, but idle is not the same as never-played: a game that
  // was discarded rather than finished can have left its timeline behind, and
  // this match must not open with the previous one's events already on it.
  await eventsRef(caller.tenantId, boardId).remove();
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
}
