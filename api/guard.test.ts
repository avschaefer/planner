import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import claim from './claim';
import remove from './delete';
import save from './save';

/**
 * The data functions re-check the cookie themselves rather than trusting the
 * middleware. If the matcher is ever mis-edited, these are the second lock.
 */

const HANDLERS = { save, delete: remove, claim } as const;

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret-do-not-use';
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
});

const post = (path: string, body: unknown) =>
  new Request(`https://planner.test/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('write functions', () => {
  it('refuse an unauthenticated caller before touching the database', async () => {
    for (const [name, handler] of Object.entries(HANDLERS)) {
      const response = await handler(post(name, { id: 'p1', clientId: 'c1', doc: { id: 'p1' } }));
      expect(response.status, name).toBe(401);
      await expect(response.json(), name).resolves.toEqual({ error: 'Locked' });
    }
  });

  it('refuse a forged cookie', async () => {
    for (const [name, handler] of Object.entries(HANDLERS)) {
      const request = new Request(`https://planner.test/api/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'planner_session=9999999999999.deadbeef' },
        body: JSON.stringify({ id: 'p1', clientId: 'c1', doc: { id: 'p1' } }),
      });
      expect((await handler(request)).status, name).toBe(401);
    }
  });

  it('only answer POST', async () => {
    for (const [name, handler] of Object.entries(HANDLERS)) {
      const response = await handler(new Request(`https://planner.test/api/${name}`));
      expect(response.status, name).toBe(405);
    }
  });
});
