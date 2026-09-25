import { cancelEverything } from '../_stripe.js';
import { admin, json, requireUser } from '../_supabase.js';

/**
 * POST → deletes the caller's account, after cancelling any subscription.
 *
 * Order matters: Stripe first, then the account. If Stripe can't be reached
 * the account stays, so nobody is ever left deleted but still billed; trying
 * again is safe (cancelled subscriptions are skipped). Cancellation is
 * immediate and unprorated, per the Terms. Deleting the auth user cascades
 * through profile, memberships and owned schedules (0002, 0004), the same as
 * delete_my_account — which now refuses while a subscription is live, so this
 * is the only way out for a subscriber.
 */
export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const user = await requireUser(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const db = admin();
  const { data: profile, error: readError } = await db
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();
  if (readError) {
    console.error('account/delete read', readError);
    return json({ error: 'Could not delete your account. Try again in a moment.' }, 500);
  }

  const customer = profile?.stripe_customer_id as string | null | undefined;
  if (customer) {
    try {
      await cancelEverything(customer);
    } catch (e) {
      console.error('account/delete stripe', e);
      return json({ error: "Couldn't cancel your subscription, so your account was kept. Try again in a moment." }, 502);
    }
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('account/delete auth', error);
    return json(
      {
        error: customer
          ? 'Your subscription is cancelled, but the account could not be deleted. Try again in a moment.'
          : 'Could not delete your account. Try again in a moment.',
      },
      500,
    );
  }
  return json({ deleted: true });
}

export default { fetch: handler };
