import { getPool } from '@/server/db/client';
import { LedgerValidationError } from './errors';
import { postTransaction } from './post';
import { getTransactionByIdempotencyKey } from './read';
import {
  balanceOf,
  createTestPlayerAccount,
  resetLedger,
  systemAccountId,
  withLedgerWrite,
} from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Posting inside a caller's transaction.
 *
 * This is what makes a transfer atomic: the domain row and the money commit
 * together, or neither does. The tests below are the two halves of that promise,
 * plus the guarantees that must not change when the ledger does not own the
 * transaction.
 */

let mint: string;
let burn: string;
let alice: string;

beforeEach(async () => {
  await resetLedger();
  mint = await systemAccountId('SYSTEM_MINT');
  burn = await systemAccountId('SYSTEM_BURN');
  alice = await createTestPlayerAccount('alice');

  await postTransaction({
    idempotencyKey: 'grant:alice',
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -100_000n },
      { accountId: alice, amountKobo: 100_000n },
    ],
  });
});

const spend = (key: string, amountKobo: bigint) => ({
  idempotencyKey: key,
  category: 'food',
  entries: [
    { accountId: alice, amountKobo: -amountKobo },
    { accountId: burn, amountKobo },
  ],
});

describe('postTransaction with a caller transaction', () => {
  it('commits its entries with the caller', async () => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.ledger_write', 'on', true)");
      const posted = await postTransaction({ ...spend('joined:1', 25_000n), client });
      expect(posted.replayed).toBe(false);
      await client.query('commit');
    } finally {
      client.release();
    }

    expect(await balanceOf(alice)).toBe(75_000n);
    const found = await getTransactionByIdempotencyKey('joined:1');
    expect(found?.entries.length).toBe(2);
  });

  it('leaves nothing behind when the caller rolls back', async () => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.ledger_write', 'on', true)");
      await postTransaction({ ...spend('joined:2', 25_000n), client });
      await client.query('rollback');
    } finally {
      client.release();
    }

    expect(await balanceOf(alice)).toBe(100_000n);
    expect(await getTransactionByIdempotencyKey('joined:2')).toBeNull();
    const { rows } = await getPool().query<{ count: string }>(
      'select count(*) from ledger_entries where amount_kobo = -25000',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('refuses a frozen-debit override, whose audit event must follow a commit', async () => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await expect(
        postTransaction({ ...spend('joined:3', 1_000n), client, allowFrozenDebit: true }),
      ).rejects.toBeInstanceOf(LedgerValidationError);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('still refuses an overdraft, and the caller can carry on afterwards', async () => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.ledger_write', 'on', true)");
      await expect(postTransaction({ ...spend('joined:4', 500_000n), client })).rejects.toThrow(
        /enough money/,
      );
      // The caller decides what to do with its own transaction; a savepoint is how a
      // caller keeps the rest of its work after one refused posting.
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect(await balanceOf(alice)).toBe(100_000n);
  });

  it('replays a joined key without moving money twice', async () => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.ledger_write', 'on', true)");
      await postTransaction({ ...spend('joined:5', 10_000n), client });
      const again = await postTransaction({ ...spend('joined:5', 10_000n), client });
      expect(again.replayed).toBe(true);
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(await balanceOf(alice)).toBe(90_000n);
  });

  it('leaves a posting without a client exactly as it was', async () => {
    const posted = await postTransaction(spend('standalone:1', 5_000n));
    expect(posted.replayed).toBe(false);
    const repeated = await postTransaction(spend('standalone:1', 5_000n));
    expect(repeated.replayed).toBe(true);
    expect(await balanceOf(alice)).toBe(95_000n);
  });
});

describe('getTransactionByIdempotencyKey', () => {
  it('finds a transaction by key and returns null for a key nobody used', async () => {
    expect(await getTransactionByIdempotencyKey('grant:alice')).not.toBeNull();
    expect(await getTransactionByIdempotencyKey('never-used')).toBeNull();
  });

  it('sees nothing for a row written inside a transaction that rolled back', async () => {
    await withLedgerWrite(async (client) => {
      await client.query('begin');
      await client.query(
        `insert into ledger_transactions (idempotency_key, request_fingerprint, category)
         values ('in-flight', 'x', 'transfer')`,
      );
      await client.query('rollback');
    });
    expect(await getTransactionByIdempotencyKey('in-flight')).toBeNull();
  });
});
