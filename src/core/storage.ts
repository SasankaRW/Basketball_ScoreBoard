/**
 * The board-branding logo shown on the scoreboard, mirror, and OBS overlay in
 * place of a hardcoded default. One canonical object per board — re-uploading
 * overwrites it — mirroring the path `storage.rules` gates.
 *
 * `LOGO_LIMITS` is validated here before the upload even starts (fail fast,
 * no wasted round trip) and mirrored by hand into `storage.rules`' size/
 * content-type checks, the same discipline `LIMITS` in schema.ts already
 * applies to every other bounded input in this codebase.
 */
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';

/**
 * Whether the per-board logo upload UI is offered at all.
 *
 * Firebase Storage requires the Blaze (pay-as-you-go) plan — the Spark free
 * tier cannot provision a bucket, so every upload fails at the CORS
 * preflight against a bucket that does not exist. In the browser that
 * surfaces as an opaque CORS error rather than anything a user could act on,
 * so the control is hidden rather than left to fail: an affordance that
 * cannot work is worse than one that is not there.
 *
 * Everything behind this flag is complete and tested (src/server, storage.rules,
 * tests/rules/storage.test.ts, tests/e2e/logo.spec.ts). To restore it: put the
 * project on Blaze, enable Storage in the Firebase console, run
 * `npx firebase deploy --only storage`, and flip this to true.
 */
export const LOGO_UPLOAD_ENABLED: boolean = false;

export const LOGO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  types: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const,
};

/** Returns a human-readable reason the file is rejected, or null if it's fine. */
export function validateLogoFile(file: File): string | null {
  if (!LOGO_LIMITS.types.includes(file.type as (typeof LOGO_LIMITS.types)[number])) {
    return 'Logo must be a PNG, JPEG, WebP, or SVG image.';
  }
  if (file.size > LOGO_LIMITS.maxBytes) {
    return `Logo must be ${Math.round(LOGO_LIMITS.maxBytes / 1024 / 1024)}MB or smaller.`;
  }
  return null;
}

function logoRef(storage: FirebaseStorage, tenantId: string, boardId: string) {
  return ref(storage, `tenants/${tenantId}/boards/${boardId}/logo`);
}

export async function uploadBoardLogo(
  storage: FirebaseStorage,
  tenantId: string,
  boardId: string,
  file: File,
): Promise<string> {
  const invalid = validateLogoFile(file);
  if (invalid) throw new Error(invalid);

  const target = logoRef(storage, tenantId, boardId);
  await uploadBytes(target, file, { contentType: file.type });
  return getDownloadURL(target);
}

/** Best-effort: a logo that was already removed (or never existed) is not an error. */
export async function removeBoardLogo(
  storage: FirebaseStorage,
  tenantId: string,
  boardId: string,
): Promise<void> {
  try {
    await deleteObject(logoRef(storage, tenantId, boardId));
  } catch (caught) {
    const code = (caught as { code?: string } | null)?.code;
    if (code !== 'storage/object-not-found') throw caught;
  }
}
