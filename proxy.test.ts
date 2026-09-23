import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookieHeader, signSession } from './api/_session';
import proxy from './proxy';
import unlock from './api/unlock';

const SECRET = 'test-secret-do-not-use';
const PASSCODE = 'open sesame';

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_PASSCODE = PASSCODE;
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.APP_PASSCODE;
});

/** `next()` signals "carry on"; anything else is the gate answering itself. */
const passedThrough = (response: Response | undefined) =>
  response?.headers.get('x-middleware-next') === '1';

const get = (path: string, cookie?: string) =>
  new Request(`https://planner.test${path}`, { headers: cookie ? { cookie } : {} });

const postPasscode = (passcode: unknown) =>
  new Request('https://planner.test/api/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });

describe('the passcode gate', () => {
  it('serves the unlock page instead of the app when there is no cookie', async () => {
    const response = await proxy(get('/'));
    expect(response?.status).toBe(401);
    expect(response?.headers.get('content-type')).toContain('text/html');
    await expect(response?.text()).resolves.toContain('Enter the shared passcode');
  });

  it('never serves the bundle — and so never the anon key — unauthenticated', async () => {
    for (const path of ['/', '/index.html', '/assets/index-abc123.js']) {
      const response = await proxy(get(path));
      expect(response?.status, path).toBe(401);
    }
  });

  it('lets a valid session straight through', async () => {
    const cookie = cookieHeader(await signSession(SECRET)).split(';')[0];
    expect(passedThrough(await proxy(get('/', cookie)))).toBe(true);
    expect(passedThrough(await proxy(get('/api/save', cookie)))).toBe(true);
  });

  it('answers an unauthenticated API call with JSON, not a login page', async () => {
    const response = await proxy(get('/api/save'));
    expect(response?.status).toBe(401);
    expect(response?.headers.get('content-type')).toContain('application/json');
    await expect(response?.json()).resolves.toEqual({ error: 'Locked' });
  });

  it('always lets the unlock route through, whatever the matcher says', async () => {
    expect(passedThrough(await proxy(get('/api/unlock')))).toBe(true);
  });

  it('refuses to run at all without a signing secret, rather than letting everyone in', async () => {
    delete process.env.SESSION_SECRET;
    const response = await proxy(get('/'));
    expect(response?.status).toBe(500);
  });
});

describe('unlocking', () => {
  it('sets a session cookie for the right passcode', async () => {
    const response = await unlock(postPasscode(PASSCODE));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('planner_session=');
    expect(cookie).toContain('HttpOnly');

    // And that cookie opens the gate.
    expect(passedThrough(await proxy(get('/', cookie.split(';')[0])))).toBe(true);
  });

  it('refuses the wrong passcode, a near miss, and the wrong type', async () => {
    for (const bad of [`${PASSCODE} `, 'open Sesame', '', 42, null]) {
      const response = await unlock(postPasscode(bad));
      expect(response.status, String(bad)).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('only answers POST', async () => {
    const response = await unlock(get('/api/unlock'));
    expect(response.status).toBe(405);
  });

  it('will not hand out a session when the server has no passcode configured', async () => {
    delete process.env.APP_PASSCODE;
    const response = await unlock(postPasscode(''));
    expect(response.status).toBe(500);
  });
});
