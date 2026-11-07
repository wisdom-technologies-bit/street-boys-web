import { getPool } from '@/server/db/client';
import { TransferError } from './errors';

/**
 * The caller's own transfers, newest first.
 *
 * Only outgoing ones exist in v1, and only the caller's: the query is scoped by
 * `sender_user_id`, so there is no shape of this call that returns somebody else's
 * history. The receiver's display name is included because it is the player's own
 * record of who they paid; balances and ids of other accounts are not.
 */

export const TRANSFER_LIST_DEFAULT_LIMIT = 20;
export const TRANSFER_LIST_MAX_LIMIT = 50;

export type TransferListItem = {
  id: string;
  at: Date;
  amountKobo: bigint;
  taxKobo: bigint;
  status: string;
  releaseAt: Date | null;
  toName: string;
};

export type TransferPage = { transfers: TransferListItem[]; nextCursor: string | null };

export async function listTransfers(
  senderUserId: string,
  options: { limit?: number; before?: string | null } = {},
): Promise<TransferPage> {
  const limit = Math.min(
    Math.max(options.limit ?? TRANSFER_LIST_DEFAULT_LIMIT, 1),
    TRANSFER_LIST_MAX_LIMIT,
  );
  const before = options.before ?? null;

  // The cursor is an id, resolved to its timestamp inside this sender's own rows, so
  // a guessed id from somebody else's history cannot move this player's page.
  let cursor: { created_at: Date } | null = null;
  if (before) {
    const { rows } = await getPool().query<{ created_at: Date }>(
      'select created_at from transfers where id = $1 and sender_user_id = $2',
      [before, senderUserId],
    );
    if (!rows[0]) throw new TransferError('invalid_request', 'that cursor is not valid');
    cursor = rows[0];
  }

  const { rows } = await getPool().query<{
    id: string;
    created_at: Date;
    amount_kobo: string;
    tax_kobo: string;
    status: string;
    release_at: Date | null;
    receiver_name: string;
  }>(
    `select t.id, t.created_at, t.amount_kobo, t.tax_kobo, t.status, t.release_at,
            c.name as receiver_name
       from transfers t
       join characters c on c.user_id = t.receiver_user_id
      where t.sender_user_id = $1
        and ($2::timestamptz is null
             or (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
      order by t.created_at desc, t.id desc
      limit $4`,
    [senderUserId, cursor?.created_at ?? null, before, limit + 1],
  );

  const page = rows.slice(0, limit);

  return {
    transfers: page.map((row) => ({
      id: row.id,
      at: row.created_at,
      amountKobo: BigInt(row.amount_kobo),
      taxKobo: BigInt(row.tax_kobo),
      status: row.status,
      releaseAt: row.release_at,
      toName: row.receiver_name,
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
