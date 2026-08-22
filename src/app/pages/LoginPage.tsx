/**
 * Sign in and sign up.
 *
 * Signing up creates the account and its organisation in one step, because a
 * tenant with no owner is not a meaningful state — `provisionTenant` performs
 * both, idempotently, so a retry after a dropped connection resolves to the same
 * tenant rather than a second one.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { describeAuthError, requestPasswordReset, signIn, signUp } from '../../core/auth.js';
import { getFirebase } from '../../core/firebase.js';
import { useAuth } from '../AuthProvider.js';
import { Alert, Field, Spinner } from '../components/ui.js';

type Mode = 'sign-in' | 'sign-up' | 'reset';

/** Only relative paths, so a crafted `?next=` cannot bounce someone off-site. */
function safeNext(raw: string | null): string {
  if (!raw) return '/app';
  const decoded = decodeURIComponent(raw);
  return decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/app';
}

export function LoginPage() {
  const { auth, functions } = getFirebase();
  const { state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'loading') return <Spinner label="Loading…" />;
  if (state.status === 'signed-in') return <Navigate to={next} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (mode === 'reset') {
        await requestPasswordReset(auth, email);
        setNotice('If that address has an account, a reset link is on its way.');
        setMode('sign-in');
      } else if (mode === 'sign-in') {
        await signIn(auth, email, password);
        navigate(next, { replace: true });
      } else {
        await signUp(auth, functions, { email, password, displayName, organisationName });
        navigate('/app', { replace: true });
      }
    } catch (caught) {
      setError(describeAuthError(caught));
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'sign-up'
      ? 'Create your organisation'
      : mode === 'reset'
        ? 'Reset password'
        : 'Sign in';

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img src="/assets/logo.svg" alt="" />
          <span>Scoreboard</span>
        </div>
        <p className="auth-card__sub">{heading}</p>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {notice ? <Alert kind="success">{notice}</Alert> : null}

        <form onSubmit={(event) => void onSubmit(event)}>
          {mode === 'sign-up' ? (
            <>
              <Field label="Your name">
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </Field>
              <Field
                label="Organisation name"
                hint="Your club, school or league. You can rename it later."
              >
                <input
                  type="text"
                  value={organisationName}
                  onChange={(event) => setOrganisationName(event.target.value)}
                  autoComplete="organization"
                  required
                  maxLength={80}
                />
              </Field>
            </>
          ) : null}

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </Field>

          {mode === 'reset' ? null : (
            <Field
              label="Password"
              hint={mode === 'sign-up' ? 'At least 8 characters.' : undefined}
            >
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'sign-up' ? 8 : undefined}
              />
            </Field>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy
              ? 'Working…'
              : mode === 'sign-up'
                ? 'Create organisation'
                : mode === 'reset'
                  ? 'Send reset link'
                  : 'Sign in'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'sign-in' ? (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setMode('sign-up')}
              >
                Create an organisation
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setMode('reset')}
              >
                Forgot password
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setMode('sign-in')}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
