import { getPool } from '@/server/db/client';
import { MAX_TX_KOBO } from '@/server/config/ledger-limits';
import { MAX_SAFE_KOBO } from './money';
import { postTransaction } from './post';
import {
  AccountFrozen,
  IdempotencyConflict,
  InsufficientFunds,
  LedgerValidationError,
} from './errors';
import {
  balanceOf,
  createTestPlayerAccount,
  resetLedger,
  systemAccountId,
  withLedgerWrite,
} from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The posting rules, against a real Postgres.
 *
 * Every test names the guarantee it proves, so a failure says which rule broke
 * rather than which assertion moved.
 */

let mint: string;
let burn: string;
let treasury: string;

beforeEach(async () => {
  await resetLedger();
  mint = await systemAccountId('SYSTEM_MINT');
  burn = await systemAccountId('SYSTEM_BURN');
  treasury = await systemAccountId('TREASURY');
});

async function mintTo(accountId: string, amountKobo: bigint) {
  return postTransaction({
    idempotencyKey: `mint-${accountId}-${crypto.randomUUID()}`,
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -amountKobo },
      { accountId, amountKobo },
    ],
  });
}

async function transactionCount(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    'select count(*)::text as count from ledger_transactions',
  );
  return Number(rows[0]?.count ?? '0');
}

describe('postTransaction: the happy paths', () => {
  it('mints new money to a player, and the money supply goes negative by the same amount', async () => {
    const player = await createTestPlayerAccount('mint');

    const result = await mintTo(player, 15000n);

    expect(result.replayed).toBe(false);
    expect(await balanceOf(player)).toBe(15000n);
    expect(await balanceOf(mint)).toBe(-15000n);
    // Balances come back ordered by account id, not by entry order.
    expect(
      Object.fromEntries(result.balances.map((row) => [row.accountId, row.balanceKobo])),
    ).toEqual({
      [mint]: -15000n,
      [player]: 15000n,
    });
  });

  it('moves money between two players and touches nothing else', async () => {
    const from = await createTestPlayerAccount('from');
    const to = await createTestPlayerAccount('to');
    await mintTo(from, 10000n);

    await postTransaction({
      idempotencyKey: 'transfer-1',
      category: 'transfer',
      entries: [
        { accountId: from, amountKobo: -2500n },
        { accountId: to, amountKobo: 2500n },
      ],
    });

    expect(await balanceOf(from)).toBe(7500n);
    expect(await balanceOf(to)).toBe(2500n);
    expect(await balanceOf(mint)).toBe(-10000n);
  });

  it('destroys money into SYSTEM_BURN, which never goes negative', async () => {
    const player = await createTestPlayerAccount('burn');
    await mintTo(player, 4000n);

    await postTransaction({
      idempotencyKey: 'food-0001',
      category: 'food',
      entries: [
        { accountId: player, amountKobo: -1200n },
        { accountId: burn, amountKobo: 1200n },
      ],
    });

    expect(await balanceOf(player)).toBe(2800n);
    expect(await balanceOf(burn)).toBe(1200n);
  });

  it('records metadata that is safe, and the treasury can hold money', async () => {
    const player = await createTestPlayerAccount('tax');
    await mintTo(player, 5000n);

    await postTransaction({
      idempotencyKey: 'tax-0001',
      category: 'tax',
      metadata: { taxPeriod: '2026-11', zone: 'zone-3' },
      entries: [
        { accountId: player, amountKobo: -500n },
        { accountId: treasury, amountKobo: 500n },
      ],
    });

    expect(await balanceOf(treasury)).toBe(500n);
  });
});

