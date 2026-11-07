import { kobo, type Kobo } from '@/server/ledger/money';

/**
 * Ledger safety limits. PLACEHOLDER values in `street-boys-docs`, read here and
 * never hard-coded at a call site (D-128).
 */

/** The most kobo one transaction may move in total. PLACEHOLDER: ₦10,000,000. */
export const MAX_TX_KOBO: Kobo = kobo(1_000_000_000n);

/** The most entries one transaction may carry: two parties per movement, plenty of room. */
export const MAX_ENTRIES_PER_TX = 20;
