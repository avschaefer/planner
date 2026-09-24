import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // *.manual.spec.ts runs against a real Supabase project and is not part of
  // the default run.
  testIgnore: '**/*.manual.spec.ts',
  timeout: 20_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    // The browser suite covers the local IndexedDB path; pin it there so the
    // result does not depend on whether this machine has a .env.local.
    env: { VITE_FORCE_LOCAL: '1' },
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
