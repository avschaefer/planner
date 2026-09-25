/**
 * Who may use the app, as a pure function of the billing columns on their
 * profile. The database decides for real (private.has_access, migrations
 * 0006 and 0007); this is the same rule, for drawing the right screen and for the
 * webhook to pick which subscription counts. Imported by api/ as well as the
 * browser, so it imports nothing.
 *
 *   trial    — within 30 days of account creation, no live subscription
 *   active   — a subscription Stripe still considers live (past_due included:
 *              access holds while Stripe retries the card)
 *   comp     — complimentary access granted by the admin (comp_until), with no
 *              live subscription; forever or until a date
 *   expired  — neither; the app is locked, the data is kept
 */

export type Plan = 'monthly' | 'annual';

/** Subscription statuses that grant access. Must match private.has_access(). */
export const LIVE_STATUSES = ['active', 'trialing', 'past_due'] as const;

export function isLive(status: string | null | undefined): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(status ?? '');
}

/** What the prices are, for display. The charge comes from the Stripe price IDs. */
export const PRICES: Record<Plan, { amount: string; per: string }> = {
  monthly: { amount: '$2', per: 'month' },
  annual: { amount: '$12', per: 'year' },
};

/** The billing columns of a profile, as the browser reads them. */
export interface Billing {
  trialEndsAt: string;
  status: string | null;
  plan: Plan | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Has a Stripe customer, so the Customer Portal has something to show. */
  hasCustomer: boolean;
  /** Complimentary access until this moment; 'infinity' for no end; null for none. */
  compUntil: string | null;
}

export type BillingState =
  | { kind: 'trial'; daysLeft: number; endsAt: string }
  | {
      kind: 'active';
      plan: Plan | null;
      /** Next renewal, or the last day of access when cancelling. */
      periodEnd: string | null;
      cancelling: boolean;
      /** Stripe is retrying a failed payment; access holds meanwhile. */
      pastDue: boolean;
      /** Subscribed during the app trial: the first charge is at periodEnd. */
      firstChargePending: boolean;
    }
  /** Complimentary. `until` is null when it has no end. */
  | { kind: 'comp'; until: string | null }
  | { kind: 'expired'; hadSubscription: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

export function billingState(b: Billing, now: Date = new Date()): BillingState {
  if (isLive(b.status)) {
    return {
      kind: 'active',
      plan: b.plan,
      periodEnd: b.currentPeriodEnd,
      cancelling: b.cancelAtPeriodEnd,
      pastDue: b.status === 'past_due',
      firstChargePending: b.status === 'trialing',
    };
  }
  // A live subscription wins over comp, so someone who is also paying still
  // sees it and can cancel it.
  if (b.compUntil === 'infinity') return { kind: 'comp', until: null };
  if (b.compUntil && new Date(b.compUntil).getTime() > now.getTime()) return { kind: 'comp', until: b.compUntil };
  const left = new Date(b.trialEndsAt).getTime() - now.getTime();
  if (left > 0) return { kind: 'trial', daysLeft: Math.ceil(left / DAY_MS), endsAt: b.trialEndsAt };
  return { kind: 'expired', hadSubscription: b.status !== null };
}

export function hasAccess(b: Billing, now: Date = new Date()): boolean {
  return billingState(b, now).kind !== 'expired';
}
