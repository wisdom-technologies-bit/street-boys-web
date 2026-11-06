import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Database tests. They run the real migrations against a real Postgres
 * (DATABASE_URL_TEST) and are the harness the ledger tests will reuse later.
 *
 * - `db-global-setup.ts` drops the schema and applies every migration once.
 * - `db-setup.ts` points the app's DATABASE_URL at the test database.
 * - `src/test/db-utils.ts` cleans between tests.
 *
 * One process, no parallel writers, because there is one database.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    globalSetup: ['src/test/db-global-setup.ts'],
    setupFiles: ['src/test/db-setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
