/**
 * The ledger's error vocabulary.
 *
 * Every failure a caller can act on has a type, so a caller never has to read a
 * Postgres message and never sees a raw SQL error. Anything else is a bug and is
 * allowed to escape as itself.
 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request itself is wrong: a bad category, an unbalanced set of entries, a bad amount. */
export class LedgerValidationError extends LedgerError {
  constructor(
    message: string,
    readonly code:
      | 'invalid_request'
      | 'unknown_category'
      | 'unbalanced'
      | 'zero_amount'
      | 'duplicate_account'
      | 'too_many_entries'
      | 'too_few_entries'
      | 'amount_too_large'
      | 'unsafe_metadata',
  ) {
    super(message);
  }
}

/** The same idempotency key arrived with a different payload: a bug at the call site. */
export class IdempotencyConflict extends LedgerError {
  constructor(readonly idempotencyKey: string) {
    super('this idempotency key was already used for a different transaction');
  }
}

/** A debited account is frozen. Credits are still allowed. */
export class AccountFrozen extends LedgerError {
  constructor(readonly accountId: string) {
    super('this account is frozen and cannot send money');
  }
}

/** The debit would take a balance below zero. Nothing was written. */
export class InsufficientFunds extends LedgerError {
  constructor(readonly accountId: string) {
    super('this account does not have enough money for this transaction');
  }
}

/** The account does not exist, or has no balance row. */
export class AccountNotFound extends LedgerError {
  constructor(readonly accountId: string) {
    super('this account does not exist');
  }
}
