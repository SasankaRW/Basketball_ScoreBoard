/**
 * Shown while a freshly created account waits for its tenant claims.
 *
 * Custom claims are only visible after the ID token refreshes, so there is a
 * genuine gap between "signed in" and "belongs to a tenant". This polls for it,
 * and offers a way out if provisioning genuinely failed rather than leaving
 * someone staring at a spinner.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthProvider.js';
import { Alert } from '../components/ui.js';

export function ProvisioningPage() {
  const { retryProvisioning, signOut } = useAuth();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void retryProvisioning().then(() => {
      // If claims had arrived, AuthProvider would already have re-rendered this
      // component away. Still being mounted means the wait genuinely timed out.
      if (!cancelled) setGaveUp(true);
    });
    return () => {
      cancelled = true;
    };
  }, [retryProvisioning]);

  return (
    <div className="center-screen">
      {gaveUp ? (
        <div className="center-screen__panel">
          <Alert kind="warn">
            Your account exists, but its organisation has not finished setting up. This usually
            clears on its own within a minute.
          </Alert>
          <div className="row row--center">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="spinner" role="status" aria-label="Setting up" />
          <p>Setting up your organisation…</p>
        </>
      )}
    </div>
  );
}
