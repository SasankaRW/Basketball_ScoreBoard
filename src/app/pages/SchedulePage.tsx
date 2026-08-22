/**
 * Match scheduling — plan games ahead of time, then start one onto whichever
 * court is free when it's time to play.
 *
 * A schedule entry is tenant-wide, not tied to any board, until "Start" picks
 * one — see core/schedule.ts and the `schedule` rules block in
 * firestore.rules for why creating/editing/cancelling is a plain client write
 * while starting is a privileged Cloud Function.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import { isBoardIdle } from '../../core/schema.js';
import { canControlBoard, canManageBoards } from '../../core/roles.js';
import {
  cancelScheduleEntry,
  createScheduleEntry,
  deleteScheduleEntry,
  startScheduledMatch,
  subscribeSchedule,
  updateScheduleEntry,
  type ScheduleEntry,
} from '../../core/schedule.js';
import { subscribeTenant, type Tenant } from '../../core/tenant.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { IconPlus } from '../components/icons.js';
import { Alert, Field, Modal, Spinner } from '../components/ui.js';
import { useBoardState, useBoards } from '../hooks.js';

function toDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_LABEL: Record<ScheduleEntry['status'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function SchedulePage() {
  const session = useSession();
  const firestore = getFirestoreClient();
  const navigate = useNavigate();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);
  const [starting, setStarting] = useState<ScheduleEntry | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(
    () => subscribeTenant(firestore, session.tenantId, setTenant),
    [firestore, session.tenantId],
  );

  useEffect(
    () => subscribeSchedule(firestore, session.tenantId, setEntries, (e) => setError(e.message)),
    [firestore, session.tenantId],
  );

  const canPlan = canControlBoard(session.role);
  const canDelete = canManageBoards(session.role);

  const upcoming = (entries ?? []).filter(
    (e) => showPast || (e.status !== 'completed' && e.status !== 'cancelled'),
  );

  async function cancel(entry: ScheduleEntry) {
    if (!confirm(`Cancel the scheduled match "${entry.homeTeamName} vs ${entry.awayTeamName}"?`))
      return;
    setError(null);
    try {
      await cancelScheduleEntry(firestore, session.tenantId, entry.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel that match.');
    }
  }

  async function remove(entry: ScheduleEntry) {
    if (
      !confirm(
        `Permanently delete "${entry.homeTeamName} vs ${entry.awayTeamName}" from the schedule?`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteScheduleEntry(firestore, session.tenantId, entry.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that entry.');
    }
  }

  // The empty state below carries its own "Schedule a match" call to action —
  // showing the header's button at the same time would put two buttons on
  // screen that do the exact same thing (the same fix DashboardPage needed).
  const showEmptyState = entries !== null && upcoming.length === 0;

  return (
    <AppShell tenantName={tenant?.name ?? '…'}>
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <p>Plan matches ahead of time, then start one onto whichever court is free.</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Hide finished' : 'Show finished'}
          </button>
          {!showEmptyState && canPlan ? (
            <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
              <IconPlus size={15} />
              Schedule a match
            </button>
          ) : null}
        </div>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {entries === null ? (
        <Spinner label="Loading schedule…" />
      ) : showEmptyState ? (
        <div className="empty">
          <h2>Nothing scheduled</h2>
          <p>Plan a match ahead of time so it's ready to start the moment a court is free.</p>
          {canPlan ? (
            <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
              Schedule a match
            </button>
          ) : null}
        </div>
      ) : (
        <div className="card card--flush">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Match</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {upcoming.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted nowrap">{formatWhen(entry.scheduledAt)}</td>
                  <td>
                    {entry.homeTeamName} <span className="muted">vs</span> {entry.awayTeamName}
                    {entry.notes ? (
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {entry.notes}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`badge${entry.status === 'in_progress' ? ' badge--live' : ''}`}
                    >
                      {STATUS_LABEL[entry.status]}
                    </span>
                  </td>
                  <td>
                    <div className="table__actions">
                      {entry.status === 'scheduled' && canPlan ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => setStarting(entry)}
                        >
                          Start
                        </button>
                      ) : null}
                      {entry.status === 'in_progress' && entry.boardId ? (
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => navigate(`/control/${entry.boardId}`)}
                        >
                          Open
                        </button>
                      ) : null}
                      {entry.status === 'scheduled' && canPlan ? (
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => setEditing(entry)}
                        >
                          Edit
                        </button>
                      ) : null}
                      {entry.status === 'scheduled' && canPlan ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void cancel(entry)}
                        >
                          Cancel
                        </button>
                      ) : null}
                      {(entry.status === 'scheduled' || entry.status === 'cancelled') &&
                      canDelete ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void remove(entry)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <ScheduleFormModal
          title="Schedule a match"
          submitLabel="Schedule match"
          onClose={() => setShowCreate(false)}
          onSubmit={async (values) => {
            await createScheduleEntry(firestore, session.tenantId, {
              ...values,
              createdBy: session.uid,
            });
          }}
        />
      ) : null}

      {editing ? (
        <ScheduleFormModal
          title="Edit scheduled match"
          submitLabel="Save changes"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await updateScheduleEntry(firestore, session.tenantId, editing.id, values);
          }}
        />
      ) : null}

      {starting ? (
        <StartMatchModal
          entry={starting}
          tenantId={session.tenantId}
          onClose={() => setStarting(null)}
          onStarted={(boardId) => navigate(`/control/${boardId}`)}
        />
      ) : null}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

interface ScheduleFormValues {
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: number;
  notes: string;
  config: { periodLengthMs?: number; shotClockMs?: number; timeouts?: number } | null;
}

function ScheduleFormModal({
  title,
  submitLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial?: ScheduleEntry;
  onClose: () => void;
  onSubmit: (values: ScheduleFormValues) => Promise<void>;
}) {
  const [homeTeamName, setHomeTeamName] = useState(initial?.homeTeamName ?? '');
  const [awayTeamName, setAwayTeamName] = useState(initial?.awayTeamName ?? '');
  const [when, setWhen] = useState(toDateTimeLocal(initial?.scheduledAt ?? Date.now() + 3_600_000));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [useOverrides, setUseOverrides] = useState(Boolean(initial?.config));
  const [periodMinutes, setPeriodMinutes] = useState(
    initial?.config?.periodLengthMs ? initial.config.periodLengthMs / 60_000 : 10,
  );
  const [shotClockSeconds, setShotClockSeconds] = useState(
    initial?.config?.shotClockMs ? initial.config.shotClockMs / 1_000 : 24,
  );
  const [timeouts, setTimeouts] = useState(initial?.config?.timeouts ?? 2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        homeTeamName,
        awayTeamName,
        scheduledAt: fromDateTimeLocal(when),
        notes,
        config: useOverrides
          ? {
              periodLengthMs: periodMinutes * 60_000,
              shotClockMs: shotClockSeconds * 1_000,
              timeouts,
            }
          : null,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this match.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="schedule-form"
            className="btn btn--primary"
            disabled={busy || !homeTeamName.trim() || !awayTeamName.trim()}
          >
            {busy ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      <form id="schedule-form" onSubmit={(event) => void submit(event)}>
        <div className="field-row">
          <Field label="Home team">
            <input
              type="text"
              value={homeTeamName}
              onChange={(event) => setHomeTeamName(event.target.value)}
              maxLength={24}
              required
              autoFocus
            />
          </Field>
          <Field label="Away team">
            <input
              type="text"
              value={awayTeamName}
              onChange={(event) => setAwayTeamName(event.target.value)}
              maxLength={24}
              required
            />
          </Field>
        </div>

        <Field label="Date & time">
          <input
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            required
          />
        </Field>

        <Field label="Notes" hint="Optional — e.g. “Semifinal”, venue details.">
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
          />
        </Field>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useOverrides}
            onChange={(event) => setUseOverrides(event.target.checked)}
          />
          Override this board's default game length
        </label>

        {useOverrides ? (
          <div className="field-row">
            <Field label="Period length (min)">
              <input
                type="number"
                min={1}
                max={99}
                value={periodMinutes}
                onChange={(event) => setPeriodMinutes(Number(event.target.value))}
              />
            </Field>
            <Field label="Shot clock (sec)">
              <input
                type="number"
                min={1}
                max={99}
                value={shotClockSeconds}
                onChange={(event) => setShotClockSeconds(Number(event.target.value))}
              />
            </Field>
            <Field label="Timeouts">
              <input
                type="number"
                min={0}
                max={99}
                value={timeouts}
                onChange={(event) => setTimeouts(Number(event.target.value))}
              />
            </Field>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** One board's row inside the Start-match picker, with its own live idle/busy read. */
