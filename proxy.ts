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

/** The route that must stay open, or there is no way to unlock anything. */
const OPEN_PATH = '/api/unlock';
/** Static, non-sensitive files the unlock page itself needs (its typeface). */
const OPEN_PREFIX = '/fonts/';

export default async function proxy(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  // Checked here as well as in the matcher: if that pattern is ever mis-edited,
  // gating the unlock route would lock the whole deployment out of itself.
  if (pathname === OPEN_PATH || pathname.startsWith(OPEN_PREFIX)) return next();

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
  /* Same family as the home page: a still aurora behind frosted glass, the
     spaced-capital logotype, and the hairline hero word. Static on purpose —
     this page is seen for a few seconds, and needs no script to look right. */
  @font-face {
    font-family: 'Outfit Variable'; font-style: normal; font-display: swap; font-weight: 100 900;
    src: url(/fonts/outfit-latin.woff2) format('woff2-variations');
  }
  :root {
    --bg: #fcfcfb; --text: #1a1917; --dim: #6b6862; --faint: #9c988f;
    --accent: #4f5bd5; --danger: #c0392f;
    --font: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --display: 'Outfit Variable', var(--font);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; display: grid; place-items: center; overflow: hidden;
    background: var(--bg); color: var(--text); font: 13px/1.45 var(--font);
    -webkit-font-smoothing: antialiased;
  }
  .bg { position: fixed; inset: -10%; filter: blur(40px) saturate(115%); z-index: 0;
    background:
      radial-gradient(38% 42% at 18% 22%, rgba(79,91,213,.42), transparent 70%),
      radial-gradient(34% 40% at 82% 30%, rgba(234,162,194,.5), transparent 70%),
      radial-gradient(40% 38% at 70% 82%, rgba(182,164,240,.5), transparent 70%),
      radial-gradient(36% 34% at 24% 78%, rgba(246,196,162,.5), transparent 70%),
      linear-gradient(160deg, transparent 30%, rgba(168,192,244,.35) 50%, transparent 70%);
  }
  .hero {
    position: fixed; left: 50%; bottom: 3.5vh; transform: translateX(-50%); z-index: 0;
    font-family: var(--display); font-weight: 150; font-size: clamp(88px, 17vw, 300px);
    line-height: .9; letter-spacing: .3em; padding-left: .3em; text-transform: uppercase;
    white-space: nowrap; user-select: none; pointer-events: none; opacity: .8;
    background: linear-gradient(180deg, rgba(255,255,255,.92) 10%, rgba(255,255,255,.22) 95%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  form {
    position: relative; z-index: 1; width: 340px; padding: 32px 30px 26px;
    border-radius: 18px; background: rgba(255,255,255,.52);
    -webkit-backdrop-filter: blur(28px) saturate(160%); backdrop-filter: blur(28px) saturate(160%);
    border: 1px solid rgba(255,255,255,.72);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(26,25,23,.04),
                0 28px 80px -28px rgba(26,25,23,.24);
  }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .brand svg { color: var(--accent); flex: none; }
  h1 { margin: 0 -.38em 0 0; font-family: var(--display); font-size: 17px; font-weight: 520;
       letter-spacing: .38em; text-transform: uppercase; }
  p { margin: 0 0 20px; color: var(--dim); }
  label { display: block; font-size: 10.5px; font-weight: 640; letter-spacing: .06em;
          text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
  input {
    width: 100%; height: 36px; padding: 0 12px; font: inherit; color: var(--text);
    background: rgba(255,255,255,.72); border: 1px solid rgba(26,25,23,.12);
    border-radius: 6px; outline: none;
  }
  input:focus { background: #fff; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79,91,213,.12); }
  button {
    width: 100%; height: 36px; margin-top: 12px; font: 560 13px/1 var(--font);
    color: #fff; background: var(--accent); border: 0; border-radius: 6px; cursor: pointer;
    box-shadow: 0 1px 2px rgba(26,25,23,.12);
  }
  button:hover { background: #3f4ac2; }
  button:disabled { opacity: .5; cursor: default; }
  .err { margin-top: 12px; color: var(--danger); min-height: 18px; }
</style>
</head>
<body>
  <div class="bg" aria-hidden="true"></div>
  <div class="hero" aria-hidden="true">Marga</div>
  <form id="f">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect x="2" y="4.5" width="11" height="3.6" rx="1.8" fill="currentColor" />
        <rect x="6" y="9.2" width="14" height="3.6" rx="1.8" fill="currentColor" opacity="0.62" />
        <rect x="4" y="13.9" width="9" height="3.6" rx="1.8" fill="currentColor" opacity="0.34" />
      </svg>
      <h1>Marga</h1>
    </div>
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
