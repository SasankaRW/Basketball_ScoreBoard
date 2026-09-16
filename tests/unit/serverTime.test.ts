/**
 * `now()` must never go backward — see the long comment on it in
 * `src/core/serverTime.ts`. `/.info/serverTimeOffset` is a live, wobbling
 * estimate (and the device clock itself can be stepped backward by NTP), so
 * `Date.now() + offsetMs` alone is not monotonic. Pausing a clock computes
 * `endsAt - now()`, rounded up to the next second by `formatGameClock` — a
 * `now()` that so much as flickers backward right as the displayed second is
 * about to roll over freezes the clock one second higher than what was on
 * screen when the operator clicked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOffsetMs, now, setOffsetForTesting } from '../../src/core/serverTime.js';

afterEach(() => {
  vi.useRealTimers();
  setOffsetForTesting(0);
});

describe('now()', () => {
  it('reflects a fresh offset immediately after setOffsetForTesting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(500);
    expect(now()).toBe(1_000_500);
    expect(getOffsetMs()).toBe(500);
  });

  it('advances with the system clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    expect(now()).toBe(1_000_000);
    vi.setSystemTime(1_000_250);
    expect(now()).toBe(1_000_250);
  });

  it('never returns a value lower than a previous call, even if the underlying clock steps backward', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    const first = now();
    expect(first).toBe(1_000_000);

    // A device clock stepped backward by NTP, or a `.info/serverTimeOffset`
    // reading that came in lower than the last one — both move the raw
    // `Date.now() + offsetMs` input backward without going through
    // `setOffsetForTesting` (which would reset the latch on purpose).
    vi.setSystemTime(999_950);
    expect(now()).toBe(1_000_000);

    // And once the clock catches back up past the latched value, `now()`
    // tracks it forward again rather than staying stuck.
    vi.setSystemTime(1_000_400);
    expect(now()).toBe(1_000_400);
  });

  it('setOffsetForTesting resets the latch, so a test can move the clock backward on purpose', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    expect(now()).toBe(1_000_000);

    setOffsetForTesting(-500);
    expect(now()).toBe(999_500);
  });
});
