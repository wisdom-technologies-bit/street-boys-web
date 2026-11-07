import { z } from 'zod';
import { isDisposableDomain } from '@/server/config/disposable-domains';
import { acceptsPlusTag, ignoresDots } from '@/server/config/plus-tag-domains';

/**
 * Email addresses: one format, one canonical form, one place that decides.
 *
 * The canonical form is what the unique constraint is on, so two addresses that
 * reach the same inbox can never become two accounts.
 *
 * Open question for docs/13: the rule here rejects non-ASCII addresses
 * (`mọ́níkẹ́@example.com`, or an address whose domain is an IDN). The alternative
 * is to accept them by normalising to punycode/NFKC first, which is a better fit
 * for a Nigerian player base but needs a decision on how it interacts with
 * delivery and with `email_canonical`.
 */

/** RFC 5321 sets the whole-address limit at 254 characters. */
export const MAX_EMAIL_LENGTH = 254;

const emailSchema = z
  .string()
  .email({ message: 'not a valid email address' })
  .refine((value) => value.length <= MAX_EMAIL_LENGTH, { message: 'address is too long' });

export type EmailRejection =
  'empty' | 'too_long' | 'non_ascii' | 'invalid_format' | 'disposable_domain';

export type EmailCheck =
  | { ok: true; email: string; canonical: string; domain: string }
  | { ok: false; reason: EmailRejection; message: string };

/** The part after the last `@`, lowercased. Empty when there is no `@`. */
function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/**
 * The canonical form of an address that has already passed validation.
 *
 * - `gmail.com` and `googlemail.com`: drop the `+tag`, drop every dot in the local
 *   part, and treat `googlemail.com` as `gmail.com`. All of these are one inbox.
 * - the other providers in `plus-tag-domains`: drop the `+tag` only.
 * - everyone else: unchanged, because nobody promised the tag is ignored.
 */
export function canonicalizeEmail(email: string): string {
  const normalised = email.trim().toLowerCase();
  const at = normalised.lastIndexOf('@');
  if (at === -1) return normalised;

  let local = normalised.slice(0, at);
  const domain = normalised.slice(at + 1);

  if (acceptsPlusTag(domain)) {
    const plus = local.indexOf('+');
    if (plus !== -1) local = local.slice(0, plus);
  }

  if (ignoresDots(domain)) {
    local = local.replace(/\./g, '');
  }

  // `googlemail.com` is the same inbox as `gmail.com`.
  const canonicalDomain = domain === 'googlemail.com' ? 'gmail.com' : domain;

  return `${local}@${canonicalDomain}`;
}

/**
 * Validate and canonicalise an address.
 *
 * Order matters: length and ASCII first (cheap, and they explain themselves),
 * then the format, then the disposable check. A disposable address is a refusal,
 * not a formatting problem.
 */
export function checkEmail(raw: string): EmailCheck {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', message: 'Enter an email address.' };
  }

  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return { ok: false, reason: 'too_long', message: 'That email address is too long.' };
  }

  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    return {
      ok: false,
      reason: 'non_ascii',
      message: 'That email address contains characters that are not supported yet.',
    };
  }

  const email = trimmed.toLowerCase();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_format', message: 'That is not a valid email address.' };
  }

  const domain = domainOf(email);
  if (isDisposableDomain(domain)) {
    return {
      ok: false,
      reason: 'disposable_domain',
      message: 'That is a disposable email service. Use an address you will keep.',
    };
  }

  return { ok: true, email, canonical: canonicalizeEmail(email), domain };
}
