import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * The primitives the accounts work is built from.
 *
 * Nothing here is clever on purpose: HMAC-SHA256 for anything that must be
 * comparable without being reversible, SHA-256 for a bearer token that is already
 * random, and `node:crypto` for every random value. No dependency, no custom
 * construction, no `Math.random` anywhere near a credential.
 */

/**
 * HMAC-SHA256, hex encoded.
 *
 * Used where the value must be recognisable only to us: `ip_hash`, and the
 * `subject` that stands in for an email address before a user exists. With the
 * pepper, an attacker who reads the database cannot test candidate emails offline
 * without also stealing the pepper.
 */
export function hmacSha256(value: string, pepper: string): string {
  if (pepper.length === 0) {
    throw new Error('hmacSha256: a pepper is required');
  }
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

/**
 * SHA-256, hex encoded.
 *
 * For a value that is already high-entropy and secret, such as an issued session
 * token or an OTP: the database stores only this digest, so a database read does
 * not yield a usable token.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Compare two strings without leaking where they differ.
 *
 * Both sides are hashed first so the comparison is over equal-length buffers:
 * `timingSafeEqual` throws on a length mismatch, and checking the length first
 * would leak the length of the real value.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** A token: 32 random bytes, base64url, so it is safe in a URL and a header. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * A 6-digit code, zero-padded, from `crypto.randomInt`.
 *
 * `randomInt` is a CSPRNG with rejection sampling: unlike `random() * 1e6` the
 * digits are uniform, which matters because a predictable digit is a guessable
 * code.
 */
export function randomSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
