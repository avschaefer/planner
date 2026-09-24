import { describe, expect, it } from 'vitest';
import {
  billingColumns,
  checkoutTrialEnd,
  customerOf,
  pickSubscription,
  planFromInterval,
  priceFor,
  type SubscriptionLike,
} from './_billing';

const sub = (over: Partial<SubscriptionLike> & { interval?: string; periodEnd?: number } = {}): SubscriptionLike => ({
  id: 'sub_1',
  status: 'active',
  created: 1_000,
  cancel_at_period_end: false,
  cancel_at: null,
  items: { data: [{ current_period_end: over.periodEnd ?? 2_000_000_000, price: { recurring: { interval: over.interval ?? 'year' } } }] },
  ...over,
});

describe('pickSubscription', () => {
  it('prefers a live subscription over a newer ended one', () => {
    const old = sub({ id: 'a', status: 'active', created: 1 });
    const ended = sub({ id: 'b', status: 'canceled', created: 2 });
    expect(pickSubscription([ended, old])?.id).toBe('a');
  });

  it('prefers active over past_due, and the newest among equals', () => {
    expect(pickSubscription([sub({ id: 'p', status: 'past_due', created: 9 }), sub({ id: 'a', created: 1 })])?.id).toBe('a');
    expect(pickSubscription([sub({ id: 'x', status: 'canceled', created: 1 }), sub({ id: 'y', status: 'canceled', created: 5 })])?.id).toBe('y');
  });

  it('is null for a customer with no subscriptions', () => {
    expect(pickSubscription([])).toBeNull();
  });
});

describe('billingColumns', () => {
  it('maps an annual subscription', () => {
    expect(billingColumns(sub({ periodEnd: 1_800_000_000 }))).toEqual({
      stripe_subscription_id: 'sub_1',
      subscription_status: 'active',
      plan: 'annual',
      current_period_end: new Date(1_800_000_000_000).toISOString(),
      cancel_at_period_end: false,
    });
  });

  it('marks cancellation either way the Portal expresses it', () => {
    expect(billingColumns(sub({ cancel_at_period_end: true })).cancel_at_period_end).toBe(true);
    const viaCancelAt = billingColumns(sub({ cancel_at: 1_700_000_000, periodEnd: 1_800_000_000 }));
    expect(viaCancelAt.cancel_at_period_end).toBe(true);
    expect(viaCancelAt.current_period_end).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('clears everything when there is no subscription', () => {
    expect(billingColumns(null)).toMatchObject({ subscription_status: null, plan: null, stripe_subscription_id: null });
  });
});

describe('planFromInterval', () => {
  it('reads the price interval, not a price id', () => {
    expect(planFromInterval('month')).toBe('monthly');
    expect(planFromInterval('year')).toBe('annual');
    expect(planFromInterval('week')).toBeNull();
  });
});

describe('checkoutTrialEnd', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  it('carries the remaining app trial into Stripe', () => {
    const end = new Date('2026-10-20T00:00:00Z');
    expect(checkoutTrialEnd(end, now)).toBe(end.getTime() / 1000);
  });
  it('charges now when under Stripe’s 48-hour minimum, or after the trial', () => {
    expect(checkoutTrialEnd(new Date('2026-10-02T23:00:00Z'), now)).toBeUndefined();
    expect(checkoutTrialEnd(new Date('2026-09-01T00:00:00Z'), now)).toBeUndefined();
  });
});

describe('priceFor', () => {
  const env = { STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_ANNUAL: 'price_a' };
  it('maps an interval to the configured price and nothing else', () => {
    expect(priceFor('monthly', env)).toBe('price_m');
    expect(priceFor('annual', env)).toBe('price_a');
    expect(priceFor('price_a', env)).toBeNull();
    expect(priceFor('annual', {})).toBeNull();
  });
});

describe('customerOf', () => {
  it('reads an id or an expanded customer', () => {
    expect(customerOf({ customer: 'cus_1' })).toBe('cus_1');
    expect(customerOf({ customer: { id: 'cus_2' } })).toBe('cus_2');
    expect(customerOf({ customer: null })).toBeNull();
    expect(customerOf(null)).toBeNull();
  });
});
