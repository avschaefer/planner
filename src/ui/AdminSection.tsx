import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { loadCompAccounts, setComp, type CompAccount } from '../persist/admin';
import { isLive } from '../persist/access';
import { Button } from './Button';

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const active = (a: CompAccount) => a.comp_until === 'infinity' || new Date(a.comp_until).getTime() > Date.now();

/**
 * The admin's row on the account page: who has complimentary access, and a
 * dialog to grant or revoke it. Draws nothing for anyone else. The server
 * decides who the admin is (ADMIN_EMAIL) and refuses everyone else, so
 * hiding this is presentation, not the protection.
 */
export function AdminSection() {
  const [accounts, setAccounts] = useState<CompAccount[] | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => setAccounts(await loadCompAccounts()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (accounts === null) return null;
  const current = accounts.filter(active).length;

  return (
    <section className="account-billing account-admin">
      <div className="billing-status">
        <h3>Admin</h3>
        <div className="billing-state">
          <b>Complimentary access</b>
          <span>
            {current === 0 ? 'No one has free access.' : `${current} ${current === 1 ? 'account has' : 'accounts have'} free access.`}
          </span>
        </div>
      </div>
      <div className="billing-actions">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Manage free accounts
        </Button>
      </div>
      {open && <CompModal accounts={accounts} refresh={refresh} onClose={() => setOpen(false)} />}
    </section>
  );
}

function CompModal({
  accounts,
  refresh,
  onClose,
}: {
  accounts: CompAccount[];
  refresh(): Promise<void>;
  onClose(): void;
}) {
  const [email, setEmail] = useState('');
  const [forever, setForever] = useState(true);
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function grant(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await setComp(email.trim(), forever ? 'forever' : until);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setEmail('');
    await refresh();
  }

  async function revoke(a: CompAccount) {
    setError(null);
    const err = await setComp(a.email, null);
    if (err) setError(err);
    await refresh();
  }

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <div className="modal-scrim" onPointerDown={onClose} />
      <div className="modal share-modal" role="dialog" aria-label="Free accounts">
        <header>
          <h3>Free accounts</h3>
          <Button variant="ghost" size="sm" icon onClick={onClose} title="Close (Esc)">
            ✕
          </Button>
        </header>

        <div className="modal-body">
          <p className="share-note">
            Full access with no subscription. The account must exist first — they sign up, then you add them here.
          </p>
          <form className="comp-grant" onSubmit={(e) => void grant(e)}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email of a Marga account"
              autoComplete="off"
              autoFocus
              aria-label="Email"
            />
            <div className="comp-when">
              <div className="seg" role="group" aria-label="How long">
                <Button variant="secondary" size="sm" active={forever} onClick={() => setForever(true)}>
                  Forever
                </Button>
                <Button variant="secondary" size="sm" active={!forever} onClick={() => setForever(false)}>
                  Until…
                </Button>
              </div>
              {!forever && (
                <input
                  type="date"
                  value={until}
                  min={tomorrow}
                  onChange={(e) => setUntil(e.target.value)}
                  aria-label="Free until"
                  required
                />
              )}
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !email.trim() || (!forever && !until)}
              >
                {busy ? 'Saving…' : 'Grant'}
              </Button>
            </div>
          </form>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <ul className="share-people">
            {accounts.map((a) => (
              <li key={a.user_id}>
                <span className="who">
                  <b>{a.display_name || a.email}</b>
                  <em>
                    {a.display_name ? `${a.email} · ` : ''}
                    {a.comp_until === 'infinity'
                      ? 'Forever'
                      : active(a)
                        ? `Until ${date(a.comp_until)}`
                        : `Ended ${date(a.comp_until)}`}
                  </em>
                  {isLive(a.subscription_status) && (
                    <em className="comp-warn">Also has a paid subscription. Cancel it in Stripe to stop charges.</em>
                  )}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void revoke(a)} title="Remove free access">
                  {active(a) ? 'Revoke' : 'Clear'}
                </Button>
              </li>
            ))}
            {accounts.length === 0 && <li className="share-note">No free accounts yet.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
