/**
 * Firestore, loaded on demand.
 *
 * Split out from firebase.ts specifically so the scoreboard, mirror and overlay
 * bundles — which never call into Firestore — do not pay for it. The console app
 * calls `ensureFirestoreClient()` once at boot (see app/main.tsx) and every app
 * page thereafter reads the synchronous `getFirestoreClient()`.
 */
import type { Firestore } from 'firebase/firestore';
import { EMULATOR_HOST, EMULATOR_PORTS, getFirebase } from './firebase.js';

let instance: Firestore | null = null;
let pending: Promise<Firestore> | null = null;

export function ensureFirestoreClient(): Promise<Firestore> {
  if (instance) return Promise.resolve(instance);
  if (pending) return pending;

  const { app, usingEmulators } = getFirebase();

  pending = import('firebase/firestore').then(({ getFirestore, connectFirestoreEmulator }) => {
    const firestore = getFirestore(app);
    if (usingEmulators) {
      connectFirestoreEmulator(firestore, EMULATOR_HOST, EMULATOR_PORTS.firestore);
    }
    instance = firestore;
    return firestore;
  });

  return pending;
}

/** Throws if called before `ensureFirestoreClient()` has resolved. */
export function getFirestoreClient(): Firestore {
  if (!instance) {
    throw new Error('Firestore is not ready yet — await ensureFirestoreClient() first.');
  }
  return instance;
}
