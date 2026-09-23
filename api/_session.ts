/**
 * The shared-passcode session cookie.
 *
 * One passcode, no accounts (PRD Q-1). A session is just a signed expiry:
 * `<expiry-ms>.<HMAC-SHA256(expiry, SESSION_SECRET)>`. Nothing about the
 * visitor is recorded, because nothing about the visitor is known.
 *
 * Web Crypto only, so this same module runs in the Edge middleware and in the
 * Node functions without a second implementation.
 */

export const COOKIE = 'planner_session';
const MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signSession(secret: string, ttlSeconds = MAX_AGE_S): Promise<string> {
  const expiry = String(Date.now() + ttlSeconds * 1000);
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(expiry));
  return `${expiry}.${hex(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;

  const expected = hex(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(expiry)));
  return timingSafeEqual(sig, expected);
}

/** Constant-time for equal-length strings; length alone is not a secret here. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function cookieHeader(token: string, ttlSeconds = MAX_AGE_S): string {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

/** Guard for the data functions. They never trust the middleware alone. */
export async function authorised(request: Request): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  return verifySession(readCookie(request.headers.get('cookie'), COOKIE), secret);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
