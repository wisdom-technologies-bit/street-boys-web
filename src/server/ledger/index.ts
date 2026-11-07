/**
 * The ledger's public API.
 *
 * Everything outside `src/server/ledger` imports from this file and nowhere else.
 * The module is the only code allowed to create ledger entries or change a
 * balance (AGENTS.md 3.2), so what it exports is deliberately small: post a
 * transaction, read accounts, balances, transactions and entries, create a
 * player's account, freeze one.
 *
 * Rules for a caller:
 *
 * - money moves through `postTransaction` only;
 * - every call carries an idempotency key derived from the action, not the clock;
 * - every call handles `InsufficientFunds`, because a player can always be short.
 */
export { postTransaction } from './post';
export type {
  LedgerEntryInput,
  PostTransactionInput,
  PostedBalance,
  PostedTransaction,
} from './post';

export {
  createPlayerAccount,
  getAccountByCode,
  getBalance,
  getPlayerAccount,
  getReversingTransaction,
  getTransaction,
  listEntries,
  setAccountFrozen,
} from './read';
export type { Account, LedgerEntry, Transaction } from './read';

export { getFlowsByCategory, getMoneySupply, windowStart } from './reports';
export type { AccountCounts, FlowRow, MoneySupply } from './reports';

export { summarizeReport, verifyLedger } from './verify';
export type { VerifyCheck, VerifyFailure, VerifyReport } from './verify';

export {
  assertIdempotencyKey,
  buildIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  isValidIdempotencyKey,
} from './idempotency';

export { reverseTransaction, REVERSAL_REASON_MAX_LENGTH } from './reverse';
export type { ReverseTransactionInput } from './reverse';

export {
  AccountFrozen,
  AccountNotFound,
  AlreadyReversed,
  IdempotencyConflict,
  InsufficientFundsForReversal,
  UnknownTransaction,
  InsufficientFunds,
  LedgerError,
  LedgerValidationError,
} from './errors';

export type { Kobo } from './money';
