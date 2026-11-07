import { getPool } from '@/server/db/client';
import { getMoneySupply, verifyLedger } from '@/server/ledger';
import { systemAccountId } from '@/server/ledger/test-support';
import { sendMoney } from './send';
import { cancelTransfer } from './cancel';
import { releaseDueTransfers } from './release';
import { balance, createPlayer, fund, resetTransfers } from './test-support';
import { verifyTransfers } from './verify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// What this file is about is database contention, not the per-minute limiter: a burst
// of thirty sends in one second is a load test, and the limiter would refuse most of
// them before a single row was locked. The limiter has its own test in send.db.
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

/**
 * The suite that decides whether this engine is safe.
 *
 * Concurrency is where a money system fails: two sends that both read the same
 * balance, two jobs that both pick the same row, two players paying each other at
 * the same instant. Each test below is one of those, with the arithmetic checked
 * afterwards rather than the code's intentions.
 */

const naira = (amount: number): bigint => BigInt(amount) * 100n;

let ada: Awaited<ReturnType<typeof createPlayer>>;
let bola: Awaited<ReturnType<typeof createPlayer>>;

beforeEach(async () => {
  await resetTransfers();
  ada = await createPlayer('ada', { ageDays: 40 });
  bola = await createPlayer('bola', { ageDays: 40 });
  await fund(ada, naira(400_000));
});

const send = (sender: typeof ada, toName: string, amountKobo: bigint) =>
  sendMoney({
    senderUserId: sender.userId,
    toName,
    amountKobo,
    idempotencyKey: crypto.randomUUID(),
  });

/**
 * Fire `total` attempts in waves. The waves keep the connection pool (deliberately
 * small) out of the result: what is being measured is the daily limit and the row
 * locks, not how many sockets a test can open.
 */
async function waves<T>(
  total: number,
  size: number,
  work: () => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const outcomes: PromiseSettledResult<T>[] = [];
  for (let done = 0; done < total; done += size) {
    const batch = Math.min(size, total - done);
    outcomes.push(...(await Promise.allSettled(Array.from({ length: batch }, work))));
  }
  return outcomes;
}

describe('concurrent sends', () => {
  it('caps 30 simultaneous sends at the 10 the daily limit allows', async () => {
    const spender = await createPlayer('spender', { ageDays: 0 });
    await fund(spender, naira(500_000));

    // The new tier may send 20,000 naira a day; 2,000 a send is ten of them.
    const attempts = await waves(30, 3, () => send(spender, bola.name, naira(2_000)));

    const sent = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const refused = attempts.filter(
      (attempt) => attempt.status === 'rejected' && attempt.reason?.code === 'send_limit_exceeded',
    );

    expect(sent.length).toBe(10);
    expect(refused.length).toBe(20);
    expect(await balance(bola.accountId)).toBe(naira(20_000));
    expect((await verifyTransfers()).ok).toBe(true);
  }, 120_000);

  it('settles A paying B while B pays A at the same instant', async () => {
    await fund(bola, naira(100_000));

    const results = await Promise.all([
      send(ada, bola.name, naira(1_000)),
      send(bola, ada.name, naira(1_000)),
    ]);

    expect(results.every((result) => result.status === 'completed')).toBe(true);
    expect(await balance(ada.accountId)).toBe(naira(400_000));
    expect(await balance(bola.accountId)).toBe(naira(100_000));
    expect((await verifyTransfers()).ok).toBe(true);
  });

  it('turns 100 identical requests into one transfer', async () => {
    const key = crypto.randomUUID();
    const request = () =>
      sendMoney({
        senderUserId: ada.userId,
        toName: bola.name,
        amountKobo: naira(1_000),
        idempotencyKey: key,
      });

    const settled = await waves(100, 2, request);
    const results = settled
      .filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof request>>> =>
          outcome.status === 'fulfilled',
      )
      .map((outcome) => outcome.value);

    expect(results.length).toBe(100);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.replayed === false).length).toBe(1);
    expect(await balance(bola.accountId)).toBe(naira(1_000));
  }, 120_000);

  it('never lets a burst of sends overdraw the wallet', async () => {
    const poor = await createPlayer('poor', { ageDays: 40 });
    await fund(poor, naira(1_000));

    const attempts = await waves(20, 3, () => send(poor, bola.name, naira(1_000)));
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled').length).toBe(1);
    expect((await balance(poor.accountId)) >= 0n).toBe(true);
    expect(await balance(bola.accountId)).toBe(naira(1_000));
  });
});

describe('concurrent cancel and release', () => {
  it('pays once when a cancel races the release job', async () => {
    await fund(ada, naira(400_000));
    const transfer = await send(ada, bola.name, naira(150_000));
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );

    const [cancelled] = await Promise.allSettled([
      cancelTransfer({ senderUserId: ada.userId, transferId: transfer.id }),
      releaseDueTransfers(),
    ]);

    const { rows } = await getPool().query<{ status: string }>(
      'select status from transfers where id = $1',
      [transfer.id],
    );
    const status = rows[0]?.status;

    // Exactly one of the two may have moved money, and the balances must say which.
    if (status === 'cancelled') {
      expect(cancelled.status).toBe('fulfilled');
      expect(await balance(bola.accountId)).toBe(0n);
      expect(await balance(ada.accountId)).toBe(naira(400_000));
    } else {
      expect(status).toBe('completed');
      expect(await balance(bola.accountId)).toBe(naira(150_000));
    }

    expect(await balance(await systemAccountId('ESCROW_TRANSFERS'))).toBe(0n);
    expect((await verifyTransfers()).ok).toBe(true);
    expect((await verifyLedger()).ok).toBe(true);
  });
});

describe('the whole economy after a mixed run', () => {
  it('keeps the money supply equal to what was granted', async () => {
    const players = [ada, bola];
    for (const player of players) await fund(player, naira(50_000));
    await fund(ada, naira(400_000));

    // A randomised mix of sends, some of them pending, run concurrently.
    const keys = Array.from({ length: 40 }, () => crypto.randomUUID());
    const work = keys.map(async (key, index) => {
      const sender = index % 2 === 0 ? ada : bola;
      const receiver = sender === ada ? bola.name : ada.name;
      const amountKobo = index % 4 === 0 ? naira(150_000) : naira(1_000);

      try {
        const sent = await sendMoney({
          senderUserId: sender.userId,
          toName: receiver,
          amountKobo,
          idempotencyKey: key,
        });
        if (index % 5 === 0) {
          await cancelTransfer({ senderUserId: sender.userId, transferId: sent.id });
        }
        return sent;
      } catch {
        return null;
      }
    });

    await Promise.all(work);
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where status = 'pending'",
    );
    await releaseDueTransfers();

    const supply = await getMoneySupply();
    const granted = naira(50_000) * 2n + naira(400_000);

    expect(supply.circulatingKobo).toBe(granted);
    expect(await balance(await systemAccountId('ESCROW_TRANSFERS'))).toBe(0n);
    expect((await verifyLedger()).ok).toBe(true);
    expect((await verifyTransfers()).ok).toBe(true);
  }, 120_000);
});
