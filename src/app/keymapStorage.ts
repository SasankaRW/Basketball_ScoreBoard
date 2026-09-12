/**
 * This browser's copy of the shortcut layout.
 *
 * No longer the source of truth: the layout is a tenant setting now, shared by
 * the organisation and held at `settings.keymap` on the tenant document (see
 * `core/tenantKeymap.ts`). What stays here is a cache, and it earns its keep
 * twice. It is what the panel scores with before the first snapshot arrives,
 * so a remapped key works during the round trip rather than reverting to the
 * arrow keys for a second mid-game. And it is the seed: a tenant that has never
 * saved a layout adopts this one the first time an admin opens the panel, so
 * nobody loses the keys they built up before the move to shared settings.
 *
 * Keyed per tenant *and* per uid. Per tenant because the cache stands in for a
 * tenant's layout and one person may belong to two organisations with
 * different ones; per uid on top of that because a shared courtside laptop
 * must not hand one scorer's pre-adoption layout to the next person who signs
 * in.
 *
 * Every access is wrapped. Safari's private mode throws on `localStorage`
 * rather than returning null, and a browser set to block site data throws on
 * the property access itself. A store that cannot be read behaves as an empty
 * one, so the failure lands on the default keymap — the keys the panel has
 * always had — rather than on a page that will not render.
 */
import { defaultKeymap, parseKeymap, type Keymap } from '../core/keymap.js';

/**
 * `v2` because the key gained the tenant. A `v1` entry is simply not found,
 * which lands on the default keymap — the same place an operator on a new
 * machine lands, and harmless now that the tenant document is what actually
 * carries a customised layout.
 */
const KEY_PREFIX = 'scoreboard.keymap.v2.';

function keyFor(tenantId: string, uid: string): string {
  return `${KEY_PREFIX}${tenantId}.${uid}`;
}

export function readKeymap(tenantId: string, uid: string): Keymap {
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId, uid));
    if (!raw) return defaultKeymap();
    return parseKeymap(JSON.parse(raw));
  } catch {
    // Unreadable, blocked, or corrupt. `parseKeymap` already repairs a partial
    // object; this catches the cases where there is nothing to repair.
    return defaultKeymap();
  }
}

export function writeKeymap(tenantId: string, uid: string, keymap: Keymap): void {
  try {
    window.localStorage.setItem(keyFor(tenantId, uid), JSON.stringify(keymap));
  } catch {
    // Storage full, blocked, or unavailable. The edit still applies for this
    // session; it simply will not survive a reload.
  }
}

export function clearKeymap(tenantId: string, uid: string): void {
  try {
    window.localStorage.removeItem(keyFor(tenantId, uid));
  } catch {
    // As above — the in-memory reset the caller just did still stands.
  }
}
