import { stripe } from '../_stripe.js';
import { admin, json, requireUser } from '../_supabase.js';

/**
 * POST → { url } of the Stripe Customer Portal, where a subscriber updates
 * their card, switches between monthly and annual, or cancels. Only for
 * accounts that already have a Stripe customer. Changes made there reach the
 * app through the webhook, like everything else.
 */
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const user = await requireUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);

  try {
    const { data: profile } = await admin()
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    const customer = profile?.stripe_customer_id as string | null | undefined;
    if (!customer) return json({ error: 'No subscription to manage yet.' }, 404);

    const session = await stripe().billingPortal.sessions.create({
      customer,
      return_url: `${new URL(request.url).origin}/?billing=portal`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error('portal', e);
    return json({ error: 'Could not open billing. Try again in a moment.' }, 500);
  }
}

export default { fetch: handler };
