import { getPool } from '@/server/db/client';
import { systemAccountId } from '@/server/ledger/test-support';
import { runDueJobs } from '@/server/jobs/registry';
import { cancelTransfer } from './cancel';
import { releaseDueTransfers } from './release';
import { sendMoney } from './send';
import { balance, createPlayer, fund, resetTransfers } from './test-support';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Cancel and release: the two ways a pending transfer stops being pending.
 *
 * Cancel gives the money back to the sender; release gives the amount to the
 * receiver and the tax to TREASURY. Both are ordinary ledger movements, so the test
 * for each ends by looking at three balances and at the escrow account, which must
 * be empty again.
 */

const naira = (amount: number): bigint => BigInt(amount) * 100n;

let ada: Awaited<ReturnType<typeof createPlayer>>;
let bola: Awaited<ReturnType<typeof createPlayer>>;
let escrow: string;
let treasury: string;

beforeEach(async () => {
  await resetTransfers();
  ada = await createPlayer('ada', { ageDays: 40 });
  bola = await createPlayer('bola', { ageDays: 40 });
  await fund(ada, naira(400_000));
  escrow = await systemAccountId('ESCROW_TRANSFERS');
  treasury = await systemAccountId('TREASURY');
});

/** A pending transfer of 150,000 naira: 2,000 of it tax, all of it in escrow. */
async function pendingTransfer() {
  return sendMoney({
    senderUserId: ada.userId,
    toName: bola.name,
    amountKobo: naira(150_000),
    idempotencyKey: crypto.randomUUID(),
  });
}

describe('cancelTransfer', () => {
  it('returns the whole hold to the sender and empties escrow', async () => {
    const transfer = await pendingTransfer();
    expect(await balance(ada.accountId)).toBe(naira(248_000)); // 400,000 - 152,000

    const result = await cancelTransfer({ senderUserId: ada.userId, transferId: transfer.id });

    expect(result).toMatchObject({ status: 'cancelled', replayed: false });
    expect(await balance(ada.accountId)).toBe(naira(400_000));
    expect(await balance(escrow)).toBe(0n);
    expect(await balance(bola.accountId)).toBe(0n);
  });

  it('is idempotent: cancelling twice refunds once', async () => {
    const transfer = await pendingTransfer();
    await cancelTransfer({ senderUserId: ada.userId, transferId: transfer.id });
    const again = await cancelTransfer({ senderUserId: ada.userId, transferId: transfer.id });

    expect(again.replayed).toBe(true);
    expect(await balance(ada.accountId)).toBe(naira(400_000));
  });

  it('refuses a completed transfer', async () => {
    const instant = await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(1_000),
      idempotencyKey: crypto.randomUUID(),
    });

    await expect(
      cancelTransfer({ senderUserId: ada.userId, transferId: instant.id }),
    ).rejects.toMatchObject({ code: 'not_cancellable' });
  });

  it("answers for someone else's transfer as if it did not exist", async () => {
    const transfer = await pendingTransfer();
    await expect(
      cancelTransfer({ senderUserId: bola.userId, transferId: transfer.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await balance(escrow)).toBe(naira(152_000));
  });
});

describe('releaseDueTransfers', () => {
  it('pays the receiver the amount and TREASURY the tax', async () => {
    const transfer = await pendingTransfer();
    // Move the deadline into the past: the job's only input is time.
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );

    const result = await releaseDueTransfers();
    expect(result.released).toBe(1);

    expect(await balance(bola.accountId)).toBe(naira(150_000));
    expect(await balance(treasury)).toBe(naira(2_000));
    expect(await balance(escrow)).toBe(0n);

    const { rows } = await getPool().query<{ status: string }>(
      'select status from transfers where id = $1',
      [transfer.id],
    );
    expect(rows[0]?.status).toBe('completed');
  });

  it('leaves a transfer that is not due yet alone', async () => {
    await pendingTransfer();
    expect((await releaseDueTransfers()).released).toBe(0);
    expect(await balance(escrow)).toBe(naira(152_000));
  });

  it('never releases a cancelled transfer', async () => {
    const transfer = await pendingTransfer();
    await cancelTransfer({ senderUserId: ada.userId, transferId: transfer.id });
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );

    expect((await releaseDueTransfers()).released).toBe(0);
    expect(await balance(bola.accountId)).toBe(0n);
  });

  it('is safe to run twice and concurrently: the receiver is paid once', async () => {
    const transfer = await pendingTransfer();
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );

    const [first, second] = await Promise.all([releaseDueTransfers(), releaseDueTransfers()]);
    expect(first.released + second.released).toBe(1);
    expect(await balance(bola.accountId)).toBe(naira(150_000));
  });
});

describe('runDueJobs', () => {
  it('reports the release job and what it did', async () => {
    const transfer = await pendingTransfer();
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );

    const run = await runDueJobs();
    expect(run.skipped).toBe(false);
    expect(run.jobs).toEqual([{ name: 'transfers.release', ok: true, released: 1 }]);
  });

  it('does not pay twice when two runs race', async () => {
    const transfer = await pendingTransfer();
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );

    await Promise.all([runDueJobs(), runDueJobs()]);
    expect(await balance(bola.accountId)).toBe(naira(150_000));
  });
});
