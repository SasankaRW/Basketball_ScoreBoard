/**
 * The scoreboard layout editor.
 *
 * Rearranges where a board's sections sit, how big they are, and which of them
 * appear at all — then publishes the result to every screen showing that board.
 * The arrangement is stored per board under the tenant
 * (`live/{tenantId}/{boardId}/layout`), so it reaches the gym-wall scoreboard
 * and the mirror without either of them having to be the machine it was edited
 * on. Browser storage would have been simpler and useless: the screen being
 * arranged is almost never the screen doing the arranging.
 *
 * The editor opens on the board's **stock** arrangement rather than on an
 * arrangement of its own. Nothing about the display changes until someone
 * presses "Customise layout", and "Reset to default" deletes the document
 * rather than writing defaults into it — which is why the reset can promise the
 * original scoreboard back exactly, down to the pixel the visual-regression
 * baselines were captured at, instead of an approximation of it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { buildMirrorUrl, subscribeViewerKeys, type ViewerKeys } from '../../core/boards.js';
import {
  LAYOUT_LIMITS,
  SECTIONS,
  SECTION_GROUPS,
  defaultLayout,
  layoutsEqual,
  sectionDefinition,
  withSection,
  type BoardLayout,
  type SectionBox,
  type SectionId,
} from '../../core/boardLayout.js';
import { getFirebase } from '../../core/firebase.js';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { clearBoardLayout, subscribeBoardLayout, writeBoardLayout } from '../../core/liveLayout.js';
import { canManageBoards } from '../../core/roles.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { LayoutCanvas, type CanvasAspect, type SnapSettings } from '../components/LayoutCanvas.js';
import { Alert, Field, Spinner } from '../components/ui.js';
import { useBoard } from '../hooks.js';
import type { LayoutMetrics } from '../../display/shared/layoutBridge.js';

const ASPECTS: readonly { value: CanvasAspect; label: string }[] = [
  { value: '16 / 9', label: '16:9' },
  { value: '21 / 9', label: '21:9' },
  { value: '4 / 3', label: '4:3' },
];

/** How many steps back the editor can walk. */
const HISTORY_LIMIT = 50;

