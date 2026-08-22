/**
 * The live-state adapter: the only module that moves board state over the wire.
 *
 * Two responsibilities the rest of the app relies on:
 *
 *   **Transactional writes.** Every mutation is a `runTransaction` that re-runs
 *   the reducer against whatever the server currently holds. Two operators
 *   pressing keys at the same moment merge instead of clobbering, and because
 *   `rev` must advance by exactly one (enforced in database.rules.json), a stale
 *   writer is rejected by the database rather than by client-side courtesy.
 *
 *   **Shape normalisation.** The Realtime Database deletes keys whose value is
 *   null, so a paused clock's `endsAt: null` comes back *absent*. Every read
 *   passes through `normaliseState`, so nothing downstream has to know that.
 */
import {
  onValue,
  ref,
  runTransaction,
  set,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import { applyAction, type Action, type ActionContext } from './reducer.js';
import {
  createInitialState,
  parseLiveBoardState,
  type BoardConfig,
  type BoardState,
} from './schema.js';

export function statePath(tenantId: string, boardId: string): string {
  return `live/${tenantId}/${boardId}/state`;
}

function stateRef(db: Database, tenantId: string, boardId: string): DatabaseReference {
  return ref(db, statePath(tenantId, boardId));
}

/**
 * The RTDB-shape-restoring parse lives in schema.ts (`parseLiveBoardState`) so
 * the Cloud Functions that read this same live state directly — without going
 * through the client SDK this module wraps — parse it identically. Re-exported
 * under this module's established name so every call site here reads the same
 * as it always has.
 */
const normaliseState = parseLiveBoardState;

/**
 * Strips keys the rules reject and lets null delete `endsAt`, keeping the
 * stored shape exactly what `.validate` expects.
 */
function serialiseState(state: BoardState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

export interface BoardSnapshot {
  state: BoardState | null;
  /** True once the first server response has arrived, valid or not. */
  loaded: boolean;
}

/**
 * Subscribes to a board. Returns an unsubscribe function.
 *
 * `onError` fires on permission denial — which is the expected outcome of an
 * expired or rotated viewer key, and the display pages surface it as such.
 */
export function subscribeBoardState(
  db: Database,
  tenantId: string,
  boardId: string,
  onChange: (snapshot: BoardSnapshot) => void,
  onError?: (error: Error) => void,
): () => void {
  return onValue(
    stateRef(db, tenantId, boardId),
    (snapshot) => onChange({ state: normaliseState(snapshot.val()), loaded: true }),
    (error) => onError?.(error),
  );
}

export type DispatchOutcome =
  /** The action changed the board and the write was accepted. */
  | { status: 'committed'; state: BoardState }
  /** The action was a no-op — nothing was sent. */
  | { status: 'unchanged'; state: BoardState }
  /** No state exists at this path yet; call `initialiseBoardState` first. */
  | { status: 'missing' }
  /** A concurrent writer won the race. The caller may retry. */
  | { status: 'conflict' };

/**
 * Applies one action transactionally.
 *
 * `applyLocally: false` keeps the reducer from producing an optimistic local
 * value that a losing transaction would then have to roll back — a visible
 * flicker on the scoreboard. Latency to the database is a few tens of
 * milliseconds, well under a frame's worth of perceptible delay.
 *
 * The update function below is invoked at least twice by design, and the first
 * call is not trustworthy on its own: the Realtime Database SDK calls it
 * immediately with whatever it has cached locally — which is `null` if this
 * client has no open listener on the path yet — before it has heard from the
 * server at all. Returning `undefined` (the SDK's "abort, do not retry" signal)
 * on that first call would permanently give up before ever seeing the real
 * data, misreporting an existing board as missing. So a `null` read is treated
 * as "not yet confirmed" rather than "absent": the same value is handed back,
 * which is a safe no-op if that guess was right, and if it was wrong the SDK
 * detects the mismatch against the server and reruns this function with the
 * real value. Only the outcome inspected *after* the transaction settles —
 * `result.committed` and `result.snapshot` — is trustworthy, because those
 * reflect the final, server-confirmed state rather than any one call.
 *
 * There is a second, sharper case the try/catch below exists for. The `rev`
 * field's `.validate` rule requires each write to increment it by exactly one
 * — that is the optimistic lock the whole multi-writer design leans on. When
 * two operators' transactions race, the loser's retry (recomputed against what
 * it still believes is the current `rev`) can lose to the winner's write
 * landing first, so by the time the loser's attempt reaches the server, its
 * proposed `rev` is already one behind. For an ordinary value mismatch the SDK
 * transparently re-fetches and reruns the update function; but here the
 * mismatch is caught by a *security rule*, not by the SDK's own conflict
 * detection, so instead of a graceful rerun the whole `runTransaction` promise
 * rejects with `permission_denied`. That is not a real permission problem —
 * it is exactly the "someone else moved first" case `dispatchWithRetry` exists
 * to absorb — so it is caught here and reported as a conflict rather than
 * left to crash the caller.
 */
export async function dispatchAction(
  db: Database,
  tenantId: string,
  boardId: string,
  action: Action,
  ctx: ActionContext,
): Promise<DispatchOutcome> {
  let deemedNoOp = false;

  let result;
  try {
    result = await runTransaction(
      stateRef(db, tenantId, boardId),
      (current: unknown) => {
        const state = normaliseState(current);
        if (state === null) {
          deemedNoOp = false;
          return current; // not yet confirmed absent — see comment above
        }
        const next = applyAction(state, action, ctx);
        if (next === state) {
          deemedNoOp = true;
          return undefined; // a confirmed no-op — abort, no write, no revision burned
        }
        deemedNoOp = false;
        return serialiseState(next);
      },
      { applyLocally: false },
    );
  } catch {
    return { status: 'conflict' };
  }

  const finalState = normaliseState(result.snapshot.val());
  if (finalState === null) return { status: 'missing' };
  if (!result.committed) {
    // Aborted with existing data present: either our own confirmed no-op, or
    // the SDK exhausted its internal retries under contention from another
    // writer. Only the former is a real no-op; the latter is a genuine race
    // the caller should retry against the state that won.
    return deemedNoOp ? { status: 'unchanged', state: finalState } : { status: 'conflict' };
  }
  return { status: 'committed', state: finalState };
}

/**
 * Dispatches with bounded retries.
 *
 * A conflict means a concurrent operator committed first; re-running the reducer
 * against their result is almost always the right resolution — two referees each
 * adding a point should produce two points, not one.
 *
 * Retries carry a small random backoff from the second attempt onward. Without
 * it, every loser of a multi-way collision (a scramble where an operator and an
 * assistant both react within the same instant) retries at essentially the same
 * moment and is liable to collide again; a few milliseconds of jitter spreads
 * retries out so contention actually drains round over round instead of
 * repeating in lockstep. Eight attempts comfortably absorbs realistic courtside
 * contention — two or three people acting within the same second — without a
 * genuinely broken connection being retried for long enough to feel stuck.
 */
export async function dispatchWithRetry(
  db: Database,
  tenantId: string,
  boardId: string,
  action: Action,
  ctx: ActionContext,
  attempts = 8,
): Promise<DispatchOutcome> {
  let outcome: DispatchOutcome = { status: 'conflict' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = Math.random() * Math.min(20 * 2 ** (attempt - 1), 200);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    outcome = await dispatchAction(db, tenantId, boardId, action, ctx);
    if (outcome.status !== 'conflict') return outcome;
  }
  return outcome;
}

/**
 * Writes the opening state for a board, refusing to overwrite an existing game.
 *
 * Uses a transaction rather than a plain `set` so two operators opening a new
 * board simultaneously cannot both reset it to zero.
 */
export async function initialiseBoardState(
  db: Database,
  tenantId: string,
  boardId: string,
  config: BoardConfig,
  ctx: ActionContext,
): Promise<BoardState | null> {
  const initial: BoardState = { ...createInitialState(config, ctx.now, ctx.actor), rev: 1 };

  const result = await runTransaction(
    stateRef(db, tenantId, boardId),
    (current: unknown) => (current === null ? serialiseState(initial) : undefined),
    { applyLocally: false },
  );

  return normaliseState(result.snapshot.val());
}

/**
 * Replaces a board's state wholesale. Used by the one-time legacy migration and
 * by tests; ordinary gameplay always goes through `dispatchAction`.
 */
export async function overwriteBoardState(
  db: Database,
  tenantId: string,
  boardId: string,
  state: BoardState,
): Promise<void> {
  await set(stateRef(db, tenantId, boardId), serialiseState(state));
}

/** Live connection status, for the "reconnecting…" banner every surface shows. */
export function subscribeConnection(
  db: Database,
  onChange: (connected: boolean) => void,
): () => void {
  return onValue(ref(db, '.info/connected'), (snapshot) => onChange(snapshot.val() === true));
}
