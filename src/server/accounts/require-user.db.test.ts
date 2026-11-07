import { getPool } from '@/server/db/client';
import { truncateAll } from '@/test/db-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { findCharacterByUserId } from './repository';
import { createSession } from './session';
import { findSessionUser } from './session';

beforeEach(async () => {
  await truncateAll();
});

function withCookie(token: string): Request {
  return new Request('http://localhost/home', { headers: { cookie: `sb_session=${token}` } });
}

async function user(status = 'active'): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into users (email, email_canonical, status, email_verified_at)
     values ($1, $1, $2, now()) returning id`,
    [`${status}${Math.random().toString(36).slice(2, 8)}@example.com`, status],
  );
  return rows[0]!.id;
}

describe('character lookup', () => {
  it('is null before a character exists and returns it afterwards', async () => {
    const userId = await user();
    await expect(findCharacterByUserId(userId)).resolves.toBeNull();

    await getPool().query(
      `insert into characters (user_id, name, name_canonical, avatar)
       values ($1, 'Ada', 'ada', '{"skinTone":1,"hair":2,"outfit":3}'::jsonb)`,
      [userId],
    );

    await expect(findCharacterByUserId(userId)).resolves.toEqual({
      id: expect.any(String),
      name: 'Ada',
      avatar: { skinTone: 1, hair: 2, outfit: 3 },
    });
  });
});

describe('frozen accounts at the page layer', () => {
  it('keeps the session readable by status so the page can say unavailable, not signed out', async () => {
    const userId = await user('frozen');
    const { token } = await createSession({ userId });

    // findSessionUser is the raw lookup: it still finds a frozen account, which is
    // how the page distinguishes "sign in" from "account unavailable".
    const raw = await findSessionUser(withCookie(token));
    expect(raw?.status).toBe('frozen');

    // getCurrentUser, which every API route uses, hides it.
    const { getCurrentUser } = await import('./session');
    await expect(getCurrentUser(withCookie(token))).resolves.toBeNull();
  });
});
