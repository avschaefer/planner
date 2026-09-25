import { callApi } from './api';

/**
 * The admin panel's two calls (api/admin/comp.ts). Who is admin is decided on
 * the server from ADMIN_EMAIL; the browser only learns it from whether the
 * list loads.
 */

export interface CompAccount {
  user_id: string;
  email: string;
  display_name: string | null;
  /** ISO moment, or 'infinity' for no end. */
  comp_until: string;
  subscription_status: string | null;
}

/** Everyone with a grant, or null when the caller isn't the admin. */
export async function loadCompAccounts(): Promise<CompAccount[] | null> {
  const { status, data } = await callApi<{ accounts?: CompAccount[] }>('/api/admin/comp', { method: 'GET' });
  return status === 200 ? (data.accounts ?? []) : null;
}

/** Grant ('forever' or YYYY-MM-DD) or revoke (null). Resolves to an error message, or null. */
export async function setComp(email: string, until: 'forever' | string | null): Promise<string | null> {
  const { status, data } = await callApi('/api/admin/comp', { body: { email, until } });
  return status === 200 ? null : (data.error ?? `Could not save (${status}).`);
}
