import { describe, expect, it } from 'vitest';
import {
  MAX_SAFE_KOBO,
  MoneyError,
  addKobo,
  bigintReplacer,
  deserializeAmount,
  formatNaira,
  kobo,
  koboToNairaString,
  nairaToKobo,
  negateKobo,
  parseNairaToKobo,
  serializeAmount,
  sumKobo,
} from './money';

describe('money primitives', () => {
  it('keeps every amount a bigint, never a number', () => {
    const amount = parseNairaToKobo('1,250.50');
    expect(typeof amount).toBe('bigint');
    expect(amount).toBe(125050n);
    expect(typeof nairaToKobo(5000n)).toBe('bigint');
    expect(nairaToKobo(1n)).toBe(100n);
  });

  it('refuses a float where whole naira are expected', () => {
    // @ts-expect-error a number is exactly what this module exists to refuse
    expect(() => nairaToKobo(12.5)).toThrow(MoneyError);
    // @ts-expect-error kobo takes a bigint
    expect(() => kobo(10.5)).toThrow(MoneyError);
  });

  it('refuses to round: three decimal places have no exact kobo value', () => {
    expect(() => parseNairaToKobo('1.005')).toThrow(/two decimal places/);
    expect(() => parseNairaToKobo('0.001')).toThrow(MoneyError);
  });

  it('refuses shapes Number would quietly reinterpret', () => {
    for (const input of ['1e3', 'NaN', 'Infinity', '0x10', 'abc', '', '  ', '1.2.3', '--1']) {
      expect(() => parseNairaToKobo(input), input).toThrow(MoneyError);
    }
  });

  it('refuses a negative price', () => {
    expect(() => parseNairaToKobo('-50')).toThrow(/negative/);
  });

  it('parses the shapes a person or a page actually sends', () => {
    expect(parseNairaToKobo('0')).toBe(0n);
    expect(parseNairaToKobo('0.05')).toBe(5n);
    expect(parseNairaToKobo('₦1,250.5')).toBe(125050n);
    expect(parseNairaToKobo(' 1500 ')).toBe(150000n);
  });

  it('handles values larger than a number can hold exactly', () => {
    // 9,007,199,254,740,991 kobo is 2^53 - 1: the last exact integer.
    expect(MAX_SAFE_KOBO).toBe(9007199254740991n);
    expect(kobo(MAX_SAFE_KOBO)).toBe(MAX_SAFE_KOBO);
    expect(() => kobo(MAX_SAFE_KOBO + 1n)).toThrow(/range/);

    const huge = parseNairaToKobo('90071992547409.91');
    expect(huge).toBe(9007199254740991n);
    expect(nairaToKobo(90071992547409n)).toBe(9007199254740900n);
  });

  it('adds and negates without leaving bigint', () => {
    expect(addKobo(kobo(150n), kobo(250n))).toBe(400n);
    expect(negateKobo(kobo(250n))).toBe(-250n);
    expect(sumKobo([kobo(100n), kobo(-50n), kobo(-50n)])).toBe(0n);
    expect(() => addKobo(kobo(MAX_SAFE_KOBO), kobo(1n))).toThrow(/range/);
  });

  it('writes naira with two decimals and no float', () => {
    expect(koboToNairaString(kobo(0n))).toBe('0.00');
    expect(koboToNairaString(kobo(5n))).toBe('0.05');
    expect(koboToNairaString(kobo(125050n))).toBe('1250.50');
    expect(koboToNairaString(kobo(-125050n))).toBe('-1250.50');
  });

  it('formats money the way a person reads it', () => {
    expect(formatNaira(kobo(0n))).toBe('₦0.00');
    expect(formatNaira(kobo(5n))).toBe('₦0.05');
    expect(formatNaira(kobo(125050n))).toBe('₦1,250.50');
    expect(formatNaira(kobo(100000000n))).toBe('₦1,000,000.00');
    expect(formatNaira(kobo(-125050n))).toBe('-₦1,250.50');
  });

  it('crosses JSON as a string, never as a number', () => {
    expect(serializeAmount(kobo(125050n))).toBe('125050');
    expect(deserializeAmount('125050')).toBe(125050n);
    expect(deserializeAmount('-1')).toBe(-1n);

    expect(() => deserializeAmount(125050)).toThrow(/string/);
    expect(() => deserializeAmount('12.5')).toThrow(/integer/);
    expect(() => deserializeAmount('1e3')).toThrow(/integer/);

    // The replacer makes a bigint survive JSON.stringify instead of throwing.
    expect(JSON.stringify({ amount: kobo(125050n) }, bigintReplacer)).toBe('{"amount":"125050"}');
  });
});
