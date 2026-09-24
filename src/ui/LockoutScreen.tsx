import { billingState } from '../persist/access';
import { useStore } from '../store/store';
import { UpgradeButtons } from './BillingSection';
import { AccountButton, GlassPage } from './GlassPage';

/**
 * What an account with no trial and no subscription sees instead of its
 * schedules. The database is what actually refuses them (migration 0006);
 * this screen says why and offers the way back. Nothing is deleted — the
 * account page and sign-out stay reachable.
 */
export function LockoutScreen() {
  const account = useStore((s) => s.account)!;
  const openProfile = useStore((s) => s.openProfile);
  const signOut = useStore((s) => s.signOut);
  const state = account.billing ? billingState(account.billing) : null;
  const lapsed = state?.kind === 'expired' && state.hadSubscription;

  return (
    <GlassPage narrow action={<AccountButton />}>
      <h2 className="auth-title">{lapsed ? 'Your subscription has ended' : 'Your free trial has ended'}</h2>
      <div className="auth-form">
        <p className="auth-note">
          Your schedules are safe and exactly as you left them. Subscribe to pick up where you left off.
        </p>
        <UpgradeButtons stacked />
        <div className="auth-links">
          <button type="button" onClick={openProfile}>
            Account and billing
          </button>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </GlassPage>
  );
}
