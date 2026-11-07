import type { PoolClient } from 'pg';
import { CURRENT_TERMS_VERSION } from '@/server/config/terms';
import { getEnv, requireOtpPepper } from '@/server/config/env';
import { getPool } from '@/server/db/client';
import { logEvent, subjectForEmail } from '@/server/security/audit';
import { hmacSha256, constantTimeEqual, randomSixDigitCode } from '@/server/security/crypto';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { getEmailProvider, EmailSendError } from '@/server/email';
import { checkEmail } from './email';
import { createSession, createSessionRow } from './session';

/**
 * Requesting and verifying an email code.
 *
 * Four rules shape the whole file:
 *
 * 1. **Never say whether an account exists.** Request always answers `sent`;
 *    verify answers one generic error for every failure.
 * 2. **The code is bound to the address.** The hash is over
 *    `canonicalEmail + ":" + code`, so a code sent to one address cannot be
 *    replayed against another.
 * 3. **Every decision is atomic.** Attempts, consumption and session creation are
 *    single statements with a `where` that makes the second concurrent request a
 *    no-op, not a second session.
 * 4. **Rate-limit keys are HMACs.** A key containing a raw address or IP would
 *    turn the rate-limit table into a log of who tried to sign in.
 */

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;

export const COOLDOWN_SECONDS = 60;
export const REQUESTS_PER_EMAIL_HOUR = 5;
export const REQUESTS_PER_IP_HOUR = 20;
export const VERIFY_PER_EMAIL_HOUR = 10;
export const VERIFY_PER_IP_HOUR = 60;

export type RequestCodeResult =
  | { status: 'sent' }
  | { status: 'email_not_supported' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'send_failed' };

