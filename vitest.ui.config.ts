import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Component tests. Same aliases and setup as the unit suite, but in a DOM.
 *
 * Kept as a third config rather than a per-file annotation so the database suite
 * never accidentally runs a component, and so `npm run test:ui` is one command.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.ui.test.tsx'],
    setupFiles: ['src/test/ui-setup.ts'],
    exclude: ['node_modules/**'],
  },
});
