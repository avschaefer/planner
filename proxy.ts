import { next } from '@vercel/functions';
import { COOKIE, readCookie, verifySession } from './api/_session.js';

/**
 * The passcode gate. Vercel Routing Middleware runs before anything is served,
 * for any framework — which is what lets a plain Vite SPA gate its own bundle
 * without becoming a Next.js app.
 *
 * Everything is behind it except /api/unlock, so the built JavaScript, and with
 * it the Supabase anon key, is never served to someone who has not unlocked.
 *
 * Registered as `proxy.entrypoint` in vercel.json rather than by the
 * `middleware.ts` file convention: that convention defaults to the deprecated
 * Edge runtime, while a proxy entrypoint runs on Node.js. The matcher lives in
 * vercel.json alongside it.
 *
 * This gate is not the only thing protecting the data. Every function in api/
 * re-checks the cookie, and RLS limits the anon key to reading, so a gap here
 * would cost read access, not write access.
 */

/** The one route that must stay open, or there is no way to unlock anything. */
const OPEN_PATH = '/api/unlock';

export default async function proxy(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  // Checked here as well as in the matcher: if that pattern is ever mis-edited,
  // gating the unlock route would lock the whole deployment out of itself.
  if (pathname === OPEN_PATH) return next();

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return new Response('SESSION_SECRET is not set on this deployment.', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const ok = await verifySession(readCookie(request.headers.get('cookie'), COOKIE), secret);
  if (ok) return next(); // On to the static build, or to the API function.

  // An unauthenticated API call gets JSON; a browser gets the unlock page.
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Locked' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(UNLOCK_PAGE, {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/* Inline so the gate needs no second Vite entry point and the app is untouched.
   Kept to the app's own tokens so it does not read as a different product. */
const UNLOCK_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Marga</title>
<style>
  :root {
    --bg: #fcfcfb; --panel: #fff; --line: #eae8e3; --line-strong: #d9d6cf;
    --text: #1a1917; --dim: #6b6862; --accent: #4f5bd5; --danger: #c0392f;
    --font: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--bg); color: var(--text); font: 13px/1.45 var(--font);
    -webkit-font-smoothing: antialiased;
  }
  form {
    width: 320px; padding: 28px; background: var(--panel);
    border: 1px solid var(--line); border-radius: 6px;
    box-shadow: 0 1px 2px rgba(26,25,23,.06), 0 10px 30px -6px rgba(26,25,23,.14);
  }
  h1 { margin: 0 0 4px; font-size: 19px; font-weight: 640; letter-spacing: -.02em; }
  p { margin: 0 0 20px; color: var(--dim); }
  label { display: block; font-size: 10.5px; font-weight: 640; letter-spacing: .06em;
          text-transform: uppercase; color: #9c988f; margin-bottom: 6px; }
  input {
    width: 100%; height: 36px; padding: 0 10px; font: inherit; color: var(--text);
    background: var(--bg); border: 1px solid var(--line-strong); border-radius: 4px; outline: none;
  }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79,91,213,.05); }
  button {
    width: 100%; height: 36px; margin-top: 12px; font: inherit; font-weight: 560;
    color: #fff; background: var(--accent); border: 1px solid var(--accent);
    border-radius: 4px; cursor: pointer;
  }
  button:hover { background: #3f4ac2; }
  button:disabled { opacity: .5; cursor: default; }
  .err { margin-top: 12px; color: var(--danger); min-height: 18px; }
</style>
</head>
<body>
  <form id="f">
    <h1>Marga</h1>
    <p>Enter the shared passcode to continue.</p>
    <label for="p">Passcode</label>
    <input id="p" type="password" autocomplete="current-password" autofocus />
    <button type="submit">Unlock</button>
    <div class="err" id="e"></div>
  </form>
<script>
  var f = document.getElementById('f'), p = document.getElementById('p'), e = document.getElementById('e');
  f.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    e.textContent = '';
    f.querySelector('button').disabled = true;
    try {
      var r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode: p.value }),
      });
      if (r.ok) { location.reload(); return; }
      var b = await r.json().catch(function () { return {}; });
      e.textContent = b.error || 'That did not work.';
    } catch (err) {
      e.textContent = 'Could not reach the server.';
    }
    f.querySelector('button').disabled = false;
    p.select();
  });
</script>
</body>
</html>`;
