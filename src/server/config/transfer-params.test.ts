import {
  TRANSFER_PARAMS,
  TRANSFER_PARAMS_VERSION,
  validateTransferParams,
} from './transfer-params';
import { describe, expect, it } from 'vitest';

/**
 * The rulebook is parsed at load, so these tests are about the parser refusing a
 * rulebook that would move money by the wrong rule, not about the numbers.
 */

const valid = () => ({
  version: 1,
  minTransferKobo: 10_000n,
  tiers: [
    {
      name: 'new',
      minAccountAgeDays: 0,
      maxSendPer24hKobo: 2_000_000n,
      maxReceivePer24hKobo: 3_000_000n,
      maxPerTransferKobo: 2_000_000n,
      pendingThresholdKobo: 1_000_000n,
      pendingDelayMinutes: 1_440,
      enabled: true,
    },
  ],
  taxBands: [
    { upToKobo: 5_000_000n, rateBps: 0 },
    { upToKobo: null, rateBps: 200 },
  ],
  rateLimits: { sendsPerMinute: 5, sendsPerHour: 30 },
});

describe('transfer parameters', () => {
  it('accepts the shipped rulebook', () => {
    expect(() => validateTransferParams(valid())).not.toThrow();
  });

  it('is versioned', () => {
    expect(TRANSFER_PARAMS.version).toBe(TRANSFER_PARAMS_VERSION);
    expect(TRANSFER_PARAMS_VERSION).toBeGreaterThan(0);
  });

  it('refuses an open-ended band that is not last', () => {
    const broken = valid();
    broken.taxBands = [
      { upToKobo: null, rateBps: 0 },
      { upToKobo: 5_000_000n, rateBps: 200 },
    ];
    expect(() => validateTransferParams(broken)).toThrow(/only the last tax band/);
  });

  it('refuses bands that do not ascend', () => {
    const broken = valid();
    broken.taxBands = [
      { upToKobo: 5_000_000n, rateBps: 0 },
      { upToKobo: 1_000_000n, rateBps: 200 },
    ];
    expect(() => validateTransferParams(broken)).toThrow(/must ascend/);
  });

  it('refuses a rate that is not basis points', () => {
    const broken = valid();
    broken.taxBands = [{ upToKobo: null, rateBps: 10_001 }];
    expect(() => validateTransferParams(broken)).toThrow();
  });

  it('refuses the same tier twice', () => {
    const broken = valid();
    broken.tiers = [...broken.tiers, ...broken.tiers];
    expect(() => validateTransferParams(broken)).toThrow(/each tier may appear once/);
  });

  it('refuses a zero or negative limit', () => {
    const broken = valid();
    broken.tiers[0]!.maxSendPer24hKobo = 0n;
    expect(() => validateTransferParams(broken)).toThrow();
    broken.tiers[0]!.maxSendPer24hKobo = -1n;
    expect(() => validateTransferParams(broken)).toThrow();
  });

  it('refuses a float amount, which is not money', () => {
    const broken = valid() as unknown as { minTransferKobo: unknown };
    broken.minTransferKobo = 100.5;
    expect(() => validateTransferParams(broken)).toThrow();
  });
});
