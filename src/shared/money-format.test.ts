import {
  formatKoboString,
  formatNaira,
  formatSignedKoboString,
  formatSignedNaira,
  koboToNairaString,
} from './money-format';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('formatNaira', () => {
  it('writes zero, one kobo and a naira with two decimals', () => {
    expect(formatNaira(0n)).toBe('₦0.00');
    expect(formatNaira(1n)).toBe('₦0.01');
    expect(formatNaira(125_050n)).toBe('₦1,250.50');
  });

  it('groups thousands and millions, and never asks the locale', () => {
    expect(formatNaira(100_000_000n)).toBe('₦1,000,000.00');
    expect(formatNaira(500_000n)).toBe('₦5,000.00');
    expect(formatNaira(123_456_789_012n)).toBe('₦1,234,567,890.12');
  });

  it('writes a debit with the sign before the symbol', () => {
    expect(formatNaira(-125_050n)).toBe('-₦1,250.50');
    expect(formatNaira(-1n)).toBe('-₦0.01');
  });

  it('is exact past 2^53 kobo, where a number would drift', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a number
    expect(formatNaira(huge)).toBe('₦90,071,992,547,409.93');
    expect(Number(huge).toString()).not.toBe(huge.toString());
    expect(formatNaira(huge)).not.toContain('e');
  });
});

describe('formatSignedNaira', () => {
  it('prints an explicit plus for a credit and a minus for a debit', () => {
    expect(formatSignedNaira(125_050n)).toBe('+₦1,250.50');
    expect(formatSignedNaira(-125_050n)).toBe('-₦1,250.50');
    expect(formatSignedNaira(0n)).toBe('₦0.00');
  });
});

describe('kobo strings', () => {
  it('formats an integer string exactly as it formats the bigint', () => {
    expect(formatKoboString('125050')).toBe(formatNaira(125_050n));
    expect(formatSignedKoboString('-125050')).toBe('-₦1,250.50');
    expect(formatKoboString('0')).toBe('₦0.00');
  });

  it('refuses a value that is not an integer string', () => {
    for (const bad of ['12.5', '1e3', '₦5', '', ' 12', 'abc']) {
      expect(() => formatKoboString(bad), bad).toThrow();
    }
  });
});

describe('koboToNairaString', () => {
  it('writes naira without a symbol or separators', () => {
    expect(koboToNairaString(125_050n)).toBe('1250.50');
    expect(koboToNairaString(-5n)).toBe('-0.05');
    expect(koboToNairaString(0n)).toBe('0.00');
  });
});

describe('the shared module stays shared', () => {
  it('imports nothing from the server, the database or the ledger', () => {
    const source = readFileSync(new URL('./money-format.ts', import.meta.url), 'utf8');
    const imports = source.match(/^import .*from ['"]([^'"]+)['"];$/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/@\/server|@\/app|drizzle|pg/);
    }
  });
});
