import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Component tests run without a network and without a router: every test mocks
 * `next/navigation` and `fetch` itself, so a test that forgets to mock fetch
 * fails loudly instead of reaching out to the machine.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

Object.defineProperty(globalThis, 'fetch', {
  value: vi.fn(() => Promise.reject(new Error('fetch was not mocked in this test'))),
  writable: true,
});
