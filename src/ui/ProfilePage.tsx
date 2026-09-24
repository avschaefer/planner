import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD, setPassword, updateDisplayName } from '../persist/auth';
import { useStore } from '../store/store';
import { Button } from './Button';
import { GlassPage } from './GlassPage';
import * as Icon from './icons';

/**
 * The account, and only what a person needs from it: their name, their email,
 * their plan, their password, and a way out. The plan is shown but not
 * editable — it is written by the server when billing exists.
 *
 * Two columns in one wide card, so the whole page fits without scrolling.
 */
export function ProfilePage() {
  const account = useStore((s) => s.account)!;
  const setAccount = useStore((s) => s.setAccount);
  const closeProfile = useStore((s) => s.closeProfile);
  const signOut = useStore((s) => s.signOut);
  const notify = useStore((s) => s.notify);

  const [name, setName] = useState(account.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    const err = await updateDisplayName(account.id, name);
    setSavingName(false);
    if (err) setError(err);
    else {
      setError(null);
      setAccount({ ...account, displayName: name.trim() || null });
      notify('Name saved.');
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSavingPassword(true);
    const err = await setPassword(password);
    setSavingPassword(false);
    if (err) setError(err);
    else {
      setError(null);
      setPasswordValue('');
      setConfirm('');
      notify('Password updated.');
    }
  }

  return (
    <GlassPage wide hero={false}>
      <header className="account-head">
        <Button variant="ghost" size="sm" onClick={closeProfile} title="Back to schedules">
          <Icon.Back /> Schedules
        </Button>
        <h1 className="account-title">Account</h1>
        <Button variant="secondary" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      <div className="account-grid">
        <form className="auth-form" onSubmit={(e) => void saveName(e)}>
          <h3>Profile</h3>
          <label className="auth-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <div className="account-facts">
            <div className="auth-field">
              <span>Email</span>
              <div className="auth-readonly">{account.email}</div>
            </div>
            <div className="auth-field">
              <span>Plan</span>
              <div className="auth-readonly">{account.plan === 'free' ? 'Free' : account.plan}</div>
            </div>
          </div>
          <Button
            variant="secondary"
            type="submit"
            disabled={savingName || name.trim() === (account.displayName ?? '')}
          >
            {savingName ? 'Saving…' : 'Save name'}
          </Button>
        </form>

        <form className="auth-form" onSubmit={(e) => void savePassword(e)}>
          <h3>Change password</h3>
          <label className="auth-field">
            <span>New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              placeholder={`At least ${MIN_PASSWORD} characters`}
            />
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <Button variant="secondary" type="submit" disabled={savingPassword || !password}>
            {savingPassword ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </div>

      {error && (
        <p className="auth-error account-error" role="alert">
          {error}
        </p>
      )}
    </GlassPage>
  );
}
