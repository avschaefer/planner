import Stripe from 'stripe';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { billingColumns, cancellableSubscriptionIds, pickSubscription } from './_billing.js';

/**
 * Stripe, server-side. The secret key and the webhook secret are read here
 * and nowhere else; neither is ever a VITE_ variable.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is required.');
    // The API version is the one this SDK release is pinned to.
    client = new Stripe(key, { appInfo: { name: 'Marga' } });
  }
  return client;
}

/**
 * The caller's Stripe customer, created on first use. One per user: the id
 * is stored on their profile, and creation is guarded twice — a Stripe
 * idempotency key (a double click creates one customer, not two) and a
 * conditional write (a lost race adopts the stored id).
 */
export async function ensureCustomer(db: SupabaseClient, user: User, existing: string | null): Promise<string> {
  if (existing) return existing;

  const customer = await stripe().customers.create(
    { email: user.email, metadata: { user_id: user.id } },
    { idempotencyKey: `customer-for-${user.id}` },
  );
  const { data, error } = await db
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id');
  if (error) throw new Error(error.message);
  if (data && data.length > 0) return customer.id;

  const { data: row } = await db.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
  return (row?.stripe_customer_id as string | null) ?? customer.id;
}

export type SyncResult = { ok: true; userId: string } | { ok: false; reason: string };

/**
 * Bring one customer's profile up to date with Stripe.
 *
 * Every handled event lands here, and here reads the customer's current state
 * from Stripe rather than trusting the event's payload. That makes it
 * idempotent (running it twice writes the same thing) and indifferent to
 * delivery order (an old event re-reads today's state). The one remaining
 * race — two deliveries whose reads interleave — is closed by stamping each
 * write with when its read began and refusing a write older than the last.
 */
export async function syncCustomer(db: SupabaseClient, customerId: string): Promise<SyncResult> {
  const readAt = new Date().toISOString();
  const subs = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  const columns = billingColumns(pickSubscription(subs.data));

  let { data: profile } = await db
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!profile) {
    // Not linked yet (ensureCustomer's write can trail the first events):
    // the customer's metadata names the user it was created for.
    const customer = await stripe().customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.account_deleted_at) {
      return { ok: false, reason: `customer ${customerId} belongs to a deleted account` };
    }
    const userId = customer.deleted ? undefined : customer.metadata?.user_id;
    if (!userId) return { ok: false, reason: `customer ${customerId} has no user_id` };
    const linked = await db
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', userId)
      .is('stripe_customer_id', null)
      .select('id');
    if (linked.error) throw new Error(linked.error.message);
    if (!linked.data?.length) return { ok: false, reason: `user ${userId} is linked to another customer` };
    profile = linked.data[0]!;
  }

  const { error } = await db
    .from('profiles')
    .update({ ...columns, billing_synced_at: readAt })
    .eq('id', profile.id)
    .eq('stripe_customer_id', customerId)
    .or(`billing_synced_at.is.null,billing_synced_at.lt."${readAt}"`);
  if (error) throw new Error(error.message);
  return { ok: true, userId: profile.id as string };
}

/**
 * Stop every charge a customer could still incur: cancel each subscription
 * that isn't already finished, immediately, and mark the customer as
 * belonging to a deleted account so later webhook events are recognised.
 * Throws if Stripe can't be reached, so the caller keeps the account.
 */
export async function cancelEverything(customerId: string): Promise<string[]> {
  const subs = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  const ids = cancellableSubscriptionIds(subs.data);
  for (const id of ids) await stripe().subscriptions.cancel(id, { invoice_now: false, prorate: false });
  await stripe().customers.update(customerId, { metadata: { account_deleted_at: new Date().toISOString() } });
  return ids;
}
