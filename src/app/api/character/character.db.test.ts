import { getPool } from '@/server/db/client';
import { resetEnvCache } from '@/server/config/env';
import { truncateAll } from '@/test/db-utils';
import { FORWARDED_FOR_HEADER } from '@/server/http/client-ip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as characterRoute } from './route';
import { POST as requestCodeRoute } from '../auth/request-code/route';
import { POST as verifyCodeRoute } from '../auth/verify-code/route';
import { POST as logoutRoute } from '../auth/logout/route';
import { GET as meRoute } from '../me/route';

/**
 * Character creation through the real route, with real sessions.
 *
 * A session is minted the same way a player gets one: request a code, read it out
 * of the console provider, verify it with details.
 */

const ORIGIN = 'https://streetboys.example';

type Captured = { to: string; code: string };
let captured: Captured[] = [];

beforeEach(async () => {
  await truncateAll();
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

async function signUp(email = 'player@example.com'): Promise<{ token: string; userId: string }> {
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
  const { rows } = await getPool().query<{ id: string }>('select id from users');
  return { token, userId: rows[0]!.id };
}

const VALID = { name: 'Ada', avatar: { skinTone: 2, hair: 3, outfit: 4 } };

async function create(token: string, body: unknown = VALID, headers = {}): Promise<Response> {
  return characterRoute(
    post('/api/character', body, { cookie: `sb_session=${token}`, ...headers }),
  );
}

describe('POST /api/character', () => {
  it('is 401 when signed out', async () => {
    const response = await characterRoute(post('/api/character', VALID));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('is 403 when the account is frozen', async () => {
    const { token, userId } = await signUp();
    await getPool().query(`update users set status = 'frozen' where id = $1`, [userId]);

    const response = await create(token);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('is 403 when the account is banned', async () => {
    const { token, userId } = await signUp();
    await getPool().query(`update users set status = 'banned' where id = $1`, [userId]);

    expect((await create(token)).status).toBe(403);
  });

  it('creates the character and returns it', async () => {
    const { token } = await signUp();
    const response = await create(token);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(VALID);

    const { rows } = await getPool().query<{ name: string; name_canonical: string }>(
      'select name, name_canonical from characters',
    );
    expect(rows[0]).toEqual({ name: 'Ada', name_canonical: 'ada' });
  });

  it('answers no-store', async () => {
    const { token } = await signUp();
    expect((await create(token)).headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a second character for the same account', async () => {
    const { token } = await signUp();
    await create(token);

    const second = await create(token, { ...VALID, name: 'Bola' });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'already_has_character' });
  });

  it('refuses a name taken in a different case or with an underscore', async () => {
    const first = await signUp('first@example.com');
    await create(first.token);

    const second = await signUp('second@example.com');
    for (const name of ['ADA', 'ada', 'A_da']) {
      const response = await create(second.token, { ...VALID, name });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'name_taken' });
    }
  });

  it('refuses a reserved name and a blocked word', async () => {
    const { token } = await signUp();

    for (const name of ['System', 'Admin', 'Support']) {
      const response = await create(token, { ...VALID, name });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'name_not_allowed' });
    }
  });

  it('refuses a name that breaks the shape rules', async () => {
    const { token } = await signUp();

    for (const name of ['Ab', 'a'.repeat(21), 'Ada!', ' Ada', 'Ada  Bola']) {
      const response = await create(token, { ...VALID, name });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'name_not_allowed' });
    }
  });

  it('refuses avatar ids that are not in the option lists', async () => {
    const { token } = await signUp();

    for (const avatar of [
      { skinTone: 7, hair: 1, outfit: 1 },
      { skinTone: 1, hair: 0, outfit: 1 },
      { skinTone: 1, hair: 1, outfit: 9 },
      { skinTone: '1', hair: 1, outfit: 1 },
      {},
    ]) {
      const response = await create(token, { ...VALID, avatar });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'avatar_invalid' });
    }
  });

  it('refuses a body that is not the expected shape', async () => {
    const { token } = await signUp();
    for (const body of [{}, { name: '' }, { avatar: VALID.avatar }, 'nope', []]) {
      const response = await create(token, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('refuses a foreign origin and a form content type', async () => {
    const { token } = await signUp();

    const foreign = await characterRoute(
      new Request(`${ORIGIN}/api/character`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          host: 'streetboys.example',
          cookie: `sb_session=${token}`,
        },
        body: JSON.stringify(VALID),
      }),
    );
    expect(foreign.status).toBe(403);

    const form = await characterRoute(
      new Request(`${ORIGIN}/api/character`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: ORIGIN,
          cookie: `sb_session=${token}`,
        },
        body: JSON.stringify(VALID),
      }),
    );
    expect(form.status).toBe(403);
  });

  it('limits one account to ten attempts an hour', async () => {
    const { token } = await signUp();

    for (let i = 0; i < 10; i += 1) {
      const response = await create(token, {
        ...VALID,
        avatar: { skinTone: 9, hair: 1, outfit: 1 },
      });
      expect(response.status).toBe(400);
    }

    const limited = await create(token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
  });

  it('gives exactly one character out of twenty concurrent creations', async () => {
    const { token } = await signUp();

    const responses = await Promise.all(Array.from({ length: 20 }, () => create(token)));
    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    const limited = responses.filter((r) => r.status === 429);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
    expect(limited).toHaveLength(10);

    const { rows } = await getPool().query<{ count: number }>(
      'select count(*)::int as count from characters',
    );
    expect(rows[0]!.count).toBe(1);
  });

  it('writes an audit event with the user id and no name', async () => {
    const { token, userId } = await signUp();
    await create(token);

    const { rows } = await getPool().query<{
      event_type: string;
      subject: string;
      metadata: unknown;
    }>(`select event_type, subject, metadata from audit_log where event_type like 'character%'`);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe(userId);
    const serialised = JSON.stringify(rows[0]!.metadata);
    expect(serialised).not.toContain('Ada');
    expect(serialised.toLowerCase()).not.toContain('ada');
  });
});

describe('the whole journey, through the routes', () => {
  it('signs in, creates a character, sees it at /api/me and signs out', async () => {
    const { token } = await signUp('journey@example.com');

    expect(
      (await characterRoute(post('/api/character', VALID, { cookie: `sb_session=${token}` })))
        .status,
    ).toBe(201);

    const me = async (): Promise<Response> =>
      meRoute(new Request(`${ORIGIN}/api/me`, { headers: { cookie: `sb_session=${token}` } }));

    const body = (await (await me()).json()) as { character: unknown };
    expect(body.character).toEqual({ name: 'Ada', avatar: { skinTone: 2, hair: 3, outfit: 4 } });

    const logout = await logoutRoute(
      post('/api/auth/logout', {}, { cookie: `sb_session=${token}` }),
    );
    expect(logout.status).toBe(204);
    expect((await me()).status).toBe(401);
  });
});
