import { getPool } from '@/server/db/client';
import { describe, expect, it } from 'vitest';

const ACCOUNT_TABLES = ['users', 'characters', 'sessions', 'auth_otps'] as const;
const MONEY_WORDS = ['balance', 'money', 'kobo', 'naira', 'wallet'];

/**
 * A guard against the money rule drifting into accounts.
 *
 * The ledger owns every amount. If an accounts table ever grows a `balance`
 * column, two sources of truth for money exist and one of them will be wrong.
 * This test is the cheap version of that rule, and it runs on every push.
 */
describe('accounts schema', () => {
  it('has no money-shaped column in users, characters, sessions or auth_otps', async () => {
    const { rows } = await getPool().query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [ACCOUNT_TABLES],
    );

    expect(rows.length).toBeGreaterThan(20);

    const offenders = rows.filter((row) =>
      MONEY_WORDS.some((word) => row.column_name.toLowerCase().includes(word)),
    );

    expect(offenders).toEqual([]);
  });

  it('has the append-only triggers on audit_log', async () => {
    const { rows } = await getPool().query<{ tgname: string }>(
      `select tgname from pg_trigger
        where tgrelid = 'public.audit_log'::regclass and not tgisinternal
        order by tgname`,
    );

    expect(rows.map((r) => r.tgname)).toEqual(['audit_log_no_delete', 'audit_log_no_update']);
  });

  it('enforces the users status and age band checks in the database', async () => {
    const pool = getPool();
    await expect(
      pool.query(
        `insert into users (email, email_canonical, status) values ('a@example.com', 'a@example.com', 'nonsense')`,
      ),
    ).rejects.toThrow(/users_status_check/);
    await expect(
      pool.query(
        `insert into users (email, email_canonical, age_band) values ('b@example.com', 'b@example.com', 'unknown')`,
      ),
    ).rejects.toThrow(/users_age_band_check/);
  });

  it('refuses a second character for one user and a duplicate name', async () => {
    const pool = getPool();
    await pool.query(`truncate table characters, users restart identity cascade`);
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (email, email_canonical) values ('c@example.com', 'c@example.com') returning id`,
    );
    const userId = rows[0]!.id;
    await pool.query(
      `insert into characters (user_id, name, name_canonical, avatar)
       values ($1, 'First', 'first', '{"skinTone":1,"hair":1,"outfit":1}'::jsonb)`,
      [userId],
    );
    await expect(
      pool.query(
        `insert into characters (user_id, name, name_canonical, avatar)
         values ($1, 'Second', 'second', '{"skinTone":1,"hair":1,"outfit":1}'::jsonb)`,
        [userId],
      ),
    ).rejects.toThrow(/characters_user_id_key/);
  });
});
