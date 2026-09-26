import { useEffect, useState } from 'react';
import { deleteMyAccount, ownedSummary } from '../persist/sharing';
import { useStore } from '../store/store';
import { Button } from './Button';

/**
 * Deleting an account is permanent, so it takes a deliberate act: say plainly
 * what will be lost, and require the account's email to be typed to confirm.
 */
export function DeleteAccountModal({ onClose }: { onClose(): void }) {
  const email = useStore((s) => s.account?.email ?? '');
  const signOut = useStore((s) => s.signOut);
  const notify = useStore((s) => s.notify);

  const [typed, setTyped] = useState('');
  const [summary, setSummary] = useState<{ owned: number; shared: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ownedSummary().then(setSummary).catch(() => setSummary({ owned: 0, shared: 0 }));
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  async function confirmDelete() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    const err = await deleteMyAccount();
    if (err) {
      setBusy(false);
      setError(err);
      return;
    }
    await signOut();
    notify('Your account has been deleted.');
  }

  return (
    <>
      <div className="modal-scrim" onPointerDown={onClose} />
      <div className="modal delete-modal" role="alertdialog" aria-label="Delete account">
        <header>
          <h3>Delete your account?</h3>
          <Button variant="ghost" size="sm" icon onClick={onClose} title="Cancel (Esc)">
            ✕
          </Button>
        </header>
        <div className="modal-body">
          <p className="delete-warning">This cannot be undone. Deleting your account permanently removes:</p>
          <ul className="delete-list">
            <li>your profile and sign-in</li>
            <li>
              {summary === null
                ? 'the schedules you own'
                : summary.owned === 0
                  ? 'the schedules you own (you have none)'
                  : `the ${summary.owned} schedule${summary.owned === 1 ? '' : 's'} you own`}
              {summary && summary.shared > 0 && (
                <strong>
                  {' '}
                  — {summary.shared} of them shared with others, who will lose access
                </strong>
              )}
            </li>
            <li>your access to schedules others shared with you</li>
          </ul>
          <p className="auth-note delete-notice">
            Any active subscription will be terminated effective immediately upon deletion; no further charges will
            accrue, and fees paid for the current billing period are non-refundable.
          </p>

          <label className="auth-field">
            <span>Type your email to confirm</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={email}
              autoComplete="off"
              autoFocus
            />
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <div className="delete-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!matches || busy} onClick={() => void confirmDelete()}>
              {busy ? 'Deleting…' : 'Delete account'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
