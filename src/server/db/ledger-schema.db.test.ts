import { getPool } from '@/server/db/client';
import { postTransaction } from '@/server/ledger';
import {
  balanceOf,
  createTestPlayerAccount,
  resetLedger,
  systemAccountId,
  withLedgerWrite,
} from '@/server/ledger/test-support';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The database guarantees, proved at the raw-SQL level.
 *
 * These tests deliberately bypass the module: if a migration, a repair script or
 * a future agent writes these tables by hand, the database still refuses to let
 * money appear, disappear, be edited or be deleted. That is the point of putting
 * the rules in the schema rather than in TypeScript.
 */

const LEDGER_TABLES = ['accounts', 'account_balances', 'ledger_transactions', 'ledger_entries'];

beforeEach(async () => {
  await resetLedger();
});

afterAll(async () => {
  await resetLedger();
});

/** Insert a transaction with the given entries in one shot, so the commit decides. */
async function attemptTransaction(entries: Array<{ accountId: string; amount: bigint }>) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    // Raw inserts must open the same gate the module uses (drizzle/0003).
    await client.query("select set_config('app.ledger_write', 'on', true)");
    const { rows } = await client.query<{ id: string }>(
      `insert into ledger_transactions (idempotency_key, request_fingerprint, category)
       values ($1, 'fingerprint', 'onboarding_grant') returning id`,
      [`raw-${crypto.randomUUID()}`],
    );
    const transactionId = rows[0]?.id as string;
    for (const entry of entries) {
      await client.query(
        'insert into ledger_entries (transaction_id, account_id, amount_kobo) values ($1, $2, $3)',
        [transactionId, entry.accountId, entry.amount.toString()],
      );
    }
    await client.query('commit');
    return transactionId;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

describe('ledger schema: money types', () => {
  it('stores every amount as bigint and never as a float or numeric', async () => {
    const { rows } = await getPool().query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [LEDGER_TABLES],
    );

    expect(rows.length).toBeGreaterThan(15);

    const floatish = rows.filter((row) =>
      ['numeric', 'real', 'double precision', 'money'].includes(row.data_type),
    );
    expect(floatish).toEqual([]);

    const amounts = rows.filter((row) => row.column_name.includes('kobo'));
    expect(amounts.length).toBeGreaterThan(0);
    for (const column of amounts) expect(column.data_type, column.column_name).toBe('bigint');
  });
});

describe('ledger schema: the accounts', () => {
  it('seeds the fixed accounts, and only MINT may go negative', async () => {
    const { rows } = await getPool().query<{ code: string; kind: string; allow_negative: boolean }>(
      'select code, kind, allow_negative from accounts where code is not null order by code',
    );

    expect(rows).toEqual([
      { code: 'ESCROW_TRANSFERS', kind: 'escrow', allow_negative: false },
      { code: 'SYSTEM_BURN', kind: 'system', allow_negative: false },
      { code: 'SYSTEM_MINT', kind: 'system', allow_negative: true },
      { code: 'TREASURY', kind: 'treasury', allow_negative: false },
    ]);

    const { rows: balances } = await getPool().query<{ count: string }>(
      'select count(*)::text as count from account_balances b join accounts a on a.id = b.account_id where a.code is not null and b.balance_kobo = 0',
    );
    expect(balances[0]?.count).toBe('4');
  });

  it('gives a player exactly one account, and gives a system account a code instead of an owner', async () => {
    const playerId = await createTestPlayerAccount('one');

    const { rows: owned } = await getPool().query<{ owner_user_id: string }>(
      'select owner_user_id from accounts where id = $1',
      [playerId],
    );
    const ownerUserId = owned[0]?.owner_user_id as string;

    await expect(
      withLedgerWrite((client) =>
        client.query('insert into accounts (kind, owner_user_id) values ($1, $2)', [
          'player',
          ownerUserId,
        ]),
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    // A player with a code, or a system account with an owner, is refused.
    await expect(
      withLedgerWrite((client) =>
        client.query("insert into accounts (kind, code) values ('player', 'NOT_ALLOWED')"),
      ),
    ).rejects.toThrow(/accounts_owner_or_code_check/);
    await expect(
      withLedgerWrite((client) =>
        client.query(
          "insert into accounts (kind, owner_user_id) values ('system', gen_random_uuid())",
        ),
      ),
    ).rejects.toThrow(/accounts_owner_or_code_check/);
  });
});

describe('ledger schema: guarantee 1, a transaction balances', () => {
  it('rejects an unbalanced transaction at commit', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('unbalanced');

    await expect(
      attemptTransaction([
        { accountId: mint, amount: -100n },
        { accountId: player, amount: 90n },
      ]),
    ).rejects.toThrow(/does not balance/);
  });

  it('rejects a transaction with a single entry', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');

    await expect(attemptTransaction([{ accountId: mint, amount: 100n }])).rejects.toThrow(
      /at least 2 are required/,
    );
  });

  it('accepts a balanced transaction and writes its two entries', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('balanced');

    const transactionId = await attemptTransaction([
      { accountId: mint, amount: -1500n },
      { accountId: player, amount: 1500n },
    ]);

    const { rows } = await getPool().query<{ count: string }>(
      'select count(*)::text as count from ledger_entries where transaction_id = $1',
      [transactionId],
    );
    expect(rows[0]?.count).toBe('2');
    // Raw entries do not move balances: only the ledger module writes
    // account_balances. A raw insert can therefore leave entries and balances
    // disagreeing, which is why nothing but the module may write this table, and
    // why a least-privilege database role is a later hardening task (D-151 note).
    expect(await balanceOf(mint)).toBe(0n);
    expect(await balanceOf(player)).toBe(0n);
  });
});

