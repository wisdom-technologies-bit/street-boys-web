import { getPool } from '@/server/db/client';
import { resetEnvCache } from '@/server/config/env';
import { truncateAll } from '@/test/db-utils';
import { FORWARDED_FOR_HEADER } from '@/server/http/client-ip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as requestCodeRoute } from './request-code/route';
import { POST as verifyCodeRoute } from './verify-code/route';
import { POST as logoutRoute } from './logout/route';
import { GET as meRoute } from '../me/route';

/**
 * The sign-in flow, through the real routes, with the console provider.
 *
 * The console provider is not mocked: the test reads the code out of the log line
 * it prints, exactly as a developer does locally. That keeps the route, the
 * service, the provider interface and the cookie in the same test.
 */

const ORIGIN = 'https://streetboys.example';
const EMAIL = 'player@example.com';

type Captured = { code: string; to: string };

let captured: Captured[] = [];

beforeEach(async () => {
  await truncateAll();
  resetEnvCache();
  captured = [];
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('EMAIL_PROVIDER', 'console');
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  vi.stubEnv('OTP_PEPPER', 'test-otp-pepper-0123456789abcdefghij');
  vi.stubEnv('IP_HASH_PEPPER', 'test-pepper-not-a-real-secret-0123456789abcdef');
  vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
    const text = String(line);
    const match = /-> ([^:]+): (\d{6}) /.exec(text);
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

async function requestCode(email = EMAIL, headers: Record<string, string> = {}): Promise<Response> {
  return requestCodeRoute(post('/api/auth/request-code', { email }, headers));
}

async function verify(
  email: string,
  code: string,
  details?: { acceptTerms: true; ageBand: 'under_18' | '18_plus' },
): Promise<Response> {
  return verifyCodeRoute(post('/api/auth/verify-code', { email, code, details }));
}

function lastCode(): string {
  const last = captured.at(-1);
  if (!last) throw new Error('no code was sent');
  return last.code;
}

/** Clear the cooldown so a test can request again immediately. */
async function clearCooldown(): Promise<void> {
  await getPool().query(`delete from rate_limits where key like 'otp:cooldown:%'`);
}

describe('POST /api/auth/request-code', () => {
  it('answers identically for a new address, an existing one and a frozen one', async () => {
    const first = await requestCode('new@example.com');

    await getPool().query(
      `insert into users (email, email_canonical) values ('existing@example.com', 'existing@example.com')`,
    );
    const second = await requestCode('existing@example.com');

    await getPool().query(
      `insert into users (email, email_canonical, status) values ('frozen@example.com', 'frozen@example.com', 'frozen')`,
    );
    const third = await requestCode('frozen@example.com');

    for (const response of [first, second, third]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'sent' });
    }
  });

  it('sends nothing to a frozen account but says it did', async () => {
    await getPool().query(
      `insert into users (email, email_canonical, status) values ('frozen2@example.com', 'frozen2@example.com', 'frozen')`,
    );
    captured = [];

    const response = await requestCode('frozen2@example.com');

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(0);
  });

  it('refuses a disposable domain and a malformed address', async () => {
    expect((await requestCode('someone@mailinator.com')).status).toBe(400);
    expect((await requestCode('not-an-email')).status).toBe(400);
  });

  it('enforces the 60 second cooldown with Retry-After', async () => {
    await requestCode();
    const second = await requestCode();

    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await second.json()).toEqual({ error: 'rate_limited' });
  });

  it('enforces five requests an hour per address', async () => {
    for (let i = 0; i < 5; i += 1) {
      await clearCooldown();
      expect((await requestCode()).status).toBe(200);
    }
    await clearCooldown();
    const sixth = await requestCode();
    expect(sixth.status).toBe(429);
  });

  it('enforces the per-IP limit across different addresses', async () => {
    for (let i = 0; i < 20; i += 1) {
      await clearCooldown();
      await requestCode(`person${i}@example.com`, { [FORWARDED_FOR_HEADER]: '203.0.113.7' });
    }
    await clearCooldown();
    const blocked = await requestCode('another@example.com', {
      [FORWARDED_FOR_HEADER]: '203.0.113.7',
    });
    expect(blocked.status).toBe(429);
  });

  it('returns send_failed and burns the code when the provider fails', async () => {
    vi.stubEnv('EMAIL_PROVIDER', 'brevo');
    vi.stubEnv('BREVO_API_KEY', 'test-key');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'noreply@example.com');
    vi.stubEnv('EMAIL_FROM_NAME', 'Street Boys');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 400 })));
    resetEnvCache();

    const response = await requestCode('failure@example.com');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'send_failed' });

    const rows = await getPool().query<{ consumed_at: Date | null }>(
      `select consumed_at from auth_otps where email_canonical = 'failure@example.com'`,
    );
    expect(rows.rows[0]!.consumed_at).not.toBeNull();
  });

  it('invalidates the previous code when a new one is requested', async () => {
    await requestCode();
    const firstCode = lastCode();
    await clearCooldown();
    await requestCode();
    const secondCode = lastCode();

    expect(secondCode).not.toBe(firstCode);
    const old = await verify(EMAIL, firstCode);
    expect(old.status).toBe(400);
    expect(await old.json()).toEqual({ error: 'invalid_or_expired' });
  });
});

