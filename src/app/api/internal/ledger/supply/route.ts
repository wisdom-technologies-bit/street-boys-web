import { NextResponse } from 'next/server';
import { getEnv } from '@/server/config/env';
import { isCronRequestAuthorized } from '@/server/http/cron-auth';
import { getFlowsByCategory, getMoneySupply, windowStart } from '@/server/ledger';
import type { FlowRow, MoneySupply } from '@/server/ledger';

/**
 * GET /api/internal/ledger/supply?days=30 — the money supply and the daily flows.
 *
 * Same protection as the verifier: `CRON_SECRET` bearer, constant time, refused when
 * unset. Read-only and cheap, so it is not rate limited the way the verifier is.
 *
 * Amounts are returned as **strings** because they are kobo in a `bigint`, and JSON
 * has no integer type wide enough for a bigint. A string is exact; a number would
 * silently lose precision on a large economy.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_DAYS = 90;

type SupplyResponse =
  | {
      days: number;
      from: string;
      supply: Record<string, string | Record<string, number>>;
      flows: Array<{ day: string; category: string; createdKobo: string; destroyedKobo: string }>;
    }
  | { error: 'not_configured' | 'unauthorized' | 'invalid_request' };

/** Every kobo figure as a string, so no consumer rounds it. */
function serialiseSupply(supply: MoneySupply): Record<string, string | Record<string, number>> {
  return {
    circulatingKobo: supply.circulatingKobo.toString(),
    totalMintedKobo: supply.totalMintedKobo.toString(),
    totalBurnedKobo: supply.totalBurnedKobo.toString(),
    treasuryKobo: supply.treasuryKobo.toString(),
    playersKobo: supply.playersKobo.toString(),
    escrowKobo: supply.escrowKobo.toString(),
    accountCounts: supply.accountCounts,
  };
}

function serialiseFlows(flows: FlowRow[]) {
  return flows.map((row) => ({
    day: row.day,
    category: row.category,
    createdKobo: row.createdKobo.toString(),
    destroyedKobo: row.destroyedKobo.toString(),
  }));
}

export async function GET(request: Request): Promise<NextResponse<SupplyResponse>> {
  const { CRON_SECRET } = getEnv();

  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: 'not_configured' as const },
      { status: 503, headers: NO_STORE },
    );
  }

  if (!isCronRequestAuthorized(request.headers.get('authorization'), CRON_SECRET)) {
    return NextResponse.json(
      { error: 'unauthorized' as const },
      { status: 401, headers: NO_STORE },
    );
  }

  const rawDays = new URL(request.url).searchParams.get('days') ?? '30';
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json(
      { error: 'invalid_request' as const },
      { status: 400, headers: NO_STORE },
    );
  }

  const from = windowStart(days);
  const supply = await getMoneySupply();
  const flows = await getFlowsByCategory({
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(),
  });

  return NextResponse.json(
    { days, from, supply: serialiseSupply(supply), flows: serialiseFlows(flows) },
    { status: 200, headers: NO_STORE },
  );
}
