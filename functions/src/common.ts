/**
 * Shared plumbing for every callable: admin handles, authorisation guards,
 * key hashing, plan limits, rate limiting, and the audit writer.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { DATABASE_URL } from '../../src/core/firebaseConfig.js';
import { FUNCTIONS_REGION } from '../../src/core/region.js';
import { atLeast, isMemberRole, type MemberRole } from '../../src/core/roles.js';

/**
 * `databaseURL` is explicit rather than auto-detected — see firebaseConfig.ts.
 * Without it, the Functions emulator (unable to look up the project's real
 * config without a `firebase login` session) silently falls back to a guessed
 * default URL that does not match this non-default-region database, so an
 * Admin SDK write here would land in a namespace no client ever reads from.
 */
initializeApp({ databaseURL: DATABASE_URL });

export const auth = getAuth();
export const firestore = getFirestore();
export const database = getDatabase();

/**
 * Deployed alongside the Realtime Database instance in asia-southeast1. Callables
 * that sit in the request path of a page load — `exchangeViewerKey` above all —
 * pay a full round trip for every region hop, so co-location is not cosmetic.
 *
 * Re-exported from core/region.ts rather than declared here so the client and
 * the Functions codebase share one literal — see that file's comment for what
 * breaks if the two ever disagree.
 */
export const REGION = FUNCTIONS_REGION;

export interface Caller {
  uid: string;
  email: string;
  tenantId: string;
  role: MemberRole;
}

export function requireSignedIn(request: CallableRequest): { uid: string; email: string } {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const email = typeof token?.['email'] === 'string' ? token['email'] : '';
  return { uid, email };
}

/**
 * Resolves the caller's tenant and role from their custom claims.
 *
 * The claims are read from the verified ID token, never from the request body,
 * so this is the same identity the security rules see.
 */
export function requireTenant(request: CallableRequest): Caller {
  const { uid, email } = requireSignedIn(request);
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const tenantId = token?.['tenantId'];
  const role = token?.['role'];

  if (typeof tenantId !== 'string' || tenantId === '') {
    throw new HttpsError('failed-precondition', 'This account has no organisation yet.');
  }
  if (!isMemberRole(role)) {
    throw new HttpsError('permission-denied', 'This session cannot perform member actions.');
  }
  return { uid, email, tenantId, role };
}

export function requireRole(request: CallableRequest, minimum: MemberRole): Caller {
  const caller = requireTenant(request);
  if (!atLeast(caller.role, minimum)) {
    throw new HttpsError('permission-denied', `This action requires the ${minimum} role or above.`);
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
 * `exchangeViewerKey` is callable without authentication, which makes it the one
 * endpoint an attacker can hammer to guess keys. A 43-character key is far out of
 * brute-force reach on its own; this caps the attempt rate anyway so the attempt
 * is not free. App Check is the second layer and is configured separately.
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
    throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
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
 * Never throws into the caller: an audit failure must not roll back the action
 * an operator just took mid-game. Failures land in Cloud Logging instead.
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

/** Rejects input that failed schema validation with a client-readable message. */
export function badRequest(message: string): never {
  throw new HttpsError('invalid-argument', message);
}
