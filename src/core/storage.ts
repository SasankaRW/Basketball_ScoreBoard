/**
 * The board-branding logo shown on the scoreboard, mirror, and OBS overlay in
 * place of a hardcoded default. One canonical asset per board — re-uploading
 * overwrites it — mirroring the path `src/server/logo.ts` uploads it under.
 *
 * Uploaded through `api/uploadLogo` to Cloudinary rather than to Firebase
 * Storage. Storage needs the paid Blaze plan, which is what blocked this
 * feature outright (this module used to carry a `LOGO_UPLOAD_ENABLED` flag
 * for exactly that reason — see git history). Cloudinary needs only a free
 * account, and the credential that actually authorises an upload is an API
 * secret that must never reach a browser, so the upload itself happens
 * server-side (`src/server/cloudinary.ts`) the same way every other
 * privileged write in this app goes through `api/*.ts` rather than straight
 * from the client — this module only validates the file and hands its bytes
 * to that endpoint.
 *
 * `LOGO_LIMITS` is validated here before the upload even starts (fail fast,
 * no wasted round trip) and re-validated server-side against the same
 * constants, the discipline `LIMITS` in schema.ts already applies to every
 * other bounded input in this codebase.
 */
import { callApi } from './api.js';

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

/**
 * Reads a File into the bare base64 payload the upload endpoint expects.
 *
 * `readAsDataURL` yields `data:<type>;base64,<payload>`; the endpoint wants
 * only what follows the comma; it already knows the content type from the
 * file itself and re-attaches it before forwarding to Cloudinary.
 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read that file.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

interface UploadLogoResult {
  logoUrl: string;
}

/**
 * Uploads a board's tournament logo, returning the URL to persist onto the
 * board's `theme.logoUrl` (the caller's job — this function only produces the
 * URL, the same division of labour the old Firebase Storage version had).
 */
export async function uploadBoardLogo(boardId: string, file: File): Promise<string> {
  const invalid = validateLogoFile(file);
  if (invalid) throw new Error(invalid);

  const dataBase64 = await readAsBase64(file);
  const { logoUrl } = await callApi<UploadLogoResult>('uploadLogo', {
    boardId,
    contentType: file.type,
    dataBase64,
  });
  return logoUrl;
}

/** Best-effort on the server side too: a logo already removed is not an error. */
export async function removeBoardLogo(boardId: string): Promise<void> {
  await callApi('removeLogo', { boardId });
}
