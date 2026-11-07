/**
 * Money primitives.
 *
 * Every amount in this codebase is an integer number of kobo held in a `bigint`.
 * AGENTS.md section 3.1 is not a style preference: a float cannot represent 0.1
 * naira, a `number` silently loses precision past 2^53 kobo (about ₦90 trillion,
 * which an economy with a Coli-driven price index and years of history should not
 * rely on), and a decimal string in the database invites arithmetic outside the
 * ledger.
 *
 * So: `bigint` in, `bigint` out, and a brand (`Kobo`) that stops a raw bigint, a
 * naira amount or a `number` from being passed where kobo is expected. Conversion
 * happens here and formatting happens here. Nothing else divides by 100.
 *
 * JSON has no bigint, so amounts cross an API boundary as strings, never as
 * numbers: `serializeAmount` and the `bigintReplacer` below are the only doors.
 */

/** An integer number of kobo. Nominal: it exists only at compile time. */
export type Kobo = bigint & { readonly __brand: 'Kobo' };

/** Everything this module throws. A caller can catch this and nothing wider. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Kobo per naira. The only place this constant is allowed to matter. */
const KOBO_PER_NAIRA = 100n;

/**
 * The largest amount this system will ever hold: 2^53 - 1 kobo.
 *
 * Chosen because it is exactly the boundary of an IEEE-754 safe integer, so any
 * amount accepted here still survives a trip through a platform that hands a
 * number to JavaScript (a dashboard, an analytics tool, a payment provider's
 * webhook) without silently changing value. Above it, refuse rather than guess.
 */
export const MAX_SAFE_KOBO = 9007199254740991n;

/** Brand a bigint as kobo, refusing anything outside the safe range. */
export function kobo(value: bigint): Kobo {
  if (typeof value !== 'bigint') {
    throw new MoneyError('amount must be a bigint of kobo, not a number');
  }
  if (value > MAX_SAFE_KOBO || value < -MAX_SAFE_KOBO) {
    throw new MoneyError('amount is outside the range this system can represent exactly');
  }
  return value as Kobo;
}

/** Zero, typed. Handy for summing. */
export const ZERO_KOBO: Kobo = 0n as Kobo;

/** Add two kobo amounts, staying branded and in range. */
export function addKobo(left: Kobo, right: Kobo): Kobo {
  return kobo(left + right);
}

/** Negate an amount, staying branded and in range: a debit is a negative posting. */
export function negateKobo(amount: Kobo): Kobo {
  return kobo(-amount);
}

/** Sum a list of amounts, without ever leaving bigint arithmetic. */
export function sumKobo(amounts: readonly Kobo[]): Kobo {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return kobo(total);
}

/**
 * Whole naira to kobo.
 *
 * Only a bigint is accepted, so `nairaToKobo(12.5)` is a type error rather than a
 * rounding bug: half a naira is 50 kobo, and the caller must say which they mean.
 */
export function nairaToKobo(naira: bigint): Kobo {
  if (typeof naira !== 'bigint') {
    throw new MoneyError('naira amounts must be a whole bigint, not a number');
  }
  return kobo(naira * KOBO_PER_NAIRA);
}

/**
 * Parse user or configuration input written in naira into kobo.
 *
 * Accepts `"1,250"`, `"1250"`, `"1250.5"`, `"1250.50"`, `"₦1,250.50"` and
 * surrounding whitespace. Refuses, with a message a caller can show:
 *
 * - more than two decimal places, rather than rounding (`"1.005"` has no exact
 *   kobo value and silently becoming ₦1.00 or ₦1.01 is a money bug);
 * - exponential, `NaN`, `Infinity`, hex or any other shape `Number` would accept
 *   and quietly reinterpret;
 * - a negative amount, because the way to move money out of an account is a
 *   ledger entry, not a negative price.
 */
export function parseNairaToKobo(input: string): Kobo {
  if (typeof input !== 'string') throw new MoneyError('amount must be written as text');

  const cleaned = input.trim().replace(/^₦/, '').replace(/,/g, '');
  if (cleaned === '') throw new MoneyError('amount is empty');
  if (cleaned.startsWith('-')) throw new MoneyError('amount cannot be negative');

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyError('amount must be a whole naira figure with at most two decimal places');
  }

  const whole = match[1] ?? '';
  const padded = (match[2] ?? '').padEnd(2, '0');

  let amount: bigint;
  try {
    amount = BigInt(whole) * KOBO_PER_NAIRA + BigInt(padded);
  } catch {
    throw new MoneyError('amount is too large to represent');
  }

  return kobo(amount);
}

/**
 * Formatting lives in `@/shared/money-format`, because a page and an API must write
 * the same string and the page cannot import the server module. Re-exported here so
 * the ledger keeps one import for callers and existing tests keep working: the
 * functions take a plain `bigint` of kobo, which a `Kobo` is.
 */
export {
  formatNaira,
  formatSignedNaira,
  formatKoboString,
  formatSignedKoboString,
  koboToNairaString,
} from '@/shared/money-format';

/**
 * Kobo for a JSON field.
 *
 * A string, because `JSON.stringify(10n)` throws and coercing a bigint through the
 * Number constructor is the precision loss this module exists to prevent. An API
 * that returns money must return this string and say so.
 */
export function serializeAmount(amount: Kobo): string {
  return amount.toString();
}

/** Read a JSON field back into kobo, refusing anything that is not an integer string. */
export function deserializeAmount(value: unknown): Kobo {
  if (typeof value !== 'string') throw new MoneyError('a serialized amount must be a string');
  if (!/^-?\d+$/.test(value)) throw new MoneyError('a serialized amount must be an integer string');
  return kobo(BigInt(value));
}

/** A `JSON.stringify` replacer that turns bigints into strings instead of throwing. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
