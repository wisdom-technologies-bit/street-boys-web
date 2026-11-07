import { z } from 'zod';

/**
 * The economy's numbers, in one place.
 *
 * Every number that decides how much money a player starts with, or will later
 * decide what something costs, belongs here and nowhere else. No route, page,
 * component or script may write `500_000n` for a starting balance: it reads it from
 * this file, so that the day the owner tunes the economy there is one line to change
 * and no search for a magic number that a test happens to keep alive.
 *
 * The shape is deliberately (input) → (validated params) rather than a bare object:
 *
 * - the input is plain JSON-serialisable data, which is what the admin tool will
 *   store and what a future config row would hold;
 * - the validated output is frozen, branded by type, and safe to hand to code that
 *   moves money.
 *
 * `version` exists so a grant can be traced to the numbers that were in force when
 * it was posted. It is a label, not a date: bump it whenever a number changes.
 */

export const ECONOMY_PARAMS_VERSION = '2026-11-07.1';

/** Zod schema for the input. Bigints are accepted as bigint, never as float. */
export const economyParamsSchema = z.object({
  version: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9A-Za-z._-]+$/, 'version is a label: letters, digits, dot, dash, underscore'),
  startingBalanceKobo: z
    .bigint('startingBalanceKobo must be a bigint of kobo, not a number')
    .min(0n, 'a starting balance cannot be negative')
    // 2^53 - 1 kobo: the largest amount that survives a trip through a JSON number.
    .max(9_007_199_254_740_991n, 'startingBalanceKobo exceeds the largest safe amount'),
});

export type EconomyParamsInput = z.input<typeof economyParamsSchema>;
export type EconomyParams = Readonly<z.output<typeof economyParamsSchema>>;

/**
 * The parameters in force.
 *
 * `startingBalanceKobo` is **PLACEHOLDER**: ₦5,000, from
 * `street-boys-docs/docs/14-economy-numbers.md` ("Starting balance ₦5,000, about two
 * days of breathing room") and docs/03's placeholder table. It is a starting value to
 * be tuned by simulation, not a balance decision, and the owner changes it at the
 * end of this list rather than anywhere else in the codebase.
 */
export const DEFAULT_ECONOMY_PARAMS: EconomyParamsInput = {
  version: ECONOMY_PARAMS_VERSION,
  startingBalanceKobo: 500_000n, // PLACEHOLDER: ₦5,000 (docs/14)
};

/** Validate a candidate set of parameters, throwing with the field named. */
export function parseEconomyParams(input: unknown): EconomyParams {
  const result = economyParamsSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || '(root)';
    throw new Error(`economy params are invalid at ${field}: ${issue?.message ?? 'unknown'}`);
  }
  return Object.freeze(result.data);
}

let loaded: EconomyParams | null = null;

/**
 * The one place later code reads the economy from.
 *
 * Cached because the values never change at runtime today; a future admin tool will
 * write them to the database and call `resetEconomyParamsCache()` after a change,
 * which is why the cache is explicit rather than a module constant.
 */
export function getEconomyParams(): EconomyParams {
  if (!loaded) loaded = parseEconomyParams(DEFAULT_ECONOMY_PARAMS);
  return loaded;
}

/** Drop the cache, for a test or an admin that has just changed the parameters. */
export function resetEconomyParamsCache(): void {
  loaded = null;
}
