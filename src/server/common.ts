/**
 * Shared plumbing for every API route: admin handles, authorisation guards,
 * key hashing, plan limits, rate limiting, and the audit writer.
 *
 * This is the Vercel-hosted successor to functions/src/common.ts. The one
 * structural difference: Cloud Functions' callable protocol verifies the
 * caller's ID token before a handler ever runs, populating `request.auth`
 * for free. A plain HTTP function has no such handshake, so `requireSignedIn`/
 * `requireRole` here do that verification themselves via the Admin SDK's
 * `verifyIdToken` — the standard way to authenticate a Firebase user outside
 * Firebase's own callable transport.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { VercelRequest } from '@vercel/node';
import { DATABASE_URL, PROJECT_ID } from '../core/firebaseConfig.js';
import { FUNCTIONS_REGION } from '../core/region.js';
import { atLeast, isMemberRole, type MemberRole } from '../core/roles.js';

/**
 * Cloud Functions got Admin SDK credentials for free (ambient service-account
 * identity inside GCP). Vercel has no such thing, so production supplies a
 * service account key explicitly via `FIREBASE_SERVICE_ACCOUNT` (the full
 * downloaded JSON, as a string, set only in the Vercel dashboard — never
 * committed). Local dev/CI talk to the emulator suite instead, which needs no
 * real credential — only `databaseURL`/`projectId` so the Admin SDK knows
 * which emulated project to address.
 *
 * `getApps().length === 0` guards against re-initialising on a warm
 * invocation: Vercel can reuse a container's module scope across requests to
 * the *same* function, and `initializeApp` throws if called twice.
 */
const usingEmulators = Boolean(
  process.env['FIRESTORE_EMULATOR_HOST'] || process.env['FIREBASE_AUTH_EMULATOR_HOST'],
);

/**
 * Parses `FIREBASE_SERVICE_ACCOUNT` with a legible failure.
 *
 * A malformed value here is a *configuration* mistake — most often pasting
 * one field out of the downloaded key file rather than the whole JSON
 * object — but it surfaces at module load, so a bare `JSON.parse` throws a
 * `SyntaxError` that kills the entire function before any handler runs. The
 * client then sees an opaque 500 with nothing to act on, and the real cause
 * is only visible by digging through platform logs. Naming the problem
 * costs one try/catch and turns that into a message that says what to fix.
 */
