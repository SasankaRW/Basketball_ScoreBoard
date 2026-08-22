/**
 * Deadline-based clock arithmetic.
 *
 * The original scoreboard decremented a counter inside a 1s `setInterval` and
 * wrote the result to the database on every tick. That design loses a second
 * whenever a frame is dropped, double-counts when two tabs are open, and lets
 * the scoreboard, mirror, and overlay drift apart because each renders whatever
 * write landed last.
 *
 * Here the stored authority is *when the clock runs out*, so ticking becomes a
 * pure display concern. Consequences:
 *   - one write per start/stop instead of one per second;
 *   - every surface renders from the same `endsAt` and cannot disagree;
 *   - a display keeps counting down correctly with the network unplugged.
 *
 * Every function is pure and total. `now` is always passed in — never read from
 * `Date.now()` here — which is what makes the whole module trivially testable
 * and lets callers substitute server-corrected time (see `serverTime.ts`).
 *
 * Operations that would not change anything return the *same object reference*,
 * so callers can skip a database round-trip with a `!==` check.
 */
import type { Clock } from './schema.js';

export type { Clock };

export function createClock(remainingMs: number): Clock {
  return { running: false, endsAt: null, remainingMs: Math.max(0, Math.trunc(remainingMs)) };
}

/** Milliseconds left on the clock at instant `now`. Never negative. */
export function remainingAt(clock: Clock, now: number): number {
  if (!clock.running || clock.endsAt === null) return Math.max(0, clock.remainingMs);
  return Math.max(0, clock.endsAt - now);
}

export function isExpired(clock: Clock, now: number): boolean {
  return remainingAt(clock, now) === 0;
}

/**
 * Starts the clock. No-op when already running, and — matching the original
 * scoreboard's behaviour — when the clock has already expired.
 */
export function startClock(clock: Clock, now: number): Clock {
  if (clock.running) return clock;
  const remaining = Math.max(0, clock.remainingMs);
  if (remaining === 0) return clock;
  return { running: true, endsAt: now + remaining, remainingMs: remaining };
}

/** Freezes the clock at its current value. No-op when already paused. */
export function pauseClock(clock: Clock, now: number): Clock {
  if (!clock.running) return clock;
  return { running: false, endsAt: null, remainingMs: remainingAt(clock, now) };
}

export function toggleClock(clock: Clock, now: number): Clock {
  return clock.running ? pauseClock(clock, now) : startClock(clock, now);
}

/**
 * Sets the remaining time, preserving whether the clock is running. Setting a
 * running clock to zero stops it, since a clock cannot run past its deadline.
 */
export function setRemaining(clock: Clock, remainingMs: number, now: number): Clock {
  const remaining = Math.max(0, Math.trunc(remainingMs));
  if (!clock.running) {
    if (clock.remainingMs === remaining) return clock;
    return { running: false, endsAt: null, remainingMs: remaining };
  }
  if (remaining === 0) return { running: false, endsAt: null, remainingMs: 0 };
  return { running: true, endsAt: now + remaining, remainingMs: remaining };
}

/**
 * Normalises a clock that has run past its deadline into an explicit paused-at-zero
 * state. Callers persist the result so every viewer agrees the period has ended
 * rather than each independently rendering 00:00 over a still-"running" clock.
 */
export function settleExpired(clock: Clock, now: number): Clock {
  if (!clock.running || remainingAt(clock, now) > 0) return clock;
  return { running: false, endsAt: null, remainingMs: 0 };
}

/** True when the two clocks would render and behave identically. */
export function clocksEqual(a: Clock, b: Clock): boolean {
  return a.running === b.running && a.endsAt === b.endsAt && a.remainingMs === b.remainingMs;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Seconds shown for a given remaining time.
 *
 * Rounds *up*, which is what makes a 12:00 period display "12:00" for its whole
 * first second and reach "00:00" only at the true deadline — the same sequence
 * the original decrementing implementation produced.
 */
export function displaySeconds(ms: number): number {
  return Math.ceil(Math.max(0, ms) / 1000);
}

const TENTHS_CUTOFF_MS = 60_000;

/**
 * Formats the game clock as MM:SS.
 *
 * With `showTenths`, drops to S.T under one minute — the broadcast convention.
 * It is off by default so the classic scoreboard renders exactly as it always has.
 */
export function formatGameClock(ms: number, showTenths = false): string {
  const clamped = Math.max(0, ms);
  if (showTenths && clamped < TENTHS_CUTOFF_MS) {
    const tenths = Math.ceil(clamped / 100);
    if (tenths < 600) {
      return `${Math.floor(tenths / 10)}.${tenths % 10}`;
    }
  }
  const total = displaySeconds(clamped);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats the shot clock as a two-digit second count, or S.T under five seconds
 * when `showTenths` is on.
 */
export function formatShotClock(ms: number, showTenths = false): string {
  const clamped = Math.max(0, ms);
  if (showTenths && clamped < 5_000) {
    const tenths = Math.ceil(clamped / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  return String(displaySeconds(clamped)).padStart(2, '0');
}

/**
 * How long until the rendered text would next change, in milliseconds.
 *
 * Lets a render loop sleep precisely until the next visible transition instead
 * of spinning every animation frame, which keeps an idle overlay near 0% CPU on
 * the streaming machine.
 */
export function msUntilDisplayChange(ms: number, showTenths = false): number {
  const clamped = Math.max(0, ms);
  if (clamped === 0) return Infinity;
  const step = showTenths && clamped < TENTHS_CUTOFF_MS ? 100 : 1000;
  const remainder = clamped % step;
  return remainder === 0 ? step : remainder;
}
