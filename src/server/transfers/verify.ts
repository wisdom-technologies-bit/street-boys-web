import { getPool } from '@/server/db/client';
import { getAccountByCode, getBalance, getTransactionByIdempotencyKey } from '@/server/ledger';

/**
 * Reconciliation for transfers.
 *
 * The ledger verifier proves the books balance. This proves the `transfers` table
 * agrees with them, which is the one thing the ledger cannot know: escrow holds
 * exactly what the pending transfers promise, every transfer has the postings its
 * status requires, and no posting disagrees with its row.
 *
 * It reads the ledger through its public API only (AGENTS.md 3.2, boundary test) and
 * reports counts and ids, never amounts (AGENTS.md 5).
 */

const SAMPLE_LIMIT = 5;
const MAX_ROWS_SCANNED = 5_000;

export type TransferCheck = { check: string; count: number; sample: string[] };
export type TransferVerifyResult = { ok: boolean; checks: TransferCheck[] };

type Row = {
  id: string;
  status: string;
  amount_kobo: string;
  tax_kobo: string;
  release_at: Date | null;
};

type Problem = { check: string; ids: string[] };

function sample(ids: string[]): string[] {
  return ids.slice(0, SAMPLE_LIMIT);
}

export async function verifyTransfers(): Promise<TransferVerifyResult> {
  const problems: Problem[] = [];

  const { rows: pendingRows } = await getPool().query<Row>(
    `select id, status, amount_kobo, tax_kobo, release_at
       from transfers where status = 'pending' limit ${MAX_ROWS_SCANNED}`,
  );

  // 1. Escrow must hold exactly the pending transfers.
  const escrow = await getAccountByCode('ESCROW_TRANSFERS');
  const escrowBalance = escrow ? await getBalance(escrow.id) : 0n;
  const promised = pendingRows.reduce(
    (total, row) => total + BigInt(row.amount_kobo) + BigInt(row.tax_kobo),
    0n,
  );
  if (escrowBalance !== promised) {
    problems.push({ check: 'escrow_balance_mismatch', ids: escrow ? [escrow.id] : [] });
  }

  // 2. A pending transfer with no deadline would sit in escrow for ever.
  const withoutDeadline = pendingRows.filter((row) => row.release_at === null).map((row) => row.id);
  if (withoutDeadline.length > 0) {
    problems.push({ check: 'pending_without_release_at', ids: withoutDeadline });
  }

  // 3. Every transfer has the postings its status requires, and they agree with it.
  const { rows: rows } = await getPool().query<Row>(
    `select id, status, amount_kobo, tax_kobo, release_at
       from transfers order by created_at desc limit ${MAX_ROWS_SCANNED}`,
  );

  const missing: string[] = [];
  const mismatched: string[] = [];
  const statusWithoutPosting: string[] = [];

  for (const row of rows) {
    const amountKobo = BigInt(row.amount_kobo);
    const taxKobo = BigInt(row.tax_kobo);

    const hold = await getTransactionByIdempotencyKey(`transfer:${row.id}:hold`);
    const main = await getTransactionByIdempotencyKey(`transfer:${row.id}:main`);
    const refund = await getTransactionByIdempotencyKey(`transfer:${row.id}:refund`);
    const release = await getTransactionByIdempotencyKey(`transfer:${row.id}:release`);

    if (!hold && !main && !refund && !release) missing.push(row.id);

    if (row.status === 'pending' && !hold) statusWithoutPosting.push(row.id);
    if (row.status === 'cancelled' && !refund) statusWithoutPosting.push(row.id);
    if (row.status === 'completed' && !main && !release) statusWithoutPosting.push(row.id);

    // The credit leg must carry the amount, plus the tax when it is a hold.
    for (const [transaction, expected] of [
      [main, amountKobo],
      [hold, amountKobo + taxKobo],
    ] as const) {
      if (!transaction) continue;
      const credit = transaction.entries.find((entry) => entry.amountKobo > 0n);
      if (!credit || credit.amountKobo !== expected) mismatched.push(row.id);
    }
  }

  if (missing.length > 0) problems.push({ check: 'transfer_without_posting', ids: missing });
  if (mismatched.length > 0) {
    problems.push({ check: 'transfer_posting_amount_mismatch', ids: mismatched });
  }
  if (statusWithoutPosting.length > 0) {
    problems.push({ check: 'transfer_status_without_posting', ids: statusWithoutPosting });
  }

  const ORDER = [
    'escrow_balance_mismatch',
    'transfer_without_posting',
    'transfer_posting_amount_mismatch',
    'pending_without_release_at',
    'transfer_status_without_posting',
  ];

  const checks: TransferCheck[] = ORDER.map((check) => {
    const found = problems.filter((problem) => problem.check === check);
    return {
      check,
      count: found.reduce((total, problem) => total + problem.ids.length, 0),
      sample: sample(found.flatMap((problem) => problem.ids)),
    };
  });

  return { ok: checks.every((check) => check.count === 0), checks };
}
