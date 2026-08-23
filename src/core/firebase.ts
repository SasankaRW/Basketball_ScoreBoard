/**
 * One Firebase app instance, shared by every page.
 *
 * Configuration comes from Vite env vars, falling back to the project's own
 * config. That fallback is safe: a Firebase web config is a set of public
 * identifiers, not credentials — the security boundary is the rules in
 * firestore.rules and database.rules.json, not the visibility of these strings.
 *
 * Firestore is deliberately absent from this module — see firestoreClient.ts.
 * The scoreboard, mirror and overlay pages never touch Firestore, only Auth
 * and Realtime Database. Because bundlers include a shared module's entire
 * import graph in whatever chunk reaches every entry point, importing
 * `firebase/firestore` here — one of the larger pieces of the SDK — would
 * have shipped it to the OBS overlay on every load for a feature the overlay
 * never calls.
 *
 * Privileged operations (create board, finish match, invite a member, …) go
 * through `core/api.ts`'s `callApi()` — plain `fetch` calls to `/api/*`
 * (Vercel serverless functions), not the Firebase Functions SDK, so there is
 * no `functions` client here to construct.
 */
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';
import { DATABASE_URL, PROJECT_ID } from './firebaseConfig.js';

const env = import.meta.env;

const DEFAULT_CONFIG: FirebaseOptions = {
  apiKey: 'AIzaSyB0I8H2bAIFMMB01n-4p-G3ogxbmp3Nii8',
  authDomain: 'basketballscoreboard-65c95.firebaseapp.com',
  databaseURL: DATABASE_URL,
  projectId: PROJECT_ID,
  storageBucket: 'basketballscoreboard-65c95.firebasestorage.app',
  messagingSenderId: '31697951521',
  appId: '1:31697951521:web:074259ad89964d30437c60',
};

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? DEFAULT_CONFIG.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? DEFAULT_CONFIG.authDomain,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL ?? DEFAULT_CONFIG.databaseURL,
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? DEFAULT_CONFIG.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? DEFAULT_CONFIG.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? DEFAULT_CONFIG.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID ?? DEFAULT_CONFIG.appId,
};

/**
 * Emulator ports, kept in step with the `emulators` block in firebase.json.
 * Firestore sits on 8085 rather than the Firebase default of 8080, which Docker
 * Desktop commonly occupies.
 */
export const EMULATOR_PORTS = {
  auth: 9099,
  database: 9000,
  firestore: 8085,
  storage: 9199,
} as const;

export const EMULATOR_HOST = '127.0.0.1';

export function shouldUseEmulators(): boolean {
  if (env.VITE_USE_EMULATORS === 'true') return true;
  if (env.VITE_USE_EMULATORS === 'false') return false;
  if (typeof window === 'undefined') return false;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export interface FirebaseOptionsForSurface {
  /**
   * Keep this surface's session in memory only, never in browser storage.
   *
   * Set by the mirror and the overlay, and by nothing else. Those two sign in
   * with a viewer custom token, and Firebase Auth persists a session per
   * *origin* — so with ordinary persistence, opening a mirror link in the same
   * browser as the console overwrites the operator's own session with a
   * `role: 'mirror'` one. The symptom is remote from the cause and reads like
   * a permissions bug: the dashboard comes back saying "You have read-only
   * access to this board".
   *
   * In-memory persistence scopes the viewer session to that one tab and leaves
   * storage untouched, which is also simply correct for these pages — they
   * re-exchange the key in the URL on every load, so they have nothing to gain
   * from a persisted session.
   */
  ephemeralAuth?: boolean;
}

let cached: {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  usingEmulators: boolean;
  ephemeralAuth: boolean;
} | null = null;

export function getFirebase(options: FirebaseOptionsForSurface = {}) {
  const ephemeralAuth = options.ephemeralAuth ?? false;

  if (cached) {
    // Only an *explicit* conflicting request is an error. Most callers —
    // `callApi`, `ensureFirestoreClient`, every console page — pass no options
    // at all and simply want whatever this page already built; on a viewer
    // surface that is legitimately the ephemeral instance, and treating an
    // omitted option as "asked for persistent" would reject them.
    if (options.ephemeralAuth !== undefined && cached.ephemeralAuth !== ephemeralAuth) {
      throw new Error(
        `getFirebase() was already initialised with ephemeralAuth=${cached.ephemeralAuth}; ` +
          `a later call asked for ${ephemeralAuth}. Viewer surfaces must be the first to ` +
          'initialise Firebase on their page.',
      );
    }
    return cached;
  }

  const app = initializeApp(firebaseConfig);
  // `initializeAuth` rather than `getAuth` so persistence is explicit. The
  // non-ephemeral list mirrors what `getAuth` picks on the web by default.
  const auth = initializeAuth(app, {
    persistence: ephemeralAuth
      ? inMemoryPersistence
      : [indexedDBLocalPersistence, browserLocalPersistence],
  });
  const db = getDatabase(app);
  const usingEmulators = shouldUseEmulators();

  if (usingEmulators) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
      disableWarnings: true,
    });
    connectDatabaseEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.database);
  }

  cached = { app, auth, db, usingEmulators, ephemeralAuth };
  return cached;
}

export const isEmulated = (): boolean => getFirebase().usingEmulators;
