import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare a bearer token with the cron secret in constant time.
 *
 * Both sides are hashed first so the comparison sees two fixed-length digests.
 * `timingSafeEqual` throws on different lengths, and a length check before it
 * would leak the secret's length one byte at a time — the hash removes both
 * problems and keeps the work done per attempt identical.
 *
 * An unset or empty secret never authenticates, so a deployment that forgot to
 * configure it refuses every call instead of accepting everything.
 */
export function isCronRequestAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  if (!authorizationHeader) return false;

  const match = /^Bearer (.+)$/.exec(authorizationHeader.trim());
  if (!match) return false;

  const presented = match[1];
  if (presented === undefined || presented.length === 0) return false;

  const expectedDigest = createHash('sha256').update(secret, 'utf8').digest();
  const presentedDigest = createHash('sha256').update(presented, 'utf8').digest();

  return timingSafeEqual(expectedDigest, presentedDigest);
}