export function BoardLayoutPage() {
  const session = useSession();
  const { boardId } = useParams<{ boardId: string }>();
  const { db } = getFirebase();
  const firestore = getFirestoreClient();
  const board = useBoard(session.tenantId, boardId);

  const [keys, setKeys] = useState<ViewerKeys>({ overlayKey: null, mirrorKey: null });
  const [stored, setStored] = useState<BoardLayout | null | undefined>(undefined);
  const [draft, setDraft] = useState<BoardLayout | null>(null);
  const [selected, setSelected] = useState<SectionId | null>(null);
  const [aspect, setAspect] = useState<CanvasAspect>('16 / 9');
  const [snap, setSnap] = useState<SnapSettings>({ enabled: true, grid: 0.5 });
  const [history, setHistory] = useState<(BoardLayout | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The stock arrangement, measured off the real preview.
   *
   * This is what makes "Customise layout" open on the board as it actually is
   * rather than on a hand-authored guess at it. It can legitimately be missing —
   * the frame may not have reported yet — which is what `defaultLayout()` is for.
   */
  const measured = useRef<LayoutMetrics | null>(null);

  const canEdit = canManageBoards(session.role);

  useEffect(() => {
    if (!boardId) return;
    return subscribeViewerKeys(firestore, session.tenantId, boardId, setKeys);
  }, [firestore, session.tenantId, boardId]);

  useEffect(() => {
    if (!boardId) return;
    return subscribeBoardLayout(
      db,
      session.tenantId,
      boardId,
      (snapshot) => setStored(snapshot.layout),
      () => setError('Could not read this board’s layout.'),
    );
  }, [db, session.tenantId, boardId]);

  // Seed the draft once, then leave it alone. A snapshot landing mid-edit would
  // throw away whatever was being dragged — the same reason BoardSettingsPage
  // seeds its form only when it has none.
  const seeded = useRef(false);
  useEffect(() => {
    if (stored === undefined || seeded.current) return;
    seeded.current = true;
    setDraft(stored);
  }, [stored]);

  const previewUrl = useMemo(() => {
    if (!boardId || !keys.mirrorKey) return null;
    return buildMirrorUrl(window.location.origin, boardId, keys.mirrorKey);
  }, [boardId, keys.mirrorKey]);

  const dirty = !layoutsEqual(draft, stored ?? null);

  // -- Editing ------------------------------------------------------------

  const pushHistory = useCallback((previous: BoardLayout | null) => {
    setHistory((entries) => [...entries.slice(-(HISTORY_LIMIT - 1)), previous]);
  }, []);

  const edit = useCallback(
    (id: SectionId, patch: Partial<SectionBox>) => {
      setDraft((current) => {
        if (!current) return current;
        pushHistory(current);
        return withSection(current, id, patch);
      });
      setNotice(null);
    },
    [pushHistory],
  );

  const onCanvasChange = useCallback((id: SectionId, box: SectionBox) => edit(id, box), [edit]);

  const onMeasured = useCallback((metrics: LayoutMetrics) => {
    measured.current = metrics;
  }, []);

  /**
   * Turns the stock arrangement into an editable one.
   *
   * The measured rects are already in percent of the board, so they transfer
   * straight across. Sections the renderer had hidden — the tournament logo on a
   * board with no image — keep their catalog box and stay switched off, ready in
   * the "Removed" tray rather than stacked in a corner at zero size.
   */
  const startCustomising = useCallback(() => {
    const base = defaultLayout();
    const metrics = measured.current;

    if (metrics) {
      for (const section of SECTIONS) {
        const rect = metrics.sections[section.id];
        if (!rect) continue;
        base.sections[section.id] = {
          ...base.sections[section.id],
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          visible: rect.visible,
        };
      }
    }

    pushHistory(null);
    setDraft(base);
    setNotice(
      metrics
        ? 'Captured the board as it stands. Drag a section to move it, or grab an edge to resize.'
        : 'Started from the suggested arrangement — the preview had not reported its geometry yet.',
    );
  }, [pushHistory]);

  const undo = useCallback(() => {
    setHistory((entries) => {
      if (entries.length === 0) return entries;
      setDraft(entries[entries.length - 1] ?? null);
      return entries.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      // Never take Ctrl+Z away from a text field the operator is typing in.
      if (target?.closest('input, textarea, select')) return;
      event.preventDefault();
      undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

  // -- Publishing ---------------------------------------------------------

  async function save() {
    if (!boardId || !draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await writeBoardLayout(db, session.tenantId, boardId, draft, session.uid);
      setStored(draft);
      setNotice('Layout published. Every screen on this board has it now.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not publish that layout.');
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!boardId) return;
    if (
      !confirm(
        'Reset this board to the default scoreboard layout? The custom arrangement is deleted and every screen goes back to the original.',
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await clearBoardLayout(db, session.tenantId, boardId);
      pushHistory(draft);
      setDraft(null);
      setStored(null);
      setSelected(null);
      setNotice('Back to the default layout.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset that layout.');
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    pushHistory(draft);
    setDraft(stored ?? null);
    setSelected(null);
    setNotice(null);
  }

  // -- Render -------------------------------------------------------------

  if (!canEdit) {
    return (
      <AppShell tenantName="">
        <Alert kind="error">Only admins and owners can change a board’s layout.</Alert>
        <Link className="btn" to="/app">
          Back to dashboard
        </Link>
      </AppShell>
    );
  }

  if (board === undefined || stored === undefined) return <Spinner label="Loading layout…" />;
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

  const selectedBox = draft && selected ? draft.sections[selected] : null;
  const hidden = draft ? SECTIONS.filter((section) => !draft.sections[section.id].visible) : [];

  return (
    <AppShell tenantName={board.name}>
      <div className="page-head">
        <div>
          <h1>Layout</h1>
          <p>{board.name}</p>
        </div>
        <div className="page-head__actions">
          <Link className="btn" to={`/app/boards/${board.id}`}>
            Board settings
          </Link>
          <Link className="btn" to={`/control/${board.id}`}>
            Control panel
          </Link>
        </div>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {notice ? <Alert kind="success">{notice}</Alert> : null}

      <div className="layout-editor">
        <div className="layout-editor__stage">
          <LayoutCanvas
            previewUrl={previewUrl}
            layout={draft}
            selected={selected}
            aspect={aspect}
            snap={snap}
            onSelect={setSelected}
            onChange={onCanvasChange}
            onMeasured={onMeasured}
          />

          {!draft ? (
            <div className="layout-editor__intro">
              <p>
                This board uses the default scoreboard layout. Customising it lets you move, resize,
                and remove sections — the original is always one reset away.
              </p>
              <button type="button" className="btn btn--primary" onClick={startCustomising}>
                Customise layout
              </button>
            </div>
          ) : null}

          <p className="layout-editor__hint muted">
            Drag a section to move it. Grab an edge or corner to resize. Hold <kbd>Alt</kbd> to
            ignore the guides, arrow keys to nudge, <kbd>Shift</kbd> for bigger steps.
          </p>
        </div>

        <aside className="layout-panel">
          <section className="layout-panel__block">
            <h2>Canvas</h2>
            {/* A group of buttons, not a form control, so it carries its own
                grouping label rather than going through `Field` — which wires a
                `<label for>` at a single input and has nothing to point at here. */}
            <div className="field" role="group" aria-label="Preview screen shape">
              <span className="layout-panel__label">Screen shape</span>
              <div className="layout-panel__segmented">
                {ASPECTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`btn btn--sm${aspect === option.value ? ' btn--active' : ''}`}
                    aria-pressed={aspect === option.value}
                    onClick={() => setAspect(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="field__hint">
                Only changes this preview, never the saved layout.
              </span>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={snap.enabled}
                onChange={(event) =>
                  setSnap((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              Snap to guides
            </label>

            <Field label="Grid (%)" hint="0 turns the grid off and leaves alignment snapping on.">
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={snap.grid}
                onChange={(event) =>
                  setSnap((current) => ({ ...current, grid: Number(event.target.value) }))
                }
              />
            </Field>
          </section>

          {draft ? (
            <>
              <section className="layout-panel__block">
                <h2>Sections</h2>
                {SECTION_GROUPS.map((group) => (
                  <div key={group} className="layout-panel__group">
                    <h3>{group}</h3>
                    <ul className="layout-list">
                      {SECTIONS.filter(
                        (section) => section.group === group && draft.sections[section.id].visible,
                      ).map((section) => (
                        <li key={section.id}>
                          <button
                            type="button"
                            className={`layout-list__name${
                              selected === section.id ? ' is-selected' : ''
                            }`}
                            onClick={() => setSelected(section.id)}
                          >
                            {section.label}
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm"
                            aria-label={`Remove ${section.label}`}
                            onClick={() => edit(section.id, { visible: false })}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>

              <section className="layout-panel__block">
                <h2>Removed</h2>
                {hidden.length === 0 ? (
                  <p className="muted">Every section is on the board.</p>
                ) : (
                  <ul className="layout-chips">
                    {hidden.map((section) => (
                      <li key={section.id}>
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-label={`Add ${section.label}`}
                          onClick={() => {
                            edit(section.id, { visible: true });
                            setSelected(section.id);
                          }}
                        >
                          + {section.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="layout-panel__block">
                <h2>{selected ? sectionDefinition(selected).label : 'Position & size'}</h2>
                {selectedBox && selected ? (
                  <>
                    <div className="field-row">
                      <NumberField
                        label="X (%)"
                        value={selectedBox.x}
                        min={LAYOUT_LIMITS.position.min}
                        max={LAYOUT_LIMITS.position.max}
                        onChange={(x) => edit(selected, { x })}
                      />
                      <NumberField
                        label="Y (%)"
                        value={selectedBox.y}
                        min={LAYOUT_LIMITS.position.min}
                        max={LAYOUT_LIMITS.position.max}
                        onChange={(y) => edit(selected, { y })}
                      />
                      <NumberField
                        label="Width (%)"
                        value={selectedBox.w}
                        min={LAYOUT_LIMITS.size.min}
                        max={LAYOUT_LIMITS.size.max}
                        onChange={(w) => edit(selected, { w })}
                      />
                      <NumberField
                        label="Height (%)"
                        value={selectedBox.h}
                        min={LAYOUT_LIMITS.size.min}
                        max={LAYOUT_LIMITS.size.max}
                        onChange={(h) => edit(selected, { h })}
                      />
                    </div>

                    <Field
                      label={`Text size (×${selectedBox.scale.toFixed(2)})`}
                      hint="Type normally follows the box. This tunes it without changing the box."
                    >
                      <input
                        type="range"
                        min={LAYOUT_LIMITS.scale.min}
                        max={LAYOUT_LIMITS.scale.max}
                        step={0.05}
                        value={selectedBox.scale}
                        onChange={(event) => edit(selected, { scale: Number(event.target.value) })}
                      />
                    </Field>

                    {sectionDefinition(selected).hasLabel ? (
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedBox.showLabel}
                          onChange={(event) => edit(selected, { showLabel: event.target.checked })}
                        />
                        Show the caption
                      </label>
                    ) : null}

                    <div className="layout-panel__actions">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => edit(selected, sectionDefinition(selected).defaultBox)}
                      >
                        Reset section
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => edit(selected, { visible: false })}
                      >
                        Remove section
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">Pick a section on the board or in the list above.</p>
                )}
              </section>
            </>
          ) : null}

          <section className="layout-panel__block">
            <div className="layout-panel__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!draft || !dirty || saving}
                onClick={() => void save()}
              >
                {saving ? 'Publishing…' : 'Publish layout'}
              </button>
              <button type="button" className="btn" disabled={!dirty || saving} onClick={discard}>
                Discard changes
              </button>
              <button type="button" className="btn" disabled={history.length === 0} onClick={undo}>
                Undo
              </button>
            </div>
            <button
              type="button"
              className="btn btn--danger"
              disabled={saving || (stored === null && draft === null)}
              onClick={() => void resetToDefault()}
            >
              Reset to default layout
            </button>
            <p className="muted">
              Reset deletes the custom arrangement. Every screen on this board goes back to the
              scoreboard it shipped with.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

/**
 * A number input that lets a half-typed value stay half-typed.
 *
 * Committing on every keystroke turns "12" into a box at x=1 on the way past,
 * which the preview dutifully renders. Holding the text locally and committing
 * a parsed number keeps the field usable without giving up live feedback.
 */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={0.5}
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          setText(String(value));
        }}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </Field>
  );
}
