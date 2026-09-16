/**
 * Cross-tenant oversight — every organisation on the site, and every board
 * mid-game right now, wherever it lives.
 *
 * Deliberately unreachable from any menu, button, or nav link anywhere in the
 * app: the only way in is knowing this URL. The real gate is server-side
 * (`src/server/siteAdmin.ts` checks the caller's email against a hard-coded
 * allowlist, independent of any tenant role), so this page renders for
 * anyone signed in and simply shows "Not authorised" for everyone the server
 * rejects — the route itself has nothing worth hiding.
 *
 * The overview is a snapshot, not a live subscription: it is one request to
 * one serverless function, not a socket held open per tenant. The game clock
 * still ticks smoothly between refreshes — `remainingAt` only needs the
 * `endsAt` timestamp the fetch captured and the current wall clock, the same
 * arithmetic every other clock in this app already runs on — but a score
 * change on the actual board will not appear here until "Refresh" is pressed
 * again.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiCallError } from '../../core/api.js';
import { formatGameClock, formatShotClock, remainingAt } from '../../core/clock.js';
import {
  deleteSiteAdminBoard,
  getSiteAdminBoardMatches,
  getSiteAdminOverview,
  type SiteAdminBoard,
  type SiteAdminMatchSummary,
  type SiteAdminOverview,
  type SiteAdminRunningGame,
} from '../../core/siteAdmin.js';
import { AppShell } from '../components/AppShell.js';
import { Alert, Modal, Spinner, useConfirm } from '../components/ui.js';
import { useNow } from '../hooks.js';

function formatWhen(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

/** Q1–Q4 then OT1, OT2… — same labelling as the tenant-facing history page. */
function periodLabel(period: number): string {
  return period <= 4 ? `Q${period}` : `OT${period - 4}`;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; overview: SiteAdminOverview };

