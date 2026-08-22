/**
 * One board on the dashboard: a live miniature of the real scoreboard, plus the
 * four links that board hands out.
 *
 * The preview subscribes to the same RTDB node the gym wall reads, so what shows
 * here is not a cached summary — it is the game, live, at whatever moment you
 * look at the dashboard.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatGameClock, remainingAt } from '../../core/clock.js';
import {
  buildMirrorUrl,
  buildOverlayUrl,
  buildScoreboardUrl,
  subscribeViewerKeys,
  type Board,
  type ViewerKeys,
} from '../../core/boards.js';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { canManageBoards, type Role } from '../../core/roles.js';
import { useBoardState, useNow } from '../hooks.js';
import { IconExternalLink } from './icons.js';
import { CopyField } from './ui.js';

function useViewerKeys(tenantId: string, boardId: string, enabled: boolean): ViewerKeys {
  const firestore = getFirestoreClient();
  const [keys, setKeys] = useState<ViewerKeys>({ overlayKey: null, mirrorKey: null });

  useEffect(() => {
    if (!enabled) return;
    return subscribeViewerKeys(firestore, tenantId, boardId, setKeys);
  }, [firestore, tenantId, boardId, enabled]);

  return keys;
}

export function BoardCard({
  board,
  tenantId,
  role,
}: {
  board: Board;
  tenantId: string;
  role: Role;
}) {
  const { state } = useBoardState(tenantId, board.id);
  const isAdmin = canManageBoards(role);
  const keys = useViewerKeys(tenantId, board.id, isAdmin);
  const [showLinks, setShowLinks] = useState(false);

  const clockRunning = state?.gameClock.running ?? false;
  const now = useNow(clockRunning, 250);
  const origin = window.location.origin;

  const remaining = state ? remainingAt(state.gameClock, now) : 0;

  return (
    <article className={`board-card${board.archived ? ' board-card--archived' : ''}`}>
      <div className="board-card__head">
        <span className="board-card__title">{board.name}</span>
        {clockRunning ? <span className="badge badge--live">Live</span> : null}
        {board.archived ? <span className="badge">Archived</span> : null}
      </div>

      <div className="board-preview">
        <div className="board-preview__team">
          <div className="board-preview__name">{state?.home.name ?? '—'}</div>
          <div className="board-preview__score">{state ? state.home.score : '—'}</div>
        </div>
        <div className="board-preview__center">
          <div
            className={`board-preview__clock${clockRunning ? ' board-preview__clock--live' : ''}`}
          >
            {state ? formatGameClock(remaining) : '--:--'}
          </div>
          <div className="board-preview__period">{state ? `Q${state.period}` : ''}</div>
        </div>
        <div className="board-preview__team">
          <div className="board-preview__name">{state?.away.name ?? '—'}</div>
          <div className="board-preview__score">{state ? state.away.score : '—'}</div>
        </div>
      </div>

      <div className="board-card__links">
        <div className="board-card__row">
          <Link className="btn btn--primary btn--sm" to={`/control/${board.id}`}>
            Control panel
          </Link>
          <a
            className="btn btn--sm"
            href={buildScoreboardUrl(origin, board.id)}
            target="_blank"
            rel="noopener"
          >
            Scoreboard
            <IconExternalLink size={13} />
          </a>
          {isAdmin ? (
            <Link className="btn btn--sm" to={`/app/boards/${board.id}`}>
              Settings
            </Link>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowLinks((v) => !v)}
            >
              {showLinks ? 'Hide links' : 'Share links'}
            </button>
          ) : null}
        </div>

        {showLinks && isAdmin ? (
          <div className="stack board-card__share">
            <div>
              <div className="field__hint board-card__hint">
                Mirror display — open on the venue screen. No sign-in needed.
              </div>
              {keys.mirrorKey ? (
                <CopyField
                  label={`mirror-${board.id}`}
                  value={buildMirrorUrl(origin, board.id, keys.mirrorKey)}
                />
              ) : (
                <span className="muted">Loading…</span>
              )}
            </div>
            <div>
              <div className="field__hint board-card__hint">
                Stream overlay — add as a Browser Source in OBS.
              </div>
              {keys.overlayKey ? (
                <CopyField
                  label={`overlay-${board.id}`}
                  value={buildOverlayUrl(origin, board.id, keys.overlayKey)}
                />
              ) : (
                <span className="muted">Loading…</span>
              )}
            </div>
            <div className="field__hint">
              Anyone with these links can watch this board. Rotate them in Settings if one leaks.
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
