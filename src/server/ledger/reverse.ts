import { logEvent } from '@/server/security/audit';
import {
  AlreadyReversed,
  InsufficientFunds,
  InsufficientFundsForReversal,
  LedgerValidationError,
  UnknownTransaction,
} from './errors';
import type { PostedTransaction } from './post';
import { postTransaction } from './post';
import { getReversingTransaction, getTransaction } from './read';

/**
 * Reversing a transaction.
 *
 * A correction is a compensating entry, never an edit (AGENTS.md 4.3). The reversal
 * is a new transaction whose entries are the exact negation of the original's, so
 * the history keeps both facts: what happened, and that it was undone by someone
 * for a stated reason.
 *
 * Three rules make it safe:
 *
 * - **Once only.** `reverses_transaction_id` is unique in the database, so two
 *   simultaneous reversal attempts cannot both succeed, whatever the application
 *   checks first. A reversal of a reversal is refused too: undoing an undo is a new
 *   forward transaction with its own reason, not a reversal of the reversal.
 * - **Never below zero.** If the money has already been spent, the reversal is
 *   refused rather than forcing a negative balance. What happens to the shortfall
 *   (a partial clawback, a debt) is a product decision, still open (docs/13).
 * - **Attributed, not anonymous.** A reason and an actor are required, and both are
 *   recorded. A reversal with no reason is a hole in the history.
 */

export const REVERSAL_REASON_MAX_LENGTH = 500;

export type ReverseTransactionInput = {
  transactionId: string;
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
  /**
   * Let the reversal debit a frozen account. A frozen account still owes money back,
   * and refusing the reversal would leave the ledger unable to correct itself. Who
   * is allowed to ask for this is an authorization decision for the admin prompt.
   */
  allowFrozenDebit?: boolean;
};

/** The `insufficient_funds` case, kept as its own failure so callers can tell them apart. */
export type ReverseTransactionFailure = InsufficientFundsForReversal;

export async function reverseTransaction(
  input: ReverseTransactionInput,
): Promise<PostedTransaction> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    throw new LedgerValidationError('a reversal needs a reason', 'invalid_reversal');
  }
  if (reason.length > REVERSAL_REASON_MAX_LENGTH) {
    throw new LedgerValidationError(
      `a reversal reason may be at most ${REVERSAL_REASON_MAX_LENGTH} characters`,
      'invalid_reversal',
    );
  }
  if (!input.actorUserId) {
    throw new LedgerValidationError(
      'a reversal needs the actor who authorised it',
      'invalid_reversal',
    );
  }

  const original = await getTransaction(input.transactionId);
  if (!original) throw new UnknownTransaction(input.transactionId);

  if (original.reversesTransactionId !== null) {
    throw new LedgerValidationError('a reversal cannot itself be reversed', 'invalid_reversal');
  }

  // Checked here for a clear error; the unique index is what actually guarantees it.
  // A retry of the SAME reversal key must replay rather than be refused, so the
  // existing reversal is compared by key before it is treated as "already done".
  const existingReversal = await getReversingTransaction(original.id);
  if (existingReversal && existingReversal.idempotencyKey !== input.idempotencyKey) {
    throw new AlreadyReversed(input.transactionId);
  }

  const entries = original.entries.map((entry) => ({
    accountId: entry.accountId,
    amountKobo: -entry.amountKobo,
  }));

  try {
    return await postTransaction({
      idempotencyKey: input.idempotencyKey,
      category: 'reversal',
      entries,
      reversesTransactionId: original.id,
      actorUserId: input.actorUserId,
      metadata: { reason },
      allowFrozenDebit: input.allowFrozenDebit ?? false,
    });
  } catch (error) {
    if (error instanceof InsufficientFunds) {
      throw new InsufficientFundsForReversal(error.accountId, original.id);
    }
    // Two simultaneous reversals: the loser hits the unique index, not the check above.
    if ((error as { code?: string }).code === '23505') {
      throw new AlreadyReversed(original.id);
    }
    throw error;
  }
}

/** Fire the audit event a reversal's caller asked for. Kept here so the wording lives in one place. */
export async function recordReversalRequested(
  actorUserId: string,
  transactionId: string,
): Promise<void> {
  await logEvent({
    eventType: 'ledger_reversal_requested',
    actorUserId,
    metadata: { transactionId },
  });
}
