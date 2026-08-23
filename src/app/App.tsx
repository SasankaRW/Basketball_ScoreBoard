import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthProvider.js';
import { Spinner } from './components/ui.js';
import { BoardSettingsPage } from './pages/BoardSettingsPage.js';
import { ControlPanelPage } from './pages/ControlPanelPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { JoinPage } from './pages/JoinPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProvisioningPage } from './pages/ProvisioningPage.js';
import { SchedulePage } from './pages/SchedulePage.js';
import { TourProvider } from './tour/TourProvider.js';
import type { ReactNode } from 'react';

/**
 * Gate for every authenticated route.
 *
 * The `provisioning` state is a real one, not an edge case: custom claims set
 * during signup only become visible after the ID token refreshes, leaving a
 * short window where someone is signed in but has no tenant yet. Bouncing them
 * to the login page there would look like signup had failed.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <Spinner label="Loading…" />;
  if (state.status === 'provisioning') return <ProvisioningPage />;
  if (state.status === 'signed-out') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="center-screen">
      <h1>Page not found</h1>
      <p className="muted">That link does not lead anywhere.</p>
      <a className="btn" href="/app">
        Back to dashboard
      </a>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <TourProvider>
        <AppRoutes />
      </TourProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join/:inviteId" element={<JoinPage />} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/boards/:boardId"
          element={
            <RequireAuth>
              <BoardSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/schedule"
          element={
            <RequireAuth>
              <SchedulePage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/history"
          element={
            <RequireAuth>
              <HistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/control/:boardId"
          element={
            <RequireAuth>
              <ControlPanelPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
