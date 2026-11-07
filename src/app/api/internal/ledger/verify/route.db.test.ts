import { getPool } from '@/server/db/client';
import { createPlayerAccount, postTransaction } from '@/server/ledger';
import { resetLedger, systemAccountId } from '@/server/ledger/test-support';
import { resetEnvCache } from '@/server/config/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { POST } = await import('./route');

const SECRET = 'a-long-enough-cron-secret-value';

function call(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/internal/ledger/verify', { method: 'POST', headers });
}

beforeEach(async () => {
  await resetLedger();
  await getPool().query("delete from rate_limits where key like 'internal:ledger:verify%'");
  vi.stubEnv('CRON_SECRET', SECRET);
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('POST /api/internal/ledger/verify', () => {
  it('refuses everything when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    resetEnvCache();

    const response = await POST(call({ authorization: 'Bearer anything' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'not_configured' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a missing or wrong bearer token', async () => {
    const missing = await POST(call());
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: 'unauthorized' });

    const wrong = await POST(call({ authorization: 'Bearer not-the-secret' }));
    expect(wrong.status).toBe(401);
  });

  it('runs on a healthy ledger, reports counts only, and audits the run', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createPlayerAccount(crypto.randomUUID());
    await postTransaction({
      idempotencyKey: 'route-verify-0001',
      category: 'onboarding_grant',
      entries: [
        { accountId: mint, amountKobo: -900n },
        { accountId: player.id, amountKobo: 900n },
      ],
    });

    const response = await POST(call({ authorization: `Bearer ${SECRET}` }));
    const body = (await response.json()) as {
      ok: boolean;
      counts: Record<string, number>;
      failures: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.failures).toEqual([]);
    expect(body.counts.transactions).toBeGreaterThanOrEqual(1);
    expect(body.counts.entries).toBeGreaterThanOrEqual(2);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const audit = await getPool().query<{ count: string }>(
      "select count(*)::text as count from audit_log where event_type = 'ledger_verify_run'",
    );
    expect(Number(audit.rows[0]?.count)).toBe(1);
  });

  it('is rate limited to one run per 30 seconds, with Retry-After', async () => {
    const first = await POST(call({ authorization: `Bearer ${SECRET}` }));
    expect(first.status).toBe(200);

    const second = await POST(call({ authorization: `Bearer ${SECRET}` }));

    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'rate_limited' });
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(second.headers.get('cache-control')).toBe('no-store');
  });
});
