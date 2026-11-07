import { TRANSFER_PARAMS } from '@/server/config/transfer-params';

/**
 * Transfer tax.
 *
 * **Marginal, not flat** (D-162): each band taxes only the part of the amount that
 * falls inside it, so crossing a band boundary costs a little more rather than a
 * lot more. With the shipped bands, a transfer of N50,000 or less is free and only
 * the part above N50,000 pays 2%.
 *
 * All integer arithmetic on kobo. A rate is basis points, so `part * bps / 10,000`
 * is exact up to the division, and the division **rounds down** (floor): the tax is
 * never more than the percentage says, and never a fraction of a kobo, because
 * there is no such thing.
 *
 * The tax is paid by the sender **on top** of the amount (D-161), so the receiver
 * gets exactly what the sender typed, and the tax goes to TREASURY (D-160).
 */

/** The tax owed on `amountKobo`, in kobo. Never negative, never rounded up. */
export function calculateTax(amountKobo: bigint): bigint {
  if (amountKobo < 0n) throw new Error('calculateTax: amount must not be negative');

  let tax = 0n;
  let lowerBound = 0n;

  for (const band of TRANSFER_PARAMS.taxBands) {
    const upperBound = band.upToKobo ?? amountKobo;
    if (amountKobo <= lowerBound) break;

    // The part of the amount that sits in this band.
    const part = (amountKobo < upperBound ? amountKobo : upperBound) - lowerBound;
    if (part > 0n) tax += (part * BigInt(band.rateBps)) / 10_000n;

    lowerBound = upperBound;
  }

  return tax;
}

/** What the sender is debited for a transfer of `amountKobo`: the amount plus the tax. */
export function totalDebit(amountKobo: bigint): bigint {
  return amountKobo + calculateTax(amountKobo);
}
