/**
 * Login-free access for display surfaces.
 *
 * An OBS browser source and a venue display PC cannot sign in, but handing them
 * database access is not an option either. Instead each board carries two
 * high-entropy keys — one for its mirror, one for its overlay — and the page
 * trades its key for a short-lived Firebase custom token scoped to that single
 * board:
 *
 *     /overlay/brd_7x2q?k=<43-char key>
 *        -> exchangeViewerKey({ boardId, key })      (POST /api/exchangeViewerKey)
 *        -> compares SHA-256(key) to the stored hash
 *        -> custom token { tenantId, boardId, role: 'overlay' }
 *        -> signInWithCustomToken
 *        -> RTDB rules grant read on that board and match no write rule
 *
 * Only the hash is ever stored, so a database leak yields no working URLs, and
 * rotating a key invalidates the old link on the spot.
 */
import type { Auth } from 'firebase/auth';
import { ApiCallError, callApi } from './api.js';
import { signInWithViewerToken, type Session } from './auth.js';
import { isValidId, isValidViewerKey } from './ids.js';

export interface ViewerContext {
  boardId: string;
  key: string;
}

/**
 * Extracts the board and key from a display URL.
 *
 * Hosting rewrites `/overlay/**` to the overlay bundle while leaving the address
 * bar untouched, so the board ID is read back out of the path here.
 */
export function readViewerContext(
  location: { pathname: string; search: string } = window.location,
): ViewerContext | null {
  const segments = location.pathname.split('/').filter(Boolean);
  const boardId = segments[segments.length - 1] ?? '';
  const key = new URLSearchParams(location.search).get('k') ?? '';

  if (!isValidId(boardId, 'brd') || !isValidViewerKey(key)) return null;
  return { boardId, key };
}

export interface ViewerTokenResponse {
  token: string;
  tenantId: string;
  boardId: string;
  role: 'overlay' | 'mirror';
}

/**
 * Trades a viewer key for a signed-in, board-scoped, read-only session.
 *
 * Which of the board's two keys was presented determines the role, so the
 * caller does not choose it — a mirror key cannot be used to claim the overlay
 * role or the reverse.
 */
export async function authenticateViewer(auth: Auth, context: ViewerContext): Promise<Session> {
  const data = await callApi<ViewerTokenResponse>('exchangeViewerKey', context);
  return signInWithViewerToken(auth, data.token);
}

export type ViewerAuthFailure =
  'missing-key' | 'invalid-key' | 'rate-limited' | 'board-unavailable' | 'network';

export function classifyViewerError(error: unknown): ViewerAuthFailure {
  if (!(error instanceof ApiCallError)) return 'network';
  if (error.status === 429) return 'rate-limited';
  if (error.status === 404) return 'board-unavailable';
  return 'invalid-key';
}

export const VIEWER_ERROR_MESSAGES: Record<ViewerAuthFailure, string> = {
  'missing-key': 'This link is incomplete. Copy the full URL from the dashboard.',
  'invalid-key':
    'This link is no longer valid. It may have been rotated — get a fresh one from the dashboard.',
  'rate-limited': 'Too many attempts from this location. Wait a minute and reload.',
  'board-unavailable': 'That board no longer exists.',
  network: 'Cannot reach the server. Check the network connection.',
};
