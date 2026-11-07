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
 * Matching is by whole canonical token, not substring: a name is split into
 * words, and a name is blocked when any word is on the list. That avoids banning
 * a normal name that happens to contain a short rude word.
 */
export const BLOCKED_WORDS: readonly string[] = ['placeholderone', 'placeholdertwo'];

const BLOCKED_SET: ReadonlySet<string> = new Set(BLOCKED_WORDS.map((w) => w.toLowerCase()));

/** True when any word of the name is on the list. */
export function containsBlockedWord(canonicalName: string): boolean {
  if (BLOCKED_SET.size === 0) return false;
  return canonicalName
    .split(/(?=[A-Z])|\s+/)
    .map((word) => word.toLowerCase())
    .some((word) => BLOCKED_SET.has(word));
}
