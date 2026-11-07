import type { PoolClient } from 'pg';
import { getPool } from '@/server/db/client';

/**
 * verifyLedger: the check that the ledger still adds up.
 *
 * Every guarantee in this module is enforced by the database, so in a healthy
 * system this reports nothing. It exists for the two cases the database cannot
 * catch: a write by a table owner who disabled a trigger, and a bug in a future
 * migration. When those happen, money is wrong and the only honest response is to
 * find out before a player does.
 *
 * The whole report is read inside one REPEATABLE READ, READ ONLY transaction, so
 * the counts and the samples describe the same moment even while players are
 * earning. Without that, a transaction landing midway could make a healthy ledger
 * look broken (a balance that already moved, an entry that is not there yet) and
 * the alarm would be noise.
 *
 * The output contains identifiers and counts only: no email, no name, no amount
 * per person. Enough to investigate, nothing that turns a monitoring endpoint into
 * a data leak.
 */

export type VerifyCheck =
  | 'transaction_unbalanced_or_thin'
  | 'ledger_total_not_zero'
  | 'balance_mismatch'
  | 'version_mismatch'
  | 'negative_balance_without_permission'
  | 'account_without_balance'
  | 'balance_without_account'
  | 'system_account_missing'
  | 'reversal_not_negation'
  | 'reversal_of_reversal'
  | 'reversal_category_mismatch'
  | 'reversal_target_missing';

export type VerifyFailure = {
  check: VerifyCheck;
  count: number;
  /** At most 20 ids, so a report stays small enough for a log line. */
  sampleIds: string[];
};

export type VerifyReport = {
  ok: boolean;
  checkedAt: string;
  counts: {
    accounts: number;
    transactions: number;
    entries: number;
    reversals: number;
  };
  failures: VerifyFailure[];
};

const SAMPLE_LIMIT = 20;

type CheckSpec = {
  check: VerifyCheck;
  /** Counts every offending row. */
  countSql: string;
  /** Returns offending ids, capped, for an investigation to start from. */
  idSql: string;
};

/**
 * The checks, in the order a reader should think about them: within a transaction,
 * across the whole ledger, then per account, then the links between transactions.
 */
