import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webhook handler with Stripe's real signature check and a fake database.
 * syncCustomer is stubbed: what it writes is covered by _billing.test.ts and,
 * against the live project, by the Stripe CLI runbook in docs/BILLING.md.
 */

const SECRET = 'whsec_test_secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const seen = new Set<string>();
const recorded: string[] = [];
const sync = vi.fn();

vi.mock('./_stripe.js', async (original) => ({
  ...(await original<typeof import('./_stripe')>()),
  syncCustomer: (...args: unknown[]) => sync(...args),
}));

vi.mock('./_supabase.js', async (original) => ({
  ...(await original<typeof import('./_supabase')>()),
  admin: () => ({
    from: () => ({
      select: () => ({
        eq: (_: string, id: string) => ({ maybeSingle: async () => ({ data: seen.has(id) ? { id } : null }) }),
      }),
      upsert: async (row: { id: string }) => {
        seen.add(row.id);
        recorded.push(row.id);
        return { error: null };
      },
    }),
  }),
}));

const { handler } = await import('./billing/webhook');
const signer = new Stripe('sk_test_dummy');

function deliver(event: object, secret = SECRET): Promise<Response> {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return handler(
    new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': header, 'content-type': 'application/json' },
      body: payload,
    }),
  );
}

const subEvent = (id: string, type = 'customer.subscription.updated') => ({
  id,
  object: 'event',
  type,
  data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1' } },
});

beforeEach(() => {
  seen.clear();
  recorded.length = 0;
  sync.mockReset();
  sync.mockResolvedValue({ ok: true, userId: 'u1' });
});

describe('webhook', () => {
  it('refuses a missing or forged signature without touching anything', async () => {
    const bare = await handler(new Request('http://localhost/x', { method: 'POST', body: '{}' }));
    expect(bare.status).toBe(400);
    const forged = await deliver(subEvent('evt_forged'), 'whsec_wrong');
    expect(forged.status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs the customer and records the event', async () => {
    const res = await deliver(subEvent('evt_1'));
    expect(res.status).toBe(200);
    expect(sync).toHaveBeenCalledWith(expect.anything(), 'cus_1');
    expect(recorded).toEqual(['evt_1']);
  });

  it('is idempotent: a redelivered event is acknowledged and skipped', async () => {
    await deliver(subEvent('evt_2'));
    const again = await deliver(subEvent('evt_2'));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('acknowledges events it does not handle', async () => {
    const res = await deliver({ ...subEvent('evt_3'), type: 'charge.refunded' });
    expect(res.status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
  });

  it('answers 500 on failure and does not record, so Stripe retries', async () => {
    sync.mockRejectedValueOnce(new Error('db down'));
    const res = await deliver(subEvent('evt_4', 'invoice.payment_failed'));
    expect(res.status).toBe(500);
    expect(recorded).toEqual([]);
    const retry = await deliver(subEvent('evt_4', 'invoice.payment_failed'));
    expect(retry.status).toBe(200);
    expect(recorded).toEqual(['evt_4']);
  });
});
