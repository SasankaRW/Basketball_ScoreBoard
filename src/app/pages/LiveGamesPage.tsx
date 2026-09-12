/**
 * Every board with a game in progress, on one screen — for someone checking
 * on a whole venue rather than running any single court.
 *
 * Read-only, and built entirely on subscriptions the app already holds
 * elsewhere: `useBoards` (the dashboard's board grid) and `useBoardState`
 * (the control panel, the mirror, `BoardCard`'s own live preview). Nothing
 * here writes to a board, starts or stops a clock, or touches the schedule —
 * so a game already in progress, and whoever is running it, notices nothing
 * different about this page existing.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatGameClock, remainingAt } from '../../core/clock.js';
import type { Board } from '../../core/boards.js';
import { canViewLiveGames } from '../../core/roles.js';
import { isBoardIdle, type BoardState } from '../../core/schema.js';
import { useSession } from '../AuthProvider.js';
import { AppShell } from '../components/AppShell.js';
import { Alert, Spinner } from '../components/ui.js';
import { useBoards, useBoardState, useNow } from '../hooks.js';

export function LiveGamesPage() {
  const session = useSession();
  const { boards, error } = useBoards(session.tenantId);

  // Each row reports its own idle/running status here as its live state
  // arrives, since that is the one thing this page cannot know from the
  // board list alone. Keyed by board id so one board's update never has to
  // recompute anyone else's.
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const reportStatus = useCallback((boardId: string, isRunning: boolean) => {
    setRunning((current) =>
      current[boardId] === isRunning ? current : { ...current, [boardId]: isRunning },
    );
  }, []);

  if (!canViewLiveGames(session.role)) {
    return (
      <AppShell tenantName="">
        <Alert kind="error">Only admins and owners can see the live games overview.</Alert>
        <Link className="btn" to="/app">
          Back to dashboard
        </Link>
      </AppShell>
    );
  }

  const visibleBoards = (boards ?? []).filter((board) => !board.archived);
  const runningCount = visibleBoards.filter((board) => running[board.id]).length;

  return (
    <AppShell tenantName="">
      <div className="page-head">
        <div>
          <h1>Live games</h1>
          <p>Every board currently mid-game, with its score, period and clock.</p>
        </div>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      {boards === null ? (
        <Spinner label="Loading boards…" />
      ) : (
        <>
          {runningCount === 0 ? (
            <div className="empty">
              <h2>No games in progress</h2>
              <p>Every board is idle right now. This list updates the moment one starts.</p>
            </div>
          ) : (
            <div className="card card--flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Board</th>
                    <th>Score</th>
                    <th>Period</th>
                    <th>Clock</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleBoards.map((board) => (
                    <LiveGameRow
                      key={board.id}
                      board={board}
                      tenantId={session.tenantId}
                      onStatusChange={reportStatus}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

/**
 * One board's row, or nothing at all — the same "hide until proven running"
 * shape `BoardPickerRow` (SchedulePage.tsx) uses for idle/busy, applied here
 * to idle/in-progress instead.
 */
function LiveGameRow({
  board,
  tenantId,
  onStatusChange,
}: {
  board: Board;
  tenantId: string;
  onStatusChange: (boardId: string, running: boolean) => void;
}) {
  const { state, loaded } = useBoardState(tenantId, board.id);
  const inProgress = loaded && state !== null && !isBoardIdle(state);
  const clockTicking = inProgress && state ? clockIsRunning(state) : false;
  const now = useNow(clockTicking, 250);

  useEffect(() => {
    onStatusChange(board.id, inProgress);
  }, [board.id, inProgress, onStatusChange]);

  if (!inProgress || !state) return null;

  const remaining = remainingAt(state.gameClock, now);

  return (
    <tr>
      <td>
        <div className="row">
          <Link to={`/control/${board.id}`}>{board.name}</Link>
          {state.gameClock.running ? <span className="badge badge--live">Live</span> : null}
        </div>
      </td>
      <td className="mono">
        {state.home.name} <strong>{state.home.score}</strong> – <strong>{state.away.score}</strong>{' '}
        {state.away.name}
      </td>
      <td>Q{state.period}</td>
      <td className="mono">{formatGameClock(remaining, state.config.showTenthsUnderOneMinute)}</td>
      <td className="table__actions">
        <Link className="btn btn--sm" to={`/control/${board.id}`}>
          Open
        </Link>
      </td>
    </tr>
  );
}

function clockIsRunning(state: BoardState): boolean {
  return state.gameClock.running || state.shotClock.running;
}