describe('postTransaction: refused before the database is touched', () => {
  it('refuses unbalanced entries and writes nothing', async () => {
    const player = await createTestPlayerAccount('unbalanced');
    const before = await transactionCount();

    await expect(
      postTransaction({
        idempotencyKey: 'unbalanced-1',
        category: 'transfer',
        entries: [
          { accountId: mint, amountKobo: -100n },
          { accountId: player, amountKobo: 90n },
        ],
      }),
    ).rejects.toThrow(LedgerValidationError);

    expect(await transactionCount()).toBe(before);
  });

  it('refuses a zero amount, a repeated account, an unknown category and too few entries', async () => {
    const player = await createTestPlayerAccount('validation');
    const other = await createTestPlayerAccount('validation-2');

    await expect(
      postTransaction({
        idempotencyKey: 'zero-0001',
        category: 'transfer',
        entries: [
          { accountId: player, amountKobo: 0n },
          { accountId: other, amountKobo: 0n },
        ],
      }),
    ).rejects.toThrow(/zero kobo/);

    await expect(
      postTransaction({
        idempotencyKey: 'dup-00001',
        category: 'transfer',
        entries: [
          { accountId: player, amountKobo: -100n },
          { accountId: player, amountKobo: 100n },
        ],
      }),
    ).rejects.toThrow(/same account twice/);

    await expect(
      postTransaction({
        idempotencyKey: 'category-1',
        category: 'free_money',
        entries: [
          { accountId: player, amountKobo: -100n },
          { accountId: other, amountKobo: 100n },
        ],
      }),
    ).rejects.toThrow(/not a ledger category/);

    await expect(
      postTransaction({
        idempotencyKey: 'single-1',
        category: 'transfer',
        entries: [{ accountId: player, amountKobo: 100n }],
      }),
    ).rejects.toThrow(/at least two entries/);

    expect(await transactionCount()).toBe(0);
  });

  it('refuses a transaction above the per-transaction cap', async () => {
    const player = await createTestPlayerAccount('cap');
    const rich = await createTestPlayerAccount('rich');

    // The cap is in kobo and must stay inside what a bigint can hold exactly.
    expect(MAX_TX_KOBO).toBeLessThan(MAX_SAFE_KOBO);

    await expect(
      postTransaction({
        idempotencyKey: 'cap-00001',
        category: 'transfer',
        entries: [
          { accountId: rich, amountKobo: -(MAX_TX_KOBO + 1n) },
          { accountId: player, amountKobo: MAX_TX_KOBO + 1n },
        ],
      }),
    ).rejects.toThrow(/per-transaction limit/);
  });

  it('refuses metadata that carries an identifier or a credential', async () => {
    const player = await createTestPlayerAccount('metadata');

    for (const metadata of [
      { email: 'a@b.c' },
      { user_ip: '1.2.3.4' },
      { otp: '123456' },
      { deep: { token: 'x' } },
    ]) {
      await expect(
        postTransaction({
          idempotencyKey: `metadata-${crypto.randomUUID()}`,
          category: 'transfer',
          metadata,
          entries: [
            { accountId: player, amountKobo: -100n },
            { accountId: mint, amountKobo: 100n },
          ],
        }),
      ).rejects.toThrow(/must not contain/);
    }
  });
});

