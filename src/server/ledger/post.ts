import type { PoolClient } from 'pg';
import { z } from 'zod';
import { isLedgerCategory } from '@/server/config/ledger-categories';
import { MAX_ENTRIES_PER_TX, MAX_TX_KOBO } from '@/server/config/ledger-limits';
import { getPool } from '@/server/db/client';
import { sha256Hex } from '@/server/security/crypto';
import {
  AccountFrozen,
  AccountNotFound,
  IdempotencyConflict,
  InsufficientFunds,
  LedgerValidationError,
} from './errors';
import { kobo, type Kobo } from './money';

/**
 * Posting a transaction.
 *
 * One movement of money is one transaction with at least two entries that sum to
 * zero. The module does three things in a single database transaction, in this
 * order, because each one depends on the previous:
 *
 * 1. **Record the transaction, or discover it already happened.** The idempotency
 *    key is unique; `on conflict do nothing` makes a retry a read rather than a
 *    second movement. The request fingerprint decides whether the retry is the
 *    same request (replay) or a different one wearing the same key (a bug).
 * 2. **Lock the balances it will touch**, always in `account_id` order, so two
 *    transactions that touch the same pair of accounts cannot deadlock; Postgres
 *    queues them instead. Freezing is checked while holding the lock, so a
 *    freeze takes effect on the next transaction rather than at some later read.
 * 3. **Write the entries and move the balances.** A debit that would take a
 *    balance below zero is refused by the database's own CHECK, not only by a
 *    comparison in TypeScript, so no code path can spend money twice.
 *
 * A deadlock or serialization failure is retried: those mean "try again", not
 * "you may not do this". Every other failure is typed and leaves nothing behind.
 */

/**
 * Metadata is for a human reading a report, never for identifying a person or
 * carrying a credential. The same rule as the audit log, deliberately.
 */
const FORBIDDEN_METADATA_KEYS = [
  'code',
  'otp',
  'token',
  'password',
  'secret',
  'email',
  'phone',
  'ip',
];

export type LedgerEntryInput = { accountId: string; amountKobo: bigint };

export type PostTransactionInput = {
  /** Unique per movement. A retry passes the same key and moves money once. */
  idempotencyKey: string;
  category: string;
  entries: LedgerEntryInput[];
  metadata?: Record<string, unknown>;
  actorUserId?: string;
  reversesTransactionId?: string;
};

export type PostedBalance = { accountId: string; balanceKobo: Kobo };

export type PostedTransaction = {
  transactionId: string;
  /** True when this call found the key already used with the same payload. */
  replayed: boolean;
  /** Every involved account's balance after the transaction. */
  balances: PostedBalance[];
};

const entrySchema = z.object({
  accountId: z.uuid(),
  amountKobo: z.bigint(),
});

const inputSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  category: z.string().min(1),
  entries: z.array(entrySchema).min(2).max(MAX_ENTRIES_PER_TX),
  metadata: z.record(z.string(), z.unknown()).optional(),
  actorUserId: z.uuid().optional(),
  reversesTransactionId: z.uuid().optional(),
});

type NormalizedRequest = {
  idempotencyKey: string;
  category: string;
  entries: LedgerEntryInput[];
  metadata: Record<string, unknown>;
  actorUserId: string | null;
  reversesTransactionId: string | null;
};

function assertMetadataIsSafe(value: unknown, path = 'metadata'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataIsSafe(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalised = key.toLowerCase().replace(/[^a-z]/g, '');
      if (FORBIDDEN_METADATA_KEYS.some((word) => normalised.includes(word))) {
        throw new LedgerValidationError(
          `ledger metadata must not contain "${path}.${key}": it is for reporting, not for identifying anyone`,
          'unsafe_metadata',
        );
      }
      assertMetadataIsSafe(child, `${path}.${key}`);
    }
  }
}

/** Validate the request completely, before the database is touched at all. */
function normalize(input: PostTransactionInput): NormalizedRequest {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const tooFew = parsed.error.issues.some(
      (issue) => issue.code === 'too_small' && issue.path[0] === 'entries',
    );
    throw new LedgerValidationError(
      tooFew ? 'a transaction needs at least two entries' : 'the transaction is not valid',
      tooFew ? 'too_few_entries' : 'invalid_request',
    );
  }

  const request = parsed.data;

  if (!isLedgerCategory(request.category)) {
    throw new LedgerValidationError(
      `"${request.category}" is not a ledger category`,
      'unknown_category',
    );
  }

  const seen = new Set<string>();
  for (const entry of request.entries) {
    if (entry.amountKobo === 0n) {
      throw new LedgerValidationError('an entry of zero kobo is not a movement', 'zero_amount');
    }
    if (seen.has(entry.accountId)) {
      throw new LedgerValidationError(
        'one transaction cannot touch the same account twice',
        'duplicate_account',
      );
    }
    seen.add(entry.accountId);
  }

  let total = 0n;
  let moved = 0n;
  for (const entry of request.entries) {
    total += entry.amountKobo;
    if (entry.amountKobo > 0n) moved += entry.amountKobo;
  }

  if (total !== 0n) {
    throw new LedgerValidationError('the entries of a transaction must sum to zero', 'unbalanced');
  }

  if (moved > MAX_TX_KOBO) {
    throw new LedgerValidationError(
      'this transaction moves more than the per-transaction limit',
      'amount_too_large',
    );
  }

  assertMetadataIsSafe(request.metadata ?? {});

  return {
    idempotencyKey: request.idempotencyKey,
    category: request.category,
    entries: request.entries,
    metadata: request.metadata ?? {},
    actorUserId: request.actorUserId ?? null,
    reversesTransactionId: request.reversesTransactionId ?? null,
  };
}

