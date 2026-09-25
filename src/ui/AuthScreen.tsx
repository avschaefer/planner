import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD, sendPasswordReset, setPassword, signIn, signUp } from '../persist/auth';
import { useStore } from '../store/store';
import { Button } from './Button';
import { GlassPage } from './GlassPage';

type Mode = 'signin' | 'signup' | 'forgot' | 'sent' | 'recovery';

/**
 * Sign in, create an account, reset a password. One small form at a time,
 * inside the same frosted card as the rest of the app.
 *
 * Email is used twice in an account's life — to confirm the address, and if
 * the password is forgotten. Everything else is a password and a session
 * that stays signed in on that device.
 */
export function AuthScreen({ recovery = false }: { recovery?: boolean }) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentWhat, setSentWhat] = useState<'confirm' | 'reset'>('confirm');
  const endRecovery = useStore((s) => s.endRecovery);
  const notify = useStore((s) => s.notify);

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setPasswordValue('');
    setConfirm('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const err = await signIn(email, password);
        if (err) setError(err);
        // On success the auth listener swaps this screen for the app.
      } else if (mode === 'signup') {
        const { error: err, confirmBy } = await signUp(email, password, name);
        if (err) setError(err);
        else if (confirmBy === 'email') {
          setSentWhat('confirm');
          go('sent');
        }
      } else if (mode === 'forgot') {
        const err = await sendPasswordReset(email);
        if (err) setError(err);
        else {
          setSentWhat('reset');
          go('sent');
        }
      } else if (mode === 'recovery') {
        if (password !== confirm) setError("The two passwords don't match.");
        else {
          const err = await setPassword(password);
          if (err) setError(err);
          else {
            endRecovery();
            notify('Password updated.');
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const title = {
    signin: 'Sign in',
    signup: 'Create your account',
    forgot: 'Reset your password',
    sent: 'Check your email',
    recovery: 'Choose a new password',
  }[mode];

  return (
    <GlassPage narrow>
      <h2 className="auth-title">{title}</h2>

      {mode === 'sent' ? (
        <div className="auth-form">
          <p className="auth-note">
            {sentWhat === 'confirm'
              ? `We sent a confirmation link to ${email}. Open it on this device to finish creating your account.`
              : `If an account exists for ${email}, a reset link is on its way. It opens a page here to choose a new password.`}
          </p>
          <Button variant="secondary" onClick={() => go('signin')}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
          {mode === 'signup' && (
            <label className="auth-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="How you appear to collaborators"
              />
            </label>
          )}

          {mode !== 'recovery' && (
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </label>
          )}

          {mode !== 'forgot' && (
            <label className="auth-field">
              <span>{mode === 'recovery' ? 'New password' : 'Password'}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPasswordValue(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                autoFocus={mode === 'recovery'}
                minLength={mode === 'signin' ? undefined : MIN_PASSWORD}
                placeholder={mode === 'signin' ? undefined : `At least ${MIN_PASSWORD} characters`}
                required
              />
            </label>
          )}

          {mode === 'recovery' && (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          {mode === 'signup' && (
            <p className="auth-fine">
              By creating an account you agree to the <a href="/legal.html#terms">Terms</a> and{' '}
              <a href="/legal.html#privacy">Privacy Policy</a>.
            </p>
          )}

          <Button variant="primary" type="submit" disabled={busy} className="auth-submit">
            {busy
              ? 'One moment…'
              : { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recovery: 'Set password' }[
                  mode
                ]}
          </Button>

          {mode === 'signin' && (
            <div className="auth-links">
              <button type="button" onClick={() => go('forgot')}>
                Forgot password?
              </button>
              <button type="button" onClick={() => go('signup')}>
                Create an account
              </button>
            </div>
          )}
          {(mode === 'signup' || mode === 'forgot') && (
            <div className="auth-links">
              <button type="button" onClick={() => go('signin')}>
                {mode === 'signup' ? 'Have an account? Sign in' : 'Back to sign in'}
              </button>
            </div>
          )}
        </form>
      )}
    </GlassPage>
  );
}
