/**
 * Pins the exact signing recipe Cloudinary's own client libraries use, so a
 * transcription slip here (wrong join character, a param that should have
 * been excluded, secret prepended instead of appended) shows up in
 * milliseconds — the alternative is discovering it only when a real upload
 * comes back "Invalid Signature" against a real account, the one failure mode
 * this codebase cannot exercise in an emulator the way it does every Firebase
 * write.
 *
 * Deliberately imports only `server/cloudinarySign.ts`, never `cloudinary.ts`
 * or anything else under `src/server/` — the rest of that directory reaches
 * `common.ts` sooner or later, which runs the Firebase Admin SDK's
 * `initializeApp` as a module-load side effect. This file has no business
 * paying for that just to check a hash.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signCloudinaryParams } from '../../src/server/cloudinarySign.js';

/** The same recipe, written independently, as the reference this is checked against. */
function reference(params: Record<string, string>, secret: string): string {
  const pairs = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return createHash('sha1')
    .update(pairs.join('&') + secret)
    .digest('hex');
}

describe('signCloudinaryParams', () => {
  it('matches an independently-built reference signature', () => {
    const params = { public_id: 'tenants/tnt_a/boards/brd_1/logo', timestamp: '1700000000' };
    expect(signCloudinaryParams(params, 'shh')).toBe(reference(params, 'shh'));
  });

  it('sorts parameters by key regardless of insertion order', () => {
    const inOrder = signCloudinaryParams(
      { overwrite: 'true', invalidate: 'true', public_id: 'x', timestamp: '1' },
      'secret',
    );
    const reordered = signCloudinaryParams(
      { timestamp: '1', public_id: 'x', overwrite: 'true', invalidate: 'true' },
      'secret',
    );
    expect(inOrder).toBe(reordered);
  });

  it('produces a 40-character lowercase hex SHA-1 digest', () => {
    const signature = signCloudinaryParams({ public_id: 'x', timestamp: '1' }, 'secret');
    expect(signature).toMatch(/^[0-9a-f]{40}$/);
  });

  it('changes when any signed value changes', () => {
    const base = signCloudinaryParams({ public_id: 'x', timestamp: '1' }, 'secret');
    const movedTimestamp = signCloudinaryParams({ public_id: 'x', timestamp: '2' }, 'secret');
    const movedId = signCloudinaryParams({ public_id: 'y', timestamp: '1' }, 'secret');
    const movedSecret = signCloudinaryParams({ public_id: 'x', timestamp: '1' }, 'other');

    expect(movedTimestamp).not.toBe(base);
    expect(movedId).not.toBe(base);
    expect(movedSecret).not.toBe(base);
  });

  it('appends the secret rather than joining it with the parameter string', () => {
    // If the join and the secret used the same separator, "a=1" + secret "&b"
    // would collide with the two-param string "a=1&b=" for an empty value —
    // pinning the exact concatenation is what catches that class of mistake.
    const signed = signCloudinaryParams({ a: '1' }, '&b');
    expect(signed).toBe(createHash('sha1').update('a=1&b').digest('hex'));
  });
});
