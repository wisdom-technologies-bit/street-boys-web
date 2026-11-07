import { TRANSFER_PARAMS, type TransferTier } from '@/server/config/transfer-params';

/**
 * Which tier a player is in, decided by the age of their account.
 *
 * Age, not reputation: docs/14 section 7 defines the tiers in days played, and the
 * clock is injected so a test can say "this account is 29 days old" without waiting
 * a month.
 *
 * `trusted` also needs a verification level of 2, and it is **disabled** in the
 * rulebook (D-167), so nobody reaches it while sign-in is email only. The check is
 * written anyway: the day the tier is switched on, the rule is already here and
 * already tested.
 */

export const TRUSTED_VERIFICATION_LEVEL = 2;

export type TierSubject = {
  /** When the account was created. */
  createdAt: Date;
  /** `users.verification_level`; 1 for an email address, 2 for a verified phone. */
  verificationLevel: number;
};

export type TierResolution = {
  tier: TransferTier;
  /** Whole days since the account was created, floored. */
  ageDays: number;
};

export function resolveTier(subject: TierSubject, now: Date = new Date()): TierResolution {
  const ageMs = Math.max(0, now.getTime() - subject.createdAt.getTime());
  const ageDays = Math.floor(ageMs / 86_400_000);

  // Highest qualifying tier wins, so the order of the rulebook does not matter.
  const qualifying = TRANSFER_PARAMS.tiers
    .filter((tier) => tier.enabled && ageDays >= tier.minAccountAgeDays)
    .filter(
      (tier) => tier.name !== 'trusted' || subject.verificationLevel >= TRUSTED_VERIFICATION_LEVEL,
    )
    .sort((a, b) => b.minAccountAgeDays - a.minAccountAgeDays);

  const tier = qualifying[0];
  if (!tier) throw new Error('resolveTier: no tier matched, and the first tier starts at 0 days');

  return { tier, ageDays };
}
