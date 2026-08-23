/**
 * Session context for the console.
 *
 * Wraps `subscribeAuth`, which listens on `onIdTokenChanged` — so a role change
 * made by an admin, or claims landing at the end of signup, propagates through
 * the UI without a reload.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getFirebase } from '../core/firebase.js';
import { signOutSession, subscribeAuth, waitForClaims, type AuthState } from '../core/auth.js';
import { startServerTimeSync } from '../core/serverTime.js';

interface AuthContextValue {
  state: AuthState;
  signOut: () => Promise<void>;
  retryProvisioning: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth, db } = getFirebase();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    // Started here rather than per-page: the control panel writes deadlines that
    // every display reads, so its clock must be server-corrected from the moment
    // the console loads, not from the moment a board is opened.
    const stopTimeSync = startServerTimeSync(db);
    const stopAuth = subscribeAuth(auth, setState);
    return () => {
      stopAuth();
      stopTimeSync();
    };
  }, [auth, db]);

  /**
   * Deliberately keyed on `auth` alone, never on `state`.
   *
   * This polls by *force-refreshing* the ID token, and a force refresh fires
   * `onIdTokenChanged`, which calls `setState` above. If this callback's
   * identity also changed whenever `state` changed, any caller holding it in
   * an effect's dependency array would re-run that effect on every refresh —
   * refresh → state change → new callback → effect re-runs → refresh, forever.
   * That loop is not theoretical: it ran in production against an account
   * whose claims never arrive (provisioning half-failed), and hammered
   * Firebase's token endpoint until it returned `auth/quota-exceeded`.
   */
  const retryProvisioning = useCallback(async () => {
    await waitForClaims(auth);
  }, [auth]);

  const signOut = useCallback(() => signOutSession(auth), [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signOut, retryProvisioning }),
    [state, signOut, retryProvisioning],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * The signed-in session, for components rendered behind `<RequireAuth>`.
 * Throws rather than returning null so a component cannot silently render a
 * tenant-less view.
 */
export function useSession() {
  const { state } = useAuth();
  if (state.status !== 'signed-in') {
    throw new Error('useSession requires a signed-in session');
  }
  return state.session;
}
