import { useEffect, useState } from 'react';
import { billingState, PRICES, type BillingState, type Plan } from '../persist/access';
import { openPortal, startCheckout } from '../persist/billing';
import { useStore } from '../store/store';
import { Button } from './Button';

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * Monthly and annual, each opening Stripe Checkout. Annual is the primary
 * button — it is the one offered first and it costs half as much a year.
 */
export function UpgradeButtons({ stacked = false }: { stacked?: boolean }) {
  const [busy, setBusy] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(plan: Plan) {
    setBusy(plan);
    setError(null);
    try {
      await startCheckout(plan); // navigates away on success
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className={`billing-upgrade${stacked ? ' stacked' : ''}`}>
      <Button variant="primary" disabled={busy !== null} onClick={() => void go('annual')}>
        {busy === 'annual' ? 'Opening checkout…' : `Annual — ${PRICES.annual.amount}/${PRICES.annual.per}`}
        {busy !== 'annual' && <span className="billing-save">Save 50%</span>}
      </Button>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void go('monthly')}>
        {busy === 'monthly' ? 'Opening checkout…' : `Monthly — ${PRICES.monthly.amount}/${PRICES.monthly.per}`}
      </Button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function describe(state: BillingState): { label: string; detail: string } {
  switch (state.kind) {
    case 'trial':
      return {
        label: `Free trial — ${state.daysLeft} ${state.daysLeft === 1 ? 'day' : 'days'} left`,
        detail: `Full access until ${day(state.endsAt)}. No card needed until then.`,
      };
    case 'active': {
      const plan = state.plan ? `${state.plan === 'annual' ? 'Annual' : 'Monthly'} — ${PRICES[state.plan].amount}/${PRICES[state.plan].per}` : 'Subscribed';
      if (state.pastDue) return { label: plan, detail: 'Your last payment failed. Stripe will retry — update your card to keep access.' };
      if (state.cancelling) return { label: plan, detail: `Cancelled. Access until ${day(state.periodEnd)}.` };
      if (state.firstChargePending) return { label: plan, detail: `Your trial runs to the end; first charge on ${day(state.periodEnd)}.` };
      return { label: plan, detail: state.periodEnd ? `Renews ${day(state.periodEnd)}.` : 'Active.' };
    }
    case 'expired':
      return {
        label: state.hadSubscription ? 'Subscription ended' : 'Trial ended',
        detail: 'Your schedules are kept. Subscribe to open them again.',
      };
  }
}

/**
 * Status, upgrade and manage, for the account page. Arriving back from
 * Checkout, it re-reads the account until the webhook has recorded the
 * subscription — the redirect itself proves nothing and grants nothing.
 */
export function BillingSection() {
  const account = useStore((s) => s.account)!;
  const back = useStore((s) => s.billingReturn);
  const refreshAccount = useStore((s) => s.refreshAccount);
  const clearBillingReturn = useStore((s) => s.clearBillingReturn);
  const notify = useStore((s) => s.notify);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const billing = account.billing;
  const state = billing ? billingState(billing) : null;
  const waiting = back === 'success' && state?.kind !== 'active';

  useEffect(() => {
    if (!back) return;
    if (back === 'cancel') {
      clearBillingReturn();
      return;
    }
    if (back === 'success' && state?.kind === 'active') {
      clearBillingReturn();
      notify('Subscribed — thank you.');
      return;
    }
    // Success: wait for the webhook (usually a second or two). Portal: pick
    // up whatever changed there.
    let tries = back === 'success' ? 30 : 3;
    const timer = setInterval(() => {
      void refreshAccount();
      if (--tries <= 0) {
        clearInterval(timer);
        clearBillingReturn();
        if (back === 'success') notify('Payment received — it can take a minute to show here. Refresh shortly.');
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [back, state?.kind, refreshAccount, clearBillingReturn, notify]);

  async function manage() {
    setPortalBusy(true);
    setError(null);
    try {
      await openPortal();
    } catch (e) {
      setError((e as Error).message);
      setPortalBusy(false);
    }
  }

  if (!billing || !state) {
    return (
      <section className="account-billing">
        <h3>Subscription</h3>
        <p className="auth-note">Could not read your subscription. Reload the page to try again.</p>
      </section>
    );
  }

  const { label, detail } = waiting
    ? { label: 'Confirming your subscription…', detail: 'Stripe has your payment; this takes a moment.' }
    : describe(state);

  return (
    <section className="account-billing">
      <div className="billing-status">
        <h3>Subscription</h3>
        <div className={`billing-state ${state.kind}`} data-testid="billing-state">
          <b>{label}</b>
          <span className={state.kind === 'active' && state.pastDue ? 'warn' : undefined}>{detail}</span>
        </div>
      </div>
      <div className="billing-actions">
        {state.kind !== 'active' && !waiting && <UpgradeButtons />}
        {billing.hasCustomer && (
          <Button
            variant={state.kind === 'active' && state.pastDue ? 'primary' : 'ghost'}
            size="sm"
            disabled={portalBusy}
            onClick={() => void manage()}
          >
            {portalBusy ? 'Opening…' : 'Manage subscription'}
          </Button>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
