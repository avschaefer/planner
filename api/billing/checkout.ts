import { BLOCKS_CHECKOUT, checkoutTrialEnd, priceFor } from '../_billing.js';
import { ensureCustomer, stripe } from '../_stripe.js';
import { admin, json, requireUser } from '../_supabase.js';

/**
 * POST { interval: 'monthly' | 'annual' } → { url } of a Stripe Checkout page.
 *
 * The browser names an interval, never a price: the price id comes from the
 * environment. Nothing here grants access — that happens only when Stripe's
 * signed webhook reports the subscription (webhook.ts). The success URL just
 * brings the person back to wait for it.
 */
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const user = await requireUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);

  let interval: unknown;
  try {
    interval = ((await request.json()) as { interval?: unknown }).interval;
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }
  if (interval !== 'monthly' && interval !== 'annual') return json({ error: 'interval must be monthly or annual.' }, 400);
  const price = priceFor(interval);
  if (!price) return json({ error: 'Billing is not configured.' }, 500);

  try {
    const db = admin();
    const { data: profile, error } = await db
      .from('profiles')
      .select('trial_ends_at, stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (error || !profile) return json({ error: 'No profile for this account.' }, 404);

    const customer = await ensureCustomer(db, user, profile.stripe_customer_id as string | null);

    // Asked of Stripe, not the profile: the webhook for a checkout finished
    // seconds ago may not have landed yet, and a second subscription is
    // exactly what this must not create.
    const existing = await stripe().subscriptions.list({ customer, status: 'all', limit: 20 });
    if (existing.data.some((s) => BLOCKS_CHECKOUT.includes(s.status))) {
      return json({ error: 'You already have a subscription — manage it from your account.', portal: true }, 409);
    }

    const origin = new URL(request.url).origin;
    const trialEnd = checkoutTrialEnd(new Date(profile.trial_ends_at as string), new Date());
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        metadata: { user_id: user.id },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
      // A card is always taken, trial or not, so the first charge just happens.
      payment_method_collection: 'always',
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancel`,
    });
    if (!session.url) return json({ error: 'Stripe returned no checkout URL.' }, 502);
    return json({ url: session.url });
  } catch (e) {
    console.error('checkout', e);
    return json({ error: 'Could not start checkout. Try again in a moment.' }, 500);
  }
}

/* Web-standard fetch handler; a bare default function would be read as the
   legacy (req, res) Node signature. */
export default { fetch: handler };
