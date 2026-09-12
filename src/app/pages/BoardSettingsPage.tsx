/**
 * Per-board settings: name, game rules, share links, key rotation, deletion.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  buildMirrorUrl,
  buildOverlayUrl,
  deleteBoard,
  rotateViewerKey,
  subscribeViewerKeys,
  updateBoard,
  type ViewerKeyKind,
  type ViewerKeys,
} from '../../core/boards.js';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { canManageBoards } from '../../core/roles.js';
import { BoardConfigSchema, type BoardConfig } from '../../core/schema.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { IconTrash } from '../components/icons.js';
import { Alert, ConfirmDelete, CopyField, Field, Spinner } from '../components/ui.js';
import { useBoard, useDispatch } from '../hooks.js';

export function BoardSettingsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const { boardId } = useParams<{ boardId: string }>();
  const firestore = getFirestoreClient();
  const board = useBoard(session.tenantId, boardId);
  const { dispatch } = useDispatch(session.tenantId, boardId, session.uid);

  const [keys, setKeys] = useState<ViewerKeys>({ overlayKey: null, mirrorKey: null });
  const [draft, setDraft] = useState<{ name: string; config: BoardConfig } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!boardId) return;
    return subscribeViewerKeys(firestore, session.tenantId, boardId, setKeys);
  }, [firestore, session.tenantId, boardId]);

  // Seed the editable form once the board arrives, then leave it alone — a live
  // snapshot overwriting a field mid-edit would discard what was being typed.
  useEffect(() => {
    if (board && !draft) setDraft({ name: board.name, config: board.config });
  }, [board, draft]);

  if (!canManageBoards(session.role)) {
    return (
      <AppShell tenantName="">
        <Alert kind="error">Only admins and owners can change board settings.</Alert>
        <Link className="btn" to="/app">
          Back to dashboard
        </Link>
      </AppShell>
    );
  }

  if (board === undefined || !draft) return <Spinner label="Loading board…" />;
  if (board === null) {
    return (
      <AppShell tenantName="">
        <Alert kind="error">That board no longer exists.</Alert>
        <Link className="btn" to="/app">
          Back to dashboard
        </Link>
      </AppShell>
    );
  }

  const origin = window.location.origin;

  async function save() {
    if (!boardId || !draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const config = BoardConfigSchema.parse(draft.config);
      await updateBoard(firestore, session.tenantId, boardId, { name: draft.name.trim(), config });
      /**
       * Push the same config onto the live board, not just the Firestore
       * document.
       *
       * Live state carries its own snapshot of the config and nothing refreshes
       * it in place, so without this a saved change reaches no surface anyone is
       * actually looking at. CONFIG_SET is safe to apply mid-game: it swaps the
       * config object and touches nothing else, so a running clock keeps its
       * remaining time and only *future* resets use the new values. Display-only
       * settings — tenths under a minute — take effect at once, which is the
       * whole point of them being settings rather than a per-game choice.
       */
      await dispatch({ type: 'CONFIG_SET', patch: config });
      setNotice('Saved. Clock and shot-clock lengths apply from the next reset or new game.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save those settings.');
    } finally {
      setSaving(false);
    }
  }

  async function rotate(kind: ViewerKeyKind) {
    if (!boardId) return;
    if (
      !confirm(
        `Rotate the ${kind} link? The current URL stops working immediately and anything using it must be updated.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await rotateViewerKey(boardId, kind);
      setNotice(`The ${kind} link has been rotated. Copy the new URL below.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rotate that key.');
    }
  }

  async function toggleArchive() {
    if (!boardId || !board) return;
    setError(null);
    try {
      await updateBoard(firestore, session.tenantId, boardId, { archived: !board.archived });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change archive state.');
    }
  }

  async function destroy() {
    if (!boardId) return;
    setDeleting(true);
    try {
      await deleteBoard(boardId);
      navigate('/app', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that board.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const seconds = (ms: number) => Math.round(ms / 1000);
  const patchConfig = (patch: Partial<BoardConfig>) =>
    setDraft((current) =>
      current ? { ...current, config: { ...current.config, ...patch } } : current,
    );

  return (
    <AppShell tenantName={board.name}>
      <div className="page-head">
        <div>
          <h1>{board.name}</h1>
          <p>Board settings</p>
        </div>
        <div className="page-head__actions">
          <Link className="btn" to={`/app/boards/${board.id}/layout`}>
            Layout
          </Link>
          <Link className="btn" to={`/control/${board.id}`}>
            Control panel
          </Link>
          <Link className="btn" to="/app">
            Dashboard
          </Link>
        </div>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {notice ? <Alert kind="success">{notice}</Alert> : null}

      <section className="section">
        <div className="section__head">
          <h2>Details</h2>
        </div>
        <div className="card">
          <Field label="Board name">
            <input
              type="text"
              value={draft.name}
              maxLength={60}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
          </Field>

          <div className="field-row" data-tour="rules">
            <Field label="Period length (min)">
              <input
                type="number"
                min={1}
                max={99}
                value={Math.round(draft.config.periodLengthMs / 60_000)}
                onChange={(event) =>
                  patchConfig({ periodLengthMs: Number(event.target.value) * 60_000 })
                }
              />
            </Field>
            <Field label="Periods per game">
              <input
                type="number"
                min={1}
                max={10}
                value={draft.config.periodCount}
                onChange={(event) => patchConfig({ periodCount: Number(event.target.value) })}
              />
            </Field>
            <Field label="Shot clock (sec)">
              <input
                type="number"
                min={1}
                max={99}
                value={seconds(draft.config.shotClockMs)}
                onChange={(event) =>
                  patchConfig({ shotClockMs: Number(event.target.value) * 1_000 })
                }
              />
            </Field>
            <Field label="Rebound reset (sec)">
              <input
                type="number"
                min={1}
                max={99}
                value={seconds(draft.config.shotClockResetMs)}
                onChange={(event) =>
                  patchConfig({ shotClockResetMs: Number(event.target.value) * 1_000 })
                }
              />
            </Field>
            <Field
              label="Timeouts per half"
              hint="Each team gets this many per half. They refill automatically at the start of every second period — Q3, and each overtime."
            >
              <input
                type="number"
                min={0}
                max={99}
                value={draft.config.timeouts}
                onChange={(event) => patchConfig({ timeouts: Number(event.target.value) })}
              />
            </Field>
            <Field label="Bonus at team fouls">
              <input
                type="number"
                min={1}
                max={99}
                value={draft.config.foulBonusAt}
                onChange={(event) => patchConfig({ foulBonusAt: Number(event.target.value) })}
              />
            </Field>
          </div>

          <div className="field-row">
            <Field label="Default home name">
              <input
                type="text"
                maxLength={24}
                value={draft.config.homeTeamName}
                onChange={(event) => patchConfig({ homeTeamName: event.target.value })}
              />
            </Field>
            <Field label="Default away name">
              <input
                type="text"
                maxLength={24}
                value={draft.config.awayTeamName}
                onChange={(event) => patchConfig({ awayTeamName: event.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Clock display"
            hint="Broadcast convention shows tenths under a minute. Off keeps the classic MM:SS the scoreboard has always used."
          >
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.config.showTenthsUnderOneMinute}
                onChange={(event) =>
                  patchConfig({ showTenthsUnderOneMinute: event.target.checked })
                }
              />
              Show tenths of a second under one minute
            </label>
          </Field>

          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </section>

      <section className="section" data-tour="viewer-links">
        <div className="section__head">
          <h2>Share links</h2>
        </div>
        <div className="card stack">
          <div>
            <Field
              label="Mirror display"
              hint="Full-screen scoreboard for the venue screen or a second monitor. No sign-in needed."
            >
              {keys.mirrorKey ? (
                <CopyField
                  label="settings-mirror"
                  value={buildMirrorUrl(origin, board.id, keys.mirrorKey)}
                />
              ) : (
                <span className="muted">Loading…</span>
              )}
            </Field>
            <button type="button" className="btn btn--sm" onClick={() => void rotate('mirror')}>
              Rotate mirror link
            </button>
          </div>

          <div>
            <Field label="Stream overlay" hint="Add as a Browser Source in OBS. No sign-in needed.">
              {keys.overlayKey ? (
                <CopyField
                  label="settings-overlay"
                  value={buildOverlayUrl(origin, board.id, keys.overlayKey)}
                />
              ) : (
                <span className="muted">Loading…</span>
              )}
            </Field>
            <button type="button" className="btn btn--sm" onClick={() => void rotate('overlay')}>
              Rotate overlay link
            </button>
          </div>

          <p className="field__hint">
            Anyone holding a link can watch this board — they cannot change it. Rotating a link
            revokes the old URL immediately. The mirror key also opens this board&rsquo;s game-clock
            and shot-clock screens, which the control panel lists — rotating the mirror link revokes
            those as well.
          </p>
        </div>
      </section>

      <section className="section" data-tour="danger-zone">
        <div className="section__head">
          <h2>Danger zone</h2>
        </div>
        <div className="stack">
          <div className="card danger-row">
            <div className="danger-row__info">
              <strong>{board.archived ? 'Restore this board' : 'Archive this board'}</strong>
              <p>
                Archiving hides it from the dashboard and stops its links working. Nothing is lost.
              </p>
            </div>
            <button type="button" className="btn" onClick={() => void toggleArchive()}>
              {board.archived ? 'Restore' : 'Archive'}
            </button>
          </div>

          <div className="card danger-row">
            <div className="danger-row__info">
              <strong>Delete this board</strong>
              <p>Permanently removes the board and its live game state.</p>
            </div>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={15} />
              Delete
            </button>
          </div>
        </div>
      </section>

      {confirmDelete ? (
        <ConfirmDelete
          title="Delete board"
          expected={board.name}
          description={`This permanently deletes “${board.name}”, its live game state and its share links. This cannot be undone.`}
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void destroy()}
        />
      ) : null}
    </AppShell>
  );
}
