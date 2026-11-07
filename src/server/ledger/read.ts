import { getPool } from '@/server/db/client';
import { AccountNotFound, LedgerValidationError } from './errors';
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
  /** The transaction that reversed this one, if any. Set by the database, not by the reader. */
  reversedByTransactionId: string | null;
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

/** The player accounts among a set of user ids, keyed by user id. */
export async function getPlayerAccounts(userIds: string[]): Promise<Map<string, Account>> {
  if (userIds.length === 0) return new Map();

  const { rows } = await getPool().query<AccountRow>(
    "select * from accounts where kind = 'player' and owner_user_id = any($1::uuid[])",
    [userIds],
  );

  const byUser = new Map<string, Account>();
  for (const row of rows) {
    const account = toAccount(row);
    if (account.ownerUserId) byUser.set(account.ownerUserId, account);
  }
  return byUser;
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
    reversed_by_transaction_id: string | null;
  }>(
    `select t.*,
            (select r.id::text from ledger_transactions r where r.reverses_transaction_id = t.id limit 1)
              as reversed_by_transaction_id
       from ledger_transactions t
      where t.id = $1`,
    [transactionId],
  );

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
    reversedByTransactionId: row.reversed_by_transaction_id,
    entries: entries.map((entry) => ({
      id: BigInt(entry.id),
      accountId: entry.account_id,
      amountKobo: kobo(BigInt(entry.amount_kobo)),
      createdAt: entry.created_at,
    })),
  };
}

/**
 * A transaction by its idempotency key, or null.
 *
 * The key is how another module finds what it posted without keeping the id: a
 * transfer stores one key per leg, and reconciliation reads them back through here.
 */
export async function getTransactionByIdempotencyKey(
  idempotencyKey: string,
): Promise<Transaction | null> {
  const { rows } = await getPool().query<{ id: string }>(
    'select id from ledger_transactions where idempotency_key = $1',
    [idempotencyKey],
  );
  const id = rows[0]?.id;
  return id ? getTransaction(id) : null;
}

/** The transaction that reversed this one, if any. */
export async function getReversingTransaction(
  transactionId: string,
): Promise<{ id: string; idempotencyKey: string } | null> {
  const { rows } = await getPool().query<{ id: string; idempotency_key: string }>(
    'select id, idempotency_key from ledger_transactions where reverses_transaction_id = $1',
    [transactionId],
  );
  const row = rows[0];
  return row ? { id: row.id, idempotencyKey: row.idempotency_key } : null;
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
/** The largest page a statement may ask for. */
export const STATEMENT_MAX_LIMIT = 50;
/** The default page, which fits a phone screen with room for a "load more". */
export const STATEMENT_DEFAULT_LIMIT = 20;

export type StatementEntry = {
  /** The entry's own id, which is also the cursor: entries are strictly increasing. */
  id: bigint;
  createdAt: Date;
  /** Signed kobo: negative for money leaving the account. */
  amountKobo: Kobo;
  /** The account's balance immediately after this entry. */
  balanceAfterKobo: Kobo;
  category: string;
};

export type StatementPage = {
  entries: StatementEntry[];
  /** Pass as `beforeEntryId` for the next page, or null when there is no more. */
  nextCursor: string | null;
};

/**
 * One account's entries, newest first, each with the balance it left behind.
 *
 * The running balance is computed **in SQL**, as a window function over that
 * account's entries in id order, and only then paged. Computing it in TypeScript
 * from a page of entries would be wrong: a page starts mid-history, so the running
 * total must be taken over everything before it, not over the rows that fit in the
 * response. The window sum is over the account's whole history, so page two carries
 * the true balance and not a partial one.
 *
 * Paging is by `beforeEntryId` rather than by offset: the ledger only ever appends,
 * so an id cursor cannot skip or repeat a line when a transaction posts between two
 * page requests. The id is a `bigserial`, so `id < before` is the same as "older
 * than", and the `(account_id, id)` index makes it a range scan.
 */
export async function listStatement(
  accountId: string,
  options: { limit?: number; beforeEntryId?: string | null } = {},
): Promise<StatementPage> {
  const limit = options.limit ?? STATEMENT_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > STATEMENT_MAX_LIMIT) {
    throw new LedgerValidationError(
      `limit must be a whole number from 1 to ${STATEMENT_MAX_LIMIT}`,
      'invalid_request',
    );
  }

  const before = options.beforeEntryId ?? null;
  if (before !== null && !/^\d+$/.test(before)) {
    throw new LedgerValidationError('beforeEntryId must be an entry id', 'invalid_request');
  }

  const { rows } = await getPool().query<{
    id: string;
    created_at: Date;
    amount_kobo: string;
    balance_after: string;
    category: string;
  }>(
    `with running as (
       select e.id,
              e.created_at,
              e.amount_kobo,
              t.category,
              sum(e.amount_kobo) over (
                order by e.id
                rows between unbounded preceding and current row
              ) as balance_after
         from ledger_entries e
         join ledger_transactions t on t.id = e.transaction_id
        where e.account_id = $1
     )
     -- id stays a bigint here and only becomes a string in TypeScript: casting it to
     -- text in the select would make "order by id" sort 11 before 9, silently
     -- reversing the oldest and newest lines once ids pass ten.
     select id, created_at, amount_kobo::text, balance_after::text, category
       from running
      where ($2::bigint is null or id < $2::bigint)
      order by id desc
      limit $3`,
    [accountId, before, limit + 1],
  );

  // One extra row is fetched only to learn whether another page exists, so the
  // cursor is honest rather than "the page looked full".
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    entries: page.map((row) => ({
      id: BigInt(row.id),
      createdAt: row.created_at,
      amountKobo: kobo(BigInt(row.amount_kobo)),
      balanceAfterKobo: kobo(BigInt(row.balance_after)),
      category: row.category,
    })),
    nextCursor: hasMore && last ? last.id : null,
  };
}

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
