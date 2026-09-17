/**
 * `now()` must never go backward, and must never stop going forward either —
 * see the long comment in `src/core/serverTime.ts`.
 *
 * The first half is what an earlier fix got right: pausing a clock computes
 * `endsAt - now()`, rounded up to the next second by `formatGameClock`, so a
 * `now()` that flickers backward as the displayed second rolls over freezes the
 * clock a second higher than what was on screen when the operator clicked.
 *
 * The second half is what that fix got wrong, and what most of this file pins
 * down. Latching `now()` to its highest return value stopped the flicker by
 * stopping the clock: a reading that landed ahead of the truth pinned it to a
 * future value and every later call returned that same number until real time
 * caught up. Corrections have to be *applied* — slewed when small, stepped when
 * large — never clamped away.
 *
 * Under fake timers `performance.now()` moves only with `advanceTimersByTime`,
 * while `setSystemTime` moves only `Date.now()`. That split is exactly the real
 * hazard being modelled: a device clock stepped by NTP underneath a monotonic
 * tick source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyOffsetReading,
  getOffsetMs,
  now,
  setOffsetForTesting,
} from '../../src/core/serverTime.js';

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

  it('applies a negative offset immediately, so a test can move the clock back on purpose', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    expect(now()).toBe(1_000_000);

    setOffsetForTesting(-500);
    expect(now()).toBe(999_500);
  });

  it('advances with elapsed time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    expect(now()).toBe(1_000_000);

    vi.advanceTimersByTime(250);
    expect(now()).toBe(1_000_250);
  });

  it("returns this device's own time until the first reading lands", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.resetModules();
    const fresh = await import('../../src/core/serverTime.js');

    expect(fresh.isSynced()).toBe(false);
    expect(fresh.now()).toBe(1_000_000);
  });

  it('is unmoved by the device clock being stepped backward', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    vi.advanceTimersByTime(100);

    // Windows NTP resyncs mid-game and steps the machine back a second. The
    // tick source is monotonic, so this is invisible to `now()`.
    vi.setSystemTime(999_000);
    expect(now()).toBe(1_000_100);
  });

  it('keeps ticking after a large correction rather than freezing until real time catches up', () => {
    vi.useFakeTimers();
    // This venue laptop's clock is forty seconds fast, which is all `now()` has
    // to go on until the first reading arrives.
    vi.setSystemTime(1_040_000);
    setOffsetForTesting(0);
    expect(now()).toBe(1_040_000);

    // The reading lands: the server is forty seconds behind this device.
    applyOffsetReading(-40_000);
    expect(now()).toBe(1_000_000);

    // The high-water latch pinned `now()` at 1_040_000 and returned it for the
    // next forty seconds, freezing every clock on every surface. It has to tick
    // straight on from the corrected value instead.
    vi.advanceTimersByTime(1_000);
    expect(now()).toBe(1_001_000);
  });

  it('steps a correction too large to have come from ordinary wobble', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);

    applyOffsetReading(5_000);
    expect(now()).toBe(1_005_000);
    expect(getOffsetMs()).toBe(5_000);
  });

  it('slews a small correction instead of jumping, and never runs backward while it does', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setOffsetForTesting(0);
    const before = now();

    // The server is 200ms behind where this clock has it — the ordinary wobble
    // of a live estimate, and the case the latch existed for.
    applyOffsetReading(-200);
    expect(now()).toBe(before);

    let previous = now();
    for (let tick = 0; tick < 100; tick += 1) {
      vi.advanceTimersByTime(100);
      const value = now();
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }

    // Ten seconds is far more than a twentieth of elapsed time needs to absorb
    // 200ms, so by now the clock is exactly on the server.
    expect(now()).toBe(Date.now() - 200);
  });
});
