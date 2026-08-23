/**
 * The dashboard: every board in the organisation, with the links each one hands
 * out, plus member and audit management for admins.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { createBoard } from '../../core/boards.js';
import { getFirestoreClient } from '../../core/firestoreClient.js';
import {
  canManageBoards,
  canManageMembers,
  canViewAudit,
  MEMBER_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type MemberRole,
} from '../../core/roles.js';
import {
  inviteMember,
  removeMember,
  setMemberRole,
  MATCH_AUDIT_ACTIONS,
  subscribeAudit,
  subscribeMembers,
  subscribeTenant,
  type AuditEvent,
  type Member,
  type Tenant,
} from '../../core/tenant.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { BoardCard } from '../components/BoardCard.js';
import { IconPlus } from '../components/icons.js';
import { Alert, CopyField, Field, Modal, RoleBadge, Spinner } from '../components/ui.js';
import { useBoards } from '../hooks.js';

function formatTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DashboardPage() {
  const session = useSession();
  const firestore = getFirestoreClient();
  const { boards, error: boardsError } = useBoards(session.tenantId);

  const [tenant, setTenant] = useState<Tenant | null>(null);
  useEffect(
    () => subscribeTenant(firestore, session.tenantId, setTenant),
    [firestore, session.tenantId],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const visibleBoards = (boards ?? []).filter((board) => showArchived || !board.archived);
  const archivedCount = (boards ?? []).filter((board) => board.archived).length;
  // The empty state below carries its own "Create your first board" call to
  // action; showing the header's "New board" button at the same time would put
  // two buttons on screen that do the exact same thing.
  const showEmptyState = boards !== null && visibleBoards.length === 0;

  return (
    <AppShell tenantName={tenant?.name ?? '…'}>
      <div className="page-head">
        <div>
          <h1>Boards</h1>
          <p>Each board has its own scoreboard, mirror display and stream overlay.</p>
        </div>
        <div className="page-head__actions">
          {archivedCount > 0 ? (
            <button type="button" className="btn" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
            </button>
          ) : null}
          {!showEmptyState && canManageBoards(session.role) ? (
            <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
              <IconPlus size={15} />
              New board
            </button>
          ) : null}
        </div>
      </div>

      {boardsError ? <Alert kind="error">{boardsError}</Alert> : null}

      {boards === null ? (
        <Spinner label="Loading boards…" />
      ) : showEmptyState ? (
        <div className="empty">
          <h2>No boards yet</h2>
          <p>
            A board is one scoreboard — typically one per court. Create one to get its control
            panel, its mirror display for the venue screen, and its OBS overlay.
          </p>
          {canManageBoards(session.role) ? (
            <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
              Create your first board
            </button>
          ) : (
            <p className="muted">Ask an admin to create one.</p>
          )}
        </div>
      ) : (
        <div className="board-grid">
          {visibleBoards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              tenantId={session.tenantId}
              role={session.role}
            />
          ))}
        </div>
      )}

      {canManageMembers(session.role) ? <MembersSection tenantId={session.tenantId} /> : null}
      {canViewAudit(session.role) ? <AuditSection tenantId={session.tenantId} /> : null}

      {showCreate ? <CreateBoardModal onClose={() => setShowCreate(false)} /> : null}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function CreateBoardModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [periodMinutes, setPeriodMinutes] = useState(10);
  const [shotClockSeconds, setShotClockSeconds] = useState(24);
  const [timeouts, setTimeouts] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ boardId: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createBoard({
        name,
        config: {
          periodLengthMs: periodMinutes * 60_000,
          shotClockMs: shotClockSeconds * 1_000,
          timeouts,
        },
      });
      setCreated({ boardId: result.boardId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the board.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const origin = window.location.origin;
    return (
      <Modal
        title="Board created"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <Alert kind="success">
          {name} is ready. Its share links are on the board card and in Settings whenever you need
          them again.
        </Alert>
        <Field label="Control panel">
          <CopyField label="new-control" value={`${origin}/control/${created.boardId}`} />
        </Field>
        <Field label="Scoreboard (needs sign-in)">
          <CopyField label="new-scoreboard" value={`${origin}/board/${created.boardId}`} />
        </Field>
      </Modal>
    );
  }

  return (
    <Modal
      title="New board"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-board"
            className="btn btn--primary"
            disabled={busy || !name.trim()}
          >
            {busy ? 'Creating…' : 'Create board'}
          </button>
        </>
      }
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      <form id="create-board" onSubmit={(event) => void submit(event)}>
        <Field
          label="Board name"
          hint="Something you will recognise on a busy day — “Court 1”, “Main Gym”."
        >
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            autoFocus
          />
        </Field>
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
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function MembersSection({ tenantId }: { tenantId: string }) {
  const session = useSession();
  const firestore = getFirestoreClient();
  const [members, setMembers] = useState<Member[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeMembers(firestore, tenantId, setMembers), [firestore, tenantId]);

  async function changeRole(uid: string, role: MemberRole) {
    setError(null);
    try {
      await setMemberRole({ uid, role });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change that role.');
    }
  }

  async function remove(uid: string, email: string) {
    if (!confirm(`Remove ${email} from this organisation?`)) return;
    setError(null);
    try {
      await removeMember(uid);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove that member.');
    }
  }

  return (
    <section className="section">
      <div className="section__head">
        <h2>Members</h2>
        <button type="button" className="btn btn--sm" onClick={() => setShowInvite(true)}>
          Invite member
        </button>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className="card card--flush">
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.uid === session.uid;
              return (
                <tr key={member.uid}>
                  <td>
                    <div>{member.displayName || member.email}</div>
                    {member.displayName ? <div className="muted mono">{member.email}</div> : null}
                  </td>
                  <td>
                    {isSelf || member.role === 'owner' ? (
                      <RoleBadge role={member.role} />
                    ) : (
                      <select
                        value={member.role}
                        onChange={(event) =>
                          void changeRole(member.uid, event.target.value as MemberRole)
                        }
                        aria-label={`Role for ${member.email}`}
                      >
                        {MEMBER_ROLES.filter((role) => role !== 'owner').map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <div className="table__actions">
                      {isSelf ? (
                        <span className="muted">You</span>
                      ) : member.role === 'owner' ? null : (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void remove(member.uid, member.email)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showInvite ? <InviteModal onClose={() => setShowInvite(false)} /> : null}
    </section>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('operator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await inviteMember({ email, role });
      setInviteUrl(`${window.location.origin}${result.inviteUrl}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create that invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Invite a member"
      onClose={onClose}
      footer={
        inviteUrl ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="invite" className="btn btn--primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create invite'}
            </button>
          </>
        )
      }
    >
      {error ? <Alert kind="error">{error}</Alert> : null}

      {inviteUrl ? (
        <>
          <Alert kind="success">Send this link to {email}. It expires in seven days.</Alert>
          <CopyField label="invite" value={inviteUrl} />
        </>
      ) : (
        <form id="invite" onSubmit={(event) => void submit(event)}>
          <Field label="Email address" hint="The invite only works for this address.">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
            <select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
              {MEMBER_ROLES.filter((r) => r !== 'owner').map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function AuditSection({ tenantId }: { tenantId: string }) {
  const firestore = getFirestoreClient();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(
    () =>
      subscribeAudit(firestore, tenantId, setEvents, { limit: 50, actions: MATCH_AUDIT_ACTIONS }),
    [firestore, tenantId],
  );

  const shown = expanded ? events : events.slice(0, 8);

  return (
    <section className="section">
      <div className="section__head">
        <h2>Match activity</h2>
        {events.length > 8 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : `Show all ${events.length}`}
          </button>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="card muted">No matches started or finished yet.</div>
      ) : (
        <div className="card card--flush">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((event) => (
                <tr key={event.id}>
                  <td className="muted nowrap">{formatTime(event.ts)}</td>
                  <td className="mono">{event.action}</td>
                  <td className="muted">{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
