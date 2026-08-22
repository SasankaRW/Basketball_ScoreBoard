/**
 * Accepting an invite.
 *
 * The invite ID is the only secret, and `acceptInvite` additionally checks the
 * signed-in address against the one the invite was issued to — so a forwarded
 * link cannot onboard someone the admin never intended to add.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getFirebase } from '../../core/firebase.js';
import { waitForClaims } from '../../core/auth.js';
import { acceptInvite } from '../../core/tenant.js';
import { useAuth } from '../AuthProvider.js';
import { Alert, Spinner } from '../components/ui.js';

export function JoinPage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { state } = useAuth();
  const { auth } = getFirebase();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteId || busy || error) return;
    if (state.status !== 'signed-in' && state.status !== 'provisioning') return;

    setBusy(true);
    void acceptInvite(inviteId)
      .then(async () => {
        // The new role arrives as a custom claim, which is only visible after the
        // ID token refreshes.
        await waitForClaims(auth);
        navigate('/app', { replace: true });
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'This invite could not be accepted.');
      })
      .finally(() => setBusy(false));
  }, [inviteId, state.status, auth, navigate, busy, error]);

  if (state.status === 'loading') return <Spinner label="Loading…" />;

  if (state.status === 'signed-out') {
    // Sign in first, then come straight back here to redeem it.
    return <Navigate to={`/login?next=${encodeURIComponent(`/join/${inviteId ?? ''}`)}`} replace />;
  }

  if (error) {
    return (
      <div className="center-screen">
        <div className="center-screen__panel">
          <Alert kind="error">{error}</Alert>
          <a className="btn" href="/app">
            Go to dashboard
          </a>
        </div>
      </div>
    );
  }

  return <Spinner label="Joining organisation…" />;
}
