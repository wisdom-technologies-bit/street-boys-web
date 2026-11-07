import { describe, expect, it } from 'vitest';
import {
  assertIdempotencyKey,
  buildIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  isValidIdempotencyKey,
} from './idempotency';
import { LedgerValidationError } from './errors';
import { requestFingerprint } from './post';

/**
 * Keys are the difference between a retry and a second payment, so their shape is
 * tested rather than assumed.
 */

describe('idempotency key format', () => {
  it('accepts the keys callers actually write', () => {
    for (const key of [
      'job-shift:abc123',
      'transfer:9f2c',
      'topup:PSK_123.4',
      'mint-0001:a',
      'A'.repeat(8),
    ]) {
      expect(isValidIdempotencyKey(key), key).toBe(true);
    }
  });

  it('rejects a key that is too short, too long or carries a forbidden character', () => {
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toBe(false);
    expect(isValidIdempotencyKey('has space:1')).toBe(false);
    expect(isValidIdempotencyKey('slash/inside')).toBe(false);
    expect(isValidIdempotencyKey('email@example')).toBe(false);
    expect(isValidIdempotencyKey('has\nnewline')).toBe(false);
  });

  it('throws a typed error for a malformed key, and returns a valid one unchanged', () => {
    expect(assertIdempotencyKey('job-shift:ok')).toBe('job-shift:ok');
    expect(() => assertIdempotencyKey('bad key')).toThrow(LedgerValidationError);
    expect(() => assertIdempotencyKey('bad key')).toThrow(/A-Z, a-z, 0-9/);
  });
});

describe('buildIdempotencyKey', () => {
  it('is deterministic: the same parts always build the same key', () => {
    expect(buildIdempotencyKey('job-shift', 'shift-42')).toBe('job-shift:shift-42');
    expect(buildIdempotencyKey('job-shift', 'shift-42')).toBe(
      buildIdempotencyKey('job-shift', 'shift-42'),
    );
    expect(buildIdempotencyKey('transfer', 12)).toBe('transfer:12');
  });

  it('cannot be forged by a part that contains the separator', () => {
    // ('a:b', 'c') and ('a', 'b:c') must not both become 'a:b:c'.
    const first = buildIdempotencyKey('ns', 'a:b', 'c');
    const second = buildIdempotencyKey('ns', 'a', 'b:c');
    expect(first).not.toBe(second);
    expect(first).toBe('ns:a_b:c');
    expect(second).toBe('ns:a:b_c');
  });

  it('rejects empty parts, an empty namespace and a malformed namespace', () => {
    expect(() => buildIdempotencyKey('job-shift', '')).toThrow(/must not be empty/);
    expect(() => buildIdempotencyKey('job-shift', '   ')).toThrow(/must not be empty/);
    expect(() => buildIdempotencyKey('', 'id')).toThrow(LedgerValidationError);
    expect(() => buildIdempotencyKey('bad namespace', 'id')).toThrow(LedgerValidationError);
    expect(() => buildIdempotencyKey('job-shift')).toThrow(/at least one part/);
  });

  it('produces a key inside the allowed length', () => {
    const key = buildIdempotencyKey('job-shift', 'x'.repeat(20));
    expect(key.length).toBeGreaterThanOrEqual(IDEMPOTENCY_KEY_MIN_LENGTH);
    expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
  });
});

describe('request fingerprint', () => {
  it('ignores the order of entries, because order is not part of the intent', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';

    const one = requestFingerprint({
      category: 'transfer',
      entries: [
        { accountId: a, amountKobo: -100n },
        { accountId: b, amountKobo: 100n },
      ],
    });
    const two = requestFingerprint({
      category: 'transfer',
      entries: [
        { accountId: b, amountKobo: 100n },
        { accountId: a, amountKobo: -100n },
      ],
    });

    expect(one).toBe(two);
  });

  it('changes when the amount, the accounts, the category or the reversal target change', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const base = {
      category: 'transfer',
      entries: [
        { accountId: a, amountKobo: -100n },
        { accountId: b, amountKobo: 100n },
      ],
    };

    const fingerprint = requestFingerprint(base);
    expect(requestFingerprint({ ...base, category: 'top_up' })).not.toBe(fingerprint);
    expect(
      requestFingerprint({
        ...base,
        entries: [
          { accountId: a, amountKobo: -101n },
          { accountId: b, amountKobo: 101n },
        ],
      }),
    ).not.toBe(fingerprint);
    expect(requestFingerprint({ ...base, reversesTransactionId: a })).not.toBe(fingerprint);
  });
});
