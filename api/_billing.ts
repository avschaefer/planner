import { LIVE_STATUSES, type Plan } from '../src/persist/access.js';

/**
 * The billing rules that need no network: which of a customer's
 * subscriptions counts, what it writes to the profile, and when a checkout
 * may carry the rest of the app trial. Pure, so they are unit tested
 * (_billing.test.ts); _stripe.ts does the I/O around them.
 */

/** The fields of a Stripe subscription these rules read. */
export interface SubscriptionLike {
  id: string;
  status: string;
  created: number;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  items: {
    data: Array<{ current_period_end: number; price: { recurring: { interval: string } | null } }>;
  };
}

/** The billing columns the webhook owns on public.profiles. */
export interface BillingColumns {
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  plan: Plan | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function rank(status: string): number {
  if (status === 'active' || status === 'trialing') return 3;
  if (status === 'past_due') return 2;
  return 1;
}

/**
 * One customer should have at most one subscription, but a customer's history
 * holds every subscription it ever had. The one in effect is the most live,
 * and among equals the newest — so an old canceled subscription never
 * overrides a new active one, whatever order their events arrive in.
 */
export function pickSubscription<T extends SubscriptionLike>(subs: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of subs) {
    if (!best || rank(s.status) > rank(best.status) || (rank(s.status) === rank(best.status) && s.created > best.created)) {
      best = s;
    }
  }
  return best;
}

export function planFromInterval(interval: string | undefined): Plan | null {
  if (interval === 'month') return 'monthly';
  if (interval === 'year') return 'annual';
  return null;
}

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

export function billingColumns(sub: SubscriptionLike | null): BillingColumns {
  if (!sub) {
    return { stripe_subscription_id: null, subscription_status: null, plan: null, current_period_end: null, cancel_at_period_end: false };
  }
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ?? null;
  // The Portal may cancel by setting cancel_at rather than the flag; either
  // way access ends at whichever comes first.
  const end = sub.cancel_at && periodEnd ? Math.min(sub.cancel_at, periodEnd) : (sub.cancel_at ?? periodEnd);
  return {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    plan: planFromInterval(item?.price.recurring?.interval),
    current_period_end: iso(end),
    cancel_at_period_end: sub.cancel_at_period_end || sub.cancel_at !== null,
  };
}

/** Statuses that block a second checkout: the customer should use the Portal. */
export const BLOCKS_CHECKOUT: readonly string[] = LIVE_STATUSES;

/**
 * Subscribing during the app trial keeps the days left: Stripe starts its own
 * trial ending when ours does, so the first charge lands then. Stripe refuses
 * a trial_end under 48 hours out; inside that window, charge now. Unix seconds.
 */
export function checkoutTrialEnd(trialEndsAt: Date, now: Date): number | undefined {
  const MIN_MS = 49 * 60 * 60 * 1000; // an hour of margin over Stripe's 48
  return trialEndsAt.getTime() - now.getTime() > MIN_MS ? Math.floor(trialEndsAt.getTime() / 1000) : undefined;
}

/** The Stripe price for an interval, from the environment. Never from the client. */
export function priceFor(interval: unknown, env: Record<string, string | undefined> = process.env): string | null {
  if (interval === 'monthly') return env.STRIPE_PRICE_MONTHLY || null;
  if (interval === 'annual') return env.STRIPE_PRICE_ANNUAL || null;
  return null;
}

/** Events that can change what a customer is entitled to. Everything else is acknowledged and ignored. */
export const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
]);

/** The customer an event is about. Every handled event's object carries one. */
export function customerOf(object: unknown): string | null {
  const customer = (object as { customer?: unknown } | null)?.customer;
  if (typeof customer === 'string') return customer;
  if (customer && typeof customer === 'object' && typeof (customer as { id?: unknown }).id === 'string') {
    return (customer as { id: string }).id;
  }
  return null;
}
