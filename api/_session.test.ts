import { describe, expect, it } from 'vitest';
import { cookieHeader, readCookie, signSession, timingSafeEqual, verifySession } from './_session';

const SECRET = 'test-secret-do-not-use';

describe('session cookie', () => {
  it('accepts a token it just signed', async () => {
    expect(await verifySession(await signSession(SECRET), SECRET)).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(SECRET);
    expect(await verifySession(token, 'another-secret')).toBe(false);
  });

  it('rejects a tampered expiry', async () => {
    const token = await signSession(SECRET);
    const [, sig] = token.split('.');
    const forged = `${Date.now() + 999_999}.${sig}`;
    expect(await verifySession(forged, SECRET)).toBe(false);
  });

  it('rejects an expired token', async () => {
    expect(await verifySession(await signSession(SECRET, -1), SECRET)).toBe(false);
  });

  it('rejects junk', async () => {
    for (const bad of ['', 'nope', '.', 'abc.def', '123']) {
      expect(await verifySession(bad, SECRET)).toBe(false);
    }
    expect(await verifySession(undefined, SECRET)).toBe(false);
  });

  it('compares in constant time and still compares correctly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('reads its own cookie back out of a header', async () => {
    const token = await signSession(SECRET);
    const header = `other=1; ${cookieHeader(token).split(';')[0]}; last=2`;
    expect(readCookie(header, 'planner_session')).toBe(token);
    expect(readCookie(header, 'missing')).toBeUndefined();
    expect(readCookie(null, 'planner_session')).toBeUndefined();
  });

  it('sets the flags that keep the cookie out of scripts and off other sites', () => {
    const header = cookieHeader('x');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });
});
