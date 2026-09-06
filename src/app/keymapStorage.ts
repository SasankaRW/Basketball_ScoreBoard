/**
 * Where an operator's custom shortcuts live.
 *
 * `localStorage`, keyed per uid, for the same reasons `tour/progress.ts` is:
 * a keymap is a property of *this browser*, it is nobody else's business on the
 * team, and it has no place in the security rules or on the sign-in path. The
 * scorer's table PC is a fixed machine in practice, which is exactly where a
 * remapped key needs to persist.
 *
 * Per uid, not per board — shortcuts are muscle memory, and someone who moved
 * scoring off the arrow keys wants that on every board they open, not on one.
 * Keying by uid also stops a shared courtside laptop handing one scorer's
 * layout to the next person who signs in.
 *
 * Every access is wrapped. Safari's private mode throws on `localStorage`
 * rather than returning null, and a browser set to block site data throws on
 * the property access itself. A store that cannot be read behaves as an empty
 * one, so the failure lands on the default keymap — the keys the panel has
 * always had — rather than on a page that will not render.
 */
import { defaultKeymap, parseKeymap, type Keymap } from '../core/keymap.js';

const KEY_PREFIX = 'scoreboard.keymap.v1.';

function keyFor(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

export function readKeymap(uid: string): Keymap {
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return defaultKeymap();
    return parseKeymap(JSON.parse(raw));
  } catch {
    // Unreadable, blocked, or corrupt. `parseKeymap` already repairs a partial
    // object; this catches the cases where there is nothing to repair.
    return defaultKeymap();
  }
}

export function writeKeymap(uid: string, keymap: Keymap): void {
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(keymap));
  } catch {
    // Storage full, blocked, or unavailable. The edit still applies for this
    // session; it simply will not survive a reload.
  }
}

export function clearKeymap(uid: string): void {
  try {
    window.localStorage.removeItem(keyFor(uid));
  } catch {
    // As above — the in-memory reset the caller just did still stands.
  }
}
