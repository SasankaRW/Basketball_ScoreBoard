/**
 * Session and tenant context.
 *
 * `tenantId` and `role` are Firebase Auth **custom claims**, written only by the
 * Cloud Functions in functions/src/claims.ts. Reading them from the ID token
 * rather than from a Firestore document is what makes them trustworthy: the same
 * signed token the client reads is the one the security rules evaluate, so the
 * UI and the backend can never disagree about who someone is.
 */
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import { httpsCallable, type Functions } from 'firebase/functions';
import { isMachineRole, isMemberRole, type MemberRole, type Role } from './roles.js';

export interface Session {
  uid: string;
  email: string | null;
  displayName: string | null;
  tenantId: string;
  role: Role;
  /** Set only on machine tokens, restricting the session to one board. */
  boardId: string | null;
}

/**
 * A signed-in user whose claims have not landed yet.
 *
 * Custom claims set during signup only appear after the ID token refreshes, so
 * there is a real window — usually a second or two — where someone is
 * authenticated but has no tenant. The dashboard shows a provisioning state for
 * this rather than bouncing them back to the login page.
 */
export interface PendingSession {
  uid: string;
  email: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'provisioning'; user: PendingSession }
  | { status: 'signed-in'; session: Session };

function toSession(user: User, claims: Record<string, unknown>): Session | null {
  const tenantId = claims['tenantId'];
  const role = claims['role'];
  if (typeof tenantId !== 'string' || tenantId === '') return null;
  if (!isMemberRole(role) && !isMachineRole(role)) return null;

  const boardId = claims['boardId'];
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    tenantId,
    role,
    boardId: typeof boardId === 'string' ? boardId : null,
  };
}

/**
 * Subscribes to authentication state.
 *
 * Uses `onIdTokenChanged` rather than `onAuthStateChanged` so a claims refresh —
 * a role change, or provisioning completing — propagates without a reload.
 */
export function subscribeAuth(auth: Auth, onChange: (state: AuthState) => void): () => void {
  onChange({ status: 'loading' });

  return onIdTokenChanged(auth, (user) => {
    if (!user) {
      onChange({ status: 'signed-out' });
      return;
    }
    void user
      .getIdTokenResult()
      .then((token) => {
        const session = toSession(user, token.claims as Record<string, unknown>);
        onChange(
          session
            ? { status: 'signed-in', session }
            : { status: 'provisioning', user: { uid: user.uid, email: user.email } },
        );
      })
      .catch(() => onChange({ status: 'signed-out' }));
  });
}

export async function signIn(auth: Auth, email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  organisationName: string;
}

/**
 * Creates the account, then asks the backend to provision a tenant for it.
 *
 * Tenant creation is a Function rather than a client write because it has to set
 * custom claims, which only the Admin SDK can do. The forced token refresh at
 * the end is what makes the new claims visible without a page reload.
 */
export async function signUp(
  auth: Auth,
  functions: Functions,
  input: SignUpInput,
): Promise<Session> {
  const credential = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password);

  if (input.displayName.trim()) {
    await updateProfile(credential.user, { displayName: input.displayName.trim() });
  }

  const provision = httpsCallable<{ organisationName: string }, { tenantId: string }>(
    functions,
    'provisionTenant',
  );
  await provision({ organisationName: input.organisationName.trim() });

  const session = await refreshSession(auth);
  if (!session) {
    throw new Error('Account created, but provisioning did not complete. Try signing in again.');
  }
  return session;
}

/** Forces a token refresh and re-reads the claims. */
export async function refreshSession(auth: Auth): Promise<Session | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdTokenResult(true);
  return toSession(user, token.claims as Record<string, unknown>);
}

/**
 * Polls for claims to appear after signup.
 *
 * Token propagation is not instantaneous and there is no event to await, so a
 * short bounded poll is the honest implementation. Gives up rather than spinning
 * forever, and the caller surfaces that as a retry.
 */
export async function waitForClaims(
  auth: Auth,
  { attempts = 8, delayMs = 750 } = {},
): Promise<Session | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await refreshSession(auth);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export async function signOutSession(auth: Auth): Promise<void> {
  await signOut(auth);
}

export async function requestPasswordReset(auth: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Signs in a display surface using the token minted from a viewer key.
 *
 * The resulting session carries `role: 'overlay' | 'mirror'` and a `boardId`, so
 * the database rules grant it read access to exactly one board and match no
 * write rule at all.
 */
export async function signInWithViewerToken(auth: Auth, token: string): Promise<Session> {
  const credential = await signInWithCustomToken(auth, token);
  const result = await credential.user.getIdTokenResult();
  const session = toSession(credential.user, result.claims as Record<string, unknown>);
  if (!session) throw new Error('Viewer token is missing its tenant or board claim.');
  return session;
}

/** Human-readable message for the auth error codes a login form actually hits. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your organisation owner.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists for that email address.';
    case 'auth/weak-password':
      return 'Choose a password of at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Cannot reach the server. Check the network connection.';
    default:
      return error instanceof Error && error.message
        ? error.message
        : 'Something went wrong. Please try again.';
  }
}

export type { MemberRole };
