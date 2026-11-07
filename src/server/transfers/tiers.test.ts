import { TRANSFER_PARAMS, pendingDelayMs, transferTier } from '@/server/config/transfer-params';
import { resolveTier } from './tiers';
import { describe, expect, it } from 'vitest';

/**
 * The tier decides every limit, so the age boundaries are tested from both sides.
 * The clock is injected: a test that waits thirty days is not a test.
 */

const DAY = 86_400_000;
const now = new Date('2026-11-07T12:00:00Z');
const accountAgedDays = (days: number, verificationLevel = 1) => ({
  createdAt: new Date(now.getTime() - days * DAY),
  verificationLevel,
});

describe('resolveTier', () => {
  it('is "new" for the first week', () => {
    expect(resolveTier(accountAgedDays(0), now).tier.name).toBe('new');
    expect(resolveTier(accountAgedDays(6), now).tier.name).toBe('new');
  });

  it('is "early" from 7 days to 29', () => {
    expect(resolveTier(accountAgedDays(7), now).tier.name).toBe('early');
    expect(resolveTier(accountAgedDays(29), now).tier.name).toBe('early');
  });

  it('is "established" from 30 days, and stays there', () => {
    expect(resolveTier(accountAgedDays(30), now).tier.name).toBe('established');
    expect(resolveTier(accountAgedDays(400), now).tier.name).toBe('established');
  });

  it('floors a partial day, so a boundary is not crossed early', () => {
    const almostSeven = new Date(now.getTime() - (7 * DAY - 1));
    expect(resolveTier({ createdAt: almostSeven, verificationLevel: 1 }, now).tier.name).toBe(
      'new',
    );
  });

  it('never returns "trusted", even with a high verification level', () => {
    // D-167: the tier exists in the rulebook and is unreachable until a verified
    // phone tier is built.
    expect(resolveTier(accountAgedDays(400, 2), now).tier.name).toBe('established');
    expect(resolveTier(accountAgedDays(400, 5), now).tier.name).toBe('established');
    expect(transferTier('trusted').enabled).toBe(false);
  });

  it('never reports a negative age if the clock is behind the account', () => {
    // A row created a moment in the future (a clock skew between app servers) is
    // still zero days old, not -1 days and not a tier below the first one.
    const future = new Date(now.getTime() + 5 * DAY);
    expect(resolveTier({ createdAt: future, verificationLevel: 1 }, now).ageDays).toBe(0);
    expect(resolveTier({ createdAt: future, verificationLevel: 1 }, now).tier.name).toBe('new');
  });

  it('gives the limits docs/14 section 7 lists', () => {
    const naira = (amount: number) => BigInt(amount) * 100n;
    expect(transferTier('new').maxSendPer24hKobo).toBe(naira(20_000));
    expect(transferTier('new').maxReceivePer24hKobo).toBe(naira(30_000));
    expect(transferTier('new').pendingThresholdKobo).toBe(naira(10_000));
    expect(transferTier('early').maxSendPer24hKobo).toBe(naira(75_000));
    expect(transferTier('established').maxSendPer24hKobo).toBe(naira(300_000));
    expect(transferTier('trusted').maxSendPer24hKobo).toBe(naira(1_000_000));
  });

  it('waits a day before releasing a pending transfer', () => {
    expect(pendingDelayMs(transferTier('new'))).toBe(DAY);
    for (const tier of TRANSFER_PARAMS.tiers) expect(tier.pendingDelayMinutes).toBe(1_440);
  });
});
