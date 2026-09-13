/**
 * The tournament-logo file constraints — split out from `storage.ts` on its
 * own, with no imports of its own, so both the client and the server can
 * depend on it without dragging anything else along.
 *
 * That "anything else" is concrete, not hypothetical: `storage.ts` also
 * exports `uploadBoardLogo`/`removeBoardLogo`, which import `callApi` from
 * `./api.js`, which imports `getFirebase` from `./firebase.js` — and
 * `firebase.ts` reads `import.meta.env` at module scope, a Vite-only
 * construct that does not exist once Vercel bundles a server route into a
 * plain Node.js function. `src/server/logo.ts` only ever wanted the numeric
 * limits, but an ES module import pulls in its *whole* module graph, not
 * just the one export named — so importing `LOGO_LIMITS` from `storage.ts`
 * was enough to crash every deployment at cold start with `Cannot read
 * properties of undefined (reading 'VITE_FIREBASE_API_KEY')`, nowhere near
 * the line that actually needed the constant. This file is the fix: nothing
 * server-side ever imports `storage.ts` again.
 */

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