export type VerifyResult =
  | { status: 'signed_in'; userId: string; hasCharacter: boolean; token: string; expiresAt: Date }
  | { status: 'details_required' }
  | { status: 'email_not_supported' }
  | { status: 'invalid_or_expired' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type VerifyDetails = { acceptTerms: true; ageBand: 'under_18' | '18_plus' };

/** Rate-limit keys are HMACs of the value under the account pepper. */
function keyPart(value: string): string {
  return hmacSha256(value, requireOtpPepper());
}

function codeHash(canonicalEmail: string, code: string): string {
  return hmacSha256(`${canonicalEmail}:${code}`, requireOtpPepper());
}

export async function requestCode(input: {
  email: string;
  ipHash?: string | null;
  provider?: ReturnType<typeof getEmailProvider>;
}): Promise<RequestCodeResult> {
  const checked = checkEmail(input.email);
  if (!checked.ok) return { status: 'email_not_supported' };

  const canonical = checked.canonical;
  const emailKey = keyPart(canonical);
  const ipKey = input.ipHash ? keyPart(input.ipHash) : null;

  const cooldown = await consumeRateLimit(`otp:cooldown:${emailKey}`, 1, COOLDOWN_SECONDS);
  if (!cooldown.allowed) {
    return {
      status: 'rate_limited',
      retryAfterSeconds: cooldown.retryAfterSeconds || COOLDOWN_SECONDS,
    };
  }

  const perEmail = await consumeRateLimit(`otp:email:${emailKey}`, REQUESTS_PER_EMAIL_HOUR, 3600);
  if (!perEmail.allowed) {
    return { status: 'rate_limited', retryAfterSeconds: perEmail.retryAfterSeconds };
  }

  if (ipKey) {
    const perIp = await consumeRateLimit(`otp:ip:${ipKey}`, REQUESTS_PER_IP_HOUR, 3600);
    if (!perIp.allowed) {
      return { status: 'rate_limited', retryAfterSeconds: perIp.retryAfterSeconds };
    }
  }

  const pool = getPool();
  const users = await pool.query<{ id: string; status: string }>(
    `select id, status from users where email_canonical = $1 limit 1`,
    [canonical],
  );
  const user = users.rows[0];

  // A new code replaces any earlier one: only the newest code is ever valid.
  await pool.query(
    `update auth_otps set consumed_at = now() where email_canonical = $1 and consumed_at is null`,
    [canonical],
  );

  const code = randomSixDigitCode();
  const inserted = await pool.query<{ id: string }>(
    `insert into auth_otps (email_canonical, code_hash, ip_hash, max_attempts, expires_at)
     values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
     returning id`,
    [
      canonical,
      codeHash(canonical, code),
      input.ipHash ?? null,
      MAX_ATTEMPTS,
      String(CODE_TTL_MINUTES),
    ],
  );
  const otpId = inserted.rows[0]!.id;

  await logEvent({
    eventType: 'otp_requested',
    subject: subjectForEmail(canonical),
    ipHash: input.ipHash ?? null,
    metadata: { otpId },
  });

  // Frozen and banned accounts get the same work and the same answer, but no email:
  // telling the caller would say the account exists.
  if (user && user.status !== 'active') {
    return { status: 'sent' };
  }

  // Outside any transaction, after the write: a provider call must not hold a
  // database connection open, and a failure must be recorded rather than rolled back.
  const provider = input.provider ?? getEmailProvider();
  try {
    await provider.sendOtp({ to: checked.email, code, expiresInMinutes: CODE_TTL_MINUTES });
  } catch (error) {
    await pool.query(`update auth_otps set consumed_at = now() where id = $1`, [otpId]);
    await logEvent({
      eventType: 'otp_send_failed',
      subject: subjectForEmail(canonical),
      ipHash: input.ipHash ?? null,
      metadata: { status: error instanceof EmailSendError ? (error.status ?? null) : null },
    });
    return { status: 'send_failed' };
  }

  return { status: 'sent' };
}

/**
 * Verify a code.
 *
 * The order is deliberate: rate limit, find the newest live code, spend an
 * attempt, compare, then decide what the correct code means for this address.
 * Every failure before that last step returns the same `invalid_or_expired`.
 */
export async function verifyCode(input: {
  email: string;
  code: string;
  details?: VerifyDetails;
  ipHash?: string | null;
}): Promise<VerifyResult> {
  const checked = checkEmail(input.email);
  if (!checked.ok) return { status: 'email_not_supported' };

  const canonical = checked.canonical;
  const emailKey = keyPart(canonical);
  const ipKey = input.ipHash ? keyPart(input.ipHash) : null;

  const perEmail = await consumeRateLimit(`verify:email:${emailKey}`, VERIFY_PER_EMAIL_HOUR, 3600);
  if (!perEmail.allowed)
    return { status: 'rate_limited', retryAfterSeconds: perEmail.retryAfterSeconds };

  if (ipKey) {
    const perIp = await consumeRateLimit(`verify:ip:${ipKey}`, VERIFY_PER_IP_HOUR, 3600);
    if (!perIp.allowed)
      return { status: 'rate_limited', retryAfterSeconds: perIp.retryAfterSeconds };
  }

  const pool = getPool();

  const latest = await pool.query<{ id: string; code_hash: string }>(
    `select id, code_hash from auth_otps
      where email_canonical = $1 and consumed_at is null and expires_at > now()
      order by created_at desc
      limit 1`,
    [canonical],
  );

  const row = latest.rows[0];
  if (!row) return failed(canonical, input.ipHash, 'no_live_code');

  // Spend an attempt atomically. A row with no attempts left returns nothing,
  // which is the lockout, and the correct code is refused with the same answer.
  const spent = await pool.query<{ attempts: number; max_attempts: number }>(
    `update auth_otps set attempts = attempts + 1
      where id = $1 and attempts < max_attempts
      returning attempts, max_attempts`,
    [row.id],
  );
  if (spent.rows.length === 0) {
    await logEvent({
      eventType: 'otp_locked',
      subject: subjectForEmail(canonical),
      ipHash: input.ipHash ?? null,
      metadata: {},
    });
    return { status: 'invalid_or_expired' };
  }

  if (!constantTimeEqual(row.code_hash, codeHash(canonical, input.code))) {
    return failed(canonical, input.ipHash, 'wrong_code');
  }

  const users = await pool.query<{ id: string; status: 'active' | 'frozen' | 'banned' }>(
    `select id, status from users where email_canonical = $1 limit 1`,
    [canonical],
  );
  const existing = users.rows[0];

  if (existing && existing.status !== 'active') {
    await logEvent({
      eventType: 'login_blocked_status',
      actorUserId: existing.id,
      subject: existing.id,
      ipHash: input.ipHash ?? null,
      metadata: { status: existing.status },
    });
    return { status: 'invalid_or_expired' };
  }

  if (existing) {
    const consumed = await consume(pool, row.id);
    if (!consumed) return failed(canonical, input.ipHash, 'reused');

    await pool.query(
      `update users
          set email_verified_at = coalesce(email_verified_at, now()),
              last_login_at = now()
        where id = $1`,
      [existing.id],
    );

    const session = await createSession({ userId: existing.id, ipHash: input.ipHash });

    await logEvent({
      eventType: 'login_succeeded',
      actorUserId: existing.id,
      subject: existing.id,
      ipHash: input.ipHash ?? null,
      metadata: {},
    });

    return {
      status: 'signed_in',
      userId: existing.id,
      hasCharacter: await hasCharacter(existing.id),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  // A new address. Without accepted terms there is nothing to create yet, and the
  // code stays usable so the same digits can be submitted again with the details.
  if (!input.details) return { status: 'details_required' };

  const client = await pool.connect();
  try {
    await client.query('begin');

    const consumed = await consume(client, row.id);
    if (!consumed) {
      await client.query('rollback');
      return failed(canonical, input.ipHash, 'reused');
    }

    const created = await client.query<{ id: string }>(
      `insert into users (email, email_canonical, email_verified_at, age_band, verification_level, terms_version, terms_accepted_at)
       values ($1, $2, now(), $3, 1, $4, now())
       returning id`,
      [checked.email, canonical, input.details.ageBand, CURRENT_TERMS_VERSION],
    );
    const userId = created.rows[0]!.id;

    const session = await createSessionRow(client, { userId, ipHash: input.ipHash });

    await client.query('commit');

    await logEvent({
      eventType: 'signup_completed',
      actorUserId: userId,
      subject: subjectForEmail(canonical),
      ipHash: input.ipHash ?? null,
      metadata: { ageBand: input.details.ageBand, termsVersion: CURRENT_TERMS_VERSION },
    });

    return {
      status: 'signed_in',
      userId,
      hasCharacter: false,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Mark the code consumed, atomically. False means somebody else got there first. */
async function consume(
  db: PoolClient | ReturnType<typeof getPool>,
  otpId: string,
): Promise<boolean> {
  const result = await db.query(
    `update auth_otps set consumed_at = now()
      where id = $1 and consumed_at is null and expires_at > now()
      returning id`,
    [otpId],
  );
  return result.rows.length > 0;
}

async function hasCharacter(userId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    `select exists(select 1 from characters where user_id = $1) as exists`,
    [userId],
  );
  return rows[0]?.exists ?? false;
}

async function failed(
  canonical: string,
  ipHash: string | null | undefined,
  reason: string,
): Promise<VerifyResult> {
  await logEvent({
    eventType: 'otp_verify_failed',
    subject: subjectForEmail(canonical),
    ipHash: ipHash ?? null,
    metadata: { reason },
  });
  return { status: 'invalid_or_expired' };
}