describe('POST /api/auth/verify-code', () => {
  it('asks for details on a new address without consuming the code', async () => {
    await requestCode();
    const code = lastCode();

    const first = await verify(EMAIL, code);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'details_required' });

    const rows = await getPool().query<{ consumed_at: Date | null }>(
      `select consumed_at from auth_otps where email_canonical = $1`,
      [EMAIL],
    );
    expect(rows.rows[0]!.consumed_at).toBeNull();

    // The same digits work again, now with details.
    const second = await verify(EMAIL, code, { acceptTerms: true, ageBand: '18_plus' });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: 'signed_in', hasCharacter: false });
    expect(second.headers.get('set-cookie')).toContain('sb_session=');
  });

  it('creates the user with the terms version and age band', async () => {
    await requestCode();
    await verify(EMAIL, lastCode(), { acceptTerms: true, ageBand: 'under_18' });

    const { rows } = await getPool().query<{
      verification_level: number;
      terms_version: string;
      age_band: string;
      email_verified_at: Date | null;
    }>(
      `select verification_level, terms_version, age_band, email_verified_at from users where email_canonical = $1`,
      [EMAIL],
    );
    expect(rows[0]).toMatchObject({
      verification_level: 1,
      terms_version: '2026-11-01',
      age_band: 'under_18',
    });
    expect(rows[0]!.email_verified_at).not.toBeNull();
  });

  it('counts a wrong code and locks out after five, refusing the correct one', async () => {
    await requestCode();
    const code = lastCode();

    for (let i = 0; i < 5; i += 1) {
      const response = await verify(EMAIL, '000000');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_or_expired' });
    }

    const correct = await verify(EMAIL, code, { acceptTerms: true, ageBand: '18_plus' });
    expect(correct.status).toBe(400);
  });

  it('refuses an expired code', async () => {
    await requestCode();
    const code = lastCode();
    await getPool().query(`update auth_otps set expires_at = now() - interval '1 minute'`);

    const response = await verify(EMAIL, code, { acceptTerms: true, ageBand: '18_plus' });
    expect(await response.json()).toEqual({ error: 'invalid_or_expired' });
  });

  it('refuses a reused code', async () => {
    await requestCode();
    const code = lastCode();

    expect((await verify(EMAIL, code, { acceptTerms: true, ageBand: '18_plus' })).status).toBe(200);
    const second = await verify(EMAIL, code, { acceptTerms: true, ageBand: '18_plus' });
    expect(await second.json()).toEqual({ error: 'invalid_or_expired' });
  });

  it('refuses a code sent to another address', async () => {
    await requestCode('owner@example.com');
    const code = lastCode();

    const response = await verify('stranger@example.com', code);
    expect(await response.json()).toEqual({ error: 'invalid_or_expired' });
  });

  it('gives exactly one session out of twenty concurrent verifications', async () => {
    await requestCode();
    const code = lastCode();
    await verify(EMAIL, code, { acceptTerms: true, ageBand: '18_plus' });

    // Signed in once. Request a fresh code and race the verification of it.
    await clearCooldown();
    await requestCode();
    const fresh = lastCode();

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        verify(EMAIL, fresh, { acceptTerms: true, ageBand: '18_plus' }),
      ),
    );

    const signedIn = responses.filter((r) => r.status === 200);
    expect(signedIn).toHaveLength(1);

    // The rest are refused: either the code was already consumed or the per-email
    // verify limit (10 an hour) stopped them first. Either way, one session.
    expect(responses.filter((r) => r.status !== 200)).toHaveLength(19);
    // Two sessions in total: the first sign-in at the top of this test, plus the
    // one this race produced. The race added exactly one.
    const sessions = await getPool().query<{ count: number }>(
      'select count(*)::int as count from sessions',
    );
    expect(sessions.rows[0]!.count).toBe(2);
  });

  it('never signs in a frozen or banned account', async () => {
    for (const status of ['frozen', 'banned'] as const) {
      const email = `${status}@example.com`;

      // The code is requested while the address is still unknown, because a
      // frozen account is deliberately sent nothing to read a code from.
      await clearCooldown();
      await requestCode(email);

      await getPool().query(
        `insert into users (email, email_canonical, status) values ($1, $1, $2)`,
        [email, status],
      );
      const response = await verify(email, lastCode(), {
        acceptTerms: true,
        ageBand: '18_plus',
      });

      expect(await response.json()).toEqual({ error: 'invalid_or_expired' });
      const sessions = await getPool().query(`select 1 from sessions`);
      expect(sessions.rows).toHaveLength(0);
    }
  });

  it('records the login time and returns a cookie without the raw token in the database', async () => {
    await requestCode();
    const response = await verify(EMAIL, lastCode(), { acceptTerms: true, ageBand: '18_plus' });
    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /sb_session=([^;]+)/.exec(cookie)?.[1];

    expect(token).toBeTruthy();

    const { rows } = await getPool().query<{ token_hash: string; last_login_at: Date | null }>(
      `select s.token_hash, u.last_login_at
         from sessions s join users u on u.id = s.user_id`,
    );
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.last_login_at).not.toBeNull();
  });
});

