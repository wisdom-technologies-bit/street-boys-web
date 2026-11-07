/**
 * Providers where `someone+tag@example.com` and `someone@example.com` reach the
 * same inbox, so the tag must not create a second account.
 *
 * Gmail (and its `googlemail.com` alias) also ignores dots in the local part, so
 * it gets an extra rule in `email.ts`. Every other provider here only ignores the
 * `+tag`.
 */
export const PLUS_TAG_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'fastmail.com',
];

/** Providers that also ignore dots in the local part. */
export const DOT_INSENSITIVE_DOMAINS: readonly string[] = ['gmail.com', 'googlemail.com'];

const PLUS_TAG_SET: ReadonlySet<string> = new Set(PLUS_TAG_DOMAINS);

export function acceptsPlusTag(domain: string): boolean {
  return PLUS_TAG_SET.has(domain.toLowerCase());
}

export function ignoresDots(domain: string): boolean {
  return DOT_INSENSITIVE_DOMAINS.includes(domain.toLowerCase());
}
