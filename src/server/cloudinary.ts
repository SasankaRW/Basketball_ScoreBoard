/**
 * Minimal signed-upload client for Cloudinary's REST API.
 *
 * No SDK dependency — just the two calls the logo feature needs (`upload`,
 * `destroy`), each signed with the recipe Cloudinary's own client libraries
 * use: every parameter that will be sent *except* `file`, `cloud_name`,
 * `resource_type`, and `api_key`, sorted by key, joined as `key=value` pairs
 * with `&`, then SHA-1'd together with the API secret appended. The secret
 * itself is never sent as a parameter — it only ever signs the request — and
 * it must never reach a browser, which is the whole reason this file lives in
 * `src/server/` and not `src/core/`.
 *
 * Three environment variables carry the account identity, set only in the
 * Vercel dashboard for production (never committed) — the same arrangement
 * `FIREBASE_SERVICE_ACCOUNT` already uses, and for the same reason: Vercel has
 * no ambient identity for a third-party service the way Cloud Functions had
 * for GCP's own. `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
 * `CLOUDINARY_API_SECRET`. Local development against `vercel dev` needs the
 * same three in an untracked `.env` file.
 */
import { ApiError } from './common.js';
import { signCloudinaryParams } from './cloudinarySign.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ApiError(
      500,
      `Server is missing ${name}. Set it in the Vercel project's environment variables ` +
        '(and locally, for `vercel dev`, in an untracked .env file) before logo uploads can work.',
    );
  }
  return value;
}

function sign(signedParams: Record<string, string>): string {
  return signCloudinaryParams(signedParams, requireEnv('CLOUDINARY_API_SECRET'));
}

/**
 * `signedParams` go into both the signature and the request. `unsignedParams`
 * — just `file`, here — go into the request only: Cloudinary excludes it from
 * what gets signed (a multi-megabyte upload has no business being hashed
 * character by character), so including it in `signedParams` would produce a
 * signature Cloudinary itself never agrees with.
 */
async function cloudinaryRequest(
  endpoint: 'upload' | 'destroy',
  signedParams: Record<string, string>,
  unsignedParams: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const cloudName = requireEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey = requireEnv('CLOUDINARY_API_KEY');
  const signature = sign(signedParams);

  const body = new URLSearchParams({
    ...signedParams,
    ...unsignedParams,
    api_key: apiKey,
    signature,
  });

  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/${endpoint}`, {
      method: 'POST',
      body,
    });
  } catch {
    throw new ApiError(502, 'Could not reach the image service. Try again in a moment.');
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    const message = data && typeof data['error'] === 'object' ? data['error'] : null;
    const detail =
      message && typeof (message as { message?: unknown }).message === 'string'
        ? (message as { message: string }).message
        : null;
    throw new ApiError(502, detail ?? 'The image service rejected that request.');
  }
  return data;
}

/**
 * Uploads a buffer under a fixed `publicId`, overwriting whatever was there.
 *
 * `overwrite` is what makes "one canonical logo per board" actually true —
 * without it, every upload gets its own address and the old one lingers.
 * `invalidate` is what makes a fresh upload show up promptly: Cloudinary
 * fronts every asset with a CDN, and without it the CDN keeps serving the
 * *previous* image at this same URL for as long as its edge cache lives, so a
 * successful re-upload would look, on screen, like nothing had happened.
 */
export async function cloudinaryUpload(
  bytes: Buffer,
  contentType: string,
  publicId: string,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedParams = { invalidate: 'true', overwrite: 'true', public_id: publicId, timestamp };

  const data = await cloudinaryRequest('upload', signedParams, {
    file: `data:${contentType};base64,${bytes.toString('base64')}`,
  });

  const secureUrl = data['secure_url'];
  if (typeof secureUrl !== 'string') {
    throw new ApiError(502, 'The image service did not return a usable URL.');
  }
  return secureUrl;
}

/**
 * Removes whatever is at `publicId`.
 *
 * `"not found"` is as good an outcome as `"ok"` for this caller: removing a
 * logo that was already gone (a double-click, a retry after a dropped
 * response) should not be an error, the same reasoning `removeBoardLogo`'s
 * Firebase Storage predecessor applied to `storage/object-not-found`.
 */
export async function cloudinaryDestroy(publicId: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedParams = { public_id: publicId, timestamp };

  const data = await cloudinaryRequest('destroy', signedParams);
  const result = data['result'];
  if (result !== 'ok' && result !== 'not found') {
    throw new ApiError(502, 'Could not remove that logo.');
  }
}
