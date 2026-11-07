import {
  DEFAULT_ECONOMY_PARAMS,
  getEconomyParams,
  parseEconomyParams,
  resetEconomyParamsCache,
} from './economy-params';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => resetEconomyParamsCache());

describe('parseEconomyParams', () => {
  it('accepts the defaults and freezes the result', () => {
    const params = parseEconomyParams(DEFAULT_ECONOMY_PARAMS);

    expect(params.startingBalanceKobo).toBe(500_000n); // PLACEHOLDER: ₦5,000
    expect(params.version).toBe('2026-11-07.1');
    expect(Object.isFrozen(params)).toBe(true);
  });

  it('accepts a zero starting balance, because a grant of nothing is a choice', () => {
    expect(
      parseEconomyParams({ version: 'v-0', startingBalanceKobo: 0n }).startingBalanceKobo,
    ).toBe(0n);
  });

  it('refuses a negative starting balance', () => {
    expect(() => parseEconomyParams({ version: 'v-1', startingBalanceKobo: -1n })).toThrow(
      /startingBalanceKobo/,
    );
  });

  it('refuses a number where kobo is expected, because a float is not money', () => {
    expect(() => parseEconomyParams({ version: 'v-1', startingBalanceKobo: 5000 })).toThrow(
      /bigint/,
    );
    expect(() => parseEconomyParams({ version: 'v-1', startingBalanceKobo: 5000.5 })).toThrow(
      /bigint/,
    );
    expect(() => parseEconomyParams({ version: 'v-1', startingBalanceKobo: '500000' })).toThrow(
      /bigint/,
    );
  });

  it('refuses an amount past the safe boundary and a missing version', () => {
    expect(() =>
      parseEconomyParams({ version: 'v-1', startingBalanceKobo: 9_007_199_254_740_992n }),
    ).toThrow(/safe/);
    expect(() => parseEconomyParams({ startingBalanceKobo: 1n })).toThrow(/version/);
    expect(() => parseEconomyParams({ version: '', startingBalanceKobo: 1n })).toThrow(/version/);
  });

  it('names the field that is wrong, so a bad config is one line to fix', () => {
    expect(() => parseEconomyParams({ version: 'v-1', startingBalanceKobo: -5n })).toThrow(
      /startingBalanceKobo/,
    );
  });
});

describe('getEconomyParams', () => {
  it('returns the same validated parameters every time, and recovers after a reset', () => {
    const first = getEconomyParams();
    const second = getEconomyParams();
    expect(first).toBe(second);

    resetEconomyParamsCache();
    const third = getEconomyParams();
    expect(third).not.toBe(first);
    expect(third.startingBalanceKobo).toBe(first.startingBalanceKobo);
  });

  it('holds the placeholder from docs/14 as a bigint of kobo', () => {
    expect(typeof getEconomyParams().startingBalanceKobo).toBe('bigint');
    expect(getEconomyParams().startingBalanceKobo).toBe(500_000n);
  });
});
