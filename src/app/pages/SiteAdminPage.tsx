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
import { formatGameClock, remainingAt } from '../../core/clock.js';
import {
  getSiteAdminOverview,
  type SiteAdminOverview,
  type SiteAdminRunningGame,
} from '../../core/siteAdmin.js';
import { AppShell } from '../components/AppShell.js';
import { Alert, Spinner } from '../components/ui.js';
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

type LoadState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; overview: SiteAdminOverview };

export function SiteAdminPage() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });

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
  const anyClockTicking = runningGames.some((game) => game.gameClock.running);
  const now = useNow(anyClockTicking, 250);

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
                      <th>Period</th>
                      <th>Clock</th>
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
              <h2>Organisations ({load.overview.tenants.length})</h2>
            </div>
            <div className="card card--flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Organisation</th>
                    <th>Plan</th>
                    <th>Members</th>
                    <th>Boards</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {load.overview.tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>{tenant.name}</td>
                      <td className="mono">{tenant.plan}</td>
                      <td>{tenant.memberCount}</td>
                      <td>{tenant.boardCount}</td>
                      <td className="muted nowrap">{formatWhen(tenant.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

function RunningGameRow({ game, now }: { game: SiteAdminRunningGame; now: number }) {
  const remaining = remainingAt(game.gameClock, now);

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
      <td>Q{game.period}</td>
      <td className="mono">{formatGameClock(remaining)}</td>
    </tr>
  );
}
