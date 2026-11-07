import { createPlayerAccount, postTransaction } from '@/server/ledger';
import { resetLedger, systemAccountId } from '@/server/ledger/test-support';
import { resetEnvCache } from '@/server/config/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

const SECRET = 'a-long-enough-cron-secret-value';

function call(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/internal/ledger/supply${query}`, {
    method: 'GET',
    headers,
  });
}

beforeEach(async () => {
  await resetLedger();
  vi.stubEnv('CRON_SECRET', SECRET);
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('GET /api/internal/ledger/supply', () => {
  it('refuses when CRON_SECRET is unset, and when the token is wrong', async () => {
    vi.stubEnv('CRON_SECRET', '');
    resetEnvCache();
    const unset = await GET(call());
    expect(unset.status).toBe(503);
    expect(unset.headers.get('cache-control')).toBe('no-store');

    vi.stubEnv('CRON_SECRET', SECRET);
    resetEnvCache();
    const unauthorised = await GET(call('', { authorization: 'Bearer nope' }));
    expect(unauthorised.status).toBe(401);
  });

  it('rejects a window outside 1 to 90 days', async () => {
    for (const days of ['0', '91', 'abc', '-1', '1.5']) {
      const response = await GET(call(`?days=${days}`, { authorization: `Bearer ${SECRET}` }));
      expect(response.status, days).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('returns the supply and flows as exact kobo strings', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createPlayerAccount(crypto.randomUUID());
    await postTransaction({
      idempotencyKey: 'route-supply-0001',
      category: 'onboarding_grant',
      entries: [
        { accountId: mint, amountKobo: -12_345n },
        { accountId: player.id, amountKobo: 12_345n },
      ],
    });

    const response = await GET(call('?days=30', { authorization: `Bearer ${SECRET}` }));
    const body = (await response.json()) as {
      days: number;
      from: string;
      supply: Record<string, string | { players: number }>;
      flows: Array<{ day: string; category: string; createdKobo: string; destroyedKobo: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.days).toBe(30);
    expect(body.supply.circulatingKobo).toBe('12345');
    expect(body.supply.totalMintedKobo).toBe('12345');

    const grant = body.flows.find((row) => row.category === 'onboarding_grant');
    expect(grant).toMatchObject({ createdKobo: '12345', destroyedKobo: '0' });

    // Strings only: no kobo figure may be a JSON number.
    expect(JSON.stringify(body.flows)).not.toMatch(/"createdKobo":\d/);
    expect(JSON.stringify(body.supply)).not.toMatch(/"circulatingKobo":\d/);
  });
});