function parseServiceAccount(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not valid JSON. It must be the entire contents of the ' +
        'service account key file downloaded from the Firebase console (a JSON object ' +
        'starting with "{"), not a single field from it.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be a JSON object.');
  }
  const account = parsed as Record<string, unknown>;
  for (const field of ['project_id', 'client_email', 'private_key'] as const) {
    if (typeof account[field] !== 'string') {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT is missing "${field}". Paste the whole downloaded key file.`,
      );
    }
  }
  return account;
}

if (getApps().length === 0) {
  const serviceAccountJson = process.env['FIREBASE_SERVICE_ACCOUNT'];
  // `credential` is omitted entirely rather than passed as `undefined` when
  // running against the emulators: `initializeApp` validates the property's
  // *presence*, not just its truthiness, and rejects an explicit `undefined`
  // with "The credential property must be an object which implements the
  // Credential interface."
  initializeApp({
    ...(!usingEmulators && serviceAccountJson
      ? { credential: cert(parseServiceAccount(serviceAccountJson)) }
      : {}),
    databaseURL: DATABASE_URL,
    projectId: PROJECT_ID,
  });
}

export const auth = getAuth();
export const firestore = getFirestore();
export const database = getDatabase();

/** Re-exported so `src/server/*.ts` files never import `core/region.ts` directly. */
export const REGION = FUNCTIONS_REGION;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Rejects input that failed schema validation with a client-readable message. */
export function badRequest(message: string): never {
  throw new ApiError(400, message);
}

export interface SignedInCaller {
  uid: string;
  email: string;
  /** The raw decoded token, so a caller can read a claim `SignedInCaller` doesn't surface itself (e.g. `name`). */
  token: DecodedIdToken;
}

export interface Caller extends SignedInCaller {
  tenantId: string;
  role: MemberRole;
}

async function decodeAuth(req: VercelRequest): Promise<DecodedIdToken | null> {
  const header = req.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith('Bearer ')) return null;
  try {
    return await auth.verifyIdToken(value.slice('Bearer '.length));
  } catch {
    return null;
  }
}

export async function requireSignedIn(req: VercelRequest): Promise<SignedInCaller> {
  const token = await decodeAuth(req);
  if (!token) throw new ApiError(401, 'Sign in to continue.');
  return { uid: token.uid, email: typeof token['email'] === 'string' ? token['email'] : '', token };
}

/**
 * Resolves the caller's tenant and role from their custom claims.
 *
 * The claims are read from the verified ID token, never from the request
 * body, so this is the same identity the security rules see.
 */
export async function requireTenant(req: VercelRequest): Promise<Caller> {
  const signedIn = await requireSignedIn(req);
  const tenantId = signedIn.token['tenantId'];
  const role = signedIn.token['role'];

  if (typeof tenantId !== 'string' || tenantId === '') {
    throw new ApiError(412, 'This account has no organisation yet.');
  }
  if (!isMemberRole(role)) {
    throw new ApiError(403, 'This session cannot perform member actions.');
  }
  return { ...signedIn, tenantId, role };
}

export async function requireRole(req: VercelRequest, minimum: MemberRole): Promise<Caller> {
  const caller = await requireTenant(req);
  if (!atLeast(caller.role, minimum)) {
    throw new ApiError(403, `This action requires the ${minimum} role or above.`);
  }
  return caller;
}

// ---------------------------------------------------------------------------
// Viewer keys
// ---------------------------------------------------------------------------

export function hashViewerKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Constant-time hash comparison.
 *
 * A plain `===` on hex strings returns as soon as two characters differ, and
 * that timing difference is measurable across a network given enough samples.
 */
export function viewerKeyMatches(candidate: string, storedHash: unknown): boolean {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  const a = Buffer.from(hashViewerKey(candidate), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Plan limits
// ---------------------------------------------------------------------------

export interface PlanLimits {
  boards: number;
  members: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { boards: 2, members: 3 },
  pro: { boards: 25, members: 25 },
  enterprise: { boards: 500, members: 500 },
};

export function limitsForPlan(plan: unknown): PlanLimits {
  return PLAN_LIMITS[typeof plan === 'string' ? plan : 'free'] ?? PLAN_LIMITS['free']!;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Fixed-window counter in Firestore.
 *
 * `exchangeViewerKey` is callable without authentication, which makes it the
 * one endpoint an attacker can hammer to guess keys. A 43-character key is
 * far out of brute-force reach on its own; this caps the attempt rate anyway
 * so the attempt is not free.
 */
export async function consumeRateLimit(
  bucket: string,
  identifier: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<void> {
  const window = Math.floor(Date.now() / windowMs);
  const docId = `${bucket}_${createHash('sha256').update(identifier).digest('hex').slice(0, 32)}_${window}`;
  const ref = firestore.collection('rateLimits').doc(docId);

  const count = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? ((snapshot.data()?.['count'] as number) ?? 0) : 0;
    const next = current + 1;
    tx.set(ref, { count: next, expiresAt: (window + 1) * windowMs }, { merge: true });
    return next;
  });

  if (count > limit) {
    throw new ApiError(429, 'Too many attempts. Try again shortly.');
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditInput {
  tenantId: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  boardId?: string | null;
  detail?: string;
}

/**
 * Appends to the tenant's audit log.
 *
 * Never throws into the caller: an audit failure must not roll back the
 * action an operator just took mid-game. Failures land in the function's log
 * instead.
 */
export async function writeAudit(event: AuditInput): Promise<void> {
  try {
    await firestore
      .collection('tenants')
      .doc(event.tenantId)
      .collection('audit')
      .add({
        actorUid: event.actorUid,
        actorEmail: event.actorEmail ?? '',
        action: event.action,
        boardId: event.boardId ?? null,
        detail: event.detail ?? '',
        ts: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error('audit write failed', { action: event.action, tenantId: event.tenantId, error });
  }
}
