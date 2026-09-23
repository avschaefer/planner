import { defineConfig } from '@playwright/test';

/**
 * The full-stack check: passcode gate, shared writes, live sync and the editor
 * lock, against a real Supabase project. Needs `vercel dev` running on :3000
 * with .env.local populated, so it is kept out of the default suite.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.manual.spec.ts',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:3000' },
});
