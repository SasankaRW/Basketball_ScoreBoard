/**
 * Server-corrected wall clock.
 *
 * Every deadline in the system is an absolute timestamp, so a display machine
 * whose clock is wrong shows a wrong game clock — and venue PCs are wrong
 * surprisingly often, sometimes by minutes. The Realtime Database publishes the
 * difference between its clock and this device's at `/.info/serverTimeOffset`;
 * applying it makes every surface agree on what time it is even when none of
 * them agrees with the wall.
 *
 * `now()` is safe to call before the offset arrives — it simply returns local
 * time until the first reading lands, typically within a few hundred milliseconds.
 */
import { onValue, ref, type Database } from 'firebase/database';

let offsetMs = 0;
let synced = false;
let detach: (() => void) | null = null;

export function startServerTimeSync(db: Database): () => void {
  if (detach) return detach;

  const unsubscribe = onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
    const value = snapshot.val();
    if (typeof value === 'number' && Number.isFinite(value)) {
      offsetMs = value;
      synced = true;
    }
  });

  detach = () => {
    unsubscribe();
    detach = null;
  };
  return detach;
}

/** Current time in server terms. Use this everywhere instead of `Date.now()`. */
export function now(): number {
  return Date.now() + offsetMs;
}

/** How far this device's clock is from the server's, in milliseconds. */
export function getOffsetMs(): number {
  return offsetMs;
}

export function isSynced(): boolean {
  return synced;
}

/**
 * Overrides the offset directly. Exists for tests and for the deterministic
 * screenshot harness, which needs a fixed clock to produce stable images.
 */
export function setOffsetForTesting(value: number): void {
  offsetMs = value;
  synced = true;
}
