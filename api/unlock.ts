import { cookieHeader, json, signSession, timingSafeEqual } from './_session';

/** POST { passcode } — the only route the middleware lets through unauthenticated. */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const passcode = process.env.APP_PASSCODE;
  const secret = process.env.SESSION_SECRET;
  if (!passcode || !secret) return json({ error: 'The server is not configured.' }, 500);

  let given = '';
  try {
    const body = (await request.json()) as { passcode?: unknown };
    given = typeof body.passcode === 'string' ? body.passcode : '';
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }

  if (!timingSafeEqual(given, passcode)) {
    // A pause takes the sting out of scripted guessing without holding a lock.
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: 'That passcode is not right.' }, 401);
  }

  return json({ ok: true }, 200, { 'set-cookie': cookieHeader(await signSession(secret)) });
}