/**
 * A hash of what the request asks for, independent of entry order.
 *
 * Two calls with the same key and the same intent are a retry and must replay.
 * The same key with a different intent is a bug and must not silently post the
 * first payload's money again.
 */
export function requestFingerprint(request: {
  category: string;
  entries: LedgerEntryInput[];
  reversesTransactionId?: string | null;
}): string {
  const entries = [...request.entries]
    .map((entry) => `${entry.accountId}:${entry.amountKobo.toString()}`)
    .sort()
    .join('|');
  return sha256Hex(`${request.category}|${request.reversesTransactionId ?? ''}|${entries}`);
}

type PgError = { code?: string };

function isRetryable(error: unknown): boolean {
  const code = (error as PgError | null)?.code;
  // deadlock_detected, serialization_failure
  return code === '40P01' || code === '40001';
}

function isCheckViolation(error: unknown): boolean {
  return (error as PgError | null)?.code === '23514';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBalances(client: PoolClient, accountIds: string[]): Promise<PostedBalance[]> {
  const { rows } = await client.query<{ account_id: string; balance_kobo: string }>(
    'select account_id, balance_kobo from account_balances where account_id = any($1::uuid[]) order by account_id',
    [accountIds],
  );
  return rows.map((row) => ({
    accountId: row.account_id,
    balanceKobo: kobo(BigInt(row.balance_kobo)),
  }));
}

async function postOnce(
  request: NormalizedRequest,
  fingerprint: string,
): Promise<PostedTransaction> {
  const client = await getPool().connect();
  const accountIds = request.entries.map((entry) => entry.accountId);

  try {
    await client.query('begin');
    // The gate the database insists on before it will write a balance.
    await client.query("select set_config('app.ledger_write', 'on', true)");

    const inserted = await client.query<{ id: string }>(
      `insert into ledger_transactions
         (idempotency_key, request_fingerprint, category, actor_user_id, reverses_transaction_id, metadata)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        request.idempotencyKey,
        fingerprint,
        request.category,
        request.actorUserId,
        request.reversesTransactionId,
        JSON.stringify(request.metadata),
      ],
    );

    if (!inserted.rowCount) {
      // The key exists. Same intent: replay it. Different intent: refuse.
      const existing = await client.query<{ id: string; request_fingerprint: string }>(
        'select id, request_fingerprint from ledger_transactions where idempotency_key = $1',
        [request.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('idempotency key conflict without a row: this cannot happen');
      if (row.request_fingerprint !== fingerprint) {
        await client.query('rollback');
        throw new IdempotencyConflict(request.idempotencyKey);
      }

      const balances = await readBalances(client, accountIds);
      await client.query('commit');
      return { transactionId: row.id, replayed: true, balances };
    }

    const transactionId = inserted.rows[0]?.id as string;

    // Lock every balance this transaction will touch, in a fixed order.
    const locked = await client.query<{
      account_id: string;
      balance_kobo: string;
      allow_negative: boolean;
    }>(
      `select account_id, balance_kobo, allow_negative
         from account_balances
        where account_id = any($1::uuid[])
        order by account_id
          for update`,
      [accountIds],
    );

    if (locked.rowCount !== accountIds.length) {
      const known = new Set(locked.rows.map((row) => row.account_id));
      const missing = accountIds.find((id) => !known.has(id));
      throw new AccountNotFound(missing ?? 'unknown');
    }

    const debited = request.entries
      .filter((entry) => entry.amountKobo < 0n)
      .map((entry) => entry.accountId);

    if (debited.length > 0) {
      const frozen = await client.query<{ id: string }>(
        'select id from accounts where id = any($1::uuid[]) and frozen_at is not null order by id limit 1',
        [debited],
      );
      const frozenId = frozen.rows[0]?.id;
      if (frozenId) throw new AccountFrozen(frozenId);
    }

    for (const entry of request.entries) {
      await client.query(
        'insert into ledger_entries (transaction_id, account_id, amount_kobo) values ($1, $2, $3)',
        [transactionId, entry.accountId, entry.amountKobo.toString()],
      );
    }

    for (const entry of request.entries) {
      try {
        await client.query(
          `update account_balances
              set balance_kobo = balance_kobo + $2,
                  version = version + 1,
                  updated_at = now()
            where account_id = $1`,
          [entry.accountId, entry.amountKobo.toString()],
        );
      } catch (error) {
        // The overdraft CHECK fired: this debit is not affordable.
        if (isCheckViolation(error)) throw new InsufficientFunds(entry.accountId);
        throw error;
      }
    }

    const balances = await readBalances(client, accountIds);
    await client.query('commit');
    return { transactionId, replayed: false, balances };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function postTransaction(input: PostTransactionInput): Promise<PostedTransaction> {
  const request = normalize(input);
  const fingerprint = requestFingerprint(request);

  const maxAttempts = 4; // the first try, then up to three retries
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await postOnce(request, fingerprint);
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxAttempts) throw error;
      // Jitter, so two losers of the same deadlock do not collide again.
      await sleep(Math.floor(Math.random() * 25 * attempt) + 5);
    }
  }
}
