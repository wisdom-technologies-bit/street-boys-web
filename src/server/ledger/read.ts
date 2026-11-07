import { getPool } from '@/server/db/client';
import { AccountNotFound } from './errors';
import { kobo, type Kobo } from './money';
import type { LedgerEntryInput } from './post';

/**
 * Reading the ledger.
 *
 * Reads never take the write gate or a lock: they are queries against tables that
 * only ever grow. Amounts come back as bigint kobo, never numbers, for the same
 * reason they are stored that way.
 */

export type Account = {
  id: string;
  kind: 'player' | 'system' | 'treasury' | 'escrow';
  code: string | null;
  ownerUserId: string | null;
  allowNegative: boolean;
  frozen: boolean;
  createdAt: Date;
};

export type LedgerEntry = {
  id: bigint;
  accountId: string;
  amountKobo: Kobo;
  createdAt: Date;
};

export type Transaction = {
  id: string;
  category: string;
  idempotencyKey: string;
  actorUserId: string | null;
  reversesTransactionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  entries: LedgerEntry[];
};

type AccountRow = {
  id: string;
  kind: Account['kind'];
  code: string | null;
  owner_user_id: string | null;
  allow_negative: boolean;
  frozen_at: Date | null;
  created_at: Date;
};

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  kind: row.kind,
  code: row.code,
  ownerUserId: row.owner_user_id,
  allowNegative: row.allow_negative,
  frozen: row.frozen_at !== null,
  createdAt: row.created_at,
});

/** A fixed account, by its code: SYSTEM_MINT, SYSTEM_BURN or TREASURY. */
export async function getAccountByCode(code: string): Promise<Account | null> {
  const { rows } = await getPool().query<AccountRow>('select * from accounts where code = $1', [
    code,
  ]);
  const row = rows[0];
  return row ? toAccount(row) : null;
}

/** A player's account, if it exists. */
export async function getPlayerAccount(userId: string): Promise<Account | null> {
  const { rows } = await getPool().query<AccountRow>(
    "select * from accounts where kind = 'player' and owner_user_id = $1",
    [userId],
  );
  const row = rows[0];
  return row ? toAccount(row) : null;
}

/** The balance of an account, or a typed error when the account does not exist. */
export async function getBalance(accountId: string): Promise<Kobo> {
  const { rows } = await getPool().query<{ balance_kobo: string }>(
    'select balance_kobo from account_balances where account_id = $1',
    [accountId],
  );
  const row = rows[0];
  if (!row) throw new AccountNotFound(accountId);
  return kobo(BigInt(row.balance_kobo));
}

/** One transaction with its entries, in entry order. */
export async function getTransaction(transactionId: string): Promise<Transaction | null> {
  const { rows } = await getPool().query<{
    id: string;
    category: string;
    idempotency_key: string;
    actor_user_id: string | null;
    reverses_transaction_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>('select * from ledger_transactions where id = $1', [transactionId]);

  const row = rows[0];
  if (!row) return null;

  const { rows: entries } = await getPool().query<{
    id: string;
    account_id: string;
    amount_kobo: string;
    created_at: Date;
  }>(
    'select id, account_id, amount_kobo, created_at from ledger_entries where transaction_id = $1 order by id',
    [transactionId],
  );

  return {
    id: row.id,
    category: row.category,
    idempotencyKey: row.idempotency_key,
    actorUserId: row.actor_user_id,
    reversesTransactionId: row.reverses_transaction_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    entries: entries.map((entry) => ({
      id: BigInt(entry.id),
      accountId: entry.account_id,
      amountKobo: kobo(BigInt(entry.amount_kobo)),
      createdAt: entry.created_at,
    })),
  };
}

/**
 * An account's entries, newest first, with keyset pagination.
 *
 * Keyset, not `offset`: the ledger only grows, so `afterEntryId` is a stable
 * cursor while an offset shifts under a page when new entries land. `limit` is
 * capped so one call cannot ask for the whole history.
 */
export async function listEntries(
  accountId: string,
  options: { limit?: number; afterEntryId?: bigint } = {},
): Promise<LedgerEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const after = options.afterEntryId ?? null;

  const { rows } = await getPool().query<{
    id: string;
    account_id: string;
    amount_kobo: string;
    created_at: Date;
  }>(
    `select id, account_id, amount_kobo, created_at
       from ledger_entries
      where account_id = $1
        and ($2::bigint is null or id < $2::bigint)
      order by id desc
      limit $3`,
    [accountId, after === null ? null : after.toString(), limit],
  );

  return rows.map((row) => ({
    id: BigInt(row.id),
    accountId: row.account_id,
    amountKobo: kobo(BigInt(row.amount_kobo)),
    createdAt: row.created_at,
  }));
}

/**
 * A player's account, created on first use.
 *
 * Idempotent on purpose: a player has exactly one account, and calling this twice
 * (a retry, two requests racing on first sign-in) returns the same account rather
 * than failing or creating a second one. Not wired to sign-up yet: the ledger
 * prompt explicitly leaves that to a later prompt.
 */
export async function createPlayerAccount(userId: string): Promise<Account> {
  const existing = await getPlayerAccount(userId);
  if (existing) return existing;

  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.ledger_write', 'on', true)");

    const inserted = await client.query<AccountRow>(
      `insert into accounts (kind, owner_user_id)
       values ('player', $1)
       on conflict (owner_user_id) do nothing
       returning *`,
      [userId],
    );

    let row = inserted.rows[0];

    if (!row) {
      const { rows } = await client.query<AccountRow>(
        "select * from accounts where kind = 'player' and owner_user_id = $1",
        [userId],
      );
      row = rows[0];
    }

    if (!row)
      throw new Error('account insert conflicted without an existing row: this cannot happen');

    await client.query(
      `insert into account_balances (account_id, allow_negative)
       values ($1, false)
       on conflict (account_id) do nothing`,
      [row.id],
    );

    await client.query('commit');
    return toAccount(row);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Freeze or unfreeze a player's account. Freezing stops debits and allows credits. */
export async function setAccountFrozen(accountId: string, frozen: boolean): Promise<void> {
  await getPool().query(
    'update accounts set frozen_at = case when $2 then now() else null end where id = $1',
    [accountId, frozen],
  );
}

export type { LedgerEntryInput };
