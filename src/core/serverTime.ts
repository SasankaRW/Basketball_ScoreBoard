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
 *
 * `/.info/serverTimeOffset` is not a one-time reading — Firebase re-publishes
 * it as its own estimate wobbles, typically by single-digit milliseconds but
 * occasionally more. `Date.now()` alone is monotonic; `Date.now() + offsetMs`
 * is not, because `offsetMs` itself can tick down between two calls a few
 * milliseconds apart. Pausing a clock computes `endsAt - now()`, and
 * `formatGameClock` rounds the result up to the next second — so a `now()`
 * that so much as flickers backward right as the displayed second is about to
 * roll over freezes the clock one second higher than what was on screen when
 * the operator clicked. `now()` below latches its highest return value so a
 * softer offset reading can only ever slow the clock's forward *rate*, never
 * turn it back.
 */
import { onValue, ref, type Database } from 'firebase/database';

let offsetMs = 0;
let synced = false;
let detach: (() => void) | null = null;
let lastNow = 0;

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
  lastNow = Math.max(lastNow, Date.now() + offsetMs);
  return lastNow;
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
 *
 * Also resets `now()`'s monotonic floor, since a test that deliberately moves
 * the clock backward (or a fresh test picking up the previous test's latch)
 * needs `now()` to actually reflect the override, not clamp against it.
 */
export function setOffsetForTesting(value: number): void {
  offsetMs = value;
  synced = true;
  lastNow = 0;
}
