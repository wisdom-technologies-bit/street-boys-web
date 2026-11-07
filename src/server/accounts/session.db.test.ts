import { getPool } from '@/server/db/client';
import { sha256Hex } from '@/server/security/crypto';
import { truncateAll } from '@/test/db-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ABSOLUTE_DAYS,
  MAX_ACTIVE_SESSIONS,
  SLIDING_DAYS,
  buildSessionCookie,
  clearedSessionCookie,
  createSession,
  getCurrentUser,
  revokeSession,
  sessionCookieName,
} from './session';

beforeEach(async () => {
  await truncateAll();
});

async function makeUser(email = 'player@example.com'): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into users (email, email_canonical, email_verified_at) values ($1, $1, now()) returning id`,
    [email],
  );
  return rows[0]!.id;
}

function withCookie(token: string, name = sessionCookieName()): Request {
  return new Request('http://localhost/api/me', { headers: { cookie: `${name}=${token}` } });
}

describe('session tokens', () => {
  it('stores only the SHA-256 hash of the token', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });

    const { rows } = await getPool().query<{ token_hash: string }>(
      'select token_hash from sessions',
    );
    expect(rows[0]!.token_hash).toBe(sha256Hex(token));
    expect(rows[0]!.token_hash).not.toBe(token);
  });

  it('resolves the user from the cookie', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });

    const current = await getCurrentUser(withCookie(token));
    expect(current?.id).toBe(userId);
  });
});

describe('cookie rules', () => {
  it('uses the __Host- name and Secure in production', () => {
    const env = { NODE_ENV: 'production' } as never;
    expect(sessionCookieName(env)).toBe('__Host-sb_session');

    const cookie = buildSessionCookie('token-value', env);
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(cookie.options).not.toHaveProperty('domain');
  });

  it('drops the __Host- prefix and Secure outside production', () => {
    const env = { NODE_ENV: 'development' } as never;
    expect(sessionCookieName(env)).toBe('sb_session');
    expect(buildSessionCookie('t', env).options.secure).toBe(false);
  });

  it('clears the cookie with an empty value and no lifetime', () => {
    const cleared = clearedSessionCookie({ NODE_ENV: 'development' } as never);
    expect(cleared.value).toBe('');
    expect(cleared.options.maxAge).toBe(0);
  });
});

describe('session lifetime', () => {
  it('rejects an unknown token', async () => {
    await expect(getCurrentUser(withCookie('not-a-real-token'))).resolves.toBeNull();
  });

  it('rejects an expired session', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });
    await getPool().query(`update sessions set expires_at = now() - interval '1 minute'`);

    await expect(getCurrentUser(withCookie(token))).resolves.toBeNull();
  });

  it('rejects a session past its absolute ceiling even when recently used', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });
    await getPool().query(
      `update sessions set absolute_expires_at = now() - interval '1 minute', expires_at = now() + interval '10 days'`,
    );

    await expect(getCurrentUser(withCookie(token))).resolves.toBeNull();
  });

  it('slides the expiry forward on use, at most once an hour', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });

    await getPool().query(
      `update sessions set last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day'`,
    );

    await getCurrentUser(withCookie(token));

    const { rows } = await getPool().query<{ days: string }>(
      `select extract(day from expires_at - now())::int as days from sessions`,
    );
    expect(Number(rows[0]!.days)).toBeGreaterThanOrEqual(SLIDING_DAYS - 1);

    const before = await getPool().query<{ last_seen_at: Date }>(
      'select last_seen_at from sessions',
    );
    await getCurrentUser(withCookie(token));
    const after = await getPool().query<{ last_seen_at: Date }>(
      'select last_seen_at from sessions',
    );
    expect(after.rows[0]!.last_seen_at).toEqual(before.rows[0]!.last_seen_at);
  });

  it('never extends past the absolute ceiling', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });
    await getPool().query(
      `update sessions
          set last_seen_at = now() - interval '2 hours',
              absolute_expires_at = now() + interval '3 days',
              expires_at = now() + interval '1 day'`,
    );

    await getCurrentUser(withCookie(token));

    const { rows } = await getPool().query<{ capped: boolean }>(
      `select expires_at <= absolute_expires_at as capped from sessions`,
    );
    expect(rows[0]!.capped).toBe(true);
    expect(ABSOLUTE_DAYS).toBeGreaterThan(SLIDING_DAYS);
  });
});

describe('revocation and limits', () => {
  it('rejects a revoked session', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });

    await revokeSession(withCookie(token));

    await expect(getCurrentUser(withCookie(token))).resolves.toBeNull();
  });

  it('is idempotent when logging out twice', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });

    await revokeSession(withCookie(token));
    await expect(revokeSession(withCookie(token))).resolves.toBeUndefined();
  });

  it('revokes the oldest session when a sixth is created', async () => {
    const userId = await makeUser();
    const tokens: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_SESSIONS + 1; i += 1) {
      const { token } = await createSession({ userId });
      tokens.push(token);
    }

    const active = await getPool().query<{ count: number }>(
      'select count(*)::int as count from sessions where revoked_at is null',
    );
    expect(active.rows[0]!.count).toBe(MAX_ACTIVE_SESSIONS);

    await expect(getCurrentUser(withCookie(tokens[0]!))).resolves.toBeNull();
    await expect(getCurrentUser(withCookie(tokens[tokens.length - 1]!))).resolves.not.toBeNull();
  });

  it('rejects a frozen user on the next request, mid-session', async () => {
    const userId = await makeUser();
    const { token } = await createSession({ userId });
    await expect(getCurrentUser(withCookie(token))).resolves.not.toBeNull();

    await getPool().query(`update users set status = 'frozen' where id = $1`, [userId]);
    await expect(getCurrentUser(withCookie(token))).resolves.toBeNull();

    await getPool().query(`update users set status = 'banned' where id = $1`, [userId]);
    await expect(getCurrentUser(withCookie(token))).resolves.toBeNull();
  });
});
