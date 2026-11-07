/**
 * Names nobody may take, because holding one would let a player speak for the
 * game, or be mistaken for staff, the government or the police.
 *
 * The check runs on the **canonical** form (lowercase, spaces and underscores
 * removed), so `Street Boys`, `street_boys` and `STREETBOYS` are all caught by the
 * entry `street boys`.
 */
export const RESERVED_NAMES: readonly string[] = [
  'admin',
  'government',
  'police',
  'system',
  'support',
  'street boys',
  'moderator',
  'staff',
];

/** `name_canonical` for a reserved name, so a comparison is one string lookup. */
export function canonicalReservedName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '');
}

const RESERVED_CANONICAL: ReadonlySet<string> = new Set(RESERVED_NAMES.map(canonicalReservedName));

export function isReservedName(name: string): boolean {
  return RESERVED_CANONICAL.has(canonicalReservedName(name));
}
