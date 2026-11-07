import type { PoolClient } from 'pg';
import { getEnv } from '@/server/config/env';
import { getPool } from '@/server/db/client';
import { randomToken, sha256Hex } from '@/server/security/crypto';

/**
 * Sessions: a random bearer token in a cookie, and nothing reversible in the
 * database. The table stores the SHA-256 of the token, so a database read does
 * not produce a usable session.
 *
 * Expiry is both sliding and absolute. A player who keeps playing stays signed
 * in, because `expires_at` moves forward, but never past `absolute_expires_at`:
 * a stolen cookie has a ceiling, and a session that is used every day still has
 * to be re-proven eventually.
 *
 * Frozen and banned status is checked on **every** request, not at sign-in only,
 * so freezing an account takes effect on the next click rather than in thirty days.
 */

export const SLIDING_DAYS = 30;
export const ABSOLUTE_DAYS = 90;
export const MAX_ACTIVE_SESSIONS = 5;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `__Host-` in production pins the cookie to this exact host, forbids a Domain
 * attribute, and requires Secure: three browser rules that make subdomain cookie
 * injection impossible. It is dropped outside production because `__Host-`
 * requires HTTPS and would make local development impossible.
 */
export function sessionCookieName(env = getEnv()): string {
  return env.NODE_ENV === 'production' ? '__Host-sb_session' : 'sb_session';
}

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: '/';
    maxAge: number;
  };
};

export function buildSessionCookie(token: string, env = getEnv()): SessionCookie {
  return {
    name: sessionCookieName(env),
    value: token,
    options: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SLIDING_DAYS * 24 * 60 * 60,
    },
  };
}

/** The same cookie, emptied, for a logout response. */
export function clearedSessionCookie(env = getEnv()): SessionCookie {
  return {
    ...buildSessionCookie('', env),
    value: '',
    options: { ...buildSessionCookie('', env).options, maxAge: 0 },
  };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Create a session row on an existing client, so a caller inside a transaction
 * can create the user and the session together or not at all.
 */
export async function createSessionRow(
  client: PoolClient,
  input: { userId: string; ipHash?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SLIDING_DAYS * DAY_MS);
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_DAYS * DAY_MS);

  await client.query(
    `insert into sessions (user_id, token_hash, ip_hash, expires_at, absolute_expires_at, last_seen_at)
     values ($1, $2, $3, $4, $5, now())`,
    [input.userId, tokenHash, input.ipHash ?? null, expiresAt, absoluteExpiresAt],
  );

  // Keep only the newest MAX_ACTIVE_SESSIONS. The oldest live one is revoked, not
  // deleted, so the audit trail of "this account was signed in on five devices"
  // survives.
  await client.query(
    `update sessions set revoked_at = now()
      where id in (
        select id from sessions
         where user_id = $1 and revoked_at is null and expires_at > now()
         order by created_at desc
         offset $2
      )`,
    [input.userId, MAX_ACTIVE_SESSIONS],
  );

  return { token, expiresAt };
}

export async function createSession(input: { userId: string; ipHash?: string | null }): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const client = await getPool().connect();
  try {
    return await createSessionRow(client, input);
  } finally {
    client.release();
  }
}

export type CurrentUser = {
  id: string;
  email: string;
  status: 'active' | 'frozen' | 'banned';
  verificationLevel: number;
  ageBand: string | null;
  sessionId: string;
};

/**
 * The session's user **regardless of status**, or null.
 *
 * Only two callers want this: `getCurrentUser`, which then hides a frozen account,
 * and the character route, which has to answer 403 rather than 401 so a player
 * whose account was frozen is told the truth instead of being asked to sign in
 * again. Nothing else should read it, because "signed in" must mean "active".
 */
export async function findSessionUser(
  request: Request,
  now: Date = new Date(),
): Promise<CurrentUser | null> {
  const cookieName = sessionCookieName();
  const token = readCookie(request, cookieName);
  if (!token) return null;

  const tokenHash = sha256Hex(token);
  const { rows } = await getPool().query<{
    session_id: string;
    last_seen_at: Date;
    user_id: string;
    email: string;
    status: 'active' | 'frozen' | 'banned';
    verification_level: number;
    age_band: string | null;
  }>(
    `select s.id as session_id, s.last_seen_at, u.id as user_id, u.email, u.status,
            u.verification_level, u.age_band
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > $2
        and s.absolute_expires_at > $2
      limit 1`,
    [tokenHash, now],
  );

  const row = rows[0];
  if (!row) return null;

  if (now.getTime() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    // Sliding expiry, refreshed at most once an hour so a busy client does not
    // write to the database on every request. Capped by absolute_expires_at.
    await getPool().query(
      `update sessions
          set last_seen_at = $2,
              expires_at = least($2::timestamptz + interval '${SLIDING_DAYS} days', absolute_expires_at)
        where id = $1`,
      [row.session_id, now],
    );
  }

  return {
    id: row.user_id,
    email: row.email,
    status: row.status,
    verificationLevel: row.verification_level,
    ageBand: row.age_band,
    sessionId: row.session_id,
  };
}

/**
 * The signed-in user for this request, or null.
 *
 * Null for a missing, unknown, expired or revoked session, and null for a frozen
 * or banned account, which is what makes a freeze take effect immediately.
 */
export async function getCurrentUser(
  request: Request,
  now: Date = new Date(),
): Promise<CurrentUser | null> {
  const user = await findSessionUser(request, now);
  if (!user || user.status !== 'active') return null;
  return user;
}

/** Revoke this request's session. Idempotent: an unknown token revokes nothing. */
export async function revokeSession(request: Request): Promise<void> {
  const token = readCookie(request, sessionCookieName());
  if (!token) return;

  await getPool().query(
    `update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
    [sha256Hex(token)],
  );
}