describe('GET /api/me and logout', () => {
  async function signIn(): Promise<string> {
    await requestCode();
    const response = await verify(EMAIL, lastCode(), { acceptTerms: true, ageBand: '18_plus' });
    return /sb_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')![1]!;
  }

  function me(token?: string): Request {
    return new Request(`${ORIGIN}/api/me`, {
      headers: token ? { cookie: `sb_session=${token}` } : {},
    });
  }

  it('is 401 when signed out', async () => {
    const response = await meRoute(me());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('is 200 with the user and no character yet', async () => {
    const token = await signIn();
    const response = await meRoute(me(token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      email: EMAIL,
      status: 'active',
      verificationLevel: 1,
      ageBand: '18_plus',
      character: null,
    });
  });

  it('returns the character when one exists', async () => {
    const token = await signIn();
    const { rows } = await getPool().query<{ id: string }>('select id from users');
    await getPool().query(
      `insert into characters (user_id, name, name_canonical, avatar)
       values ($1, 'Ada', 'ada', '{"skinTone":2,"hair":3,"outfit":4}'::jsonb)`,
      [rows[0]!.id],
    );

    const body = await (await meRoute(me(token))).json();
    expect(body.character).toEqual({ name: 'Ada', avatar: { skinTone: 2, hair: 3, outfit: 4 } });
  });

  it('revokes the session on logout, and /api/me is then 401', async () => {
    const token = await signIn();

    const logout = await logoutRoute(
      new Request(`${ORIGIN}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `sb_session=${token}`,
        },
        body: '{}',
      }),
    );

    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await meRoute(me(token))).status).toBe(401);
  });

  it('is idempotent when logging out twice or without a cookie', async () => {
    const token = await signIn();
    const make = () =>
      new Request(`${ORIGIN}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `sb_session=${token}`,
        },
        body: '{}',
      });

    expect((await logoutRoute(make())).status).toBe(204);
    expect((await logoutRoute(make())).status).toBe(204);
  });

  it('sends no-store on every auth response', async () => {
    const sent = await requestCode('cache@example.com');
    expect(sent.headers.get('cache-control')).toBe('no-store');
    expect((await meRoute(me())).headers.get('cache-control')).toBe('no-store');
  });
});

describe('nothing sensitive is written down', () => {
  it('keeps raw emails, codes, tokens and IPs out of rate_limits, audit_log and the logs', async () => {
    const logLines: string[] = [];
    vi.mocked(console.info).mockImplementation((line: unknown) => {
      logLines.push(String(line));
      const match = /-> ([^:]+): (\d{6}) /.exec(String(line));
      if (match) captured.push({ to: match[1]!, code: match[2]! });
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      logLines.push(String(line));
    });

    const email = 'scan@example.com';
    const ip = '198.51.100.23';

    await requestCode(email, { [FORWARDED_FOR_HEADER]: ip });
    const code = lastCode();
    await verify(email, '000000');
    await verify(email, code, { acceptTerms: true, ageBand: '18_plus' });

    const sessions = await getPool().query<{ token_hash: string }>(
      'select token_hash from sessions',
    );
    const tokenHash = sessions.rows[0]?.token_hash ?? '';
    const cookie = /sb_session=([^;]+)/.exec(
      (await verify(email, code, { acceptTerms: true, ageBand: '18_plus' })).headers.get(
        'set-cookie',
      ) ?? '',
    )?.[1];

    const forbidden = [email, 'scan', code, ip, tokenHash, cookie ?? '\u0000'].filter(
      (value) => value.length > 2,
    );

    const rateLimitRows = await getPool().query<{ key: string }>('select key from rate_limits');
    const auditRows = await getPool().query<{ subject: string | null; metadata: unknown }>(
      'select subject, metadata from audit_log',
    );

    const haystacks = [
      ...rateLimitRows.rows.map((row) => row.key),
      ...auditRows.rows.map((row) => `${row.subject ?? ''} ${JSON.stringify(row.metadata)}`),
      // The console provider's own line is the one place the code is meant to
      // appear, and it refuses to run in production. Every other line must be clean.
      ...logLines.filter((line) => !line.startsWith('[dev email]')),
    ];

    expect(haystacks.length).toBeGreaterThan(0);
    for (const haystack of haystacks) {
      for (const value of forbidden) {
        expect(haystack).not.toContain(value);
      }
    }

    expect(auditRows.rows.length).toBeGreaterThan(0);
    errorSpy.mockRestore();
  });
});
