import { useState, type FormEvent } from 'react';
import { changeEmail, MIN_PASSWORD, setPassword, updateDisplayName } from '../persist/auth';
import { useStore } from '../store/store';
import { BillingSection } from './BillingSection';
import { Button } from './Button';
import { DeleteAccountModal } from './DeleteAccountModal';
import { GlassPage } from './GlassPage';
import * as Icon from './icons';

/**
 * The account, and only what a person needs from it: name, email, password,
 * the subscription, and a way out. Billing status is read-only here — it is
 * written by the Stripe webhook — and changed only on Stripe's own pages.
 * Reachable while locked out, so a lapsed account can always subscribe,
 * sign out, or delete itself.
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
  const [email, setEmail] = useState(account.email);
  const [saving, setSaving] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const nameChanged = name.trim() !== (account.displayName ?? '');
  const emailChanged = email.trim().toLowerCase() !== account.email.toLowerCase();

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    if (nameChanged) {
      const err = await updateDisplayName(account.id, name);
      if (err) {
        setError(err);
        setSaving(false);
        return;
      }
      setAccount({ ...account, displayName: name.trim() || null });
    }
    if (emailChanged) {
      const err = await changeEmail(email);
      if (err) setError(err);
      else {
        // The address only changes once the link is followed; until then the
        // field goes back to the address that still works.
        setEmail(account.email);
        notify(`Confirmation sent — follow the links in both inboxes to switch to ${email.trim()}.`);
      }
    } else if (nameChanged) {
      notify('Saved.');
    }
    setSaving(false);
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
        <form className="auth-form" onSubmit={(e) => void saveProfile(e)}>
          <h3>Profile</h3>
          <label className="auth-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="auth-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <Button variant="secondary" type="submit" disabled={saving || !(nameChanged || emailChanged)}>
            {saving ? 'Saving…' : 'Save changes'}
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

      <BillingSection />

      {error && (
        <p className="auth-error account-error" role="alert">
          {error}
        </p>
      )}

      <footer className="account-foot">
        <span>Deleting your account removes your schedules for good.</span>
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          Delete account
        </Button>
      </footer>

      {deleting && <DeleteAccountModal onClose={() => setDeleting(false)} />}
    </GlassPage>
  );
}
