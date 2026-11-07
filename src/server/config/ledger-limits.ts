/**
 * Ledger safety limits. PLACEHOLDER values in `street-boys-docs`, read here and
 * never hard-coded at a call site (D-128).
 *
 * Plain bigint, not the branded `Kobo` type: this file is configuration and must
 * not import from the ledger module. The ledger brands the value where it uses it,
 * so the boundary stays one directional.
 */

/** The most kobo one transaction may move in total. PLACEHOLDER: 10,000,000 naira. */
export const MAX_TX_KOBO = 1_000_000_000n;

/** The most entries one transaction may carry: two parties per movement, plenty of room. */
export const MAX_ENTRIES_PER_TX = 20;
