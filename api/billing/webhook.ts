import { customerOf, HANDLED_EVENTS } from '../_billing.js';
import { stripe, syncCustomer } from '../_stripe.js';
import { admin, json } from '../_supabase.js';

/**
 * Stripe → Marga. The only way billing state changes.
 *
 * 1. Verify the signature over the raw body (STRIPE_WEBHOOK_SECRET). Anything
 *    unsigned or tampered with is refused before it is parsed.
 * 2. Skip an event already processed (public.stripe_events).
 * 3. Re-read the customer's subscriptions from Stripe and write the one in
 *    effect to their profile (syncCustomer) — idempotent and order-proof.
 * 4. Record the event. A failure before this answers 500, so Stripe retries.
 */
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook is not configured.' }, 500);
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing signature.' }, 400);

  const body = await request.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return json({ error: 'Bad signature.' }, 400);
  }

  if (!HANDLED_EVENTS.has(event.type)) return json({ received: true, ignored: event.type });

  try {
    const db = admin();
    const seen = await db.from('stripe_events').select('id').eq('id', event.id).maybeSingle();
    if (seen.data) return json({ received: true, duplicate: true });

    const customer = customerOf(event.data.object);
    if (customer) {
      const result = await syncCustomer(db, customer);
      // Not retryable (a customer made outside the app): note it and move on.
      if (!result.ok) console.warn('webhook', event.id, event.type, result.reason);
    }

    const { error } = await db
      .from('stripe_events')
      .upsert({ id: event.id, type: event.type }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return json({ received: true });
  } catch (e) {
    console.error('webhook', event.id, event.type, e);
    return json({ error: 'Processing failed; Stripe will retry.' }, 500);
  }
}

export default { fetch: handler };