describe('ledger schema: guarantee 2, append only', () => {
  it('blocks UPDATE and DELETE on both ledger tables', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('append-only');
    const transactionId = await attemptTransaction([
      { accountId: mint, amount: -500n },
      { accountId: player, amount: 500n },
    ]);

    await expect(
      getPool().query('update ledger_transactions set category = $1 where id = $2', [
        'transfer',
        transactionId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      getPool().query('delete from ledger_entries where transaction_id = $1', [transactionId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      getPool().query('delete from ledger_transactions where id = $1', [transactionId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      getPool().query('update ledger_entries set amount_kobo = 1 where transaction_id = $1', [
        transactionId,
      ]),
    ).rejects.toThrow(/append-only/);
  });
});

describe('ledger schema: guarantee 3 and 4, balances', () => {
  it('refuses a balance written without the ledger gate', async () => {
    const player = await createTestPlayerAccount('no-gate');

    await expect(
      getPool().query('update account_balances set balance_kobo = 1000000 where account_id = $1', [
        player,
      ]),
    ).rejects.toThrow(/only by the ledger module/);

    await expect(
      getPool().query(
        'insert into account_balances (account_id, allow_negative) values (gen_random_uuid(), false)',
      ),
    ).rejects.toThrow(/only by the ledger module|foreign key/i);
  });

  it('refuses to change allow_negative once the row exists', async () => {
    const player = await createTestPlayerAccount('immutable');

    await expect(
      withLedgerWrite((client) =>
        client.query('update account_balances set allow_negative = true where account_id = $1', [
          player,
        ]),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('lets MINT go negative and stops BURN, TREASURY and a player from doing the same', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const burn = await systemAccountId('SYSTEM_BURN');
    const treasury = await systemAccountId('TREASURY');
    const player = await createTestPlayerAccount('overdraft');

    await withLedgerWrite((client) =>
      client.query('update account_balances set balance_kobo = -5000 where account_id = $1', [
        mint,
      ]),
    );
    expect(await balanceOf(mint)).toBe(-5000n);

    for (const accountId of [burn, treasury, player]) {
      await expect(
        withLedgerWrite((client) =>
          client.query('update account_balances set balance_kobo = -1 where account_id = $1', [
            accountId,
          ]),
        ),
      ).rejects.toThrow(/account_balances_overdraft_check/);
    }
  });
});

describe('ledger schema: the insert guard', () => {
  it('refuses a raw transaction or entry without the ledger gate', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('guard');

    await expect(
      getPool().query(
        `insert into ledger_transactions (idempotency_key, request_fingerprint, category)
         values ('unguarded', 'fingerprint', 'onboarding_grant')`,
      ),
    ).rejects.toThrow(/only by the ledger module/);

    // And an entry, even for a transaction that was posted properly.
    const posted = await postTransaction({
      idempotencyKey: 'guarded-1',
      category: 'onboarding_grant',
      entries: [
        { accountId: mint, amountKobo: -100n },
        { accountId: player, amountKobo: 100n },
      ],
    });

    await expect(
      getPool().query(
        'insert into ledger_entries (transaction_id, account_id, amount_kobo) values ($1, $2, 1)',
        [posted.transactionId, player],
      ),
    ).rejects.toThrow(/only by the ledger module/);
  });

  it('still lets the module post, and the deferred balance trigger still fires', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('guard-ok');

    await expect(
      postTransaction({
        idempotencyKey: 'guarded-2',
        category: 'onboarding_grant',
        entries: [
          { accountId: mint, amountKobo: -250n },
          { accountId: player, amountKobo: 250n },
        ],
      }),
    ).resolves.toMatchObject({ replayed: false });

    // The gate being on does not weaken the balance rule.
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.ledger_write', 'on', true)");
      const { rows } = await client.query<{ id: string }>(
        `insert into ledger_transactions (idempotency_key, request_fingerprint, category)
         values ($1, 'fingerprint', 'transfer') returning id`,
        [`unbalanced-${crypto.randomUUID()}`],
      );
      for (const entry of [
        { accountId: mint, amountKobo: '-100' },
        { accountId: player, amountKobo: '90' },
      ]) {
        await client.query(
          'insert into ledger_entries (transaction_id, account_id, amount_kobo) values ($1, $2, $3)',
          [rows[0]?.id, entry.accountId, entry.amountKobo],
        );
      }
      await expect(client.query('commit')).rejects.toThrow(/does not balance/);
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }
  });
});
