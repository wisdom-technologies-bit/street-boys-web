import { getPool } from '@/server/db/client';
import { getAccountByCode, getPlayerAccount, postTransaction } from '@/server/ledger';
import { logEvent } from '@/server/security/audit';

/**
 * Releasing pending transfers whose day is up.
 *
 * One transaction per batch: the rows are selected `for update skip locked`, so a
 * second worker running at the same second takes different rows instead of blocking
 * or paying twice. The ledger's idempotency key (`transfer:<id>:release`) is the
 * second guard, and it is the one that survives a crash between commit and
 * bookkeeping.
 *
 * Release splits what escrow holds: the amount goes to the receiver, the tax to
 * TREASURY. A pending transfer that was cancelled is not `pending`, so it is never
 * selected.
 */

export type ReleaseResult = { released: number; failed: number };

export async function releaseDueTransfers(
  options: { limit?: number; now?: Date } = {},
): Promise<ReleaseResult> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const now = options.now ?? new Date();

  const client = await getPool().connect();
  let released = 0;

  try {
    await client.query('begin');

    const { rows } = await client.query<{
      id: string;
      sender_user_id: string;
      receiver_user_id: string;
      amount_kobo: string;
      tax_kobo: string;
    }>(
      `select id, sender_user_id, receiver_user_id, amount_kobo, tax_kobo
         from transfers
        where status = 'pending' and release_at is not null and release_at <= $1
        order by release_at, id
        limit $2
        for update skip locked`,
      [now, limit],
    );

    if (rows.length === 0) {
      await client.query('commit');
      return { released: 0, failed: 0 };
    }

    const escrow = await getAccountByCode('ESCROW_TRANSFERS');
    const treasury = await getAccountByCode('TREASURY');
    if (!escrow || !treasury)
      throw new Error('a system account is missing; did the migration run?');

    for (const transfer of rows) {
      const amountKobo = BigInt(transfer.amount_kobo);
      const taxKobo = BigInt(transfer.tax_kobo);

      const receiver = await getPlayerAccount(transfer.receiver_user_id);
      if (!receiver) {
        // The receiver's wallet is gone. Leave the row pending rather than invent a
        // destination: an operator can see it, and the money is still in escrow.
        continue;
      }

      await postTransaction({
        client,
        idempotencyKey: `transfer:${transfer.id}:release`,
        category: 'transfer',
        actorUserId: transfer.sender_user_id,
        metadata: { transferId: transfer.id },
        entries: [
          { accountId: escrow.id, amountKobo: -amountKobo },
          { accountId: receiver.id, amountKobo: amountKobo },
        ],
      });

      if (taxKobo > 0n) {
        await postTransaction({
          client,
          idempotencyKey: `transfer:${transfer.id}:release-tax`,
          category: 'transfer_tax',
          actorUserId: transfer.sender_user_id,
          metadata: { transferId: transfer.id },
          entries: [
            { accountId: escrow.id, amountKobo: -taxKobo },
            { accountId: treasury.id, amountKobo: taxKobo },
          ],
        });
      }

      await client.query(
        `update transfers set status = 'completed', resolved_at = $2 where id = $1`,
        [transfer.id, now],
      );
      released += 1;
    }

    await client.query('commit');

    if (released > 0) {
      await logEvent({
        eventType: 'transfer.released',
        metadata: { released },
      }).catch(() => {});
    }

    return { released, failed: rows.length - released };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
