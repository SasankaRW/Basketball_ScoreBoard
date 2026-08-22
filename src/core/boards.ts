/**
 * Board records in the control plane.
 *
 * Reads go straight to Firestore under the tenant-scoped rules. Writes that must
 * stay in step with something the client cannot be trusted with — minting or
 * rotating viewer keys, tearing down live state on delete — go through callable
 * Functions instead. Renames and config edits are plain client writes, because
 * the rules already restrict them to a safe set of fields.
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';
import { mergeBoardConfig, type BoardConfig } from './schema.js';

export interface BoardTheme {
  logoUrl: string | null;
  homeColor: string;
  awayColor: string;
}

export const DEFAULT_THEME: BoardTheme = {
  logoUrl: null,
  homeColor: '#d64545',
  awayColor: '#3f7fd6',
};

export interface Board {
  id: string;
  name: string;
  sport: 'basketball';
  archived: boolean;
  config: BoardConfig;
  theme: BoardTheme;
  createdAt: number;
  createdBy: string;
}

export type ViewerKeyKind = 'overlay' | 'mirror';

function readTheme(raw: unknown): BoardTheme {
  return { ...DEFAULT_THEME, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function toBoard(id: string, data: Record<string, unknown>): Board {
  return {
    id,
    name: typeof data['name'] === 'string' ? data['name'] : 'Untitled board',
    sport: 'basketball',
    archived: data['archived'] === true,
    config: mergeBoardConfig(data['config']),
    theme: readTheme(data['theme']),
    createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
  };
}

export function subscribeBoards(
  firestore: Firestore,
  tenantId: string,
  onChange: (boards: Board[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const boardsQuery = query(
    collection(firestore, 'tenants', tenantId, 'boards'),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(
    boardsQuery,
    (snapshot) => onChange(snapshot.docs.map((d) => toBoard(d.id, d.data()))),
    (error) => onError?.(error),
  );
}

export function subscribeBoard(
  firestore: Firestore,
  tenantId: string,
  boardId: string,
  onChange: (board: Board | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(firestore, 'tenants', tenantId, 'boards', boardId),
    (snapshot) => onChange(snapshot.exists() ? toBoard(snapshot.id, snapshot.data()) : null),
    (error) => onError?.(error),
  );
}

export interface ViewerKeys {
  overlayKey: string | null;
  mirrorKey: string | null;
}

/**
 * Subscribes to a board's plaintext viewer keys.
 *
 * Readable only by owners and admins — an operator can see that a board exists
 * without being handed its shareable URLs. A permission error here is expected
 * for lower roles and simply yields null keys rather than an error state.
 */
export function subscribeViewerKeys(
  firestore: Firestore,
  tenantId: string,
  boardId: string,
  onChange: (keys: ViewerKeys) => void,
): () => void {
  return onSnapshot(
    doc(firestore, 'tenants', tenantId, 'boards', boardId, 'secrets', 'viewerKeys'),
    (snapshot) => {
      const data = snapshot.data();
      onChange({
        overlayKey: typeof data?.['overlayKey'] === 'string' ? data['overlayKey'] : null,
        mirrorKey: typeof data?.['mirrorKey'] === 'string' ? data['mirrorKey'] : null,
      });
    },
    () => onChange({ overlayKey: null, mirrorKey: null }),
  );
}

export interface CreateBoardResult {
  boardId: string;
  /**
   * Plaintext viewer keys, returned exactly once. Only their SHA-256 hashes are
   * stored, so these cannot be recovered later — losing one means rotating it.
   */
  overlayKey: string;
  mirrorKey: string;
}

export async function createBoard(
  functions: Functions,
  input: { name: string; config?: Partial<BoardConfig> },
): Promise<CreateBoardResult> {
  const call = httpsCallable<typeof input, CreateBoardResult>(functions, 'createBoard');
  const { data } = await call(input);
  return data;
}

export async function updateBoard(
  firestore: Firestore,
  tenantId: string,
  boardId: string,
  patch: { name?: string; config?: BoardConfig; theme?: BoardTheme; archived?: boolean },
): Promise<void> {
  await updateDoc(doc(firestore, 'tenants', tenantId, 'boards', boardId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteBoard(functions: Functions, boardId: string): Promise<void> {
  const call = httpsCallable<{ boardId: string }, { deleted: boolean }>(functions, 'deleteBoard');
  await call({ boardId });
}

/**
 * Issues a fresh key and invalidates the old one immediately — the revocation
 * path for a leaked overlay URL.
 */
export async function rotateViewerKey(
  functions: Functions,
  boardId: string,
  kind: ViewerKeyKind,
): Promise<string> {
  const call = httpsCallable<{ boardId: string; kind: ViewerKeyKind }, { key: string }>(
    functions,
    'rotateViewerKey',
  );
  const { data } = await call({ boardId, kind });
  return data.key;
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

/** Full-screen display for a projector or second monitor. No login required. */
export function buildMirrorUrl(origin: string, boardId: string, key: string): string {
  return `${origin}/mirror/${boardId}?k=${key}`;
}

/** OBS browser source. No login required. */
export function buildOverlayUrl(origin: string, boardId: string, key: string): string {
  return `${origin}/overlay/${boardId}?k=${key}`;
}

/** Keyboard-driven scoreboard. Requires an operator sign-in. */
export function buildScoreboardUrl(origin: string, boardId: string): string {
  return `${origin}/board/${boardId}`;
}

/** Full control panel. Requires an operator sign-in. */
export function buildControlUrl(origin: string, boardId: string): string {
  return `${origin}/control/${boardId}`;
}
