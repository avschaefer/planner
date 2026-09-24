import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `npm run dev` serves the Vercel functions in api/ too, so billing works
 * locally without the Vercel CLI (`stripe listen --forward-to
 * localhost:5173/api/billing/webhook`). Dev only: in production Vercel runs
 * them. Server-only variables from .env.local reach process.env here and are
 * never compiled into the bundle, which only sees VITE_ ones.
 */
function apiRoutes(): Plugin {
  return {
    name: 'marga-api',
    apply: 'serve',
    configureServer(server) {
      // Vitest starts a Vite server too; the suite stays hermetic (no .env.local).
      if (process.env.VITEST) return;
      for (const [k, v] of Object.entries(loadEnv('development', process.cwd(), ''))) process.env[k] ??= v;
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (!url.pathname.startsWith('/api/')) return next();
        const file = resolve('api', `${url.pathname.slice(5)}.ts`);
        if (!file.startsWith(resolve('api')) || /\/_/.test(url.pathname) || !existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const mod = (await server.ssrLoadModule(file)) as { default: { fetch(r: Request): Promise<Response> } };
          const response = await mod.default.fetch(
            new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }),
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.config.logger.error(String(e));
          res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiRoutes()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    // Hermetic: a developer's .env.local must not decide whether the store
    // talks to IndexedDB or to a real Supabase project.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_FORCE_LOCAL: '1',
    },
  },
});
