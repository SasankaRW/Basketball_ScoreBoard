/**
 * Moves a board's layout document over the wire.
 *
 * Deliberately *not* part of `liveState.ts`, and deliberately not a child of
 * `state`. Three reasons, all of which matter:
 *
 *   `state.rev` has to advance by exactly one per write, enforced in
 *   `database.rules.json`, and every score change is a transaction against it.
 *   Folding the layout in would mean an operator dragging a box in the editor
 *   and a scorer pressing `+2` courtside fighting over the same revision — one
 *   of them losing a write to the other for no reason at all, since the two
 *   changes have nothing to do with each other.
 *
 *   Layout is not game state. It survives `NEW_GAME`, it is not harvested into a
 *   match record, and it has no business in the payload that every clock tick
 *   and every mirror re-reads.
 *
 *   It is written rarely and read once per page load, so it needs none of the
 *   transactional machinery `liveState` exists to provide. A plain `set` is
 *   correct here: last writer wins, which is exactly right for a document one
 *   admin edits in a form.
 *
 * It lives in the Realtime Database rather than Firestore because the surfaces
 * that need it — the gym-wall scoreboard and the mirror — are Firestore-free by
 * design (see `src/core/firebase.ts`). They already hold an RTDB handle and a
 * board-scoped token; reading one more node off it costs nothing, where pulling
 * in the Firestore client would put the larger half of the SDK onto a page whose
 * whole point is loading fast over venue Wi-Fi.
 */
import {
  onValue,
  ref,
  remove,
  set,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import { parseBoardLayout, type BoardLayout } from './boardLayout.js';

export function layoutPath(tenantId: string, boardId: string): string {
  return `live/${tenantId}/${boardId}/layout`;
}

function layoutRef(db: Database, tenantId: string, boardId: string): DatabaseReference {
  return ref(db, layoutPath(tenantId, boardId));
}

export interface LayoutSnapshot {
  /** `null` means this board uses the stock arrangement. */
  layout: BoardLayout | null;
  /** False until the first server response, so a display can hold its paint. */
  loaded: boolean;
}

/**
 * Watches a board's layout.
 *
 * The callback fires with `{ layout: null, loaded: true }` for a board nobody
 * has customised, which is not an error — it is the overwhelmingly common case
 * and the signal that the stock stylesheet should be left alone.
 *
 * A permission failure is reported through `onError` rather than swallowed, but
 * callers on the display side are expected to carry on regardless: a scoreboard
 * that cannot read its layout should show the stock one, not a blank wall.
 */
export function subscribeBoardLayout(
  db: Database,
  tenantId: string,
  boardId: string,
  onSnapshot: (snapshot: LayoutSnapshot) => void,
  onError?: (error: Error) => void,
): () => void {
  return onValue(
    layoutRef(db, tenantId, boardId),
    (snapshot) => onSnapshot({ layout: parseBoardLayout(snapshot.val()), loaded: true }),
    (error) => onError?.(error),
  );
}

/**
 * Publishes a layout to every screen showing this board.
 *
 * `updatedAt`/`updatedBy` are written alongside for the same reason `state`
 * carries them — when a board comes up arranged differently from how someone
 * remembers leaving it, the first question is always who changed it.
 */
export async function writeBoardLayout(
  db: Database,
  tenantId: string,
  boardId: string,
  layout: BoardLayout,
  actor: string,
): Promise<void> {
  await set(layoutRef(db, tenantId, boardId), {
    ...layout,
    updatedAt: Date.now(),
    updatedBy: actor,
  });
}

/**
 * Removes the layout, returning the board to the arrangement it shipped with.
 *
 * This is what "reset to defaults" does, and why it can promise the original
 * back exactly rather than approximately: there is no stored document left to
 * render from, so the stock stylesheet takes over untouched. Restoring
 * `defaultLayout()` instead would leave a board that merely *resembles* the one
 * the visual baselines were captured from.
 */
export async function clearBoardLayout(
  db: Database,
  tenantId: string,
  boardId: string,
): Promise<void> {
  await remove(layoutRef(db, tenantId, boardId));
}
