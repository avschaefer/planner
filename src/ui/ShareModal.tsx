import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listPeople, removePerson, setRole, shareWith, type Person, type ShareRole } from '../persist/sharing';
import { useStore } from '../store/store';
import { Button } from './Button';

/**
 * Share a schedule with other accounts, by email, as an editor or a viewer.
 * Two people who use it at different times both get real editing control;
 * the editor lock (one editor at a time) already covers the rest.
 *
 * Only the owner changes access. Everyone else sees who is on the schedule.
 */
export function ShareModal({ projectId, onClose }: { projectId: string; onClose(): void }) {
  const me = useStore((s) => s.account?.id);
  const myRole = useStore((s) => s.role);
  const isOwner = myRole === 'owner';

  const [people, setPeople] = useState<Person[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setNewRole] = useState<ShareRole>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listPeople(projectId);
    if (result.error) setError(result.error);
    else setPeople(result.people);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await shareWith(projectId, email, role);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setEmail('');
    await refresh();
  }

  async function change(person: Person, next: ShareRole) {
    setError(null);
    const err = await setRole(projectId, person.userId, next);
    if (err) setError(err);
    await refresh();
  }

  async function remove(person: Person) {
    setError(null);
    const err = await removePerson(projectId, person.userId);
    if (err) setError(err);
    await refresh();
  }

  return (
    <>
      <div className="modal-scrim" onPointerDown={onClose} />
      <div className="modal share-modal" role="dialog" aria-label="Share schedule">
        <header>
          <h3>Share</h3>
          <Button variant="ghost" size="sm" icon onClick={onClose} title="Close (Esc)">
            ✕
          </Button>
        </header>

        <div className="modal-body">
          {isOwner ? (
            <form className="share-invite" onSubmit={(e) => void invite(e)}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email of a Marga account"
                autoComplete="off"
                autoFocus
                aria-label="Email"
              />
              <RoleToggle value={role} onChange={setNewRole} />
              <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sharing…' : 'Share'}
              </Button>
            </form>
          ) : (
            <p className="share-note">Only the owner can change who has access.</p>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <ul className="share-people">
            {(people ?? []).map((p) => (
              <li key={p.userId}>
                <span className="who">
                  <b>{p.displayName || p.email}</b>
                  {p.displayName && <em>{p.email}</em>}
                </span>
                {p.role === 'owner' ? (
                  <span className="role-fixed">Owner</span>
                ) : isOwner ? (
                  <>
                    <RoleToggle value={p.role} onChange={(next) => void change(p, next)} compact />
                    <Button variant="ghost" size="sm" onClick={() => void remove(p)} title="Remove access">
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="role-fixed">{p.role === 'editor' ? 'Can edit' : 'View only'}</span>
                )}
                {p.userId === me && p.role !== 'owner' && !isOwner && <span className="you">you</span>}
              </li>
            ))}
            {people === null && !error && <li className="share-note">Loading…</li>}
          </ul>
        </div>
      </div>
    </>
  );
}

/** Can edit / View only — the one switch that matters when sharing. */
function RoleToggle({
  value,
  onChange,
  compact = false,
}: {
  value: ShareRole;
  onChange(next: ShareRole): void;
  compact?: boolean;
}) {
  return (
    <div className={`seg role-toggle${compact ? ' compact' : ''}`} role="group" aria-label="Access">
      <Button variant="secondary" size="sm" active={value === 'editor'} onClick={() => onChange('editor')}>
        Can edit
      </Button>
      <Button variant="secondary" size="sm" active={value === 'viewer'} onClick={() => onChange('viewer')}>
        View only
      </Button>
    </div>
  );
}
