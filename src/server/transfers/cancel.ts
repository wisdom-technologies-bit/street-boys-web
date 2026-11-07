import { z } from 'zod';
import { getPool } from '@/server/db/client';
import { getAccountByCode, getPlayerAccount, postTransaction } from '@/server/ledger';
import { logEvent } from '@/server/security/audit';
import { TransferError } from './errors';

/**
 * Cancelling a pending transfer.
 *
 * Only the sender, and only while the money is still in escrow: a completed
 * transfer can be reversed (the ledger has that) but it cannot be un-sent by
 * pretending it never left. Cancelling is therefore "the hold never happened", and
 * the refund is a real ledger movement out of escrow, not a deleted row (D-166).
 *
 * Cancelling twice is the same as cancelling once: the second call reports the same
 * cancelled transfer instead of failing, because a retried request is not a mistake.
 */

export type CancelResult = { id: string; status: 'cancelled'; replayed: boolean };

const inputSchema = z.object({ senderUserId: z.uuid(), transferId: z.uuid() });

export async function cancelTransfer(input: {
  senderUserId: string;
  transferId: string;
}): Promise<CancelResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new TransferError('invalid_request', 'the request is not valid');
  const { senderUserId, transferId } = parsed.data;

  const client = await getPool().connect();
  try {
    await client.query('begin');

    const { rows } = await client.query<{
      sender_user_id: string;
      status: string;
      amount_kobo: string;
      tax_kobo: string;
    }>(
      `select sender_user_id, status, amount_kobo, tax_kobo
         from transfers where id = $1 for update`,
      [transferId],
    );

    const transfer = rows[0];
    // Someone else's transfer is not found, not forbidden: the id alone should not
    // teach a stranger that it exists (D-164).
    if (!transfer || transfer.sender_user_id !== senderUserId) {
      throw new TransferError('not_found', 'there is no such transfer');
    }

    if (transfer.status === 'cancelled') {
      await client.query('commit');
      return { id: transferId, status: 'cancelled', replayed: true };
    }

    if (transfer.status !== 'pending') {
      throw new TransferError('not_cancellable', 'that transfer has already gone through');
    }

    const amountKobo = BigInt(transfer.amount_kobo);
    const taxKobo = BigInt(transfer.tax_kobo);
    const held = amountKobo + taxKobo;

    const escrow = await getAccountByCode('ESCROW_TRANSFERS');
    if (!escrow) throw new Error('ESCROW_TRANSFERS is missing; did the migration run?');

    await client.query(
      `update transfers set status = 'cancelled', resolved_at = now(), resolution_reason = 'cancelled_by_sender'
        where id = $1`,
      [transferId],
    );

    const senderAccount = await senderWallet(transfer.sender_user_id);

    await postTransaction({
      client,
      idempotencyKey: `transfer:${transferId}:refund`,
      category: 'escrow_refund',
      actorUserId: senderUserId,
      metadata: { transferId },
      entries: [
        { accountId: escrow.id, amountKobo: -held },
        { accountId: senderAccount, amountKobo: held },
      ],
    });

    await client.query('commit');

    await logEvent({
      eventType: 'transfer.cancelled',
      actorUserId: senderUserId,
      metadata: { transferId, amountKobo: amountKobo.toString(), taxKobo: taxKobo.toString() },
    }).catch(() => {});

    return { id: transferId, status: 'cancelled', replayed: false };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** The player account of a user, through the ledger only. */
async function senderWallet(userId: string): Promise<string> {
  const account = await getPlayerAccount(userId);
  if (!account) throw new TransferError('not_found', 'there is no wallet for that player');
  return account.id;
}
