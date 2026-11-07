import { getPool } from '@/server/db/client';
import {
  AccountFrozen,
  AlreadyReversed,
  InsufficientFundsForReversal,
  LedgerValidationError,
  UnknownTransaction,
} from './errors';
import { postTransaction } from './post';
import { reverseTransaction } from './reverse';
import { getTransaction } from './read';
import {
  balanceOf,
  createTestPlayerAccount,
  resetLedger,
  systemAccountId,
  withLedgerWrite,
} from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Reversals: the ledger's only way to undo something, and the rules that keep it
 * honest. Each test names the rule it proves.
 */

const ACTOR = '00000000-0000-4000-8000-000000000001';

let mint: string;
let burn: string;

beforeEach(async () => {
  await resetLedger();
  mint = await systemAccountId('SYSTEM_MINT');
  burn = await systemAccountId('SYSTEM_BURN');
});

async function mintTo(accountId: string, amountKobo: bigint, key = `mint-${crypto.randomUUID()}`) {
  return postTransaction({
    idempotencyKey: key,
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -amountKobo },
      { accountId, amountKobo },
    ],
  });
}

describe('reverseTransaction: the happy path', () => {
  it('restores both balances exactly and records who, why and what', async () => {
    const player = await createTestPlayerAccount('reverse');
    const original = await mintTo(player, 1500n);
    expect(await balanceOf(player)).toBe(1500n);

    const reversal = await reverseTransaction({
      transactionId: original.transactionId,
      idempotencyKey: 'reversal-0001',
      reason: 'double payout in testing',
      actorUserId: ACTOR,
    });

    expect(await balanceOf(player)).toBe(0n);
    expect(await balanceOf(mint)).toBe(0n);

    const stored = await getTransaction(reversal.transactionId);
    expect(stored?.category).toBe('reversal');
    expect(stored?.reversesTransactionId).toBe(original.transactionId);
    expect(stored?.actorUserId).toBe(ACTOR);
    expect(stored?.metadata.reason).toBe('double payout in testing');
    expect(stored?.entries.map((entry) => entry.amountKobo).sort()).toEqual([-1500n, 1500n].sort());

    // The original now knows it was reversed.
    const after = await getTransaction(original.transactionId);
    expect(after?.reversedByTransactionId).toBe(reversal.transactionId);
  });

  it('reverses a burn as readily as a mint', async () => {
    const player = await createTestPlayerAccount('reverse-burn');
    await mintTo(player, 2000n);

    const spend = await postTransaction({
      idempotencyKey: 'food-spring-1',
      category: 'food',
      entries: [
        { accountId: player, amountKobo: -700n },
        { accountId: burn, amountKobo: 700n },
      ],
    });

    await reverseTransaction({
      transactionId: spend.transactionId,
      idempotencyKey: 'reversal-0002',
      reason: 'the order was cancelled',
      actorUserId: ACTOR,
    });

    expect(await balanceOf(player)).toBe(2000n);
    expect(await balanceOf(burn)).toBe(0n);
  });
});

describe('reverseTransaction: once only', () => {
  it('refuses a second reversal of the same transaction', async () => {
    const player = await createTestPlayerAccount('twice');
    const original = await mintTo(player, 900n);
    const input = {
      transactionId: original.transactionId,
      reason: 'mistake',
      actorUserId: ACTOR,
    };

    await reverseTransaction({ ...input, idempotencyKey: 'reversal-0003' });

    await expect(reverseTransaction({ ...input, idempotencyKey: 'reversal-0004' })).rejects.toThrow(
      AlreadyReversed,
    );
    expect(await balanceOf(player)).toBe(0n);
  });

  it('replays when the same reversal key is retried', async () => {
    const player = await createTestPlayerAccount('replay-reversal');
    const original = await mintTo(player, 900n);
    const input = {
      transactionId: original.transactionId,
      idempotencyKey: 'reversal-0005',
      reason: 'mistake',
      actorUserId: ACTOR,
    };

    const first = await reverseTransaction(input);
    const second = await reverseTransaction(input);

    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await balanceOf(player)).toBe(0n);
  });

  it('refuses to reverse a reversal', async () => {
    const player = await createTestPlayerAccount('double-negative');
    const original = await mintTo(player, 400n);
    const reversal = await reverseTransaction({
      transactionId: original.transactionId,
      idempotencyKey: 'reversal-0006',
      reason: 'mistake',
      actorUserId: ACTOR,
    });

    await expect(
      reverseTransaction({
        transactionId: reversal.transactionId,
        idempotencyKey: 'reversal-0007',
        reason: 'undo the undo',
        actorUserId: ACTOR,
      }),
    ).rejects.toThrow(/cannot itself be reversed/);
  });

  it('lets exactly one of many simultaneous reversals win', async () => {
    const player = await createTestPlayerAccount('race-reversal');
    const original = await mintTo(player, 5000n);

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        reverseTransaction({
          transactionId: original.transactionId,
          idempotencyKey: `reversal-race-${String(index).padStart(3, '0')}`,
          reason: 'race',
          actorUserId: ACTOR,
        }),
      ),
    );

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') expect(attempt.reason).toBeInstanceOf(AlreadyReversed);
    }
    expect(await balanceOf(player)).toBe(0n);
  });
});

