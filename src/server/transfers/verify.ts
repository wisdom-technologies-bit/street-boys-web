import { getPool } from '@/server/db/client';

/**
 * Reconciliation for transfers.
 *
 * The ledger verifier proves the books balance. This proves the *transfers* table
 * agrees with them, which is the one thing the ledger cannot know: escrow holds
 * exactly the pending transfers, every transfer has its postings, and no transfer
 * sits in a state it cannot leave.
 *
 * It reads only counts and ids (AGENTS.md 5): a report is for finding rows, not for
 * printing players' money.
 */

const SAMPLE_LIMIT = 5;

export type TransferCheck = { check: string; count: number; sample: string[] };

export type TransferVerifyResult = { ok: boolean; checks: TransferCheck[] };

const CHECKS: { check: string; countSql: string; idSql: string }[] = [
  {
    // Escrow is a real account; what it holds must be what is promised to receivers.
    check: 'escrow_balance_mismatch',
    countSql: `with held as (
                 select coalesce(sum(amount_kobo + tax_kobo), 0) as total
                   from transfers where status = 'pending'
               ), escrow as (
                 select coalesce(b.balance_kobo, 0) as total
                   from accounts a left join account_balances b on b.account_id = a.id
                  where a.code = 'ESCROW_TRANSFERS'
               )
               select case when (select total from held) = (select total from escrow) then 0 else 1 end::text
                 as count`,
    idSql: `select a.id::text as id from accounts a where a.code = 'ESCROW_TRANSFERS' limit ${SAMPLE_LIMIT}`,
  },
  {
    // Every transfer must have at least one of its own ledger transactions.
    check: 'transfer_without_posting',
    countSql: `select count(*)::text as count
                 from transfers t
                where not exists (
                  select 1 from ledger_transactions x
                   where x.idempotency_key like 'transfer:' || t.id || ':%')`,
    idSql: `select t.id::text as id
              from transfers t
             where not exists (
               select 1 from ledger_transactions x
                where x.idempotency_key like 'transfer:' || t.id || ':%')
             limit ${SAMPLE_LIMIT}`,
  },
  {
    // The credit leg of the first posting must be the amount (plus tax for a hold).
    check: 'transfer_posting_amount_mismatch',
    countSql: `select count(*)::text as count
                 from transfers t
                 join ledger_transactions x
                   on x.idempotency_key in ('transfer:' || t.id || ':main',
                                            'transfer:' || t.id || ':hold')
                 join ledger_entries e on e.transaction_id = x.id
                where e.amount_kobo > 0
                  and e.amount_kobo <> t.amount_kobo
                      + case when x.idempotency_key like '%:hold' then t.tax_kobo else 0 end`,
    idSql: `select distinct t.id::text as id
              from transfers t
              join ledger_transactions x
                on x.idempotency_key in ('transfer:' || t.id || ':main',
                                         'transfer:' || t.id || ':hold')
              join ledger_entries e on e.transaction_id = x.id
             where e.amount_kobo > 0
               and e.amount_kobo <> t.amount_kobo
                   + case when x.idempotency_key like '%:hold' then t.tax_kobo else 0 end
             limit ${SAMPLE_LIMIT}`,
  },
  {
    // A pending transfer with no deadline would stay in escrow for ever.
    check: 'pending_without_release_at',
    countSql: `select count(*)::text as count
                 from transfers where status = 'pending' and release_at is null`,
    idSql: `select id::text as id
              from transfers where status = 'pending' and release_at is null
             limit ${SAMPLE_LIMIT}`,
  },
  {
    // Every state a transfer can be in has to be reachable from the money it moved.
    check: 'transfer_status_without_posting',
    countSql: `select count(*)::text as count
                 from transfers t
                where (t.status = 'pending'
                       and not exists (select 1 from ledger_transactions x
                                        where x.idempotency_key = 'transfer:' || t.id || ':hold'))
                   or (t.status = 'cancelled'
                       and not exists (select 1 from ledger_transactions x
                                        where x.idempotency_key = 'transfer:' || t.id || ':refund'))
                   or (t.status = 'completed'
                       and not exists (select 1 from ledger_transactions x
                                        where x.idempotency_key in ('transfer:' || t.id || ':main',
                                                                    'transfer:' || t.id || ':release')))`,
    idSql: `select t.id::text as id
              from transfers t
             where (t.status = 'pending'
                    and not exists (select 1 from ledger_transactions x
                                     where x.idempotency_key = 'transfer:' || t.id || ':hold'))
                or (t.status = 'cancelled'
                    and not exists (select 1 from ledger_transactions x
                                     where x.idempotency_key = 'transfer:' || t.id || ':refund'))
                or (t.status = 'completed'
                    and not exists (select 1 from ledger_transactions x
                                     where x.idempotency_key in ('transfer:' || t.id || ':main',
                                                                 'transfer:' || t.id || ':release')))
             limit ${SAMPLE_LIMIT}`,
  },
];

export async function verifyTransfers(): Promise<TransferVerifyResult> {
  const checks: TransferCheck[] = [];

  for (const definition of CHECKS) {
    const { rows: countRows } = await getPool().query<{ count: string }>(definition.countSql);
    const count = Number(countRows[0]?.count ?? '0');
    if (count === 0) {
      checks.push({ check: definition.check, count: 0, sample: [] });
      continue;
    }

    const { rows: idRows } = await getPool().query<{ id: string | null }>(definition.idSql);
    checks.push({
      check: definition.check,
      count,
      sample: idRows.map((row) => row.id).filter((id): id is string => Boolean(id)),
    });
  }

  return { ok: checks.every((check) => check.count === 0), checks };
}