describe('postTransaction: the balance floor', () => {
  it('refuses an unaffordable debit and leaves no transaction, no entry and no balance change', async () => {
    const player = await createTestPlayerAccount('poor');
    const to = await createTestPlayerAccount('receiver');
    await mintTo(player, 1000n);
    const before = await transactionCount();

    await expect(
      postTransaction({
        idempotencyKey: 'overdraft-1',
        category: 'transfer',
        entries: [
          { accountId: player, amountKobo: -1001n },
          { accountId: to, amountKobo: 1001n },
        ],
      }),
    ).rejects.toThrow(InsufficientFunds);

    expect(await transactionCount()).toBe(before);
    expect(await balanceOf(player)).toBe(1000n);
    expect(await balanceOf(to)).toBe(0n);

    const { rows } = await getPool().query<{ count: string }>(
      "select count(*)::text as count from ledger_entries e join ledger_transactions t on t.id = e.transaction_id where t.idempotency_key = 'overdraft-1'",
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('lets a frozen account receive but not send', async () => {
    const frozen = await createTestPlayerAccount('frozen');
    const other = await createTestPlayerAccount('other');
    await mintTo(frozen, 5000n);
    await mintTo(other, 5000n);

    await withLedgerWrite((client) =>
      client.query('update accounts set frozen_at = now() where id = $1', [frozen]),
    );

    await expect(
      postTransaction({
        idempotencyKey: 'frozen-send',
        category: 'transfer',
        entries: [
          { accountId: frozen, amountKobo: -100n },
          { accountId: other, amountKobo: 100n },
        ],
      }),
    ).rejects.toThrow(AccountFrozen);

    await postTransaction({
      idempotencyKey: 'frozen-receive',
      category: 'transfer',
      entries: [
        { accountId: other, amountKobo: -100n },
        { accountId: frozen, amountKobo: 100n },
      ],
    });

    expect(await balanceOf(frozen)).toBe(5100n);
  });
});

describe('postTransaction: idempotency', () => {
  it('replays the same request instead of moving money twice', async () => {
    const from = await createTestPlayerAccount('idem-from');
    const to = await createTestPlayerAccount('idem-to');
    await mintTo(from, 10000n);

    const request = {
      idempotencyKey: 'retry-me',
      category: 'transfer' as const,
      entries: [
        { accountId: from, amountKobo: -3000n },
        { accountId: to, amountKobo: 3000n },
      ],
    };

    const first = await postTransaction(request);
    const second = await postTransaction(request);

    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await balanceOf(from)).toBe(7000n);
    expect(await balanceOf(to)).toBe(3000n);

    const { rows } = await getPool().query<{ count: string }>(
      "select count(*)::text as count from ledger_entries e join ledger_transactions t on t.id = e.transaction_id where t.idempotency_key = 'retry-me'",
    );
    expect(rows[0]?.count).toBe('2');
  });

  it('replays when only the metadata differs: metadata is not part of the intent', async () => {
    const from = await createTestPlayerAccount('meta-from');
    const to = await createTestPlayerAccount('meta-to');
    await mintTo(from, 5000n);

    const first = await postTransaction({
      idempotencyKey: 'meta-replay-1',
      category: 'transfer',
      metadata: { note: 'first' },
      entries: [
        { accountId: from, amountKobo: -500n },
        { accountId: to, amountKobo: 500n },
      ],
    });

    const second = await postTransaction({
      idempotencyKey: 'meta-replay-1',
      category: 'transfer',
      metadata: { note: 'second' },
      entries: [
        { accountId: from, amountKobo: -500n },
        { accountId: to, amountKobo: 500n },
      ],
    });

    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await balanceOf(to)).toBe(500n);

    const stored = await getPool().query<{ metadata: { note: string } }>(
      'select metadata from ledger_transactions where id = $1',
      [first.transactionId],
    );
    expect(stored.rows[0]?.metadata.note).toBe('first');
  });

  it('throws IdempotencyConflict when the key is reused for a different payload', async () => {
    const from = await createTestPlayerAccount('conflict-from');
    const to = await createTestPlayerAccount('conflict-to');
    await mintTo(from, 10000n);

    await postTransaction({
      idempotencyKey: 'shared-key',
      category: 'transfer',
      entries: [
        { accountId: from, amountKobo: -1000n },
        { accountId: to, amountKobo: 1000n },
      ],
    });

    await expect(
      postTransaction({
        idempotencyKey: 'shared-key',
        category: 'transfer',
        entries: [
          { accountId: from, amountKobo: -2000n },
          { accountId: to, amountKobo: 2000n },
        ],
      }),
    ).rejects.toThrow(IdempotencyConflict);

    // The first movement stands, unchanged.
    expect(await balanceOf(from)).toBe(9000n);
    expect(await balanceOf(to)).toBe(1000n);
  });
});

describe('postTransaction: concurrency', () => {
  it('lets two accounts pay each other at the same time without deadlocking or losing money', async () => {
    const a = await createTestPlayerAccount('a');
    const b = await createTestPlayerAccount('b');
    await mintTo(a, 10000n);
    await mintTo(b, 10000n);

    const results = await Promise.allSettled([
      postTransaction({
        idempotencyKey: 'a-to-b-0001',
        category: 'transfer',
        entries: [
          { accountId: a, amountKobo: -1000n },
          { accountId: b, amountKobo: 1000n },
        ],
      }),
      postTransaction({
        idempotencyKey: 'b-to-a-0001',
        category: 'transfer',
        entries: [
          { accountId: b, amountKobo: -2500n },
          { accountId: a, amountKobo: 2500n },
        ],
      }),
    ]);

    // Ordered locks mean neither transaction has to be retried away.
    for (const result of results) expect(result.status).toBe('fulfilled');

    expect(await balanceOf(a)).toBe(11500n);
    expect(await balanceOf(b)).toBe(8500n);
    expect(await balanceOf(mint)).toBe(-20000n);
  });
});
