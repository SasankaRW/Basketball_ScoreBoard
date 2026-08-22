/**
 * React bindings over the framework-free core.
 *
 * Nothing here holds business logic — these hooks only move data between the
 * `core/` modules and React's render cycle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirebase } from '../core/firebase.js';
import { getFirestoreClient } from '../core/firestoreClient.js';
import { subscribeBoards, subscribeBoard, type Board } from '../core/boards.js';
import { dispatchWithRetry, subscribeBoardState, subscribeConnection } from '../core/liveState.js';
import type { Action } from '../core/reducer.js';
import { now } from '../core/serverTime.js';
import type { BoardState } from '../core/schema.js';

export interface LiveBoard {
  state: BoardState | null;
  loaded: boolean;
  error: string | null;
}

export function useBoardState(tenantId: string, boardId: string | undefined): LiveBoard {
  const { db } = getFirebase();
  const [live, setLive] = useState<LiveBoard>({ state: null, loaded: false, error: null });

  useEffect(() => {
    if (!boardId) return;
    setLive({ state: null, loaded: false, error: null });

    return subscribeBoardState(
      db,
      tenantId,
      boardId,
      (snapshot) => setLive({ state: snapshot.state, loaded: snapshot.loaded, error: null }),
      () => setLive({ state: null, loaded: true, error: 'You do not have access to this board.' }),
    );
  }, [db, tenantId, boardId]);

  return live;
}

export function useBoards(tenantId: string) {
  const firestore = getFirestoreClient();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeBoards(
        firestore,
        tenantId,
        (next) => {
          setBoards(next);
          setError(null);
        },
        (subscribeError) => setError(subscribeError.message),
      ),
    [firestore, tenantId],
  );

  return { boards, error };
}

export function useBoard(tenantId: string, boardId: string | undefined) {
  const firestore = getFirestoreClient();
  const [board, setBoard] = useState<Board | null | undefined>(undefined);

  useEffect(() => {
    if (!boardId) return;
    return subscribeBoard(firestore, tenantId, boardId, setBoard, () => setBoard(null));
  }, [firestore, tenantId, boardId]);

  return board;
}

/**
 * Server-corrected time on a repeating tick.
 *
 * The control panel renders clocks from `endsAt`, so it needs a heartbeat to
 * re-render even when nothing in the database changed. Pass `active: false`
 * while both clocks are paused and the component stops re-rendering entirely.
 */
export function useNow(active: boolean, intervalMs = 100): number {
  const [value, setValue] = useState(() => now());

  useEffect(() => {
    setValue(now());
    if (!active) return;
    const handle = setInterval(() => setValue(now()), intervalMs);
    return () => clearInterval(handle);
  }, [active, intervalMs]);

  return value;
}

export function useConnection(): boolean {
  const { db } = getFirebase();
  const [connected, setConnected] = useState(true);
  useEffect(() => subscribeConnection(db, setConnected), [db]);
  return connected;
}

export interface Dispatcher {
  dispatch: (action: Action) => void;
  error: string | null;
  clearError: () => void;
}

/**
 * Dispatches actions to a board, surfacing only errors that need attention.
 *
 * A `conflict` outcome is not reported: it means a concurrent operator committed
 * first and the retry already reconciled against their state. Showing that to a
 * scorer mid-game would be noise about a problem that has already resolved itself.
 */
export function useDispatch(
  tenantId: string,
  boardId: string | undefined,
  actor: string,
): Dispatcher {
  const { db } = getFirebase();
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);

  const dispatch = useCallback(
    (action: Action) => {
      if (!boardId) return;
      pending.current += 1;

      void dispatchWithRetry(db, tenantId, boardId, action, { now: now(), actor })
        .then((outcome) => {
          if (outcome.status === 'missing') {
            setError('This board has no game state. Recreate it from the dashboard.');
          }
        })
        .catch(() => setError('Change not saved — check your connection.'))
        .finally(() => {
          pending.current -= 1;
        });
    },
    [db, tenantId, boardId, actor],
  );

  return { dispatch, error, clearError: () => setError(null) };
}
