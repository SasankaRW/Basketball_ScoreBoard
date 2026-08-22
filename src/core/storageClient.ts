/**
 * Cloud Storage, loaded on demand.
 *
 * Split out from firebase.ts for the same reason firestoreClient.ts is: the
 * scoreboard, mirror, and overlay bundles never touch Storage (they render a
 * plain URL string that already rode along through RTDB), and even within
 * the console app only the board-logo upload flow needs it — so unlike
 * Firestore, this is not fetched eagerly at boot. `ensureStorageClient()` is
 * called the first time an upload is actually attempted.
 */
import type { FirebaseStorage } from 'firebase/storage';
import { EMULATOR_HOST, EMULATOR_PORTS, getFirebase } from './firebase.js';

let instance: FirebaseStorage | null = null;
let pending: Promise<FirebaseStorage> | null = null;

export function ensureStorageClient(): Promise<FirebaseStorage> {
  if (instance) return Promise.resolve(instance);
  if (pending) return pending;

  const { app, usingEmulators } = getFirebase();

  pending = import('firebase/storage').then(({ getStorage, connectStorageEmulator }) => {
    const storage = getStorage(app);
    if (usingEmulators) {
      connectStorageEmulator(storage, EMULATOR_HOST, EMULATOR_PORTS.storage);
    }
    instance = storage;
    return storage;
  });

  return pending;
}
