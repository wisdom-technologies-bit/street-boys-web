import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests. No database, no network: fast, and run on every push.
 * Database tests live in vitest.db.config.ts and are never picked up here.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/unit-setup.ts'],
    exclude: ['**/*.db.test.ts', 'node_modules/**'],
  },
});
