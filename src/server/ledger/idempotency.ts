import { LedgerValidationError } from './errors';

/**
 * Idempotency keys.
 *
 * A key names an action, not an attempt (AGENTS.md 4.4): `job-shift:<id>`,
 * `transfer:<client-request-id>`, `topup:<provider-reference>`. Two retries of the
 * same action must carry the same key so the second one replays, and two
 * different actions must never carry the same key, because the second would be
 * refused as a conflict rather than paid.
 *
 * The format is enforced rather than trusted. A key is a fingerprint as much as a
 * name: a key with a space, a slash or 300 characters usually means a caller
 * pasted something that is not a key, and finding that out from a typed error at
 * the call site is far cheaper than finding it in a production conflict.
 */

/** Characters a key may contain: `:` and `-` and `_` and `.` are the separators callers use. */
const KEY_PATTERN = /^[A-Za-z0-9:_.-]+$/;

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** The separator `buildIdempotencyKey` joins with, and escapes inside a part. */
const SEPARATOR = ':';

export function isValidIdempotencyKey(key: string): boolean {
  return (
    key.length >= IDEMPOTENCY_KEY_MIN_LENGTH &&
    key.length <= IDEMPOTENCY_KEY_MAX_LENGTH &&
    KEY_PATTERN.test(key)
  );
}

/** Throw a typed error rather than letting a malformed key reach the database. */
export function assertIdempotencyKey(key: string): string {
  if (!isValidIdempotencyKey(key)) {
    throw new LedgerValidationError(
      `an idempotency key must be ${IDEMPOTENCY_KEY_MIN_LENGTH}-${IDEMPOTENCY_KEY_MAX_LENGTH} characters of A-Z, a-z, 0-9, ":", "_", "." or "-"`,
      'invalid_idempotency_key',
    );
  }
  return key;
}

/**
 * Build a key from a namespace and parts: `buildIdempotencyKey('job-shift', id)`.
 *
 * Deterministic: the same parts always produce the same key, which is the whole
 * point. The separator inside a part is escaped to `_` so two different part lists
 * cannot collide: `('a:b', 'c')` and `('a', 'b:c')` must not both become `a:b:c`.
 *
 * Empty parts are rejected. An empty part means a caller is interpolating a value
 * that was not there, and the key `job-shift::paid` would then collide across every
 * such call, which is the one failure that silently pays the wrong thing.
 */
export function buildIdempotencyKey(namespace: string, ...parts: Array<string | number>): string {
  if (!namespace || !KEY_PATTERN.test(namespace)) {
    throw new LedgerValidationError(
      'an idempotency namespace must be non-empty and use only A-Z, a-z, 0-9, ":", "_", "." or "-"',
      'invalid_idempotency_key',
    );
  }

  if (parts.length === 0) {
    throw new LedgerValidationError(
      'an idempotency key needs at least one part',
      'invalid_idempotency_key',
    );
  }

  const encoded = parts.map((part) => {
    const value = String(part).trim();
    if (value.length === 0) {
      throw new LedgerValidationError(
        'an idempotency key part must not be empty: it means a value was missing at the call site',
        'invalid_idempotency_key',
      );
    }
    // A part may not smuggle in the separator: escape it so parts cannot be forged.
    const escaped = value.split(SEPARATOR).join('_');
    if (!KEY_PATTERN.test(escaped)) {
      throw new LedgerValidationError(
        'an idempotency key part may contain only A-Z, a-z, 0-9, "_", "." or "-"',
        'invalid_idempotency_key',
      );
    }
    return escaped;
  });

  return assertIdempotencyKey([namespace, ...encoded].join(SEPARATOR));
}
