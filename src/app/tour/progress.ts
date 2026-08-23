/**
 * What the tour remembers between visits.
 *
 * Stored in `localStorage` rather than on the member's Firestore document, on
 * purpose. A tour is a property of *this browser* — someone who has been shown
 * around on the laptop at the scorer's table has not been shown around on the
 * tablet they pick up next, and would rather be introduced again than not. It
 * also keeps a purely cosmetic preference out of the security rules and off the
 * critical path of signing in.
 *
 * Keyed per uid so a shared courtside laptop introduces each operator
 * separately instead of the second one inheriting the first one's dismissal.
 *
 * Every access is wrapped: Safari's private mode throws on `localStorage` reads
 * rather than returning null, and a browser configured to block site data
 * throws on the property access itself. None of that is worth failing a page
 * load over, so a store that cannot be read behaves exactly like an empty one —
 * the tour runs, which is the harmless direction to fail in.
 */

const KEY_PREFIX = 'scoreboard.tour.v1.';

export interface TourProgress {
  /**
   * Set when someone declines the tour. Suppresses auto-start on *every* page,
   * not just the one they were on: "not now" means "stop offering", and
   * honouring it per-page would pop the same refusal up on the next screen.
   */
  dismissed: boolean;
  /** Tour ids seen through to the end, so each page introduces itself once. */
  seen: string[];
}

const EMPTY: TourProgress = { dismissed: false, seen: [] };

function keyFor(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

export function readProgress(uid: string): TourProgress {
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<TourProgress>;
    return {
      dismissed: parsed.dismissed === true,
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((s) => typeof s === 'string') : [],
    };
  } catch {
    // Unreadable or corrupt — treat as a first visit rather than throwing on a
    // render. Being shown the tour again is the worst outcome here.
    return EMPTY;
  }
}

export function writeProgress(uid: string, progress: TourProgress): void {
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(progress));
  } catch {
    // Storage full, blocked, or unavailable. The tour still works for this
    // session; it will simply offer itself again next time.
  }
}
