import { describe, expect, it, vi } from 'vitest';
import pkg from '../../../../package.json';

// If the health route ever imports the database client, this mock makes it fail
// loudly instead of silently opening a pool during a liveness probe.
vi.mock('@/server/db/client', () => ({
  getDb: () => {
    throw new Error('health must not touch the database');
  },
}));

const { GET } = await import('./route');

describe('GET /api/health', () => {
  it('is always 200 with the version and no database call', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok', version: pkg.version });
  });

  it('is not cached', async () => {
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('leaks nothing about the environment', async () => {
    const response = GET();
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toMatch(/postgres|password|secret|host|5432/i);
  });
});
