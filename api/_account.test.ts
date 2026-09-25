import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Account deletion and the admin gate, with Stripe and Supabase faked. What
 * matters here is order and refusal: Stripe is cancelled before the account
 * goes, a Stripe failure keeps the account, and only ADMIN_EMAIL gets in.
 */

const steps: string[] = [];
let user: { id: string; email: string; email_confirmed_at: string | null } | null = null;
let customer: string | null = null;
let stripeFails = false;
const rpc = vi.fn(async (..._args: unknown[]) => ({ data: [], error: null as null | { code: string } }));

vi.mock('./_stripe.js', () => ({
  cancelEverything: async (id: string) => {
    if (stripeFails) throw new Error('stripe down');
    steps.push(`cancel ${id}`);
    return ['sub_1'];
  },
}));

vi.mock('./_supabase.js', async (original) => ({
  ...(await original<typeof import('./_supabase')>()),
  requireUser: async () => user,
  admin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stripe_customer_id: customer }, error: null }) }) }),
    }),
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          steps.push(`delete ${id}`);
          return { error: null };
        },
      },
    },
    rpc,
  }),
}));

const { handler: del } = await import('./account/delete');
const { handler: comp } = await import('./admin/comp');
const post = (body?: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body ?? {}) });

beforeEach(() => {
  steps.length = 0;
  user = { id: 'u1', email: 'me@example.com', email_confirmed_at: '2026-01-01' };
  customer = null;
  stripeFails = false;
  rpc.mockClear();
  process.env.ADMIN_EMAIL = 'me@example.com';
});

describe('POST /api/account/delete', () => {
  it('refuses the signed out', async () => {
    user = null;
    expect((await del(post())).status).toBe(401);
    expect(steps).toEqual([]);
  });

  it('cancels the subscription in Stripe before deleting the account', async () => {
    customer = 'cus_1';
    expect((await del(post())).status).toBe(200);
    expect(steps).toEqual(['cancel cus_1', 'delete u1']);
  });

  it('keeps the account when Stripe fails, so nobody is deleted but still billed', async () => {
    customer = 'cus_1';
    stripeFails = true;
    const res = await del(post());
    expect(res.status).toBe(502);
    expect(steps).toEqual([]);
  });

  it('never touches Stripe for an account that was never a customer', async () => {
    expect((await del(post())).status).toBe(200);
    expect(steps).toEqual(['delete u1']);
  });
});

describe('/api/admin/comp', () => {
  it('is 403 for anyone but ADMIN_EMAIL, and for an unconfirmed admin email', async () => {
    user = { id: 'u2', email: 'friend@example.com', email_confirmed_at: '2026-01-01' };
    expect((await comp(new Request('http://localhost/x', { method: 'GET' }))).status).toBe(403);
    user = { id: 'u3', email: 'me@example.com', email_confirmed_at: null };
    expect((await comp(post({ email: 'x@y.z', until: 'forever' }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is 403 for everyone when ADMIN_EMAIL is unset', async () => {
    delete process.env.ADMIN_EMAIL;
    expect((await comp(new Request('http://localhost/x', { method: 'GET' }))).status).toBe(403);
  });

  it('lets the admin list, grant and revoke', async () => {
    expect((await comp(new Request('http://localhost/x', { method: 'GET' }))).status).toBe(200);
    expect((await comp(post({ email: 'friend@example.com', until: 'forever' }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('admin_set_comp', { p_email: 'friend@example.com', p_until: 'infinity' });
    expect((await comp(post({ email: 'friend@example.com', until: null }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('admin_set_comp', { p_email: 'friend@example.com', p_until: null });
  });

  it('rejects a bad email or date, and says when there is no such account', async () => {
    expect((await comp(post({ email: 'nope', until: 'forever' }))).status).toBe(400);
    expect((await comp(post({ email: 'a@b.co', until: '2001-01-01' }))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: [], error: { code: 'P0002' } });
    expect((await comp(post({ email: 'ghost@b.co', until: 'forever' }))).status).toBe(404);
  });
});
