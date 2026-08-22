/**
 * Calls one of the `/api/*` serverless functions in `api/` (backed by
 * `src/server/`), the replacement for the callable-functions protocol.
 *
 * `httpsCallable` used to attach the signed-in user's ID token automatically;
 * here that's explicit — read the current user off the shared `Auth`
 * instance and attach it as a bearer token, omitted entirely when signed out
 * (the one legitimate case is `exchangeViewerKey`, which needs no auth at
 * all).
 */
import { getFirebase } from './firebase.js';

export class ApiCallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiCallError';
    this.status = status;
  }
}

export async function callApi<TOutput>(path: string, input: unknown): Promise<TOutput> {
  const { auth } = getFirebase();
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;

  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(input),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : 'Something went wrong.';
    throw new ApiCallError(response.status, message);
  }
  return data as TOutput;
}
