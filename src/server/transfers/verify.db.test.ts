import { getPool } from '@/server/db/client';
import { withLedgerWrite } from '@/server/ledger/test-support';
import { sendMoney } from './send';
import { cancelTransfer } from './cancel';
import { releaseDueTransfers } from './release';
import { balance, createPlayer, fund, resetTransfers } from './test-support';
import { verifyTransfers } from './verify';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Reconciliation, and proof that it notices.
 *
 * A verifier that only ever says "fine" is worthless, so every check here is shown
 * working against a broken database as well as a healthy one.
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

const failed = async () =>
  (await verifyTransfers()).checks.filter((check) => check.count > 0).map((check) => check.check);

describe('verifyTransfers', () => {
  it('is happy with an empty economy and with every kind of transfer', async () => {
    expect((await verifyTransfers()).ok).toBe(true);

    const instant = await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(60_000),
      idempotencyKey: crypto.randomUUID(),
    });
    const pending = await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(150_000),
      idempotencyKey: crypto.randomUUID(),
    });
    await cancelTransfer({ senderUserId: ada.userId, transferId: pending.id });
    void instant;

    expect((await verifyTransfers()).ok).toBe(true);
  });

  it('notices escrow holding more than the pending transfers promise', async () => {
    await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(150_000),
      idempotencyKey: crypto.randomUUID(),
    });

    const escrow = await getPool().query<{ id: string }>(
      "select id from accounts where code = 'ESCROW_TRANSFERS'",
    );
    const escrowId = escrow.rows[0]?.id as string;

    await withLedgerWrite(async (client) => {
      await client.query(
        'update account_balances set balance_kobo = balance_kobo + 100 where account_id = $1',
        [escrowId],
      );
    });

    expect(await failed()).toContain('escrow_balance_mismatch');
    expect(await balance(escrowId)).toBe(naira(152_000) + 100n);
  });

  it('notices a transfer whose postings are missing', async () => {
    await getPool().query(
      `insert into transfers (sender_user_id, receiver_user_id, amount_kobo, tax_kobo, status,
                              idempotency_key, release_at)
       values ($1, $2, 5000, 0, 'pending', gen_random_uuid(), now() + interval '1 day')`,
      [ada.userId, bola.userId],
    );

    const problems = await failed();
    expect(problems).toContain('transfer_without_posting');
    expect(problems).toContain('escrow_balance_mismatch');
    expect(problems).toContain('transfer_status_without_posting');
  });

  it('notices a posting whose amount does not match its transfer', async () => {
    const transfer = await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(150_000),
      idempotencyKey: crypto.randomUUID(),
    });

    // The ledger is append-only, so the corruption a bug could actually produce is a
    // transfer row that no longer describes what was posted.
    await getPool().query('update transfers set amount_kobo = 1 where id = $1', [transfer.id]);

    expect(await failed()).toContain('transfer_posting_amount_mismatch');
  });

  it('notices a pending transfer with no deadline', async () => {
    const transfer = await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(150_000),
      idempotencyKey: crypto.randomUUID(),
    });
    await getPool().query('update transfers set release_at = null where id = $1', [transfer.id]);

    expect(await failed()).toContain('pending_without_release_at');
  });

  it('stays happy through a release', async () => {
    const transfer = await sendMoney({
      senderUserId: ada.userId,
      toName: bola.name,
      amountKobo: naira(150_000),
      idempotencyKey: crypto.randomUUID(),
    });
    await getPool().query(
      "update transfers set release_at = now() - interval '1 minute' where id = $1",
      [transfer.id],
    );
    await releaseDueTransfers();

    expect(await balance(bola.accountId)).toBe(naira(150_000));
    expect((await verifyTransfers()).ok).toBe(true);
  });
});
