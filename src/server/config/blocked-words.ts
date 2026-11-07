/**
 * The blocked-words mechanism.
 *
 * `character.ts` checks a name's **canonical** form against this list, so spacing,
 * case and underscores cannot smuggle a word through.
 *
 * **The list below is a placeholder.** The owner supplies the real one, and the
 * open question in `street-boys-docs/docs/13-parked-and-open-questions.md` records
 * that it is missing. Nothing here is meant as a policy decision, and the list is
 * short on purpose: a false positive blocks a real player, so the words go in
 * after the owner decides, not before.
 *
 * Matching is a substring test against the **canonical** form, because the
 * canonical form has already had its spaces and underscores removed: a name like
 * `place_holderone` must not slip past by adding a separator. The cost is that a
 * short entry bans every name containing it, so the owner's real list goes in
 * after that trade-off is decided, not before.
 */
export const BLOCKED_WORDS: readonly string[] = ['placeholderone', 'placeholdertwo'];

const BLOCKED_SET: ReadonlySet<string> = new Set(BLOCKED_WORDS.map((w) => w.toLowerCase()));

/** True when the canonical name contains any blocked word. */
export function containsBlockedWord(canonicalName: string): boolean {
  if (BLOCKED_SET.size === 0) return false;
  const haystack = canonicalName.toLowerCase();
  for (const word of BLOCKED_SET) {
    if (haystack.includes(word)) return true;
  }
  return false;
}
