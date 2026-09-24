import type { Plan } from './access';
import { supabase } from './supabaseRepo';

/**
 * The browser's half of billing: ask the server for a Stripe-hosted page and
 * go there. No card details ever pass through the app, and nothing here
 * changes what the account is entitled to — only Stripe's signed webhook does
 * (api/billing/webhook.ts). Coming back from Checkout, the app waits for that
 * webhook by re-reading the profile.
 */

async function post(path: string, body?: unknown): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? `Billing is unavailable (${res.status}).`);
  return json.url;
}

/** Leave for Stripe Checkout. Resolves only if it could not. */
export async function startCheckout(interval: Plan): Promise<void> {
  window.location.assign(await post('/api/billing/checkout', { interval }));
}

/** Leave for the Stripe Customer Portal. */
export async function openPortal(): Promise<void> {
  window.location.assign(await post('/api/billing/portal'));
}

export type BillingReturn = 'success' | 'cancel' | 'portal';

/**
 * Where Stripe sent the person back to (`?billing=…`), read once and removed
 * from the address bar so a reload does not replay it.
 */
export function takeBillingReturn(): BillingReturn | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('billing');
  if (!value) return null;
  url.searchParams.delete('billing');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return value === 'success' || value === 'cancel' || value === 'portal' ? value : null;
}