function BoardPickerRow({
  boardId,
  boardName,
  tenantId,
  selected,
  onSelect,
}: {
  boardId: string;
  boardName: string;
  tenantId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { state, loaded } = useBoardState(tenantId, boardId);
  const idle = !loaded || state === null || isBoardIdle(state);

  return (
    <label className={`board-picker-row${idle ? '' : ' board-picker-row--busy'}`}>
      <input
        type="radio"
        name="board-picker"
        disabled={!idle}
        checked={selected}
        onChange={onSelect}
      />
      <span className="board-picker-row__name">{boardName}</span>
      <span className={`badge${idle ? '' : ' badge--live'}`}>{idle ? 'Idle' : 'In progress'}</span>
    </label>
  );
}

function StartMatchModal({
  entry,
  tenantId,
  onClose,
  onStarted,
}: {
  entry: ScheduleEntry;
  tenantId: string;
  onClose: () => void;
  onStarted: (boardId: string) => void;
}) {
  const { boards } = useBoards(tenantId);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeBoards = (boards ?? []).filter((b) => !b.archived);

  async function start() {
    if (!selectedBoardId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startScheduledMatch({
        scheduleId: entry.id,
        boardId: selectedBoardId,
      });
      onStarted(result.boardId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start this match.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Start "${entry.homeTeamName} vs ${entry.awayTeamName}"`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !selectedBoardId}
            onClick={() => void start()}
          >
            {busy ? 'Starting…' : 'Start match'}
          </button>
        </>
      }
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      <p className="field__hint" style={{ marginBottom: '0.8rem' }}>
        Choose a court. A board already running a game is shown but can't be selected — finish or
        reset it first.
      </p>
      {boards === null ? (
        <Spinner label="Loading courts…" />
      ) : activeBoards.length === 0 ? (
        <Alert kind="warn">There are no boards to start this match on yet.</Alert>
      ) : (
        activeBoards.map((board) => (
          <BoardPickerRow
            key={board.id}
            boardId={board.id}
            boardName={board.name}
            tenantId={tenantId}
            selected={selectedBoardId === board.id}
            onSelect={() => setSelectedBoardId(board.id)}
          />
        ))
      )}
    </Modal>
  );
}
