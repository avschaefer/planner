import type { AuthChangeEvent } from '@supabase/supabase-js';
import type { Billing, Plan } from './access';
import { isShared, supabase } from './supabaseRepo';

/**
 * Accounts, on Supabase Auth.
 *
 * Email and password. The session is kept in the browser and refreshed
 * silently, so people sign in once per device rather than fetching an email
 * code every visit; email is used only to confirm an address and to reset a
 * forgotten password. Each account is one person — there is no shared secret
 * to pass around, and what a person can reach is decided in the database
 * (row-level security), not here.
 */

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  /**
   * Trial and subscription, written only by the Stripe webhook (the database
   * refuses the browser). Null when it could not be read — including before
   * migration 0006 exists. The app then draws no lockout: the database is
   * the gate, and it lets through exactly who it should either way.
   */
  billing: Billing | null;
}

export const MIN_PASSWORD = 8;

/** Supabase's messages, in the product's voice. Unknown errors pass through. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match.";
  if (/email not confirmed/i.test(message)) return 'Confirm your email first — the link is in your inbox.';
  if (/already registered|already exists/i.test(message)) return 'An account with that email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/password should be at least/i.test(message)) return `Use at least ${MIN_PASSWORD} characters.`;
  if (/same.*password|different from the old/i.test(message)) return 'Choose a password you have not used here before.';
  return message;
}

async function loadAccount(user: { id: string; email?: string } | null | undefined): Promise<Account | null> {
  if (!user) return null;
  const billingColumns =
    'display_name, plan, trial_ends_at, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id';
  let { data, error } = await supabase()
    .from('profiles')
    .select(`${billingColumns}, comp_until`)
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    // comp_until not there yet (code deployed ahead of migration 0007).
    ({ data, error } = await supabase().from('profiles').select(billingColumns).eq('id', user.id).maybeSingle());
  }
  if (error) {
    // Billing columns not there yet (code deployed ahead of migration 0006):
    // keep the name, leave billing unknown.
    ({ data } = await supabase().from('profiles').select('display_name').eq('id', user.id).maybeSingle());
    data = data ? { ...data, trial_ends_at: null } : null;
  }
  return {
    id: user.id,
    email: user.email ?? '',
    displayName: (data?.display_name as string | null) ?? null,
    billing: data?.trial_ends_at
      ? {
          trialEndsAt: data.trial_ends_at as string,
          status: (data.subscription_status as string | null) ?? null,
          plan: (data.plan as Plan | null) ?? null,
          currentPeriodEnd: (data.current_period_end as string | null) ?? null,
          cancelAtPeriodEnd: data.cancel_at_period_end === true,
          hasCustomer: Boolean(data.stripe_customer_id),
          compUntil: ((data as { comp_until?: string | null }).comp_until as string | null | undefined) ?? null,
        }
      : null,
  };
}

export async function currentAccount(): Promise<Account | null> {
  if (!isShared) return null;
  const { data } = await supabase().auth.getSession();
  return loadAccount(data.session?.user);
}

/**
 * Sign-in, sign-out, token refresh and password-recovery links all arrive here.
 * The profile lookup is deferred out of the auth callback, which Supabase
 * warns must not await its own client.
 */
export function onAuthChange(
  handle: (event: AuthChangeEvent, account: Account | null) => void,
): () => void {
  if (!isShared) return () => {};
  const { data } = supabase().auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      void loadAccount(session?.user).then((account) => handle(event, account));
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}

/** Where email links (confirmation, password reset) send people back to. */
const returnTo = () => window.location.origin;

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  return error ? friendly(error.message) : null;
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<{ error: string | null; confirmBy: 'email' | null }> {
  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.`, confirmBy: null };
  const { data, error } = await supabase().auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: returnTo(), data: { display_name: displayName.trim() } },
  });
  if (error) return { error: friendly(error.message), confirmBy: null };
  // With confirmation on there is no session yet. (Supabase also answers this
  // way for an address that already exists, so as not to reveal which do.)
  return { error: null, confirmBy: data.session ? null : 'email' };
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export async function sendPasswordReset(email: string): Promise<string | null> {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: returnTo() });
  return error ? friendly(error.message) : null;
}

export async function setPassword(password: string): Promise<string | null> {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  const { error } = await supabase().auth.updateUser({ password });
  return error ? friendly(error.message) : null;
}

/**
 * Change the sign-in email. Supabase emails a confirmation link (to both the
 * old and the new address, by default); the address only changes once it is
 * followed, so nothing is lost by a typo.
 */
export async function changeEmail(email: string): Promise<string | null> {
  const { error } = await supabase().auth.updateUser({ email: email.trim() }, { emailRedirectTo: returnTo() });
  return error ? friendly(error.message) : null;
}

export async function updateDisplayName(id: string, name: string): Promise<string | null> {
  const { error } = await supabase()
    .from('profiles')
    .update({ display_name: name.trim() || null })
    .eq('id', id);
  return error ? friendly(error.message) : null;
}
