/**
 * The tenant's shared shortcut layout.
 *
 * One keymap per organisation, held at `settings.keymap` on the tenant
 * document. Every member can read it — `allow get: if inTenant(tid)` — and
 * owner/admin alone may change it, which is exactly the split
 * `canManageTenantSettings` already describes. That is also why this lives on
 * the tenant document rather than in a collection of its own: `settings` is
 * already in the tenant's `onlyChanges` allowlist in `firestore.rules`, so a
 * shared keymap needs no new rule and no new privileged route. Adding one
 * would have meant a new tenant-isolation surface to prove.
 *
 * Writes go through a **dotted field path** (`settings.keymap`), so an edit
 * merges into `settings` instead of replacing it — a whole-map write would
 * silently drop every other tenant setting. Command ids contain dots
 * (`score.home.plus1`), but they appear only as map *keys* in the value, never
 * in the path, so they are data and stay intact.
 *
 * Reads are a subscription rather than a fetch. The layout is shared, so an
 * admin changing it has to reach the panels already open at the scorer's
 * table; a one-shot read would leave every other operator on the old keys
 * until they reloaded.
 */
import { doc, onSnapshot, serverTimestamp, updateDoc, type Firestore } from 'firebase/firestore';
import { isDefaultKeymap, parseKeymap, type Keymap } from './keymap.js';

/**
 * Live tenant keymap, or `null` while nobody has saved one.
 *
 * `null` is load-bearing and distinct from "the defaults": it is what tells the
 * panel it may still seed the tenant from whatever this browser had. Once a
 * layout is saved, even one identical to the defaults, that decision stands.
 */
export function subscribeTenantKeymap(
  firestore: Firestore,
  tenantId: string,
  onChange: (keymap: Keymap | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(firestore, 'tenants', tenantId),
    (snapshot) => {
      const settings = snapshot.data()?.['settings'] as Record<string, unknown> | undefined;
      const stored = settings?.['keymap'];
      // `parseKeymap` repairs a partial or outdated map, so anything that is
      // an object at all is worth handing it; only absence means unset.
      onChange(stored && typeof stored === 'object' ? parseKeymap(stored) : null);
    },
    (error) => onError?.(error),
  );
}

/**
 * Saves the tenant's layout. Requires owner or admin — the rules reject
 * anyone else, so callers must gate the UI with `canManageTenantSettings`
 * rather than relying on this to fail politely.
 */
export async function writeTenantKeymap(
  firestore: Firestore,
  tenantId: string,
  keymap: Keymap,
): Promise<void> {
  await updateDoc(doc(firestore, 'tenants', tenantId), {
    'settings.keymap': keymap,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Whether `keymap` is worth carrying up to a tenant that has none.
 *
 * Only a layout somebody actually customised: seeding the shipped defaults
 * would burn the one-time adoption on nothing and permanently mark the tenant
 * as "already configured".
 */
export function isWorthSeeding(keymap: Keymap): boolean {
  return !isDefaultKeymap(keymap);
}
