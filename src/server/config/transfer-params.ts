import { z } from 'zod';

/**
 * The transfer rulebook: limits, tiers, tax bands and rate limits.
 *
 * Every number here is **PLACEHOLDER** and comes from `street-boys-docs/docs/14`,
 * sections 4 (fees and taxes) and 7 (transfer limits by tier). Nothing in the
 * transfer code may hold a number of its own (AGENTS.md 5, D-128, D-157): a limit
 * that lives in two places is a limit that disagrees with itself.
 *
 * The file is versioned and parsed at load, so a mistyped band fails at start-up
 * rather than moving money by the wrong percentage.
 */

export const TRANSFER_PARAMS_VERSION = 1;

export type TaxBand = {
  /** The band covers everything up to and including this, or `null` for the last one. */
  upToKobo: bigint | null;
  /** Basis points: 200 is 2%. Integer, because a rate is not a float either. */
  rateBps: number;
};

export type TransferTierName = 'new' | 'early' | 'established' | 'trusted';

export type TransferTier = {
  name: TransferTierName;
  /** The tier applies from this account age in days, inclusive. */
  minAccountAgeDays: number;
  maxSendPer24hKobo: bigint;
  maxReceivePer24hKobo: bigint;
  /**
   * PLACEHOLDER: docs/14 gives a daily send limit per tier and no single-transfer
   * cap, so the daily limit is used as the per-transfer cap. A transfer can never
   * be larger than what a tier may send in a day, which is true either way, but
   * these two numbers may want to diverge later.
   */
  maxPerTransferKobo: bigint;
  /** At or above this, the transfer waits for the pending period instead of settling. */
  pendingThresholdKobo: bigint;
  pendingDelayMinutes: number;
  /** A tier can exist in the rulebook and be unreachable. `trusted` is (D-167). */
  enabled: boolean;
};

const tierSchema = z.object({
  name: z.enum(['new', 'early', 'established', 'trusted']),
  minAccountAgeDays: z.number().int().min(0),
  maxSendPer24hKobo: z.bigint().positive(),
  maxReceivePer24hKobo: z.bigint().positive(),
  maxPerTransferKobo: z.bigint().positive(),
  pendingThresholdKobo: z.bigint().nonnegative(),
  pendingDelayMinutes: z.number().int().positive(),
  enabled: z.boolean(),
});

const paramsSchema = z
  .object({
    version: z.number().int().positive(),
    /** PLACEHOLDER: no minimum is given in docs/14. Below this, a transfer is a typo. */
    minTransferKobo: z.bigint().positive(),
    tiers: z.array(tierSchema).min(1),
    /** Marginal: each band applies to the part of the amount inside it (D-162). */
    taxBands: z
      .array(
        z.object({
          upToKobo: z.bigint().positive().nullable(),
          rateBps: z.number().int().min(0).max(10_000),
        }),
      )
      .min(1),
    rateLimits: z.object({
      sendsPerMinute: z.number().int().positive(),
      sendsPerHour: z.number().int().positive(),
    }),
  })
  .superRefine((params, ctx) => {
    // Only the last band may be open-ended, or a later band would be unreachable.
    params.taxBands.forEach((band, index) => {
      if (band.upToKobo === null && index !== params.taxBands.length - 1) {
        ctx.addIssue({ code: 'custom', message: 'only the last tax band may be open-ended' });
      }
    });
    let previous = 0n;
    for (const band of params.taxBands) {
      if (band.upToKobo === null) continue;
      if (band.upToKobo <= previous) {
        ctx.addIssue({ code: 'custom', message: 'tax bands must ascend' });
      }
      previous = band.upToKobo;
    }
    const names = params.tiers.map((tier) => tier.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', message: 'each tier may appear once' });
    }
  });

export type TransferParams = z.infer<typeof paramsSchema>;

/** Parse and validate a rulebook. Throws with the reason a value is wrong. */
export function validateTransferParams(value: unknown): TransferParams {
  return paramsSchema.parse(value);
}

const naira = (amount: number): bigint => BigInt(amount) * 100n;

export const TRANSFER_PARAMS: TransferParams = validateTransferParams({
  version: TRANSFER_PARAMS_VERSION,

  minTransferKobo: naira(100), // PLACEHOLDER

  tiers: [
    {
      // docs/14 section 7, "New": 0 days, N20,000 a day out, N30,000 in, pending above N10,000.
      name: 'new',
      minAccountAgeDays: 0,
      maxSendPer24hKobo: naira(20_000),
      maxReceivePer24hKobo: naira(30_000),
      maxPerTransferKobo: naira(20_000), // PLACEHOLDER, see the type comment
      pendingThresholdKobo: naira(10_000),
      pendingDelayMinutes: 1_440,
      enabled: true,
    },
    {
      // docs/14 section 7, "7-day".
      name: 'early',
      minAccountAgeDays: 7,
      maxSendPer24hKobo: naira(75_000),
      maxReceivePer24hKobo: naira(120_000),
      maxPerTransferKobo: naira(75_000), // PLACEHOLDER
      pendingThresholdKobo: naira(25_000),
      pendingDelayMinutes: 1_440,
      enabled: true,
    },
    {
      // docs/14 section 7, "30-day".
      name: 'established',
      minAccountAgeDays: 30,
      maxSendPer24hKobo: naira(300_000),
      maxReceivePer24hKobo: naira(500_000),
      maxPerTransferKobo: naira(300_000), // PLACEHOLDER
      pendingThresholdKobo: naira(100_000),
      pendingDelayMinutes: 1_440,
      enabled: true,
    },
    {
      // docs/14 section 7, "Trusted". docs/14 asks for 60 days plus reputation 50;
      // D-167 makes it config-only and unreachable until phone verification exists,
      // so the age here is the "established" age and `enabled` is false.
      name: 'trusted',
      minAccountAgeDays: 30,
      maxSendPer24hKobo: naira(1_000_000),
      maxReceivePer24hKobo: naira(1_500_000),
      maxPerTransferKobo: naira(1_000_000), // PLACEHOLDER
      pendingThresholdKobo: naira(400_000),
      pendingDelayMinutes: 1_440,
      enabled: false,
    },
  ],

  // docs/14 section 4: "Free under N50,000; 2% above", applied marginally (D-162).
  taxBands: [
    { upToKobo: naira(50_000), rateBps: 0 },
    { upToKobo: null, rateBps: 200 },
  ],

  rateLimits: {
    sendsPerMinute: 5, // PLACEHOLDER
    sendsPerHour: 30, // PLACEHOLDER
  },
});

/** The tier with this name, from the validated rulebook. */
export function transferTier(name: TransferTierName): TransferTier {
  const found = TRANSFER_PARAMS.tiers.find((tier) => tier.name === name);
  if (!found) throw new Error(`unknown transfer tier: ${name}`);
  return found;
}

/** The pending period as milliseconds, for release scheduling. */
export function pendingDelayMs(tier: TransferTier): number {
  return tier.pendingDelayMinutes * 60_000;
}
