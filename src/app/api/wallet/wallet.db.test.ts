import { getPool } from '@/server/db/client';
import { resetEnvCache } from '@/server/config/env';
import { seedSystemAccounts } from '@/server/ledger/test-support';
import { truncateAll } from '@/test/db-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as walletRoute } from './route';
import { GET as statementRoute } from './statement/route';
import { POST as requestCodeRoute } from '../auth/request-code/route';
import { POST as verifyCodeRoute } from '../auth/verify-code/route';
import { POST as characterRoute } from '../character/route';

/**
 * The wallet routes, through real sessions and the real ledger.
 *
 * The two properties under test are the ones a player would notice: the balance is
 * theirs and only theirs, and a page asking for it never gets somebody else's money
 * or a crash.
 */

const ORIGIN = 'https://streetboys.example';
const VALID_CHARACTER = { name: 'Ada', avatar: { skinTone: 2, hair: 3, outfit: 4 } };

type Captured = { to: string; code: string };
let captured: Captured[] = [];
let emailCounter = 0;

beforeEach(async () => {
  await truncateAll();
  await seedSystemAccounts();
  captured = [];
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('EMAIL_PROVIDER', 'console');
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  vi.stubEnv('OTP_PEPPER', 'test-otp-pepper-0123456789abcdefghij');
  vi.stubEnv('IP_HASH_PEPPER', 'test-pepper-not-a-real-secret-0123456789abcdef');
  resetEnvCache();
  vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
    const match = /-> ([^:]+): (\d{6}) /.exec(String(line));
    if (match) captured.push({ to: match[1]!, code: match[2]! });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function get(url: string, token?: string): Request {
  return new Request(`${ORIGIN}${url}`, {
    headers: token ? { cookie: `sb_session=${token}` } : {},
  });
}

/** A signed-in player with a character and therefore a wallet. */
async function newPlayer(name = 'Ada'): Promise<{ token: string; userId: string }> {
  emailCounter += 1;
  const email = `wallet${emailCounter}@example.com`;
  await requestCodeRoute(post('/api/auth/request-code', { email }));
  const code = captured.at(-1)!.code;
  const verified = await verifyCodeRoute(
    post('/api/auth/verify-code', {
      email,
      code,
      details: { acceptTerms: true, ageBand: '18_plus' },
    }),
  );
  const token = /sb_session=([^;]+)/.exec(verified.headers.get('set-cookie') ?? '')![1]!;

  const created = await characterRoute(
    post('/api/character', { ...VALID_CHARACTER, name }, { cookie: `sb_session=${token}` }),
  );
  expect(created.status).toBe(201);

  const { rows } = await getPool().query<{ id: string }>(
    'select id from users where email_canonical = $1',
    [email],
  );
  return { token, userId: rows[0]!.id };
}

describe('GET /api/wallet', () => {
  it('is 401 signed out, and never answers with an amount', async () => {
    const response = await walletRoute(get('/api/wallet'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('is 403 for a frozen session', async () => {
    const { token, userId } = await newPlayer();
    await getPool().query(`update users set status = 'frozen' where id = $1`, [userId]);

    expect((await walletRoute(get('/api/wallet', token))).status).toBe(403);
  });

  it('returns the balance as a string and as money a player reads', async () => {
    const { token } = await newPlayer();

    const response = await walletRoute(get('/api/wallet', token));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      balanceKobo: '500000',
      formatted: '₦5,000.00',
      restricted: false,
    });
  });

  it('says setupPending, not an error, when the wallet cannot be set up yet', async () => {
    const { token } = await newPlayer();
    await getPool().query(
      "update accounts set code = 'SYSTEM_MINT_UNREACHABLE' where code = 'SYSTEM_MINT'",
    );
    // A fresh player, so the read has to heal rather than find an existing balance.
    const { token: otherToken } = await newPlayer('Bola');

    const response = await walletRoute(get('/api/wallet', otherToken));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ setupPending: true });
    expect((await walletRoute(get('/api/wallet', token))).status).toBe(200);
  });

  it('rate limits with a Retry-After, and the limit is per player', async () => {
    const { token } = await newPlayer();
    const { token: otherToken } = await newPlayer('Bola');

    let limited: Response | null = null;
    for (let index = 0; index < 61; index += 1) {
      const response = await walletRoute(get('/api/wallet', token));
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited, 'the 61st request should be limited').not.toBeNull();
    expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited?.json()).toEqual({ error: 'rate_limited' });

    // The other player is unaffected: a limiter keyed by the wrong thing would block them.
    expect((await walletRoute(get('/api/wallet', otherToken))).status).toBe(200);
  });
});

describe('GET /api/wallet/statement', () => {
  it('is 401 signed out', async () => {
    expect((await statementRoute(get('/api/wallet/statement'))).status).toBe(401);
  });

  it('heals a player who has a character but no account, then shows one grant', async () => {
    const { token } = await newPlayer();
    await getPool().query(
      'truncate table ledger_entries, ledger_transactions, account_balances, accounts cascade',
    );
    await seedSystemAccounts();

    const response = await statementRoute(get('/api/wallet/statement', token));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: {
        id: string;
        amountKobo: string;
        balanceAfterKobo: string;
        category: string;
        at: string;
      }[];
      nextCursor: string | null;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.amountKobo).toBe('500000');
    expect(body.entries[0]?.balanceAfterKobo).toBe('500000');
    expect(body.entries[0]?.category).toBe('onboarding_grant');
    expect(new Date(body.entries[0]?.at as string).getTime()).toBeGreaterThan(0);
    expect(body.nextCursor).toBeNull();
  });

  it("keeps two players' statements apart", async () => {
    const first = await newPlayer();
    const second = await newPlayer('Bola');

    // A spend for the first player only, so the statements differ in more than a name.
    const { rows } = await getPool().query<{ id: string }>(
      "select id from accounts where kind = 'player' and owner_user_id = $1",
      [first.userId],
    );
    const { rows: burn } = await getPool().query<{ id: string }>(
      "select id from accounts where code = 'SYSTEM_BURN'",
    );
    const { postTransaction, buildIdempotencyKey } = await import('@/server/ledger');
    await postTransaction({
      idempotencyKey: buildIdempotencyKey('test-spend', first.userId),
      category: 'food',
      entries: [
        { accountId: rows[0]!.id, amountKobo: -150_000n },
        { accountId: burn[0]!.id, amountKobo: 150_000n },
      ],
    });

    const mine = (await (
      await statementRoute(get('/api/wallet/statement', first.token))
    ).json()) as {
      entries: { category: string; amountKobo: string }[];
    };
    const theirs = (await (
      await statementRoute(get('/api/wallet/statement', second.token))
    ).json()) as { entries: { category: string; amountKobo: string }[] };

    expect(mine.entries.map((entry) => entry.category)).toEqual(['food', 'onboarding_grant']);
    expect(mine.entries[0]?.amountKobo).toBe('-150000');
    expect(theirs.entries.map((entry) => entry.category)).toEqual(['onboarding_grant']);
    expect(theirs.entries[0]?.amountKobo).toBe('500000');
  });

  it('pages with a cursor, and refuses a limit outside 1..50', async () => {
    const { token, userId } = await newPlayer();
    const { rows } = await getPool().query<{ id: string }>(
      "select id from accounts where kind = 'player' and owner_user_id = $1",
      [userId],
    );
    const { rows: burn } = await getPool().query<{ id: string }>(
      "select id from accounts where code = 'SYSTEM_BURN'",
    );
    const { postTransaction, buildIdempotencyKey } = await import('@/server/ledger');
    for (let index = 0; index < 3; index += 1) {
      await postTransaction({
        idempotencyKey: buildIdempotencyKey('test-page', userId, String(index)),
        category: 'food',
        entries: [
          { accountId: rows[0]!.id, amountKobo: -1_000n },
          { accountId: burn[0]!.id, amountKobo: 1_000n },
        ],
      });
    }

    const first = (await (
      await statementRoute(get('/api/wallet/statement?limit=2', token))
    ).json()) as { entries: { id: string }[]; nextCursor: string | null };
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await statementRoute(get(`/api/wallet/statement?limit=2&before=${first.nextCursor}`, token))
    ).json()) as { entries: { id: string }[]; nextCursor: string | null };
    expect(second.entries).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);

    for (const bad of ['0', '51', 'abc', '1.5']) {
      const response = await statementRoute(get(`/api/wallet/statement?limit=${bad}`, token));
      expect(response.status, bad).toBe(400);
    }
    expect((await statementRoute(get('/api/wallet/statement?before=abc', token))).status).toBe(400);
  });

  it('rate limits the statement at 30 a minute, separately from the wallet', async () => {
    const { token } = await newPlayer();

    let limited: Response | null = null;
    for (let index = 0; index < 31; index += 1) {
      const response = await statementRoute(get('/api/wallet/statement', token));
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited, 'the 31st statement request should be limited').not.toBeNull();
    expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await walletRoute(get('/api/wallet', token))).status).toBe(200);
  });
});
