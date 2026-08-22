/**
 * Bootstrap shared by the three display surfaces.
 *
 * The scoreboard signs in as a member; the mirror and overlay trade a viewer key
 * for a board-scoped read-only token. Both paths end in the same place: a live
 * Database handle, a tenant, a board, and a running server-time sync.
 *
 * Failure handling matters more here than anywhere else in the app. These pages
 * run unattended on a gym wall and inside OBS, where nobody is watching a
 * console — so every error becomes a legible on-screen message rather than a
 * blank rectangle.
 */
import type { Database } from 'firebase/database';
import { getFirebase } from '../../core/firebase.js';
import { subscribeAuth, type Session } from '../../core/auth.js';
import { startServerTimeSync } from '../../core/serverTime.js';
import { subscribeConnection } from '../../core/liveState.js';
import { isValidId } from '../../core/ids.js';
import {
  authenticateViewer,
  classifyViewerError,
  readViewerContext,
  VIEWER_ERROR_MESSAGES,
} from '../../core/viewerKey.js';

export interface DisplayContext {
  db: Database;
  tenantId: string;
  boardId: string;
  session: Session;
}

export class DisplayBootError extends Error {}

/** Reads the board ID from `/board/:id`, `/mirror/:id` or `/overlay/:id`. */
export function readBoardIdFromPath(pathname = window.location.pathname): string | null {
  const last = pathname.split('/').filter(Boolean).pop();
  return isValidId(last, 'brd') ? (last as string) : null;
}

/**
 * Boots a mirror or overlay from its URL key. Never prompts for a login.
 */
export async function bootViewerSurface(): Promise<DisplayContext> {
  const { auth, db, functions } = getFirebase();

  const context = readViewerContext();
  if (!context) throw new DisplayBootError(VIEWER_ERROR_MESSAGES['missing-key']);

  let session: Session;
  try {
    session = await authenticateViewer(auth, functions, context);
  } catch (error) {
    throw new DisplayBootError(VIEWER_ERROR_MESSAGES[classifyViewerError(error)]);
  }

  startServerTimeSync(db);
  return { db, tenantId: session.tenantId, boardId: context.boardId, session };
}

/**
 * Boots the operator scoreboard, which requires a real member session.
 *
 * Redirects to the login page with a `next` parameter rather than showing an
 * error, so signing in returns straight to the board that was requested.
 */
export async function bootOperatorSurface(): Promise<DisplayContext> {
  const { auth, db } = getFirebase();

  const boardId = readBoardIdFromPath();
  if (!boardId) {
    throw new DisplayBootError('No board specified. Open this board from the dashboard.');
  }

  const session = await new Promise<Session | null>((resolve) => {
    const unsubscribe = subscribeAuth(auth, (state) => {
      if (state.status === 'loading') return;
      unsubscribe();
      resolve(state.status === 'signed-in' ? state.session : null);
    });
  });

  if (!session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?next=${next}`);
    throw new DisplayBootError('Redirecting to sign in…');
  }

  startServerTimeSync(db);
  return { db, tenantId: session.tenantId, boardId, session };
}

// ---------------------------------------------------------------------------
// Status banner
// ---------------------------------------------------------------------------

export type StatusKind = 'hidden' | 'warning' | 'error';

export interface StatusBanner {
  set(kind: StatusKind, message?: string): void;
}

const BANNER_STYLE = `
position: fixed;
top: 0;
left: 0;
right: 0;
z-index: 9999;
padding: 0.6rem 1rem;
font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
font-size: 0.95rem;
font-weight: 600;
letter-spacing: 0.02em;
text-align: center;
color: #10131a;
background: #f1c40f;
box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
`;

/**
 * A banner that is invisible while everything is healthy.
 *
 * Staying out of the layout when hidden is what lets the visual-regression
 * goldens keep working: a connected scoreboard renders byte-identically to the
 * original page, banner or no banner.
 */
export function mountStatusBanner(parent: HTMLElement = document.body): StatusBanner {
  const element = document.createElement('div');
  element.id = 'connection-banner';
  element.setAttribute('role', 'status');
  element.setAttribute('style', `${BANNER_STYLE}display: none;`);
  parent.appendChild(element);

  return {
    set(kind, message = '') {
      if (kind === 'hidden') {
        element.style.display = 'none';
        return;
      }
      element.textContent = message;
      element.style.background = kind === 'error' ? '#e74c3c' : '#f1c40f';
      element.style.color = kind === 'error' ? '#fff' : '#10131a';
      element.style.display = 'block';
    },
  };
}

/**
 * Wires the banner to connection state.
 *
 * Reconnection is announced only after a short grace period. The Realtime
 * Database drops and restores its socket routinely — flashing a warning every
 * time would train an operator to ignore the banner that actually matters.
 */
export function watchConnection(db: Database, banner: StatusBanner, graceMs = 4_000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = subscribeConnection(db, (connected) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (connected) {
      banner.set('hidden');
    } else {
      timer = setTimeout(
        () =>
          banner.set('warning', 'Reconnecting… the clock keeps running from the last known time.'),
        graceMs,
      );
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}

/** Replaces the page with a legible failure message. */
export function renderFatalError(message: string): void {
  document.body.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.setAttribute(
    'style',
    `display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;
     padding:2rem;box-sizing:border-box;background:#10131a;color:#e6e9ef;text-align:center;
     font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:1.15rem;line-height:1.6;`,
  );
  const text = document.createElement('p');
  text.style.maxWidth = '34rem';
  text.textContent = message;
  wrapper.appendChild(text);
  document.body.appendChild(wrapper);
}
