/**
 * The single region every Cloud Function is deployed to, and the region the
 * client must ask for when calling them.
 *
 * `getFunctions(app)` with no region argument defaults to `us-central1`. Every
 * function in functions/src is declared with `region: REGION` from
 * functions/src/common.ts, which re-exports this same constant — chosen to
 * co-locate with the Realtime Database instance in asia-southeast1. If the
 * client and the Functions codebase ever specified the region separately,
 * letting them drift apart would silently break every callable: the browser
 * would request a URL no deployed function answers to, failing as a 404/CORS
 * error rather than a clear "wrong region" message.
 */
export const FUNCTIONS_REGION = 'asia-southeast1';
