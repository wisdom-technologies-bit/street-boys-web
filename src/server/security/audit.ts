import { getDb, getPool } from '@/server/db/client';
import { requireIpHashPepper } from '@/server/config/env';
import { hmacSha256 } from '@/server/security/crypto';
import { auditLog } from '@/server/db/schema';

/**
 * The audit log: what happened, when, and to whom — never the secret itself.
 *
 * Two rules are enforced here rather than trusted to callers:
 *
 * 1. **Metadata never carries a credential or an email.** An audit row is read by
 *    support, exported for investigation and kept for years; a code or a token in
 *    it is a credential in a log file. The key list is checked recursively.
 * 2. **Before a user exists, the subject is an HMAC, not an address.** An OTP
 *    attempt is logged with `hmac(email, pepper)`, so the log answers "same person
 *    as before?" without answering "which person?".
 */

/** Keys that must never appear in metadata, at any depth, in any case. */
const FORBIDDEN_METADATA_KEYS = [
  'code',
  'otp',
  'token',
  'password',
  'secret',
  'email',
  'ip',
] as const;

export class AuditMetadataError extends Error {
  constructor(readonly path: string) {
    super(
      `audit metadata must not contain "${path}": credentials and addresses do not belong in the log`,
    );
    this.name = 'AuditMetadataError';
  }
}

function assertMetadataIsSafe(value: unknown, path = 'metadata'): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataIsSafe(item, `${path}[${index}]`));
    return;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalised = key.toLowerCase();
      const forbidden = FORBIDDEN_METADATA_KEYS.find((word) => normalised.includes(word));
      if (forbidden) {
        throw new AuditMetadataError(`${path}.${key}`);
      }
      assertMetadataIsSafe(child, `${path}.${key}`);
    }
  }
}

/** The stable stand-in for an email before a user row exists. */
export function subjectForEmail(canonicalEmail: string): string {
  return hmacSha256(canonicalEmail.toLowerCase(), requireIpHashPepper());
}

export type AuditEvent = {
  actorUserId?: string | null;
  eventType: string;
  subject?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append one row. There is no update and no delete: the database refuses both.
 */
export async function logEvent(event: AuditEvent): Promise<void> {
  const metadata = event.metadata ?? {};
  assertMetadataIsSafe(metadata);

  await getDb()
    .insert(auditLog)
    .values({
      actorUserId: event.actorUserId ?? null,
      eventType: event.eventType,
      subject: event.subject ?? null,
      ipHash: event.ipHash ?? null,
      metadata,
    });
}

/** Read the log. Used by tests and by the future admin view. */
export async function recentEvents(
  eventType?: string,
): Promise<
  Array<{ event_type: string; subject: string | null; metadata: Record<string, unknown> }>
> {
  const { rows } = await getPool().query<{
    event_type: string;
    subject: string | null;
    metadata: Record<string, unknown>;
  }>(
    `select event_type, subject, metadata from audit_log
      ${eventType ? 'where event_type = $1' : ''}
      order by id asc`,
    eventType ? [eventType] : [],
  );
  return rows;
}
