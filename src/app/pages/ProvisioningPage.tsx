/**
 * Shown while a freshly created account waits for its tenant claims.
 *
 * Custom claims are only visible after the ID token refreshes, so there is a
 * genuine gap between "signed in" and "belongs to a tenant". This polls for
 * it, and — if the wait times out — offers a way to actually finish the job
 * rather than leaving someone staring at a spinner.
 *
 * That recovery path matters more than it looks. Signup creates the Firebase
 * Auth account first and provisions the tenant second, so anything that
 * breaks between those two steps (a deploy mid-signup, a transient 500)
 * leaves a real account with no organisation behind it. Polling alone can
 * never fix that — the claims are not late, they are absent, because nothing
 * ever created them — so an account in that state stays permanently stuck at
 * this screen. Re-running provisioning is what unsticks it, and is safe to
 * offer because `provisionTenant` is idempotent: an account that turns out
 * to already have a tenant resolves to that same tenant instead of getting a
 * second one.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { getFirebase } from '../../core/firebase.js';
import { provisionTenant, waitForClaims } from '../../core/auth.js';
import { useAuth } from '../AuthProvider.js';
import { Alert, Field } from '../components/ui.js';

export function ProvisioningPage() {
  const { auth } = getFirebase();
  const { retryProvisioning, signOut } = useAuth();
  const [gaveUp, setGaveUp] = useState(false);
  const [organisationName, setOrganisationName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void retryProvisioning().then(() => {
      // If claims had arrived, AuthProvider would already have re-rendered
      // this component away. Still being mounted means the wait genuinely
      // timed out.
      if (!cancelled) setGaveUp(true);
    });
    return () => {
      cancelled = true;
    };
  }, [retryProvisioning]);

  async function finishSetup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await provisionTenant(organisationName);
      // The new claims only exist on a refreshed token; AuthProvider's
      // `onIdTokenChanged` listener re-renders this page away once they land.
      await waitForClaims(auth);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not finish setting up your organisation.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!gaveUp) {
    return (
      <div className="center-screen">
        <div className="spinner" role="status" aria-label="Setting up" />
        <p>Setting up your organisation…</p>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="center-screen__panel">
        <Alert kind="warn">
          Your account exists, but it has no organisation yet. Give it a name to finish setting up.
        </Alert>

        {error ? <Alert kind="error">{error}</Alert> : null}

        <form onSubmit={(event) => void finishSetup(event)}>
          <Field
            label="Organisation name"
            hint="Your club, school or league. You can rename it later."
          >
            <input
              type="text"
              value={organisationName}
              onChange={(event) => setOrganisationName(event.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </Field>
          <div className="row row--center">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !organisationName.trim()}
            >
              {busy ? 'Setting up…' : 'Finish setup'}
            </button>
            <button type="button" className="btn" onClick={() => void signOut()} disabled={busy}>
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
