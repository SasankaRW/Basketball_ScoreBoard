import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../AuthProvider.js';
import { useConnection } from '../hooks.js';
import { RoleBadge } from './ui.js';
import { isMemberRole } from '../../core/roles.js';

export function AppShell({ tenantName, children }: { tenantName: string; children: ReactNode }) {
  const { state, signOut } = useAuth();
  const connected = useConnection();
  const session = state.status === 'signed-in' ? state.session : null;

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
        </nav>

        <div className="topbar__spacer" />

        <div className="topbar__meta">
          {!connected ? <span className="badge">Offline</span> : null}
          {session && isMemberRole(session.role) ? <RoleBadge role={session.role} /> : null}
          <span className="muted topbar__email">{session?.email}</span>
          <button type="button" className="btn btn--sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="page">{children}</main>
    </div>
  );
}
