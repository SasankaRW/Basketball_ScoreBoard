/**
 * Cloudinary's request-signing algorithm, factored out on its own.
 *
 * Every other file under `src/server/` reaches `common.ts` sooner or later,
 * and importing that runs the Firebase Admin SDK's `initializeApp` as a
 * module-load side effect — fine for a route handler, unwelcome in a
 * millisecond `tests/unit/` run that imports nothing else from this
 * directory. Keeping the signing math in a file that imports nothing but
 * `node:crypto` is what lets it be pinned by a plain unit test rather than
 * only ever exercised through a real (or emulated) Cloudinary call.
 *
 * The recipe is Cloudinary's own, not invented here: every parameter that
 * will be sent to the API *except* `file`, `cloud_name`, `resource_type`, and
 * `api_key`, sorted by key, joined as `key=value` pairs with `&`, then
 * SHA-1'd together with the API secret appended directly — no separator — to
 * the end.
 */
import { createHash } from 'node:crypto';

export function signCloudinaryParams(
  params: Readonly<Record<string, string>>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}
