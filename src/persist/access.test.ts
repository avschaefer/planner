import { describe, expect, it } from 'vitest';
import { billingState, hasAccess, isLive, type Billing } from './access';

const now = new Date('2026-10-01T12:00:00Z');
const base: Billing = {
  trialEndsAt: '2026-10-31T12:00:00Z',
  status: null,
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  hasCustomer: false,
};

describe('billingState', () => {
  it('a new account is in trial with the days left rounded up', () => {
    expect(billingState(base, now)).toEqual({ kind: 'trial', daysLeft: 30, endsAt: base.trialEndsAt });
    expect(billingState({ ...base, trialEndsAt: '2026-10-01T13:00:00Z' }, now)).toMatchObject({ kind: 'trial', daysLeft: 1 });
  });

  it('locks once the trial has ended with no subscription', () => {
    const b = { ...base, trialEndsAt: '2026-10-01T11:59:59Z' };
    expect(billingState(b, now)).toEqual({ kind: 'expired', hadSubscription: false });
    expect(hasAccess(b, now)).toBe(false);
  });

  it('an active subscription grants access whatever the trial says', () => {
    const b: Billing = { ...base, trialEndsAt: '2026-01-01T00:00:00Z', status: 'active', plan: 'annual', currentPeriodEnd: '2027-10-01T00:00:00Z', hasCustomer: true };
    expect(billingState(b, now)).toMatchObject({ kind: 'active', plan: 'annual', pastDue: false, cancelling: false });
    expect(hasAccess(b, now)).toBe(true);
  });

  it('past_due keeps access while Stripe retries', () => {
    const b: Billing = { ...base, trialEndsAt: '2026-01-01T00:00:00Z', status: 'past_due', plan: 'monthly' };
    expect(billingState(b, now)).toMatchObject({ kind: 'active', pastDue: true });
  });

  it('cancel at period end keeps access until Stripe ends it', () => {
    const b: Billing = { ...base, trialEndsAt: '2026-01-01T00:00:00Z', status: 'active', cancelAtPeriodEnd: true };
    expect(billingState(b, now)).toMatchObject({ kind: 'active', cancelling: true });
  });

  it('subscribing mid-trial shows as active with the first charge pending', () => {
    expect(billingState({ ...base, status: 'trialing', plan: 'annual' }, now)).toMatchObject({ kind: 'active', firstChargePending: true });
  });

  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'])('%s after the trial locks', (status) => {
    const b = { ...base, trialEndsAt: '2026-01-01T00:00:00Z', status };
    expect(billingState(b, now)).toEqual({ kind: 'expired', hadSubscription: true });
  });

  it('an incomplete checkout during the trial leaves the trial running', () => {
    expect(billingState({ ...base, status: 'incomplete' }, now).kind).toBe('trial');
  });
});

describe('isLive', () => {
  it('matches the database rule exactly', () => {
    expect(['active', 'trialing', 'past_due'].every(isLive)).toBe(true);
    expect([null, undefined, '', 'canceled', 'unpaid'].some(isLive)).toBe(false);
  });
});
