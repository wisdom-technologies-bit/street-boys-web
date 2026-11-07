import { getPool } from '@/server/db/client';

/**
 * A fixed-window rate limiter that lives in Postgres.
 *
 * One statement, one round trip, and the database decides: `INSERT ... ON
 * CONFLICT DO UPDATE ... RETURNING count` increments and returns atomically, so
 * fifty simultaneous requests cannot all read `4` and all be allowed. An
 * application-level counter (or a read-then-write) can, which is the whole reason
 * this is SQL.
 *
 * Fixed windows are cheap and slightly unfair at a boundary: a caller can spend
 * the whole allowance at 10:59:59 and again at 11:00:00. For sign-in and OTP
 * endpoints that is an acceptable trade against the complexity of a sliding log.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window turns over. 0 when the request was allowed. */
  retryAfterSeconds: number;
};

/**
 * Consume one unit for `key`.
 *
 * `key` names the thing being limited (`otp:email:<hash>`, `login:ip:<hash>`), so
 * one caller exhausting a limit cannot lock out another.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  if (limit < 1) throw new Error('consumeRateLimit: limit must be at least 1');
  if (windowSeconds < 1) throw new Error('consumeRateLimit: windowSeconds must be at least 1');

  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const { rows } = await getPool().query<{ count: number }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, $2, 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [key, windowStart],
  );

  const count = rows[0]?.count ?? 1;
  const allowed = count <= limit;
  const msLeft = windowStart.getTime() + windowMs - now.getTime();

  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(msLeft / 1000)),
  };
}

/**
 * Delete windows that ended more than `windowSeconds` ago.
 *
 * Not wired to a job yet: the scheduler endpoint exists (prompt 2a) and prompt
 * 2c decides the schedule. Until then the table grows slowly and harmlessly,
 * because every row is three small columns.
 */
export async function deleteExpiredRateLimits(
  windowSeconds = 3600,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const result = await getPool().query('delete from rate_limits where window_start < $1', [cutoff]);
  return result.rowCount ?? 0;
}
