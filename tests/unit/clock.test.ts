import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clocksEqual,
  createClock,
  displaySeconds,
  formatGameClock,
  formatShotClock,
  isExpired,
  msUntilDisplayChange,
  pauseClock,
  remainingAt,
  setRemaining,
  settleExpired,
  startClock,
  toggleClock,
  type Clock,
} from '../../src/core/clock.js';

const T0 = 1_700_000_000_000;

/** Arbitrary clock in either state, with a coherent endsAt. */
const arbClock = (now: number) =>
  fc
    .record({
      running: fc.boolean(),
      remainingMs: fc.integer({ min: 0, max: 99 * 60_000 }),
    })
    .map<Clock>(({ running, remainingMs }) =>
      running && remainingMs > 0
        ? { running: true, endsAt: now + remainingMs, remainingMs }
        : { running: false, endsAt: null, remainingMs },
    );

describe('createClock', () => {
  it('starts paused with the given time', () => {
    expect(createClock(720_000)).toEqual({ running: false, endsAt: null, remainingMs: 720_000 });
  });

  it('floors negative and fractional input', () => {
    expect(createClock(-5).remainingMs).toBe(0);
    expect(createClock(1500.9).remainingMs).toBe(1500);
  });
});

describe('remainingAt', () => {
  it('counts down from the deadline while running', () => {
    const running = startClock(createClock(24_000), T0);
    expect(remainingAt(running, T0)).toBe(24_000);
    expect(remainingAt(running, T0 + 1_000)).toBe(23_000);
    expect(remainingAt(running, T0 + 23_999)).toBe(1);
    expect(remainingAt(running, T0 + 24_000)).toBe(0);
  });

  it('is frozen while paused, regardless of how much time passes', () => {
    const paused = createClock(24_000);
    expect(remainingAt(paused, T0)).toBe(24_000);
    expect(remainingAt(paused, T0 + 10 * 60_000)).toBe(24_000);
  });

  it('never returns a negative value, however far past the deadline', () => {
    fc.assert(
      fc.property(
        arbClock(T0),
        fc.integer({ min: -1_000_000, max: 10_000_000 }),
        (clock, delta) => {
          expect(remainingAt(clock, T0 + delta)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('start / pause', () => {
  it('refuses to start an expired clock, matching the original behaviour', () => {
    const expired = createClock(0);
    expect(startClock(expired, T0)).toBe(expired);
  });

  it('returns the identical reference when the action changes nothing', () => {
    const paused = createClock(1_000);
    expect(pauseClock(paused, T0)).toBe(paused);

    const running = startClock(paused, T0);
    expect(startClock(running, T0)).toBe(running);
  });

  it('pausing immediately after starting preserves the exact remaining time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 * 60_000 }), (ms) => {
        const paused = createClock(ms);
        const roundTripped = pauseClock(startClock(paused, T0), T0);
        expect(clocksEqual(roundTripped, paused)).toBe(true);
      }),
    );
  });

  it('deducts exactly the elapsed time across a start/pause cycle', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 * 60_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        (ms, elapsed) => {
          const after = pauseClock(startClock(createClock(ms), T0), T0 + elapsed);
          expect(after.remainingMs).toBe(Math.max(0, ms - elapsed));
          expect(after.running).toBe(false);
          expect(after.endsAt).toBeNull();
        },
      ),
    );
  });

  it('keeps running and endsAt consistent for every reachable state', () => {
    fc.assert(
      fc.property(
        arbClock(T0),
        fc.array(fc.constantFrom('start', 'pause', 'toggle'), { maxLength: 12 }),
        fc.integer({ min: 0, max: 5_000 }),
        (initial, ops, step) => {
          let current = initial;
          let now = T0;
          for (const op of ops) {
            now += step;
            if (op === 'start') current = startClock(current, now);
            else if (op === 'pause') current = pauseClock(current, now);
            else current = toggleClock(current, now);
            // The core invariant the whole design rests on.
            expect(current.running).toBe(current.endsAt !== null);
            expect(current.remainingMs).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});

describe('setRemaining', () => {
  it('preserves the running state and re-bases the deadline', () => {
    const running = startClock(createClock(24_000), T0);
    const updated = setRemaining(running, 14_000, T0 + 5_000);
    expect(updated.running).toBe(true);
    expect(remainingAt(updated, T0 + 5_000)).toBe(14_000);
  });

  it('stops a running clock when set to zero, since it cannot run past its deadline', () => {
    const running = startClock(createClock(24_000), T0);
    expect(setRemaining(running, 0, T0)).toEqual({ running: false, endsAt: null, remainingMs: 0 });
  });

  it('is a no-op on a paused clock already at that value', () => {
    const paused = createClock(5_000);
    expect(setRemaining(paused, 5_000, T0)).toBe(paused);
  });
});

describe('settleExpired', () => {
  it('converts a run-out clock into an explicit paused zero', () => {
    const running = startClock(createClock(1_000), T0);
    expect(settleExpired(running, T0 + 1_000)).toEqual({
      running: false,
      endsAt: null,
      remainingMs: 0,
    });
  });

  it('leaves a clock with time left untouched', () => {
    const running = startClock(createClock(1_000), T0);
    expect(settleExpired(running, T0 + 999)).toBe(running);
  });
});

describe('isExpired', () => {
  it('reports expiry only at the deadline', () => {
    const running = startClock(createClock(1_000), T0);
    expect(isExpired(running, T0 + 999)).toBe(false);
    expect(isExpired(running, T0 + 1_000)).toBe(true);
  });
});

describe('formatting', () => {
  it('renders MM:SS with the rounding the original used', () => {
    expect(formatGameClock(720_000)).toBe('12:00');
    expect(formatGameClock(719_999)).toBe('12:00');
    expect(formatGameClock(719_000)).toBe('11:59');
    expect(formatGameClock(60_000)).toBe('01:00');
    expect(formatGameClock(1)).toBe('00:01');
    expect(formatGameClock(0)).toBe('00:00');
  });

  /**
   * The guarantee behind "the scoreboard does not change": the deadline clock
   * must produce the same visible string, tick for tick, as the counter the old
   * implementation decremented once per second.
   */
  it('reproduces the legacy display sequence exactly across a full period', () => {
    const periodMs = 12 * 60_000;
    for (let elapsedSeconds = 0; elapsedSeconds <= 720; elapsedSeconds += 1) {
      const legacyTotal = 720 - elapsedSeconds;
      const legacy = `${String(Math.floor(legacyTotal / 60)).padStart(2, '0')}:${String(
        legacyTotal % 60,
      ).padStart(2, '0')}`;
      expect(formatGameClock(periodMs - elapsedSeconds * 1_000)).toBe(legacy);
    }
  });

  it('renders the shot clock as two digits', () => {
    expect(formatShotClock(24_000)).toBe('24');
    expect(formatShotClock(23_001)).toBe('24');
    expect(formatShotClock(23_000)).toBe('23');
    expect(formatShotClock(1)).toBe('01');
    expect(formatShotClock(0)).toBe('00');
  });

  it('shows tenths only when asked, and never as a bogus 60.0', () => {
    expect(formatGameClock(45_400, true)).toBe('45.4');
    expect(formatGameClock(59_950, true)).toBe('01:00');
    expect(formatGameClock(90_000, true)).toBe('01:30');
    expect(formatShotClock(4_300, true)).toBe('4.3');
    expect(formatShotClock(9_000, true)).toBe('09');
  });

  it('always produces a well-formed string', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 * 60_000 + 59_000 }), fc.boolean(), (ms, tenths) => {
        expect(formatGameClock(ms, tenths)).toMatch(/^(\d{2}:\d{2}|\d{1,2}\.\d)$/);
      }),
    );
  });
});

describe('displaySeconds / msUntilDisplayChange', () => {
  it('rounds up so the first second of a period reads full', () => {
    expect(displaySeconds(0)).toBe(0);
    expect(displaySeconds(1)).toBe(1);
    expect(displaySeconds(1_000)).toBe(1);
    expect(displaySeconds(1_001)).toBe(2);
  });

  it('reports the exact delay until the rendered text next changes', () => {
    expect(msUntilDisplayChange(24_000)).toBe(1_000);
    expect(msUntilDisplayChange(23_400)).toBe(400);
    expect(msUntilDisplayChange(0)).toBe(Infinity);
    expect(msUntilDisplayChange(45_450, true)).toBe(50);
  });

  it('never schedules a wake-up that would miss a transition', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 * 60_000 }), fc.boolean(), (ms, tenths) => {
        const delay = msUntilDisplayChange(ms, tenths);
        expect(delay).toBeGreaterThan(0);
        // After sleeping exactly this long, the rendered text must differ.
        expect(formatGameClock(ms - delay, tenths)).not.toBe(formatGameClock(ms, tenths));
      }),
    );
  });
});