const CHECKS: CheckSpec[] = [
  {
    check: 'transaction_unbalanced_or_thin',
    countSql: `select count(*)::text as count from (
                select t.id from ledger_transactions t
                  left join ledger_entries e on e.transaction_id = t.id
                 group by t.id
                having count(e.id) < 2 or coalesce(sum(e.amount_kobo), 0) <> 0
              ) broken`,
    idSql: `select t.id::text as id from ledger_transactions t
              left join ledger_entries e on e.transaction_id = t.id
             group by t.id
            having count(e.id) < 2 or coalesce(sum(e.amount_kobo), 0) <> 0
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'ledger_total_not_zero',
    countSql: `select case when coalesce(sum(amount_kobo), 0) = 0 then 0 else 1 end::text as count
                 from ledger_entries`,
    // The total is a single fact, not a row to point at: no ids, only the count.
    idSql: `select null::text as id where coalesce((select sum(amount_kobo) from ledger_entries), 0) <> 0`,
  },
  {
    check: 'balance_mismatch',
    countSql: `select count(*)::text as count
                 from account_balances b
                 left join (select account_id, sum(amount_kobo) as total from ledger_entries group by account_id) e
                   on e.account_id = b.account_id
                where b.balance_kobo <> coalesce(e.total, 0)`,
    idSql: `select b.account_id::text as id
              from account_balances b
              left join (select account_id, sum(amount_kobo) as total from ledger_entries group by account_id) e
                on e.account_id = b.account_id
             where b.balance_kobo <> coalesce(e.total, 0)
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'version_mismatch',
    countSql: `select count(*)::text as count
                 from account_balances b
                 left join (select account_id, count(*) as n from ledger_entries group by account_id) e
                   on e.account_id = b.account_id
                where b.version <> coalesce(e.n, 0)`,
    idSql: `select b.account_id::text as id
              from account_balances b
              left join (select account_id, count(*) as n from ledger_entries group by account_id) e
                on e.account_id = b.account_id
             where b.version <> coalesce(e.n, 0)
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'negative_balance_without_permission',
    countSql: `select count(*)::text as count
                 from account_balances b
                where b.balance_kobo < 0 and not b.allow_negative`,
    idSql: `select b.account_id::text as id
              from account_balances b
             where b.balance_kobo < 0 and not b.allow_negative
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'account_without_balance',
    countSql: `select count(*)::text as count
                 from accounts a left join account_balances b on b.account_id = a.id
                where b.account_id is null`,
    idSql: `select a.id::text as id
              from accounts a left join account_balances b on b.account_id = a.id
             where b.account_id is null
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'balance_without_account',
    countSql: `select count(*)::text as count
                 from account_balances b left join accounts a on a.id = b.account_id
                where a.id is null`,
    idSql: `select b.account_id::text as id
              from account_balances b left join accounts a on a.id = b.account_id
             where a.id is null
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'system_account_missing',
    countSql: `select (3 - count(*))::text as count
                 from accounts where code in ('SYSTEM_MINT', 'SYSTEM_BURN', 'TREASURY')`,
    // Missing rows have no id to report; the missing codes are in the check name.
    idSql: `select null::text as id where (select count(*) from accounts where code in ('SYSTEM_MINT', 'SYSTEM_BURN', 'TREASURY')) < 3`,
  },
  {
    check: 'reversal_not_negation',
    countSql: `with pairs as (
                 select r.id as reversal_id, o.id as original_id
                   from ledger_transactions r
                   join ledger_transactions o on o.id = r.reverses_transaction_id
               ), sums as (
                 select p.reversal_id, p.original_id, e.account_id,
                        coalesce(sum(case when e.transaction_id = p.reversal_id then e.amount_kobo end), 0) as rev,
                        coalesce(sum(case when e.transaction_id = p.original_id then e.amount_kobo end), 0) as orig
                   from pairs p
                   join ledger_entries e on e.transaction_id in (p.reversal_id, p.original_id)
                  group by p.reversal_id, p.original_id, e.account_id
               )
               select count(*)::text as count from (
                 select reversal_id from sums where rev <> -orig
                 union
                 select p.reversal_id from pairs p
                  where not exists (select 1 from ledger_entries e where e.transaction_id = p.reversal_id)
               ) broken`,
    idSql: `with pairs as (
              select r.id as reversal_id, o.id as original_id
                from ledger_transactions r
                join ledger_transactions o on o.id = r.reverses_transaction_id
            ), sums as (
              select p.reversal_id, p.original_id, e.account_id,
                     coalesce(sum(case when e.transaction_id = p.reversal_id then e.amount_kobo end), 0) as rev,
                     coalesce(sum(case when e.transaction_id = p.original_id then e.amount_kobo end), 0) as orig
                from pairs p
                join ledger_entries e on e.transaction_id in (p.reversal_id, p.original_id)
               group by p.reversal_id, p.original_id, e.account_id
            )
            select distinct reversal_id::text as id from (
              select reversal_id from sums where rev <> -orig
              union
              select p.reversal_id from pairs p
               where not exists (select 1 from ledger_entries e where e.transaction_id = p.reversal_id)
            ) broken
            limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'reversal_of_reversal',
    countSql: `select count(*)::text as count
                 from ledger_transactions r
                 join ledger_transactions o on o.id = r.reverses_transaction_id
                where o.reverses_transaction_id is not null`,
    idSql: `select r.id::text as id
              from ledger_transactions r
              join ledger_transactions o on o.id = r.reverses_transaction_id
             where o.reverses_transaction_id is not null
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'reversal_category_mismatch',
    countSql: `select count(*)::text as count
                 from ledger_transactions
                where (category = 'reversal') <> (reverses_transaction_id is not null)`,
    idSql: `select id::text as id
              from ledger_transactions
             where (category = 'reversal') <> (reverses_transaction_id is not null)
             limit ${SAMPLE_LIMIT}`,
  },
  {
    check: 'reversal_target_missing',
    countSql: `select count(*)::text as count
                 from ledger_transactions r
                 left join ledger_transactions o on o.id = r.reverses_transaction_id
                where r.reverses_transaction_id is not null and o.id is null`,
    idSql: `select r.id::text as id
              from ledger_transactions r
              left join ledger_transactions o on o.id = r.reverses_transaction_id
             where r.reverses_transaction_id is not null and o.id is null
             limit ${SAMPLE_LIMIT}`,
  },
];

async function scalarCount(client: PoolClient, sql: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(sql);
  return Number(rows[0]?.count ?? '0');
}

async function sampleIds(client: PoolClient, sql: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string | null }>(sql);
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export async function verifyLedger(): Promise<VerifyReport> {
  const client = await getPool().connect();

  try {
    await client.query('begin isolation level repeatable read read only');

    const counts = await client.query<{
      accounts: string;
      transactions: string;
      entries: string;
      reversals: string;
    }>(
      `select (select count(*) from accounts)::text as accounts,
              (select count(*) from ledger_transactions)::text as transactions,
              (select count(*) from ledger_entries)::text as entries,
              (select count(*) from ledger_transactions where reverses_transaction_id is not null)::text as reversals`,
    );

    const failures: VerifyFailure[] = [];
    for (const check of CHECKS) {
      const count = await scalarCount(client, check.countSql);
      if (count === 0) continue;
      failures.push({ check: check.check, count, sampleIds: await sampleIds(client, check.idSql) });
    }

    await client.query('commit');

    const row = counts.rows[0];
    return {
      ok: failures.length === 0,
      checkedAt: new Date().toISOString(),
      counts: {
        accounts: Number(row?.accounts ?? '0'),
        transactions: Number(row?.transactions ?? '0'),
        entries: Number(row?.entries ?? '0'),
        reversals: Number(row?.reversals ?? '0'),
      },
      failures,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** A one-line summary, for a log or a route response. Ids stay in `failures`. */
export function summarizeReport(report: VerifyReport): string {
  if (report.ok) {
    return `ledger ok: ${report.counts.transactions} transactions, ${report.counts.entries} entries, ${report.counts.accounts} accounts, ${report.counts.reversals} reversals`;
  }
  const parts = report.failures.map((failure) => `${failure.check}=${failure.count}`);
  return `ledger FAILED: ${parts.join(', ')}`;
}
