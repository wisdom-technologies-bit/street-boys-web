import { getPool } from '@/server/db/client';
import {
  IdempotencyConflict,
  InsufficientFunds,
  InsufficientFundsForReversal,
  AlreadyReversed,
  getMoneySupply,
  postTransaction,
  reverseTransaction,
  verifyLedger,
} from './index';
import { balanceOf, createTestPlayerAccount, resetLedger, systemAccountId } from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The concurrency suite: the ledger under real load, against a real Postgres.
 *
 * These tests exist because the interesting failures are the ones that need two
 * connections at the same time. A unit test with a mock cannot prove that fifty
 * simultaneous spends overdraw nothing, that locks are taken in an order that
 * cannot deadlock, or that one idempotency key produces one payment when a hundred
 * callers race for it.
 *
 * Sizes are chosen to stay inside a CI budget. `LEDGER_STRESS=1` (with
 * `npm run test:ledger-stress`) multiplies them for a long soak.
 *
 * The randomised simulation is seeded, and the seed is printed on failure, so a
 * red run can be replayed exactly rather than being a story about a Tuesday.
 */

const STRESS = process.env.LEDGER_STRESS === '1';
const SEED = Number(process.env.LEDGER_SEED ?? 20261107);

/** mulberry32: small, deterministic, and dependency-free. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const NAIRA = 100n; // kobo in one naira

beforeEach(async () => {
  await resetLedger();
});

describe('concurrent spends cannot overdraw', () => {
  it('lets exactly ten of fifty 100-naira spends through an account holding 1,000', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const spender = await createTestPlayerAccount('stress-spender');
    const sink = await systemAccountId('SYSTEM_BURN');

    await postTransaction({
      idempotencyKey: 'stress-fund-0001',
      category: 'onboarding_grant',
      entries: [
        { accountId: mint, amountKobo: -1_000n * NAIRA },
        { accountId: spender, amountKobo: 1_000n * NAIRA },
      ],
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 50 }, (_, index) =>
        postTransaction({
          idempotencyKey: `stress-spend-${String(index).padStart(4, '0')}`,
          category: 'food',
          entries: [
            { accountId: spender, amountKobo: -100n * NAIRA },
            { accountId: sink, amountKobo: 100n * NAIRA },
          ],
        }),
      ),
    );

    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');

    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(40);
    for (const attempt of rejected) {
      if (attempt.status === 'rejected') expect(attempt.reason).toBeInstanceOf(InsufficientFunds);
    }
    expect(await balanceOf(spender)).toBe(0n);
    expect(await balanceOf(sink)).toBe(1_000n * NAIRA);
  }, 120_000);
});

describe('a ring of payments does not deadlock', () => {
  it('lets five accounts pay each other in both directions at once, conserving every kobo', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const accounts = await Promise.all(
      Array.from({ length: 5 }, (_, index) => createTestPlayerAccount(`ring-${index}`)),
    );

    for (const [index, account] of accounts.entries()) {
      await postTransaction({
        idempotencyKey: `ring-fund-${index}-0001`,
        category: 'onboarding_grant',
        entries: [
          { accountId: mint, amountKobo: -1_000n * NAIRA },
          { accountId: account, amountKobo: 1_000n * NAIRA },
        ],
      });
    }

    const before = await Promise.all(accounts.map((account) => balanceOf(account)));

    // Every account pays its two neighbours, both ways, in the same instant: five
    // locks, taken in a different order by every worker unless the module sorts them.
    const transfers = accounts.flatMap((from, index) =>
      [1, -1].map((step) => {
        const to = accounts[(index + step + accounts.length) % accounts.length] as string;
        return postTransaction({
          idempotencyKey: `ring-pay-${index}-${step + 2}-0001`,
          category: 'transfer',
          entries: [
            { accountId: from, amountKobo: -50n * NAIRA },
            { accountId: to, amountKobo: 50n * NAIRA },
          ],
        });
      }),
    );

    const results = await Promise.allSettled(transfers);
    const failures = results.filter((result) => result.status === 'rejected');
    // No deadlock error may escape: a locked pair is either resolved or refused, never
    // surfaced as a database error the caller cannot act on.
    expect(failures).toEqual([]);

    const after = await Promise.all(accounts.map((account) => balanceOf(account)));
    expect(after.reduce((total, value) => total + value, 0n)).toBe(
      before.reduce((total, value) => total + value, 0n),
    );
    // Each account paid out 100 naira and received 100: net zero, exactly.
    for (const [index, value] of after.entries()) expect(value).toBe(before[index]);
  }, 120_000);
});

describe('one key, many callers', () => {
  it('pays once for a hundred identical calls, replaying the other ninety-nine', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('same-key');

    const attempts = await Promise.all(
      Array.from({ length: 100 }, () =>
        postTransaction({
          idempotencyKey: 'stress-same-key-0001',
          category: 'job_pay',
          entries: [
            { accountId: mint, amountKobo: -250n * NAIRA },
            { accountId: player, amountKobo: 250n * NAIRA },
          ],
        }),
      ),
    );

    const fresh = attempts.filter((attempt) => !attempt.replayed);
    const replays = attempts.filter((attempt) => attempt.replayed);

    expect(fresh).toHaveLength(1);
    expect(replays).toHaveLength(99);
    expect(new Set(attempts.map((attempt) => attempt.transactionId)).size).toBe(1);
    expect(await balanceOf(player)).toBe(250n * NAIRA);

    const stored = await getPool().query<{ count: string }>(
      "select count(*)::text as count from ledger_transactions where idempotency_key = 'stress-same-key-0001'",
    );
    expect(stored.rows[0]?.count).toBe('1');
  }, 120_000);

  it('lets one caller win a hundred ways of reusing a key, and refuses the rest as conflict', async () => {
    const mint = await systemAccountId('SYSTEM_MINT');
    const player = await createTestPlayerAccount('conflict-key');

    const attempts = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        postTransaction({
          idempotencyKey: 'stress-conflict-key-0001',
          category: 'job_pay',
          entries: [
            { accountId: mint, amountKobo: -(250n + BigInt(index)) * NAIRA },
            { accountId: player, amountKobo: (250n + BigInt(index)) * NAIRA },
          ],
        }),
      ),
    );

    const winners = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const conflicts = attempts.filter(
      (attempt) => attempt.status === 'rejected' && attempt.reason instanceof IdempotencyConflict,
    );

    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(99);
    expect((await verifyLedger()).ok).toBe(true);
  }, 120_000);
});

describe('randomised simulation', () => {
  it('keeps the ledger correct through mixed concurrent traffic', async () => {
    const workerCount = STRESS ? 40 : 10;
    const operationsPerWorker = STRESS ? 200 : 25;
    const accountCount = STRESS ? 100 : 20;
    const rng = makeRng(SEED);

    const mint = await systemAccountId('SYSTEM_MINT');
    const burn = await systemAccountId('SYSTEM_BURN');
    const treasury = await systemAccountId('TREASURY');

    const players = await Promise.all(
      Array.from({ length: accountCount }, (_, index) => createTestPlayerAccount(`sim-${index}`)),
    );

    // Fund each player once so a share of the transfers can succeed.
    for (const [index, player] of players.entries()) {
      await postTransaction({
        idempotencyKey: `sim-fund-${index}-0001`,
        category: 'onboarding_grant',
        entries: [
          { accountId: mint, amountKobo: -5_000n * NAIRA },
          { accountId: player, amountKobo: 5_000n * NAIRA },
        ],
      });
    }

    const pick = <T>(items: T[]): T => items[Math.floor(rng() * items.length)] as T;
    const amount = () => BigInt(1 + Math.floor(rng() * 100)) * NAIRA;
    /** Transactions this simulation may still reverse. */
    const reversible: Array<{ id: string; key: string }> = [];
    let sequence = 0;

    function nextKey(prefix: string): string {
      sequence += 1;
      return `sim-${prefix}-${String(sequence).padStart(6, '0')}`;
    }

    type Outcome = 'ok' | 'expected_refusal';

    async function oneOperation(worker: number): Promise<Outcome> {
      const kind = rng();
      const player = pick(players);
      // A different account, because a transaction may not touch the same account twice.
      const other = pick(players.filter((candidate) => candidate !== player));
      const key = nextKey(`w${worker}`);

      if (kind < 0.35) {
        // Mint to a player. One value, used twice: two calls would mint an amount
        // and credit a different one, which the deferred trigger rightly refuses.
        const value = amount();
        await postTransaction({
          idempotencyKey: key,
          category: 'onboarding_grant',
          entries: [
            { accountId: mint, amountKobo: -value },
            { accountId: player, amountKobo: value },
          ],
        });
        return 'ok';
      }

      if (kind < 0.65) {
        // Player to player.
        const value = amount();
        const posted = await postTransaction({
          idempotencyKey: key,
          category: 'transfer',
          entries: [
            { accountId: player, amountKobo: -value },
            { accountId: other, amountKobo: value },
          ],
        });
        reversible.push({ id: posted.transactionId, key });
        return 'ok';
      }

      if (kind < 0.8) {
        // Burn: a player buys something.
        const value = amount();
        const posted = await postTransaction({
          idempotencyKey: key,
          category: 'food',
          entries: [
            { accountId: player, amountKobo: -value },
            { accountId: burn, amountKobo: value },
          ],
        });
        reversible.push({ id: posted.transactionId, key });
        return 'ok';
      }

      if (kind < 0.9) {
        // Treasury: tax in.
        const tax = amount();
        await postTransaction({
          idempotencyKey: key,
          category: 'tax',
          entries: [
            { accountId: player, amountKobo: -tax },
            { accountId: treasury, amountKobo: tax },
          ],
        });
        return 'ok';
      }

      // Reversal of something this run posted.
      if (reversible.length === 0) return 'expected_refusal';
      const target = reversible[Math.floor(rng() * reversible.length)];
      await reverseTransaction({
        transactionId: (target as { id: string }).id,
        idempotencyKey: nextKey('reversal'),
        reason: 'simulated correction',
        actorUserId: '00000000-0000-4000-8000-000000000002',
      });
      return 'ok';
    }

    async function worker(workerIndex: number): Promise<Outcome[]> {
      const outcomes: Outcome[] = [];
      for (let index = 0; index < operationsPerWorker; index += 1) {
        try {
          outcomes.push(await oneOperation(workerIndex));
        } catch (error) {
          if (
            error instanceof InsufficientFunds ||
            error instanceof InsufficientFundsForReversal ||
            error instanceof AlreadyReversed ||
            error instanceof IdempotencyConflict
          ) {
            // Refusals a live economy produces constantly: a player who is short, a
            // transaction already reversed. They are not a broken ledger.
            outcomes.push('expected_refusal');
            continue;
          }
          throw new Error(
            `seed ${SEED}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
      return outcomes;
    }

    const results = await Promise.all(
      Array.from({ length: workerCount }, (_, index) => worker(index)),
    );
    const operations = results.flat();

    expect(operations.length).toBe(workerCount * operationsPerWorker);

    const report = await verifyLedger();
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);

    const totals = await getPool().query<{ total: string }>(
      'select coalesce(sum(amount_kobo), 0)::text as total from ledger_entries',
    );
    expect(totals.rows[0]?.total).toBe('0');

    const supply = await getMoneySupply();
    expect(supply.circulatingKobo).toBe(supply.totalMintedKobo - supply.totalBurnedKobo);
  }, 600_000);
});