export function SiteAdminPage() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);
  const [historyBoard, setHistoryBoard] = useState<SiteAdminBoard | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const refresh = useCallback(() => {
    setLoad((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    getSiteAdminOverview()
      .then((overview) => setLoad({ status: 'ready', overview }))
      .catch((caught) => {
        if (caught instanceof ApiCallError && caught.status === 403) {
          setLoad({ status: 'forbidden' });
        } else {
          setLoad({
            status: 'error',
            message: caught instanceof Error ? caught.message : 'Could not load this page.',
          });
        }
      });
  }, []);

  // `refresh` never changes identity (its own deps are empty), so listing it
  // here still only runs this once on mount rather than on every render.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const runningGames = load.status === 'ready' ? load.overview.runningGames : [];
  const anyClockTicking = runningGames.some(
    (game) => game.gameClock.running || game.shotClock.running,
  );
  const now = useNow(anyClockTicking, 250);

  async function handleDelete(board: SiteAdminBoard) {
    setActionError(null);
    const confirmed = await confirm(
      `Delete "${board.boardName}" from ${board.tenantName}? This removes its live state and match history stays, but the board itself cannot be recovered.`,
      { confirmLabel: 'Delete board', danger: true },
    );
    if (!confirmed) return;

    setDeletingBoardId(board.boardId);
    try {
      await deleteSiteAdminBoard(board.tenantId, board.boardId);
      refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not delete that board.');
    } finally {
      setDeletingBoardId(null);
    }
  }

  return (
    <AppShell tenantName="Site admin">
      <div className="page-head">
        <div>
          <h1>Site admin</h1>
          <p>Every organisation on this site, and every board mid-game right now.</p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn"
            onClick={refresh}
            disabled={load.status === 'loading'}
          >
            Refresh
          </button>
        </div>
      </div>

      {load.status === 'loading' ? <Spinner label="Loading…" /> : null}
      {load.status === 'forbidden' ? <Alert kind="error">Not authorised.</Alert> : null}
      {load.status === 'error' ? <Alert kind="error">{load.message}</Alert> : null}
      {actionError ? <Alert kind="error">{actionError}</Alert> : null}

      {load.status === 'ready' ? (
        <>
          <section className="section">
            <div className="section__head">
              <h2>Running games ({runningGames.length})</h2>
            </div>
            {runningGames.length === 0 ? (
              <div className="empty">
                <h2>No games in progress</h2>
                <p>Every board, across every organisation, is idle right now.</p>
              </div>
            ) : (
              <div className="card card--flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Organisation</th>
                      <th>Board</th>
                      <th>Score</th>
                      <th>Fouls</th>
                      <th>Timeouts left</th>
                      <th>Possession</th>
                      <th>Period</th>
                      <th>Clock</th>
                      <th>Shot clock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runningGames.map((game) => (
                      <RunningGameRow
                        key={`${game.tenantId}-${game.boardId}`}
                        game={game}
                        now={now}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <div className="section__head">
              <h2>Boards ({load.overview.boards.length})</h2>
            </div>
            <div className="card card--flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Organisation</th>
                    <th>Board</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {load.overview.boards.map((board) => (
                    <BoardStatusRow
                      key={`${board.tenantId}-${board.boardId}`}
                      board={board}
                      deleting={deletingBoardId === board.boardId}
                      onViewHistory={() => setHistoryBoard(board)}
                      onDelete={() => void handleDelete(board)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2>Organisations ({load.overview.tenants.length})</h2>
            </div>
            <div className="card card--flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Organisation</th>
                    <th>Plan</th>
                    <th>Members</th>
                    <th>Boards active</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {load.overview.tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>{tenant.name}</td>
                      <td className="mono">{tenant.plan}</td>
                      <td>{tenant.memberCount}</td>
                      <td>
                        {tenant.activeBoardCount} / {tenant.boardCount}
                      </td>
                      <td className="muted nowrap">{formatWhen(tenant.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {confirmDialog}

      {historyBoard ? (
        <BoardHistoryModal board={historyBoard} onClose={() => setHistoryBoard(null)} />
      ) : null}
    </AppShell>
  );
}

function RunningGameRow({ game, now }: { game: SiteAdminRunningGame; now: number }) {
  const gameRemaining = remainingAt(game.gameClock, now);
  const shotRemaining = remainingAt(game.shotClock, now);

  return (
    <tr>
      <td>{game.tenantName}</td>
      <td>
        <div className="row">
          <span>{game.boardName}</span>
          {game.gameClock.running ? <span className="badge badge--live">Live</span> : null}
        </div>
      </td>
      <td className="mono">
        {game.homeName} <strong>{game.homeScore}</strong> – <strong>{game.awayScore}</strong>{' '}
        {game.awayName}
      </td>
      <td className="mono">
        {game.homeFouls} – {game.awayFouls}
      </td>
      <td className="mono">
        {game.homeTimeouts} – {game.awayTimeouts}
      </td>
      <td>{game.possession === 'home' ? game.homeName : game.awayName}</td>
      <td>Q{game.period}</td>
      <td className="mono">{formatGameClock(gameRemaining)}</td>
      <td className="mono">{formatShotClock(shotRemaining)}</td>
    </tr>
  );
}

function BoardStatusRow({
  board,
  deleting,
  onViewHistory,
  onDelete,
}: {
  board: SiteAdminBoard;
  deleting: boolean;
  onViewHistory: () => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <td>{board.tenantName}</td>
      <td>{board.boardName}</td>
      <td>
        {board.active ? (
          <span className="badge badge--live">Active</span>
        ) : (
          <span className="badge">Idle</span>
        )}
      </td>
      <td className="table__actions">
        <button type="button" className="btn btn--sm" onClick={onViewHistory}>
          History
        </button>
        <button
          type="button"
          className="btn btn--sm btn--danger"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

function BoardHistoryModal({ board, onClose }: { board: SiteAdminBoard; onClose: () => void }) {
  const [matches, setMatches] = useState<SiteAdminMatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSiteAdminBoardMatches(board.tenantId, board.boardId)
      .then((result) => {
        if (!cancelled) setMatches(result);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load match history.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [board.tenantId, board.boardId]);

  return (
    <Modal title={`${board.boardName} — match history`} onClose={onClose}>
      {error ? <Alert kind="error">{error}</Alert> : null}

      {!error && matches === null ? <Spinner label="Loading match history…" /> : null}

      {matches !== null && matches.length === 0 ? (
        <p className="muted">No matches finished on this board yet.</p>
      ) : null}

      {matches !== null && matches.length > 0 ? (
        <div className="card--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Result</th>
                <th>Periods</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.id}>
                  <td className="muted nowrap">{formatWhen(match.endedAt)}</td>
                  <td className="mono">
                    {match.homeTeamName} {match.homeScore} – {match.awayScore} {match.awayTeamName}
                  </td>
                  <td>{periodLabel(match.periodsPlayed)}</td>
                  <td className="mono">{formatDuration(match.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}
