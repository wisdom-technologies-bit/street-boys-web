import type { Pool, PoolClient } from 'pg';
import type { TransferTier } from '@/server/config/transfer-params';

/**
 * Rolling 24-hour limits.
 *
 * "Per day" in docs/14 means any 24 hours, not a calendar day: a calendar day can
 * be spent twice in a minute at midnight (D-163). The sums are taken from the
 * `transfers` table rather than kept in a counter, so they cannot drift: completed
 * and pending transfers count (pending money has already left the sender), and
 * cancelled or refunded ones do not.
 */

const WINDOW_MS = 86_400_000;

/** Statuses that have taken money from the sender and still count. */
export const COUNTED_STATUSES = ['completed', 'pending'] as const;

export type WindowTotals = {
  /** Amount plus tax this user has sent in the last 24 hours. */
  sentKobo: bigint;
  /** Amount this user has received in the last 24 hours. */
  receivedKobo: bigint;
};

export async function rollingTotals(
  executor: Pool | PoolClient,
  userId: string,
  now: Date = new Date(),
): Promise<WindowTotals> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const { rows } = await executor.query<{ sent: string | null; received: string | null }>(
    `select
       coalesce(sum(case when sender_user_id = $1 then amount_kobo + tax_kobo end), 0)::text as sent,
       coalesce(sum(case when receiver_user_id = $1 then amount_kobo end), 0)::text as received
       from transfers
      where created_at > $2 and status = any($3::text[])`,
    [userId, since, COUNTED_STATUSES],
  );

  return {
    sentKobo: BigInt(rows[0]?.sent ?? '0'),
    receivedKobo: BigInt(rows[0]?.received ?? '0'),
  };
}

/** What is left of the sender's daily allowance. Never negative. */
export function sendRemaining(tier: TransferTier, totals: WindowTotals): bigint {
  const left = tier.maxSendPer24hKobo - totals.sentKobo;
  return left > 0n ? left : 0n;
}
