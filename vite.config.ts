import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts', '*.test.ts'],
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
