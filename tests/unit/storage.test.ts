/**
 * `validateLogoFile`'s pre-flight checks — the client-side gate that saves an
 * obviously-doomed upload a round trip to `api/uploadLogo` before it even
 * starts. The server re-validates the same bounds against the decoded bytes
 * (`src/server/logo.ts`), which is the actual boundary; this is the fast
 * "fail before we even try" half of that same discipline.
 *
 * Only `LOGO_LIMITS`/`validateLogoFile` are exercised here — `uploadBoardLogo`/
 * `removeBoardLogo` call `callApi`, which needs a browser `fetch` and a signed-
 * in Firebase session, neither of which belongs in a millisecond unit test.
 * That path is what `tests/e2e/logo.spec.ts` covers instead.
 */
import { describe, expect, it } from 'vitest';
import { LOGO_LIMITS, validateLogoFile } from '../../src/core/storage.js';

function fakeFile(type: string, size: number): File {
  // `File` needs real bytes to report the size it was constructed with;
  // a Blob of `size` zero bytes is the cheapest way to get there without
  // reading anything off disk.
  return new File([new Uint8Array(size)], 'logo', { type });
}

describe('validateLogoFile', () => {
  it.each(LOGO_LIMITS.types)('accepts %s within the size limit', (type) => {
    expect(validateLogoFile(fakeFile(type, 1024))).toBeNull();
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateLogoFile(fakeFile('image/png', LOGO_LIMITS.maxBytes))).toBeNull();
  });

  it('rejects a file one byte over the size limit', () => {
    const reason = validateLogoFile(fakeFile('image/png', LOGO_LIMITS.maxBytes + 1));
    expect(reason).toMatch(/smaller/);
  });

  it.each(['image/gif', 'application/pdf', 'text/plain', ''])(
    'rejects an unsupported content type (%s)',
    (type) => {
      const reason = validateLogoFile(fakeFile(type, 1024));
      expect(reason).toMatch(/PNG, JPEG, WebP, or SVG/);
    },
  );
});
