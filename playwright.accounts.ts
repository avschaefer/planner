import { defineConfig } from '@playwright/test';

/**
 * The accounts check against the real Supabase project. Start `npm run dev`
 * first — Vite reads .env.local, so the app runs in shared (signed-in) mode.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/accounts.manual.spec.ts',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5173' },
});
