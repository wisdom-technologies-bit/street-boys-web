import type { PoolClient } from 'pg';
import { getPool } from '@/server/db/client';

/**
 * Test support for the ledger.
 *
 * The seeded system accounts are created by the migration, and the harness in
 * `src/test/db-utils.ts` truncates every table between tests, so they have to be
 * seeded again. This file is the only place that does it, so a test never has to
 * remember the exact SQL.
 */

/** Empty the ledger and put the three system accounts back, as the migration left them. */
export async function resetLedger(): Promise<void> {
  await getPool().query(
    'truncate table ledger_entries, ledger_transactions, account_balances, accounts restart identity cascade',
  );
  await seedSystemAccounts();
}

export async function seedSystemAccounts(): Promise<void> {
  await getPool().query(`
    DO $$
    DECLARE seeded record;
    BEGIN
      PERFORM set_config('app.ledger_write', 'on', true);
      INSERT INTO "accounts" ("kind", "code", "allow_negative")
      VALUES ('system', 'SYSTEM_MINT', true), ('system', 'SYSTEM_BURN', false),
             ('treasury', 'TREASURY', false), ('escrow', 'ESCROW_TRANSFERS', false)
      ON CONFLICT ("code") DO NOTHING;
      FOR seeded IN SELECT "id", "allow_negative" FROM "accounts" WHERE "code" IS NOT NULL LOOP
        INSERT INTO "account_balances" ("account_id", "allow_negative")
        VALUES (seeded."id", seeded."allow_negative")
        ON CONFLICT ("account_id") DO NOTHING;
      END LOOP;
    END $$;
  `);
}

/** Run `work` inside the ledger gate, the way the module itself does. */
export async function withLedgerWrite<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.ledger_write', 'on', true)");
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** A player account, created the way the module will create one. */
export async function createTestPlayerAccount(label: string): Promise<string> {
  return withLedgerWrite(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into accounts (kind, owner_user_id) values ('player', $1)
       on conflict (owner_user_id) do update set kind = 'player'
       returning id`,
      [crypto.randomUUID()],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('account insert returned no row');
    await client.query(
      `insert into account_balances (account_id, allow_negative) values ($1, false)
       on conflict (account_id) do nothing`,
      [id],
    );
    void label;
    return id;
  });
}

/** The id of a seeded system account, by code. */
export async function systemAccountId(
  code: 'SYSTEM_MINT' | 'SYSTEM_BURN' | 'TREASURY' | 'ESCROW_TRANSFERS',
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'select id from accounts where code = $1',
    [code],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`system account ${code} is missing; did the migration run?`);
  return id;
}

/** A balance, as a bigint. */
export async function balanceOf(accountId: string): Promise<bigint> {
  const { rows } = await getPool().query<{ balance_kobo: string }>(
    'select balance_kobo from account_balances where account_id = $1',
    [accountId],
  );
  return BigInt(rows[0]?.balance_kobo ?? '0');
}
