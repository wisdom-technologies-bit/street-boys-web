/**
 * Display formatting for money.
 *
 * This file is deliberately free of database, server and ledger imports, because
 * both the server and the browser need it: a page showing a balance and an API
 * returning `formatted` must produce the same string, and a component test must be
 * able to check it without a database.
 *
 * The rules that matter:
 *
 * - **Amounts arrive as kobo**, either a `bigint` or an integer string. Naira never
 *   appears from the database, and this file never does arithmetic on a `number`.
 * - **No `toLocaleString`.** The server's locale must not decide how a player's
 *   money is written, and a locale that inserts a comma in an unexpected place is a
 *   bug nobody reports.
 * - **A `bigint` never passes through `Number`.** Past 2^53 kobo (about ₦90
 *   trillion) a `number` changes value silently, so the amount is split into whole
 *   naira and fraction with `bigint` arithmetic and only the small pieces are
 *   formatted.
 */

import { z } from 'zod';

/** Kobo per naira, the one conversion this file performs. */
const KOBO_PER_NAIRA = 100n;

/** An integer string of kobo, for callers that hold the serialised form. */
const koboString = z.string().regex(/^-?\d+$/, 'expected an integer string of kobo');

function split(amount: bigint): { negative: boolean; whole: string; fraction: string } {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / KOBO_PER_NAIRA;
  const fraction = absolute % KOBO_PER_NAIRA;
  return { negative, whole: whole.toString(), fraction: fraction.toString().padStart(2, '0') };
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Kobo as money a person reads: `₦1,250.50`, or `-₦1,250.50` for a debit.
 *
 * The minus sign sits before the naira symbol so a reader cannot mistake a debit
 * for a credit at a glance, and the amount is exact for any `bigint`.
 */
export function formatNaira(amountKobo: bigint): string {
  const { negative, whole, fraction } = split(amountKobo);
  return `${negative ? '-' : ''}₦${group(whole)}.${fraction}`;
}

/**
 * The same, with an explicit sign: `+₦1,250.50` or `-₦1,250.50`, and `₦0.00` for
 * zero.
 *
 * The sign is not decoration. A statement that distinguishes a credit from a debit
 * only by colour is unreadable to a colour-blind player and unreadable on a cheap
 * phone in sunlight, so the sign is always printed.
 */
export function formatSignedNaira(amountKobo: bigint): string {
  if (amountKobo === 0n) return formatNaira(0n);
  return `${amountKobo > 0n ? '+' : ''}${formatNaira(amountKobo)}`;
}

/** Kobo held as an integer string, formatted. Refuses anything that is not one. */
export function formatKoboString(amountKobo: string): string {
  return formatNaira(BigInt(koboString.parse(amountKobo)));
}

/** The signed form of a kobo string, for a statement line. */
export function formatSignedKoboString(amountKobo: string): string {
  return formatSignedNaira(BigInt(koboString.parse(amountKobo)));
}

/** Kobo as a plain decimal naira string: `1250.50`, no symbol, no separators. */
export function koboToNairaString(amountKobo: bigint): string {
  const { negative, whole, fraction } = split(amountKobo);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