describe('reverseTransaction: never below zero', () => {
  it('refuses a reversal that would overdraw, and writes nothing', async () => {
    const player = await createTestPlayerAccount('spent');
    const other = await createTestPlayerAccount('spent-to');

    const original = await mintTo(player, 1000n);
    await postTransaction({
      idempotencyKey: 'spend-8000-1',
      category: 'transfer',
      entries: [
        { accountId: player, amountKobo: -800n },
        { accountId: other, amountKobo: 800n },
      ],
    });

    await expect(
      reverseTransaction({
        transactionId: original.transactionId,
        idempotencyKey: 'reversal-0008',
        reason: 'the grant was wrong',
        actorUserId: ACTOR,
      }),
    ).rejects.toThrow(InsufficientFundsForReversal);

    expect(await balanceOf(player)).toBe(200n);
    expect(await balanceOf(other)).toBe(800n);

    const reversals = await getPool().query<{ count: string }>(
      "select count(*)::text as count from ledger_transactions where category = 'reversal'",
    );
    expect(reversals.rows[0]?.count).toBe('0');
  });
});

describe('reverseTransaction: frozen accounts', () => {
  it('blocks an ordinary debit from a frozen account but allows a reversal to debit it', async () => {
    const player = await createTestPlayerAccount('frozen');
    const other = await createTestPlayerAccount('frozen-other');
    const original = await mintTo(player, 3000n);

    await withLedgerWrite((client) =>
      client.query('update accounts set frozen_at = now() where id = $1', [player]),
    );

    await expect(
      postTransaction({
        idempotencyKey: 'frozen-spend-1',
        category: 'transfer',
        entries: [
          { accountId: player, amountKobo: -100n },
          { accountId: other, amountKobo: 100n },
        ],
      }),
    ).rejects.toThrow(AccountFrozen);

    const reversal = await reverseTransaction({
      transactionId: original.transactionId,
      idempotencyKey: 'reversal-0009',
      reason: 'account frozen pending investigation',
      actorUserId: ACTOR,
      allowFrozenDebit: true,
    });

    expect(reversal.transactionId).toBeTruthy();
    expect(await balanceOf(player)).toBe(0n);

    const audit = await getPool().query<{ count: string }>(
      "select count(*)::text as count from audit_log where event_type = 'ledger_frozen_debit_override'",
    );
    expect(Number(audit.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it('refuses the override for any other category, and without an actor', async () => {
    const player = await createTestPlayerAccount('override-rules');
    const other = await createTestPlayerAccount('override-rules-to');
    await mintTo(player, 1000n);

    await expect(
      postTransaction({
        idempotencyKey: 'override-transfer-1',
        category: 'transfer',
        actorUserId: ACTOR,
        allowFrozenDebit: true,
        entries: [
          { accountId: player, amountKobo: -100n },
          { accountId: other, amountKobo: 100n },
        ],
      }),
    ).rejects.toThrow(/only a reversal or an admin adjustment/);

    await expect(
      postTransaction({
        idempotencyKey: 'override-nobody-1',
        category: 'admin_adjustment',
        allowFrozenDebit: true,
        entries: [
          { accountId: player, amountKobo: -100n },
          { accountId: other, amountKobo: 100n },
        ],
      }),
    ).rejects.toThrow(/requires the actor/);

    expect(await balanceOf(player)).toBe(1000n);
  });
});

describe('reverseTransaction: input rules', () => {
  it('requires a real transaction, a reason and an actor', async () => {
    const player = await createTestPlayerAccount('input-rules');
    const original = await mintTo(player, 100n);

    await expect(
      reverseTransaction({
        transactionId: crypto.randomUUID(),
        idempotencyKey: 'reversal-0010',
        reason: 'nope',
        actorUserId: ACTOR,
      }),
    ).rejects.toThrow(UnknownTransaction);

    await expect(
      reverseTransaction({
        transactionId: original.transactionId,
        idempotencyKey: 'reversal-0011',
        reason: '   ',
        actorUserId: ACTOR,
      }),
    ).rejects.toThrow(LedgerValidationError);

    await expect(
      reverseTransaction({
        transactionId: original.transactionId,
        idempotencyKey: 'reversal-0012',
        reason: 'x'.repeat(501),
        actorUserId: ACTOR,
      }),
    ).rejects.toThrow(/at most 500 characters/);

    await expect(
      reverseTransaction({
        transactionId: original.transactionId,
        idempotencyKey: 'reversal-0013',
        reason: 'fine',
        actorUserId: '',
      }),
    ).rejects.toThrow(/needs the actor/);
  });
});
