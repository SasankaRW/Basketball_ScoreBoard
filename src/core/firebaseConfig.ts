/**
 * The project's identity: constants only, no SDK imports, safe to pull into
 * both the browser bundle and the Cloud Functions build.
 *
 * `DATABASE_URL` in particular must be explicit rather than left to
 * auto-detection. The Realtime Database instance lives in asia-southeast1, a
 * non-default region, so its URL is not the `{projectId}-default-rtdb
 * .firebaseio.com` shape the Admin SDK would otherwise guess at. In a real
 * deployment the SDK usually resolves the correct URL from the environment
 * anyway, but the Functions emulator cannot do that lookup without a
 * `firebase login` session — and quietly falls back to the wrong guess instead
 * of failing loudly. The client (core/firebase.ts) and the Admin SDK
 * (functions/src/common.ts) both import this constant, so they can only ever
 * agree on which database they are talking to.
 */
export const PROJECT_ID = 'basketballscoreboard-65c95';

export const DATABASE_URL =
  'https://basketballscoreboard-65c95-default-rtdb.asia-southeast1.firebasedatabase.app';
