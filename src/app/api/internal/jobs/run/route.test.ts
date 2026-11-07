import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/config/env';

// The registry itself is database-tested; here the route's wiring is what matters.
vi.mock('@/server/jobs/registry', () => ({
  runDueJobs: vi.fn(async () => ({
    skipped: false,
    jobs: [{ name: 'transfers.release', ok: true, released: 2 }],
  })),
}));

const { POST } = await import('./route');
const { runDueJobs } = await import('@/server/jobs/registry');

const SECRET = 'a-long-enough-cron-secret-value';

function call(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/internal/jobs/run', { method: 'POST', headers });
}

describe('POST /api/internal/jobs/run', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET);
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('runs the registry and reports every job', async () => {
    const response = await POST(call({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ran: 1,
      skipped: false,
      jobs: [{ name: 'transfers.release', ok: true, released: 2 }],
    });
  });

  it('says so when another instance holds the run lock', async () => {
    vi.mocked(runDueJobs).mockResolvedValueOnce({ skipped: true, jobs: [] });

    const response = await POST(call({ authorization: `Bearer ${SECRET}` }));

    expect(await response.json()).toEqual({ ran: 0, skipped: true, jobs: [] });
  });

  it('rejects a missing secret header', async () => {
    const response = await POST(call());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a wrong secret', async () => {
    const response = await POST(call({ authorization: 'Bearer wrong-secret-value-here' }));

    expect(response.status).toBe(401);
  });

  it('refuses everything when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    resetEnvCache();

    const response = await POST(call({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'not_configured' });
  });

  it('is not cached', async () => {
    const response = await POST(call({ authorization: `Bearer ${SECRET}` }));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
