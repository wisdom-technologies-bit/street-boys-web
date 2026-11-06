import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/server/config/env';

const { POST } = await import('./route');

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

  it('runs when the secret is correct', async () => {
    const response = await POST(call({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ran: 0 });
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
