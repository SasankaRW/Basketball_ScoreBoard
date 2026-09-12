/**
 * Cross-tenant oversight — every organisation on the site, and the merged
 * activity feed across all of them.
 *
 * Deliberately unreachable from any menu, button, or nav link anywhere in the
 * app: the only way in is knowing this URL. The real gate is server-side
 * (`src/server/siteAdmin.ts` checks the caller's email against a hard-coded
 * allowlist, independent of any tenant role), so this page renders for
 * anyone signed in and simply shows "Not authorised" for everyone the server
 * rejects — the route itself has nothing worth hiding.
 */
import { useEffect, useState } from 'react';
import { ApiCallError } from '../../core/api.js';
import { getSiteAdminOverview, type SiteAdminOverview } from '../../core/siteAdmin.js';
import { AppShell } from '../components/AppShell.js';
import { Alert, Spinner } from '../components/ui.js';

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

  useEffect(() => {
    let active = true;
    getSiteAdminOverview()
      .then((overview) => {
        if (active) setLoad({ status: 'ready', overview });
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof ApiCallError && caught.status === 403) {
          setLoad({ status: 'forbidden' });
        } else {
          setLoad({
            status: 'error',
            message: caught instanceof Error ? caught.message : 'Could not load this page.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell tenantName="Site admin">
      <div className="page-head">
        <div>
          <h1>Site admin</h1>
          <p>Every organisation on this site, and their merged activity.</p>
        </div>
      </div>

      {load.status === 'loading' ? <Spinner label="Loading…" /> : null}
      {load.status === 'forbidden' ? <Alert kind="error">Not authorised.</Alert> : null}
      {load.status === 'error' ? <Alert kind="error">{load.message}</Alert> : null}

      {load.status === 'ready' ? (
        <>
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

          <section className="section">
            <div className="section__head">
              <h2>Activity across every organisation</h2>
            </div>
            {load.overview.activity.length === 0 ? (
              <div className="card muted">Nothing has happened yet.</div>
            ) : (
              <div className="card card--flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Organisation</th>
                      <th>Action</th>
                      <th>Detail</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {load.overview.activity.map((event) => (
                      <tr key={event.id}>
                        <td className="muted nowrap">{formatWhen(event.ts)}</td>
                        <td>{event.tenantName}</td>
                        <td className="mono">{event.action}</td>
                        <td className="muted">{event.detail}</td>
                        <td className="muted">{event.actorEmail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
