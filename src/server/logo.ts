/**
 * The board's tournament logo — the one privileged operation the feature
 * needs, since Cloudinary's API secret must never reach a browser (the
 * signing itself lives in `server/cloudinary.ts`). Everything else about the
 * feature is unprivileged and stays exactly where it already was: the client
 * still persists the returned URL onto the board's Firestore `theme.logoUrl`
 * itself (already covered by `firestore.rules`' `onlyChanges` allowlist for
 * that field) and still dispatches `LOGO_URL_SET` to put it on the game in
 * progress. This route's only job is turning uploaded bytes into a URL, or
 * removing the one that is there.
 *
 * Upload and remove share one Vercel function (`api/logo.ts`), dispatched on
 * `op`, rather than one route each. Not the "one thin route per operation"
 * norm the rest of `api/` follows — the Hobby plan's 12-function-per-
 * deployment cap is what forces the exception here, not a change of mind
 * about the pattern; `uploadLogo`/`removeLogo` stay separate, independently
 * callable functions underneath, so this is purely a routing-layer merge.
 */
import { z } from 'zod';
import { LOGO_LIMITS } from '../core/storage.js';
import { cloudinaryDestroy, cloudinaryUpload } from './cloudinary.js';
import { ApiError, firestore, writeAudit, type Caller } from './common.js';

/**
 * Confirms the board exists under *this caller's* tenant before anything is
 * uploaded or destroyed in its name.
 *
 * The path itself is the isolation proof, the same way every other tenant-
 * scoped Firestore read in `src/server/` works: it is addressed as
 * `tenants/{caller.tenantId}/boards/{boardId}`, built from the *verified*
 * token's tenant rather than anything the request body claims, so a board
 * belonging to a different tenant is not merely forbidden here — it is not a
 * document this query can ever reach.
 */
async function requireBoard(caller: Caller, boardId: string): Promise<void> {
  const ref = firestore
    .collection('tenants')
    .doc(caller.tenantId)
    .collection('boards')
    .doc(boardId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new ApiError(404, 'Board not found.');
}

/**
 * Where this board's logo lives in Cloudinary.
 *
 * Deterministic and tenant-scoped, mirroring the Firebase Storage path this
 * replaced (`tenants/{tenantId}/boards/{boardId}/logo`) — a fixed address is
 * what makes "re-uploading overwrites it" true without this code having to
 * track or clean up a previous asset itself.
 */
function publicIdFor(tenantId: string, boardId: string): string {
  return `tenants/${tenantId}/boards/${boardId}/logo`;
}

export const UploadLogoInput = z.object({
  boardId: z.string().min(1).max(64),
  contentType: z.enum(LOGO_LIMITS.types),
  dataBase64: z.string().min(1),
});

export interface UploadLogoResult {
  logoUrl: string;
}

export async function uploadLogo(
  caller: Caller,
  input: z.infer<typeof UploadLogoInput>,
): Promise<UploadLogoResult> {
  await requireBoard(caller, input.boardId);

  // Decoded *before* the size check: base64 inflates a payload by roughly a
  // third, so comparing the encoded string's length against LOGO_LIMITS would
  // reject files that are actually within bounds, and accept some that are not.
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length > LOGO_LIMITS.maxBytes) {
    throw new ApiError(
      413,
      `Logo must be ${Math.round(LOGO_LIMITS.maxBytes / 1024 / 1024)}MB or smaller.`,
    );
  }

  const logoUrl = await cloudinaryUpload(
    bytes,
    input.contentType,
    publicIdFor(caller.tenantId, input.boardId),
  );

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'LOGO_UPLOADED',
    boardId: input.boardId,
  });

  return { logoUrl };
}

export const RemoveLogoInput = z.object({
  boardId: z.string().min(1).max(64),
});

export async function removeLogo(
  caller: Caller,
  input: z.infer<typeof RemoveLogoInput>,
): Promise<{ removed: true }> {
  await requireBoard(caller, input.boardId);
  await cloudinaryDestroy(publicIdFor(caller.tenantId, input.boardId));

  await writeAudit({
    tenantId: caller.tenantId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'LOGO_REMOVED',
    boardId: input.boardId,
  });

  return { removed: true };
}

/** What `api/logo.ts` actually validates — `uploadLogo`/`removeLogo`'s own
 * input schemas plus the `op` discriminant that picks between them. */
export const LogoActionInput = z.discriminatedUnion('op', [
  UploadLogoInput.extend({ op: z.literal('upload') }),
  RemoveLogoInput.extend({ op: z.literal('remove') }),
]);

export async function handleLogoAction(
  caller: Caller,
  input: z.infer<typeof LogoActionInput>,
): Promise<UploadLogoResult | { removed: true }> {
  if (input.op === 'upload') return uploadLogo(caller, input);
  return removeLogo(caller, input);
}
