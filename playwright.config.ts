import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // *.manual.spec.ts needs `vercel dev` and a real Supabase project, so it is
  // not part of the default run. See `npm run e2e:stack`.
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
