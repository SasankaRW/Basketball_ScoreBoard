/**
 * Uploads a board's tournament logo — shown on the scoreboard, mirror, and
 * overlay in place of a default. Persists to the board's Firestore doc
 * (`theme.logoUrl`, picked up by the next game this board starts) and
 * dispatches `LOGO_URL_SET` so the change is visible on whatever game is in
 * progress right now, without waiting for a restart.
 *
 * Shared between the Control Panel and Board Settings rather than living on
 * either alone: an operator mid-game and an admin setting a board up ahead of
 * time both need to be able to do this, and the upload/remove logic itself —
 * validate, hand bytes to `api/logo`, write the URL two places — has nothing
 * page-specific about it. Only `previewUrl` differs between the two callers:
 * the control panel has a live board `state` to read the *current* logo from,
 * while board settings has no live subscription at all and reads the same
 * value from the Firestore document instead — both describe the same logo in
 * the overwhelming majority of cases, since this component is the only thing
 * that ever changes either.
 */
import { useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { updateBoard, type Board } from '../../core/boards.js';
import type { Action } from '../../core/reducer.js';
import { removeBoardLogo, uploadBoardLogo, validateLogoFile } from '../../core/storage.js';
import { Alert, type ConfirmOptions } from './ui.js';

type Dispatch = (action: Action) => void;
type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

export function TournamentLogoCard({
  board,
  tenantId,
  firestore,
  previewUrl,
  dispatch,
  confirm,
}: {
  board: Board;
  tenantId: string;
  firestore: Firestore;
  /** The logo to show right now — see the module doc for why this is a prop. */
  previewUrl: string | null;
  dispatch: Dispatch;
  confirm: ConfirmFn;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(picked: File | null) {
    const reason = picked ? validateLogoFile(picked) : null;
    setError(reason);
    setFile(reason ? null : picked);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const logoUrl = await uploadBoardLogo(board.id, file);
      await updateBoard(firestore, tenantId, board.id, { theme: { ...board.theme, logoUrl } });
      dispatch({ type: 'LOGO_URL_SET', logoUrl });
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload that logo.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !(await confirm('Remove the tournament logo from this board?', {
        confirmLabel: 'Remove logo',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await removeBoardLogo(board.id);
      await updateBoard(firestore, tenantId, board.id, {
        theme: { ...board.theme, logoUrl: null },
      });
      dispatch({ type: 'LOGO_URL_SET', logoUrl: null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove that logo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" data-tour="logo">
      <h3>Tournament logo</h3>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {previewUrl ? (
        <img src={previewUrl} alt="Current tournament logo" className="logo-card__preview" />
      ) : (
        <p className="muted">
          No logo set. Shown on the scoreboard, mirror, and overlay once uploaded.
        </p>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
      />
      <div className="row">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!file || busy}
          onClick={() => void upload()}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        {previewUrl ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
