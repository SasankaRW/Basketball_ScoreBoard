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
 * `now()` is safe to call before the offset arrives — it returns this device's
 * own time until the first reading lands, typically within a few hundred
 * milliseconds.
 *
 * The tick source is `performance.now()`, not `Date.now()`. That is what makes
 * this monotonic for free: it counts from a fixed origin and is immune to the
 * device clock being stepped underneath it, which Windows NTP does on venue
 * machines without warning. `Date.now()` is read only when a fresh offset
 * arrives, to place that monotonic count relative to the server.
 *
 * Monotonicity matters because pausing a clock computes `endsAt - now()` and
 * `formatGameClock` rounds up to the next second, so a `now()` that flickers
 * backward as the displayed second rolls over freezes the clock one second
 * higher than what the operator saw when they clicked.
 *
 * An earlier fix for that flicker latched `now()` to its highest return value.
 * It was much worse than the problem: the latch had no bound and never decayed,
 * so a reading landing *ahead* of the truth — a first sync on a device whose
 * clock is fast, a poor estimate over a laggy connection — pinned `now()` to a
 * future value, and every later call returned that same frozen number until
 * real time caught up. A laptop forty seconds fast froze every clock on every
 * surface for forty seconds; operators saw the panel stall and then jump to
 * catch up. So a correction is applied here rather than clamped away:
 *
 *   - a small one (the ordinary few-millisecond wobble) is *slewed* — absorbed
 *     a fraction at a time, so the rate changes briefly but the clock never
 *     jumps and never runs backward;
 *   - a large one is *stepped*, because a correction that big means the last
 *     reading was wrong (first sync, resumed laptop, reconnect after a long
 *     drop) and being right beats being smooth.
 */
import { onValue, ref, type Database } from 'firebase/database';

/**
 * How far off a reading has to be before it is applied as a jump rather than
 * absorbed gradually. Comfortably above the wobble of a healthy connection and
 * well below any error an operator could read off the board.
 */
const STEP_THRESHOLD_MS = 1_000;

/**
 * The share of elapsed time spent absorbing a pending correction. At a
 * twentieth, a half-second error is gone in ten seconds while the clock's rate
 * is off by 5% — invisible on a scoreboard, and still always moving forward.
 */
const SLEW_RATE = 0.05;

let offsetMs = 0;
let synced = false;
let detach: (() => void) | null = null;

/** `performance.now()` and the server time it was known to correspond to. */
let anchorPerf = performance.now();
let anchorServer = Date.now();
/** Correction still to be absorbed by slewing. Signed; 0 when settled. */
let pendingMs = 0;

function serverAt(perf: number): number {
  // Clamped because a negative elapsed would be a backward step, which is the
  // one thing this module exists to rule out. `performance.now()` is monotonic
  // within a document, so this only ever bites if the anchor was taken against
  // a different time origin than the caller's.
  const elapsed = Math.max(0, perf - anchorPerf);
  const absorbed = Math.sign(pendingMs) * Math.min(Math.abs(pendingMs), elapsed * SLEW_RATE);
  return anchorServer + elapsed + absorbed;
}

/**
 * Folds one `/.info/serverTimeOffset` reading into the clock.
 *
 * Exported so the step/slew behaviour can be tested directly — it is the whole
 * substance of this module, and reaching it through `startServerTimeSync` would
 * mean standing up a Database just to deliver a number.
 */
export function applyOffsetReading(value: number): void {
  const perf = performance.now();
  const current = serverAt(perf);
  const target = Date.now() + value;

  if (!synced || Math.abs(target - current) > STEP_THRESHOLD_MS) {
    anchorServer = target;
    pendingMs = 0;
  } else {
    // Carry on from exactly where the clock already is, then absorb the
    // difference over the following seconds. Re-anchoring on `current` is what
    // makes this continuous: `now()` returns the same value either side of it.
    anchorServer = current;
    pendingMs = target - current;
  }

  anchorPerf = perf;
  offsetMs = value;
  synced = true;
}

export function startServerTimeSync(db: Database): () => void {
  if (detach) return detach;

  const unsubscribe = onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
    const value = snapshot.val();
    if (typeof value === 'number' && Number.isFinite(value)) {
      applyOffsetReading(value);
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
  return serverAt(performance.now());
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
 * Re-anchors rather than slewing: a caller setting the offset by hand wants
 * `now()` to reflect it on the very next call, not a second later.
 */
export function setOffsetForTesting(value: number): void {
  offsetMs = value;
  synced = true;
  anchorPerf = performance.now();
  anchorServer = Date.now() + value;
  pendingMs = 0;
}
