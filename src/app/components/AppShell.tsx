import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../AuthProvider.js';
import { useConnection } from '../hooks.js';
import { Tour } from '../tour/Tour.js';
import { useTour } from '../tour/TourProvider.js';
import { IconHelp } from './icons.js';
import { RoleBadge } from './ui.js';
import { canViewLiveGames, isMemberRole } from '../../core/roles.js';

export function AppShell({ tenantName, children }: { tenantName: string; children: ReactNode }) {
  const { state, signOut } = useAuth();
  const connected = useConnection();
  const session = state.status === 'signed-in' ? state.session : null;
  const tour = useTour();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/app" className="topbar__brand">
          <img src="/assets/logo.svg" alt="" />
          <span>Scoreboard</span>
        </Link>

        <span className="topbar__tenant">{tenantName}</span>

        <nav className="topbar__nav">
          <NavLink to="/app" end className="topbar__navlink">
            Dashboard
          </NavLink>
          <NavLink to="/app/schedule" className="topbar__navlink">
            Schedule
          </NavLink>
          <NavLink to="/app/history" className="topbar__navlink">
            History
          </NavLink>
          {session && canViewLiveGames(session.role) ? (
            <NavLink to="/app/live" className="topbar__navlink">
              Live
            </NavLink>
          ) : null}
        </nav>

        <div className="topbar__spacer" />

        <div className="topbar__meta">
          {!connected ? <span className="badge">Offline</span> : null}
          {session && isMemberRole(session.role) ? <RoleBadge role={session.role} /> : null}
          <span className="muted topbar__email">{session?.email}</span>
          {/*
            Always present, never disabled away: someone looking for help should
            find the same control in the same place on every page. Pages with no
            tour of their own simply have nothing to open.
          */}
          {tour.available ? (
            <button
              type="button"
              className="btn btn--sm topbar__help"
              data-tour="help"
              onClick={tour.start}
              title="Show me around this page"
            >
              <IconHelp size={14} />
              Help
            </button>
          ) : null}
          <button type="button" className="btn btn--sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="page">{children}</main>

      <Tour />
    </div>
  );
}
