import { NextResponse } from 'next/server';
import { getEnv } from '@/server/config/env';
import { isCronRequestAuthorized } from '@/server/http/cron-auth';
import { verifyLedger } from '@/server/ledger';
import type { VerifyReport } from '@/server/ledger';
import { logEvent } from '@/server/security/audit';
import { consumeRateLimit } from '@/server/security/rate-limit';

/**
 * POST /api/internal/ledger/verify — run the ledger verifier on demand.
 *
 * For a scheduler (Railway cron, Render cron, Vercel cron, GitHub Actions) and for
 * a human with the secret, so "is the ledger still correct?" has an answer that does
 * not require database access. Protected by `CRON_SECRET` as a bearer token compared
 * in constant time, and refused outright when the secret is unset.
 *
 * Rate limited to once per 30 seconds: the verifier reads every entry in the ledger,
 * so a loop against it is a denial of service against the database, not just noise.
 * Two runs in a row would also tell you the same thing.
 *
 * The response carries ids and counts only. The audit log records that it ran and
 * whether it passed, never a failing id, because an audit row is kept for years and
 * the ids belong to players.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const RATE_LIMIT_KEY = 'internal:ledger:verify';
const RATE_LIMIT_WINDOW_SECONDS = 30;

type VerifyResponse =
  | {
      ok: boolean;
      checkedAt: string;
      counts: VerifyReport['counts'];
      failures: VerifyReport['failures'];
    }
  | { error: 'not_configured' | 'unauthorized' | 'rate_limited' };

export async function POST(request: Request): Promise<NextResponse<VerifyResponse>> {
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

  const limit = await consumeRateLimit(RATE_LIMIT_KEY, 1, RATE_LIMIT_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' as const },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const report = await verifyLedger();

  await logEvent({
    eventType: report.ok ? 'ledger_verify_run' : 'ledger_verify_failed',
    metadata: {
      ok: report.ok,
      accounts: report.counts.accounts,
      transactions: report.counts.transactions,
      entries: report.counts.entries,
      reversals: report.counts.reversals,
      failingChecks: report.failures.map((failure) => failure.check).join(','),
    },
  });

  return NextResponse.json(
    {
      ok: report.ok,
      checkedAt: report.checkedAt,
      counts: report.counts,
      failures: report.failures,
    },
    { status: report.ok ? 200 : 500, headers: NO_STORE },
  );
}
