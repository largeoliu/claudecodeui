import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{js,jsx,ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['**/tests/ui/**', 'jsdom']],
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'coverage/**',
        'dist/**',
        'node_modules/**',
        'tests/**',
        'playwright.config.ts',
        'vitest.config.ts',
      ],
    },
  },
});
