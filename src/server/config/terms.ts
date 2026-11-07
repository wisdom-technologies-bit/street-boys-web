/**
 * The terms version a new account accepts.
 *
 * Bumping it is a decision, not a chore: `users.terms_version` records what each
 * player agreed to, so an existing account that accepted `2026-11-01` keeps that
 * value and the difference is visible. The terms page itself is a later prompt.
 */
export const CURRENT_TERMS_VERSION = '2026-11-01';
