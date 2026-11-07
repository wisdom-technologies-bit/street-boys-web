/**
 * Domains that hand out throwaway addresses.
 *
 * A signup from one of these is either a person hiding from the terms or an
 * account farm; either way the address cannot be trusted to reach its owner, and
 * the account can never be recovered. `email.ts` rejects them.
 *
 * A starter list, not a complete one. Extending it is a one-line change and
 * needs no other code: add the domain in lowercase, no leading `@`.
 */
export const DISPOSABLE_DOMAINS: readonly string[] = [
  '10minutemail.com',
  '20minutemail.com',
  'anonbox.net',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'harakirimail.com',
  'inboxkitten.com',
  'jetable.org',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'tempail.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.com',
  'tempmail.net',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
];

const DISPOSABLE_SET: ReadonlySet<string> = new Set(DISPOSABLE_DOMAINS);

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_SET.has(domain.toLowerCase());
}
