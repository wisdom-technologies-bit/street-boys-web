import { TRANSFER_PARAMS } from '@/server/config/transfer-params';
import { calculateTax, totalDebit } from './tax';
import { describe, expect, it } from 'vitest';

/**
 * Tax is the part of a transfer a player notices. The band edges are tested
 * individually because an off-by-one at a boundary is invisible in normal use and
 * very visible to the player standing on it.
 */

const naira = (amount: number): bigint => BigInt(amount) * 100n;

describe('calculateTax', () => {
  it('charges nothing below the free threshold', () => {
    expect(calculateTax(0n)).toBe(0n);
    expect(calculateTax(naira(1))).toBe(0n);
    expect(calculateTax(naira(49_999))).toBe(0n);
  });

  it('charges nothing exactly at the top of the free band', () => {
    expect(calculateTax(naira(50_000))).toBe(0n);
  });

  it('charges 2% on the part above the free band, not on the whole amount', () => {
    // N50,100: only N100 is taxable, so N2.
    expect(calculateTax(naira(50_100))).toBe(naira(2));
    // N100,000: N50,000 taxable at 2% is N1,000.
    expect(calculateTax(naira(100_000))).toBe(naira(1_000));
  });

  it('rounds a fraction of a kobo down, never up', () => {
    // 5,001 kobo above the threshold at 2% is 100.02 kobo.
    expect(calculateTax(naira(50_000) + 5_001n)).toBe(100n);
    // And 4,999 kobo over is 99.98, so 99.
    expect(calculateTax(naira(50_000) + 4_999n)).toBe(99n);
  });

  it('stays exact on very large amounts', () => {
    const amount = 10n ** 15n; // ten trillion kobo, far past any real transfer
    expect(calculateTax(amount)).toBe(((amount - naira(50_000)) * 200n) / 10_000n);
  });

  it('refuses a negative amount', () => {
    expect(() => calculateTax(-1n)).toThrow(/must not be negative/);
  });

  it('is monotonic: a larger transfer never costs less tax', () => {
    let previous = 0n;
    for (const nairaAmount of [0, 100, 50_000, 50_001, 60_000, 100_000, 1_000_000]) {
      const tax = calculateTax(naira(nairaAmount));
      expect(tax).toBeGreaterThanOrEqual(previous);
      previous = tax;
    }
  });
});

describe('totalDebit', () => {
  it('adds the tax on top, so the receiver gets the stated amount', () => {
    expect(totalDebit(naira(50_100))).toBe(naira(50_100) + naira(2));
    expect(totalDebit(naira(10))).toBe(naira(10));
  });

  it('agrees with the shipped bands', () => {
    const free = TRANSFER_PARAMS.taxBands[0];
    expect(free?.rateBps).toBe(0);
    expect(free?.upToKobo).toBe(naira(50_000));
    expect(TRANSFER_PARAMS.taxBands.at(-1)?.rateBps).toBe(200);
  });
});
